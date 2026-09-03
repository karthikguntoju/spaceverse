/**
 * VR Solar System — entry point.
 *
 * Two experiences share one scene, but each has its own entry point and the
 * launcher only ever offers the one you arrived for:
 *   • EXPLORE — free flight around a live, textured solar system  (/vr-solar-system)
 *   • RIDE    — "VR Deep Space Ride", a scripted roller-coaster    (/vr-ride)
 *
 * Works on a flat screen (mouse + WASD) and in a headset (WebXR, thumbstick
 * locomotion, controller ray picking, haptics). The camera always lives
 * inside a dolly group; nothing ever writes camera.position directly, which
 * is what makes the same code valid in an immersive session.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SolarSystem, BODIES } from './solar-system.js';
import { SpaceAudio } from './audio.js';
import { ScareDirector } from './scares.js';
import { Ride } from './ride.js';
import { GyroLook } from './gyro.js';
import { Cockpit } from './cockpit.js';
import { StereoEffect } from 'three/addons/effects/StereoEffect.js';
import MissionCore from '../game/core.js';
import { createScanHunt } from '../game/missions/scan-hunt.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

class VRApp {
    constructor() {
        this.mode = 'menu';
        /* The experience this URL is an entry point for. Resolved in the
           constructor because buildVRMenu() runs during init() and must not
           build a panel for the experience this page is not offering — the
           coaster is its own feature and lives at /vr-ride. */
        this.entry = (location.pathname.indexOf('vr-ride') !== -1 ||
            location.search.indexOf('mode=ride') !== -1) ? 'ride' : 'explore';
        this.clock = new THREE.Clock();
        this.keys = new Set();
        this.flySpeed = 40;
        this.yaw = 0;
        this.pitch = 0;
        this.dragging = false;
        this.focusTween = null;
        this.comfort = false;
        this.scaresOn = true;
        this.baseFov = 62;
        this.hudDirty = true;
        this.hudText = { title: 'SPACEVERSE', sub: 'Solar system', warn: '' };

        /* Head look inside the cabin (ride) — the dolly rides the rails, the
           camera is the head. Mouse/touch move these; the gyro replaces them. */
        this.lookYaw = 0;
        this.lookPitch = 0;
        this.gyro = new GyroLook();
        this.gyroOn = false;
        /* Phone VR: side-by-side stereo for a Cardboard-style viewer, gaze
           reticle instead of a pointer, tap instead of buttons. */
        this.stereo = false;
        this.autoFly = false;
        this.gaze = { key: null, t: 0, done: false };
        this.cockpitOn = true;
        this.isTouch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
    }

    async init() {
        const container = $('vr-container');

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        this.renderer.xr.enabled = true;
        container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x03060f);
        this.scene.fog = null;

        this.camera = new THREE.PerspectiveCamera(this.baseFov, window.innerWidth / window.innerHeight, 0.1, 6000);
        this.dolly = new THREE.Group();
        this.dolly.add(this.camera);
        this.scene.add(this.dolly);

        this.audio = new SpaceAudio();

        // software rasterisers (SwiftShader, llvmpipe, Basic Render Driver) cannot
        // carry the full scene — drop instance counts and pixel ratio for them
        let quality = 'high';
        try {
            const gl = this.renderer.getContext();
            const dbg = gl.getExtension('WEBGL_debug_renderer_info');
            const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
            if (/swiftshader|llvmpipe|software|basic render/i.test(name)) {
                quality = 'low';
                this.renderer.setPixelRatio(1);
            }
        } catch (e) { /* extension unavailable — assume hardware */ }
        this.quality = quality;

        // Bloom makes the Sun, coronas and star field actually glow. Flat
        // screen only: inside an XR session three renders per-eye through its
        // own pipeline, so there the plain renderer path is used instead.
        if (quality === 'high') {
            this.composer = new EffectComposer(this.renderer);
            this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            this.composer.setSize(window.innerWidth, window.innerHeight);
            this.composer.addPass(new RenderPass(this.scene, this.camera));
            this.bloomPass = new UnrealBloomPass(
                new THREE.Vector2(window.innerWidth, window.innerHeight), 0.45, 0.5, 0.85);
            this.composer.addPass(this.bloomPass);
            this.composer.addPass(new OutputPass());
        }

        this.system = new SolarSystem(this.scene, { quality });
        await this.system.build(msg => this.setStatus(msg));
        this.system.setLabelsVisible(false);   // labels belong to explore mode

        this.scares = new ScareDirector({
            scene: this.scene,
            camera: this.camera,
            audio: this.audio,
            haptics: (i, ms) => this.pulse(i, ms)
        });
        this.scares.onEvent = e => this.onScareEvent(e);

        this.ride = new Ride({
            scene: this.scene, dolly: this.dolly, camera: this.camera,
            audio: this.audio, scares: this.scares, system: this.system
        });
        this.ride.onSegment = (s, i, n) => this.onSegment(s, i, n);
        this.ride.onNarrate = txt => this.narrate(txt);
        this.ride.onProgress = (p, t, total) => this.onRideProgress(p, t, total);
        this.ride.onFinish = () => this.onRideFinish();
        this.ride.onFov = (fov, spd) => {
            if (!this.renderer.xr.isPresenting) {
                const want = fov + spd * 6;
                if (Math.abs(this.camera.fov - want) > 0.05) {
                    this.camera.fov += (want - this.camera.fov) * 0.05;
                    this.camera.updateProjectionMatrix();
                }
            }
        };

        this.cockpit = new Cockpit({ dolly: this.dolly, camera: this.camera, renderer: this.renderer });
        this.stereoEffect = new StereoEffect(this.renderer);
        this.buildReticle();

        // Missions run on the shared core. VRApp stays the only owner of the
        // scene, the camera and the audio; the core owns nothing but the run.
        MissionCore.register(createScanHunt({
            system: this.system,
            audio: this.audio,
            hud: {
                setObjective: (text) => this.setMissionObjective(text),
                setProgress: (done, total, missed) => this.setMissionProgress(done, total, missed),
                flash: (kind) => this.flashMission(kind)
            }
        }));
        MissionCore.on('result', (result) => this.onMissionResult(result));

        this.buildVRHud();
        this.buildVRMenu();
        this.buildControllers();
        this.bindInput();
        this.bindUI();

        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();

        this.placeAtEarth();
        window.addEventListener('resize', () => this.onResize());

        // one render loop for both flat and immersive presentation
        this.renderer.setAnimationLoop((t, frame) => this.loop(frame));

        this.checkXR();
        this.checkPhone();
        $('loading').style.display = 'none';
        $('mode-menu').classList.add('show');

        // the launcher scopes itself to this entry point from an inline script
        // in the page; re-assert it here in case that script was skipped
        $('mode-menu').classList.add(this.entry === 'ride' ? 'only-ride' : 'only-explore');

        window.__vr = this;   // debug / QA handle
        this.missionCore = MissionCore;   // reachable from the QA handle
    }

    setStatus(msg) {
        const el = $('load-status');
        if (el) el.textContent = msg;
    }

    /* ── camera helpers ─────────────────────────────────────────────── */

    placeAtEarth() {
        const p = this.system.worldPos('earth', new THREE.Vector3());
        this.dolly.position.set(p.x + 26, p.y + 9, p.z + 26);
        const dir = p.clone().sub(this.dolly.position).normalize();
        this.yaw = Math.atan2(-dir.x, -dir.z);
        this.pitch = Math.asin(clamp(dir.y, -1, 1));
        this.applyLook();
    }

    applyLook() {
        // with the gyro driving the camera, the dolly only carries the yaw
        // offset from touch-drag; pitch is the phone's job
        const pitch = this.gyroActive ? 0 : this.pitch;
        this.dolly.quaternion.setFromEuler(new THREE.Euler(pitch, this.yaw, 0, 'YXZ'));
    }

    /** true while the phone's sensors are steering the camera */
    get gyroActive() {
        return this.gyroOn && this.gyro.enabled && this.gyro.hasReading && !this.renderer.xr.isPresenting;
    }

    /* ── phone VR: gyro look + Cardboard stereo ─────────────────────── */

    checkPhone() {
        const wrap = $('phone-row');
        if (!wrap) return;
        // Offer it on anything with a touch screen; a desktop has no sensors
        // to give and the buttons would only confuse.
        if (!this.isTouch) { wrap.style.display = 'none'; return; }
        wrap.style.display = 'flex';
        const reason = GyroLook.blockedReason;
        const note = $('phone-note');
        if (note) {
            note.textContent = reason
                ? '⚠ ' + reason
                : 'Hold the phone up and turn around — the view follows. Phone VR splits the screen for a Cardboard-style headset.';
            note.classList.toggle('warn', !!reason);
        }
    }

    async enableGyro(silent) {
        if (this.gyroOn) return true;
        if (!GyroLook.available) {
            if (!silent) this.toast(GyroLook.blockedReason || 'Motion sensors unavailable.');
            return false;
        }
        const ok = await this.gyro.enable();
        if (!ok) {
            if (!silent) this.toast('Motion sensor permission was refused. Allow it in browser settings and try again.');
            return false;
        }
        this.gyroOn = true;
        // whatever way you face when it starts is "forward" — and the free-
        // flight yaw is carried by the dolly from here on
        this.gyro.recenter();
        this.applyLook();
        this.updatePhoneButtons();
        if (!silent) this.toast('Gyro look ON — move your phone to look around. ⟲ recenters.');
        return true;
    }

    disableGyro() {
        if (!this.gyroOn) return;
        this.gyro.disable();
        this.gyroOn = false;
        this.camera.quaternion.identity();
        this.applyLook();
        this.updatePhoneButtons();
        this.toast('Gyro look OFF');
    }

    recenterView() {
        if (this.gyroActive) this.gyro.recenter();
        this.lookYaw = 0; this.lookPitch = 0;
        this.audio.blip(700);
        this.toast('View recentred');
    }

    async enterPhoneVR() {
        if (this.renderer.xr.isPresenting) return;
        await this.enableGyro(true);
        this.stereo = true;
        document.body.classList.add('in-cardboard');
        const el = document.documentElement;
        try {
            if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
            else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        } catch (e) { /* iOS Safari has no fullscreen for pages */ }
        try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); }
        catch (e) { /* not lockable here — user rotates by hand */ }
        this.reticle.visible = true;
        this.vrHud.visible = this.mode !== 'ride';
        this.audio.init();
        this.onResize();
        this.updatePhoneButtons();
        const gyroMsg = this.gyroOn ? '' : ' (no gyro — drag to look)';
        this.toast('Phone VR' + gyroMsg + ' — put the phone in your viewer. Tap = ' +
            (this.entry === 'ride' ? 'pause / resume' : 'fly / stop') + '. Look at a world to scan it.');
        this._fsHandler = () => {
            if (!document.fullscreenElement && this.stereo) this.exitPhoneVR();
        };
        document.addEventListener('fullscreenchange', this._fsHandler);
    }

    exitPhoneVR() {
        if (!this.stereo) return;
        this.stereo = false;
        this.autoFly = false;
        document.body.classList.remove('in-cardboard');
        if (this._fsHandler) document.removeEventListener('fullscreenchange', this._fsHandler);
        try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen(); } catch (e) { /* ignore */ }
        try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e) { /* ignore */ }
        this.reticle.visible = false;
        this.vrHud.visible = false;
        this.renderer.setScissorTest(false);
        this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
        this.onResize();
        this.updatePhoneButtons();
    }

    updatePhoneButtons() {
        const g = $('btn-gyro'), p = $('btn-phone-vr');
        if (g) g.textContent = this.gyroOn ? '🧭 Gyro look: ON' : '🧭 Gyro look';
        if (p) p.textContent = this.stereo ? '📱 Exit Phone VR' : '📱 Phone VR (Cardboard)';
    }

    /** a small ring at the centre of view — the pointer when there is no pointer */
    buildReticle() {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.006, 0.009, 32),
            new THREE.MeshBasicMaterial({ color: 0x64ffda, transparent: true, opacity: 0.9, depthTest: false })
        );
        ring.position.set(0, 0, -0.6);
        ring.renderOrder = 999;
        ring.visible = false;
        const fill = new THREE.Mesh(
            new THREE.CircleGeometry(0.006, 32),
            new THREE.MeshBasicMaterial({ color: 0x64ffda, transparent: true, opacity: 0.0, depthTest: false })
        );
        fill.renderOrder = 999;
        ring.add(fill);
        this.reticleFill = fill;
        this.camera.add(ring);
        this.reticle = ring;
    }

    /**
     * Cardboard has no pointer, so looking at a world for a moment scans it.
     * Runs only in stereo, only in modes where scanning means something.
     */
    gazeUpdate(dt) {
        if (!this.stereo || this.mode === 'ride' || this.mode === 'menu') {
            if (this.reticleFill.material.opacity !== 0) this.reticleFill.material.opacity = 0;
            return;
        }
        this.pointer.set(0, 0);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hits = this.raycaster.intersectObjects(this.system.pickTargets, false);
        const key = hits.length ? hits[0].object.userData.bodyKey : null;
        if (key !== this.gaze.key) { this.gaze.key = key; this.gaze.t = 0; this.gaze.done = false; }
        if (!key) { this.reticleFill.material.opacity = 0; this.reticle.scale.setScalar(1); return; }
        this.gaze.t += dt;
        const DWELL = 1.4;
        const p = clamp(this.gaze.t / DWELL, 0, 1);
        this.reticleFill.material.opacity = p * 0.9;
        this.reticle.scale.setScalar(1 + p * 0.6);
        if (p >= 1 && !this.gaze.done) {
            this.gaze.done = true;
            this.showBody(key, this.mode === 'explore');
            this.audio.blip(920);
        }
    }

    /** a tap on the screen (or the Cardboard button) — no pointer, one action */
    onPhoneTap() {
        if (this.mode === 'ride') {
            this.ride.playing ? this.ride.pause() : this.ride.resume();
            this.updateHudDom();
            this.audio.blip(this.ride.playing ? 720 : 480);
        } else if (this.mode === 'explore' || this.mode === 'mission') {
            this.autoFly = !this.autoFly;
            this.audio.blip(this.autoFly ? 760 : 420);
            this.setHud(this.autoFly ? 'FLYING' : 'HOLDING',
                this.autoFly ? 'Look where you want to go · tap to stop' : 'Tap to fly toward where you look');
        }
    }

    /**
     * Camera pose inside the dolly for the flat/phone paths. In an XR session
     * the headset owns the camera and this must not touch it.
     */
    updateHead(dt) {
        if (this.renderer.xr.isPresenting) return;
        if (this.gyroActive) {
            this.gyro.apply(this.camera.quaternion, 0);
            return;
        }
        if (this.mode === 'ride') {
            // seated head-look; without input the head slowly settles forward
            if (!this.dragging) {
                this.lookYaw += (0 - this.lookYaw) * Math.min(1, dt * 0.35);
                this.lookPitch += (0 - this.lookPitch) * Math.min(1, dt * 0.35);
            }
            this.camera.quaternion.setFromEuler(new THREE.Euler(this.lookPitch, this.lookYaw, 0, 'YXZ'));
        } else if (this.camera.quaternion.w !== 1) {
            this.camera.quaternion.identity();
        }
    }

    /* ── WebXR ──────────────────────────────────────────────────────── */

    async checkXR() {
        const btn = $('enter-vr');
        if (!navigator.xr) {
            btn.textContent = '🥽 VR not supported on this browser';
            btn.disabled = true;
            btn.classList.add('disabled');
            return;
        }
        try {
            const ok = await navigator.xr.isSessionSupported('immersive-vr');
            if (!ok) {
                btn.textContent = '🥽 No headset detected';
                btn.disabled = true;
                btn.classList.add('disabled');
            } else {
                btn.textContent = '🥽 Enter VR';
                btn.disabled = false;
                $('vr-ready').style.display = 'block';
            }
        } catch (e) {
            btn.disabled = true;
        }
    }

    async enterVR() {
        if (!navigator.xr) return;
        if (this.stereo) this.exitPhoneVR();
        try {
            const session = await navigator.xr.requestSession('immersive-vr', {
                optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers']
            });
            this.renderer.xr.setReferenceSpaceType('local-floor');
            await this.renderer.xr.setSession(session);
            this.xrSession = session;
            document.body.classList.add('in-vr');
            this.vrHud.visible = true;
            // nothing DOM is visible in a session, so offer the picker in-world
            if (this.mode === 'menu') setTimeout(() => this.toggleVRMenu(), 700);
            session.addEventListener('end', () => {
                this.xrSession = null;
                document.body.classList.remove('in-vr');
                this.vrHud.visible = false;
            });
            this.audio.init();
        } catch (e) {
            console.error('[vr] session request failed', e);
            this.toast('Could not start VR session: ' + e.message);
        }
    }

    pulse(intensity, ms) {
        const s = this.xrSession;
        if (!s) return;
        for (const src of s.inputSources) {
            const g = src.gamepad;
            if (g && g.hapticActuators && g.hapticActuators[0]) {
                try { g.hapticActuators[0].pulse(clamp(intensity, 0, 1), ms); } catch (e) { /* older runtimes */ }
            }
        }
    }

    buildControllers() {
        this.controllers = [];
        const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
        for (let i = 0; i < 2; i++) {
            const c = this.renderer.xr.getController(i);
            const line = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({
                color: 0x64ffda, transparent: true, opacity: 0.7
            }));
            line.scale.z = 6;
            c.add(line);
            const grip = new THREE.Mesh(
                new THREE.CylinderGeometry(0.012, 0.02, 0.12, 12),
                new THREE.MeshStandardMaterial({ color: 0x223044, roughness: 0.5, emissive: 0x0b1b26 })
            );
            grip.rotation.x = -Math.PI / 3;
            c.add(grip);
            c.addEventListener('selectstart', () => this.onControllerSelect(c));
            c.addEventListener('squeezestart', () => this.toggleVRMenu());
            this.dolly.add(c);
            this.controllers.push(c);
        }
    }

    /* in-headset mode picker: the DOM menu is invisible inside a session, so
       the same choices exist as world-space panels the controller can point at */
    buildVRMenu() {
        const label = (text, sub, accent) => {
            const c = document.createElement('canvas');
            c.width = 512; c.height = 256;
            const x = c.getContext('2d');
            x.fillStyle = 'rgba(8,15,28,0.92)';
            x.fillRect(0, 0, 512, 256);
            x.strokeStyle = accent; x.lineWidth = 6;
            x.strokeRect(3, 3, 506, 250);
            x.textAlign = 'center';
            x.fillStyle = accent;
            // shrink to fit rather than spill past the panel edge — the labels
            // are not all the same length
            let size = 46;
            x.font = `bold ${size}px Inter, sans-serif`;
            while (x.measureText(text).width > 448 && size > 26) {
                size -= 2;
                x.font = `bold ${size}px Inter, sans-serif`;
            }
            x.fillText(text, 256, 112);
            x.fillStyle = '#cfe3ff';
            x.font = '26px Inter, sans-serif';
            x.fillText(sub, 256, 166);
            const t = new THREE.CanvasTexture(c);
            t.colorSpace = THREE.SRGBColorSpace;
            return t;
        };

        this.vrMenu = new THREE.Group();
        this.vrMenu.visible = false;
        this.dolly.add(this.vrMenu);

        const mk = (tex, y, action) => {
            const m = new THREE.Mesh(
                new THREE.PlaneGeometry(0.9, 0.45),
                new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false })
            );
            m.position.set(0, y, 0);
            m.renderOrder = 997;
            m.userData.action = action;
            this.vrMenu.add(m);
            return m;
        };
        // One panel, matching the entry point — the in-headset picker offers
        // exactly what the DOM launcher offers, so neither duplicates the
        // other experience.
        this.vrMenuItems = this.entry === 'ride'
            ? [mk(label('VR DEEP SPACE RIDE', '3 min · jumpscares ahead', '#ff8b8b'), 0, 'ride')]
            : [
                mk(label('EXPLORE', 'Free flight · left stick to fly', '#64ffda'), 0.28, 'explore'),
                mk(label('SCAN HUNT', '90 sec · find 5 worlds', '#c4b5fd'), -0.28, 'scan-hunt')
            ];
    }

    toggleVRMenu() {
        if (!this.renderer.xr.isPresenting) return;
        const show = !this.vrMenu.visible;
        this.vrMenu.visible = show;
        // the status strip sits closer to the eye than the panels and would
        // otherwise punch through the lower button
        this.vrHud.visible = !show;
        if (!show) return;
        // park it 1.6 m in front of where the visor is looking right now
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const p = this.camera.position.clone().addScaledVector(fwd, 1.6);
        this.vrMenu.position.copy(p);
        this.vrMenu.quaternion.copy(this.camera.quaternion);
        this.audio.blip(600);
    }

    /** returns the menu item under a controller's ray, if any */
    menuHit(controller) {
        if (!this.vrMenu.visible) return null;
        const m = new THREE.Matrix4().identity().extractRotation(controller.matrixWorld);
        const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
        const dir = new THREE.Vector3(0, 0, -1).applyMatrix4(m).normalize();
        this.raycaster.set(origin, dir);
        const hits = this.raycaster.intersectObjects(this.vrMenuItems, false);
        return hits.length ? hits[0].object : null;
    }

    /* in-headset HUD: a canvas panel pinned below the line of sight */
    buildVRHud() {
        const c = document.createElement('canvas');
        c.width = 1024; c.height = 256;
        this.hudCanvas = c;
        this.hudCtx = c.getContext('2d');
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        this.hudTex = tex;
        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(0.62, 0.155),
            new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, opacity: 0.96 })
        );
        mesh.position.set(0, -0.26, -0.85);
        mesh.renderOrder = 998;
        mesh.visible = false;
        this.camera.add(mesh);
        this.vrHud = mesh;
        this.drawVRHud();
    }

    drawVRHud() {
        const x = this.hudCtx, w = 1024, h = 256;
        x.clearRect(0, 0, w, h);
        x.fillStyle = 'rgba(6,12,22,0.78)';
        x.strokeStyle = 'rgba(100,255,218,0.55)';
        x.lineWidth = 3;
        const r = 22;
        x.beginPath();
        x.moveTo(r, 0); x.lineTo(w - r, 0); x.quadraticCurveTo(w, 0, w, r);
        x.lineTo(w, h - r); x.quadraticCurveTo(w, h, w - r, h);
        x.lineTo(r, h); x.quadraticCurveTo(0, h, 0, h - r);
        x.lineTo(0, r); x.quadraticCurveTo(0, 0, r, 0);
        x.fill(); x.stroke();

        x.fillStyle = '#64ffda';
        x.font = 'bold 54px Inter, Segoe UI, sans-serif';
        x.fillText(this.hudText.title, 34, 74);
        x.fillStyle = '#cfe3ff';
        x.font = '34px Inter, Segoe UI, sans-serif';
        x.fillText(this.hudText.sub, 34, 126);

        if (this.hudText.warn) {
            x.fillStyle = '#ff5a5a';
            x.font = 'bold 44px Inter, Segoe UI, sans-serif';
            x.fillText(this.hudText.warn, 34, 196);
        } else if (this.mode === 'ride') {
            const p = clamp(this.ride.time / this.ride.duration, 0, 1);
            x.fillStyle = 'rgba(255,255,255,0.16)';
            x.fillRect(34, 168, w - 68, 14);
            x.fillStyle = '#64ffda';
            x.fillRect(34, 168, (w - 68) * p, 14);
        }
        this.hudTex.needsUpdate = true;
    }

    setHud(title, sub, warn = '') {
        this.hudText = { title, sub, warn };
        this.drawVRHud();
    }

    /* ── input ──────────────────────────────────────────────────────── */

    /**
     * One look-around routine for mouse and touch. Where the rotation lands
     * depends on the mode: free flight turns the whole dolly, the ride turns
     * the head inside the cabin, and with the gyro on a drag only adds yaw so
     * you can spin the ship without spinning your chair.
     */
    lookDelta(dx, dy) {
        if (this.mode === 'ride') {
            this.lookYaw = clamp(this.lookYaw - dx, -2.6, 2.6);
            this.lookPitch = clamp(this.lookPitch - dy, -1.2, 1.2);
            return;
        }
        this.yaw -= dx;
        if (!this.gyroActive) this.pitch = clamp(this.pitch - dy, -1.35, 1.35);
        this.focusTween = null;
        this.applyLook();
    }

    bindInput() {
        const dom = this.renderer.domElement;
        dom.addEventListener('mousedown', e => {
            this.dragging = true;
            this.lastX = e.clientX; this.lastY = e.clientY;
            this.dragMoved = 0;
        });
        window.addEventListener('mouseup', e => {
            if (this.dragging && this.dragMoved < 5) this.pickAt(e.clientX, e.clientY);
            this.dragging = false;
        });
        window.addEventListener('mousemove', e => {
            if (!this.dragging) return;
            const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
            this.dragMoved += Math.abs(dx) + Math.abs(dy);
            this.lastX = e.clientX; this.lastY = e.clientY;
            this.lookDelta(dx * 0.0032, dy * 0.0032);
        });
        dom.addEventListener('wheel', e => {
            e.preventDefault();
            this.flySpeed = clamp(this.flySpeed * (e.deltaY > 0 ? 0.88 : 1.14), 4, 900);
            this.updateHudDom();
        }, { passive: false });

        // touch look for phone / standalone headset browsers
        dom.addEventListener('touchstart', e => {
            if (e.touches.length !== 1) return;
            this.dragging = true;
            this.touchMoved = 0;
            this.lastX = e.touches[0].clientX; this.lastY = e.touches[0].clientY;
        }, { passive: true });
        dom.addEventListener('touchmove', e => {
            if (!this.dragging || e.touches.length !== 1) return;
            const dx = e.touches[0].clientX - this.lastX, dy = e.touches[0].clientY - this.lastY;
            this.touchMoved += Math.abs(dx) + Math.abs(dy);
            this.lastX = e.touches[0].clientX; this.lastY = e.touches[0].clientY;
            this.lookDelta(dx * 0.005, dy * 0.005);
        }, { passive: true });
        dom.addEventListener('touchend', e => {
            const wasDrag = this.dragging;
            this.dragging = false;
            if (!wasDrag) return;
            // a tap, not a drag: in phone VR that is the only button there is;
            // on a plain phone screen it scans whatever is under the finger
            if (this.touchMoved < 8) {
                if (this.stereo) this.onPhoneTap();
                else if (e.changedTouches && e.changedTouches[0]) this.pickAt(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
            }
        });

        window.addEventListener('keydown', e => {
            this.keys.add(e.code);
            if (e.code === 'Space' && this.mode === 'ride') {
                e.preventDefault();
                this.ride.playing ? this.ride.pause() : this.ride.resume();
                this.updateHudDom();
            }
            if (e.code === 'ArrowRight' && this.mode === 'ride') this.ride.skipSegment();
            if (e.code === 'KeyR' && this.mode === 'ride') this.startRide();
            if (e.code === 'KeyC') this.setComfort(!this.comfort);
            if (e.code === 'KeyV') this.recenterView();
            if (e.code === 'Escape' && this.mode !== 'menu') this.toMenu();
        });
        window.addEventListener('keyup', e => this.keys.delete(e.code));
    }

    bindUI() {
        $('start-explore').onclick = () => this.startExplore();
        $('start-ride').onclick = () => this.startRide();
        const hunt = $('start-hunt');
        if (hunt) hunt.onclick = () => this.startMission('scan-hunt');
        $('enter-vr').onclick = () => this.enterVR();
        $('btn-menu').onclick = () => this.toMenu();
        $('btn-restart').onclick = () => this.startRide();
        $('btn-skip').onclick = () => { this.clearWarning(); this.ride.skipSegment(); };
        $('btn-pause').onclick = () => {
            this.ride.playing ? this.ride.pause() : this.ride.resume();
            this.updateHudDom();
        };
        $('opt-comfort').onchange = e => this.setComfort(e.target.checked);
        $('opt-scares').onchange = e => {
            this.scaresOn = e.target.checked;
            this.scares.setEnabled(this.scaresOn);
        };
        $('opt-intensity').oninput = e => {
            const v = parseFloat(e.target.value);
            this.scares.setIntensity(v);
            $('intensity-val').textContent = v < 0.34 ? 'Gentle' : v < 0.7 ? 'Standard' : 'Full';
        };
        $('opt-sound').onchange = e => this.audio.setMuted(!e.target.checked);
        $('opt-labels').onchange = e => this.system.setLabelsVisible(this.mode === 'explore' && e.target.checked);
        $('opt-orbits').onchange = e => this.system.setOrbitLinesVisible(e.target.checked);
        $('info-close').onclick = () => $('info-card').classList.remove('show');
        const ck = $('opt-cockpit');
        if (ck) ck.onchange = e => {
            this.cockpitOn = e.target.checked;
            if (this.mode === 'ride') {
                this.cockpit.setVisible(this.cockpitOn);
                document.body.classList.toggle('cockpit-on', this.cockpitOn);
            }
        };
        const bg = $('btn-gyro');
        if (bg) bg.onclick = () => (this.gyroOn ? this.disableGyro() : this.enableGyro());
        const bp = $('btn-phone-vr');
        if (bp) bp.onclick = () => (this.stereo ? this.exitPhoneVR() : this.enterPhoneVR());
        const bx = $('exit-phone-vr');
        if (bx) bx.onclick = () => this.exitPhoneVR();
        const br = $('btn-recenter');
        if (br) br.onclick = () => this.recenterView();
        const br2 = $('recenter-phone-vr');
        if (br2) br2.onclick = () => this.recenterView();
    }

    setComfort(v) {
        this.comfort = v;
        this.ride.comfort = v;
        $('opt-comfort').checked = v;
        this.toast(v ? 'Comfort mode ON — rolls damped, tunnel vignette active' : 'Comfort mode OFF');
    }

    onControllerSelect(controller) {
        const item = this.menuHit(controller);
        if (item) {
            this.vrMenu.visible = false;
            this.vrHud.visible = true;
            const action = item.userData.action;
            if (action === 'explore') this.startExplore();
            else if (action === 'scan-hunt') this.startMission('scan-hunt');
            else this.startRide();
            return;
        }
        if (this.mode === 'ride') {
            // trigger acts as "skip this section" inside the headset
            this.ride.skipSegment();
            this.audio.blip(760);
            return;
        }
        const m = new THREE.Matrix4().identity().extractRotation(controller.matrixWorld);
        const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
        const dir = new THREE.Vector3(0, 0, -1).applyMatrix4(m).normalize();
        this.raycaster.set(origin, dir);
        const hits = this.raycaster.intersectObjects(this.system.pickTargets, false);
        if (hits.length) this.showBody(hits[0].object.userData.bodyKey, true);
    }

    pickAt(cx, cy) {
        if (this.mode === 'ride') return;
        this.pointer.x = (cx / window.innerWidth) * 2 - 1;
        this.pointer.y = -(cy / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hits = this.raycaster.intersectObjects(this.system.pickTargets, false);
        if (hits.length) this.showBody(hits[0].object.userData.bodyKey, true);
    }

    showBody(key, travel) {
        const d = this.system.getInfo(key);
        if (!d) return;

        // During a mission a scan is an answer, not sightseeing. Route it to the
        // mission first; the info card and the fly-to would give the next clue
        // away and hand the player the answer they are being asked for.
        if (this.mode === 'mission') {
            MissionCore.input({ type: 'scan', key });
            this.audio.blip(660);
            return;
        }
        $('info-name').textContent = d.name;
        $('info-fact').textContent = d.fact;
        let stats =
            `<span>TYPE <b>${d.kind}</b></span>` +
            `<span>RADIUS <b>${d.radius.toFixed(1)} u</b></span>` +
            `<span>ORBIT <b>${d.distance}</b></span>` +
            `<span>TILT <b>${d.tiltDeg}</b></span>`;
        if (d.moons.length) stats += `<span>MOONS <b>${d.moons.join(' · ')}</b></span>`;
        $('info-stats').innerHTML = stats;
        $('info-card').classList.add('show');
        this.audio.blip(880);
        this.setHud(d.name.toUpperCase(), d.fact.slice(0, 64));
        if (travel) this.flyTo(key);
    }

    flyTo(key) {
        const d = this.system.getInfo(key);
        const target = this.system.worldPos(key, new THREE.Vector3());
        // moons are small — pull in much closer than for a planet
        const dist = d.radius * 4.2 + (d.kind.indexOf('MOON') === 0 ? 2.5 : 8);
        const from = this.dolly.position.clone();
        const dir = from.clone().sub(target).normalize();
        const to = target.clone().addScaledVector(dir, dist).add(new THREE.Vector3(0, d.radius * 0.5, 0));
        // key + dist kept so the tween can re-aim every frame — moons keep
        // orbiting while we fly, so a fixed destination would miss them
        this.focusTween = { from, to, target, t: 0, dur: 2.2, key, dist, radius: d.radius };
    }

    /* ── mode switching ─────────────────────────────────────────────── */

    /**
     * Return to the launcher.
     *
     * Escape and the menu button are both bound to this unconditionally, which
     * means a reflexive keypress used to destroy an in-progress run outright:
     * the core never learned the run ended, end() never fired, and nothing was
     * scored or shown. Confirm first, then abort cleanly so the run unwinds
     * through the same path as any other ending.
     */
    toMenu(options = {}) {
        if (this.mode === 'mission' && MissionCore.snapshot().running && !options.force) {
            const ok = window.confirm('Abandon this run? Your progress will not be scored.');
            if (!ok) return false;
            MissionCore.abort('player-left');
        }

        this.mode = 'menu';
        this.ride.stop();
        this.cockpit.setVisible(false);
        document.body.classList.remove('cockpit-on');
        this.autoFly = false;
        this.system.orbitRate = 1;
        this.system.setLabelsVisible(false);
        this.camera.fov = this.baseFov;
        this.camera.updateProjectionMatrix();
        $('mode-menu').classList.add('show');
        $('ride-hud').classList.remove('show');
        $('explore-hud').classList.remove('show');
        this.setHud('SPACEVERSE', this.entry === 'ride' ? 'Deep Space Ride — ready' : 'Free flight — ready');
        this.audio.setPad(0.0);
        this.audio.setEngine(0);
    }

    startExplore() {
        this.audio.init();
        this.mode = 'explore';
        this.ride.stop();
        this.cockpit.setVisible(false);
        this.autoFly = false;
        this.system.setOrbitLinesVisible($('opt-orbits').checked);
        this.system.setLabelsVisible($('opt-labels').checked);
        this.placeAtEarth();
        $('mode-menu').classList.remove('show');
        $('ride-hud').classList.remove('show');
        $('explore-hud').classList.add('show');
        this.camera.fov = this.baseFov;
        this.camera.updateProjectionMatrix();
        this.audio.setPad(0.5);
        this.setHud('FREE FLIGHT', 'Thumbstick to fly · trigger to scan a world');
        this.toast('Free flight: drag to look, W/S to fly, wheel for speed. Click a planet to scan it.');
    }

    /* ── missions ───────────────────────────────────────────────────── */

    async startMission(missionId) {
        this.audio.init();
        this.mode = 'mission';
        this.ride.stop();
        this.cockpit.setVisible(false);
        this.autoFly = false;
        this.system.setOrbitLinesVisible($('opt-orbits').checked);
        this.system.setLabelsVisible(false);   // finding it is the game
        this.placeAtEarth();
        $('mode-menu').classList.remove('show');
        $('ride-hud').classList.remove('show');
        $('explore-hud').classList.add('show');
        $('info-card').classList.remove('show');
        this.camera.fov = this.baseFov;
        this.camera.updateProjectionMatrix();
        this.audio.setPad(0.4);

        try {
            const meta = await MissionCore.run(missionId, { system: this.system });
            this.setHud(meta.title.toUpperCase(), meta.brief);
            this.toast(meta.brief);
        } catch (err) {
            console.error('[vr] mission failed to start:', err);
            this.toast('Could not start mission: ' + err.message);
            this.toMenu({ force: true });
        }
    }

    setMissionObjective(text) {
        this.missionObjective = text;
        const el = $('narration');
        if (!el) return;
        if (!text) { el.classList.remove('show'); return; }
        el.textContent = text;
        el.classList.add('show');
        this.setHud('SCAN HUNT', text.slice(0, 72));
    }

    setMissionProgress(done, total, missed) {
        const el = $('seg-index');
        if (el) el.textContent = `${done}/${total}`;
        this.missionProgress = { done, total, missed };
    }

    flashMission(kind) {
        // Reuses the ride's alert banner rather than adding a second one. Same
        // element, same classes as onScareEvent, so there is one place that
        // decides what an alert looks like.
        const warn = $('warning');
        if (!warn) return;
        clearTimeout(this._warnT);
        const ok = kind === 'correct';
        warn.textContent = ok ? '✅ TARGET CONFIRMED' : '❌ WRONG TARGET';
        warn.classList.remove('hit', 'ok');
        warn.classList.add('show', ok ? 'ok' : 'hit');
        this._warnT = setTimeout(() => this.clearWarning(), 900);
    }

    onMissionResult(result) {
        if (result.abandoned) return;

        const headline = result.won ? 'MISSION COMPLETE' : 'MISSION FAILED';
        const detail = result.won
            ? `${result.facts.found}/${result.facts.targets} found`
            : (result.reason === 'timeout' ? 'Out of time' : 'Run ended');

        this.setHud(headline, detail);
        // The score screen never waits on the network. If the run could not be
        // saved the player is told plainly rather than being shown a number that
        // quietly went nowhere.
        const saved = result.saved === false ? ' (not saved — will retry)' : '';
        const score = typeof result.score === 'number' ? ` · ${result.score} XP` : '';
        this.toast(`${headline}: ${detail}${score}${saved}`);
        $('ride-done').classList.add('show');
        setTimeout(() => $('ride-done').classList.remove('show'), 4000);
    }

    startRide() {
        this.audio.init();
        this.mode = 'ride';
        this.system.setOrbitLinesVisible(false);
        this.system.setLabelsVisible(false);
        $('mode-menu').classList.remove('show');
        $('explore-hud').classList.remove('show');
        $('ride-hud').classList.add('show');
        $('info-card').classList.remove('show');
        this.audio.setPad(0.18);
        this.ride.prepare();
        this.ride.start();
        this.lookYaw = 0; this.lookPitch = 0;
        if (this.gyroActive) this.gyro.recenter();
        this.cockpit.reset();
        this.cockpit.setSegment('IGNITION', 'Departing Earth orbit', 0, this.ride.segments.length,
            this.ride.segments.map(s => ({ title: s.title, dur: s.dur })));
        this.cockpit.setVisible(this.cockpitOn);
        document.body.classList.toggle('cockpit-on', this.cockpitOn);
        if (this.stereo) this.vrHud.visible = false;
        this.toast('VR DEEP SPACE RIDE — you are in the pilot seat. Drag / move your phone to look around, V recentres. Space pauses, → skips, C comfort.');
    }

    onSegment(s, i, n) {
        this.clearWarning();
        this.cockpit.setSegment(s.title, s.subtitle, i, n,
            this.ride.segments.map(x => ({ title: x.title, dur: x.dur })));
        $('seg-title').textContent = s.title;
        $('seg-sub').textContent = s.subtitle;
        $('seg-index').textContent = `${i + 1}/${n}`;
        this.setHud(s.title, s.subtitle);
        this.audio.blip(440 + i * 40);
    }

    onRideProgress(p) {
        $('ride-bar-fill').style.width = (p * 100).toFixed(1) + '%';
        const speed = Math.round(this.ride.speedNorm * 42000 + 1800);
        $('ride-speed').textContent = speed.toLocaleString() + ' km/h';
        if (this.renderer.xr.isPresenting && (this.hudTick = (this.hudTick || 0) + 1) % 12 === 0) this.drawVRHud();
    }

    onRideFinish() {
        this.setHud('MISSION COMPLETE', 'Earth orbit reached');
        this.narrate('Ride complete. You covered 9 billion kilometres and survived four near misses.');
        $('ride-done').classList.add('show');
        this.audio.setEngine(0);
        setTimeout(() => $('ride-done').classList.remove('show'), 6000);
    }

    narrate(text) {
        if (this.cockpit) this.cockpit.setNarration(text);
        const el = $('narration');
        el.textContent = text;
        el.classList.add('show');
        clearTimeout(this._narrT);
        this._narrT = setTimeout(() => el.classList.remove('show'), 5200);
        this.setHud(this.hudText.title, text.slice(0, 72));
    }

    onScareEvent(e) {
        const warn = $('warning');
        clearTimeout(this._warnT);
        if (e.type === 'incoming') {
            this.cockpit.setAlert(e.label, 'warn');
            warn.textContent = '⚠ ' + e.label;
            warn.classList.remove('hit', 'ok');
            warn.classList.add('show');
            this.setHud(this.hudText.title, this.hudText.sub, e.label);
            // safety net: if the rock is cleared by a seek before it arrives,
            // the alert must not stay on screen forever
            this._warnT = setTimeout(() => this.clearWarning(), 6000);
        } else {
            const hit = e.type === 'hit';
            this.cockpit.setAlert(hit ? 'HULL BREACH' : 'NEAR MISS', hit ? 'hit' : 'ok');
            warn.textContent = hit ? '💥 HULL BREACH' : '✅ NEAR MISS';
            warn.classList.add('show', hit ? 'hit' : 'ok');
            this.setHud(this.hudText.title, this.hudText.sub, hit ? 'HULL STRESSED' : 'NEAR MISS');
            this._warnT = setTimeout(() => this.clearWarning(), 2200);
        }
    }

    clearWarning() {
        clearTimeout(this._warnT);
        if (this.cockpit) this.cockpit.setAlert('');
        $('warning').classList.remove('show', 'hit', 'ok');
        this.setHud(this.hudText.title, this.hudText.sub, '');
    }

    toast(msg) {
        const t = $('toast');
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(this._toastT);
        this._toastT = setTimeout(() => t.classList.remove('show'), 5200);
    }

    updateHudDom() {
        $('fly-speed').textContent = Math.round(this.flySpeed) + ' u/s';
        $('btn-pause').textContent = this.ride.playing ? '⏸ Pause' : '▶ Resume';
    }

    /* ── free flight ────────────────────────────────────────────────── */

    flyUpdate(dt) {
        if (this.focusTween) {
            const f = this.focusTween;
            f.t += dt;
            const p = clamp(f.t / f.dur, 0, 1);
            const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            if (f.key) {   // chase the live position — moons move mid-tween
                this.system.worldPos(f.key, f.target);
                const dir = f.from.clone().sub(f.target).normalize();
                f.to.copy(f.target).addScaledVector(dir, f.dist).add(new THREE.Vector3(0, f.radius * 0.5, 0));
            }
            this.dolly.position.lerpVectors(f.from, f.to, e);
            const dir = f.target.clone().sub(this.dolly.position).normalize();
            const wantYaw = Math.atan2(-dir.x, -dir.z);
            const wantPitch = Math.asin(clamp(dir.y, -1, 1));
            this.yaw += (wantYaw - this.yaw) * Math.min(1, dt * 3);
            this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 3);
            this.applyLook();
            if (p >= 1) this.focusTween = null;
            return;
        }

        const v = new THREE.Vector3();
        if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) v.z -= 1;
        if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) v.z += 1;
        if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) v.x -= 1;
        if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) v.x += 1;
        if (this.keys.has('KeyQ')) v.y -= 1;
        if (this.keys.has('KeyE')) v.y += 1;
        if (this.autoFly) v.z -= 1;   // phone VR: tap toggles "fly where I look"

        // headset thumbsticks: left = translate, right = snap turn
        if (this.xrSession) {
            for (const src of this.xrSession.inputSources) {
                const g = src.gamepad;
                if (!g || g.axes.length < 4) continue;
                const ax = g.axes[2], ay = g.axes[3];
                if (src.handedness === 'left') {
                    if (Math.abs(ax) > 0.15) v.x += ax;
                    if (Math.abs(ay) > 0.15) v.z += ay;
                } else if (src.handedness === 'right') {
                    if (Math.abs(ay) > 0.6) v.y -= Math.sign(ay);
                    if (Math.abs(ax) > 0.75 && !this._snapLock) {
                        this.yaw -= Math.sign(ax) * Math.PI / 6;   // 30° snap turn
                        this.applyLook();
                        this._snapLock = true;
                        setTimeout(() => { this._snapLock = false; }, 320);
                    }
                }
            }
        }

        if (v.lengthSq() > 0) {
            const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 4 : 1;
            v.normalize().multiplyScalar(this.flySpeed * boost * dt);
            // in a headset or with the phone gyro, fly where the visor points;
            // on desktop, where the dolly points
            const q = (this.renderer.xr.isPresenting || this.gyroActive)
                ? this.camera.getWorldQuaternion(new THREE.Quaternion())
                : this.dolly.quaternion;
            v.applyQuaternion(q);
            this.dolly.position.add(v);
            this.audio.setEngine(0.25);
        } else {
            this.audio.setEngine(0.05);
        }

        // nearest-body readout
        let best = null, bestD = Infinity;
        const cp = this.camera.getWorldPosition(new THREE.Vector3());
        for (const b of BODIES) {
            const d = this.system.worldPos(b.key, new THREE.Vector3()).distanceTo(cp) - b.radius;
            if (d < bestD) { bestD = d; best = b; }
        }
        if (best) {
            $('near-body').textContent = best.name;
            $('near-dist').textContent = Math.max(0, bestD).toFixed(0) + ' u';
            if (this.mode === 'explore' && this.renderer.xr.isPresenting &&
                (this.hudTick = (this.hudTick || 0) + 1) % 30 === 0) {
                this.setHud('FREE FLIGHT', `${best.name} · ${Math.max(0, bestD).toFixed(0)} u away`);
            }
        }
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        if (this.composer) this.composer.setSize(window.innerWidth, window.innerHeight);
        if (this.stereo) this.stereoEffect.setSize(window.innerWidth, window.innerHeight);
    }

    /* ── cockpit instruments: live data from the scene ─────────────── */

    /** hazards near the ship, in ship-local x/z (right / forward-negative) */
    radarContacts() {
        const out = [];
        if (!this.scares || !this.scares.actors) return out;
        const tmp = this._radarTmp || (this._radarTmp = new THREE.Vector3());
        for (const a of this.scares.actors) {
            tmp.copy(a.mesh.position);
            this.dolly.worldToLocal(tmp);
            if (Math.abs(tmp.x) > 90 || Math.abs(tmp.z) > 90) continue;
            out.push({ x: tmp.x, z: tmp.z, hit: !!(a.spec && a.spec.hit) });
        }
        return out;
    }

    /** where the current segment's focus body sits on the canopy HUD */
    hudTarget() {
        const seg = this.ride.segments && this.ride.segments[this.ride.segIndex];
        if (!seg || !seg.focus || seg.focus === 'ahead' || !this.system.bodies.has(seg.focus)) return null;
        const p = this.system.worldPos(seg.focus, this._hudTmp || (this._hudTmp = new THREE.Vector3()));
        const dist = p.distanceTo(this.dolly.position);
        // project into the ship's own frame (the HUD is glued to the canopy,
        // not to the head, so it uses the dolly, not the camera)
        const local = p.clone(); this.dolly.worldToLocal(local);
        if (local.z >= -0.5) return { visible: true, x: local.x > 0 ? 1.2 : -1.2, y: 0, name: seg.focus, dist };
        const f = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
        const ndcY = -local.y / (local.z * f), ndcX = -local.x / (local.z * f * this.camera.aspect);
        return { visible: true, x: ndcX * 1.1, y: ndcY * 1.1, name: seg.focus, dist };
    }

    /** compass heading of the ship's nose in the ecliptic plane */
    shipHeading() {
        const f = this._hdgTmp || (this._hdgTmp = new THREE.Vector3());
        f.set(0, 0, -1).applyQuaternion(this.dolly.quaternion);
        return Math.atan2(f.x, -f.z);
    }

    /* ── frame ──────────────────────────────────────────────────────── */

    loop() {
        // don't burn a core animating a scene nobody is looking at
        if (document.hidden && !this.renderer.xr.isPresenting) { this.clock.getDelta(); return; }
        const dt = Math.min(0.05, this.clock.getDelta());
        const camPos = this.camera.getWorldPosition(this._camPos || (this._camPos = new THREE.Vector3()));
        this.system.update(dt, camPos);

        if (this.mode === 'ride') this.ride.update(dt);
        else this.flyUpdate(dt);

        this.updateHead(dt);
        this.gazeUpdate(dt);
        if (this.cockpit.visible) {
            this.cockpit.update(dt, {
                speedNorm: this.ride.speedNorm || 0,
                speedKmh: (this.ride.speedNorm || 0) * 42000 + 1800,
                progress: this.ride.total ? this.ride.time / this.ride.total : 0,
                time: this.ride.time, total: this.ride.total || 1,
                paused: !this.ride.playing,
                bank: this.ride._bank || 0, roll: this.ride._roll || 0,
                comfort: this.comfort, scares: this.scaresOn,
                radar: this.radarContacts(),
                target: this.hudTarget(),
                heading: this.shipHeading()
            });
        }

        // The mission core owns no frame loop of its own on purpose: inside an
        // immersive session window.requestAnimationFrame never fires, so a core
        // that pumped itself would freeze every mission the moment a player put
        // on a headset. This is that pump.
        if (this.mode === 'mission') MissionCore.tick(dt);

        this.scares.update(dt, camPos);
        if (this.mode !== 'ride') this.scares.setVignette(0);

        // controller hover feedback on the in-world menu
        if (this.vrMenu && this.vrMenu.visible && this.controllers) {
            const hovered = this.controllers.map(c => this.menuHit(c)).filter(Boolean);
            this.vrMenuItems.forEach(it => {
                const on = hovered.indexOf(it) !== -1;
                it.scale.setScalar(it.scale.x + ((on ? 1.08 : 1) - it.scale.x) * 0.2);
            });
        }

        // XR sessions render per-eye through three's own pipeline — the
        // composer only serves the flat screen
        if (this.renderer.xr.isPresenting) this.renderer.render(this.scene, this.camera);
        else if (this.stereo) this.stereoEffect.render(this.scene, this.camera);
        else if (this.composer) this.composer.render();
        else this.renderer.render(this.scene, this.camera);
    }

    /* ── QA helpers (window.__vr) ───────────────────────────────────── */
    qaSeek(sec) { if (this.mode !== 'ride') this.startRide(); this.clearWarning(); this.ride.seek(sec); }
    qaState() {
        return {
            mode: this.mode,
            seg: this.ride.segments ? (this.ride.segments[this.ride.segIndex] || {}).id : null,
            time: +this.ride.time.toFixed(2),
            total: this.ride.total,
            speedNorm: +(this.ride.speedNorm || 0).toFixed(3),
            actors: this.scares.actors.length,
            pos: this.dolly.position.toArray().map(n => +n.toFixed(1)),
            xr: this.renderer.xr.isPresenting,
            stereo: this.stereo, gyro: this.gyroActive, cockpit: this.cockpit ? this.cockpit.visible : false
        };
    }
}

const app = new VRApp();
app.init().catch(e => {
    console.error('[vr] init failed', e);
    $('loading').style.display = 'none';
    $('error').style.display = 'block';
    $('error-msg').textContent = e && e.message ? e.message : String(e);
});

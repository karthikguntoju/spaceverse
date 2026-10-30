/**
 * VR Solar System — entry point.
 *
 * Three experiences share one renderer, but each has its own entry point and the
 * launcher only ever offers the one you arrived for:
 *   • EXPLORE — free flight around a live, textured solar system  (/vr-solar-system)
 *   • RIDE    — "VR Deep Space Ride", a scripted roller-coaster    (/vr-ride)
 *   • DODGE   — hands-free arcade practice                        (/games/asteroid-dodge)
 *
 * Works on a flat screen (mouse + WASD) and in a headset (WebXR, thumbstick
 * locomotion, controller ray picking, hand-tracking pinch, haptics). The camera
 * always lives inside a dolly group; nothing ever writes camera.position directly,
 * which is what makes the same code valid in an immersive session.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SolarSystem, BODIES } from './solar-system.js?v=20261022-5';
import { SpaceAudio } from './audio.js';
import { ScareDirector } from './scares.js?v=20261022-5';
import { Ride } from './ride.js';
import { GyroLook } from './gyro.js?v=20261011-1';
import { Cockpit } from './cockpit.js?v=20261015-4';
import { RemoteInput } from './remote-input.js?v=20261013-1';
import { DwellSelector, GazeControls } from './gaze-controls.js?v=20261015-3';
import { ScreenAwake } from './screen-awake.js?v=20261014-2';
import { PhoneStereoEffect, PHONE_UI_LAYER, setPhoneUILayer, phoneLensMask } from './phone-stereo.js?v=20261015-1';
import { DodgeGame } from './dodge-game.js?v=20261015-3';
import MissionCore from '../game/core.js';
import { createScanHunt } from '../game/missions/scan-hunt.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

class VRApp {
    constructor() {
        this.mode = 'menu';
        this.entry = /^\/games\/asteroid-dodge\/?$/i.test(location.pathname) ? 'dodge' : (location.pathname.indexOf('vr-ride') !== -1 ||
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
        this.voiceOn = true;
        this.baseFov = 62;
        this.hudDirty = true;
        this.hudText = { title: 'SPACEVERSE', sub: 'Solar system', warn: '' };
        this.presentedMissionResults = new WeakSet();

        this.activeBodyKey = 'earth';
        this._tourIdx = 3; // earth
        this._freeSpeedNorm = 0;
        this._freeBank = 0;
        this._prevYaw = 0;
        this.exploreCockpitOn = false;

        this.lookYaw = 0;
        this.lookPitch = 0;
        this.gyro = new GyroLook();
        this.gyro.onFirstReading = () => {
            document.body.classList.remove('no-gyro');
            this.applyLook();
            this.updatePhoneButtons();
            const toast = $('toast');
            if (toast && toast.textContent.startsWith('Gyro look is waiting')) toast.classList.remove('show');
        };
        this.gyroOn = false;
        this.stereo = false;
        this.screenAwake = new ScreenAwake({ onChange: (state, message) => {
            document.querySelectorAll('[data-phone-awake]').forEach(status => {
                status.textContent = message;
                status.title = message;
                status.classList.toggle('awake-warning', state === 'unavailable');
            });
        } });
        this.autoFly = false;
        this.gaze = new DwellSelector();
        this.gazeOptionsOpen = false;
        this.gazeMenuOpen = false;
        this.cockpitOn = true;
        const mobileUA = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        this.isTouch = (navigator.maxTouchPoints || 0) > 0 &&
            (window.matchMedia('(pointer: coarse)').matches || mobileUA);
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
        this.renderer.setPixelRatio(this.renderPixelRatio());

        if (quality === 'high') {
            this.composer = new EffectComposer(this.renderer);
            this.composer.setPixelRatio(this.renderPixelRatio());
            this.composer.setSize(window.innerWidth, window.innerHeight);
            this.composer.addPass(new RenderPass(this.scene, this.camera));
            this.bloomPass = new UnrealBloomPass(
                new THREE.Vector2(window.innerWidth, window.innerHeight), 0.45, 0.5, 0.85);
            this.composer.addPass(this.bloomPass);
            this.composer.addPass(new OutputPass());
        }

        this.system = new SolarSystem(this.scene, { quality });
        await this.system.build(msg => this.setStatus(msg));
        this.system.setLabelsVisible(false);

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
                const want = THREE.MathUtils.clamp(fov + 12 + spd * 2, 78, 96);
                if (Math.abs(this.camera.fov - want) > 0.05) {
                    this.camera.fov += (want - this.camera.fov) * 0.05;
                    this.camera.updateProjectionMatrix();
                }
            }
        };

        this.cockpit = new Cockpit({ dolly: this.dolly, camera: this.camera, renderer: this.renderer });
        this.stereoEffect = new PhoneStereoEffect(this.renderer);
        try {
            const saved = localStorage.getItem('spaceverse.cardboard-layout.v2');
            const previous = JSON.parse(localStorage.getItem('spaceverse.cardboard-layout.v1'));
            this.stereoEffect.setViewerSettings(saved ? JSON.parse(saved) : { spacing: previous?.spacing, size: 0.96, shape: 'wide' });
        }
        catch (_) { /* missing, unavailable or invalid saved preferences */ }
        this.dodge = new DodgeGame(this.scene);
        const pauseDodge = () => { if (this.mode === 'dodge') this.dodge.run.pause(); };
        window.addEventListener('blur', pauseDodge);
        document.addEventListener('visibilitychange', () => { if (document.hidden) pauseDodge(); });
        this.buildReticle();

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
        this.buildVRInfoPanel();
        this.buildVRMenu();
        this.buildControllers();
        this.remote = new RemoteInput({
            canvas: this.renderer.domElement,
            active: () => this.mode !== 'menu' && !this.renderer.xr.isPresenting && !document.hidden,
            onAction: action => this.remoteAction(action),
            onSuspend: () => { this.keys.clear(); this.dragging = false; this.autoFly = false; }
        });
        this.bindInput();
        this.bindUI();

        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();

        this.placeAtEarth();
        window.addEventListener('resize', () => this.onResize());

        this.renderer.setAnimationLoop((t, frame) => this.loop(frame));

        this.checkXR();
        this.checkPhone();
        $('loading').style.display = 'none';
        $('mode-menu').classList.add('show');
        $('mode-menu').classList.add(`only-${this.entry}`);

        window.__vr = this;
        this.missionCore = MissionCore;
    }

    setStatus(msg) {
        const el = $('load-status');
        if (el) el.textContent = msg;
    }

    renderPixelRatio() {
        if (this.quality === 'low') return 1;
        const budget = this.isTouch ? (this.stereo ? 5500000 : 6500000) : 8000000;
        const area = Math.max(1, window.innerWidth * window.innerHeight);
        return Math.max(1, Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(budget / area)));
    }

    /* ── AI Mission Control Voice Narration (Web Speech API) ────────── */

    speak(text, cancelPrev = true) {
        if (!this.voiceOn || (this.audio && this.audio.muted)) return;
        if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return;
        try {
            if (cancelPrev) window.speechSynthesis.cancel();
            const clean = String(text).replace(/[✅❌⚠💥🛸🪐☄️]/g, '').trim();
            if (!clean) return;
            const u = new SpeechSynthesisUtterance(clean);
            u.rate = 1.04;
            u.pitch = 0.96;
            u.volume = 0.85;
            const voices = window.speechSynthesis.getVoices();
            if (voices && voices.length) {
                const pref = voices.find(v => /en/i.test(v.lang) && /(google|natural|aria|guy|siri|daniel)/i.test(v.name))
                    || voices.find(v => /en/i.test(v.lang));
                if (pref) u.voice = pref;
            }
            window.speechSynthesis.speak(u);
        } catch (_) { /* speech synthesis blocked or unsupported */ }
    }

    stopSpeech() {
        try {
            if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
                window.speechSynthesis.cancel();
            }
        } catch (_) {}
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
        const pitch = this.gyroActive ? 0 : this.pitch;
        this.dolly.quaternion.setFromEuler(new THREE.Euler(pitch, this.yaw, 0, 'YXZ'));
    }

    get gyroActive() {
        return this.gyroOn && this.gyro.enabled && this.gyro.hasReading && !this.renderer.xr.isPresenting;
    }

    /* ── phone VR: gyro look + Cardboard stereo ─────────────────────── */

    checkPhone() {
        const wrap = $('phone-row');
        if (!wrap) return;
        if (!this.isTouch) { wrap.style.display = 'none'; return; }
        wrap.style.display = 'flex';
        const flight = $('phone-flight');
        if (flight) flight.style.display = 'flex';
        const reason = GyroLook.blockedReason;
        const note = $('phone-note');
        if (note) {
            note.textContent = reason
                ? '⚠ ' + reason
                : `Use Gyro look for a normal phone view. Phone VR starts ${this.entry === 'dodge' ? 'Asteroid Dodge' : this.entry === 'ride' ? 'the ride' : 'free flight'} in side-by-side view; rotate to landscape before using a viewer.`;
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
        this.gyro.recenter();
        this.applyLook();
        this.updatePhoneButtons();
        if (!silent) this.toast('Gyro look is waiting for motion data. Move your phone; ⟲ recenters once tracking starts.');
        return true;
    }

    disableGyro() {
        if (!this.gyroOn) return;
        this.gyro.disable();
        this.gyroOn = false;
        if (this.stereo) document.body.classList.add('no-gyro');
        this.camera.quaternion.identity();
        this.applyLook();
        this.updatePhoneButtons();
        this.toast('Gyro look OFF');
    }

    recenterView() {
        if (this.mode === 'dodge') this.dodge.run.pause();
        if (this.gyroActive) this.gyro.recenter();
        this.lookYaw = 0; this.lookPitch = 0;
        this.updateHead(0);
        if (this.gazeControls) {
            this.gazeControls.anchor(this.camera);
            if (this.gyroActive) this.gazeControls.group.quaternion.identity();
        }
        this.gaze.reset(true);
        this.audio.blip(700);
        this.toast('View recentred');
    }

    async enterPhoneVR() {
        if (this.renderer.xr.isPresenting) return;
        this.audio.init();
        const gyroRequest = this.enableGyro(true);
        this.stereo = true;
        if (this.mode === 'dodge') this.dodge.run.pause();
        this.screenAwake.start();
        document.body.classList.add('in-cardboard');
        this.updateCardboardLayout();
        if (this.mode === 'menu') {
            if (this.entry === 'ride') this.startRide();
            else if (this.entry === 'dodge') this.startDodge();
            else this.startExplore();
        }
        const el = document.documentElement;
        let fullscreenRequest = Promise.resolve();
        try {
            if (el.requestFullscreen) fullscreenRequest = Promise.resolve(el.requestFullscreen({ navigationUI: 'hide' })).catch(() => {});
            else if (el.webkitRequestFullscreen) fullscreenRequest = Promise.resolve(el.webkitRequestFullscreen()).catch(() => {});
        } catch (e) { /* iOS Safari has no fullscreen for pages */ }
        await gyroRequest;
        await fullscreenRequest;
        if (!this.stereo) return;
        try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); }
        catch (e) { /* not lockable here */ }
        if (!this.stereo) return;
        this.reticle.visible = true;
        this.gazeOptionsOpen = false;
        this.gaze.reset();
        this.updateHead(0);
        this.gazeControls.anchor(this.camera);
        this.vrHud.visible = this.mode !== 'ride';
        this.audio.init();
        this.onResize();
        this.updatePhoneButtons();
        clearTimeout(this._gyroWarnTimer);
        if (!this.gyroOn) document.body.classList.add('no-gyro');
        else this._gyroWarnTimer = setTimeout(() => {
            if (this.stereo && !this.gyroActive) document.body.classList.add('no-gyro');
        }, 4000);
        const gyroMsg = this.gyroOn ? '' : ' (no gyro — drag to look)';
        this.toast('Phone VR' + gyroMsg + ' — put the phone in your viewer. ' +
            (this.entry !== 'explore'
                ? 'Look well down, then hold gaze on MENU to open controls.'
                : 'Look well down and hold gaze on MENU for controls. Hold gaze on a world to scan it.'));
    }

    exitPhoneVR() {
        if (!this.stereo) return;
        this.stereo = false;
        this.screenAwake.stop();
        if (this.mode === 'dodge') this.dodge.run.pause();
        this.autoFly = false;
        this.gazeOptionsOpen = false;
        this.gazeMenuOpen = false;
        this.gazeControls.group.visible = false;
        for (const ui of [this.reticle, this.vrHud, this.vrInfoPanel, this.gazeControls.group]) {
            if (ui) setPhoneUILayer(ui, false);
        }
        this.gaze.reset();
        clearTimeout(this._gyroWarnTimer);
        document.body.classList.remove('in-cardboard', 'no-gyro');
        try {
            if (document.fullscreenElement && document.exitFullscreen)
                Promise.resolve(document.exitFullscreen()).catch(() => {});
        } catch (e) { /* ignore */ }
        try {
            if (screen.orientation && screen.orientation.unlock)
                Promise.resolve(screen.orientation.unlock()).catch(() => {});
        } catch (e) { /* ignore */ }
        this.reticle.visible = false;
        this.vrHud.visible = false;
        if (this.vrInfoPanel) this.vrInfoPanel.visible = false;
        this.renderer.setScissorTest(false);
        this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
        this.onResize();
        this.updatePhoneButtons();
    }

    updatePhoneButtons() {
        const g = $('btn-gyro'), p = $('btn-phone-vr'), f = $('btn-phone-fly');
        if (g) g.textContent = this.gyroOn
            ? (this.gyro.hasReading ? '🧭 Gyro look: ON' : '🧭 Gyro look: waiting…')
            : '🧭 Gyro look';
        if (p) p.textContent = this.stereo ? '📱 Exit Phone VR' : '📱 Phone VR (Cardboard)';
        if (f) {
            f.textContent = this.autoFly ? '■ Stop flying' : '▶ Fly forward';
            f.setAttribute('aria-pressed', String(this.autoFly));
        }
        const ckBtn = $('btn-cockpit-fly');
        if (ckBtn) ckBtn.classList.toggle('on', this.exploreCockpitOn);
    }

    buildReticle() {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.006, 0.009, 32),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false, toneMapped: false })
        );
        ring.position.set(0, 0, -0.6);
        ring.renderOrder = 999;
        ring.visible = false;
        const fill = new THREE.Mesh(
            new THREE.RingGeometry(0.006, 0.009, 64, 1, Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: 0x64ffda, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
        );
        fill.geometry.setDrawRange(0, 0);
        fill.renderOrder = 1000;
        const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0018, 16),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
        dot.renderOrder = 1001;
        ring.add(dot);
        ring.add(fill);
        this.reticleFill = fill;
        this.camera.add(ring);
        this.reticle = ring;
        this.gazeControls = new GazeControls(this.dolly);
    }

    gazeOptions() {
        if (!this.gazeMenuOpen) return [{ action: 'menu', title: 'MENU', hint: 'Hold gaze to open' }];
        if (this.gazeOptionsOpen) {
            const options = [{ action: 'back', title: 'BACK', hint: 'Return to controls' }];
            if (this.mode === 'ride') {
                options.push({ action: 'restart', title: 'RESTART RIDE' });
                options.push({ action: 'skip-seg', title: 'SKIP SECTION' });
            } else if (this.entry === 'dodge') {
                options.push({ action: 'dodge', title: 'RESTART GAME' });
            } else {
                options.push({ action: 'next-world', title: 'NEXT WORLD', hint: 'Warp to next planet' });
                options.push({ action: 'low-orbit', title: 'LOW ORBIT SKIM', hint: 'Close terminator pass' });
                options.push({ action: 'toggle-cockpit', title: this.exploreCockpitOn ? 'HIDE COCKPIT' : '3D COCKPIT' });
                if (this.mode !== 'mission' || !MissionCore.snapshot().running) {
                    options.push(this.mode === 'mission'
                        ? { action: 'explore', title: 'EXPLORE' }
                        : { action: 'scan-hunt', title: 'SCAN HUNT', hint: '90 seconds · 5 worlds' });
                }
            }
            options.push({ action: 'exit', title: 'EXIT PHONE VR', hint: 'Return to phone screen' });
            return options;
        }
        const title = this.mode === 'dodge' ? this.dodgeButtonTitle() : this.mode === 'ride'
            ? (this.ride.time >= this.ride.total ? 'REPLAY RIDE' : this.ride.playing ? 'PAUSE RIDE' : 'RESUME RIDE')
            : this.autoFly ? 'STOP FLYING' : 'FLY FORWARD';
        return [
            { action: 'primary', title },
            { action: 'options', title: 'OPTIONS' },
            { action: 'recenter', title: 'RECENTRE', hint: 'Set forward direction' },
            { action: 'close', title: 'CLOSE MENU', hint: 'Return to your view' }
        ];
    }

    gazeAction(action) {
        if (action === 'menu') {
            this.gazeMenuOpen = true;
            this.gazeOptionsOpen = false;
            this.autoFly = false;
            this.focusTween = null;
            if (this.mode === 'dodge') this.dodge.run.pause();
            if (this.mode === 'ride') this.ride.pause();
            this.gaze.reset(true);
            return;
        }
        if (action === 'close') { this.closeGazeMenu(); return; }
        if (action === 'primary') {
            if (this.mode === 'ride' && this.ride.time >= this.ride.total) this.startRide();
            else this.onPhoneTap();
            this.closeGazeMenu();
            return;
        }
        if (action === 'recenter') { this.closeGazeMenu(); this.recenterView(); return; }
        if (action === 'exit') { this.exitPhoneVR(); return; }
        if (action === 'next-world') { this.closeGazeMenu(); this.cycleBody(1); return; }
        if (action === 'low-orbit') { this.closeGazeMenu(); this.skimBody(this.activeBodyKey || 'earth'); return; }
        if (action === 'toggle-cockpit') { this.closeGazeMenu(); this.toggleExploreCockpit(); return; }
        if (action === 'skip-seg') { this.closeGazeMenu(); this.ride.skipSegment(); this.ride.resume(); return; }
        this.autoFly = false;
        this.focusTween = null;
        if (action === 'options' && this.mode === 'ride') this.ride.pause();
        if (action === 'options' && this.mode === 'dodge') this.dodge.run.pause();
        this.gazeOptionsOpen = action === 'options';
        if (action === 'restart') this.startRide();
        if (action === 'explore') this.startExplore();
        if (action === 'scan-hunt') this.startMission('scan-hunt');
        if (action === 'dodge') this.startDodge();
        this.updatePhoneButtons();
        this.updateHudDom();
        this.gaze.reset(true);
    }

    closeGazeMenu() {
        this.gazeMenuOpen = false;
        this.gazeOptionsOpen = false;
        this.gaze.reset(true);
    }

    gazeUpdate(dt) {
        const active = this.stereo && !this.renderer.xr.isPresenting && this.mode !== 'menu';
        for (const ui of [this.reticle, this.vrHud, this.vrInfoPanel, this.gazeControls.group]) {
            if (ui) setPhoneUILayer(ui, active);
        }
        this.gazeControls.group.visible = active;
        this.reticle.visible = active;
        if (!active || document.hidden || !document.hasFocus()) {
            this.gazeControls.group.visible = false;
            this.gaze.reset();
            this.reticleFill.geometry.setDrawRange(0, 0);
            return;
        }
        if (this.gazeMenuOpen && this.gazeControls.lookPitch(this.camera) > -20 * Math.PI / 180) this.closeGazeMenu();
        this.gazeControls.updateDock(this.camera, this.gazeMenuOpen);
        this.gazeControls.setOptions(this.gazeOptions());
        setPhoneUILayer(this.gazeControls.group, true);
        this.pointer.set(0, 0);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const control = this.gazeControls.hit(this.raycaster, PHONE_UI_LAYER);
        const world = !control && !this.gazeMenuOpen && this.mode !== 'ride' && this.mode !== 'dodge'
            ? this.raycaster.intersectObjects(this.system.pickTargets, false)[0] : null;
        const action = control?.object.userData.action;
        const body = world?.object.userData.bodyKey;
        setPhoneUILayer(this.reticle, !world);
        const key = action ? `ui:${action}` : body ? `body:${body}` : null;
        const { progress, activate } = this.gaze.update(key, dt);
        this.gazeControls.highlight(control?.object);
        this.vrHud.visible = this.mode !== 'ride' && !control && !this.gazeMenuOpen;
        this.reticleFill.geometry.setDrawRange(0, Math.floor(progress * 64) * 6);
        const distance = clamp(control?.distance || world?.distance || 1.6, 0.2, 1000);
        this.reticle.position.z = -distance;
        this.reticle.scale.setScalar(distance / 0.6);
        if (activate) {
            this.audio.blip(920);
            if (action) this.gazeAction(action);
            else this.showBody(body, this.mode === 'explore');
        }
    }

    onPhoneTap() {
        if (this.mode === 'dodge') {
            const run = this.dodge.run;
            ['playing', 'countdown'].includes(run.state) ? run.pause() : run.play();
            this.updateDodgeHud();
        } else if (this.mode === 'ride') {
            // If an asteroid hazard is incoming, tapping fires the plasma deflector turret!
            if (this.scares && this.scares.actors.length > 0 && this.fireTurret()) return;
            this.ride.playing ? this.ride.pause() : this.ride.resume();
            this.updateHudDom();
            this.audio.blip(this.ride.playing ? 720 : 480);
        } else if (this.mode === 'explore' || this.mode === 'mission') {
            this.toggleAutoFly();
        }
    }

    toggleAutoFly() {
        if (this.mode !== 'explore' && this.mode !== 'mission') return;
        this.autoFly = !this.autoFly;
        this.focusTween = null;
        this.audio.blip(this.autoFly ? 760 : 420);
        if (this.mode === 'mission') {
            this.setHud('SCAN HUNT', (this.missionObjective || 'Find the next world').slice(0, 72));
        } else {
            this.setHud(this.autoFly ? 'FLYING' : 'HOLDING',
                this.autoFly
                    ? (this.stereo ? 'Look to steer · tap to stop' : 'Point the phone to steer · use Stop to pause')
                    : (this.stereo ? 'Tap to fly where you look' : 'Use Fly to move where you look'));
        }
        this.updatePhoneButtons();
    }

    updateHead(dt) {
        if (this.renderer.xr.isPresenting) return;
        if (this.gyroActive) {
            this.gyro.apply(this.camera.quaternion, 0);
            return;
        }
        if (this.mode === 'ride' || this.mode === 'dodge' || this.exploreCockpitOn) {
            if (!this.dragging && this.mode !== 'dodge') {
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
            btn.textContent = '🥽 Try entering VR';
            btn.title = 'Headset detection failed. Try requesting a VR session directly.';
            btn.disabled = false;
        }
    }

    async enterVR() {
        if (!navigator.xr) return;
        if (this.stereo) this.exitPhoneVR();
        this.audio.init();
        try {
            const session = await navigator.xr.requestSession('immersive-vr', {
                optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers']
            });
            this.renderer.xr.setReferenceSpaceType('local-floor');
            await this.renderer.xr.setSession(session);
            this.xrSession = session;
            document.body.classList.add('in-vr');
            this.vrHud.visible = true;
            if (this.mode === 'menu') setTimeout(() => this.toggleVRMenu(), 700);
            session.addEventListener('end', () => {
                this.xrSession = null;
                document.body.classList.remove('in-vr');
                this.vrHud.visible = false;
                if (this.vrInfoPanel) this.vrInfoPanel.visible = false;
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
        this.hands = [];
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

            // WebXR Hand-Tracking support (Quest / Vision Pro / Pico pinch gestures)
            if (this.renderer.xr.getHand) {
                const hand = this.renderer.xr.getHand(i);
                const pinchOrb = new THREE.Mesh(
                    new THREE.SphereGeometry(0.012, 12, 12),
                    new THREE.MeshBasicMaterial({ color: 0x64ffda, transparent: true, opacity: 0.75 })
                );
                hand.add(pinchOrb);
                hand.addEventListener('pinchstart', () => {
                    this.pulse(0.4, 40);
                    this.onControllerSelect(c);
                });
                this.dolly.add(hand);
                this.hands.push(hand);
            }
        }
    }

    buildVRMenu() {
        const label = (text, sub, accent) => {
            const c = document.createElement('canvas');
            c.width = 1024; c.height = 512;
            const x = c.getContext('2d');
            x.scale(2, 2);
            x.fillStyle = 'rgba(8,15,28,0.92)';
            x.fillRect(0, 0, 512, 256);
            x.strokeStyle = accent; x.lineWidth = 6;
            x.strokeRect(3, 3, 506, 250);
            x.textAlign = 'center';
            x.fillStyle = accent;
            let size = 44;
            x.font = `bold ${size}px Inter, sans-serif`;
            while (x.measureText(text).width > 448 && size > 24) {
                size -= 2;
                x.font = `bold ${size}px Inter, sans-serif`;
            }
            x.fillText(text, 256, 110);
            x.fillStyle = '#cfe3ff';
            x.font = '24px Inter, sans-serif';
            x.fillText(sub, 256, 164);
            const t = new THREE.CanvasTexture(c);
            t.colorSpace = THREE.SRGBColorSpace;
            t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
            return t;
        };

        this.vrMenu = new THREE.Group();
        this.vrMenu.visible = false;
        this.dolly.add(this.vrMenu);

        const mk = (tex, xPos, yPos, action, scale = 1) => {
            const m = new THREE.Mesh(
                new THREE.PlaneGeometry(0.84 * scale, 0.42 * scale),
                new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false })
            );
            m.position.set(xPos, yPos, 0);
            m.renderOrder = 997;
            m.userData.action = action;
            this.vrMenu.add(m);
            return m;
        };

        this.vrMenuItems = this.entry === 'ride'
            ? [
                mk(label('VR DEEP SPACE RIDE', '3 min · jumpscares & turret', '#ff8b8b'), 0, 0.22, 'ride'),
                mk(label('SWITCH TO FREE FLIGHT', 'Explore all 13 worlds freely', '#64ffda'), 0, -0.24, 'explore', 0.88)
            ]
            : this.entry === 'dodge'
                ? [mk(label('ASTEROID DODGE', '60 sec · head-steered practice', '#ffb46b'), 0, 0, 'dodge')]
                : [
                    mk(label('EXPLORE', 'Free flight · left stick to fly', '#64ffda'), -0.46, 0.25, 'explore', 0.95),
                    mk(label('SCAN HUNT', '90 sec · find 5 worlds', '#c4b5fd'), 0.46, 0.25, 'scan-hunt', 0.95),
                    mk(label('NEXT WORLD · WARP', 'Tour planets & moons up close', '#7dd3fc'), -0.46, -0.22, 'next-world', 0.9),
                    mk(label('TOGGLE 3D COCKPIT', 'Fly inside the pilot cabin', '#fcd34d'), 0.46, -0.22, 'toggle-cockpit', 0.9)
                ];
    }

    toggleVRMenu() {
        if (!this.renderer.xr.isPresenting) return;
        if (this.mode === 'dodge') this.dodge.run.pause();
        const show = !this.vrMenu.visible;
        this.vrMenu.visible = show;
        this.vrHud.visible = !show;
        if (show && this.vrInfoPanel) this.vrInfoPanel.visible = false;
        if (!show) return;
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const p = this.camera.position.clone().addScaledVector(fwd, 1.6);
        this.vrMenu.position.copy(p);
        this.vrMenu.quaternion.copy(this.camera.quaternion);
        this.audio.blip(600);
    }

    menuHit(controller) {
        if (!this.vrMenu.visible) return null;
        const m = new THREE.Matrix4().identity().extractRotation(controller.matrixWorld);
        const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
        const dir = new THREE.Vector3(0, 0, -1).applyMatrix4(m).normalize();
        this.raycaster.set(origin, dir);
        const hits = this.raycaster.intersectObjects(this.vrMenuItems, false);
        return hits.length ? hits[0].object : null;
    }

    /* ── 3D Holographic Planet Scanner Card (for WebXR & Phone VR) ──── */

    buildVRInfoPanel() {
        const c = document.createElement('canvas');
        c.width = 1024; c.height = 640;
        this.vrInfoCanvas = c;
        this.vrInfoCtx = c.getContext('2d');
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
        this.vrInfoTex = tex;

        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(0.66, 0.41),
            new THREE.MeshBasicMaterial({
                map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false
            })
        );
        // Positioned comfortably in the upper-right peripheral HUD zone
        mesh.position.set(0.32, 0.08, -1.12);
        mesh.rotation.y = -0.22;
        mesh.renderOrder = 996;
        mesh.visible = false;
        this.camera.add(mesh);
        this.vrInfoPanel = mesh;
    }

    drawVRInfoPanel(info) {
        if (!this.vrInfoCtx || !info) return;
        const x = this.vrInfoCtx, w = 1024, h = 640;
        x.clearRect(0, 0, w, h);

        // Deep glass card with glowing cyan border
        x.fillStyle = 'rgba(6, 14, 28, 0.92)';
        x.strokeStyle = 'rgba(34, 211, 238, 0.72)';
        x.lineWidth = 4;
        const r = 28;
        x.beginPath();
        x.moveTo(r, 4); x.lineTo(w - r, 4); x.quadraticCurveTo(w - 4, 4, w - 4, r);
        x.lineTo(w - 4, h - r); x.quadraticCurveTo(w - 4, h - 4, w - r, h - 4);
        x.lineTo(r, h - 4); x.quadraticCurveTo(4, h - 4, 4, h - r);
        x.lineTo(4, r); x.quadraticCurveTo(4, 4, r, 4);
        x.fill(); x.stroke();

        // Header badge & Planet Title
        x.fillStyle = 'rgba(34, 211, 238, 0.16)';
        x.fillRect(36, 34, 280, 38);
        x.fillStyle = '#64ffda';
        x.font = 'bold 22px Orbitron, Inter, sans-serif';
        x.fillText(info.kind || 'CELESTIAL BODY', 50, 60);

        x.fillStyle = '#f2f6ff';
        x.font = 'bold 56px Orbitron, Inter, sans-serif';
        x.fillText(info.name.toUpperCase(), 36, 134);

        // Fact paragraph (word-wrapped)
        x.fillStyle = '#c8dcf4';
        x.font = '30px Inter, sans-serif';
        const words = String(info.fact || '').split(' ');
        let line = '', row = 0;
        for (const word of words) {
            if (x.measureText(`${line} ${word}`).width > w - 72 && line) {
                x.fillText(line, 36, 194 + row * 42);
                row++;
                line = '';
                if (row === 3) break;
            }
            line += (line ? ' ' : '') + word;
        }
        if (row < 3 && line) x.fillText(line, 36, 194 + row * 42);

        // Telemetry grid
        const stats = [
            ['RADIUS', `${info.radius.toFixed(1)} u`],
            ['ORBIT', String(info.distance)],
            ['AXIAL TILT', String(info.tiltDeg)],
            ['MOONS', info.moons && info.moons.length ? info.moons.slice(0, 3).join(' · ') : 'None']
        ];
        stats.forEach(([k, v], idx) => {
            const col = idx % 2, rw = (idx / 2) | 0;
            const bx = 36 + col * 484, by = 348 + rw * 96;
            x.fillStyle = 'rgba(122, 162, 255, 0.12)';
            x.fillRect(bx, by, 464, 78);
            x.fillStyle = '#8da8c8';
            x.font = '600 20px Inter, sans-serif';
            x.fillText(k, bx + 20, by + 30);
            x.fillStyle = '#ffffff';
            x.font = 'bold 26px Orbitron, Inter, sans-serif';
            x.fillText(v, bx + 20, by + 64, 424);
        });

        // Footer hint
        x.fillStyle = '#64ffda';
        x.font = '600 22px Inter, sans-serif';
        x.fillText('🛸 4K SURFACE STREAMED  ·  MENU → LOW ORBIT SKIM / NEXT WORLD', 36, 594);

        this.vrInfoTex.needsUpdate = true;
        if (this.renderer.xr.isPresenting || this.stereo) {
            this.vrInfoPanel.visible = true;
            clearTimeout(this._vrInfoTimer);
            this._vrInfoTimer = setTimeout(() => {
                if (this.vrInfoPanel) this.vrInfoPanel.visible = false;
            }, 9000);
        }
    }

    /* in-headset HUD: a canvas panel pinned below the line of sight */
    buildVRHud() {
        const c = document.createElement('canvas');
        c.width = 2048; c.height = 512;
        this.hudCanvas = c;
        this.hudCtx = c.getContext('2d');
        this.hudCtx.scale(2, 2);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
        this.hudTex = tex;
        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(0.72, 0.18),
            new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
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
        x.fillStyle = 'rgba(6,12,22,0.96)';
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
        x.font = 'bold 62px Inter, Segoe UI, sans-serif';
        x.fillText(this.hudText.title, 34, 74, w - 68);
        x.fillStyle = '#cfe3ff';
        x.font = '40px Inter, Segoe UI, sans-serif';
        const words = this.hudText.sub.split(' ');
        let line = '', row = 0;
        for (const word of words) {
            if (x.measureText(`${line} ${word}`).width > w - 68 && line) {
                x.fillText(line, 34, 126 + row * 44); row++; line = '';
                if (row === 2) break;
            }
            line += (line ? ' ' : '') + word;
        }
        if (row < 2) x.fillText(line, 34, 126 + row * 44, w - 68);

        if (this.hudText.warn) {
            x.fillStyle = '#ff5a5a';
            x.font = 'bold 44px Inter, Segoe UI, sans-serif';
            x.fillText(this.hudText.warn, 34, 224, w - 68);
        } else if (this.mode === 'ride') {
            const p = clamp(this.ride.time / this.ride.total, 0, 1);
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

    lookDelta(dx, dy) {
        if (this.mode === 'ride' || this.mode === 'dodge') {
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
            if (this.touchMoved < 8) {
                if (this.stereo) this.onPhoneTap();
                else if (e.changedTouches && e.changedTouches[0]) this.pickAt(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
            }
        });
        dom.addEventListener('touchcancel', () => { this.dragging = false; });

        window.addEventListener('keydown', e => {
            const control = e.target.closest?.('input,textarea,select,button,a,[contenteditable="true"]');
            if (control && control.getClientRects().length) return;
            this.keys.add(e.code);
            if (e.repeat) return;
            if (e.code === 'Space' && this.mode === 'dodge') { e.preventDefault(); this.onPhoneTap(); }
            if (e.code === 'Space' && this.mode === 'ride') {
                e.preventDefault();
                this.ride.playing ? this.ride.pause() : this.ride.resume();
                this.updateHudDom();
            }
            if (e.code === 'KeyF' && (this.mode === 'ride' || this.scares.actors.length > 0)) {
                e.preventDefault();
                this.fireTurret();
            }
            if (e.code === 'KeyK' && (this.mode === 'explore' || this.mode === 'mission')) {
                e.preventDefault();
                this.toggleExploreCockpit();
            }
            if (e.code === 'KeyN' && this.mode === 'explore') {
                e.preventDefault();
                this.cycleBody(1);
            }
            if (e.code === 'KeyL' && this.mode === 'explore') {
                e.preventDefault();
                this.skimBody(this.activeBodyKey || 'earth');
            }
            if (e.code === 'ArrowRight' && this.mode === 'ride') this.ride.skipSegment();
            if (e.code === 'KeyR' && this.mode === 'ride') this.startRide();
            if (e.code === 'KeyC') this.setComfort(!this.comfort);
            if (e.code === 'KeyV') this.recenterView();
            if (e.code === 'Escape' && this.mode !== 'menu') this.toMenu();
        });
        window.addEventListener('keyup', e => this.keys.delete(e.code));
    }

    remoteAction(action) {
        if (this.mode === 'menu' || this.renderer.xr.isPresenting) return;
        if (action === 'primary') this.onPhoneTap();
        if (action === 'recenter') this.recenterView();
        if (action === 'menu') {
            this.toMenu();
        }
        if (action === 'scan' && (this.mode === 'explore' || this.mode === 'mission')) {
            this.camera.updateWorldMatrix(true, false);
            this.pointer.set(0, 0);
            this.raycaster.setFromCamera(this.pointer, this.camera);
            const hits = this.raycaster.intersectObjects(this.system.pickTargets, false);
            if (hits.length) this.showBody(hits[0].object.userData.bodyKey, false);
            else this.toast('Aim the centre of your view at a planet or moon, then scan.');
        }
    }

    bindUI() {
        $('start-explore').onclick = () => this.startExplore();
        $('start-ride').onclick = () => this.startRide();
        const hunt = $('start-hunt');
        if (hunt) hunt.onclick = () => this.startMission('scan-hunt');
        $('start-dodge').onclick = () => this.startDodge();
        $('dodge-play').onclick = () => this.onPhoneTap();
        $('dodge-restart').onclick = () => this.startDodge();
        $('dodge-exit').onclick = () => this.toMenu();
        $('dodge-phone-vr').onclick = () => this.enterPhoneVR();
        $('enter-vr').onclick = () => this.enterVR();
        $('btn-menu').onclick = () => this.toMenu();
        $('btn-restart').onclick = () => this.startRide();
        $('btn-skip').onclick = () => { this.clearWarning(); this.ride.skipSegment(); };
        $('btn-pause').onclick = () => {
            this.ride.playing ? this.ride.pause() : this.ride.resume();
            this.updateHudDom();
        };
        const turretBtn = $('btn-turret');
        if (turretBtn) turretBtn.onclick = () => this.fireTurret();
        const ckFlyBtn = $('btn-cockpit-fly');
        if (ckFlyBtn) ckFlyBtn.onclick = () => this.toggleExploreCockpit();
        const nextBtn = $('btn-next-planet');
        if (nextBtn) nextBtn.onclick = () => this.cycleBody(1);
        const skimBtn = $('btn-skim-planet');
        if (skimBtn) skimBtn.onclick = () => this.skimBody(this.activeBodyKey || 'earth');
        const infoSkim = $('info-skim');
        if (infoSkim) infoSkim.onclick = () => this.skimBody(this.activeBodyKey || 'earth');
        const infoNext = $('info-next');
        if (infoNext) infoNext.onclick = () => this.cycleBody(1);

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
        $('opt-sound').onchange = e => {
            this.audio.setMuted(!e.target.checked);
            if (!e.target.checked) this.stopSpeech();
        };
        const optVoice = $('opt-voice');
        if (optVoice) optVoice.onchange = e => {
            this.voiceOn = e.target.checked;
            if (!this.voiceOn) this.stopSpeech();
        };
        $('opt-labels').onchange = e => this.system.setLabelsVisible(this.mode === 'explore' && e.target.checked);
        $('opt-orbits').onchange = e => this.system.setOrbitLinesVisible(e.target.checked);
        $('info-close').onclick = () => {
            $('info-card').classList.remove('show');
            if (this.vrInfoPanel) this.vrInfoPanel.visible = false;
            this.system.setHighlightedOrbit(null);
        };
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
        const bf = $('btn-phone-fly');
        if (bf) bf.onclick = () => this.toggleAutoFly();
        const bl = $('btn-phone-vr-live');
        if (bl) bl.onclick = () => this.enterPhoneVR();
        document.querySelectorAll('[data-phone-exit]').forEach(button => {
            button.onclick = () => this.exitPhoneVR();
        });
        document.querySelectorAll('[data-phone-awake]').forEach(button => {
            button.onclick = () => { if (this.stereo) this.screenAwake.request(); };
        });
        const br = $('btn-recenter');
        if (br) br.onclick = () => this.recenterView();
        document.querySelectorAll('[data-phone-recenter]').forEach(button => {
            button.onclick = () => this.recenterView();
        });
        const spacing = $('viewer-spacing'), size = $('viewer-size'), shape = $('viewer-shape');
        const updateFit = () => {
            this.stereoEffect.setViewerSettings({ spacing: Number(spacing.value) / 100, size: Number(size.value) / 100, shape: shape.value });
            try { localStorage.setItem('spaceverse.cardboard-layout.v2', JSON.stringify(this.stereoEffect.settings)); }
            catch (_) { /* session-only adjustment if storage is blocked */ }
            this.updateCardboardLayout();
        };
        if (spacing && size) {
            spacing.value = this.stereoEffect.settings.spacing * 100;
            size.value = this.stereoEffect.settings.size * 100;
            shape.value = this.stereoEffect.settings.shape;
            shape.onchange = updateFit;
            spacing.oninput = size.oninput = updateFit;
            $('viewer-reset').onclick = () => { spacing.value = 44; size.value = 96; shape.value = 'wide'; updateFit(); };
            this.updateCardboardLayout();
        }
    }

    setComfort(v) {
        this.comfort = v;
        this.ride.comfort = v;
        $('opt-comfort').checked = v;
        this.toast(v ? 'Comfort mode ON — rolls damped, tunnel vignette active' : 'Comfort mode OFF');
    }

    /** Toggle 3D Spaceship Cockpit in Free Flight / Scan Hunt */
    toggleExploreCockpit(force) {
        this.exploreCockpitOn = typeof force === 'boolean' ? force : !this.exploreCockpitOn;
        if (this.mode === 'explore' || this.mode === 'mission') {
            this.cockpit.setVisible(this.exploreCockpitOn);
            document.body.classList.toggle('cockpit-on', this.exploreCockpitOn);
            if (this.exploreCockpitOn) {
                this.cockpit.setSegment(
                    this.mode === 'mission' ? 'SCAN HUNT' : 'FREE FLIGHT',
                    'Solar System Patrol',
                    this._tourIdx || 0,
                    BODIES.length,
                    BODIES.slice(0, 8).map(b => ({ title: b.name.toUpperCase(), dur: b.distance || 0 }))
                );
            }
            this.audio.blip(this.exploreCockpitOn ? 740 : 480);
            this.toast(this.exploreCockpitOn ? '3D Pilot Cockpit ON (press K to toggle)' : '3D Pilot Cockpit OFF');
        }
        this.updatePhoneButtons();
    }

    /** Fire twin plasma deflector cannons at incoming collision hazards */
    fireTurret() {
        if (!this.scares) return false;
        const hit = this.scares.deflectNearest();
        if (!hit && this.mode === 'ride') {
            this.audio.blip(340);
            this.toast('No active collision hazard in range.');
        }
        return hit;
    }

    onControllerSelect(controller) {
        const item = this.menuHit(controller);
        if (item) {
            this.vrMenu.visible = false;
            this.vrHud.visible = true;
            const action = item.userData.action;
            if (action === 'explore') this.startExplore();
            else if (action === 'scan-hunt') this.startMission('scan-hunt');
            else if (action === 'dodge') this.startDodge();
            else if (action === 'next-world') this.cycleBody(1);
            else if (action === 'toggle-cockpit') this.toggleExploreCockpit();
            else this.startRide();
            return;
        }
        if (this.mode === 'dodge') { this.onPhoneTap(); return; }
        if (this.mode === 'ride') {
            // If an incoming asteroid threat is active, trigger fires the plasma turret!
            if (this.scares && this.scares.actors.length > 0 && this.fireTurret()) return;
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
        if (this.mode === 'dodge' || this.stereo) return;
        if (this.mode === 'ride') {
            // Clicking during an incoming asteroid hazard fires the deflector turret
            if (this.scares && this.scares.actors.length > 0) this.fireTurret();
            return;
        }
        this.pointer.x = (cx / window.innerWidth) * 2 - 1;
        this.pointer.y = -(cy / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hits = this.raycaster.intersectObjects(this.system.pickTargets, false);
        if (hits.length) this.showBody(hits[0].object.userData.bodyKey, true);
    }

    showBody(key, travel) {
        if (this.mode === 'dodge') return;
        const d = this.system.getInfo(key);
        if (!d) return;

        // Upgrade planet surface texture to full 4096x2048 4K on scan/approach
        this.system.upgradeTo4K(key);

        if (this.mode === 'mission') {
            MissionCore.input({ type: 'scan', key });
            this.audio.blip(660);
            return;
        }

        this.activeBodyKey = key;
        const pIdx = BODIES.findIndex(b => b.key === (key.includes('/') ? key.split('/')[0] : key));
        if (pIdx !== -1) this._tourIdx = pIdx;
        this.system.setHighlightedOrbit(key);

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
        this.drawVRInfoPanel(d);
        this.audio.blip(880);
        this.setHud(d.name.toUpperCase(), d.fact.slice(0, 64));
        this.speak(`${d.name}. ${d.fact}`);
        if (this.exploreCockpitOn && this.cockpit) {
            this.cockpit.setSegment(d.name.toUpperCase(), d.kind, this._tourIdx || 0, BODIES.length);
            this.cockpit.setNarration(d.fact);
        }
        if (travel) this.flyTo(key);
    }

    flyTo(key) {
        const d = this.system.getInfo(key);
        if (!d) return;
        this.system.upgradeTo4K(key);
        const target = this.system.worldPos(key, new THREE.Vector3());
        const dist = d.radius * 3.8 + (d.kind.indexOf('MOON') === 0 ? 2.2 : 6.5);
        const from = this.dolly.position.clone();
        // Aim toward the sun-lit equatorial/terminator hemisphere so the 4K surface is well-lit
        const sunDir = target.clone().lengthSq() > 1 ? target.clone().negate().normalize() : new THREE.Vector3(0, 0, 1);
        const side = new THREE.Vector3(-sunDir.z, 0.22, sunDir.x).normalize();
        const viewDir = sunDir.clone().multiplyScalar(0.74).addScaledVector(side, 0.67).normalize();
        const to = target.clone().addScaledVector(viewDir, dist);
        this.focusTween = { from, to, target, viewDir, t: 0, dur: 2.2, key, dist, radius: d.radius };
    }

    /** Swoop down to a low-orbit terminator vantage point (1.5x radius above surface) */
    skimBody(key) {
        const targetKey = key || this.activeBodyKey || 'earth';
        const d = this.system.getInfo(targetKey);
        if (!d) return;
        this.system.upgradeTo4K(targetKey);
        this.activeBodyKey = targetKey;
        const target = this.system.worldPos(targetKey, new THREE.Vector3());
        const from = this.dolly.position.clone();
        const sunDir = target.clone().lengthSq() > 1 ? target.clone().negate().normalize() : new THREE.Vector3(0, 0, 1);
        const side = new THREE.Vector3(-sunDir.z, 0.14, sunDir.x).normalize();
        // Grazing terminator angle so craters, rings, and clouds stand out in dramatic relief
        const viewDir = sunDir.clone().multiplyScalar(0.55).addScaledVector(side, 0.83).normalize();
        const dist = d.radius * (targetKey === 'saturn' ? 2.45 : 1.72) + (d.kind.indexOf('MOON') === 0 ? 1.2 : 1.8);
        const to = target.clone().addScaledVector(viewDir, dist);
        this.focusTween = { from, to, target, viewDir, t: 0, dur: 2.0, key: targetKey, dist, radius: d.radius };
        this.audio.blip(940);
        this.toast(`Low-orbit pass over ${d.name} — 4K telemetry locked`);
    }

    /** Cycle to the next (or previous) world in BODIES */
    cycleBody(step = 1) {
        this._tourIdx = ((this._tourIdx || 0) + step + BODIES.length) % BODIES.length;
        const next = BODIES[this._tourIdx];
        if (next) this.showBody(next.key, true);
    }

    /* ── mode switching ─────────────────────────────────────────────── */

    toMenu(options = {}) {
        if (this.mode === 'mission' && MissionCore.snapshot().running && !options.force) {
            const ok = window.confirm('Abandon this run? Your progress will not be scored.');
            if (!ok) return false;
            MissionCore.abort('player-left');
        }

        this.stopSpeech();
        if (this.stereo) this.exitPhoneVR();
        this.leaveDodge();

        this.mode = 'menu';
        this.ride.stop();
        this.cockpit.setVisible(false);
        document.body.classList.remove('cockpit-on');
        this.autoFly = false;
        this.updatePhoneButtons();
        this.system.orbitRate = 1;
        this.system.setLabelsVisible(false);
        this.system.setHighlightedOrbit(null);
        if (this.vrInfoPanel) this.vrInfoPanel.visible = false;
        this.camera.fov = this.baseFov;
        this.camera.updateProjectionMatrix();
        $('mode-menu').classList.add('show');
        $('ride-hud').classList.remove('show');
        $('explore-hud').classList.remove('show');
        this.setHud('SPACEVERSE', this.entry === 'dodge' ? 'Asteroid Dodge — ready' : this.entry === 'ride' ? 'Deep Space Ride — ready' : 'Free flight — ready');
        this.audio.setPad(0.0);
        this.audio.setEngine(0);
        if (this.renderer.xr.isPresenting && !this.vrMenu.visible) this.toggleVRMenu();
    }

    startExplore() {
        this.leaveDodge();
        this.audio.init();
        this.mode = 'explore';
        this.ride.stop();
        this.cockpit.setVisible(this.exploreCockpitOn);
        document.body.classList.toggle('cockpit-on', this.exploreCockpitOn);
        this.autoFly = false;
        this.updatePhoneButtons();
        this.system.setOrbitLinesVisible($('opt-orbits').checked);
        this.system.setLabelsVisible($('opt-labels').checked);
        this.placeAtEarth();
        this.system.upgradeTo4K('earth');
        $('mode-menu').classList.remove('show');
        $('ride-hud').classList.remove('show');
        $('explore-hud').classList.add('show');
        this.camera.fov = this.baseFov;
        this.camera.updateProjectionMatrix();
        this.audio.setPad(0.5);
        const controls = this.renderer.xr.isPresenting
            ? 'Left stick to fly · trigger / pinch to scan a world'
            : this.stereo
                ? 'Look well down → hold MENU for controls · gaze at worlds to scan'
                : this.isTouch
                    ? 'Point the phone to steer · tap a planet to scan'
                    : 'Drag to look · W/S to fly · K cockpit · L low orbit · click to scan';
        this.setHud('FREE FLIGHT', controls);
        if (!this.isTouch) this.toast('Free flight: drag to look, W/S to fly, K for 3D Cockpit, L for Low Orbit, click a planet to scan.');
    }

    /* ── hands-free practice ────────────────────────────────────────── */

    startDodge() {
        if (this.entry !== 'dodge') return;
        if (MissionCore.snapshot().running) {
            this.toast('Finish or leave the current mission before starting Asteroid Dodge.');
            return;
        }
        this.stopSpeech();
        this.audio.init(); this.ride.stop(); this.clearWarning();
        this.mode = 'dodge'; this.autoFly = false; this.focusTween = null;
        this.cockpit.setVisible(false); document.body.classList.remove('cockpit-on');
        if (this.vrInfoPanel) this.vrInfoPanel.visible = false;
        this.system.root.visible = false;
        this.lookYaw = 0; this.lookPitch = 0; this.yaw = 0; this.pitch = 0;
        this.dolly.position.set(0, 0, 0); this.dolly.quaternion.identity();
        if (this.gyroActive) this.gyro.recenter();
        this.updateHead(0);
        this.camera.fov = this.baseFov; this.camera.updateProjectionMatrix();
        this.dodge.start(this.dolly);
        this.closeGazeMenu();
        this.gazeControls.anchor(this.camera);
        if (this.gyroActive) this.gazeControls.group.quaternion.identity();
        $('mode-menu').classList.remove('show');
        $('explore-hud').classList.remove('show'); $('ride-hud').classList.remove('show');
        $('info-card').classList.remove('show'); $('ride-done').classList.remove('show');
        $('dodge-hud').classList.add('show');
        this.vrHud.visible = this.stereo || this.renderer.xr.isPresenting;
        this.audio.setEngine(0); this.audio.setPad(0.25);
        this._dodgeHudKey = ''; this.updateDodgeHud(); this.updatePhoneButtons();
    }

    leaveDodge() {
        if (!this.dodge) return;
        this.dodge.stop(); this.system.root.visible = true;
        $('dodge-hud').classList.remove('show');
    }

    dodgeButtonTitle() {
        return ({ ready: 'START DODGE', countdown: 'PAUSE GAME', playing: 'PAUSE GAME',
            paused: 'RESUME GAME', won: 'PLAY AGAIN', lost: 'TRY AGAIN' })[this.dodge.run.state];
    }

    updateDodgeHud() {
        const run = this.dodge.run;
        const title = ({ ready: 'ASTEROID DODGE', countdown: `READY · ${Math.ceil(run.countdown)}`,
            playing: 'ASTEROID DODGE', paused: 'GAME PAUSED', won: 'RUN COMPLETE', lost: 'OUT OF SHIELDS' })[run.state];
        const stats = `${Math.ceil(60 - run.elapsed)}s · ${run.shields} shields · ${run.dodged} dodged`;
        const sub = run.state === 'ready' ? (this.stereo ? 'Look well down: MENU → START DODGE.' : 'Turn head or drag gently left/right. Select START to play.')
            : run.state === 'paused' && this.stereo ? `${stats} · Look down: MENU → RESUME`
            : run.state === 'countdown' ? 'Face the course. Stay seated. Get ready.' : stats;
        const key = title + sub;
        if (key === this._dodgeHudKey) return;
        this._dodgeHudKey = key;
        this.setHud(title, sub);
        $('dodge-status').textContent = `${title} — ${sub}`;
        $('dodge-play').textContent = this.dodgeButtonTitle();
    }

    /* ── missions ───────────────────────────────────────────────────── */

    async startMission(missionId) {
        this.leaveDodge();
        this.audio.init();
        this.mode = 'mission';
        this.ride.stop();
        this.cockpit.setVisible(this.exploreCockpitOn);
        document.body.classList.toggle('cockpit-on', this.exploreCockpitOn);
        this.autoFly = false;
        this.updatePhoneButtons();
        this.system.setOrbitLinesVisible($('opt-orbits').checked);
        this.system.setLabelsVisible(false);
        this.system.setHighlightedOrbit(null);
        if (this.vrInfoPanel) this.vrInfoPanel.visible = false;
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
        if (this.cockpit && this.cockpit.visible) this.cockpit.setNarration(text);
        this.speak(text);
    }

    setMissionProgress(done, total, missed) {
        const el = $('seg-index');
        if (el) el.textContent = `${done}/${total}`;
        this.missionProgress = { done, total, missed };
    }

    flashMission(kind) {
        const warn = $('warning');
        if (!warn) return;
        clearTimeout(this._warnT);
        const ok = kind === 'correct';
        warn.textContent = ok ? '✅ TARGET CONFIRMED' : '❌ WRONG TARGET';
        warn.classList.remove('hit', 'ok');
        warn.classList.add('show', ok ? 'ok' : 'hit');
        if (this.cockpit && this.cockpit.visible) {
            this.cockpit.setAlert(ok ? 'TARGET CONFIRMED' : 'WRONG TARGET', ok ? 'ok' : 'warn');
        }
        this._warnT = setTimeout(() => this.clearWarning(), 900);
    }

    onMissionResult(result) {
        if (result.abandoned) return;

        const headline = result.won ? 'MISSION COMPLETE' : 'MISSION FAILED';
        const detail = result.won
            ? `${result.facts?.found ?? 0}/${result.facts?.targets ?? 0} found`
            : (result.reason === 'timeout' ? 'Out of time' : 'Run ended');

        const saved = result.saved === false ? ' (not saved — will retry)'
            : result.saved === undefined ? ' (saving score…)' : '';
        const score = typeof result.score === 'number' ? ` · ${result.score} XP` : '';
        if (this.presentedMissionResults.has(result)) {
            this.toast(`${headline}: ${detail}${score}${saved}`);
            return;
        }
        this.presentedMissionResults.add(result);
        this.setHud(headline, detail);
        this.speak(`${headline}. ${detail}`);
        this.mode = 'explore';
        this.setMissionObjective('');
        this.system.setLabelsVisible($('opt-labels').checked);
        this.audio.setPad(0.5);
        this.toast(`${headline}: ${detail}${score}${saved}`);
        $('ride-done').firstElementChild.textContent = headline;
        $('ride-done').classList.add('show');
        setTimeout(() => $('ride-done').classList.remove('show'), 4000);
    }

    startRide() {
        $('ride-details').open = false;
        this.leaveDodge();
        this.audio.init();
        this.mode = 'ride';
        this.system.setOrbitLinesVisible(false);
        this.system.setLabelsVisible(false);
        this.system.setHighlightedOrbit(null);
        if (this.vrInfoPanel) this.vrInfoPanel.visible = false;
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
        this.toast('VR DEEP SPACE RIDE — you are in the pilot seat. Click / F / Trigger during collision alerts to fire the plasma turret!');
    }

    onSegment(s, i, n) {
        this.clearWarning();
        if (s.focus && s.focus !== 'ahead') this.system.upgradeTo4K(s.focus);
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
        $('ride-done').firstElementChild.textContent = 'MISSION COMPLETE';
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
        this.speak(text);
    }

    onScareEvent(e) {
        const warn = $('warning');
        const turretBtn = $('btn-turret');
        clearTimeout(this._warnT);
        if (e.type === 'incoming') {
            this.cockpit.setAlert(e.label + ' · FIRE TURRET', 'warn');
            warn.textContent = '⚠ ' + e.label + ' — CLICK / F TO DEFLECT';
            warn.classList.remove('hit', 'ok');
            warn.classList.add('show');
            if (turretBtn) turretBtn.classList.add('armed');
            this.setHud(this.hudText.title, this.hudText.sub, e.label);
            this._warnT = setTimeout(() => this.clearWarning(), 6000);
        } else if (e.type === 'deflected') {
            if (turretBtn) turretBtn.classList.remove('armed');
            this.cockpit.setAlert(e.label, 'ok');
            warn.textContent = '⚡ ' + e.label;
            warn.classList.remove('hit');
            warn.classList.add('show', 'ok');
            this.setHud(this.hudText.title, this.hudText.sub, 'THREAT VAPORIZED');
            this._warnT = setTimeout(() => this.clearWarning(), 2200);
        } else {
            if (turretBtn) turretBtn.classList.remove('armed');
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
        const turretBtn = $('btn-turret');
        if (turretBtn) turretBtn.classList.remove('armed');
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
        if (this.stereo && (this.gazeMenuOpen || this.gaze.key?.startsWith('ui:'))) return;
        const remoteMove = this.remote.movement();
        if (remoteMove.x || remoteMove.z) this.focusTween = null;
        if (this.focusTween) {
            const f = this.focusTween;
            f.t += dt;
            const p = clamp(f.t / f.dur, 0, 1);
            const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            if (f.key) {
                this.system.worldPos(f.key, f.target);
                if (f.viewDir) {
                    f.to.copy(f.target).addScaledVector(f.viewDir, f.dist);
                } else {
                    const dir = f.from.clone().sub(f.target).normalize();
                    f.to.copy(f.target).addScaledVector(dir, f.dist).add(new THREE.Vector3(0, f.radius * 0.5, 0));
                }
            }
            this.dolly.position.lerpVectors(f.from, f.to, e);
            const dir = f.target.clone().sub(this.dolly.position).normalize();
            const wantYaw = Math.atan2(-dir.x, -dir.z);
            const wantPitch = Math.asin(clamp(dir.y, -1, 1));
            // Shortest angular delta for yaw
            let dyaw = ((wantYaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
            this.yaw += dyaw * Math.min(1, dt * 3.5);
            this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 3.5);
            this.applyLook();
            this._freeSpeedNorm = Math.sin(p * Math.PI) * 0.85;
            if (p >= 1) {
                this.focusTween = null;
                this._freeSpeedNorm = 0;
            }
            return;
        }

        const v = new THREE.Vector3(remoteMove.x, 0, remoteMove.z);
        if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) v.z -= 1;
        if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) v.z += 1;
        if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) v.x -= 1;
        if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) v.x += 1;
        if (this.keys.has('KeyQ')) v.y -= 1;
        if (this.keys.has('KeyE')) v.y += 1;
        if (this.autoFly) v.z -= 1;

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
                        this.yaw -= Math.sign(ax) * Math.PI / 6;
                        this.applyLook();
                        this._snapLock = true;
                        setTimeout(() => { this._snapLock = false; }, 320);
                    }
                }
            }
        }

        const yawVel = (this.yaw - (this._prevYaw || this.yaw)) / Math.max(0.001, dt);
        this._prevYaw = this.yaw;
        const targetBank = clamp(-v.x * 0.25 + yawVel * 0.12, -0.65, 0.65);
        this._freeBank += (targetBank - this._freeBank) * Math.min(1, dt * 4);

        if (v.lengthSq() > 0) {
            const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 4 : 1;
            const normTarget = clamp((this.flySpeed * boost) / 160, 0.18, 1);
            this._freeSpeedNorm += (normTarget - this._freeSpeedNorm) * Math.min(1, dt * 4);
            v.normalize().multiplyScalar(this.flySpeed * boost * dt);
            const q = (this.renderer.xr.isPresenting || this.gyroActive)
                ? this.camera.getWorldQuaternion(new THREE.Quaternion())
                : this.dolly.quaternion;
            v.applyQuaternion(q);
            this.dolly.position.add(v);
            this.audio.setEngine(0.25);
        } else {
            this._freeSpeedNorm += (0 - this._freeSpeedNorm) * Math.min(1, dt * 4);
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

    updateCardboardLayout() {
        const width = window.innerWidth, height = window.innerHeight;
        const eyes = this.stereoEffect.layout(width, height);
        const mask = $('cardboard-lens-mask');
        mask.setAttribute('viewBox', `0 0 ${width} ${height}`);
        mask.firstElementChild.setAttribute('d', phoneLensMask(width, height, eyes, this.stereoEffect.settings));
        document.querySelectorAll('.cardboard-eye-bar').forEach((bar, i) => {
            bar.style.left = `${eyes[i].x}px`;
            bar.style.width = `${eyes[i].width}px`;
        });
        document.querySelectorAll('#cardboard-sensor-warning span').forEach((warning, i) => {
            warning.style.left = `${eyes[i].x}px`;
            warning.style.width = `${eyes[i].width}px`;
        });
        $('viewer-spacing-value').textContent = `${Math.round(this.stereoEffect.settings.spacing * 100)}%`;
        $('viewer-size-value').textContent = `${Math.round(this.stereoEffect.settings.size * 100)}%`;
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        const ratio = this.renderPixelRatio();
        this.renderer.setPixelRatio(ratio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        if (this.composer) {
            this.composer.setPixelRatio(ratio);
            this.composer.setSize(window.innerWidth, window.innerHeight);
        }
        if (this.stereo) this.stereoEffect.setSize(window.innerWidth, window.innerHeight);
        this.updateCardboardLayout();
    }

    /* ── cockpit instruments: live data from the scene ─────────────── */

    radarContacts() {
        const out = [];
        const tmp = this._radarTmp || (this._radarTmp = new THREE.Vector3());
        if (this.scares && this.scares.actors) {
            for (const a of this.scares.actors) {
                tmp.copy(a.mesh.position);
                this.dolly.worldToLocal(tmp);
                if (Math.abs(tmp.x) > 90 || Math.abs(tmp.z) > 90) continue;
                out.push({ x: tmp.x, z: tmp.z, hit: !!(a.spec && a.spec.hit) });
            }
        }
        // In Free Flight / Scan Hunt, also plot nearby planets on the cockpit radar scope
        if (this.mode === 'explore' || this.mode === 'mission') {
            for (const b of BODIES) {
                this.system.worldPos(b.key, tmp);
                this.dolly.worldToLocal(tmp);
                tmp.multiplyScalar(0.35);
                if (Math.abs(tmp.x) > 70 || Math.abs(tmp.z) > 70) continue;
                out.push({ x: tmp.x, z: tmp.z, hit: false });
            }
        }
        return out;
    }

    hudTarget() {
        let focusKey = null;
        if (this.mode === 'ride') {
            const seg = this.ride.segments && this.ride.segments[this.ride.segIndex];
            if (seg && seg.focus && seg.focus !== 'ahead' && this.system.bodies.has(seg.focus)) {
                focusKey = seg.focus;
            }
        } else if (this.mode === 'explore' || this.mode === 'mission') {
            focusKey = this.activeBodyKey || 'earth';
        }
        if (!focusKey) return null;
        const p = this.system.worldPos(focusKey, this._hudTmp || (this._hudTmp = new THREE.Vector3()));
        const dist = p.distanceTo(this.dolly.position);
        const local = p.clone(); this.dolly.worldToLocal(local);
        const labelName = focusKey.includes('/') ? focusKey.split('/')[1] : focusKey;
        if (local.z >= -0.5) return { visible: true, x: local.x > 0 ? 1.2 : -1.2, y: 0, name: labelName, dist };
        const f = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
        const ndcY = -local.y / (local.z * f), ndcX = -local.x / (local.z * f * this.camera.aspect);
        return { visible: true, x: ndcX * 1.1, y: ndcY * 1.1, name: labelName, dist };
    }

    shipHeading() {
        const f = this._hdgTmp || (this._hdgTmp = new THREE.Vector3());
        f.set(0, 0, -1).applyQuaternion(this.dolly.quaternion);
        return Math.atan2(f.x, -f.z);
    }

    /* ── frame ──────────────────────────────────────────────────────── */

    loop() {
        if (document.hidden && !this.renderer.xr.isPresenting) {
            this.clock.getDelta(); this.gaze.reset(); return;
        }
        const dt = Math.min(0.05, this.clock.getDelta());
        this.remote.update();
        const camPos = this.camera.getWorldPosition(this._camPos || (this._camPos = new THREE.Vector3()));
        if (this.mode !== 'dodge') this.system.update(dt, camPos);

        this.updateHead(dt);
        this.camera.updateWorldMatrix(true, false);
        if (this.mode === 'ride') this.ride.update(dt);
        else if (this.mode === 'dodge') {
            const before = this.dodge.run.hits;
            this.dodge.update(dt, this.camera, this.dolly, this.gazeMenuOpen ||
                (this.stereo && this.gaze.key?.startsWith('ui:')));
            if (this.dodge.run.hits > before) this.audio.blip(180);
            this.updateDodgeHud();
        }
        else this.flyUpdate(dt);
        this.camera.updateWorldMatrix(true, false);
        this.gazeUpdate(dt);

        if (this.cockpit.visible) {
            const isRide = this.mode === 'ride';
            const spdNorm = isRide ? (this.ride.speedNorm || 0) : (this._freeSpeedNorm || 0);
            this.cockpit.update(dt, {
                speedNorm: spdNorm,
                speedKmh: isRide ? (spdNorm * 42000 + 1800) : Math.round(spdNorm * 36000 + (spdNorm > 0.02 ? this.flySpeed * 120 : 0)),
                progress: isRide ? (this.ride.total ? this.ride.time / this.ride.total : 0) : ((this._tourIdx || 0) / Math.max(1, BODIES.length - 1)),
                time: isRide ? this.ride.time : this.system.elapsed,
                total: isRide ? (this.ride.total || 1) : 180,
                paused: isRide ? !this.ride.playing : false,
                bank: isRide ? (this.ride._bank || 0) : (this._freeBank || 0),
                roll: isRide ? (this.ride._roll || 0) : 0,
                comfort: this.comfort, scares: this.scaresOn,
                radar: this.radarContacts(),
                target: this.hudTarget(),
                heading: this.shipHeading()
            });
        }

        if (this.mode === 'mission') {
            const result = MissionCore.tick(dt);
            if (result && !result.abandoned) this.onMissionResult(result);
        }

        if (this.mode !== 'dodge') this.scares.update(dt, camPos);
        if (this.mode !== 'ride') this.scares.setVignette(0);

        if (this.vrMenu && this.vrMenu.visible && this.controllers) {
            const hovered = this.controllers.map(c => this.menuHit(c)).filter(Boolean);
            this.vrMenuItems.forEach(it => {
                const on = hovered.indexOf(it) !== -1;
                it.scale.setScalar(it.scale.x + ((on ? 1.08 : 1) - it.scale.x) * 0.2);
            });
        }

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

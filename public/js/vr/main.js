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
import { DodgeGame } from './dodge-game.js?v=20261127-q3bugfix';
import { ArcadeFlight } from './arcade-flight.js?v=20261127-q3bugfix';
import { InterceptGame } from './intercept-game.js?v=20261127-q3bugfix';
import { VR_GAMES, VR_ARCADE_META } from './arcade-run.js?v=20261127-q3bugfix';
import { Quest3Rig } from './quest3-rig.js?v=20261127-q3bugfix';
import { immersiveVRStatus, questOnlyVRStatus, readThumbstick, readQuestControllers, pulseQuestController, setRayFromObject } from './xr-support.js?v=20261125-xr1';
import { guardXRFrames } from './xr-frame-guard.js?v=20261125-xr1';
import MissionCore from '../game/core.js';
import { createScanHunt } from '../game/missions/scan-hunt.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DODGE_DIFFICULTIES = ['practice', 'normal', 'expert'];
const DODGE_SENSITIVITIES = { low: 0.72, standard: 1, high: 1.35 };

class VRApp {
    constructor() {
        this.mode = 'menu';
        const slug = location.pathname.match(/^\/games\/([a-z-]+)\/?$/i)?.[1]?.toLowerCase();
        this.arcadeMission = Object.hasOwn(VR_GAMES, slug) ? VR_GAMES[slug] : null;
        this.arcadeMeta = Object.hasOwn(VR_ARCADE_META, slug) ? VR_ARCADE_META[slug] : null;
        this.arcadeSlug = slug;
        this.isIntercept = slug === 'orbital-intercept';
        this.entry = (slug === 'asteroid-dodge' || this.isIntercept || this.arcadeMission) ? 'dodge' : (location.pathname.indexOf('vr-ride') !== -1 ||
            location.search.indexOf('mode=ride') !== -1) ? 'ride' : 'explore';
        this.questOnly = this.entry === 'dodge';
        this._prevQuestInput = null;
        this._xrRightSelectConsumed = false;
        this._savedArcadeRun = null;
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
        if (this.arcadeMission || this.isIntercept) this.setStatus('Preparing ' + this.arcadeName + ' for Meta Quest 3…');
        else if (this.questOnly) this.setStatus('Preparing ' + this.arcadeName + ' for Meta Quest 3…');
        else await this.system.build(msg => this.setStatus(msg));
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
        if (this.entry === 'dodge') {
            const gameOpts = { renderer: this.renderer, audio: this.audio, haptics: (h, i, ms) => this.pulseHand(h, i, ms) };
            if (this.isIntercept) this.interceptGame = new InterceptGame(this.scene, gameOpts);
            else if (this.arcadeMission) this.flightGame = new ArcadeFlight(this.scene, this.arcadeSlug, gameOpts);
            else this.dodge = new DodgeGame(this.scene, gameOpts);
            this.configureArcadeLauncher();
        }
        const pauseDodge = () => { if (this.mode === 'dodge') this.arcadeGame.run.pause(); };
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

        if (!this.arcadeMission && !this.isIntercept) this.placeAtEarth();
        window.addEventListener('resize', () => this.onResize());

        this.renderer.setAnimationLoop((_time, frame) => {
            if (frame && this.xrGuard) this.xrGuard.render(() => this.loop(frame));
            else this.loop(frame);
        });

        this.checkXR();
        this.checkPhone();
        $('loading').style.display = 'none';
        $('mode-menu').classList.add('show');
        $('mode-menu').classList.add(`only-${this.entry}`);
        if (this.questOnly) {
            document.body?.classList?.add('quest-only');
            $('mode-menu').classList.add('quest-only');
        }

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
        const pitch = this.xrSession || this.gyroActive || this.stereoFlightLook ? 0 : this.pitch;
        this.dolly.quaternion.setFromEuler(new THREE.Euler(pitch, this.yaw, 0, 'YXZ'));
    }

    get stereoFlightLook() {
        return this.stereo && (this.mode === 'explore' || this.mode === 'mission');
    }

    get gyroActive() {
        return this.gyroOn && this.gyro.enabled && this.gyro.hasReading && !this.renderer.xr.isPresenting;
    }

    get arcadeGame() { return this.interceptGame || this.flightGame || this.dodge; }
    get arcadeName() { return this.arcadeMeta?.title || this.arcadeMission?.title || 'Asteroid Dodge'; }

    configureArcadeLauncher() {
        const meta = this.arcadeMeta;
        const name = this.arcadeName;
        const summary = meta?.description || this.arcadeMission?.description || 'Bank through an asteroid trench with Meta Quest 3 Touch Plus controllers.';
        document.title = name + ' — Meta Quest 3 · SpaceVerse';

        if ($('arcade-title')) $('arcade-title').textContent = name;
        if ($('arcade-kicker')) $('arcade-kicker').textContent = meta?.kicker || 'META QUEST 3 EXCLUSIVE';
        if ($('arcade-launch-name')) $('arcade-launch-name').textContent = 'Start ' + name;
        if ($('arcade-summary')) $('arcade-summary').textContent = summary;
        if ($('arcade-controls')) $('arcade-controls').textContent = this.arcadeMission?.controls || this.arcadeGame?.run?.config?.controls || '';
        if ($('arcade-menu-summary')) $('arcade-menu-summary').textContent = 'Meta Quest 3 Exclusive · Use Touch Plus dual 6DoF controllers.';
        if ($('dodge-settings')) $('dodge-settings').hidden = true;
        if ($('dodge-hud')) $('dodge-hud').setAttribute('aria-label', name + ' controls');

        if ($('quest3-title')) $('quest3-title').textContent = name;
        if ($('quest3-kicker')) $('quest3-kicker').textContent = meta?.kicker || 'META QUEST 3 EXCLUSIVE · TOUCH PLUS';
        if ($('quest3-summary')) $('quest3-summary').textContent = summary;

        const leftList = $('quest3-left-list');
        const rightList = $('quest3-right-list');
        if (leftList && meta?.questControls?.left) {
            leftList.innerHTML = meta.questControls.left.map(item => `<li>${item}</li>`).join('');
        }
        if (rightList && meta?.questControls?.right) {
            rightList.innerHTML = meta.questControls.right.map(item => `<li>${item}</li>`).join('');
        }
        this.refreshArcadeBest();
    }

    refreshArcadeBest() {
        const badge = $('quest3-best');
        if (!badge || !this.arcadeSlug) return;
        let best = 0;
        try {
            best = Number(localStorage.getItem('spaceverse.arcade.' + this.arcadeSlug + '.best') || 0);
        } catch { best = 0; }
        if (!Number.isFinite(best) || best < 0) best = 0;
        const tiers = this.arcadeMeta?.tiers || [1500, 4000, 9000];
        const medal = best >= tiers[2] ? '🥇 Gold' : best >= tiers[1] ? '🥈 Silver' : best >= tiers[0] ? '🥉 Bronze' : 'No medal yet';
        badge.textContent = best > 0 ? `Personal Best: ${best.toLocaleString()} pts · ${medal}` : `Personal Best: — · Target ${tiers[0].toLocaleString()} for Bronze`;
    }

    saveArcadeBest(score) {
        if (!this.arcadeSlug || !Number.isFinite(score) || score <= 0) return;
        const rounded = Math.round(score);
        try {
            const key = 'spaceverse.arcade.' + this.arcadeSlug + '.best';
            const prev = Number(localStorage.getItem(key) || 0);
            if (!Number.isFinite(prev) || rounded > prev) {
                localStorage.setItem(key, String(rounded));
            }
        } catch { /* ignore storage restrictions */ }
        this.refreshArcadeBest();
    }

    /* ── phone VR: gyro look + Cardboard stereo ─────────────────────── */

    checkPhone() {
        const wrap = $('phone-row');
        if (!wrap) return;
        if (this.questOnly) {
            if (wrap.style) wrap.style.display = 'none';
            return;
        }
        if (!this.isTouch) { wrap.style.display = 'none'; return; }
        wrap.style.display = 'flex';
        const flight = $('phone-flight');
        if (flight) flight.style.display = 'flex';
        const reason = GyroLook.blockedReason;
        const note = $('phone-note');
        if (note) {
            note.textContent = reason
                ? '⚠ ' + reason
                : `Use Gyro look for a normal phone view. Phone VR starts ${this.entry === 'dodge' ? this.arcadeName : this.entry === 'ride' ? 'the ride' : 'free flight'} in side-by-side view; rotate to landscape before using a viewer.`;
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
        if (this.mode === 'dodge') this.arcadeGame.run.pause();
        if (this.gyroActive) this.gyro.recenter();
        else if (this.stereoFlightLook) this.pitch = 0;
        this.lookYaw = 0; this.lookPitch = 0;
        this.updateHead(0);
        if (this.mode === 'dodge') this.arcadeGame.recenter(this.xrHead?.quaternion || this.camera.quaternion, this.xrHead?.position);
        if (this.gazeControls) {
            this.gazeControls.anchor(this.camera);
            if (this.gyroActive) this.gazeControls.group.quaternion.identity();
        }
        this.gaze.reset(true);
        this.audio.blip(700);
        this.toast('View recentred');
    }

    async enterPhoneVR() {
        if (this.questOnly) {
            this.toast('Phone VR is disabled — this game is exclusive to Meta Quest 3 with Touch Plus controllers.');
            return;
        }
        if (this.renderer.xr.isPresenting) return;
        this.audio.init();
        const gyroRequest = this.enableGyro(true);
        this.stereo = true;
        if (this.stereoFlightLook) this.applyLook();
        if (this.mode === 'dodge') this.arcadeGame.run.pause();
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
        const wasStereoFlight = this.stereoFlightLook;
        this.stereo = false;
        if (wasStereoFlight) {
            this.applyLook();
            this.updateHead(0);
        }
        this.screenAwake.stop();
        if (this.mode === 'dodge') this.arcadeGame.run.pause();
        this.autoFly = false;
        this.gazeOptionsOpen = false;
        this.gazeMenuOpen = false;
        this.gazeControls.group.visible = false;
        for (const ui of [this.reticle, this.gazeControls.group]) {
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
                if (this.dodge) options.push(...this.dodgeOptions());
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
            this.showMenuInfo(this.gazeControls.group, true);
            this.autoFly = false;
            this.focusTween = null;
            if (this.mode === 'dodge') this.arcadeGame.run.pause();
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
        if (this.changeDodgeOption(action)) { this.gaze.reset(true); return; }
        this.autoFly = false;
        this.focusTween = null;
        if (action === 'options' && this.mode === 'ride') this.ride.pause();
        if (action === 'options' && this.mode === 'dodge') this.arcadeGame.run.pause();
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
        if (this.vrInfoPanel?.parent === this.gazeControls.group) this.vrInfoPanel.visible = false;
        this.gazeMenuOpen = false;
        this.gazeOptionsOpen = false;
        this.gaze.reset(true);
    }

    gazeUpdate(dt) {
        const stereo = this.stereo && !this.renderer.xr.isPresenting && this.mode !== 'menu';
        const gameGyro = this.mode === 'dodge' && this.flightGame && this.gyroActive;
        const active = stereo || gameGyro;
        for (const ui of [this.reticle, this.gazeControls.group]) {
            if (ui) setPhoneUILayer(ui, stereo);
        }
        this.gazeControls.group.visible = active;
        this.reticle.visible = active;
        if (!active || document.hidden || !document.hasFocus()) {
            this.gazeControls.group.visible = false;
            this.gaze.reset();
            this.reticleFill.geometry.setDrawRange(0, 0);
            return;
        }
        if (stereo) {
            if (this.gazeMenuOpen && this.gazeControls.lookPitch(this.camera) > -20 * Math.PI / 180) this.closeGazeMenu();
            this.gazeControls.updateDock(this.camera, this.gazeMenuOpen);
            this.gazeControls.setOptions(this.gazeOptions());
            setPhoneUILayer(this.gazeControls.group, true);
        } else this.gazeControls.group.visible = false;
        this.pointer.set(0, 0);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const control = stereo ? this.gazeControls.hit(this.raycaster, PHONE_UI_LAYER) : null;
        const pointAtWorld = !control && !this.gazeMenuOpen;
        const gameHit = pointAtWorld && this.mode === 'dodge' ? this.flightGame?.pick(this.raycaster) : null;
        const world = pointAtWorld && this.mode !== 'ride' && this.mode !== 'dodge'
            ? this.raycaster.intersectObjects(this.system.pickTargets, false)[0] : null;
        const action = control?.object.userData.action;
        const playAction = gameHit?.object.userData.arcadeAction;
        const body = world?.object.userData.bodyKey;
        setPhoneUILayer(this.reticle, stereo && !world && !gameHit);
        const key = action ? `ui:${action}` : playAction ? `game:${playAction}` : body ? `body:${body}` : null;
        const { progress, activate } = this.gaze.update(key, dt);
        this.gazeControls.highlight(control?.object);
        if (this.mode === 'dodge') this.flightGame?.highlight(gameHit?.object);
        this.reticleFill.geometry.setDrawRange(0, Math.floor(progress * 64) * 6);
        const distance = clamp(control?.distance || gameHit?.distance || world?.distance || 1.6, 0.2, 1000);
        this.reticle.position.z = -distance;
        this.reticle.scale.setScalar(distance / 0.6);
        if (activate) {
            if (playAction) this.arcadeAction(playAction);
            else {
                this.audio.blip(920);
                if (action) this.gazeAction(action);
                else this.showBody(body, this.mode === 'explore');
            }
        }
    }

    onPhoneTap() {
        if (this.mode === 'dodge') {
            const run = this.arcadeGame.run;
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
        if (this.stereoFlightLook) {
            // Keep the gaze menu on the level cabin while drag tilts the view.
            this.camera.rotation.set(this.pitch, 0, 0, 'YXZ');
            return;
        }
        if (this.mode === 'ride' || this.mode === 'dodge' || this.exploreCockpitOn) {
            // A split-screen player must be able to hold aim after releasing a drag.
            if (!this.dragging && !this.stereo && this.mode !== 'dodge') {
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
        const qBtn = $('quest3-launch');
        const status = this.questOnly
            ? await questOnlyVRStatus(navigator.xr, window.isSecureContext)
            : await immersiveVRStatus(navigator.xr, window.isSecureContext);
        const { label, available, reason } = status;
        if (btn) {
            btn.textContent = '🥽 ' + label;
            btn.disabled = !available;
            btn.classList.toggle('disabled', !available);
        }
        if (qBtn) {
            qBtn.textContent = '🥽 ' + label;
            qBtn.disabled = !available;
            qBtn.classList.toggle('disabled', !available);
        }
        if ($('vr-ready')?.style) $('vr-ready').style.display = available ? 'block' : 'none';
        const req = $('quest3-requirement');
        if (req) {
            req.textContent = available ? 'Meta Quest 3 WebXR Ready · Put on your headset and pick up both Touch Plus controllers.' : (reason || 'Open in Meta Quest 3 Browser over HTTPS.');
            req.classList?.toggle?.('ready', Boolean(available));
        }
    }

    async enterVR() {
        if (this.xrReloadNeeded) {
            location.reload();
            return;
        }
        if (!navigator.xr || this.xrSession || this.xrStarting) return;
        this.xrStarting = true;
        const button = $('enter-vr');
        const qBtn = $('quest3-launch');
        if (button) button.disabled = true;
        if (qBtn) qBtn.disabled = true;
        let session;
        try {
            if ($('xr-launch-status')) $('xr-launch-status').textContent = '';
            if (this.stereo) this.exitPhoneVR();
            this.audio.init();
            session = await navigator.xr.requestSession('immersive-vr', {
                optionalFeatures: ['hand-tracking']
            });
            this.xrSession = session;
            this.xrHead = new THREE.Object3D();
            this._prevQuestInput = null;
            this.xrShowLauncher = this.mode === 'menu';
            this.xrGuard = guardXRFrames(error => this.failXR(session, error));
            // Three restores its own framebuffer in its native end handler.
            session.addEventListener('end', () => queueMicrotask(() => this.endXR(session)), { once: true });
            session.addEventListener('visibilitychange', () => {
                if (session.visibilityState !== 'visible') this.pauseXRActivity();
            });
            // The cockpit and Quest 3 arcade courses use a seated eye-level origin.
            this.renderer.xr.setReferenceSpaceType('local');
            this.renderer.xr.setFramebufferScaleFactor(1.0);
            this.renderer.xr.setFoveation?.(0.45);
            this.xrAttaching = session;
            try {
                await this.renderer.xr.setSession(session);
            } finally {
                this.xrAttaching = null;
            }
            if (this.xrSession !== session || this.xrFailed) return;
            document.body.classList.add('in-vr');
            if (this.mode !== 'menu') $('mode-menu').classList.remove('show');
            if (this.mode === 'explore' || this.mode === 'mission') this.applyLook();
        } catch (e) {
            if (session && this.xrSession === session) this.xrGuard.fail(e);
            else if (!session) this.reportXRFailure(e);
        } finally {
            this.xrStarting = false;
            if (button) button.disabled = false;
            if (qBtn) qBtn.disabled = false;
        }
    }

    reportXRFailure(error) {
        console.error('[vr] headset rendering failed', error);
        const message = 'Headset VR could not start or continue. ' + (error?.message || 'Try entering VR again.');
        const status = $('xr-launch-status');
        if (status) status.textContent = message;
        this.toast(message);
    }

    failXR(session, error) {
        if (this.xrSession !== session) return;
        this.xrFailed = true;
        this.reportXRFailure(error);
        session.end().catch(() => this.endXR(session));
    }

    pauseXRActivity() {
        this.autoFly = false;
        if (this.mode === 'ride') this.ride.pause();
        if (this.mode === 'dodge') this.arcadeGame.run.pause();
        this.updateHudDom();
    }

    endXR(session) {
        if (this.xrSession !== session) return;
        const showLauncher = this.questOnly || this.xrFailed || this.xrAttaching === session;
        if (this.xrAttaching === session) {
            // Three is still attaching the old session. Retry with a fresh renderer.
            this.xrReloadNeeded = true;
            for (const id of ['enter-vr', 'quest3-launch']) {
                const button = $(id);
                if (button) {
                    button.textContent = 'Reload to retry headset VR';
                    button.disabled = false;
                }
            }
        }
        this.xrGuard?.stop();
        this.xrGuard = null;
        this.xrFailed = false;
        this.pauseXRActivity();
        this.xrSession = null;
        this.xrHead = null;
        this.xrShowLauncher = false;
        this._snapLock = false;
        document.body.classList.remove('in-vr');
        if (showLauncher) $('mode-menu').classList.add('show');
        this.vrMenu.visible = false;
        if (this.vrInfoPanel) this.vrInfoPanel.visible = false;
        if (this.mode === 'explore' || this.mode === 'mission') this.applyLook();
        this.onResize();
    }

    updateXRHead(frame) {
        const reference = this.renderer.xr.getReferenceSpace();
        const pose = reference && frame?.getViewerPose(reference);
        if (!pose || !this.xrHead) return false;
        this.xrHead.position.copy(pose.transform.position);
        this.xrHead.quaternion.copy(pose.transform.orientation);
        if (this.xrShowLauncher) {
            this.xrShowLauncher = false;
            if (this.questOnly) this.startDodge();
            else if (!this.vrMenu.visible) this.toggleVRMenu();
        }
        return true;
    }

    pulse(intensity, ms) {
        this.pulseHand('both', intensity, ms);
    }

    pulseHand(handedness, intensity, ms) {
        pulseQuestController(this.xrSession, handedness, intensity, ms);
    }

    buildControllers() {
        this.questRig = new Quest3Rig({
            renderer: this.renderer,
            dolly: this.dolly,
            envMap: this.cockpit?.env || null,
            onSelect: c => this.onControllerSelect(c),
            onSqueeze: (_c, slot) => {
                if (this.isIntercept && this.mode === 'dodge' && !this.vrMenu?.visible && this.interceptGame?.run.state === 'playing') {
                    return;
                }
                if (this.questOnly && this.mode === 'dodge' && slot?.handedness === 'right' && !this.vrMenu?.visible && this.arcadeGame?.run.state === 'playing') {
                    return;
                }
                this.toggleVRMenu();
            }
        });
        this.controllers = this.questRig.controllers;
        if (this.questOnly) this.questRig.setToolProfile(this.arcadeSlug);

        this.hands = [];
        for (let i = 0; i < 2; i++) {
            if (this.renderer.xr.getHand) {
                const hand = this.renderer.xr.getHand(i);
                const pinchOrb = new THREE.Mesh(
                    new THREE.SphereGeometry(0.012, 12, 12),
                    new THREE.MeshBasicMaterial({ color: 0x64ffda, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false })
                );
                pinchOrb.renderOrder = 990;
                hand.add(pinchOrb);
                this.dolly.add(hand);
                this.hands.push(hand);
            }
        }
    }

    buildVRMenu(active = false) {
        if (this.vrMenu) {
            this.dolly.remove(this.vrMenu);
            for (const item of this.vrMenuItems) {
                item.geometry.dispose();
                item.material.map.dispose();
                item.material.dispose();
            }
        }
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
                new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
            );
            m.position.set(xPos, yPos, 0);
            m.renderOrder = 997;
            m.userData.action = action;
            this.vrMenu.add(m);
            return m;
        };

        if (active) {
            const options = this.mode === 'ride' ? [
                [this.ride.time >= this.ride.total ? 'REPLAY RIDE' : 'RESUME RIDE', 'Continue the flight', 'ride-resume'],
                ['SKIP SECTION', 'Continue from the next leg', 'ride-skip'],
                ['RESTART RIDE', 'Return to Earth orbit', 'ride'],
                ['TOGGLE COMFORT', 'Reduce rolls and limit peripheral motion', 'comfort']
            ] : this.mode === 'dodge' ? [
                [this.dodgeButtonTitle(), 'Begin or resume the current run', 'dodge-play'],
                ['RESTART GAME', 'Reset the current run', 'dodge'],
                ['RECENTER VIEW', 'Set forward direction', 'recenter-arcade'],
                ...(this.dodge ? this.dodgeOptions().map(({ title, hint, action }) => [title, hint, action]) : [])
            ] : [
                ['NEXT WORLD · WARP', 'Fly to the next destination', 'next-world'],
                ['LOW ORBIT', 'Skim the selected world', 'low-orbit'],
                ['TOGGLE 3D COCKPIT', 'Show or hide the pilot cabin', 'toggle-cockpit'],
                [this.autoFly ? 'STOP FLYING' : 'FLY FORWARD', 'Use head direction to steer', 'auto-fly']
            ];
            options.push(['RETURN TO VIEW', 'Close these controls', 'close'], ['EXIT HEADSET VR', 'Return to the browser', 'exit']);
            const rows = Math.ceil(options.length / 2);
            this.vrMenuItems = options.map(([title, hint, action], i) => mk(
                label(title, hint, '#64ffda'), i % 2 ? 0.44 : -0.44, (rows / 2 - 0.5 - Math.floor(i / 2)) * 0.31, action, 0.69
            ));
            return;
        }
        this.vrMenuItems = this.entry === 'ride'
            ? [
                mk(label('VR DEEP SPACE RIDE', '3 min · jumpscares & turret', '#ff8b8b'), 0, 0.22, 'ride'),
                mk(label('SWITCH TO FREE FLIGHT', 'Explore all 13 worlds freely', '#64ffda'), 0, -0.24, 'explore', 0.88)
            ]
            : this.entry === 'dodge'
                ? [mk(label(this.arcadeName.toUpperCase(), 'Select to enter Meta Quest 3 cockpit', this.arcadeMeta?.accent || this.arcadeMission?.accent || '#ffb46b'), 0, 0, 'dodge')]
                : [
                    mk(label('EXPLORE', 'Free flight · left stick to fly', '#64ffda'), -0.46, 0.25, 'explore', 0.95),
                    mk(label('SCAN HUNT', '90 sec · find 5 worlds', '#c4b5fd'), 0.46, 0.25, 'scan-hunt', 0.95),
                    mk(label('NEXT WORLD · WARP', 'Tour planets & moons up close', '#7dd3fc'), -0.46, -0.22, 'next-world', 0.9),
                    mk(label('TOGGLE 3D COCKPIT', 'Fly inside the pilot cabin', '#fcd34d'), 0.46, -0.22, 'toggle-cockpit', 0.9)
                ];
    }

    toggleVRMenu() {
        if (!this.renderer.xr.isPresenting) return;
        const show = !this.vrMenu.visible;
        if (!show) { this.vrMenu.visible = false; return; }
        if (this.mode === 'ride') this.ride.pause();
        if (this.mode === 'dodge') this.arcadeGame.run.pause();
        this.buildVRMenu(this.mode !== 'menu');
        this.vrMenu.visible = true;
        this.showMenuInfo(this.vrMenu, false);
        const head = this.xrHead || this.camera;
        const yaw = new THREE.Euler().setFromQuaternion(head.quaternion, 'YXZ').y;
        this.vrMenu.rotation.set(0, yaw, 0, 'YXZ');
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.vrMenu.quaternion);
        this.vrMenu.position.copy(head.position).addScaledVector(forward, 1.75);
        this.vrMenu.updateWorldMatrix(true, true);
        this.audio.blip(600);
    }

    menuHit(controller) {
        if (!this.vrMenu.visible || !controller.visible) return null;
        controller.updateWorldMatrix(true, false);
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
        mesh.renderOrder = 996;
        mesh.visible = false;
        this.vrInfoPanel = mesh;
    }

    showMenuInfo(menu, phone) {
        const panel = this.vrInfoPanel;
        if (!panel) return;
        const clue = this.mode === 'mission' && this.missionObjective;
        const body = this.mode === 'explore' && this.activeBodyKey && this.system.getInfo(this.activeBodyKey);
        panel.visible = Boolean(clue || body);
        if (!panel.visible) return;
        this.drawVRInfoPanel(clue ? { name: 'Scan Hunt', kind: 'MISSION CLUE', fact: clue } : body);
        menu.add(panel);
        panel.position.set(0, phone ? 0.52 : 0.72, phone ? -1.6 : 0);
        setPhoneUILayer(panel, phone);
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
        const maxRows = info.radius == null ? 9 : 3;
        let line = '', row = 0;
        for (const word of words) {
            if (x.measureText(`${line} ${word}`).width > w - 72 && line) {
                x.fillText(line, 36, 194 + row * 42);
                row++;
                line = '';
                if (row === maxRows) break;
            }
            line += (line ? ' ' : '') + word;
        }
        if (row < maxRows && line) x.fillText(line, 36, 194 + row * 42);

        // Telemetry grid
        const stats = info.radius == null ? [] : [
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
        if (stats.length) x.fillText('LOW ORBIT SKIM  ·  NEXT WORLD', 36, 594);

        this.vrInfoTex.needsUpdate = true;
    }

    setHud(title, sub, warn = '') {
        this.hudText = { title, sub, warn };
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
                if (this.stereo) {
                    if (this.mode === 'dodge' && this.flightGame?.run.state === 'playing') {
                        this.pointer.set(0, 0);
                        this.raycaster.setFromCamera(this.pointer, this.camera);
                        this.selectArcadeTarget();
                    } else this.onPhoneTap();
                }
                else if (e.changedTouches && e.changedTouches[0]) this.pickAt(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
            }
        });
        dom.addEventListener('touchcancel', () => { this.dragging = false; });

        window.addEventListener('keydown', e => {
            const control = e.target.closest?.('input,textarea,select,button,a,[contenteditable="true"]');
            if (control && control.getClientRects().length) return;
            this.keys.add(e.code);
            if (this.mode === 'dodge' && e.code.startsWith('Arrow')) e.preventDefault();
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
        $('dodge-difficulty').onchange = event => this.setDodgeDifficulty(event.target.value);
        $('dodge-sensitivity').onchange = event => this.setDodgeSensitivity(event.target.value);
        $('enter-vr').onclick = () => this.enterVR();
        const qLaunch = $('quest3-launch');
        if (qLaunch) qLaunch.onclick = () => this.enterVR();
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
        if (this.vrMenu.visible) {
            if (!item) return;
            this.vrMenu.visible = false;
            const action = item.userData.action;
            if (action === 'explore') this.startExplore();
            else if (action === 'scan-hunt') this.startMission('scan-hunt');
            else if (action === 'dodge') this.startDodge();
            else if (action === 'next-world') this.cycleBody(1);
            else if (action === 'low-orbit') this.skimBody(this.activeBodyKey || 'earth');
            else if (action === 'toggle-cockpit') this.toggleExploreCockpit();
            else if (action === 'auto-fly') this.toggleAutoFly();
            else if (action === 'dodge-play') this.onPhoneTap();
            else if (action === 'recenter-arcade') this.recenterView();
            else if (this.changeDodgeOption(action)) this.toggleVRMenu();
            else if (action === 'ride') this.startRide();
            else if (action === 'ride-resume') {
                if (this.ride.time >= this.ride.total) this.startRide();
                else this.ride.resume();
            } else if (action === 'ride-skip') {
                this.clearWarning(); this.ride.resume(); this.ride.skipSegment();
            } else if (action === 'comfort') {
                this.setComfort(!this.comfort);
                this.toggleVRMenu();
            } else if (action === 'exit') {
                this.xrSession?.end().catch(() => {});
            }
            this.updateHudDom();
            return;
        }
        if (this.mode === 'menu') return;
        if (this.mode === 'dodge') {
            const slot = this.questRig?.slots?.find(s => s.controller === controller);
            if (slot?.handedness === 'left') return;
            const state = this.arcadeGame?.run.state;
            if (this.flightGame?.run.state === 'playing') {
                setRayFromObject(this.raycaster, controller);
                if (this.selectArcadeTarget() && slot) this._xrRightSelectConsumed = true;
            } else if (state !== 'playing' && state !== 'countdown') {
                this.onPhoneTap();
                if (slot) this._xrRightSelectConsumed = true;
            }
            return;
        }
        if (this.mode === 'ride') {
            // If an incoming asteroid threat is active, trigger fires the plasma turret!
            if (this.scares && this.scares.actors.length > 0 && this.fireTurret()) return;
            this.ride.skipSegment();
            this.audio.blip(760);
            return;
        }
        controller.updateWorldMatrix(true, false);
        const m = new THREE.Matrix4().identity().extractRotation(controller.matrixWorld);
        const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
        const dir = new THREE.Vector3(0, 0, -1).applyMatrix4(m).normalize();
        this.raycaster.set(origin, dir);
        const hits = this.raycaster.intersectObjects(this.system.pickTargets, false);
        if (hits.length) this.showBody(hits[0].object.userData.bodyKey, true);
    }

    pickAt(cx, cy) {
        if (this.stereo || (this.mode === 'dodge' && !this.flightGame)) return;
        if (this.mode === 'ride') {
            // Clicking during an incoming asteroid hazard fires the deflector turret
            if (this.scares && this.scares.actors.length > 0) this.fireTurret();
            return;
        }
        this.pointer.x = (cx / window.innerWidth) * 2 - 1;
        this.pointer.y = -(cy / window.innerHeight) * 2 + 1;
        this.camera.updateWorldMatrix(true, false);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        if (this.mode === 'dodge') { this.selectArcadeTarget(); return; }
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
        this.setHud('SPACEVERSE', this.entry === 'dodge' ? this.arcadeName + ' — ready' : this.entry === 'ride' ? 'Deep Space Ride — ready' : 'Free flight — ready');
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
            this.toast('Finish or leave the current mission before starting ' + this.arcadeName + '.');
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
        this.arcadeGame.start(this.dolly, this.xrHead?.quaternion, this.xrHead?.position);
        this.closeGazeMenu();
        this.gazeControls.anchor(this.camera);
        if (this.gyroActive) this.gazeControls.group.quaternion.identity();
        $('mode-menu').classList.remove('show');
        $('explore-hud').classList.remove('show'); $('ride-hud').classList.remove('show');
        $('info-card').classList.remove('show'); $('ride-done').classList.remove('show');
        $('dodge-hud').classList.add('show');
        this.audio.setEngine(0); this.audio.setPad(0.25);
        this._dodgeHudKey = ''; this._arcadeHudDelay = 0; this._savedArcadeRun = null;
        this.updateDodgeHud(); this.updatePhoneButtons();
    }

    leaveDodge() {
        if (!this.arcadeGame) return;
        this.arcadeGame.stop(); this.system.root.visible = true;
        $('dodge-hud').classList.remove('show');
    }

    selectArcadeTarget() {
        const action = this.flightGame?.pick(this.raycaster)?.object.userData.arcadeAction;
        if (action) {
            this.arcadeAction(action);
            return true;
        }
        return false;
    }

    arcadeAction(action) {
        const accepted = this.flightGame.run.action(action);
        this.flightGame.syncScene();
        this.audio.blip(accepted ? 860 : 320);
        if (accepted) this.pulse(0.23, 38);
        this.updateDodgeHud();
    }

    dodgeOptions() {
        return [
            { action: 'dodge-level', title: 'LEVEL · ' + this.dodge.run.difficulty.toUpperCase(), hint: 'Applies to the next run' },
            { action: 'dodge-sense', title: 'STEERING · ' + (this.dodgeSensitivity || 'standard').toUpperCase(), hint: 'Adjust head steering' }
        ];
    }

    setDodgeDifficulty(name) {
        if (!this.dodge || !DODGE_DIFFICULTIES.includes(name)) return;
        this.dodge.run.setDifficulty(name);
        if (this.dodge.run.state === 'ready') this.dodge.run.reset();
        $('dodge-difficulty').value = name;
        if (this.mode === 'dodge') this.updateDodgeHud();
    }

    setDodgeSensitivity(name) {
        if (!this.dodge || !Object.hasOwn(DODGE_SENSITIVITIES, name)) return;
        this.dodgeSensitivity = name;
        this.dodge.sensitivity = DODGE_SENSITIVITIES[name];
        $('dodge-sensitivity').value = name;
    }

    changeDodgeOption(action) {
        if (!this.dodge) return false;
        if (action === 'dodge-level') {
            const index = DODGE_DIFFICULTIES.indexOf(this.dodge.run.difficulty);
            this.setDodgeDifficulty(DODGE_DIFFICULTIES[(index + 1) % DODGE_DIFFICULTIES.length]);
            return true;
        }
        if (action === 'dodge-sense') {
            const names = Object.keys(DODGE_SENSITIVITIES);
            const index = names.indexOf(this.dodgeSensitivity || 'standard');
            this.setDodgeSensitivity(names[(index + 1) % names.length]);
            return true;
        }
        return false;
    }

    arcadeInput() {
        if (this.xrSession) {
            const sources = Array.from(this.xrSession.inputSources);
            const source = sources.find(item => item.handedness === 'left' && item.gamepad) ||
                sources.find(item => item.gamepad);
            if (!source) return null;
            const stick = readThumbstick(source.gamepad);
            return { x: stick.x, y: -stick.y };
        }
        if (this.gaze.key?.startsWith('game:')) {
            return { x: 0, y: 0, brake: this.gaze.done && this.gaze.key === 'game:brake' };
        }
        const x = Number(this.keys.has('ArrowRight') || this.keys.has('KeyD')) - Number(this.keys.has('ArrowLeft') || this.keys.has('KeyA'));
        const y = Number(this.keys.has('ArrowUp') || this.keys.has('KeyW')) - Number(this.keys.has('ArrowDown') || this.keys.has('KeyS'));
        return x || y ? { x, y } : null;
    }

    dodgeButtonTitle() {
        return ({ ready: (this.arcadeMission || this.isIntercept) ? 'START GAME' : 'START DODGE', countdown: 'PAUSE GAME', playing: 'PAUSE GAME',
            paused: 'RESUME GAME', won: 'PLAY AGAIN', lost: 'TRY AGAIN' })[this.arcadeGame.run.state];
    }

    updateDodgeHud() {
        const run = this.arcadeGame.run;
        const name = this.arcadeName.toUpperCase();
        const isMissionOrIntercept = Boolean(this.flightGame || this.interceptGame);
        const title = ({ ready: name, countdown: `READY · ${Math.ceil(run.countdown)}`,
            playing: name, paused: 'GAME PAUSED', won: 'RUN COMPLETE', lost: isMissionOrIntercept ? 'RUN ENDED' : 'OUT OF SHIELDS' })[run.state];
        const stats = isMissionOrIntercept ? run.status()
            : `${Math.ceil(run.duration - run.elapsed)}s · ${run.shields} shields · ${run.score} points · ${run.dodged} dodged · ${run.state === 'won' || run.state === 'lost' ? 'best ' + run.bestStreak : 'streak ' + run.streak}×`;
        const readyHint = this.stereo ? 'Look well down: MENU → ' + this.dodgeButtonTitle()
            : this.xrSession ? 'Press A or pull trigger to start. B to recenter.' : 'Select START to play.';
        const sub = run.state === 'ready' ? readyHint
            : run.state === 'paused' && this.stereo ? `${stats} · Look down: MENU → RESUME`
            : run.state === 'countdown' ? 'Hold Touch Plus controllers · Stand by' : stats;
        const threat = this.dodge?.run.threat;
        const warning = run.state === 'playing' && threat && (-1 - threat.z) / threat.speed <= 2.2
            ? ['LEFT LANE', 'CENTER LANE', 'RIGHT LANE'][Math.round(threat.x / 3.2) + 1] : '';

        if ((run.state === 'won' || (run.state === 'lost' && !this.flightGame && run.score > 0)) && this._savedArcadeRun !== run.state) {
            this._savedArcadeRun = run.state;
            this.saveArcadeBest(run.score);
        }

        const key = title + sub + warning;
        if (key === this._dodgeHudKey) return;
        this._dodgeHudKey = key;
        this.setHud(title, sub, warning);
        $('dodge-status').textContent = `${title} — ${sub}${warning ? ' · ' + warning : ''}`;
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
        if (this.gazeMenuOpen) this.showMenuInfo(this.gazeControls.group, true);
        else if (this.vrMenu?.visible) this.showMenuInfo(this.vrMenu, false);
        $('scan-clue').textContent = text;
        $('scan-clue-details').hidden = !text;
        if (!text) return;
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
        $('narration').textContent = text;
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
        if (this.xrSession && (this.vrMenu.visible || this.xrSession.visibilityState !== 'visible')) return;
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
                const { x: ax, y: ay } = readThumbstick(src.gamepad);
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
            const q = this.xrHead
                ? this.dolly.quaternion.clone().multiply(this.xrHead.quaternion)
                : (this.gyroActive || this.stereoFlightLook)
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
        // The XR manager owns the eye-buffer size until the session ends.
        if (this.xrSession || this.renderer.xr.isPresenting) return;
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

    loop(frame) {
        if (document.hidden && !this.renderer.xr.isPresenting) {
            this.clock.getDelta(); this.gaze.reset(); return;
        }
        const dt = Math.min(0.05, this.clock.getDelta());
        const tracking = !this.xrSession || this.updateXRHead(frame);
        if (frame && !tracking) return false;
        if (frame && this.renderer.getContext().isContextLost()) throw new Error('The headset graphics context was lost.');
        this.remote.update();
        const camPos = this.camera.getWorldPosition(this._camPos || (this._camPos = new THREE.Vector3()));
        if (!this.arcadeMission && !this.isIntercept && this.mode !== 'dodge') this.system.update(dt, camPos);

        const questInput = this.xrSession
            ? readQuestControllers(this.xrSession, this._prevQuestInput)
            : (this._qaQuestInput || null);
        this._prevQuestInput = questInput;

        this.updateHead(dt);
        this.camera.updateWorldMatrix(true, false);
        const hudTitle = this.mode === 'dodge' ? this.arcadeName.toUpperCase() : this.hudText.title;
        const hudHint = this.isIntercept ? 'L-Trig: Shield · R-Trig: Blaster · Y: Menu' : 'A: Start/Pause · B: Recenter · Grip: Menu';

        if (this.questRig) {
            this.questRig.update(dt, questInput, {
                hudTitle,
                hudStatus: this.mode === 'dodge' ? (this.arcadeGame?.run?.status?.() || '') : this.hudText.sub,
                hudHint,
                slug: this.arcadeSlug,
                run: this.arcadeGame?.run
            });
        }

        if (this.mode === 'ride') this.ride.update(dt);
        else if (this.mode === 'dodge') {
            if (questInput && !this.vrMenu?.visible) {
                if (questInput.right.primaryJustPressed) this.onPhoneTap();
                if (questInput.right.secondaryJustPressed) this.recenterView();
                if (questInput.left.secondaryJustPressed) this.toggleVRMenu();
            }
            const before = this.dodge?.run.hits ?? this.flightGame?.run.rocksHit ?? 0;
            const suspended = !tracking || this.gazeMenuOpen ||
                Boolean(this.xrSession && (this.vrMenu.visible || this.xrSession.visibilityState !== 'visible')) ||
                (this.stereo && this.gaze.key?.startsWith('ui:'));
            let inputPayload = questInput || (this.flightGame ? this.arcadeInput() : null);
            if (this._xrRightSelectConsumed) {
                if (questInput?.right?.triggerJustPressed) {
                    inputPayload = { ...questInput, right: { ...questInput.right, triggerJustPressed: false } };
                }
                this._xrRightSelectConsumed = false;
            }
            this.arcadeGame.update(dt, this.xrHead || this.camera, this.dolly, suspended, inputPayload, this.questRig);

            const strikes = this.dodge?.run.hits ?? this.flightGame?.run.rocksHit ?? 0;
            if (strikes > before) { this.audio.blip(180); this.pulse(0.45, 90); }
            this._arcadeHudDelay -= dt;
            if (this._arcadeHudDelay <= 0) {
                this._arcadeHudDelay = 0.12;
                this.updateDodgeHud();
            }
        }
        else if (this.entry !== 'dodge') {
            if (questInput && !this.vrMenu?.visible && (questInput.left.secondaryJustPressed || questInput.left.stickJustPressed)) {
                this.toggleVRMenu();
            }
            this.flyUpdate(dt);
        }
        this.camera.updateWorldMatrix(true, false);
        this.gazeUpdate(dt);

        if (this.questRig) {
            if (this.mode === 'dodge' && this.questRig.wristHud?.mesh.visible) {
                this.questRig.wristHud.update(hudTitle, this.arcadeGame?.run?.status?.() || '', hudHint);
            }
            if (this.flightGame && this.questRig.rightHand?.controller) {
                setRayFromObject(this.raycaster, this.questRig.rightHand.controller);
                const hover = this.flightGame.pick(this.raycaster);
                this.flightGame.highlight(hover?.object);
                this.questRig.setRayDistance('right', hover ? hover.distance : 5.5);
            }
        }

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

        if (this.renderer.xr.isPresenting) {
            this.renderer.render(this.scene, this.camera);
            return Boolean(frame && tracking);
        }
        else if (this.stereo) this.stereoEffect.render(this.scene, this.camera);
        else if (this.composer) this.composer.render();
        else this.renderer.render(this.scene, this.camera);
    }

    /* ── QA helpers (window.__vr) ───────────────────────────────────── */
    qaSeek(sec) { if (this.mode !== 'ride') this.startRide(); this.clearWarning(); this.ride.seek(sec); }
    qaPreviewQuestGame(seconds = 4, fakeInput = null) {
        if (this.entry !== 'dodge' || !this.arcadeGame) return null;
        if (this.mode !== 'dodge') this.startDodge();
        this.arcadeGame.run.play();
        if (this.questRig?.leftHand && this.questRig?.rightHand) {
            for (const [hand, x] of [[this.questRig.leftHand, -0.34], [this.questRig.rightHand, 0.34]]) {
                hand.mount.visible = true;
                hand.controller.visible = true;
                hand.mount.position.set(x, -0.14, -0.52);
                hand.controller.position.set(x, -0.14, -0.52);
                hand.mount.updateMatrix();
                hand.controller.updateMatrix();
                hand.mount.updateMatrixWorld(true);
                hand.controller.updateMatrixWorld(true);
            }
            this.questRig.setToolProfile(this.arcadeSlug);
        }
        this._qaQuestInput = fakeInput || {
            left: { connected: true, stick: { x: 0, y: 0 }, trigger: 0.9, triggerPressed: true, grip: 0, gripPressed: false },
            right: { connected: true, stick: { x: 0, y: 0 }, trigger: 0.5, triggerPressed: true, grip: 0, gripPressed: false }
        };
        const steps = Math.ceil((3.1 + seconds) / 0.05);
        for (let i = 0; i < steps; i++) {
            const stepInput = fakeInput || {
                left: { connected: true, stick: { x: 0, y: 0 }, trigger: 0.9, triggerPressed: true, grip: 0, gripPressed: false },
                right: { connected: true, stick: { x: 0, y: 0 }, trigger: i === steps - 2 ? 0.9 : 0, triggerPressed: i === steps - 2, triggerJustPressed: i === steps - 2, grip: 0, gripPressed: false }
            };
            this.questRig?.update(0.05, stepInput, {
                hudTitle: this.arcadeName.toUpperCase(),
                hudStatus: this.arcadeGame.run.status(),
                hudHint: 'Meta Quest 3 Touch Plus',
                slug: this.arcadeSlug,
                run: this.arcadeGame.run
            });
            this.arcadeGame.update(0.05, this.camera, this.dolly, false, stepInput, this.questRig);
        }
        this.questRig?.update(0.05, fakeInput || {
            left: { connected: true, stick: { x: 0, y: 0 }, trigger: 0.9, triggerPressed: true },
            right: { connected: true, stick: { x: 0, y: 0 }, trigger: 0.5, triggerPressed: true }
        }, {
            hudTitle: this.arcadeName.toUpperCase(),
            hudStatus: this.arcadeGame.run.status(),
            hudHint: 'Meta Quest 3 Touch Plus',
            slug: this.arcadeSlug,
            run: this.arcadeGame.run
        });
        this.updateDodgeHud();
        return {
            slug: this.arcadeSlug,
            state: this.arcadeGame.run.state,
            status: this.arcadeGame.run.status(),
            shaderErrors: this.renderer.info.programs.filter(p => p.diagnostics?.runnable === false).length
        };
    }
    qaState() {
        return {
            mode: this.mode,
            questOnly: this.questOnly,
            slug: this.arcadeSlug || null,
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

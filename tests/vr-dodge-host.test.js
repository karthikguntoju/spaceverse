// Exercise real VRApp mode handlers without creating WebGL or a browser session.
let VRApp, THREE, DodgeGame, ArcadeFlight, InterceptGame, Quest3Rig, GazeControls, DwellSelector, nodes, core, location, doc, localStore, navigatorStub;
beforeAll(async () => {
    THREE = await import('three');
    ({ DodgeGame } = await import('../public/js/vr/dodge-game.js'));
    ({ ArcadeFlight } = await import('../public/js/vr/arcade-flight.js'));
    ({ InterceptGame } = await import('../public/js/vr/intercept-game.js'));
    ({ Quest3Rig } = await import('../public/js/vr/quest3-rig.js'));
    const { VR_GAMES, VR_ARCADE_META } = await import('../public/js/vr/arcade-run.js');
    const { questOnlyVRStatus, readThumbstick, readQuestControllers, pulseQuestController, setRayFromObject } = await import('../public/js/vr/xr-support.js');
    const { guardXRFrames } = await import('../public/js/vr/xr-frame-guard.js');
    ({ DwellSelector, GazeControls } = await import('../public/js/vr/gaze-controls.js'));
    const { setPhoneUILayer, PHONE_UI_LAYER } = await import('../public/js/vr/phone-stereo.js');
    const { readFileSync } = await import('node:fs');
    const { runInNewContext } = await import('node:vm');
    let source = readFileSync('public/js/vr/main.js', 'utf8');
    expect(source).toContain('const app = new VRApp();');
    source = source.split('const app = new VRApp();')[0].replace(/^import .*;\r?$/gm, '');
    core = { snapshot: () => ({ running: false }) };
    localStore = new Map();
    doc = { getElementById: id => {
        if (!nodes.has(id)) {
            const classes = new Set();
            nodes.set(id, { textContent: '', innerHTML: '', checked: true, style: {},
                classList: { add: v => classes.add(v), remove: v => classes.delete(v), toggle: (v, f) => (f ? classes.add(v) : classes.delete(v)), contains: v => classes.has(v) },
                setAttribute: vi.fn() });
        }
        return nodes.get(id);
    }, hasFocus: () => true, body: { classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() } }, createElement: () => ({
        getContext: () => ({ scale() {}, fillRect() {}, strokeRect() {}, fillText() {}, measureText: () => ({ width: 100 }) })
    }) };
    location = { pathname: '/games/asteroid-dodge', search: '' };
    navigatorStub = { userAgent: '', maxTouchPoints: 0 };
    VRApp = runInNewContext(`${source}\nVRApp`, { THREE, MissionCore: core, document: doc, console,
        location, GyroLook: class {}, ScreenAwake: class {}, DwellSelector,
        setPhoneUILayer, PHONE_UI_LAYER, VR_GAMES, VR_ARCADE_META, InterceptGame, Quest3Rig,
        questOnlyVRStatus, readThumbstick, readQuestControllers, pulseQuestController, setRayFromObject, guardXRFrames,
        localStorage: { getItem: k => localStore.get(k) || null, setItem: (k, v) => localStore.set(k, v) },
        navigator: navigatorStub, queueMicrotask });
});

function host() {
    nodes = new Map(); core.snapshot = () => ({ running: false });
    const app = Object.create(VRApp.prototype);
    const scene = new THREE.Scene(), dolly = new THREE.Group(), camera = new THREE.PerspectiveCamera();
    dolly.add(camera); scene.add(dolly);
    Object.assign(app, {
        mode: 'menu', entry: 'dodge', gyroOn: false, stereo: true, baseFov: 62, isTouch: true,
        scene, dolly, camera, dodge: new DodgeGame(scene), gaze: new DwellSelector(),
        gazeControls: { group: new THREE.Group(), anchor: vi.fn() },
        renderer: { xr: { isPresenting: false } },
        audio: { init: vi.fn(), setEngine: vi.fn(), setPad: vi.fn(), blip: vi.fn() },
        ride: { stop: vi.fn(), playing: false }, cockpit: { setVisible: vi.fn() },
        system: { root: new THREE.Group(), setOrbitLinesVisible: vi.fn(), setLabelsVisible: vi.fn(),
            setHighlightedOrbit: vi.fn(), pickTargets: [] },
        clearWarning: vi.fn(), updateHead: vi.fn(), updatePhoneButtons: vi.fn(), updateHudDom: vi.fn(),
        toast: vi.fn(), setHud: vi.fn(), placeAtEarth: vi.fn()
    });
    return app;
}

describe('first headset frame', () => {
    it('attaches the renderer without waiting for an optional refresh-rate request', async () => {
        const app = host();
        app.stereo = false;
        app.questOnly = true;
        app.buildVRMenu();
        app.startDodge = vi.fn();
        const reference = {};
        const session = { addEventListener: vi.fn(), updateTargetFrameRate: vi.fn(() => new Promise(() => {})) };
        navigatorStub.xr = { requestSession: vi.fn().mockResolvedValue(session) };
        Object.assign(app.renderer.xr, {
            setSession: vi.fn().mockResolvedValue(),
            setReferenceSpaceType: vi.fn(), setFramebufferScaleFactor: vi.fn(),
            getReferenceSpace: () => reference
        });
        try {
            await app.enterVR();
            expect(app.renderer.xr.setSession).toHaveBeenCalledWith(session);
            expect(session.updateTargetFrameRate).not.toHaveBeenCalled();
            expect(app.startDodge).not.toHaveBeenCalled();
            expect(app.updateXRHead({ getViewerPose: () => null })).toBe(false);
            const pose = { transform: { position: new THREE.Vector3(0.2, 0.1, 0), orientation: new THREE.Quaternion() } };
            expect(app.updateXRHead({ getViewerPose: () => pose })).toBe(true);
            expect(app.xrHead.position.x).toBe(0.2);
            expect(app.startDodge).toHaveBeenCalledOnce();
        } finally {
            app.xrGuard?.stop();
            delete navigatorStub.xr;
        }
    });

    it.each(['explore', 'ride'])('places the %s launch menu in front of the first tracked headset pose', entry => {
        const app = host();
        app.entry = entry;
        app.renderer.xr.isPresenting = true;
        app.renderer.xr.getReferenceSpace = () => ({});
        app.xrHead = new THREE.Object3D();
        app.buildVRMenu();
        app.xrShowLauncher = true;
        const position = new THREE.Vector3(0.3, 0.2, -0.1);
        const orientation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
        expect(app.updateXRHead({ getViewerPose: () => null })).toBe(false);
        expect(app.vrMenu.visible).toBe(false);
        expect(app.updateXRHead({ getViewerPose: () => ({ transform: { position, orientation } }) })).toBe(true);
        expect(app.vrMenu.visible).toBe(true);
        const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(orientation);
        expect(app.vrMenu.position.distanceTo(position.clone().addScaledVector(ahead, 1.75))).toBeLessThan(0.001);
    });

    it('reopens the Quest arcade launcher on exit and preserves the paused run for re-entry', () => {
        const app = host();
        app.questOnly = true; app.mode = 'dodge'; app.xrSession = {};
        app.vrMenu = new THREE.Group(); app.onResize = vi.fn();
        const pause = vi.spyOn(app.arcadeGame.run, 'pause');
        app.endXR(app.xrSession);
        expect(pause).toHaveBeenCalledOnce();
        expect(app.mode).toBe('dodge');
        expect(doc.getElementById('mode-menu').classList.contains('show')).toBe(true);
        expect(app.xrReloadNeeded).toBeFalsy();
        expect(app.xrSession).toBeNull();
    });

    it('offers a working retry even when renderer setup has never settled', async () => {
        const app = host();
        app.stereo = false; app.vrMenu = new THREE.Group(); app.onResize = vi.fn();
        const session = new EventTarget();
        navigatorStub.xr = { requestSession: vi.fn().mockResolvedValue(session) };
        let finishSetup;
        Object.assign(app.renderer.xr, {
            setSession: () => new Promise(resolve => { finishSetup = resolve; }),
            setReferenceSpaceType: vi.fn(), setFramebufferScaleFactor: vi.fn()
        });
        location.reload = vi.fn();
        const launch = app.enterVR();
        try {
            await vi.waitFor(() => expect(finishSetup).toBeTypeOf('function'));
            session.dispatchEvent(new Event('end'));
            await Promise.resolve();
            expect(doc.getElementById('enter-vr').disabled).toBe(false);
            expect(doc.getElementById('quest3-launch').textContent).toMatch(/Reload/);
            await app.enterVR();
            expect(location.reload).toHaveBeenCalledOnce();
            expect(navigatorStub.xr.requestSession).toHaveBeenCalledOnce();
        } finally {
            finishSetup?.(); await launch;
            delete location.reload; delete navigatorStub.xr;
        }
    });

    it('leaves the eye buffer alone when the browser window changes size during XR', () => {
        const app = host();
        app.xrSession = {};
        app.renderer.setSize = vi.fn();
        app.renderer.setPixelRatio = vi.fn();
        app.onResize();
        expect(app.renderer.setSize).not.toHaveBeenCalled();
        expect(app.renderer.setPixelRatio).not.toHaveBeenCalled();
    });
});

describe('Dodge mode wiring', () => {
    it('launches the arcade game and waits for a hands-free Start selection', () => {
        const app = host();
        app.startDodge();
        expect(app.mode).toBe('dodge');
        expect(app.dodge.root.visible).toBe(true);
        expect(app.system.root.visible).toBe(false);
        expect(app.dodge.run.state).toBe('ready');
        expect(app.gazeOptions()[0].title).toBe('MENU');
        app.gazeAction('menu');
        expect(app.gazeOptions()[0].title).toBe('START DODGE');
        app.gazeAction('primary'); expect(app.dodge.run.state).toBe('countdown');
        expect(app.gazeMenuOpen).toBe(false);
        app.gazeAction('menu'); expect(app.dodge.run.state).toBe('paused');
        expect(app.gazeOptions()[0].title).toBe('RESUME GAME');
        app.gazeAction('primary'); expect(app.dodge.run.state).toBe('countdown');
    });
    it('pauses for Options and restarts without offering the solar system', () => {
        const app = host(); app.startDodge(); app.onPhoneTap();
        app.gazeAction('menu');
        app.gazeAction('options'); expect(app.dodge.run.state).toBe('paused');
        expect(app.gazeOptions().map(o => o.action)).toEqual(['back', 'dodge', 'dodge-level', 'dodge-sense', 'exit']);
        app.gazeAction('dodge');
        expect(app.mode).toBe('dodge'); expect(app.system.root.visible).toBe(false);
        expect(app.dodge.run.state).toBe('ready');
        app.stereo = false; app.toMenu();
        expect(app.mode).toBe('menu'); expect(app.entry).toBe('dodge');
        expect(app.dodge.root.visible).toBe(false);
        expect(nodes.get('dodge-hud').classList.contains('show')).toBe(false);
    });
    it('replays a completed game from gaze without submitting a mission score', () => {
        const app = host(); app.startDodge();
        app.dodge.run.state = 'won'; app.dodge.run.elapsed = 60; app.dodge.run.dodged = 35;
        app.gazeAction('menu');
        expect(app.gazeOptions()[0].title).toBe('PLAY AGAIN');
        app.gazeAction('primary');
        expect(app.dodge.run.state).toBe('countdown'); expect(app.dodge.run.elapsed).toBe(0);
        expect(app.dodge.run.dodged).toBe(0);
    });
    it('does not abandon an active scored mission to start a practice game', () => {
        const app = host(); app.mode = 'mission'; core.snapshot = () => ({ running: true });
        app.startDodge();
        expect(app.mode).toBe('mission'); expect(app.toast).toHaveBeenCalledOnce();
    });
    it('ignores planet scans during the game', () => {
        const app = host(); app.startDodge();
        expect(() => app.showBody('earth', true)).not.toThrow();
        expect(() => app.pickAt(10, 10)).not.toThrow();
        expect(app.mode).toBe('dodge');
    });
    it('does not offer or start Dodge from the solar-system entry', () => {
        const app = host(); app.entry = 'explore'; app.mode = 'explore'; app.gazeMenuOpen = true; app.gazeOptionsOpen = true;
        expect(app.gazeOptions().map(o => o.action)).toEqual([
            'back', 'next-world', 'low-orbit', 'toggle-cockpit', 'scan-hunt', 'exit'
        ]);
        app.startDodge();
        expect(app.mode).toBe('explore');
    });
    it('hides all actions behind Menu in both the game and solar system', () => {
        for (const entry of ['dodge', 'explore']) {
            const app = host(); app.entry = entry; app.mode = entry;
            expect(app.gazeOptions().map(o => o.action)).toEqual(['menu']);
            app.gazeAction('menu');
            expect(app.gazeOptions().map(o => o.action)).toEqual(['primary', 'options', 'recenter', 'close']);
            app.gazeAction('close');
            expect(app.gazeOptions().map(o => o.action)).toEqual(['menu']);
            expect(app.gaze.blocked).toBe(true);
        }
    });
    it('dismisses an open menu on looking forward without resuming a paused game', () => {
        const app = host(); app.startDodge(); app.onPhoneTap(); app.gazeAction('menu');
        app.gazeControls.lookPitch = () => 0;
        app.gazeControls.updateDock = vi.fn();
        app.gazeControls.setOptions = vi.fn();
        app.gazeControls.hit = () => null;
        app.gazeControls.highlight = vi.fn();
        app.reticle = new THREE.Group();
        app.reticleFill = { geometry: new THREE.BufferGeometry() };
        app.pointer = new THREE.Vector2(); app.raycaster = new THREE.Raycaster();
        app.gazeUpdate(0.016);
        expect(app.gazeMenuOpen).toBe(false);
        expect(app.gazeOptionsOpen).toBe(false);
        expect(app.gazeControls.updateDock).toHaveBeenCalledWith(app.camera, false);
        expect(app.gazeControls.setOptions).toHaveBeenCalledWith([{ action: 'menu', title: 'MENU', hint: 'Hold gaze to open' }]);
        expect(app.dodge.run.state).toBe('paused');
    });
    it.each([
        ['explore', ['explore', 'scan-hunt', 'next-world', 'toggle-cockpit']],
        ['ride', ['ride', 'explore']],
        ['dodge', ['dodge']]
    ])('offers the matching headset controls for the %s entry', (entry, actions) => {
        const app = host(); app.entry = entry; app.buildVRMenu();
        expect(app.vrMenuItems.map(item => item.userData.action)).toEqual(actions);
    });
    it.each([
        ['/games/asteroid-dodge', '', 'dodge'], ['/games/asteroid-dodge/', '?mode=ride', 'dodge'],
        ['/GAMES/ASTEROID-DODGE', '', 'dodge'], ['/games/lunar-landing', '', 'dodge'],
        ['/games/space-rescue/', '', 'dodge'], ['/vr-solar-system', '', 'explore'],
        ['/vr-ride', '', 'ride'], ['/vr-working', '?mode=ride', 'ride']
    ])('resolves the correct experience for %s %s', (pathname, search, entry) => {
        location.pathname = pathname; location.search = search;
        expect(new VRApp().entry).toBe(entry);
    });
});

describe('space operations input', () => {
    beforeEach(() => vi.stubGlobal('document', doc));
    afterEach(() => vi.unstubAllGlobals());

    function landing() {
        const app = host();
        app.dodge = null;
        app.flightGame = new ArcadeFlight(app.scene, 'lunar-landing');
        app.arcadeMission = app.flightGame.run.config;
        app.gazeControls = new GazeControls(app.dolly);
        app.reticle = new THREE.Group();
        app.reticleFill = { geometry: new THREE.BufferGeometry() };
        app.pointer = new THREE.Vector2();
        app.raycaster = new THREE.Raycaster();
        app.startDodge();
        app.onPhoneTap();
        for (let i = 0; i < 60; i++) app.flightGame.run.update(0.05);
        return app;
    }

    it('fires the brake through an actual split-screen gaze ray and holds it until looking away', () => {
        const app = landing();
        app.scene.updateMatrixWorld(true);
        app.gazeUpdate(0.05);
        const target = app.flightGame.targets[0].getWorldPosition(new THREE.Vector3());
        app.camera.lookAt(target);
        app.camera.updateWorldMatrix(true, false);
        for (let i = 0; i < 30; i++) app.gazeUpdate(0.05);
        expect(app.flightGame.run.burn).toBeGreaterThan(0);
        expect(app.arcadeInput().brake).toBe(true);
        app.camera.quaternion.identity();
        app.camera.updateWorldMatrix(true, false);
        app.gazeUpdate(0.05);
        expect(app.gaze.key).toBeNull();
    });

    it('fires the same brake with a Quest controller ray and maps up from the left stick', () => {
        const app = landing();
        app.xrSession = { inputSources: [{ handedness: 'left', gamepad: { axes: [0, 0, 0.45, -0.6] } }] };
        app.buildVRMenu();
        const controller = new THREE.PerspectiveCamera();
        controller.lookAt(app.flightGame.targets[0].getWorldPosition(new THREE.Vector3()));
        app.onControllerSelect(controller);
        expect(app.flightGame.run.state).toBe('playing');
        expect(app.flightGame.run.burn).toBeGreaterThan(0);
        expect(app.arcadeInput()).toEqual({ x: 0.45, y: 0.6 });
    });
});

describe('split-screen menu without a motion sensor', () => {
    beforeEach(() => vi.stubGlobal('document', doc));
    afterEach(() => vi.unstubAllGlobals());

    it.each(['explore', 'mission', 'ride'])('opens after a downward drag in %s mode', mode => {
        const app = host();
        Object.assign(app, {
            entry: mode === 'ride' ? 'ride' : 'explore', mode,
            yaw: 0.6, pitch: 0, lookYaw: 0, lookPitch: 0,
            ride: { pause: vi.fn() },
            gazeControls: new GazeControls(app.dolly),
            reticle: new THREE.Group(),
            reticleFill: { geometry: new THREE.BufferGeometry() },
            pointer: new THREE.Vector2(), raycaster: new THREE.Raycaster()
        });
        delete app.updateHead;
        // The head stops moving as soon as the user releases their drag.
        app.lookDelta(0, 55 * Math.PI / 180);
        for (let frame = 0; frame < 90; frame++) {
            app.updateHead(1 / 60);
            app.scene.updateMatrixWorld(true);
            app.gazeUpdate(1 / 60);
        }
        expect(app.gazeMenuOpen).toBe(true);
    });
});

describe('immersive headset controls', () => {
    it.each(['Quest', 'Cardboard'])('keeps segment details on the cockpit display during a %s ride', viewer => {
        const app = host();
        app.entry = 'ride';
        app.renderer.xr.isPresenting = viewer === 'Quest';
        app.stereo = viewer === 'Cardboard';
        const segment = { title: 'INNER RUN', subtitle: 'Crossing Mars orbit.', dur: 34 };
        Object.assign(app.ride, { segments: [segment], prepare: vi.fn(), start: vi.fn(), speedNorm: 0.4 });
        Object.assign(app.cockpit, { reset: vi.fn(), setSegment: vi.fn() });
        delete app.setHud;
        app.startRide();
        app.onSegment(segment, 0, 1);
        for (let i = 0; i < 12; i++) app.onRideProgress(0.5);
        expect(app.cockpit.setSegment).toHaveBeenLastCalledWith(segment.title, segment.subtitle, 0, 1,
            [{ title: segment.title, dur: segment.dur }]);
        expect(doc.getElementById('ride-bar-fill').style.width).toBe('50.0%');
        expect(app.hudText.title).toBe(segment.title);
    });

    it.each(['Quest', 'Cardboard'])('keeps the Scan Hunt clue inside the requested %s menu', viewer => {
        const app = host();
        app.buildVRInfoPanel();
        app.mode = 'mission';
        app.missionObjective = 'Find the world with the Great Red Spot.';
        app.drawVRInfoPanel = vi.fn();
        expect(app.vrInfoPanel.parent).toBeNull();
        if (viewer === 'Cardboard') {
            app.gazeAction('menu');
            expect(app.vrInfoPanel.parent).toBe(app.gazeControls.group);
            expect(app.vrInfoPanel.visible).toBe(true);
            app.closeGazeMenu();
            expect(app.vrInfoPanel.visible).toBe(false);
        } else {
            app.renderer.xr.isPresenting = true;
            app.buildVRMenu();
            app.toggleVRMenu();
            expect(app.vrInfoPanel.parent).toBe(app.vrMenu);
            expect(app.vrMenu.visible).toBe(true);
            app.toggleVRMenu();
            expect(app.vrMenu.visible).toBe(false);
        }
        expect(app.drawVRInfoPanel).toHaveBeenCalledWith(expect.objectContaining({ fact: app.missionObjective }));
    });

    it('pauses a running ride when opening its menu and ignores missed selections', () => {
        const app = host();
        Object.assign(app, {
            mode: 'ride', entry: 'ride', stereo: false,
            xrHead: new THREE.Object3D(), raycaster: new THREE.Raycaster(),
            ride: { playing: true, time: 2, total: 90, pause: vi.fn(), resume: vi.fn(), skipSegment: vi.fn() }
        });
        app.renderer.xr.isPresenting = true;
        app.xrHead.position.set(0.2, 0.1, -0.1);
        app.buildVRMenu();
        app.toggleVRMenu();
        expect(app.ride.pause).toHaveBeenCalledOnce();
        expect(app.vrMenu.position.toArray()).toEqual([0.2, 0.1, -1.85]);
        app.onControllerSelect(new THREE.Group().translateX(20));
        expect(app.ride.skipSegment).not.toHaveBeenCalled();
        expect(app.vrMenu.visible).toBe(true);
        const resume = app.vrMenuItems.find(item => item.userData.action === 'ride-resume');
        const controller = new THREE.PerspectiveCamera();
        controller.lookAt(resume.getWorldPosition(new THREE.Vector3()));
        app.onControllerSelect(controller);
        expect(app.ride.resume).toHaveBeenCalledOnce();
        expect(app.vrMenu.visible).toBe(false);
        app.toggleVRMenu();
        app.toggleVRMenu();
        expect(app.vrMenu.visible).toBe(false);
    });

    it('centers Dodge steering on the initial headset heading, including across 180 degrees', () => {
        const app = host();
        const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -3.13, 0, 'YXZ'));
        app.dodge.start(app.dolly, quaternion);
        const steer = vi.spyOn(app.dodge.run, 'update');
        app.dodge.update(0.016, { quaternion }, app.dolly);
        expect(steer.mock.calls[0][1]).toBeCloseTo(0);
        quaternion.setFromEuler(new THREE.Euler(0, 3.13, 0, 'YXZ'));
        app.dodge.update(0.016, { quaternion }, app.dolly);
        expect(Math.abs(steer.mock.calls[1][1])).toBeLessThan(0.1);
    });

    it('enforces Meta Quest 3 only on VR arcade routes, blocks Phone VR, and persists best scores', async () => {
        location.pathname = '/games/orbital-intercept';
        const qApp = new VRApp();
        expect(qApp.questOnly).toBe(true);
        expect(qApp.isIntercept).toBe(true);
        expect(qApp.entry).toBe('dodge');

        const app = host();
        app.questOnly = true;
        app.stereo = false;
        app.arcadeSlug = 'orbital-intercept';
        app.isIntercept = true;
        app.dodge = null;
        app.interceptGame = new InterceptGame(app.scene);
        app.arcadeMeta = { title: 'Orbital Intercept', tiers: [2500, 7500, 16000], questControls: { left: ['L'], right: ['R'] } };
        app.configureArcadeLauncher();
        expect(nodes.get('quest3-title').textContent).toBe('Orbital Intercept');
        expect(nodes.get('quest3-left-list').innerHTML).toContain('<li>L</li>');

        await app.enterPhoneVR();
        expect(app.stereo).toBe(false);
        expect(app.toast).toHaveBeenCalled();

        app.startDodge();
        app.interceptGame.run.state = 'won';
        app.interceptGame.run.score = 8850;
        app.updateDodgeHud();
        expect(localStore.get('spaceverse.arcade.orbital-intercept.best')).toBe('8850');
    });
});

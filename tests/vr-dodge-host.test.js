// Exercise real VRApp mode handlers without creating WebGL or a browser session.
let VRApp, THREE, DodgeGame, DwellSelector, nodes, core, location;
beforeAll(async () => {
    THREE = await import('three');
    ({ DodgeGame } = await import('../public/js/vr/dodge-game.js'));
    ({ DwellSelector } = await import('../public/js/vr/gaze-controls.js'));
    const { readFileSync } = await import('node:fs');
    const { runInNewContext } = await import('node:vm');
    let source = readFileSync('public/js/vr/main.js', 'utf8');
    expect(source).toContain('const app = new VRApp();');
    source = source.split('const app = new VRApp();')[0].replace(/^import .*;\r?$/gm, '');
    core = { snapshot: () => ({ running: false }) };
    const doc = { getElementById: id => {
        if (!nodes.has(id)) {
            const classes = new Set();
            nodes.set(id, { textContent: '', checked: true,
                classList: { add: v => classes.add(v), remove: v => classes.delete(v), contains: v => classes.has(v) },
                setAttribute: vi.fn() });
        }
        return nodes.get(id);
    }, hasFocus: () => true, body: { classList: { remove: vi.fn() } }, createElement: () => ({
        getContext: () => ({ scale() {}, fillRect() {}, strokeRect() {}, fillText() {}, measureText: () => ({ width: 100 }) })
    }) };
    location = { pathname: '/games/asteroid-dodge', search: '' };
    VRApp = runInNewContext(`${source}\nVRApp`, { THREE, MissionCore: core, document: doc, console,
        location, GyroLook: class {}, ScreenAwake: class {}, DwellSelector,
        setPhoneUILayer: () => {}, PHONE_UI_LAYER: 3,
        navigator: { userAgent: '', maxTouchPoints: 0 } });
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
        renderer: { xr: { isPresenting: false } }, vrHud: { visible: false },
        audio: { init: vi.fn(), setEngine: vi.fn(), setPad: vi.fn(), blip: vi.fn() },
        ride: { stop: vi.fn(), playing: false }, cockpit: { setVisible: vi.fn() },
        system: { root: new THREE.Group(), setOrbitLinesVisible: vi.fn(), setLabelsVisible: vi.fn() },
        clearWarning: vi.fn(), updateHead: vi.fn(), updatePhoneButtons: vi.fn(), updateHudDom: vi.fn(),
        toast: vi.fn(), setHud: vi.fn(), placeAtEarth: vi.fn()
    });
    return app;
}

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
        expect(app.gazeOptions().map(o => o.action)).toEqual(['back', 'dodge', 'exit']);
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
        expect(app.gazeOptions().map(o => o.action)).toEqual(['back', 'scan-hunt', 'exit']);
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
        ['explore', ['explore', 'scan-hunt']], ['ride', ['ride']], ['dodge', ['dodge']]
    ])('keeps the %s headset picker scoped to its own experience', (entry, actions) => {
        const app = host(); app.entry = entry; app.buildVRMenu();
        expect(app.vrMenuItems.map(item => item.userData.action)).toEqual(actions);
    });
    it.each([
        ['/games/asteroid-dodge', '', 'dodge'], ['/games/asteroid-dodge/', '?mode=ride', 'dodge'],
        ['/GAMES/ASTEROID-DODGE', '', 'dodge'], ['/vr-solar-system', '', 'explore'],
        ['/vr-ride', '', 'ride'], ['/vr-working', '?mode=ride', 'ride']
    ])('resolves the correct experience for %s %s', (pathname, search, entry) => {
        location.pathname = pathname; location.search = search;
        expect(new VRApp().entry).toBe(entry);
    });
});

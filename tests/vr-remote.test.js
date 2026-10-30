let RemoteBindings, RemoteInput;
beforeAll(async () => ({ RemoteBindings, RemoteInput } = await import('../public/js/vr/remote-input.js')));

describe('Bluetooth remote bindings', () => {
    it('loads only known actions and valid input tokens', () => {
        const bindings = new RemoteBindings({ primary: 'key:Enter', scan: '<script>', unknown: 'mouse:0' });
        expect(bindings.map).toEqual({ primary: 'key:Enter' });
        expect(new RemoteBindings(null).map).toEqual({});
    });
    it('moves a duplicate input to the newly assigned action', () => {
        const bindings = new RemoteBindings({ primary: 'key:Enter' });
        expect(bindings.assign('scan', 'key:Enter')).toBe(true);
        expect(bindings.map).toEqual({ scan: 'key:Enter' });
        expect(bindings.assign('invalid', 'key:Enter')).toBe(false);
    });
    it('fires a toggle only once while a button is held, even after cooldown', () => {
        const fired = [];
        const bindings = new RemoteBindings({ primary: 'key:Enter' }, a => fired.push(a));
        bindings.press('key:Enter', 0);
        bindings.press('key:Enter', 1000);
        expect(fired).toEqual(['primary']);
        bindings.release('key:Enter');
        bindings.press('key:Enter', 1001);
        expect(fired).toEqual(['primary', 'primary']);
    });
    it('bounds scroll movement and stops 180ms after the last scroll event', () => {
        const bindings = new RemoteBindings({ forward: 'wheel:up', backward: 'wheel:down' });
        bindings.press('wheel:up', 100, true);
        expect(bindings.movement(200)).toEqual({ x: 0, z: -1 });
        bindings.press('wheel:up', 210, true);
        expect(bindings.movement(389).z).toBe(-1);
        expect(bindings.movement(390).z).toBe(0);
    });
    it('releases held motion on disconnect, blur, or reassignment', () => {
        const bindings = new RemoteBindings({ left: 'pad:test:axis:0:-' });
        bindings.press('pad:test:axis:0:-', 0);
        expect(bindings.movement(1000).x).toBe(-1);
        bindings.releaseAll();
        expect(bindings.movement(1001).x).toBe(0);
        bindings.press('pad:test:axis:0:-', 1002);
        bindings.assign('scan', 'mouse:0');
        expect(bindings.movement(1003).x).toBe(0);
    });
    it('does not consume unassigned inputs', () => {
        expect(new RemoteBindings().press('key:KeyW', 0)).toBe(false);
    });
    it('debounces scroll mapped to a discrete action', () => {
        const fired = [];
        const bindings = new RemoteBindings({ primary: 'wheel:up' }, a => fired.push(a));
        for (const t of [0, 10, 20, 50, 200, 400]) bindings.press('wheel:up', t, true);
        expect(fired).toHaveLength(1);
        bindings.press('wheel:up', 601, true);
        expect(fired).toHaveLength(2);
    });
});

describe('browser gamepad polling', () => {
    let remote, pads, received;
    beforeEach(() => {
        pads = []; received = [];
        vi.stubGlobal('navigator', { getGamepads: () => pads });
        vi.stubGlobal('document', { hidden: false });
        remote = Object.create(RemoteInput.prototype);
        Object.assign(remote, {
            dialog: { open: false }, active: () => true, previous: new Set(),
            bindings: new RemoteBindings({ forward: 'pad:test:axis:0:+' }),
            receive(token) { received.push(token); this.bindings.press(token, 0); }
        });
    });
    afterEach(() => vi.unstubAllGlobals());
    it('detects button edges without retriggering a held trigger', () => {
        pads = [{ id: 'test', buttons: [{ pressed: true, value: 1 }], axes: [] }];
        remote.update(); remote.update();
        expect(received).toEqual(['pad:test:button:0']);
        pads[0].buttons[0].pressed = false; pads[0].buttons[0].value = 0;
        remote.update();
        pads[0].buttons[0].pressed = true;
        remote.update();
        expect(received).toHaveLength(2);
    });
    it('uses a deadzone and releases joystick motion on disconnect', () => {
        pads = [{ id: 'test', buttons: [], axes: [0.1] }]; remote.update();
        expect(received).toEqual([]);
        pads[0].axes[0] = 0.8; remote.update();
        expect(remote.bindings.movement(1).z).toBe(-1);
        pads[0].axes[0] = 0.5; remote.update();
        expect(received).toHaveLength(1);
        pads = []; remote.update();
        expect(remote.bindings.movement(2).z).toBe(0);
    });
    it('does not poll normal gamepads during WebXR or other inactive states', () => {
        remote.active = () => false;
        pads = [{ id: 'test', buttons: [{ pressed: true }], axes: [1] }];
        remote.update();
        expect(received).toEqual([]);
    });
    it('continues diagnostics in the menu when the panel is open', () => {
        remote.active = () => false; remote.dialog.open = true; remote.gamepads = { textContent: '' };
        pads = [{ id: 'test', buttons: [], axes: [-1] }]; remote.update();
        expect(received).toEqual(['pad:test:axis:0:-']);
        expect(remote.gamepads.textContent).toContain('Connected does not mean');
    });
});

describe('remote learning and event routing', () => {
    let remote, actions, store;
    beforeEach(() => {
        actions = []; store = new Map();
        vi.stubGlobal('localStorage', { setItem: (key, value) => store.set(key, value) });
        vi.stubGlobal('document', { getElementById: () => ({ textContent: '' }) });
        remote = Object.create(RemoteInput.prototype);
        Object.assign(remote, {
            dialog: { open: true }, active: () => true, learning: 'primary',
            events: [], counts: { key: 0, mouse: 0, wheel: 0, pad: 0 },
            log: { textContent: '' }, status: { textContent: '' }, blockedKeys: new Set(),
            bindings: new RemoteBindings({}, action => actions.push(action)),
            cancelLearning() { this.learning = null; }, refreshRows() {}
        });
    });
    afterEach(() => vi.unstubAllGlobals());
    it('learns a trigger without running its action and persists the mapping', () => {
        expect(remote.receive('mouse:0')).toBe(true);
        expect(remote.bindings.map.primary).toBe('mouse:0');
        expect(remote.learning).toBe(null);
        expect(actions).toEqual([]);
        expect(JSON.parse(store.get('spaceverse.remote.v1'))).toEqual({ primary: 'mouse:0' });
        remote.dialog.open = false;
        remote.receive('mouse:0');
        expect(actions).toEqual(['primary']);
    });
    it('does not learn keyboard repeat events', () => {
        remote.receive('key:Enter', false, true);
        expect(remote.learning).toBe('primary');
        expect(remote.bindings.map).toEqual({});
        expect(remote.counts.key).toBe(0);
    });
    it('captures scroll diagnostics without starting flight', () => {
        remote.learning = null;
        remote.bindings.assign('forward', 'wheel:up');
        remote.receive('wheel:up', true);
        expect(remote.counts.wheel).toBe(1);
        expect(remote.log.textContent).toContain('wheel up');
        expect(remote.bindings.movement(1)).toEqual({ x: 0, z: 0 });
    });
    it('reports blocked storage while retaining a working in-memory mapping', () => {
        vi.stubGlobal('localStorage', { setItem() { throw new Error('blocked'); } });
        remote.receive('key:Enter');
        expect(remote.status.textContent).toContain('this visit only');
        expect(remote.bindings.map.primary).toBe('key:Enter');
    });
    it('does not capture typing into visible form controls during play', () => {
        remote.dialog.open = false;
        const target = { closest: () => ({ getClientRects: () => [{}] }) };
        remote.keyDown({ code: 'KeyA', target });
        expect(remote.bindings.map).toEqual({});
        expect(actions).toEqual([]);
    });
    it('routes assigned keys from a now-hidden launcher without legacy shortcuts', () => {
        remote.dialog.open = false; remote.bindings.assign('primary', 'key:Enter');
        let prevented = false, stopped = false;
        remote.keyDown({ code: 'Enter', target: { closest: () => ({ getClientRects: () => [] }) },
            cancelable: true, preventDefault() { prevented = true; }, stopImmediatePropagation() { stopped = true; } });
        expect(actions).toEqual(['primary']);
        expect(prevented && stopped).toBe(true);
    });
    it('bounds diagnostic history', () => {
        remote.learning = null;
        for (let i = 0; i < 100; i++) remote.receive('wheel:down', true);
        expect(remote.events).toHaveLength(12);
        expect(remote.counts.wheel).toBe(100);
    });
});

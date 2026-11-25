const fs = require('node:fs');
const vm = require('node:vm');

let THREE, QuestScreen, arcadeKeys, immersiveVRStatus, readThumbstick;

beforeAll(async () => {
    THREE = await import('three');
    ({ arcadeKeys } = await import('../public/js/arcade/quest-input.js'));
    ({ immersiveVRStatus, readThumbstick } = await import('../public/js/vr/xr-support.js'));
    const source = fs.readFileSync('public/js/arcade/quest-screen.js', 'utf8')
        .replace(/^import .*;\r?$/gm, '').replace(/^export /gm, '');
    QuestScreen = vm.runInNewContext(source + '\nQuestScreen', { THREE });
});

describe('Quest headset and Touch detection', () => {
    it('offers immersive VR only on a secure, capable browser', async () => {
        const xr = { isSessionSupported: vi.fn().mockResolvedValue(true) };
        expect(await immersiveVRStatus(xr, false)).toMatchObject({ available: false });
        expect(xr.isSessionSupported).not.toHaveBeenCalled();
        expect(await immersiveVRStatus(undefined, true)).toMatchObject({ available: false });
        expect(await immersiveVRStatus(xr, true)).toMatchObject({ available: true });
        expect(xr.isSessionSupported).toHaveBeenCalledWith('immersive-vr');
    });

    it('separates stick axes from touchpad axes and maps game-specific buttons', () => {
        const pad = (axes, ...pressed) => ({ axes, buttons: Array.from({ length: 6 }, (_, i) => ({ pressed: pressed.includes(i) })) });
        const sources = [
            { handedness: 'left', gamepad: pad([1, 0, -0.6, 0.55], 4, 5) },
            { handedness: 'right', gamepad: pad([0, 0, 0, 0], 4, 5) }
        ];
        expect(arcadeKeys(sources, 'planet-defense')).toEqual(new Set(['ArrowLeft', 'ArrowDown', 'Space', 'Digit1', 'Digit2', 'Digit3']));
        expect(arcadeKeys(sources, 'slingshot-golf')).toContain('KeyR');
        expect(arcadeKeys([], 'planet-defense')).toEqual(new Set());
        expect(readThumbstick(pad([0.04, 0.05]))).toEqual({ x: 0, y: 0 });
    });
});

describe('Quest arcade virtual screen', () => {
    it('maps a controller ray to the canvas and releases a drag at its last position', () => {
        const screen = Object.create(QuestScreen.prototype);
        Object.assign(screen, {
            arcade: { g: { w: 1440, h: 810 }, snapshot: () => ({ playing: true }) },
            session: { visibilityState: 'visible' },
            screen: new THREE.Mesh(new THREE.PlaneGeometry(2.35, 1.7625), new THREE.MeshBasicMaterial()),
            ray: new THREE.Raycaster(), pointer: vi.fn()
        });
        screen.screen.position.z = -2.45;
        screen.screen.updateMatrixWorld(true);
        const controller = new THREE.Object3D();
        // The header is shorter than the footer, so the playfield's center
        // lies slightly above the center of the full panel.
        controller.position.y = 1.7625 * 24 / 960;
        screen.select(controller);
        const coords = screen.drag?.coords;
        expect(coords?.u).toBeCloseTo(0.5);
        expect(coords?.v).toBeCloseTo(0.5);
        expect(screen.pointer).toHaveBeenCalledWith('pointerdown', coords, true);
        expect(screen.drag.controller).toBe(controller);
        screen.release();
        expect(screen.pointer).toHaveBeenLastCalledWith('pointerup', coords);
        expect(screen.drag).toBeNull();
    });

    it('runs panel buttons without sending an extra pointer press to the game', () => {
        const screen = Object.create(QuestScreen.prototype);
        Object.assign(screen, {
            arcade: { g: { w: 800, h: 600 }, start: vi.fn(), snapshot: () => ({ playing: false, paused: false }) },
            session: { visibilityState: 'visible' },
            hit: () => ({ x: 100, y: 887 }), pointer: vi.fn()
        });
        screen.select({});
        expect(screen.arcade.start).toHaveBeenCalledOnce();
        expect(screen.pointer).not.toHaveBeenCalled();
    });
});

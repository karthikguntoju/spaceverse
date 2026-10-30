let THREE, PhoneStereoEffect, PHONE_UI_LAYER, setPhoneUILayer, GazeControls, phoneEyeLayout, phoneLensMask, normalizeViewerSettings;
beforeAll(async () => {
    THREE = await import('three');
    ({ PhoneStereoEffect, PHONE_UI_LAYER, setPhoneUILayer, phoneEyeLayout, phoneLensMask, normalizeViewerSettings } = await import('../public/js/vr/phone-stereo.js'));
    ({ GazeControls } = await import('../public/js/vr/gaze-controls.js'));
});

function mockRenderer() {
    const viewport = new THREE.Vector4(2, 3, 1600, 800);
    const scissor = new THREE.Vector4(4, 5, 1500, 700);
    const draws = [];
    const clearColor = new THREE.Color('#123456');
    const renderer = {
        autoClear: true, scissorTest: false, clearAlpha: 0.5, draws,
        getClearColor: target => target.copy(clearColor),
        getClearAlpha: () => renderer.clearAlpha,
        setClearColor: (color, alpha) => { clearColor.set(color); renderer.clearAlpha = alpha; },
        getSize: target => target.set(1600, 800),
        setSize: vi.fn(), clear: vi.fn(), clearDepth: vi.fn(),
        getViewport: target => target.copy(viewport),
        getScissor: target => target.copy(scissor),
        getScissorTest: () => renderer.scissorTest,
        setScissorTest: state => { renderer.scissorTest = state; },
        setViewport: (...args) => args[0]?.isVector4 ? viewport.copy(args[0]) : viewport.set(...args),
        setScissor: (...args) => args[0]?.isVector4 ? scissor.copy(args[0]) : scissor.set(...args),
        render: vi.fn((scene, camera) => {
            draws.push({
                world: camera.matrixWorld.clone(), projection: camera.projectionMatrix.clone(),
                layers: camera.layers.mask, viewport: viewport.clone(),
                background: scene.background, autoClear: renderer.autoClear
            });
        })
    };
    return renderer;
}

function project(point, draw) {
    return point.clone().applyMatrix4(draw.world.clone().invert()).applyMatrix4(draw.projection);
}

describe('phone stereo interface alignment', () => {
    let scene, camera, renderer, effect;
    beforeEach(() => {
        scene = new THREE.Scene();
        scene.background = new THREE.Color('#03060f');
        camera = new THREE.PerspectiveCamera(62, 2, 0.1, 6000);
        scene.add(camera);
        renderer = mockRenderer();
        effect = new PhoneStereoEffect(renderer);
    });
    it('gives controls identical eye-relative coordinates while preserving stereo world depth', () => {
        effect.render(scene, camera);
        const [left, right, uiLeft, uiRight] = renderer.draws;
        const button = new THREE.Vector3(0, -0.32, -1.6);
        // Demonstrate the previous mismatch, and verify the aligned overlay.
        expect(Math.abs(project(button, left).x - project(button, right).x)).toBeGreaterThan(0.01);
        expect(project(button, uiLeft).distanceTo(project(button, uiRight))).toBeCloseTo(0, 12);
        expect(left.world.elements[12]).toBeCloseTo(-0.032);
        expect(right.world.elements[12]).toBeCloseTo(0.032);
        expect(uiLeft.world.elements[12]).toBe(0);
        expect(uiLeft.projection.elements[5] / uiLeft.projection.elements[0]).toBeCloseTo(672 / 768);
    });
    it('keeps matching controls after head rotation and travel', () => {
        camera.position.set(120, 30, -80);
        camera.rotation.set(-0.25, 0.6, 0.12);
        effect.render(scene, camera);
        const [, , left, right] = renderer.draws;
        const point = new THREE.Vector3(0.44, -0.32, -1.6).applyMatrix4(camera.matrixWorld);
        expect(project(point, left).distanceTo(project(point, right))).toBeCloseTo(0, 12);
        expect(left.world.equals(camera.matrixWorld)).toBe(true);
    });
    it('isolates UI from world passes and draws it in separate clipped eye viewports', () => {
        effect.render(scene, camera);
        const [left, right, uiLeft, uiRight] = renderer.draws;
        expect(left.layers & (1 << PHONE_UI_LAYER)).toBe(0);
        expect(right.layers & (1 << PHONE_UI_LAYER)).toBe(0);
        expect(uiLeft.layers).toBe(1 << PHONE_UI_LAYER);
        expect(uiRight.layers).toBe(1 << PHONE_UI_LAYER);
        expect(uiLeft.viewport.x).toBeCloseTo(112);
        expect(uiLeft.viewport.y).toBeCloseTo(16);
        expect(uiLeft.viewport.z).toBeCloseTo(672);
        expect(uiLeft.viewport.w).toBeCloseTo(768);
        expect(uiRight.viewport.x).toBeCloseTo(816);
        expect(uiRight.viewport.y).toBeCloseTo(16);
        expect(left.viewport.equals(uiLeft.viewport)).toBe(true);
        expect(right.viewport.equals(uiRight.viewport)).toBe(true);
        expect(uiLeft.background).toBeNull();
        expect(uiLeft.autoClear).toBe(false);
        expect(renderer.clearDepth).toHaveBeenCalledTimes(2);
    });
    it('restores renderer state and background, including after a rendering failure', () => {
        const background = scene.background;
        const checkState = () => {
            expect(scene.background).toBe(background);
            expect(renderer.autoClear).toBe(true);
            expect(renderer.getScissorTest()).toBe(false);
            expect(renderer.getClearColor(new THREE.Color()).getHexString()).toBe('123456');
            expect(renderer.getClearAlpha()).toBe(0.5);
            expect(renderer.getViewport(new THREE.Vector4()).toArray()).toEqual([2, 3, 1600, 800]);
            expect(renderer.getScissor(new THREE.Vector4()).toArray()).toEqual([4, 5, 1500, 700]);
        };
        effect.render(scene, camera); checkState();
        renderer.render.mockImplementation((_, renderCamera) => {
            if (renderCamera.layers.mask === (1 << PHONE_UI_LAYER)) throw new Error('render failed');
        });
        expect(() => effect.render(scene, camera)).toThrow('render failed');
        checkState();
    });
    it('restores original layer masks when exiting, including child pointer meshes', () => {
        const group = new THREE.Group();
        const dot = new THREE.Mesh();
        dot.layers.enable(2);
        group.add(dot);
        const original = dot.layers.mask;
        setPhoneUILayer(group, true); setPhoneUILayer(group, true);
        expect(group.layers.mask).toBe(1 << PHONE_UI_LAYER);
        expect(dot.layers.mask).toBe(1 << PHONE_UI_LAYER);
        setPhoneUILayer(group, false); setPhoneUILayer(group, false);
        expect(group.layers.mask).toBe(1);
        expect(dot.layers.mask).toBe(original);
    });
    it('still gaze-selects buttons on the UI layer and restores the planet raycast mask', () => {
        const controls = Object.create(GazeControls.prototype);
        controls.group = new THREE.Group();
        const item = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), new THREE.MeshBasicMaterial());
        item.position.z = -1.6;
        controls.group.add(item); controls.items = [item];
        scene.add(controls.group);
        setPhoneUILayer(controls.group, true);
        const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
        expect(controls.hit(ray, PHONE_UI_LAYER)?.object).toBe(item);
        expect(ray.layers.mask).toBe(1);
        controls.group.visible = false;
        expect(controls.hit(ray, PHONE_UI_LAYER)).toBeNull();
    });
});

describe('Cardboard circular lens layout', () => {
    it('matches an inset pair rather than stretching across two screen halves', () => {
        const eyes = phoneEyeLayout(1600, 738, { spacing: 0.4, size: 0.78, shape: 'circle' });
        expect(eyes[0].width).toBeCloseTo(738 * 0.78);
        expect(eyes[0].x + eyes[0].width / 2).toBeCloseTo(480);
        expect(eyes[1].x + eyes[1].width / 2).toBeCloseTo(1120);
        expect(eyes[0].y + eyes[0].height / 2).toBeCloseTo(369);
        expect(eyes[0].width).toBeLessThan(800);
        expect(eyes[0].height).toBeLessThan(738);
    });
    it.each([[1600, 738], [915, 412], [932, 430], [430, 932], [1280, 720], [2870, 1516]])(
        'keeps equal-sized lenses in bounds without overlap at %s × %s', (width, height) => {
            for (const spacing of [0.34, 0.4, 0.5]) for (const size of [0.6, 0.78, 0.9]) {
                const [left, right] = phoneEyeLayout(width, height, { spacing, size, shape: 'circle' });
                expect(left.width).toBe(right.width);
                expect(left.width).toBe(left.height);
                expect(left.y).toBe(right.y);
                expect(left.x).toBeGreaterThanOrEqual(0);
                expect(left.y).toBeGreaterThanOrEqual(0);
                expect(left.x + left.width).toBeLessThan(right.x);
                expect(right.x + right.width).toBeLessThanOrEqual(width);
                expect(right.y + right.height).toBeLessThanOrEqual(height);
                expect(left.x).toBeCloseTo(width - right.x - right.width);
            }
        }
    );
    it('bounds saved preferences and recovers from malformed values', () => {
        expect(normalizeViewerSettings(null)).toEqual({ spacing: 0.44, size: 0.96, shape: 'wide' });
        expect(normalizeViewerSettings({ spacing: NaN, size: 'big' })).toEqual({ spacing: 0.44, size: 0.96, shape: 'wide' });
        expect(normalizeViewerSettings({ spacing: 100, size: -1 })).toEqual({ spacing: 0.5, size: 0.6, shape: 'wide' });
    });
    it('moves both lens centres symmetrically when spacing changes', () => {
        const tight = phoneEyeLayout(1600, 738, { spacing: 0.34 });
        const wide = phoneEyeLayout(1600, 738, { spacing: 0.5 });
        expect(tight[0].x + tight[0].width / 2).toBeGreaterThan(wide[0].x + wide[0].width / 2);
        expect(tight[1].x + tight[1].width / 2).toBeLessThan(wide[1].x + wide[1].width / 2);
    });
    it('builds exactly two circular holes in a full black surround from the same layout', () => {
        const eyes = phoneEyeLayout(1600, 738, { shape: 'circle' });
        const mask = phoneLensMask(1600, 738, eyes, { shape: 'circle' });
        expect(mask.startsWith('M0 0H1600V738H0Z')).toBe(true);
        expect(mask.match(/a/g)).toHaveLength(4);
        expect(mask.match(/Z/g)).toHaveLength(3);
        expect(mask).not.toMatch(/NaN|Infinity/);
    });
    it('expands the default height and corners without stretching the scene', () => {
        const [wide] = phoneEyeLayout(1600, 738);
        const [old] = phoneEyeLayout(1600, 738, { spacing: 0.4, size: 0.78, shape: 'circle' });
        expect(wide.height).toBeCloseTo(738 * 0.96);
        expect(wide.width * wide.height).toBeGreaterThan(old.width * old.height * 1.4);
        const mask = phoneLensMask(1600, 738, phoneEyeLayout(1600, 738));
        expect(mask.match(/Q/g)).toHaveLength(8);
        expect(mask).not.toMatch(/NaN|Infinity/);
    });
});

describe('flat controls in the viewer', () => {
    it('has matching actions and text in the two eye bars, with no duplicate IDs', async () => {
        const { readFileSync } = await import('node:fs');
        const html = readFileSync('views/vr-working.html', 'utf8');
        const bars = [...html.matchAll(/<div class="cardboard-eye-bar">([\s\S]*?)<\/div>/g)].map(m => m[1]);
        expect(bars).toHaveLength(2);
        const buttons = text => [...text.matchAll(/<button[^>]*data-phone-([a-z]+)[^>]*>(.*?)<\/button>/g)]
            .map(m => ({ action: m[1], label: m[2] }));
        expect(buttons(bars[0])).toEqual(buttons(bars[1]));
        expect(buttons(bars[0]).map(b => b.action)).toEqual(['exit', 'awake', 'recenter']);
        const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

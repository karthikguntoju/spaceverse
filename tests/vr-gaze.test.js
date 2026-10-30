let DwellSelector, GazeControls, THREE;
beforeAll(async () => {
    ({ DwellSelector, GazeControls } = await import('../public/js/vr/gaze-controls.js'));
    THREE = await import('three');
});

function hold(selector, key, frames = 30) {
    return Array.from({ length: frames }, () => selector.update(key, 0.05));
}

describe('gaze dwell selection', () => {
    it('fills gradually and activates once after 1.4 seconds', () => {
        const dwell = new DwellSelector();
        expect(dwell.update('ui:primary', 0.05).progress).toBeCloseTo(0.05 / 1.4);
        const frames = hold(dwell, 'ui:primary', 100);
        expect(frames.filter(frame => frame.activate)).toHaveLength(1);
        expect(frames.at(-1)).toEqual({ progress: 1, activate: false });
    });
    it('cancels on looking away and allows a fresh selection', () => {
        const dwell = new DwellSelector();
        hold(dwell, 'ui:primary', 20);
        expect(dwell.update(null, 0.05).progress).toBe(0);
        expect(hold(dwell, 'ui:primary', 20).some(f => f.activate)).toBe(false);
        expect(hold(dwell, 'ui:primary', 10).filter(f => f.activate)).toHaveLength(1);
        dwell.update(null, 0.05);
        expect(hold(dwell, 'ui:primary').filter(f => f.activate)).toHaveLength(1);
    });
    it('never transfers partial progress between a planet and a control', () => {
        const dwell = new DwellSelector();
        hold(dwell, 'body:earth', 25);
        expect(dwell.update('ui:options', 0.05).progress).toBeCloseTo(0.05 / 1.4);
        expect(hold(dwell, 'ui:options', 10).some(f => f.activate)).toBe(false);
    });
    it('does not repeat when the Fly label changes to Stop under the same gaze', () => {
        const dwell = new DwellSelector();
        expect(hold(dwell, 'ui:primary').some(f => f.activate)).toBe(true);
        expect(hold(dwell, 'ui:primary', 200).some(f => f.activate)).toBe(false);
    });
    it('requires looking away after a menu replacement or recenter', () => {
        const dwell = new DwellSelector();
        dwell.reset(true);
        expect(hold(dwell, 'ui:scan-hunt', 100).some(f => f.activate)).toBe(false);
        dwell.update(null, 0.05);
        expect(hold(dwell, 'ui:scan-hunt').some(f => f.activate)).toBe(true);
    });
    it('does not count suspended time or invalid deltas', () => {
        const dwell = new DwellSelector();
        expect(dwell.update('ui:exit', 90).progress).toBeCloseTo(0.05 / 1.4);
        for (const dt of [NaN, Infinity, -1]) {
            expect(dwell.update('ui:exit', dt).progress).toBeCloseTo(0.05 / 1.4);
        }
        dwell.reset();
        expect(dwell.update('ui:exit', 0).progress).toBe(0);
    });
});

describe('in-world gaze panels', () => {
    let controls, camera, parent, ray;
    beforeEach(() => {
        vi.stubGlobal('document', {
            createElement: () => ({ width: 0, height: 0, getContext: () => ({
                fillRect() {}, strokeRect() {}, fillText() {}, scale() {}
            }) })
        });
        parent = new THREE.Group();
        camera = new THREE.PerspectiveCamera(62, 1, 0.1, 6000);
        parent.add(camera);
        controls = new GazeControls(parent);
        controls.setOptions([
            { action: 'primary', title: 'FLY FORWARD' },
            { action: 'options', title: 'OPTIONS' },
            { action: 'recenter', title: 'RECENTRE' }
        ]);
        controls.group.visible = true;
        controls.anchor(camera);
        ray = new THREE.Raycaster();
    });
    afterEach(() => vi.unstubAllGlobals());
    function aimAt(item) {
        parent.updateMatrixWorld(true);
        const target = item.getWorldPosition(new THREE.Vector3());
        camera.lookAt(target);
        camera.updateWorldMatrix(true, false);
        ray.setFromCamera(new THREE.Vector2(0, 0), camera);
        return controls.hit(ray);
    }
    it('lets a head turn aim at each button without moving the panel with the head', () => {
        const anchor = controls.group.quaternion.clone();
        for (const item of controls.items) expect(aimAt(item)?.object).toBe(item);
        expect(controls.group.quaternion.equals(anchor)).toBe(true);
    });
    it('keeps targets hittable after cabin travel and rotation', () => {
        parent.position.set(240, 35, -800);
        parent.rotation.set(0.1, 1.2, 0.3);
        for (const item of controls.items) expect(aimAt(item)?.object).toBe(item);
    });
    it('never hits hidden controls', () => {
        const item = controls.items[0];
        expect(aimAt(item)?.object).toBe(item);
        controls.group.visible = false;
        expect(controls.hit(ray)).toBeNull();
    });
    it('keeps the dock 55 degrees down instead of accumulating head tilt', () => {
        camera.rotation.set(-0.4, 0.7, 0.2, 'YXZ');
        controls.anchor(camera);
        const euler = new THREE.Euler().setFromQuaternion(controls.group.quaternion, 'YXZ');
        expect(euler.x).toBeCloseTo(-55 * Math.PI / 180);
        expect(euler.y).toBeCloseTo(0.7);
        expect(euler.z).toBeCloseTo(0);
    });
    it('shows only the downward dock when looking well down, with targets clear of the horizon', () => {
        controls.setOptions([{ action: 'menu', title: 'MENU' }]);
        camera.rotation.set(0, 1.1, 0, 'YXZ');
        controls.updateDock(camera, false);
        expect(controls.group.visible).toBe(false);
        expect(controls.hit(ray)).toBeNull();
        camera.rotation.x = -55 * Math.PI / 180;
        controls.updateDock(camera, false);
        expect(controls.group.visible).toBe(true);
        expect(aimAt(controls.items[0])?.object).toBe(controls.items[0]);
        const anchor = controls.group.quaternion.clone();
        camera.rotation.y += 0.2;
        controls.updateDock(camera, true);
        expect(controls.group.quaternion.equals(anchor)).toBe(true);
    });
    it('reuses unchanged panels and disposes replaced graphics resources', () => {
        const item = controls.items[0];
        const geometry = vi.spyOn(item.geometry, 'dispose');
        const texture = vi.spyOn(item.material.map, 'dispose');
        const material = vi.spyOn(item.material, 'dispose');
        controls.setOptions(JSON.parse(controls.signature));
        expect(controls.items[0]).toBe(item);
        controls.setOptions([{ action: 'primary', title: 'STOP FLYING' }]);
        expect(geometry).toHaveBeenCalledOnce();
        expect(texture).toHaveBeenCalledOnce();
        expect(material).toHaveBeenCalledOnce();
        expect(controls.group.children).toHaveLength(1);
    });
});

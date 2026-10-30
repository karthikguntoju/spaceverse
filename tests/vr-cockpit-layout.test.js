let THREE, Cockpit;
beforeAll(async () => {
    THREE = await import('three');
    ({ Cockpit } = await import('../public/js/vr/cockpit.js'));
});

describe('ride cockpit sightline', () => {
    let cockpit, camera;
    beforeEach(() => {
        vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({
            strokeRect() {}, fillText() {}
        }) }) });
        cockpit = Object.create(Cockpit.prototype);
        cockpit.group = new THREE.Group();
        for (const key of ['mHull', 'mBezel', 'mAccent', 'mKey', 'mLampOff', 'mMetal']) {
            cockpit[key] = new THREE.MeshStandardMaterial();
        }
        cockpit._buildDash();
        camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 100);
        camera.updateMatrixWorld(true); cockpit.group.updateMatrixWorld(true);
    });
    afterEach(() => {
        cockpit.group.traverse(object => {
            object.geometry?.dispose();
            object.material?.map?.dispose();
            object.material?.dispose();
        });
        vi.unstubAllGlobals();
    });
    it('keeps all instrument faces below the central 80% of the forward view', () => {
        for (const screen of [cockpit.mainDisplay, cockpit.leftDisplay, cockpit.rightDisplay]) {
            const positions = screen.geometry.attributes.position;
            for (let i = 0; i < positions.count; i++) {
                const projected = new THREE.Vector3().fromBufferAttribute(positions, i)
                    .applyMatrix4(screen.matrixWorld).project(camera);
                // NDC y=-0.6 is 80% down the viewport; lower is less intrusive.
                expect(projected.y).toBeLessThan(-0.6);
            }
        }
    });
    it('keeps the main instrument readable by looking down rather than deleting it', () => {
        camera.rotation.x = -35 * Math.PI / 180; camera.updateMatrixWorld(true);
        const projected = cockpit.mainDisplay.getWorldPosition(new THREE.Vector3()).project(camera);
        expect(Math.abs(projected.x)).toBeLessThan(1);
        expect(Math.abs(projected.y)).toBeLessThan(1);
        expect(cockpit.main.tex.image.width).toBe(1024);
    });
    it('uses a smaller, fainter windshield overlay', () => {
        cockpit._buildHUD();
        expect(cockpit.hudMesh.geometry.parameters.width).toBeLessThan(1);
        expect(cockpit.hudMesh.material.opacity).toBeLessThanOrEqual(0.25);
    });
});

it('collapses ride telemetry and secondary actions while keeping Pause directly available', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync('views/vr-working.html', 'utf8');
    const details = html.match(/<details id="ride-details">([\s\S]*?)<\/details>/);
    expect(details).not.toBeNull();
    expect(details[1]).toContain('<summary class="chip">Ride controls</summary>');
    for (const id of ['seg-title', 'ride-bar', 'btn-skip', 'btn-restart']) expect(details[1]).toContain(`id="${id}"`);
    expect(details[1]).not.toContain('id="btn-pause"');
    expect([...html.matchAll(/id="btn-pause"/g)]).toHaveLength(1);
});

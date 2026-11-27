let THREE, questOnlyVRStatus, readQuestHand, readQuestControllers, pulseQuestController, Quest3Rig;

beforeAll(async () => {
    THREE = await import('three');
    ({ questOnlyVRStatus, readQuestHand, readQuestControllers, pulseQuestController } = await import('../public/js/vr/xr-support.js'));
    ({ Quest3Rig } = await import('../public/js/vr/quest3-rig.js'));
});

describe('Meta Quest 3 Touch Plus input & rig', () => {
    it('reports Quest 3 exclusive status accurately based on secure context and WebXR support', async () => {
        expect(await questOnlyVRStatus(null, false)).toMatchObject({ available: false });
        expect(await questOnlyVRStatus(null, true)).toMatchObject({ available: false });
        const xr = { isSessionSupported: vi.fn().mockResolvedValue(true) };
        const res = await questOnlyVRStatus(xr, true);
        expect(res).toMatchObject({ available: true, label: 'Launch in Meta Quest 3' });
    });

    it('reads Touch Plus sticks with radial deadzone and tracks trigger/grip/button edge presses', () => {
        const pad = (sx, sy, trig = 0, grip = 0, a = false, b = false) => ({
            axes: [0, 0, sx, sy],
            buttons: [
                { value: trig, pressed: trig > 0.65 },
                { value: grip, pressed: grip > 0.65 },
                { pressed: false },
                { pressed: false },
                { pressed: a },
                { pressed: b }
            ]
        });

        expect(readQuestHand(pad(0.08, 0.05)).stick).toEqual({ x: 0, y: 0 });
        const tilted = readQuestHand(pad(0.8, 0, 0.9, 0.5, true, false));
        expect(tilted.stick.x).toBeGreaterThan(0.6);
        expect(tilted.trigger).toBeCloseTo(0.9);
        expect(tilted.triggerPressed).toBe(true);
        expect(tilted.primary).toBe(true);

        const session = {
            inputSources: [
                { handedness: 'left', gamepad: pad(-0.5, 0, 0.8, 0, true, false) },
                { handedness: 'right', gamepad: pad(0, 0, 0.9, 0.2, false, true) }
            ]
        };
        const f1 = readQuestControllers(session, null);
        expect(f1.left.triggerJustPressed).toBe(true);
        expect(f1.right.secondaryJustPressed).toBe(true);
        const f2 = readQuestControllers(session, f1);
        expect(f2.left.triggerJustPressed).toBe(false);
        expect(f2.right.secondaryJustPressed).toBe(false);
    });

    it('fires targeted per-hand Touch Plus haptics without throwing', () => {
        const leftPulse = vi.fn().mockResolvedValue(undefined);
        const rightPulse = vi.fn().mockResolvedValue(undefined);
        const session = {
            inputSources: [
                { handedness: 'left', gamepad: { hapticActuators: [{ pulse: leftPulse }] } },
                { handedness: 'right', gamepad: { hapticActuators: [{ pulse: rightPulse }] } }
            ]
        };
        pulseQuestController(session, 'left', 0.6, 50);
        expect(leftPulse).toHaveBeenCalledWith(0.6, 50);
        expect(rightPulse).not.toHaveBeenCalled();

        pulseQuestController(session, 'both', 0.8, 70);
        expect(rightPulse).toHaveBeenCalledWith(0.8, 70);
    });

    it('switches Touch Plus 3D tool profiles cleanly per Quest 3 arcade game', () => {
        const dolly = new THREE.Group();
        const rig = new Quest3Rig({ dolly });
        expect(rig.controllers).toHaveLength(2);

        rig.setToolProfile('orbital-intercept');
        expect(rig.leftHand.tools.left.tools.shield.group.visible).toBe(true);
        expect(rig.rightHand.tools.right.tools.blaster.group.visible).toBe(true);
        expect(rig.wristHud.mesh.visible).toBe(true);

        rig.setToolProfile('satellite-repair');
        expect(rig.leftHand.tools.left.tools.claw.group.visible).toBe(true);
        expect(rig.rightHand.tools.right.tools.welder.group.visible).toBe(true);

        rig.setToolProfile('space-rescue');
        expect(rig.leftHand.tools.left.tools.mmu.group.visible).toBe(true);
        expect(rig.rightHand.tools.right.tools.harpoon.group.visible).toBe(true);

        rig.update(0.05, {
            left: { stick: { x: 0.4, y: -0.2 }, trigger: 0.9, triggerPressed: true, grip: 0, primary: true, secondary: false },
            right: { stick: { x: 0, y: 0 }, trigger: 0.5, triggerPressed: false, grip: 0.2, primary: false, secondary: true }
        }, { hudTitle: 'TEST', hudStatus: 'READY', slug: 'orbital-intercept' });

        expect(rig.getMuzzlePose()).toBeTruthy();
        expect(rig.getShieldPose()).toBeNull();
        rig.setToolProfile('orbital-intercept');
        expect(rig.getShieldPose()).toBeTruthy();
    });

    it('handles swapped WebXR handedness on connect, hides disconnected slots, and assigns stereo renderOrder', () => {
        const dolly = new THREE.Group();
        const listeners = [{}, {}];
        const controllers = [0, 1].map(i => {
            const c = new THREE.Object3D();
            c.addEventListener = (ev, fn) => { (listeners[i][ev] ||= []).push(fn); };
            return c;
        });
        const rig = new Quest3Rig({
            dolly,
            renderer: { xr: { getController: i => controllers[i], getControllerGrip: i => new THREE.Object3D() } }
        });
        rig.setToolProfile('orbital-intercept');

        // Simulate Quest 3 waking Right Touch Plus on index 0 before Left connects on index 1
        listeners[0].connected.forEach(fn => fn({ data: { handedness: 'right' } }));
        expect(rig.rightHand.index).toBe(0);
        expect(rig.slots[1].handedness).toBeNull();
        expect(rig.slots[1].models.right.root.visible).toBe(false);

        listeners[1].connected.forEach(fn => fn({ data: { handedness: 'left' } }));
        expect(rig.leftHand.index).toBe(1);
        expect(rig.wristHud.mesh.parent).toBe(rig.slots[1].mount);

        // Disconnect clears pointer ray & model visibility cleanly
        listeners[0].disconnected.forEach(fn => fn());
        expect(rig.rightHand).toBeNull();
        expect(rig.slots[0].rayLine.visible).toBe(false);
        expect(rig.slots[0].models.right.root.visible).toBe(false);

        // Stereo transparent draw order guards
        const leftSlot = rig.slots[1];
        expect(leftSlot.tools.left.tools.shield.disc.renderOrder).toBeGreaterThan(0);
        expect(leftSlot.tools.left.tools.shield.disc.material.depthWrite).toBe(false);
        expect(rig.wristHud.mesh.renderOrder).toBeGreaterThan(leftSlot.tools.left.tools.shield.disc.renderOrder);
        expect(leftSlot.rayLine.material.depthWrite).toBe(false);
    });
});

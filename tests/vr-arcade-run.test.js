let ArcadeRun, SAMPLE_X, ArcadeFlight, THREE;
beforeAll(async () => {
    ({ ArcadeRun, SAMPLE_X } = await import('../public/js/vr/arcade-run.js'));
    ({ ArcadeFlight } = await import('../public/js/vr/arcade-flight.js'));
    THREE = await import('three');
});

function tick(run, seconds, input = {}) {
    for (let i = 0; i < Math.ceil(seconds / 0.05); i++) {
        run.update(0.05, typeof input === 'function' ? input(run) : input);
    }
}

function start(slug) {
    const run = new ArcadeRun(slug, () => 0.3);
    run.play();
    tick(run, 3);
    return run;
}

describe('VR Arcade mission outcomes', () => {
    it('lands on the pad with a timed braking burn and fails an unbraked run', () => {
        const lander = start('lunar-landing');
        tick(lander, 35, run => ({ x: -run.x * 0.6, brake: run.altitude < 9 && run.descent > 1.6 }));
        expect(lander.state).toBe('won');
        expect(lander.fuel).toBeGreaterThan(0);
        const crash = start('lunar-landing');
        tick(crash, 20);
        expect(crash.state).toBe('lost');
    });

    it('docks at a safe closing speed and rejects fast contact even when aligned', () => {
        const aligned = run => ({ x: -run.x * 0.8, y: -run.y * 0.8 });
        const docking = start('orbital-docking');
        docking.action('brake');
        tick(docking, 42, aligned);
        expect(docking.state).toBe('won');
        const fast = start('orbital-docking');
        fast.action('thrust');
        tick(fast, 30, aligned);
        expect(fast.state).toBe('lost');
        expect(fast.result).toMatch(/too fast/i);
    });

    it('repairs each system through three steps and penalizes an incorrect selection', () => {
        const repair = start('satellite-repair');
        expect(repair.action('system:OPTICS')).toBe(false);
        expect(repair.elapsed).toBe(4);
        const fixed = new Set();
        for (let round = 0; round < 3; round++) {
            const fault = repair.fault;
            fixed.add(fault);
            for (let step = 0; step < 3; step++) expect(repair.action('system:' + fault)).toBe(true);
        }
        expect(fixed.size).toBe(3);
        expect(repair.state).toBe('won');
    });

    it('stops at sample sites, requires alignment and charges for striking rocks', () => {
        const rover = start('mars-rover');
        expect(rover.action('collect')).toBe(false);
        tick(rover, 7, { x: 0 });
        expect(rover.rocksHit).toBeGreaterThan(0);
        expect(rover.action('collect')).toBe(false);
        for (const site of SAMPLE_X) {
            tick(rover, 8, run => ({ x: (site - run.x) * 0.8 }));
            expect(rover.sampleAligned).toBe(true);
            expect(rover.action('collect')).toBe(true);
        }
        expect(rover.state).toBe('won');
    });

    it('requires range and a matched drift before a rescue tether can fire', () => {
        const rescue = start('space-rescue');
        expect(rescue.action('match')).toBe(false);
        expect(rescue.action('tether')).toBe(false);
        tick(rescue, 12);
        expect(rescue.action('match')).toBe(true);
        expect(rescue.action('tether')).toBe(false);
        tick(rescue, 1);
        expect(rescue.action('tether')).toBe(true);
        expect(rescue.state).toBe('won');
        rescue.play();
        expect(rescue.state).toBe('countdown');
        expect(rescue.matched).toBe(false);
    });

    it('freezes simulation and rejects actions when paused, then counts down on resume', () => {
        const run = start('lunar-landing');
        tick(run, 1);
        run.pause();
        const altitude = run.altitude;
        tick(run, 30, { x: -1, brake: true });
        expect(run.action('brake')).toBe(false);
        expect(run.altitude).toBe(altitude);
        run.play();
        tick(run, 3);
        expect(run.altitude).toBe(altitude);
        tick(run, 0.2);
        expect(run.altitude).toBeLessThan(altitude);
    });

    it('supports Quest 3 analog trigger throttle, satellite spare welding, rover crystals, and scoring', () => {
        const lander = start('lunar-landing');
        tick(lander, 35, run => ({
            x: -run.x * 0.7,
            z: -run.z * 0.7,
            throttle: run.altitude < 10 && run.descent > 1.8 ? 0.9 : 0,
            stabilize: true
        }));
        expect(lander.state).toBe('won');
        expect(lander.score).toBeGreaterThan(1000);

        const docking = start('orbital-docking');
        docking.roll = 0.2;
        tick(docking, 45, run => ({
            x: -run.x * 0.8,
            y: -run.y * 0.8,
            thrustAxis: run.closing > 0.5 ? -0.8 : 0,
            rollAxis: -run.roll * 2
        }));
        expect(docking.state).toBe('won');
        expect(docking.score).toBeGreaterThan(1200);

        const repair = start('satellite-repair');
        for (let round = 0; round < 3; round++) {
            const fault = repair.fault;
            expect(repair.action('system:' + fault)).toBe(true);
            expect(repair.grabSpare(fault)).toBe(true);
            expect(repair.carryingSpare).toBe(fault);
            for (let t = 0; t < 20; t++) repair.weldStep(0.05, fault);
        }
        expect(repair.state).toBe('won');
        expect(repair.score).toBeGreaterThan(1500);

        const rover = start('mars-rover');
        tick(rover, 4, run => ({ x: (-2.0 - run.x) * 0.8, throttle: 0.9 }));
        expect(rover.bonusCollected).toBeGreaterThanOrEqual(1);
    });

    it('restores scene fog on mars-rover stop and eliminates bay door/core Z-fighting in satellite-repair', () => {
        const scene = new THREE.Scene();
        const dolly = new THREE.Group();
        const roverGame = new ArcadeFlight(scene, 'mars-rover');
        expect(scene.fog).toBeNull();
        roverGame.start(dolly);
        expect(scene.fog).toBeTruthy();
        roverGame.stop();
        expect(scene.fog).toBeNull();

        const repairGame = new ArcadeFlight(scene, 'satellite-repair');
        repairGame.start(dolly);
        repairGame.run.play();
        for (let i = 0; i < 65; i++) repairGame.run.update(0.05);
        repairGame.syncScene(0.05);

        // Step 0: spares on left rack should not be pickable as wrong bay targets
        const raycaster = new THREE.Raycaster();
        const spare = repairGame.spareModules.OPTICS;
        const sparePos = spare.getWorldPosition(new THREE.Vector3());
        raycaster.set(new THREE.Vector3(0, 0, 0), sparePos.clone().normalize());
        expect(repairGame.pick(raycaster)).toBeNull();

        // Bay arc stays visible continuously (opacity glow instead of binary toggle), and door never intersects coreMesh
        const fault = repairGame.run.fault;
        expect(repairGame.repairBays[fault].arcLine.visible).toBe(true);
        const coreBox = new THREE.Box3().setFromObject(repairGame.repairBays[fault].coreMesh);
        const doorBox = new THREE.Box3().setFromObject(repairGame.repairBays[fault].doorMesh);
        expect(coreBox.max.z).toBeLessThan(doorBox.min.z);
    });
});

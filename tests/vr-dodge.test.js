let DodgeRun, DodgeGame, THREE;
beforeAll(async () => {
    ({ DodgeRun } = await import('../public/js/vr/dodge-run.js'));
    ({ DodgeGame } = await import('../public/js/vr/dodge-game.js'));
    THREE = await import('three');
});
function advance(run, seconds, steering = 0) {
    for (let t = 0; t < Math.round(seconds * 100); t++) run.update(0.01, steering);
}
describe('hands-free Asteroid Dodge practice', () => {
    it('waits for explicit start and completes a countdown before spawning', () => {
        const run = new DodgeRun(); advance(run, 10);
        expect(run.state).toBe('ready'); expect(run.elapsed).toBe(0);
        run.play(); advance(run, 2);
        expect(run.state).toBe('countdown'); expect(run.hazards).toHaveLength(0);
        advance(run, 1.01);
        expect(run.state).toBe('playing');
        expect(run.hazards).toHaveLength(1);
    });
    it('smoothly bounds head steering without jumping across the course', () => {
        const run = new DodgeRun(); run.play(); run.update(0.01, 100);
        expect(run.x).toBeGreaterThan(0); expect(run.x).toBeLessThan(1);
        advance(run, 2, 100); expect(run.x).toBeCloseTo(3.2);
        advance(run, 2, -100); expect(run.x).toBeCloseTo(-3.2);
    });
    it('counts a crossing once and loses after exactly three hits', () => {
        const run = new DodgeRun(); run.state = 'playing'; run.nextSpawn = 100;
        for (let i = 0; i < 3; i++) {
            run.hazards.push({ id: i, x: 0, z: -1.01, speed: 10 });
            run.update(0.01); run.update(0.01);
            expect(run.hits).toBe(i + 1);
        }
        expect(run.shields).toBe(0); expect(run.state).toBe('lost');
        expect(run.hazards).toHaveLength(0);
    });
    it('awards a dodge only after a rock crosses safely', () => {
        const run = new DodgeRun(); run.state = 'playing'; run.nextSpawn = 100;
        run.hazards = [{ id: 1, x: 3.2, z: -1.15, speed: 10 }];
        run.update(0.01); expect(run.dodged).toBe(0);
        run.update(0.01); expect(run.dodged).toBe(1);
        expect(run.shields).toBe(3); run.update(0.01); expect(run.dodged).toBe(1);
    });
    it('freezes hazards and the timer while paused, and counts down before resuming', () => {
        const run = new DodgeRun(); run.play(); advance(run, 4);
        run.pause(); const saved = JSON.stringify(run);
        advance(run, 10, 1); expect(JSON.stringify(run)).toBe(saved);
        run.play(); const time = run.elapsed, z = run.hazards[0].z;
        advance(run, 2); expect(run.elapsed).toBe(time); expect(run.hazards[0].z).toBe(z);
        advance(run, 1.1); expect(run.elapsed).toBeGreaterThan(time);
    });
    it('allows a 60-second survival and a clean replay', () => {
        const run = new DodgeRun(() => 0); run.play(); advance(run, 64);
        expect(run.state).toBe('won'); expect(run.elapsed).toBe(60);
        expect(run.shields).toBe(3); expect(run.dodged).toBeGreaterThan(20);
        run.play(); expect(run.state).toBe('countdown'); expect(run.elapsed).toBe(0);
        expect(run.dodged).toBe(0); expect(run.hazards).toHaveLength(0);
    });
    it('never spawns a wall across all lanes and keeps a bounded hazard count', () => {
        const run = new DodgeRun(() => 0); run.play(); let max = 0;
        for (let frame = 0; frame < 6500; frame++) {
            run.update(0.01, 1); max = Math.max(max, run.hazards.length);
            expect(run.hazards.every(h => [-3.2, 0, 3.2].includes(h.x))).toBe(true);
        }
        expect(max).toBeLessThan(10); expect(run.state).toBe('won');
    });
    it('rejects invalid deltas and does not fast-forward after a suspended tab', () => {
        const run = new DodgeRun(); run.state = 'playing';
        for (const dt of [NaN, Infinity, -1]) run.update(dt);
        expect(run.elapsed).toBe(0);
        run.update(60, NaN); expect(run.elapsed).toBe(0.1); expect(Number.isFinite(run.x)).toBe(true);
    });
});

describe('Dodge scene and head controls', () => {
    it('shares four detailed mineral-colored rock meshes and one lit material', () => {
        const game = new DodgeGame(new THREE.Scene());
        expect(new Set(game.pool.map(rock => rock.geometry)).size).toBe(4);
        expect(new Set(game.pool.map(rock => rock.material)).size).toBe(1);
        for (const rock of game.pool) {
            expect(rock.geometry.attributes.position.count).toBeGreaterThan(200);
            expect(rock.geometry.attributes.color.count).toBe(rock.geometry.attributes.position.count);
            expect([...rock.geometry.attributes.position.array].every(Number.isFinite)).toBe(true);
            expect(rock.material.vertexColors).toBe(true);
        }
    });
    it('moves peripheral scenery during play and freezes it on pause', () => {
        const scene = new THREE.Scene(), dolly = new THREE.Group(), camera = new THREE.PerspectiveCamera();
        const game = new DodgeGame(scene); game.start(dolly);
        game.run.state = 'playing';
        const initial = game.streakPositions.slice();
        game.update(0.05, camera, dolly);
        expect(game.streakPositions).not.toEqual(initial);
        game.run.pause();
        const paused = game.streakPositions.slice();
        game.update(0.05, camera, dolly);
        expect(game.streakPositions).toEqual(paused);
    });
    it('steers the POV from head yaw without moving the obstacle course with it', () => {
        const scene = new THREE.Scene(), dolly = new THREE.Group();
        const camera = new THREE.PerspectiveCamera(); dolly.add(camera); scene.add(dolly);
        dolly.position.set(5, 2, 10);
        const game = new DodgeGame(scene); game.start(dolly); game.run.play();
        camera.rotation.y = -0.3;
        for (let i = 0; i < 30; i++) game.update(0.05, camera, dolly);
        expect(dolly.position.x).toBeGreaterThan(8);
        expect(game.root.position.x).toBe(5);
        camera.rotation.y = 0.3;
        for (let i = 0; i < 30; i++) game.update(0.05, camera, dolly);
        expect(dolly.position.x).toBeLessThan(2);
        game.stop(); expect(game.root.visible).toBe(false);
    });
    it('suspends simulation while gaze controls are in use and reuses its mesh pool', () => {
        const scene = new THREE.Scene(), dolly = new THREE.Group();
        const camera = new THREE.PerspectiveCamera(); dolly.add(camera); scene.add(dolly);
        const game = new DodgeGame(scene); game.start(dolly); game.run.play();
        const meshes = game.pool.slice();
        for (let i = 0; i < 100; i++) game.update(0.05, camera, dolly, true);
        expect(game.run.countdown).toBe(3); expect(game.run.elapsed).toBe(0);
        game.start(dolly); expect(game.pool).toEqual(meshes);
        expect(game.run.state).toBe('ready');
    });
});

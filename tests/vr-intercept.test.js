let InterceptRun, InterceptGame, THREE;

beforeAll(async () => {
    ({ InterceptRun } = await import('../public/js/vr/intercept-run.js'));
    ({ InterceptGame } = await import('../public/js/vr/intercept-game.js'));
    THREE = await import('three');
});

function startRun() {
    const run = new InterceptRun(() => 0.5);
    run.play();
    for (let i = 0; i < 65; i++) run.update(0.05);
    return run;
}

describe('Orbital Intercept Quest 3 simulation', () => {
    it('begins wave 1 after countdown and advances waves as targets are cleared', () => {
        const run = startRun();
        expect(run.state).toBe('playing');
        expect(run.wave).toBe(1);
        for (let i = 0; i < 200; i++) run.update(0.05);
        expect(run.targets.length).toBeGreaterThan(0);
    });

    it('supports 6DoF blaster targeting and Rail-Lance armor piercing', () => {
        const run = startRun();
        run.waveQueue = [];
        run.targets = [
            { id: 1, kind: 'heavy', x: 0, y: 1, z: -12, vx: 0, vy: 0, vz: 0, hp: 3, maxHp: 3, armored: true, radius: 1.1, fireTimer: 10 },
            { id: 2, kind: 'scout', x: 0, y: 1, z: -18, vx: 0, vy: 0, vz: 0, hp: 1, maxHp: 1, radius: 0.9, fireTimer: 10 }
        ];
        const res = run.fireBlaster({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, true);
        expect(res.hit).toBe(true);
        expect(run.targets.length).toBe(0);
        expect(run.kills).toBe(2);
        expect(run.score).toBeGreaterThan(500);
    });

    it('splits magma meteors into 2 fast shards when blasted', () => {
        const run = startRun();
        run.waveQueue = [];
        run.targets = [
            { id: 1, kind: 'magma', x: 0, y: 1, z: -14, vx: 0, vy: 0, vz: 1, hp: 1, maxHp: 1, radius: 1.15, fireTimer: 99 }
        ];
        run.fireBlaster({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, false);
        expect(run.targets.length).toBe(2);
        expect(run.targets.every(t => t.kind === 'shard')).toBe(true);
    });

    it('deflects incoming plasma bolts with Left Touch Plus Aegis Shield and triggers EMP at 100%', () => {
        const run = startRun();
        run.waveQueue = [];
        run.targets = [{ id: 10, kind: 'scout', x: 1, y: 1, z: -14, vx: 0, vy: 0, vz: 0, hp: 1, maxHp: 1, radius: 0.9, fireTimer: 10 }];
        run.enemyShots = [{ id: 20, x: -0.3, y: 0.1, z: -0.8, vx: 0, vy: 0, vz: 4 }];
        run.empCharge = 80;
        const deflected = run.deflectWithShield({ x: -0.3, y: 0.1, z: -0.8 }, null, 0.55);
        expect(deflected).toBe(1);
        expect(run.deflections).toBe(1);
        expect(run.empCharge).toBe(100);
        expect(run.targets.length).toBe(0);

        run.targets = [{ id: 11, kind: 'scout', x: 0, y: 1, z: -12, vx: 0, vy: 0, vz: 0, hp: 2, maxHp: 2, radius: 0.9, fireTimer: 10 }];
        run.enemyShots = [{ id: 21, x: 2, y: 1, z: -6, vx: 0, vy: 0, vz: 4 }];
        expect(run.triggerEMP()).toBe(true);
        expect(run.enemyShots.length).toBe(0);
        expect(run.targets.length).toBe(0);
        expect(run.empCharge).toBe(0);
    });

    it('protects Boss Siege Core while pylons are active and wins when Boss is destroyed on Wave 5', () => {
        const run = startRun();
        run._beginWave(5);
        run._spawnEntry('boss');
        run.waveQueue = [];
        const boss = run.targets.find(t => t.kind === 'boss');
        expect(boss).toBeDefined();
        expect(run.targets.filter(t => t.kind === 'pylon')).toHaveLength(3);

        // Shielded by pylons
        run.fireBlaster({ x: 0, y: boss.y, z: 0 }, { x: 0, y: 0, z: -1 }, true);
        expect(boss.hp).toBe(10);

        // Destroy all pylons
        for (const p of run.targets.filter(t => t.kind === 'pylon')) p.hp = 0;
        run.targets = run.targets.filter(t => t.hp > 0);
        boss.hp = 2;
        run.fireBlaster({ x: 0, y: boss.y, z: 0 }, { x: 0, y: 0, z: -1 }, true);
        run.update(0.05);
        expect(run.state).toBe('won');
        expect(run.score).toBeGreaterThan(3000);
    });

    it('renders Orbital Intercept 3D arena cleanly in Three.js without browser WebGL', () => {
        const scene = new THREE.Scene();
        const dolly = new THREE.Group();
        const camera = new THREE.PerspectiveCamera();
        dolly.add(camera);
        scene.add(dolly);
        const game = new InterceptGame(scene);
        game.start(dolly);
        game.run.play();
        for (let i = 0; i < 80; i++) {
            game.update(0.05, camera, dolly, false, {
                left: { stick: { x: 0.3, y: 0 }, triggerPressed: true, gripJustPressed: false },
                right: { triggerJustPressed: i % 10 === 0, gripPressed: false }
            });
        }
        expect(game.root.visible).toBe(true);
        expect(game.run.state).toBe('playing');
    });
});

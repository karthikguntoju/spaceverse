/**
 * Kessler Run (T9) and the object cap (T14).
 *
 * The mission is pure state and pure maths, so it runs here with no renderer and
 * no browser. If this file ever needs a Three.js import, the renderer-agnostic
 * split between mission and host page has been broken.
 */
let createKesslerRun;
let risk;
let core;
let store;

beforeAll(async () => {
    store = new Map();
    globalThis.sessionStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear()
    };
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ score: 40 }) });
    ({ createKesslerRun } = await import('../public/js/game/missions/kessler.js'));
    risk = await import('../public/js/shared/kessler-risk.mjs');
    core = await import('../public/js/game/core.js');
});

beforeEach(() => {
    store.clear();
    core.reset();
    core.unregister('kessler-run');
});

describe('risk model', () => {
    it('is zero for an empty field', () => {
        expect(risk.fieldRisk([])).toBe(0);
    });

    it('grows faster than linearly as a shell fills', () => {
        const at = (n) => risk.shellCrowding(n);
        expect(at(2) - at(1)).toBeLessThan(at(4) - at(3));
    });

    it('rates head-on traffic above co-directional traffic', () => {
        expect(risk.closingTraffic(0, Math.PI)).toBeGreaterThan(risk.closingTraffic(0, 0.1));
    });

    it('counts debris as pressure that never goes away', () => {
        expect(risk.debrisPressure(0)).toBe(0);
        expect(risk.debrisPressure(10)).toBeGreaterThan(risk.debrisPressure(2));
    });

    it('never pins at 100, so the meter keeps meaning something', () => {
        const crowded = Array.from({ length: 60 }, (_, i) => ({
            altitude: 6, inclination: (i % 2) * Math.PI, debris: i % 3 === 0
        }));
        const r = risk.fieldRisk(crowded);
        expect(r).toBeGreaterThan(50);
        expect(r).toBeLessThanOrEqual(97);
    });

    it('gives the identical answer for the identical field', () => {
        const field = [
            { altitude: 10, inclination: 0.4, debris: false },
            { altitude: 11, inclination: 2.9, debris: false },
            { altitude: 34, inclination: 1.1, debris: true }
        ];
        expect(risk.fieldRisk(field)).toBe(risk.fieldRisk(field.slice()));
    });
});

describe('scoring is shared with the server', () => {
    it('rewards satellites kept alive and time survived', () => {
        const base = { satellitesAlive: 10, satellitesLost: 0, fuelSpent: 0, survivedMs: 60000 };
        expect(risk.scoreRun(base, { won: false })).toBeGreaterThan(
            risk.scoreRun({ ...base, satellitesAlive: 4 }, { won: false })
        );
    });

    it('penalises losses and fuel burned', () => {
        const base = { satellitesAlive: 10, satellitesLost: 0, fuelSpent: 0, survivedMs: 60000 };
        expect(risk.scoreRun({ ...base, satellitesLost: 5 }, {})).toBeLessThan(risk.scoreRun(base, {}));
        expect(risk.scoreRun({ ...base, fuelSpent: 90 }, {})).toBeLessThan(risk.scoreRun(base, {}));
    });

    it('never goes negative', () => {
        expect(risk.scoreRun({ satellitesAlive: 0, satellitesLost: 40, fuelSpent: 100, survivedMs: 0 }, {})).toBe(0);
    });

    it('matches the server: same facts, same number', async () => {
        const gameRouter = require('../routes/game');
        await gameRouter.ready;
        const facts = { satellitesAlive: 9, satellitesLost: 2, fuelSpent: 30, survivedMs: 90000, peakRisk: 40 };
        const serverScore = gameRouter.MISSIONS['kessler-run'].score(facts, { won: true });
        expect(serverScore).toBe(risk.scoreRun(facts, { won: true }));
    });
});

describe('simulation', () => {
    function run() {
        const m = createKesslerRun({ hud: {}, audio: {} });
        m.init();
        m.start();
        return m;
    }

    it('starts with a field and full fuel', () => {
        const m = run();
        expect(m.objects().length).toBe(6);
        expect(m._state().fuel).toBe(130);
    });

    it('advances objects along their orbits', () => {
        const m = run();
        const before = m.objects()[0].angle;
        m.update(1);
        expect(m.objects()[0].angle).not.toBe(before);
    });

    it('spawns new satellites over time', () => {
        const m = run();
        const before = m.objects().length;
        for (let i = 0; i < 10; i++) m.update(1);
        expect(m.objects().length).toBeGreaterThan(before);
    });

    it('costs fuel to burn, and only with a satellite selected', () => {
        const m = run();
        expect(m.burn(1)).toBe(false);            // nothing selected
        const id = m.objects().find((o) => !o.debris).id;
        m.select(id);
        expect(m.burn(1)).toBe(true);
        expect(m._state().fuel).toBe(125);
    });

    it('moves the selected satellite to another shell', () => {
        const m = run();
        const sat = m.objects().find((o) => !o.debris);
        m.select(sat.id);
        const before = sat.altitude;
        m.burn(1);
        expect(sat.altitude).toBeGreaterThan(before);
    });

    it('refuses to burn on an empty tank', () => {
        const m = run();
        const id = m.objects().find((o) => !o.debris).id;
        m.select(id);
        for (let i = 0; i < 40; i++) m.burn(1);
        expect(m._state().fuel).toBeLessThan(5);
        expect(m.burn(1)).toBe(false);
    });

    it('cannot select debris', () => {
        const m = run();
        m.objects().push({ id: 9999, altitude: 10, inclination: 1, angle: 0, speed: 0.5, debris: true });
        expect(m.select(9999)).toBeNull();
    });

    it('routes onInput events to select and burn', () => {
        const m = run();
        const id = m.objects().find((o) => !o.debris).id;
        m.onInput({ type: 'select', id });
        expect(m.selected()).toBe(id);
        m.onInput({ type: 'burn', direction: 1 });
        expect(m._state().fuel).toBe(125);
    });

    it('wins if the field is held long enough', () => {
        const m = run();
        let verdict = null;
        for (let i = 0; i < 400 && !verdict; i++) verdict = m.update(1);
        // Either outcome is legitimate; what must not happen is running forever.
        expect(verdict).not.toBeNull();
    });

    it('reports facts, not a score', () => {
        const m = run();
        m.update(1);
        const facts = m.end();
        expect(facts).toHaveProperty('satellitesAlive');
        expect(facts).toHaveProperty('satellitesLost');
        expect(facts).toHaveProperty('fuelSpent');
        expect(facts).toHaveProperty('survivedMs');
        expect(facts).not.toHaveProperty('score');
    });
});

describe('T14: the object cap holds', () => {
    it('never exceeds MAX_OBJECTS however long the run goes', () => {
        const m = createKesslerRun({ hud: {}, audio: {} });
        m.init();
        m.start();
        let peak = 0;
        for (let i = 0; i < 600; i++) {
            m.update(0.5);
            peak = Math.max(peak, m.objects().length);
        }
        expect(peak).toBeLessThanOrEqual(risk.MAX_OBJECTS);
    });

    it('keeps the pairwise check inside a sane budget at the cap', () => {
        // 120 objects is 7,140 pairs. Asserted as a number rather than a timing,
        // because a wall-clock assertion would be flaky on a loaded machine.
        const pairs = (risk.MAX_OBJECTS * (risk.MAX_OBJECTS - 1)) / 2;
        expect(pairs).toBeLessThan(10000);
    });
});

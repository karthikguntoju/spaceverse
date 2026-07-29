/**
 * Scan Hunt (T8).
 *
 * The mission takes its solar system through ctx rather than reaching into the
 * scene, which is exactly what makes it testable here with no renderer, no
 * WebGL and no browser. If this file ever needs a Three.js import, the
 * renderer-agnostic decision has been broken somewhere.
 */
let createScanHunt;
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
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ score: 10 }) });
    ({ createScanHunt } = await import('../public/js/game/missions/scan-hunt.js'));
    core = await import('../public/js/game/core.js');
});

beforeEach(() => {
    store.clear();
    core.reset();
    // Registration is one-shot per id, so each test that registers its own
    // mission instance clears the previous one first.
    core.unregister('scan-hunt');
});

/** A stand-in for the solar system: keys and facts, nothing else. */
function fakeSystem(keys) {
    return {
        scannableKeys: () => keys,
        getInfo: (key) => (keys.includes(key)
            ? { key, name: key, fact: `A fact about ${key}.` }
            : null)
    };
}

const TEN = ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'jupiter/Io'];

describe('target selection', () => {
    it('picks five distinct targets', () => {
        const m = createScanHunt({ system: fakeSystem(TEN) });
        m.init();
        const { queue } = m._state();
        expect(queue).toHaveLength(5);
        expect(new Set(queue).size).toBe(5);
    });

    it('never asks the player to find the Sun', () => {
        const m = createScanHunt({ system: fakeSystem(TEN) });
        for (let i = 0; i < 25; i++) {
            m.init();
            expect(m._state().queue).not.toContain('sun');
        }
    });

    it('throws rather than starting a timer over nothing', () => {
        const m = createScanHunt({ system: fakeSystem([]) });
        expect(() => m.init()).toThrow(/no scannable bodies/);
    });

    it('takes what it can get when the pool is smaller than five', () => {
        const m = createScanHunt({ system: fakeSystem(['earth', 'mars', 'sun']) });
        m.init();
        expect(m._state().queue).toHaveLength(2);
    });
});

describe('scanning', () => {
    function started(keys = TEN) {
        const objectives = [];
        const flashes = [];
        const m = createScanHunt({
            system: fakeSystem(keys),
            hud: {
                setObjective: (t) => objectives.push(t),
                flash: (k) => flashes.push(k),
                setProgress: () => {}
            }
        });
        m.init();
        m.start();
        return { m, objectives, flashes };
    }

    it('announces the fact, not the name', () => {
        const { m, objectives } = started();
        const target = m._state().queue[0];
        expect(objectives[0]).toBe(`A fact about ${target}.`);
        expect(objectives[0]).not.toBe(target);
    });

    it('advances on a correct scan', () => {
        const { m, flashes } = started();
        const target = m._state().queue[0];
        expect(m.onScan(target)).toBe(true);
        expect(m._state().found).toBe(1);
        expect(m._state().index).toBe(1);
        expect(flashes).toContain('correct');
    });

    it('counts a wrong scan without advancing', () => {
        const { m, flashes } = started();
        const wrong = m._state().queue[2];
        expect(m.onScan(wrong)).toBe(false);
        expect(m._state().missed).toBe(1);
        expect(m._state().index).toBe(0);
        expect(flashes).toContain('wrong');
    });

    it('wins when every target is found', () => {
        const { m } = started();
        expect(m.update()).toBeNull();
        for (const key of m._state().queue.slice()) m.onScan(key);
        expect(m.update()).toEqual({ won: true });
    });

    it('ignores scans after the hunt is over', () => {
        const { m } = started();
        const queue = m._state().queue.slice();
        for (const key of queue) m.onScan(key);
        expect(m.onScan(queue[0])).toBe(false);
        expect(m._state().found).toBe(5);
    });

    it('routes onInput scan events to onScan', () => {
        const { m } = started();
        const target = m._state().queue[0];
        m.onInput({ type: 'scan', key: target });
        expect(m._state().found).toBe(1);
    });

    it('reports found and missed as facts', () => {
        const { m } = started();
        const queue = m._state().queue.slice();
        m.onScan(queue[1]);          // wrong
        m.onScan(queue[0]);          // right
        const facts = m.end({ won: false });
        expect(facts.found).toBe(1);
        expect(facts.missed).toBe(1);
        expect(facts.targets).toBe(5);
    });
});

describe('running on the core', () => {
    it('completes a full run and reports facts, never a score', async () => {
        const m = createScanHunt({ system: fakeSystem(TEN) });
        core.register(m);

        const posted = [];
        globalThis.fetch = async (_url, opts) => {
            posted.push(JSON.parse(opts.body));
            return { ok: true, status: 200, json: async () => ({ score: 63 }) };
        };

        await core.run('scan-hunt');
        for (const key of m._state().queue.slice()) m.onScan(key);
        const result = core.tick(0.016);
        await new Promise((r) => setImmediate(r));

        expect(result.won).toBe(true);
        expect(posted[0].missionId).toBe('scan-hunt');
        expect(posted[0].facts.found).toBe(5);
        expect(posted[0].score).toBeUndefined();
    });

    it('fails on the core clock when targets are left unfound', async () => {
        const m = createScanHunt({ system: fakeSystem(TEN) });
        core.register(m);
        await core.run('scan-hunt');

        // maxMs is 90s; step past it.
        expect(core.tick(45)).toBeNull();
        const result = core.tick(46);
        expect(result.failed).toBe(true);
        expect(result.reason).toBe('timeout');
    });
});

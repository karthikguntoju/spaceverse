/**
 * Mission core (T3, T11, T12).
 *
 * The core is a browser ES module, so these tests import it dynamically and stub
 * the three browser APIs it touches: fetch, sessionStorage and performance.
 */

let core;
let fetchCalls;
let fetchImpl;
let store;

beforeAll(async () => {
    // Minimal sessionStorage. The core must survive this being absent or broken,
    // which is asserted separately below.
    store = new Map();
    globalThis.sessionStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear()
    };
    globalThis.fetch = (...args) => {
        fetchCalls.push(args);
        return fetchImpl(...args);
    };
    core = await import('../public/js/game/core.js');
});

beforeEach(() => {
    fetchCalls = [];
    store.clear();
    core.reset();
    fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ score: 42 }) });
});

// A failed assertion inside a fake-timer test skips its own useRealTimers(),
// and the leaked fake timers then hang every later test on setImmediate — one
// real failure turns into a wall of 30s timeouts that hides it. Restore here so
// a failure stays a single failure.
afterEach(() => {
    vi.useRealTimers();
});

/** A mission that ends when you tell it to. */
function stubMission(id, opts = {}) {
    const calls = { init: 0, start: 0, update: 0, end: 0, teardown: 0, onPause: [] };
    let verdict = null;
    return {
        calls,
        finishWith: (v) => { verdict = v; },
        mission: {
            meta: { id, title: opts.title || id, maxMs: opts.maxMs },
            init() { calls.init++; if (opts.initThrows) throw new Error('init boom'); },
            start() { calls.start++; },
            update() {
                calls.update++;
                if (opts.updateThrows) throw new Error('update boom');
                return verdict;
            },
            end(v) { calls.end++; return { seen: calls.update, verdict: v }; },
            teardown() { calls.teardown++; },
            onPause(p) { calls.onPause.push(p); }
        }
    };
}

describe('registry', () => {
    it('rejects a mission missing a required hook', () => {
        expect(() => core.register({ meta: { id: 'bad' }, init() {}, start() {} }))
            .toThrow(/missing: update, end/);
    });

    it('rejects a mission with no id', () => {
        expect(() => core.register({})).toThrow(/meta\.id/);
    });

    it('rejects a duplicate id', () => {
        core.register(stubMission('dup').mission);
        expect(() => core.register(stubMission('dup').mission)).toThrow(/duplicate/);
    });
});

describe('run lifecycle', () => {
    it('refuses an unknown mission id', async () => {
        await expect(core.run('nope')).rejects.toThrow(/unknown mission/);
    });

    it('returns to idle when init throws, rather than stranding the player', async () => {
        core.register(stubMission('init-fail', { initThrows: true }).mission);
        await expect(core.run('init-fail')).rejects.toThrow('init boom');
        expect(core.snapshot().phase).toBe('idle');
    });

    it('runs init then start and lands in playing', async () => {
        const s = stubMission('happy');
        core.register(s.mission);
        await core.run('happy');
        expect(s.calls.init).toBe(1);
        expect(s.calls.start).toBe(1);
        expect(core.snapshot().phase).toBe('playing');
    });

    it('returns null from tick until the mission ends', async () => {
        const s = stubMission('ticker');
        core.register(s.mission);
        await core.run('ticker');
        expect(core.tick(0.016)).toBeNull();
        expect(core.tick(0.016)).toBeNull();
        s.finishWith({ won: true });
        const result = core.tick(0.016);
        expect(result.won).toBe(true);
        expect(result.facts.seen).toBe(3);
    });

    it('fails the run when maxMs is exceeded', async () => {
        core.register(stubMission('short', { maxMs: 100 }).mission);
        await core.run('short');
        expect(core.tick(0.05)).toBeNull();
        const result = core.tick(0.06);   // 110ms total
        expect(result.failed).toBe(true);
        expect(result.reason).toBe('timeout');
    });

    it('ends the run as failed when update() throws instead of hanging', async () => {
        core.register(stubMission('thrower', { updateThrows: true }).mission);
        await core.run('thrower');
        const result = core.tick(0.016);
        expect(result.failed).toBe(true);
        expect(result.reason).toBe('error');
    });

    it('calls teardown when the run ends', async () => {
        const s = stubMission('tidy');
        core.register(s.mission);
        await core.run('tidy');
        s.finishWith({ won: true });
        core.tick(0.016);
        expect(s.calls.teardown).toBe(1);
    });

    it('ignores ticks once the run is over', async () => {
        const s = stubMission('done');
        core.register(s.mission);
        await core.run('done');
        s.finishWith({ won: true });
        core.tick(0.016);
        expect(core.tick(0.016)).toBeNull();
    });

    it('refuses to start a second mission while one is running', async () => {
        core.register(stubMission('a1').mission);
        core.register(stubMission('a2').mission);
        await core.run('a1');
        await expect(core.run('a2')).rejects.toThrow(/already running/);
    });
});

describe('abort', () => {
    it('marks the run abandoned and submits nothing', async () => {
        const s = stubMission('bail');
        core.register(s.mission);
        await core.run('bail');
        core.tick(0.016);
        const result = core.abort();
        expect(result.abandoned).toBe(true);
        expect(s.calls.end).toBe(1);
        expect(s.calls.teardown).toBe(1);
        expect(fetchCalls).toHaveLength(0);
    });

    it('is a no-op when nothing is running', () => {
        expect(core.abort()).toBeNull();
    });
});

describe('tick watchdog', () => {
    it('warns when the host never pumps the core', async () => {
        vi.useFakeTimers();
        const warnings = [];
        const off = core.on('warning', (w) => warnings.push(w));
        core.register(stubMission('unpumped').mission);
        await core.run('unpumped');

        vi.advanceTimersByTime(core.TICK_WATCHDOG + 10);
        expect(warnings).toHaveLength(1);
        expect(warnings[0].code).toBe('no-tick');
        expect(core.snapshot().warnedNoTick).toBe(true);

        off();
        vi.useRealTimers();
    });

    it('stays quiet when ticks arrive', async () => {
        vi.useFakeTimers();
        const warnings = [];
        const off = core.on('warning', (w) => warnings.push(w));
        core.register(stubMission('pumped').mission);
        await core.run('pumped');
        core.tick(0.016);

        vi.advanceTimersByTime(core.TICK_WATCHDOG + 10);
        expect(warnings).toHaveLength(0);

        off();
        vi.useRealTimers();
    });
});

describe('submission', () => {
    it('posts facts and never a score', async () => {
        const s = stubMission('facts');
        core.register(s.mission);
        await core.run('facts');
        s.finishWith({ won: true });
        core.tick(0.016);
        await new Promise((r) => setImmediate(r));

        expect(fetchCalls).toHaveLength(1);
        const body = JSON.parse(fetchCalls[0][1].body);
        expect(body.missionId).toBe('facts');
        expect(body.facts).toBeDefined();
        expect(body.score).toBeUndefined();
    });

    it('queues the run when the network fails', async () => {
        fetchImpl = async () => { throw new Error('offline'); };
        const s = stubMission('offline');
        core.register(s.mission);
        await core.run('offline');
        s.finishWith({ won: true });
        core.tick(0.016);
        await new Promise((r) => setImmediate(r));

        expect(core.queueDepth()).toBe(1);
    });

    it('queues the run when the server rejects it', async () => {
        fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
        const s = stubMission('server-down');
        core.register(s.mission);
        await core.run('server-down');
        s.finishWith({ won: true });
        core.tick(0.016);
        await new Promise((r) => setImmediate(r));

        expect(core.queueDepth()).toBe(1);
    });

    it('reports saved:false to the result listener so the UI can say so', async () => {
        fetchImpl = async () => { throw new Error('offline'); };
        const results = [];
        const off = core.on('result', (r) => results.push(r));
        const s = stubMission('badge');
        core.register(s.mission);
        await core.run('badge');
        s.finishWith({ won: true });
        core.tick(0.016);
        await new Promise((r) => setImmediate(r));

        expect(results[0].saved).toBe(false);
        expect(results[0].queued).toBe(true);
        off();
    });
});

describe('offline queue', () => {
    it('drains oldest-first when the network returns', async () => {
        fetchImpl = async () => { throw new Error('offline'); };
        for (const id of ['q1', 'q2']) {
            const s = stubMission(id);
            core.register(s.mission);
            await core.run(id);
            s.finishWith({ won: true });
            core.tick(0.016);
            await new Promise((r) => setImmediate(r));
            core.reset();
        }
        expect(core.queueDepth()).toBe(2);

        const posted = [];
        fetchImpl = async (_url, opts) => {
            posted.push(JSON.parse(opts.body).missionId);
            return { ok: true, status: 200, json: async () => ({ score: 1 }) };
        };
        const out = await core.flushQueue();
        expect(out.flushed).toBe(2);
        expect(posted).toEqual(['q1', 'q2']);
        expect(core.queueDepth()).toBe(0);
    });

    it('stops at the first failure and keeps the rest in order', async () => {
        fetchImpl = async () => { throw new Error('offline'); };
        for (const id of ['k1', 'k2', 'k3']) {
            const s = stubMission(id);
            core.register(s.mission);
            await core.run(id);
            s.finishWith({ won: true });
            core.tick(0.016);
            await new Promise((r) => setImmediate(r));
            core.reset();
        }

        let n = 0;
        fetchImpl = async () => {
            n++;
            if (n === 2) throw new Error('dropped again');
            return { ok: true, status: 200, json: async () => ({}) };
        };
        const out = await core.flushQueue();
        expect(out.flushed).toBe(1);
        expect(out.remaining).toBe(2);
    });

    it('survives corrupt queue storage', async () => {
        store.set('spaceverse.runQueue', '{not json');
        expect(core.queueDepth()).toBe(0);
        await expect(core.flushQueue()).resolves.toEqual({ flushed: 0, remaining: 0 });
    });

    it('flushes stranded runs after the next successful submit', async () => {
        fetchImpl = async () => { throw new Error('offline'); };
        const a = stubMission('strand');
        core.register(a.mission);
        await core.run('strand');
        a.finishWith({ won: true });
        core.tick(0.016);
        await new Promise((r) => setImmediate(r));
        core.reset();
        expect(core.queueDepth()).toBe(1);

        fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ score: 5 }) });
        const b = stubMission('back-online');
        core.register(b.mission);
        await core.run('back-online');
        b.finishWith({ won: true });
        core.tick(0.016);
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));

        expect(core.queueDepth()).toBe(0);
    });
});

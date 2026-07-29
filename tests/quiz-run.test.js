/**
 * Launch Checklist (T10) — and the cost check on the mission core.
 *
 * This mission shares nothing with Scan Hunt except the core: no scene, no
 * renderer, no WebXR, DOM only. That is the point. If the core had to change to
 * host it, the abstraction was wrong.
 */
let createQuizRun;
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
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ score: 30 }) });
    ({ createQuizRun } = await import('../public/js/game/missions/quiz-run.js'));
    core = await import('../public/js/game/core.js');
});

beforeEach(() => {
    store.clear();
    core.reset();
    core.unregister('quiz-run');
});

const QUESTIONS = Array.from({ length: 5 }, (_, i) => ({
    question: `Q${i}`,
    options: ['a', 'b', 'c', 'd'],
    correctAnswer: i % 4
}));

function started(questions = QUESTIONS) {
    const flashes = [];
    const shown = [];
    const m = createQuizRun({
        questions,
        hud: {
            showQuestion: (q) => shown.push(q),
            flash: (k) => flashes.push(k),
            setLives: () => {},
            setClock: () => {}
        }
    });
    m.init();
    m.start();
    return { m, flashes, shown };
}

describe('checklist mechanics', () => {
    it('throws rather than starting an empty checklist', () => {
        const m = createQuizRun({ questions: [] });
        expect(() => m.init()).toThrow(/no questions/);
    });

    it('presents the first question on start', () => {
        const { shown } = started();
        expect(shown[0]).toBeDefined();
        expect(shown[0].question).toMatch(/^Q\d$/);
    });

    it('starts with three lives', () => {
        const { m } = started();
        expect(m._state().lives).toBe(3);
    });

    it('a wrong answer calls a hold and costs a life', () => {
        // Single question, because init() shuffles: with five questions there is
        // no way to know from outside which one is being asked, so "the wrong
        // option" cannot be computed reliably.
        const { m, flashes } = started([{ question: 'only', options: ['a', 'b'], correctAnswer: 1 }]);
        m.answer(0);
        expect(m._state().lives).toBe(2);
        expect(m._state().wrong).toBe(1);
        expect(flashes).toContain('hold');
    });

    it('keeps you on the same item after a hold', () => {
        const single = [{ question: 'only', options: ['a', 'b', 'c', 'd'], correctAnswer: 1 }];
        const m = createQuizRun({ questions: single });
        m.init();
        m.start();
        m.answer(0);                       // wrong
        expect(m._state().index).toBe(0);  // still on the same item
        expect(m._state().outcome).toBeNull();
        expect(m.answer(1)).toBe(true);    // and it can still be cleared
    });

    it('scrubs the launch after three holds', () => {
        const single = [{ question: 'only', options: ['a', 'b', 'c', 'd'], correctAnswer: 1 }];
        const m = createQuizRun({ questions: single });
        m.init();
        m.start();
        m.answer(0);
        m.answer(2);
        m.answer(3);
        expect(m._state().lives).toBe(0);
        expect(m.update(0)).toEqual({ failed: true, reason: 'scrubbed' });
    });

    it('does not let a wrong answer on the last item clear the checklist', () => {
        const single = [{ question: 'only', options: ['a', 'b'], correctAnswer: 1 }];
        const m = createQuizRun({ questions: single });
        m.init();
        m.start();
        m.answer(0);                       // wrong, on the only item
        expect(m.update(0)).toBeNull();    // NOT a win
        expect(m._state().outcome).toBeNull();
    });

    it('wins when the checklist is cleared', () => {
        const single = [{ question: 'only', options: ['a', 'b'], correctAnswer: 1 }];
        const m = createQuizRun({ questions: single });
        m.init();
        m.start();
        expect(m.answer(1)).toBe(true);
        expect(m.update(0)).toEqual({ won: true });
    });

    it('costs a life when the per-question clock runs out', () => {
        const { m } = started();
        m.update(20);   // 20s against a 15s per-question clock
        expect(m._state().wrong).toBe(1);
        expect(m._state().lives).toBe(2);
    });

    it('ignores answers once the run is over', () => {
        const single = [{ question: 'only', options: ['a', 'b'], correctAnswer: 1 }];
        const m = createQuizRun({ questions: single });
        m.init();
        m.start();
        m.answer(1);
        expect(m.answer(1)).toBeNull();
    });

    it('reports correct, wrong and lives as facts', () => {
        const single = [{ question: 'only', options: ['a', 'b'], correctAnswer: 1 }];
        const m = createQuizRun({ questions: single });
        m.init();
        m.start();
        m.answer(1);
        const facts = m.end();
        expect(facts).toEqual({ correct: 1, wrong: 0, livesLeft: 3, total: 1 });
    });
});

describe('COST CHECK: mission 3 on an unchanged core', () => {
    it('runs end to end with no core changes and no renderer', async () => {
        const single = [{ question: 'only', options: ['a', 'b'], correctAnswer: 1 }];
        const m = createQuizRun({ questions: single });
        core.register(m);

        const posted = [];
        globalThis.fetch = async (_url, opts) => {
            posted.push(JSON.parse(opts.body));
            return { ok: true, status: 200, json: async () => ({ score: 18 }) };
        };

        await core.run('quiz-run');
        m.answer(1);
        const result = core.tick(0.016);
        await new Promise((r) => setImmediate(r));

        expect(result.won).toBe(true);
        expect(posted[0].missionId).toBe('quiz-run');
        expect(posted[0].facts.correct).toBe(1);
        expect(posted[0].score).toBeUndefined();
    });

    it('uses the same five required hooks as the 3D missions', async () => {
        const m = createQuizRun({ questions: QUESTIONS });
        for (const hook of ['init', 'start', 'update', 'end']) {
            expect(typeof m[hook]).toBe('function');
        }
        expect(m.meta.id).toBe('quiz-run');
        // maxMs: 0 means "no whole-run cap" — the core must accept that rather
        // than forcing every mission to have an overall clock.
        expect(m.meta.maxMs).toBe(0);
        core.register(m);
        await expect(core.run('quiz-run')).resolves.toBeDefined();
        expect(core.tick(3600)).toBeNull();   // an hour, and still not timed out
    });
});

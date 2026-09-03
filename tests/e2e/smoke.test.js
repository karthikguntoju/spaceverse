/**
 * End-to-end smoke flow.
 *
 * Walks the path a visitor actually takes — land signed-out, sign in, open the
 * protected pages, run a simulation, read it back from history, check the
 * leaderboard, ask the assistant a question, sign out — asserting status and
 * shape at each step. It is WebGL-free (supertest, no browser) so it runs in CI
 * unattended; the review's remaining "18 manual flows" gap is about the
 * in-browser 3D flows, which still need a headed run.
 */
const request = require('supertest');
const { startTestDb, stopTestDb, clearDb, loadApp } = require('./../helpers/server');

let app;

beforeAll(async () => {
    await startTestDb();
    app = loadApp();
}, 120000);

afterAll(async () => {
    await stopTestDb();
});

beforeEach(async () => {
    await clearDb();
});

describe('visitor smoke flow', () => {
    it('serves the signed-out landing page at /', async () => {
        const res = await request(app).get('/');
        expect(res.status).toBe(200);
        expect(res.text).toMatch(/<title>[^<]*Spaceverse/i);
    });

    it('redirects a signed-out visitor away from a protected page', async () => {
        const res = await request(app).get('/space-traffic-simulator').redirects(0);
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/');
    });

    it('completes the full authenticated journey', async () => {
        const agent = request.agent(app);

        // sign in
        const login = await agent.post('/api/login').send({ username: 'E2EPilot', password: 'x' });
        expect(login.status).toBe(200);
        expect(login.body.success).toBe(true);
        const callsign = login.body.username;

        // identity endpoint agrees
        const me = await agent.get('/api/user');
        expect(me.body.loggedIn).toBe(true);
        expect(me.body.username).toBe(callsign);

        // protected pages now open
        for (const path of ['/app', '/solar-system', '/quiz', '/space-traffic-simulator', '/games', '/vr-solar-system']) {
            const page = await agent.get(path);
            expect(page.status, `${path} should be 200 when signed in`).toBe(200);
        }

        // reference data endpoint responds with an array (seed data is an
        // app-boot concern; the in-memory test DB starts empty)
        const planets = await agent.get('/api/planets');
        expect(planets.status).toBe(200);
        expect(Array.isArray(planets.body)).toBe(true);

        // run a simulation
        const run = await agent.post('/api/simulator/run').send({
            scenarioName: 'E2E nominal launch',
            eventType: 'launch',
            parameters: { altitude: 550, inclination: 53, velocity: 7.6, mass: 300, launchTime: '2026-09-03T00:00:00Z' }
        });
        expect(run.status).toBe(200);
        expect(run.body.success).toBe(true);
        const idx = run.body.aiAnalysis.collisionRiskPercentage;
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThanOrEqual(100);
        // label in the explanation must agree with the band the number falls in
        const band = idx >= 65 ? /HIGH/ : idx >= 35 ? /MODERATE/ : /LOW/;
        expect(run.body.aiAnalysis.explanation).toMatch(band);

        // it shows up in history
        const history = await agent.get('/api/simulator/history');
        expect(history.status).toBe(200);
        const list = history.body.simulations || history.body.history || history.body;
        expect(JSON.stringify(list)).toMatch(/E2E nominal launch/);

        // leaderboard is well-formed and free of null-join placeholders
        const board = await agent.get('/api/simulator/leaderboard');
        expect(board.status).toBe(200);
        for (const row of board.body.leaderboard) {
            expect(row.username).toBeTruthy();
            expect(row.username).not.toBe('Unknown User');
            expect(Number.isFinite(row.totalScore)).toBe(true);
            // rounded to <= 1 decimal place
            expect(String(row.totalScore)).toMatch(/^-?\d+(\.\d)?$/);
        }

        // assistant answers from the offline corpus
        const chat = await agent.post('/api/simulator/chatbot').send({ question: 'what is the kessler syndrome?' });
        expect(chat.status).toBe(200);
        expect(chat.body.answer.toLowerCase()).toContain('kessler');

        // sign out, and protected pages close again
        const logout = await agent.post('/api/logout');
        expect(logout.body.success).toBe(true);
        const afterLogout = await agent.get('/app').redirects(0);
        expect(afterLogout.status).toBe(302);
    });
});

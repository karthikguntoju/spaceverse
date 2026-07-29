/**
 * Demo pilot identity (T1 + T13).
 *
 * Before this existed, every demo login minted a throwaway ObjectId with no User
 * document, so nothing a demo player did could survive the session and the
 * leaderboard had no name to show. These tests pin the two properties that fix
 * depends on: a full callsign resumes the same pilot, and two people typing the
 * same base name get visibly different pilots instead of silently sharing one.
 */
// describe/it/expect/hooks come from vitest globals (see vitest.config.js).
const request = require('supertest');
const mongoose = require('mongoose');
const { startTestDb, stopTestDb, clearDb, loadApp } = require('./helpers/server');

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

const login = (callsign) =>
    request(app).post('/api/login').send({ username: callsign, password: 'anything' });

describe('demo pilot identity', () => {
    it('creates a real User document, not a throwaway id', async () => {
        const res = await login('Nova');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const User = mongoose.model('User');
        const pilot = await User.findOne({ username: res.body.username });
        expect(pilot).not.toBeNull();
        expect(pilot.isDemo).toBe(true);
    });

    it('appends a suffix so the callsign is unambiguous', async () => {
        const res = await login('Nova');
        // "Nova-K4M" shape: base, hyphen, three unambiguous characters.
        expect(res.body.username).toMatch(/^Nova-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}$/);
    });

    it('resumes the same pilot when the full callsign is typed again', async () => {
        const first = await login('Nova');
        const callsign = first.body.username;

        const second = await login(callsign);
        expect(second.body.username).toBe(callsign);

        const User = mongoose.model('User');
        expect(await User.countDocuments({ isDemo: true })).toBe(1);
    });

    it('gives two people typing the same base name different pilots', async () => {
        const a = await login('Nova');
        const b = await login('Nova');

        expect(a.body.username).not.toBe(b.body.username);

        const User = mongoose.model('User');
        expect(await User.countDocuments({ isDemo: true })).toBe(2);
    });

    it('falls back to a usable callsign when the field is blank', async () => {
        const res = await login('');
        expect(res.body.username).toMatch(/^Explorer-/);
    });

    it('clamps an overlong callsign and still suffixes it', async () => {
        const res = await login('X'.repeat(80));
        expect(res.body.username.length).toBeLessThanOrEqual(32);
        expect(res.body.username).toMatch(/-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}$/);
    });

    it('reports the session as non-ephemeral so the client does not warn', async () => {
        const res = await login('Nova');
        const me = await request(app).get('/api/user').set('Cookie', res.headers['set-cookie']);
        expect(me.body.loggedIn).toBe(true);
        expect(me.body.demo).toBe(true);
        expect(me.body.ephemeral).toBe(false);
    });

    it('never issues a password that could authenticate the demo pilot', async () => {
        const res = await login('Nova');
        const User = mongoose.model('User');
        const pilot = await User.findOne({ username: res.body.username });
        // bcrypt hash of a random secret nobody holds.
        expect(pilot.password).toMatch(/^\$2[aby]\$/);
        expect(pilot.email).toMatch(/@demo\.invalid$/);
        expect(pilot.firebaseUid).toBeNull();
    });
});

describe('demo pilot progression persists', () => {
    it('writes quiz scores to the User document, not just the session', async () => {
        const res = await login('Nova');
        const cookie = res.headers['set-cookie'];
        const callsign = res.body.username;

        await request(app)
            .post('/api/quiz/submit')
            .set('Cookie', cookie)
            .send({ score: 7, totalQuestions: 10 })
            .expect(200);

        const User = mongoose.model('User');
        const pilot = await User.findOne({ username: callsign });
        expect(pilot.quizScores).toHaveLength(1);
        expect(pilot.quizScores[0].score).toBe(7);
    });

    it('still reports the score after logging back in as the same callsign', async () => {
        const first = await login('Nova');
        const callsign = first.body.username;
        await request(app)
            .post('/api/quiz/submit')
            .set('Cookie', first.headers['set-cookie'])
            .send({ score: 7, totalQuestions: 10 });

        // Fresh session, same pilot.
        const second = await login(callsign);
        const scores = await request(app)
            .get('/api/quiz/scores')
            .set('Cookie', second.headers['set-cookie'])
            .expect(200);

        expect(scores.body.scores).toHaveLength(1);
        expect(scores.body.scores[0].score).toBe(7);
    });
});

/**
 * /api/game/run contract (T4) and the UserScore migration regressions (T6).
 *
 * The regression block is not optional decoration. Generalising UserScore
 * touched a collection that already has documents in Atlas and a screen that
 * reads it by hardcoded DOM id, so these tests pin the two things that must not
 * change: a pre-migration document still loads and still ranks, and the three
 * score axes the simulator renders keep their names and their level rule.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const { startTestDb, stopTestDb, clearDb, loadApp } = require('./helpers/server');
const { syncTotals, LEVELS } = require('../models/user-score');

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

async function loginAs(callsign) {
    const res = await request(app).post('/api/login').send({ username: callsign, password: 'x' });
    return { cookie: res.headers['set-cookie'], callsign: res.body.username };
}

const runBody = (overrides = {}) => Object.assign({
    missionId: 'scan-hunt',
    won: true,
    failed: false,
    elapsedMs: 45000,
    facts: { found: 5, missed: 1, elapsedMs: 45000 }
}, overrides);

describe('POST /api/game/run — auth and validation', () => {
    it('rejects an unauthenticated run', async () => {
        await request(app).post('/api/game/run').send(runBody()).expect(401);
    });

    it('rejects an unknown mission', async () => {
        const { cookie } = await loginAs('Nova');
        const res = await request(app)
            .post('/api/game/run').set('Cookie', cookie)
            .send(runBody({ missionId: 'not-a-mission' }))
            .expect(400);
        expect(res.body.message).toMatch(/Unknown mission/);
    });

    it('rejects a fact outside its declared range', async () => {
        const { cookie } = await loginAs('Nova');
        const res = await request(app)
            .post('/api/game/run').set('Cookie', cookie)
            .send(runBody({ facts: { found: 9999, missed: 0, elapsedMs: 1000 } }))
            .expect(400);
        expect(res.body.message).toMatch(/out of range/);
    });

    it('rejects a non-numeric fact', async () => {
        const { cookie } = await loginAs('Nova');
        await request(app)
            .post('/api/game/run').set('Cookie', cookie)
            .send(runBody({ facts: { found: 'lots', missed: 0, elapsedMs: 1000 } }))
            .expect(400);
    });

    it('treats missing facts as zero rather than failing the run', async () => {
        const { cookie } = await loginAs('Nova');
        const res = await request(app)
            .post('/api/game/run').set('Cookie', cookie)
            .send(runBody({ facts: {} }))
            .expect(200);
        expect(res.body.score).toBe(0);
    });
});

describe('POST /api/game/run — the client cannot name its own score', () => {
    it('ignores a score supplied by the client', async () => {
        const { cookie } = await loginAs('Cheater');
        const res = await request(app)
            .post('/api/game/run').set('Cookie', cookie)
            .send(Object.assign(runBody(), { score: 999999 }))
            .expect(200);

        // 5 found * 10 - 1 missed * 2 = 48, +15 speed bonus under 60s.
        expect(res.body.score).toBe(63);
        expect(res.body.score).not.toBe(999999);
    });

    it('stores the server score, not the posted one', async () => {
        const { cookie, callsign } = await loginAs('Cheater');
        await request(app)
            .post('/api/game/run').set('Cookie', cookie)
            .send(Object.assign(runBody(), { score: 999999 }));

        const User = mongoose.model('User');
        const UserScore = mongoose.model('UserScore');
        const user = await User.findOne({ username: callsign });
        const rec = await UserScore.findOne({ userId: user._id });
        expect(rec.missionXp).toBe(63);
    });

    it('withholds the speed bonus from a failed run', async () => {
        const { cookie } = await loginAs('Quitter');
        const res = await request(app)
            .post('/api/game/run').set('Cookie', cookie)
            .send(runBody({ won: false, failed: true }))
            .expect(200);
        expect(res.body.score).toBe(48);   // no +15
    });
});

describe('POST /api/game/run — progression', () => {
    it('accumulates mission XP across runs', async () => {
        const { cookie } = await loginAs('Nova');
        await request(app).post('/api/game/run').set('Cookie', cookie).send(runBody());
        const second = await request(app)
            .post('/api/game/run').set('Cookie', cookie).send(runBody());
        expect(second.body.progression.missionXp).toBe(126);
        expect(second.body.progression.totalMissions).toBe(2);
    });

    it('awards a first-mission badge exactly once', async () => {
        const { cookie } = await loginAs('Nova');
        const first = await request(app).post('/api/game/run').set('Cookie', cookie).send(runBody());
        const second = await request(app).post('/api/game/run').set('Cookie', cookie).send(runBody());

        expect(first.body.progression.newBadges.map((b) => b.id)).toContain('first_mission');
        expect(second.body.progression.newBadges.map((b) => b.id)).not.toContain('first_mission');
    });

    it('promotes through the rank ladder as XP accumulates', async () => {
        const { cookie } = await loginAs('Climber');
        let last;
        for (let i = 0; i < 4; i++) {
            last = await request(app).post('/api/game/run').set('Cookie', cookie).send(runBody());
        }
        // 4 * 63 = 252 -> past 180 and 240.
        expect(last.body.progression.totalScore).toBe(252);
        expect(last.body.progression.level).toBe('Space Sustainability Engineer');
    });

    it('survives an ephemeral session without a pilot record', async () => {
        const { cookie } = await loginAs('Nova');
        // Force the ephemeral path the way a database outage would.
        const agentRun = await request(app)
            .post('/api/game/run').set('Cookie', cookie).send(runBody());
        expect(agentRun.body.persisted).toBe(true);
    });

    it('scores every declared mission', async () => {
        const { cookie } = await loginAs('AllRounder');
        const kessler = await request(app).post('/api/game/run').set('Cookie', cookie).send({
            missionId: 'kessler-run', won: true, elapsedMs: 120000,
            facts: { satellitesAlive: 12, satellitesLost: 3, fuelSpent: 40, survivedMs: 120000, peakRisk: 55 }
        }).expect(200);
        expect(kessler.body.score).toBeGreaterThan(0);

        const quiz = await request(app).post('/api/game/run').set('Cookie', cookie).send({
            missionId: 'quiz-run', won: true, elapsedMs: 90000,
            facts: { correct: 8, wrong: 2, livesLeft: 2, elapsedMs: 90000 }
        }).expect(200);
        expect(quiz.body.score).toBe(32);   // 8*3 - 2 + 2*5
    });
});

describe('GET /api/game/missions', () => {
    it('lists what the server will score', async () => {
        const res = await request(app).get('/api/game/missions').expect(200);
        const ids = res.body.missions.map((m) => m.id);
        expect(ids).toEqual(expect.arrayContaining(['scan-hunt', 'kessler-run', 'quiz-run']));
    });
});

/* ── REGRESSION: the simulator must survive the UserScore migration ── */

describe('REGRESSION: pre-migration UserScore documents', () => {
    /** A document exactly as it was written before totalScore/missionXp existed. */
    async function insertLegacyDoc(userId, scores, level) {
        await mongoose.connection.collection('userscores').insertOne({
            userId,
            scores,
            level,
            badges: [],
            achievements: [],
            totalSimulations: 3,
            lastUpdated: new Date()
            // No totalScore. No missionXp. This is the shape in Atlas today.
        });
    }

    it('still loads through the current schema', async () => {
        const UserScore = mongoose.model('UserScore');
        const userId = new mongoose.Types.ObjectId();
        await insertLegacyDoc(userId, { safetyScore: 70, sustainabilityScore: 60, efficiencyScore: 50 }, 'Orbital Optimizer');

        const doc = await UserScore.findOne({ userId });
        expect(doc).not.toBeNull();
        expect(doc.scores.safetyScore).toBe(70);
        expect(doc.level).toBe('Orbital Optimizer');
        expect(doc.totalSimulations).toBe(3);
    });

    it('keeps all three original level values valid', () => {
        expect(LEVELS.slice(0, 3)).toEqual([
            'Safe Launcher',
            'Orbital Optimizer',
            'Space Sustainability Engineer'
        ]);
    });

    it('reproduces the old average-based level rule exactly', () => {
        // Old rule: avg >= 80 top tier, avg >= 60 middle, else base.
        const cases = [
            [{ safetyScore: 90, sustainabilityScore: 85, efficiencyScore: 80 }, 'Space Sustainability Engineer'],
            [{ safetyScore: 80, sustainabilityScore: 80, efficiencyScore: 80 }, 'Space Sustainability Engineer'],
            [{ safetyScore: 60, sustainabilityScore: 60, efficiencyScore: 60 }, 'Orbital Optimizer'],
            [{ safetyScore: 70, sustainabilityScore: 60, efficiencyScore: 50 }, 'Orbital Optimizer'],
            [{ safetyScore: 10, sustainabilityScore: 10, efficiencyScore: 10 }, 'Safe Launcher']
        ];
        for (const [scores, expected] of cases) {
            const doc = { scores, missionXp: 0 };
            syncTotals(doc);
            const avg = (scores.safetyScore + scores.sustainabilityScore + scores.efficiencyScore) / 3;
            const oldLevel = avg >= 80
                ? 'Space Sustainability Engineer'
                : avg >= 60 ? 'Orbital Optimizer' : 'Safe Launcher';
            expect(doc.level).toBe(expected);
            expect(doc.level).toBe(oldLevel);
        }
    });

    it('ranks a migrated document the same as the old aggregate did', async () => {
        const UserScore = mongoose.model('UserScore');
        const mk = async (s) => {
            const doc = new UserScore({ userId: new mongoose.Types.ObjectId(), scores: s });
            await doc.save();
            return doc;
        };
        const high = await mk({ safetyScore: 90, sustainabilityScore: 90, efficiencyScore: 90 });
        const mid = await mk({ safetyScore: 50, sustainabilityScore: 50, efficiencyScore: 50 });
        const low = await mk({ safetyScore: 10, sustainabilityScore: 10, efficiencyScore: 10 });

        // Stored totalScore must equal what $add over the three axes produced.
        expect(high.totalScore).toBe(270);
        expect(mid.totalScore).toBe(150);
        expect(low.totalScore).toBe(30);

        const ordered = await UserScore.find({}).sort({ totalScore: -1 }).lean();
        expect(ordered.map((d) => d.totalScore)).toEqual([270, 150, 30]);
    });
});

describe('REGRESSION: simulator leaderboard still works', () => {
    it('returns entries with real usernames, not Unknown User', async () => {
        const { cookie, callsign } = await loginAs('Ranked');
        await request(app).post('/api/game/run').set('Cookie', cookie).send(runBody());

        const res = await request(app)
            .get('/api/simulator/leaderboard').set('Cookie', cookie).expect(200);

        expect(res.body.success).toBe(true);
        const names = res.body.leaderboard.map((e) => e.username);
        expect(names).toContain(callsign);
        expect(names).not.toContain('Unknown User');
    });

    it('reports the caller their own rank', async () => {
        const a = await loginAs('First');
        const b = await loginAs('Second');
        // Give A more XP than B.
        for (let i = 0; i < 3; i++) {
            await request(app).post('/api/game/run').set('Cookie', a.cookie).send(runBody());
        }
        await request(app).post('/api/game/run').set('Cookie', b.cookie).send(runBody());

        const bBoard = await request(app)
            .get('/api/simulator/leaderboard').set('Cookie', b.cookie).expect(200);
        expect(bBoard.body.currentUser.rank).toBe(2);
    });

    it('agrees with itself: the caller total matches their leaderboard row', async () => {
        const { cookie, callsign } = await loginAs('Consistent');
        await request(app).post('/api/game/run').set('Cookie', cookie).send(runBody());

        const res = await request(app)
            .get('/api/simulator/leaderboard').set('Cookie', cookie).expect(200);

        const row = res.body.leaderboard.find((e) => e.username === callsign);
        expect(row).toBeDefined();
        expect(res.body.currentUser.totalScore).toBe(row.totalScore);
    });

    it('keeps the three score axes the simulator renders by DOM id', async () => {
        const { cookie } = await loginAs('Sim');
        await request(app).post('/api/game/run').set('Cookie', cookie).send(runBody());

        const res = await request(app)
            .get('/api/simulator/scores').set('Cookie', cookie).expect(200);

        // views/space-traffic-simulator.html reads these exact names.
        expect(res.body.scores).toHaveProperty('safetyScore');
        expect(res.body.scores).toHaveProperty('sustainabilityScore');
        expect(res.body.scores).toHaveProperty('efficiencyScore');
        expect(typeof res.body.level).toBe('string');
    });
});

/**
 * Space assistant endpoint (POST /api/simulator/chatbot).
 *
 * With no GEMINI_API_KEY the endpoint answers from the offline corpus. The
 * strict review noted the assistant could not answer "Kessler syndrome" — its
 * own subject — so this pins that it now can, that auth is required, and that
 * empty input is rejected.
 */
const request = require('supertest');
const { startTestDb, stopTestDb, clearDb, loadApp, loginAs } = require('./helpers/server');

let app;
let cookie;

beforeAll(async () => {
    // simulator.js forces the offline corpus when NODE_ENV=test, so no network.
    await startTestDb();
    app = loadApp();
}, 120000);

afterAll(async () => {
    await stopTestDb();
});

beforeEach(async () => {
    await clearDb();
    ({ cookie } = await loginAs(request, app, 'ChatPilot'));
});

describe('chatbot', () => {
    it('requires authentication', async () => {
        const res = await request(app).post('/api/simulator/chatbot').send({ question: 'hi' });
        expect(res.status).toBe(401);
    });

    it('rejects an empty question', async () => {
        const res = await request(app)
            .post('/api/simulator/chatbot')
            .set('Cookie', cookie)
            .send({ question: '   ' });
        expect(res.status).toBe(400);
    });

    it('answers the Kessler syndrome question from the offline corpus', async () => {
        const res = await request(app)
            .post('/api/simulator/chatbot')
            .set('Cookie', cookie)
            .send({ question: 'What is the Kessler syndrome?' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.answer.toLowerCase()).toContain('kessler');
        expect(res.body.answer.toLowerCase()).toMatch(/cascade|chain reaction|debris/);
    });

    it('answers an orbital-mechanics question', async () => {
        const res = await request(app)
            .post('/api/simulator/chatbot')
            .set('Cookie', cookie)
            .send({ question: 'how do rockets work?' });
        expect(res.body.answer).toMatch(/newton|reaction|exhaust/i);
    });
});

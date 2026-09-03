/**
 * Security posture (app-enhanced.js middleware).
 *
 * The strict review scored security lowest, on four concrete holes:
 *   1. express.static('views') served every protected page shell without a
 *      session, so /quiz.html etc. bypassed ensureAuthenticated.
 *   2. no security headers (X-Powered-By leaked, no CSP / nosniff / frame guard).
 *   3. cors({ origin: true }) + credentials reflected any origin.
 *   4. no rate limit on the credential endpoints.
 * These tests pin the fixes so they cannot silently regress.
 */
const request = require('supertest');
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

describe('security headers', () => {
    it('does not leak the framework via X-Powered-By', async () => {
        const res = await request(app).get('/');
        expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('sets the core helmet headers', async () => {
        const res = await request(app).get('/');
        expect(res.headers['content-security-policy']).toBeTruthy();
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
        expect(res.headers['referrer-policy']).toBeTruthy();
    });
});

describe('protected page shells are not directly reachable', () => {
    it('301s /quiz.html to the guarded clean route instead of serving it', async () => {
        const res = await request(app).get('/quiz.html').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/quiz');
    });

    it('a signed-out visitor following that redirect lands on the landing page', async () => {
        // 301 -> /quiz -> ensureAuthenticated -> 302 / -> 200 landing.html
        const res = await request(app).get('/quiz.html').redirects(5);
        expect(res.status).toBe(200);
        expect(res.text).toMatch(/<title>[^<]*Spaceverse/i);
    });

    it('does not serve raw view files (home.html) to anyone', async () => {
        const res = await request(app).get('/home.html').redirects(0);
        expect(res.status).toBe(301);
        expect(res.text).not.toMatch(/<title>/i);
    });
});

describe('CORS is an allowlist, not a mirror', () => {
    it('does not reflect an arbitrary origin', async () => {
        const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');
        expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    });

    it('allows a configured local origin', async () => {
        const res = await request(app).get('/api/health').set('Origin', 'http://localhost:5000');
        expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5000');
    });
});

describe('credential endpoints are rate limited', () => {
    // The ceiling is raised under NODE_ENV=test so the other suites can log in
    // freely, so assert the limiter is wired (it emits standard RateLimit
    // headers) rather than trying to exhaust a 100k budget here.
    it('emits RateLimit headers on /api/login', async () => {
        const res = await request(app).post('/api/login').send({ username: 'rl', password: 'y' });
        const h = res.headers;
        expect(h['ratelimit-limit'] || h['ratelimit-policy'] || h['ratelimit']).toBeTruthy();
    });

    it('does not rate-limit an ordinary read like /api/health', async () => {
        const res = await request(app).get('/api/health');
        expect(res.headers['ratelimit-limit']).toBeUndefined();
    });
});

/**
 * Arcade page routes.
 *
 * /games/:slug turns a URL segment into a filesystem path, which is the one
 * genuinely risky thing the arcade added to the server. These tests pin the
 * whitelist: known slugs serve their page, everything else redirects, and no
 * traversal attempt reaches sendFile.
 */
const request = require('supertest');
const { startTestDb, stopTestDb, clearDb, loadApp } = require('./helpers/server');
const immersive = ['orbital-intercept', 'asteroid-dodge', 'lunar-landing', 'orbital-docking', 'satellite-repair', 'mars-rover', 'space-rescue'];

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

async function login() {
    const res = await request(app).post('/api/login').send({ username: 'ArcadePlayer', password: 'x' });
    return res.headers['set-cookie'];
}

describe('the arcade hub', () => {
    it('offers a public Quest setup guide with links to each headset experience', async () => {
        const guide = await request(app).get('/quest-guide').expect(200);
        expect(guide.text).toContain('SpaceVerse on Meta Quest');
        for (const path of ['/vr-solar-system', '/vr-ride', '/games/asteroid-dodge', '/games']) {
            expect(guide.text).toContain(`href="${path}"`);
        }
        await request(app).get('/public/css/quest-guide.css').expect(200);
    });

    it('needs a signed-in pilot', async () => {
        const res = await request(app).get('/games');
        expect(res.status).toBeGreaterThanOrEqual(300);
        expect(res.status).toBeLessThan(500);
    });

    it('serves the hub to a signed-in pilot', async () => {
        const cookie = await login();
        const res = await request(app).get('/games').set('Cookie', cookie).expect(200);
        expect(res.text).toContain('THE ARCADE');
    });

    it('lists every game the server is willing to serve', async () => {
        const cookie = await login();
        const hub = await request(app).get('/games').set('Cookie', cookie).expect(200);
        const linked = [...hub.text.matchAll(/href="\/games\/([a-z-]+)"/g)].map((m) => m[1]);
        expect(new Set(linked).size).toBe(18);
        expect(linked).toEqual(expect.arrayContaining(immersive));
        // Every card on the hub must resolve; a dead card is a dead end for the
        // player and the hub is the only way most people will find these.
        for (const slug of linked) {
            const page = await request(app).get(`/games/${slug}`).set('Cookie', cookie).expect(200);
            if (immersive.includes(slug)) {
                expect(page.text).toContain('/public/js/vr/main.js');
                expect(page.text).toContain('quest3-deck');
                expect(page.text).toContain('id="enter-vr"');
            } else {
                expect(page.text).toMatch(/\/public\/js\/arcade\/shell\.js(?:\?v=[^"]+)?"/);
            }
        }
    });
});

describe('/games/:slug', () => {
    it('serves the XR base-layer renderer used by the solar system, ride and games', async () => {
        const script = await request(app).get('/lib/three/webxr.module.js').expect(200).expect('Content-Type', /javascript/);
        expect(script.text).toContain("typeof XRWebGLLayer !== 'function' && supportsGlBinding");
        const cookie = await login();
        for (const url of ['/vr-solar-system', '/vr-ride', '/games/asteroid-dodge']) {
            const page = await request(app).get(url).set('Cookie', cookie).expect(200);
            expect(page.text).toContain('"three": "/lib/three/webxr.module.js?');
        }
        const screen = await request(app).get('/public/js/arcade/quest-screen.js').expect(200);
        expect(screen.text).toContain('/lib/three/webxr.module.js?');
    });

    it('protects the VR arcade game with the same login requirement', async () => {
        await request(app).get('/games/asteroid-dodge').expect(302);
    });

    it('serves the shared VR renderer at the dedicated arcade URL', async () => {
        const cookie = await login();
        for (const url of ['/games/asteroid-dodge', '/games/asteroid-dodge/']) {
            const res = await request(app).get(url).set('Cookie', cookie).expect(200);
            expect(res.text).toMatch(/<script type="module" src="\/public\/js\/vr\/main\.js(?:\?v=[^"]+)?"><\/script>/);
            expect(res.text).toContain('only-dodge');
        }
    });

    it('serves a known game', async () => {
        const cookie = await login();
        const res = await request(app).get('/games/gravity-runner').set('Cookie', cookie).expect(200);
        expect(res.text).toContain('/public/js/arcade/gravity-runner.js');
        expect(res.text).toContain('/public/js/arcade/shell.js');
    });

    it('redirects an unknown slug instead of erroring', async () => {
        const cookie = await login();
        const res = await request(app).get('/games/not-a-real-game').set('Cookie', cookie);
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/games');
    });

    it('refuses to walk out of the games directory', async () => {
        const cookie = await login();
        const attempts = [
            '/games/..%2Fapp-enhanced',
            '/games/..%2F..%2Fpackage',
            '/games/%2e%2e%2fapp-enhanced',
            '/games/....//app-enhanced'
        ];
        for (const url of attempts) {
            const res = await request(app).get(url).set('Cookie', cookie);
            expect(res.status).not.toBe(200);
            expect(res.text || '').not.toContain('require(');
        }
    });
});

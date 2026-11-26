/**
 * Puppeteer visual & runtime verification for all 7 Meta Quest 3 VR Arcade games
 * plus regression check for /vr-solar-system and /vr-ride.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

const base = process.env.VR_TEST_URL || 'http://localhost:5000';
const screenshots = path.resolve(__dirname, '../output');

const QUEST3_GAMES = [
    'orbital-intercept',
    'asteroid-dodge',
    'lunar-landing',
    'orbital-docking',
    'satellite-repair',
    'mars-rover',
    'space-rescue'
];

async function signIn(page) {
    await page.goto(base + '/quest-guide', { waitUntil: 'domcontentloaded' });
    const ok = await page.evaluate(async () => {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'Quest3Pilot', password: 'test' })
        });
        return res.ok && (await res.json()).success;
    });
    assert.ok(ok, 'demo sign-in should succeed');
}

async function readyVR(page, route) {
    await page.goto(base + route, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
        () => window.__vr && document.getElementById('loading').style.display === 'none',
        { timeout: 120000 }
    );
}

(async () => {
    fs.mkdirSync(screenshots, { recursive: true });
    const browser = await puppeteer.launch({
        headless: true,
        args: process.env.VR_TEST_GPU === '1'
            ? []
            : ['--use-gl=angle', '--use-angle=swiftshader']
    });
    const failures = [];
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(120000);
        await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
        page.on('pageerror', err => failures.push('pageerror: ' + err.message));
        page.on('console', msg => {
            if (msg.type() === 'error') failures.push('console.error: ' + msg.text());
        });

        await signIn(page);

        // 1. Arcade Hub verification
        await page.goto(base + '/games', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.game', { timeout: 30000 });
        const hubStats = await page.evaluate(() => {
            const cards = [...document.querySelectorAll('.game')];
            const questCards = cards.filter(c => c.querySelector('.tag')?.textContent.trim() === 'Quest 3');
            return { total: cards.length, questCount: questCards.length };
        });
        assert.equal(hubStats.total, 18, 'Arcade hub lists 18 games');
        assert.equal(hubStats.questCount, 7, 'Arcade hub lists 7 Meta Quest 3 VR games');
        await new Promise(r => setTimeout(r, 300));
        await page.screenshot({ path: path.join(screenshots, 'quest3-arcade-hub.png') });
        console.log('Arcade hub verified:', hubStats);

        // 2. All 7 Meta Quest 3 Exclusive VR Games
        for (const slug of QUEST3_GAMES) {
            await readyVR(page, '/games/' + slug);
            const launcher = await page.evaluate(() => {
                const phoneDisplay = getComputedStyle(document.getElementById('phone-row')).display;
                const deckDisplay = getComputedStyle(document.getElementById('quest3-deck')).display;
                const leftCount = document.querySelectorAll('#quest3-left-list li').length;
                const rightCount = document.querySelectorAll('#quest3-right-list li').length;
                return {
                    questOnlyBody: document.body.classList.contains('quest-only'),
                    phoneDisplay,
                    deckDisplay,
                    leftCount,
                    rightCount,
                    title: document.getElementById('quest3-title').textContent.trim()
                };
            });
            assert.equal(launcher.questOnlyBody, true, `${slug} has quest-only class`);
            assert.equal(launcher.phoneDisplay, 'none', `${slug} hides Phone VR`);
            assert.equal(launcher.deckDisplay, 'block', `${slug} shows Meta Quest 3 deck`);
            assert.ok(launcher.leftCount >= 2 && launcher.rightCount >= 2, `${slug} lists left/right Touch Plus bindings`);

            if (slug === 'orbital-intercept') {
                await page.screenshot({ path: path.join(screenshots, 'quest3-launcher-orbital-intercept.png') });
            }

            const sim = await page.evaluate(() => {
                const info = window.__vr.qaPreviewQuestGame(4.5);
                return new Promise(resolve => {
                    requestAnimationFrame(() => requestAnimationFrame(() => resolve({
                        ...info,
                        gameVisible: Boolean(window.__vr.arcadeGame?.root?.visible),
                        controllers: window.__vr.questRig?.controllers?.length || 0,
                        hudTitle: window.__vr.hudText?.title
                    })));
                });
            });
            assert.equal(sim.state, 'playing', `${slug} is playing`);
            assert.equal(sim.shaderErrors, 0, `${slug} compiled all shaders with 0 errors`);
            assert.equal(sim.gameVisible, true, `${slug} 3D world visible`);
            assert.equal(sim.controllers, 2, `${slug} has 2 Touch Plus controllers`);

            await page.screenshot({ path: path.join(screenshots, `quest3-${slug}.png`) });
            console.log(`Quest 3 verified [${slug}]:`, sim.status);
        }

        // 3. Non-arcade VR routes regression check (/vr-solar-system & /vr-ride)
        await readyVR(page, '/vr-solar-system');
        const exploreOk = await page.evaluate(() => !document.body.classList.contains('quest-only') && Boolean(document.getElementById('start-explore')));
        assert.equal(exploreOk, true, '/vr-solar-system remains non-quest-only');

        await readyVR(page, '/vr-ride');
        const rideOk = await page.evaluate(() => !document.body.classList.contains('quest-only') && Boolean(document.getElementById('start-ride')));
        assert.equal(rideOk, true, '/vr-ride remains non-quest-only');

        assert.deepEqual(failures, [], 'zero uncaught browser or console errors');
        console.log('ALL 7 Meta Quest 3 VR games + Arcade Hub + VR regression checks passed!');
    } finally {
        let timer;
        await Promise.race([
            browser.close(),
            new Promise(resolve => { timer = setTimeout(resolve, 5000); })
        ]);
        clearTimeout(timer);
        if (browser.process() && !browser.process().killed) browser.process().kill();
    }
})().catch(err => {
    console.error(err);
    process.exitCode = 1;
});

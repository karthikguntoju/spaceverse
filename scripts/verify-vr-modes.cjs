/** Manual browser smoke check for desktop and phone VR paths. Run with the app on :5000. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

const base = process.env.VR_TEST_URL || 'http://localhost:5000';
const screenshots = path.resolve(__dirname, '../../output');

async function signIn(page) {
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    const ok = await page.evaluate(async () => {
        const res = await fetch('/api/login', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'VRSmokePilot', password: 'test' })
        });
        return res.ok && (await res.json()).success;
    });
    assert.ok(ok, 'demo sign-in should succeed');
}

async function ready(page, route) {
    console.log('Loading', route);
    await page.goto(base + route, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__vr && document.getElementById('loading').style.display === 'none',
        { timeout: 120000 });
    console.log('Ready', route);
}

async function orientation(page, alpha, beta = 90, gamma = 0) {
    await page.evaluate(({ alpha, beta, gamma }) => {
        const event = new Event('deviceorientation');
        Object.defineProperties(event, {
            alpha: { value: alpha }, beta: { value: beta }, gamma: { value: gamma }
        });
        window.dispatchEvent(event);
    }, { alpha, beta, gamma });
}

(async () => {
    fs.mkdirSync(screenshots, { recursive: true });
    const browser = await puppeteer.launch({ headless: true,
        args: process.env.VR_TEST_GPU === '1' ? [] : ['--use-gl=angle', '--use-angle=swiftshader'] });
    const failures = [];
    try {
        const desktop = await browser.newPage();
        desktop.setDefaultTimeout(120000);
        await desktop.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
        desktop.on('pageerror', error => failures.push('desktop: ' + error.message));
        await signIn(desktop);
        await ready(desktop, '/vr-solar-system');
        assert.equal(await desktop.evaluate(() => window.__vr.qaState().mode), 'menu');
        await desktop.click('#start-explore');
        const beforeLook = await desktop.evaluate(() => window.__vr.yaw);
        await desktop.mouse.move(600, 400);
        await desktop.mouse.down();
        await desktop.mouse.move(730, 440, { steps: 5 });
        await desktop.mouse.up();
        assert.notEqual(await desktop.evaluate(() => window.__vr.yaw), beforeLook, 'mouse drag turns desktop view');
        const beforeMove = await desktop.evaluate(() => window.__vr.dolly.position.toArray());
        await desktop.keyboard.down('w');
        await new Promise(resolve => setTimeout(resolve, 350));
        await desktop.keyboard.up('w');
        const afterMove = await desktop.evaluate(() => window.__vr.dolly.position.toArray());
        assert.notDeepEqual(afterMove, beforeMove, 'W key flies on desktop');
        await desktop.screenshot({ path: path.join(screenshots, 'vr-desktop-smoke.png') });
        console.log('Desktop controls passed');
        await ready(desktop, '/vr-ride');
        await desktop.click('#start-ride');
        for (const seconds of [74, 108, 140]) {
            await desktop.evaluate(seconds => window.__vr.qaSeek(seconds), seconds);
            await desktop.waitForFunction(() => window.__vr.camera.fov >= 78);
            const cockpit = await desktop.evaluate(() => {
                const app = window.__vr;
                const panes = app.cockpit.group.children.filter(child => child.material === app.cockpit.mGlass);
                return {
                    visible: app.cockpit.visible, panes: panes.length,
                    reflectionOnly: app.cockpit.mGlass.isShaderMaterial,
                    depthWrite: app.cockpit.mGlass.depthWrite,
                    validTransform: app.cockpit.worldToCabin.elements.every(Number.isFinite),
                    fov: app.camera.fov,
                    shaderErrors: app.renderer.info.programs.filter(p => p.diagnostics?.runnable === false).length
                };
            });
            assert.equal(cockpit.visible, true);
            assert.equal(cockpit.panes, 4, 'front, roof and both side panes share reflection-only glass');
            assert.equal(cockpit.reflectionOnly, true);
            assert.equal(cockpit.depthWrite, false);
            assert.equal(cockpit.validTransform, true);
            assert.ok(cockpit.fov >= 78 && cockpit.fov <= 96, 'ride uses a bounded panoramic view');
            assert.equal(cockpit.shaderErrors, 0, 'ride shaders compile');
        }
        await desktop.screenshot({ path: path.join(screenshots, 'vr-ride-clear-glass.png') });
        console.log('Panoramic cockpit passed: asteroid, Jupiter and Saturn sections');
        await desktop.close();

        const phone = await browser.newPage();
        phone.setDefaultTimeout(120000);
        await phone.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        await phone.evaluateOnNewDocument(() => {
            if (!('DeviceOrientationEvent' in window)) window.DeviceOrientationEvent = class DeviceOrientationEvent {};
        });
        phone.on('pageerror', error => failures.push('phone: ' + error.message));
        await signIn(phone);
        await ready(phone, '/vr-solar-system');
        assert.equal(await phone.$eval('#phone-row', el => getComputedStyle(el).display), 'flex');
        await phone.click('#btn-gyro');
        console.log('Phone gyro requested');
        await phone.waitForFunction(() => window.__vr.gyro.enabled, { timeout: 10000 });
        await orientation(phone, 20);
        await phone.waitForFunction(() => window.__vr.gyroActive, { timeout: 10000 });
        const beforeTurn = await phone.evaluate(() => window.__vr.camera.quaternion.toArray());
        await orientation(phone, 50);
        await phone.waitForFunction(previous =>
            window.__vr.camera.quaternion.toArray().some((value, index) => Math.abs(value - previous[index]) > 0.01),
            { timeout: 10000 }, beforeTurn);
        console.log('Phone gyro active');
        await phone.click('#start-explore');
        assert.equal(await phone.$eval('#phone-flight', el => getComputedStyle(el).display), 'flex');
        await phone.click('#btn-phone-fly');
        assert.equal(await phone.evaluate(() => window.__vr.autoFly), true);
        const phoneBefore = await phone.evaluate(() => window.__vr.dolly.position.toArray());
        await new Promise(resolve => setTimeout(resolve, 350));
        const phoneAfter = await phone.evaluate(() => window.__vr.dolly.position.toArray());
        assert.notDeepEqual(phoneAfter, phoneBefore, 'phone fly button moves camera');
        await phone.screenshot({ path: path.join(screenshots, 'vr-phone-gyro-smoke.png') });
        console.log('Phone flat controls passed');

        await phone.click('#btn-phone-vr-live');
        await orientation(phone, 35);
        await phone.waitForFunction(() => window.__vr.stereo && window.__vr.mode === 'explore');
        await phone.click('#exit-phone-vr');
        assert.equal(await phone.evaluate(() => window.__vr.mode), 'explore', 'leaving split-screen preserves free flight');

        await phone.click('#btn-menu');
        await phone.click('#btn-phone-vr');
        await orientation(phone, 40);
        await phone.waitForFunction(() => window.__vr.stereo && window.__vr.mode === 'explore');
        assert.ok(await phone.evaluate(() => document.body.classList.contains('in-cardboard')));
        await phone.touchscreen.tap(420, 180);
        assert.equal(await phone.evaluate(() => window.__vr.autoFly), true, 'tap starts flight in split-screen');
        await phone.screenshot({ path: path.join(screenshots, 'vr-phone-split-smoke.png') });
        await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        assert.equal(await phone.$eval('#cardboard-rotate', el => getComputedStyle(el).display), 'block',
            'portrait phone VR prompts for landscape');
        await phone.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        console.log('Phone split-screen explore passed');
        await phone.click('#exit-phone-vr');
        assert.equal(await phone.evaluate(() => window.__vr.stereo), false);

        await phone.click('#btn-menu');
        await phone.click('#start-hunt');
        await phone.waitForFunction(() => window.__vr.mode === 'mission' && !!window.__vr.missionObjective);
        const clue = await phone.evaluate(() => window.__vr.missionObjective.slice(0, 72));
        await phone.click('#btn-phone-fly');
        assert.equal(await phone.evaluate(() => window.__vr.hudText.sub), clue,
            'flying does not erase the scan-hunt clue');
        await phone.click('#btn-phone-vr-live');
        await phone.waitForFunction(() => window.__vr.stereo && window.__vr.mode === 'mission');
        console.log('Phone split-screen scan hunt passed');

        await ready(phone, '/vr-ride');
        await phone.click('#btn-phone-vr');
        await orientation(phone, 60);
        await phone.waitForFunction(() => window.__vr.stereo && window.__vr.mode === 'ride');
        await phone.evaluate(() => window.__vr.qaSeek(140));
        await phone.waitForFunction(() => window.__vr.camera.fov >= 78);
        await phone.screenshot({ path: path.join(screenshots, 'vr-ride-clear-glass-stereo.png') });
        assert.equal(await phone.evaluate(() => window.__vr.renderer.info.programs
            .filter(p => p.diagnostics?.runnable === false).length), 0, 'stereo glass shader compiles');
        await phone.click('#exit-phone-vr');

        assert.deepEqual(failures, [], 'no uncaught browser errors');
        console.log('VR smoke passed: desktop mouse/keyboard, phone gyro/flight, split-screen explore and ride.');
    } finally {
        let timer;
        await Promise.race([
            browser.close(),
            new Promise(resolve => { timer = setTimeout(resolve, 5000); })
        ]);
        clearTimeout(timer);
        if (browser.process() && !browser.process().killed) browser.process().kill();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });

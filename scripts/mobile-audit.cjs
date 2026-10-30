const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const landscape = process.argv.includes('--landscape');
const requestedRoutes = process.argv.slice(2).filter(arg => arg !== '--landscape');
const routes = requestedRoutes.length ? requestedRoutes : [
  '/landing', '/app', '/solar-system', '/planet?name=earth', '/quiz',
  '/space-traffic-simulator', '/space-traffic-visualization',
  '/community-scenarios', '/reviews', '/mission-tracker', '/artemis-2',
  '/space-launches', '/astronomical-events', '/vr-solar-system',
  '/mission/kessler', '/games', '/games/gravity-runner'
];
const output = path.resolve(__dirname, '../../output/mobile-audit');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'] });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(20000);
  await page.goto('http://localhost:5000/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'MobileAudit', password: 'test' })
  }));
  const report = [];
  for (const { width, height } of (landscape ? [{ width: 844, height: 390 }] : [{ width: 390, height: 844 }, { width: 320, height: 844 }])) {
    await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    for (const route of routes) {
      const id = (route === '/' ? 'landing' : route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-'));
      const errors = [];
      const onError = error => errors.push(error.message.slice(0, 200));
      page.on('pageerror', onError);
      try {
        const response = await page.goto(`http://localhost:5000${route}`, { waitUntil: 'domcontentloaded' });
        if (route.startsWith('/vr-')) {
          await page.waitForFunction(() => getComputedStyle(document.querySelector('#loading')).display === 'none', { timeout: 30000 }).catch(() => {});
        }
        if (route === '/space-traffic-visualization') {
          await page.waitForFunction(() => document.querySelector('#loader-container')?.classList.contains('hidden'), { timeout: 30000 }).catch(() => {});
        }
        await new Promise(resolve => setTimeout(resolve, 850));
        const metrics = await page.evaluate(() => {
          const vw = innerWidth;
          const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
          const clipped = [...document.querySelectorAll('body *')].filter(el => {
            if (!visible(el)) return false;
            const r = el.getBoundingClientRect();
            return r.right > vw + 3 && r.left < vw && getComputedStyle(el).position !== 'fixed';
          }).slice(0, 10).map(el => ({ tag: el.tagName, cls: String(el.className).slice(0, 60), text: (el.textContent || '').trim().slice(0, 35), right: Math.round(el.getBoundingClientRect().right) }));
          const smallTargets = [...document.querySelectorAll('a,button,input,select,[role="button"]')]
            .filter(visible).filter(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight && (r.width < 40 || r.height < 40); })
            .slice(0, 12).map(el => ({ tag: el.tagName, text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }));
          return { title: document.title, url: location.pathname, viewport: vw, scrollWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, clipped, smallTargets, headings: [...document.querySelectorAll('h1')].map(x => x.textContent.trim().slice(0, 80)) };
        });
        await page.screenshot({ path: path.join(output, `${id}-${width}.png`) });
        if (route === '/landing') {
          await page.click('.dock-burger');
          metrics.mobileMenu = await page.evaluate(() => ({
            open: document.querySelector('.dock-sheet').classList.contains('is-open'),
            accessText: document.querySelector('.dock-sheet a:last-child').textContent.trim(),
            accessHref: document.querySelector('.dock-sheet a:last-child').getAttribute('href')
          }));
        }
        if (route === '/space-traffic-visualization') {
          await page.click('.sv-panel-toggle');
          metrics.controlPanel = await page.evaluate(() => ({
            open: document.querySelector('.controls-panel').classList.contains('sv-open'),
            right: Math.round(document.querySelector('.controls-panel').getBoundingClientRect().right)
          }));
        }
        if (route === '/solar-system') {
          await page.click('.sv-panel-toggle');
          metrics.controlPanel = await page.evaluate(() => ({
            open: document.querySelector('#ctrl').classList.contains('sv-open'),
            right: Math.round(document.querySelector('#ctrl').getBoundingClientRect().right)
          }));
        }
        if (route === '/vr-solar-system') {
          await page.click('#start-explore');
          await new Promise(resolve => setTimeout(resolve, 1000));
          await page.screenshot({ path: path.join(output, `${id}-${width}-active.png`) });
          metrics.activeTopBar = await page.evaluate(() => ({
            menuOpen: document.querySelector('#mode-menu').classList.contains('show'),
            controls: [...document.querySelectorAll('#top-bar a, #top-bar button')].map(el => {
              const r = el.getBoundingClientRect();
              return { text: el.textContent.trim(), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) };
            })
          }));
        }
        if (route.startsWith('/games/')) {
          metrics.gameOverlay = await page.evaluate(() => ({
            clientHeight: document.querySelector('.a-screen').clientHeight,
            scrollHeight: document.querySelector('.a-screen').scrollHeight,
            playBottom: Math.round(document.querySelector('#a-play').getBoundingClientRect().bottom)
          }));
          await page.$eval('#a-play', el => el.scrollIntoView());
          await page.click('#a-play');
          metrics.gameOverlay.playStarted = await page.evaluate(() => document.querySelector('.a-screen').classList.contains('a-hidden'));
        }
        report.push({ route, width, status: response.status(), ...metrics, errors });
        console.log(`${width} ${route} ${response.status()} overflow=${metrics.scrollWidth - width} errors=${errors.length} clipped=${metrics.clipped.length} small=${metrics.smallTargets.length}`);
      } catch (error) {
        report.push({ route, width, error: error.message, errors });
        console.log(`${width} ${route} ERROR ${error.message}`);
      }
      page.off('pageerror', onError);
    }
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });

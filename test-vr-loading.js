const puppeteer = require('puppeteer');
const fs = require('fs');

async function testVRPage() {
    console.log('🧪 Testing VR Page Loading...');
    console.log('=' .repeat(50));
    
    let browser;
    try {
        // Launch browser
        browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // Intercept requests and block known CDN hosts to force local fallback
        await page.setRequestInterception(true);
        const blockedHosts = ['cdn.jsdelivr.net','unpkg.com','jsdelivr.net','esm.sh','cdn.skypack.dev'];
        page.on('request', req => {
            const url = req.url();
            if (blockedHosts.some(h => url.includes(h))) {
                console.log('⛔ Aborting request to CDN host:', url);
                req.abort();
            } else {
                req.continue();
            }
        });

        // Collect console messages for later verification
        const consoleMsgs = [];
        // Listen for console messages
        page.on('console', msg => {
            const text = msg.text();
            consoleMsgs.push(text);
            console.log(`📝 Console [${msg.type()}]: ${text}`);
        });
        
        // Listen for page errors
        page.on('pageerror', error => {
            console.log(`❌ Page Error: ${error.message}`);
        });
        
        // Listen for request failures
        page.on('requestfailed', request => {
            console.log(`📡 Request Failed: ${request.url()} - ${request.failure().errorText}`);
        });
        
        // Navigate to VR page
        console.log('🌐 Navigating to VR original page...');
        await page.goto('http://localhost:5001/vr-solar-system-original.html', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Log final URL to detect any unexpected redirects
        console.log('🔗 Final URL:', page.url());
        
        // Wait a bit for scripts to load (use a generic delay for compatibility)
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Check page title
        const title = await page.title();
        console.log(`📄 Page Title: ${title}`);
        
        // Check if loading element exists
        const loadingVisible = await page.evaluate(() => {
            const loading = document.getElementById('loading');
            return loading && window.getComputedStyle(loading).display !== 'none';
        });
        console.log(`🔄 Loading indicator visible: ${loadingVisible}`);
        
        // Check if error element exists
        const errorVisible = await page.evaluate(() => {
            const error = document.getElementById('error');
            return error && window.getComputedStyle(error).display !== 'none';
        });
        console.log(`❌ Error indicator visible: ${errorVisible}`);
        
        // Check if container has content
        const containerHasContent = await page.evaluate(() => {
            const container = document.getElementById('vr-container');
            return container && container.children.length > 0;
        });
        console.log(`📦 Container has content: ${containerHasContent}`);
        
        // Check for global variables
        const globals = await page.evaluate(() => {
            return {
                React: typeof React !== 'undefined',
                ReactDOM: typeof ReactDOM !== 'undefined',
                Babel: typeof Babel !== 'undefined',
                VRSolarSystem: typeof VRSolarSystem !== 'undefined'
            };
        });
        console.log('🌍 Global Variables:', globals);
        
        // Take a screenshot
        await page.screenshot({ path: 'vr-page-test.png', fullPage: true });
        console.log('📸 Screenshot saved as vr-page-test.png');

        // Verify local ESM loads (CDN hosts were blocked in this test)
        const fiberLocal = consoleMsgs.some(m => m.includes('React Three Fiber loaded from local'));
        const xrLocal = consoleMsgs.some(m => m.includes('React Three XR loaded from local'));
        console.log('🔁 Local ESM load - Fiber:', fiberLocal, 'XR:', xrLocal);
        if (!fiberLocal || !xrLocal) {
            console.log('⚠️ Local @react-three ESM not detected in console logs; will check global UMD fallbacks');
        } else {
            console.log('✅ Local @react-three ESM loads detected');
        }

        // Also verify whether local UMD globals were set (acceptable fallback)
        const umdFiberGlobal = await page.evaluate(() => (typeof ReactThreeFiber !== 'undefined' || typeof Fiber !== 'undefined'));
        const umdXRGlobal = await page.evaluate(() => (typeof ReactThreeXR !== 'undefined' || typeof XR !== 'undefined'));
        console.log('🧩 Local UMD globals - Fiber:', umdFiberGlobal, 'XR:', umdXRGlobal);
        if (umdFiberGlobal && umdXRGlobal) {
            console.log('✅ Local @react-three UMD globals present - acceptable fallback');
        } else if (!fiberLocal || !xrLocal) {
            console.log('❌ Neither ESM nor UMD local fallbacks detected for @react-three packages');
        }

        console.log('\n' + '=' .repeat(50));
        console.log('💡 Analysis:');
        if (globals.React && globals.ReactDOM && !errorVisible) {
            console.log('✅ Core libraries loaded successfully');
            if (globals.VRSolarSystem) {
                console.log('✅ VRSolarSystem component loaded');
                if (containerHasContent) {
                    console.log('✅ VR content rendered successfully');
                } else {
                    console.log('⚠️  VRSolarSystem loaded but not rendered - might be WebGL issue');
                }
            } else {
                console.log('❌ VRSolarSystem component not loaded - likely Babel JSX processing issue');
            }
        } else {
            console.log('❌ Core libraries not loaded properly');
        }
        
    } catch (error) {
        console.error('💥 Test failed with error:', error.message);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Run the test
testVRPage().catch(console.error);
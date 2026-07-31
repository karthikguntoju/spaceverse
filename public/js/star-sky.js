/**
 * Shared interactive night sky for every page with a #space-bg canvas.
 *
 * Two layers, on purpose. The deep field — thousands of stars, the faint
 * galactic glow, the named stars with their spikes — is painted once into an
 * offscreen canvas, because nothing in it needs to change per frame. In front
 * of it sits a few hundred near stars that are drawn live: they twinkle, they
 * lead the deep field as the pointer moves so the sky has real depth, they
 * brighten when the pointer comes near, and the close ones join up into
 * constellations under it. Clicking sends a ripple out that lights the stars
 * it passes.
 *
 * A frame is one blit plus a few hundred arcs, so the whole thing costs about
 * what the single static image used to.
 *
 * Takeover: the page's existing #space-bg canvas is swapped for a clone
 * (same id/class/style, so all page CSS still applies). Legacy inline
 * starfield loops keep their reference to the detached original and paint
 * into the void; the ones that poll window.__galaxyActive stop entirely.
 * This is the only sky on the site — the home page's 3D galaxy was removed
 * and every route now shares this one.
 */
(function () {
    'use strict';
    if (window.__starSky) return;

    const old = document.getElementById('space-bg');
    if (!old || old.tagName !== 'CANVAS') return;
    const canvas = old.cloneNode(false);
    old.replaceWith(canvas);
    window.__starSky = true;
    window.__galaxyActive = true; // legacy 2D loops poll this and stand down

    // Pages that never sized #space-bg with CSS relied on the attribute
    // size; with DPR scaling that would balloon the element. Pin it.
    if (getComputedStyle(canvas).position === 'static') {
        canvas.style.position = 'fixed';
        canvas.style.inset = '0';
        canvas.style.zIndex = '-1';
    }
    // The sky must never eat a click: it listens on window instead.
    canvas.style.pointerEvents = 'none';

    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rand = (a, b) => Math.random() * (b - a) + a;
    const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

    // Real stellar colours, weighted the way a long exposure reads: mostly
    // white and blue-white, some cream, a few amber and orange-red giants.
    const PALETTE = [
        [255, 255, 255, 45], [205, 222, 255, 25], [170, 195, 255, 10],
        [255, 244, 220, 12], [255, 214, 160, 6], [255, 170, 130, 2]
    ];
    function starColor() {
        let roll = Math.random() * 100;
        for (const [r, g, b, w] of PALETTE) {
            if ((roll -= w) <= 0) return [r, g, b];
        }
        return [255, 255, 255];
    }

    /* ── how far things move ────────────────────────────────────────────
       The deep field is baked with a margin all round so it can slide under
       the viewport edge without showing a seam. The near stars are drawn in
       screen space and travel further — that difference in travel is the
       only reason the sky reads as deep rather than as a picture. */
    const M = 46;            // baked margin = furthest the deep field can slide
    const PAR = 70;          // extra baked height for the scroll drift
    const FAR_AMP = 16;      // deep field travel, px
    const NEAR_AMP = 40;     // near star travel, px
    const REACH = 200;       // pointer influence radius
    const LINK = 120;        // constellation link distance
    const RIPPLE_LIFE = 1.5; // seconds
    const RIPPLE_SPEED = 620;

    let W = 0, H = 0, dpr = 1;
    let base = null, BW = 0, BH = 0;   // offscreen: everything that never moves
    let live = [], links = [], shooters = [], ripples = [], lastShooter = 0;

    /* Pointer in page pixels. Target vs current, so the sky eases after the
       cursor instead of snapping to it — snapping reads as jitter. */
    const ptr = { tx: -9999, ty: -9999, x: -9999, y: -9999, engaged: false };

    /* ── the deep field, painted once per resize ────────────────────── */
    function buildBase() {
        BW = W + M * 2;
        BH = H + M * 2 + PAR;
        base = document.createElement('canvas');
        base.width = Math.round(BW * dpr);
        base.height = Math.round(BH * dpr);
        const b = base.getContext('2d');
        b.scale(dpr, dpr);

        const diag = Math.hypot(BW, BH);
        const ang = -0.42;                        // band tilt, ~ -24°
        const ux = Math.cos(ang), uy = Math.sin(ang);
        const nx = -uy, ny = ux;
        const cx = BW * 0.5, cy = BH * 0.42;
        const bw = diag * 0.15;                   // band half-width
        const bandPt = (s, off) => [cx + ux * s + nx * off, cy + uy * s + ny * off];

        // Night, first. Stars only read as stars against something close to
        // black — over the bare aurora they washed out into coloured fog. The
        // wash is not opaque, so the colour behind still tints the sky; it
        // just stops competing with the light sources in front of it.
        b.fillStyle = 'rgba(4, 6, 18, 0.58)';
        b.fillRect(0, 0, BW, BH);
        const vig = b.createRadialGradient(BW * 0.5, BH * 0.45, 0, BW * 0.5, BH * 0.45, diag * 0.62);
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(0.62, 'rgba(1,2,8,0.16)');
        vig.addColorStop(1, 'rgba(1,2,8,0.42)');
        b.fillStyle = vig;
        b.fillRect(0, 0, BW, BH);

        // faint deep-sky nebulosity, so the black is not flat
        for (let i = 0; i < 5; i++) {
            const x = rand(0, BW), y = rand(0, BH), r = rand(diag * 0.18, diag * 0.34);
            const g = b.createRadialGradient(x, y, 0, x, y, r);
            const cool = Math.random() < 0.6;
            g.addColorStop(0, cool ? 'rgba(120,140,225,0.040)' : 'rgba(180,140,220,0.032)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            b.fillStyle = g;
            b.fillRect(x - r, y - r, r * 2, r * 2);
        }

        // A whisper of galactic glow where the star density rises. Kept far
        // below the stars themselves — this is a night sky with a bright
        // region in it, not a picture of a galaxy.
        b.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 130; i++) {
            const s = rand(-0.62, 0.62) * diag;
            const off = gauss() * bw * 0.55;
            const [x, y] = bandPt(s, off);
            const r = rand(diag * 0.03, diag * 0.09);
            const warm = Math.abs(off) < bw * 0.28 && Math.abs(s) < diag * 0.3;
            const a = rand(0.008, 0.026) * (1 - Math.abs(off) / (bw * 1.25));
            if (a <= 0) continue;
            const g = b.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, warm
                ? `rgba(255,233,205,${a.toFixed(3)})`
                : `rgba(165,185,240,${(a * 0.8).toFixed(3)})`);
            g.addColorStop(1, 'rgba(0,0,0,0)');
            b.fillStyle = g;
            b.fillRect(x - r, y - r, r * 2, r * 2);
        }
        b.globalCompositeOperation = 'source-over';

        // dust mottling: dark elongated blobs hugging the centreline, so the
        // bright region has texture instead of being an even smear. Light
        // touch — heavier and they read as smudges on the glass.
        for (let i = 0; i < 70; i++) {
            const s = rand(-0.55, 0.55) * diag;
            const off = gauss() * bw * 0.34;
            const [x, y] = bandPt(s, off);
            const rx = rand(diag * 0.02, diag * 0.075), ry = rx * rand(0.18, 0.42);
            const a = rand(0.04, 0.11) * (1 - Math.abs(off) / bw);
            if (a <= 0) continue;
            b.save();
            b.translate(x, y);
            b.rotate(ang + rand(-0.18, 0.18));
            b.scale(rx / ry, 1);
            const g = b.createRadialGradient(0, 0, 0, 0, 0, ry);
            g.addColorStop(0, `rgba(9,6,4,${a.toFixed(3)})`);
            g.addColorStop(0.65, `rgba(9,6,4,${(a * 0.55).toFixed(3)})`);
            g.addColorStop(1, 'rgba(9,6,4,0)');
            b.fillStyle = g;
            b.beginPath();
            b.arc(0, 0, ry, 0, Math.PI * 2);
            b.fill();
            b.restore();
        }

        // The stars themselves: a uniform field plus a much denser fine grain
        // through the bright region. This is the subject of the picture, so
        // it is where the budget goes — it all bakes into `base` once, and a
        // frame is still one blit whatever the count.
        const fieldCount = Math.max(2400, Math.min(7000, Math.round((BW * BH) / 470)));
        const bandCount = Math.round(fieldCount * 1.3);
        for (let i = 0; i < fieldCount + bandCount; i++) {
            const inBand = i >= fieldCount;
            let x, y;
            if (inBand) {
                [x, y] = bandPt(rand(-0.7, 0.7) * diag, gauss() * bw * 0.6);
                if (x < -4 || x > BW + 4 || y < -4 || y > BH + 4) continue;
            } else {
                x = rand(0, BW); y = rand(0, BH);
            }
            const [r, g, bb] = starColor();
            const size = inBand ? rand(0.28, 0.8) : Math.pow(Math.random(), 2.2) * 1.45 + 0.32;
            const alpha = inBand ? rand(0.38, 0.95) : rand(0.45, 1);
            b.globalAlpha = alpha;
            b.fillStyle = `rgb(${r},${g},${bb})`;
            b.beginPath();
            b.arc(x, y, size, 0, Math.PI * 2);
            b.fill();
        }
        b.globalAlpha = 1;

        // The named stars: a soft halo, a white-hot core and faint diffraction
        // spikes. A field of even dots reads as noise — these give the eye
        // somewhere to land and set the scale for everything around them.
        for (let i = 0; i < 26; i++) {
            const x = rand(0, BW), y = rand(0, BH);
            const [r, g, bb] = starColor();
            const glow = rand(4, 11);
            const grd = b.createRadialGradient(x, y, 0, x, y, glow);
            grd.addColorStop(0, `rgba(255,255,255,0.95)`);
            grd.addColorStop(0.18, `rgba(${r},${g},${bb},0.6)`);
            grd.addColorStop(0.45, `rgba(${r},${g},${bb},0.16)`);
            grd.addColorStop(1, `rgba(${r},${g},${bb},0)`);
            b.fillStyle = grd;
            b.beginPath();
            b.arc(x, y, glow, 0, Math.PI * 2);
            b.fill();
            const spike = glow * rand(1.6, 2.4);
            const sg = b.createLinearGradient(x - spike, y, x + spike, y);
            sg.addColorStop(0, `rgba(${r},${g},${bb},0)`);
            sg.addColorStop(0.5, `rgba(${r},${g},${bb},0.3)`);
            sg.addColorStop(1, `rgba(${r},${g},${bb},0)`);
            b.strokeStyle = sg;
            b.lineWidth = 0.9;
            b.beginPath();
            b.moveTo(x - spike, y); b.lineTo(x + spike, y);
            b.stroke();
            const sv = b.createLinearGradient(x, y - spike, x, y + spike);
            sv.addColorStop(0, `rgba(${r},${g},${bb},0)`);
            sv.addColorStop(0.5, `rgba(${r},${g},${bb},0.3)`);
            sv.addColorStop(1, `rgba(${r},${g},${bb},0)`);
            b.strokeStyle = sv;
            b.beginPath();
            b.moveTo(x, y - spike); b.lineTo(x, y + spike);
            b.stroke();
        }
    }

    /* ── the near stars: the layer that answers ─────────────────────── */
    function buildLive() {
        const count = Math.max(220, Math.min(520, Math.round((W * H) / 4200)));
        live = [];
        for (let i = 0; i < count; i++) {
            const [r, g, b] = starColor();
            live.push({
                x: rand(-NEAR_AMP, W + NEAR_AMP),
                y: rand(-NEAR_AMP, H + NEAR_AMP),
                r: Math.pow(Math.random(), 1.8) * 1.5 + 0.45,
                alpha: rand(0.45, 1),
                depth: rand(0.55, 1.45),      // how much of the near travel it takes
                speed: rand(0.4, 1.7),
                phase: rand(0, Math.PI * 2),
                color: [r, g, b],
                sx: 0, sy: 0, near: 0
            });
        }

        /* Constellations are precomputed pairs, not a per-frame neighbour
           search: the stars never move relative to each other, only the whole
           layer does, so the graph is fixed for the life of the layout.
           Capped per star, or dense corners turn into a net. */
        links = [];
        const degree = new Array(live.length).fill(0);
        for (let i = 0; i < live.length; i++) {
            for (let j = i + 1; j < live.length; j++) {
                if (degree[i] >= 3) break;
                if (degree[j] >= 3) continue;
                const dx = live[i].x - live[j].x, dy = live[i].y - live[j].y;
                if (dx * dx + dy * dy > LINK * LINK) continue;
                links.push([i, j]);
                degree[i]++; degree[j]++;
            }
        }
    }

    /* ── sizing ─────────────────────────────────────────────────────── */
    function resize() {
        W = window.innerWidth; H = window.innerHeight;
        dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        buildBase();
        buildLive();
        if (reduceMotion) drawFrame(0);
    }
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resize, 180);
    });

    /* ── input ──────────────────────────────────────────────────────── */
    if (!reduceMotion) {
        window.addEventListener('pointermove', e => {
            ptr.tx = e.clientX; ptr.ty = e.clientY;
            if (!ptr.engaged) {         // first sighting: start where it is, do not fly in
                ptr.x = ptr.tx; ptr.y = ptr.ty; ptr.engaged = true;
            }
        }, { passive: true });

        // Leaving the window lets the sky settle back to centre.
        window.addEventListener('pointerout', e => {
            if (e.relatedTarget || e.pointerType === 'touch') return;
            ptr.tx = W / 2; ptr.ty = H / 2;
        }, { passive: true });

        window.addEventListener('pointerdown', e => {
            ripples.push({ x: e.clientX, y: e.clientY, t0: performance.now() * 0.001 });
            if (ripples.length > 4) ripples.shift();
            ptr.tx = e.clientX; ptr.ty = e.clientY;
            if (!ptr.engaged) { ptr.x = ptr.tx; ptr.y = ptr.ty; ptr.engaged = true; }
        }, { passive: true });
    }

    /* ── shooting stars ─────────────────────────────────────────────── */
    function spawnShooter() {
        const angle = rand(-0.6, -0.2);
        shooters.push({
            x: rand(0, W), y: rand(0, H * 0.5), len: rand(60, 180), speed: rand(6, 14),
            dx: Math.cos(angle), dy: Math.sin(angle) * 0.5 + 0.5, life: 1
        });
    }

    /* ── frame ──────────────────────────────────────────────────────── */
    function drawFrame(ts) {
        const t = ts * 0.001;

        // ease toward the cursor; an unmoved pointer means no offset at all
        if (ptr.engaged) {
            ptr.x += (ptr.tx - ptr.x) * 0.075;
            ptr.y += (ptr.ty - ptr.y) * 0.075;
        }
        const px = ptr.engaged ? (ptr.x / W - 0.5) * 2 : 0;
        const py = ptr.engaged ? (ptr.y / H - 0.5) * 2 : 0;
        const scroll = Math.min(PAR, (window.scrollY || window.pageYOffset || 0) * 0.06);

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);

        // deep field: slides a little, against the pointer
        ctx.drawImage(base, -M - px * FAR_AMP, -M - scroll - py * FAR_AMP, BW, BH);

        // near field: same direction, further — and it answers the pointer
        const ndx = -px * NEAR_AMP, ndy = -py * NEAR_AMP - scroll * 0.8;
        const reachable = ptr.engaged;
        for (const s of live) {
            s.sx = s.x + ndx * s.depth;
            s.sy = s.y + ndy * s.depth;
            if (!reachable) { s.near = 0; continue; }
            const dx = s.sx - ptr.x, dy = s.sy - ptr.y;
            const d2 = dx * dx + dy * dy;
            s.near = d2 > REACH * REACH ? 0 : 1 - Math.sqrt(d2) / REACH;
        }

        // constellations under the cursor, drawn beneath the stars they join
        if (reachable) {
            ctx.lineWidth = 0.7;
            for (const [i, j] of links) {
                const a = live[i], b = live[j];
                const k = Math.min(a.near, b.near);
                if (k < 0.06) continue;
                ctx.strokeStyle = `rgba(158,196,255,${(k * k * 0.55).toFixed(3)})`;
                ctx.beginPath();
                ctx.moveTo(a.sx, a.sy);
                ctx.lineTo(b.sx, b.sy);
                ctx.stroke();
            }
        }

        for (const s of live) {
            // a click sends a ring outward; stars flare as it crosses them
            let ring = 0;
            for (const rp of ripples) {
                const age = (t - rp.t0) / RIPPLE_LIFE;
                if (age < 0 || age > 1) continue;
                const dist = Math.abs(Math.hypot(s.sx - rp.x, s.sy - rp.y) - age * RIPPLE_SPEED);
                if (dist < 52) ring = Math.max(ring, (1 - dist / 52) * (1 - age));
            }
            const tw = reduceMotion ? 1 : 0.5 + 0.5 * Math.sin(t * s.speed + s.phase);
            const lift = s.near * 0.6 + ring;
            const a = Math.min(1, s.alpha * (0.5 + 0.5 * tw) + lift * 0.75);
            const r = s.r * (1 + s.near * 0.85 + ring * 1.2);
            const [cr, cg, cb] = s.color;

            if (lift > 0.12 || s.r > 1.25) {
                const gr = r * (3 + lift * 3);
                const grd = ctx.createRadialGradient(s.sx, s.sy, 0, s.sx, s.sy, gr);
                grd.addColorStop(0, `rgba(${cr},${cg},${cb},${(a * 0.5).toFixed(3)})`);
                grd.addColorStop(0.4, `rgba(${cr},${cg},${cb},${(a * 0.13).toFixed(3)})`);
                grd.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
                ctx.fillStyle = grd;
                ctx.beginPath();
                ctx.arc(s.sx, s.sy, gr, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = a;
            ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
            ctx.beginPath();
            ctx.arc(s.sx, s.sy, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // the ring itself, faint — the stars do most of the telling
        if (ripples.length) {
            ripples = ripples.filter(rp => t - rp.t0 < RIPPLE_LIFE);
            for (const rp of ripples) {
                const age = (t - rp.t0) / RIPPLE_LIFE;
                if (age < 0) continue;
                ctx.strokeStyle = `rgba(160,200,255,${(0.18 * (1 - age) * (1 - age)).toFixed(3)})`;
                ctx.lineWidth = 1.1;
                ctx.beginPath();
                ctx.arc(rp.x, rp.y, age * RIPPLE_SPEED, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        if (!reduceMotion) {
            if (ts - lastShooter > rand(2600, 7000)) { spawnShooter(); lastShooter = ts; }
            shooters = shooters.filter(s => s.life > 0);
            for (const s of shooters) {
                s.life -= 0.015;
                s.x += s.dx * s.speed;
                s.y += s.dy * s.speed;
                const tail = ctx.createLinearGradient(s.x - s.dx * s.len, s.y - s.dy * s.len, s.x, s.y);
                tail.addColorStop(0, 'rgba(255,255,255,0)');
                tail.addColorStop(1, `rgba(255,255,255,${(s.life * 0.85).toFixed(3)})`);
                ctx.strokeStyle = tail;
                ctx.lineWidth = 1.4;
                ctx.beginPath();
                ctx.moveTo(s.x - s.dx * s.len, s.y - s.dy * s.len);
                ctx.lineTo(s.x, s.y);
                ctx.stroke();
            }
        }
    }

    function loop(ts) {
        // a page that hides this canvas gets no frames burned on it
        if (canvas.style.display !== 'none') drawFrame(ts);
        requestAnimationFrame(loop);
    }

    resize();
    if (reduceMotion) drawFrame(0);   // static sky, no loop
    else requestAnimationFrame(loop);
})();

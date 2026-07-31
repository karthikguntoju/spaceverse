/**
 * Arcade shell — the part every game in /games shares.
 *
 * Deliberately a plain classic script with no imports. The rest of the app runs
 * three different Three.js versions on different pages; the arcade opts out of
 * that entirely so a game page is a single canvas that starts in under a second.
 *
 * A game supplies a config object to Arcade.create() and gets back a run loop,
 * input, particles, screen shake, sound, pause, mute, the animated space
 * backdrop, and the menu/over screens. Scores here are local bragging rights in
 * localStorage only — they are never sent to the server, so nothing in this
 * file can influence mission XP.
 */
(function () {
    'use strict';

    var BEST_PREFIX = 'spaceverse.arcade.';
    var MUTE_KEY = 'spaceverse.arcade.muted';
    var MOTION_KEY = 'spaceverse.arcade.reducedMotion';

    /* Screen shake goes up to 40 in places, which is exactly the kind of motion
       that makes some people ill. Honour the OS setting, and let anyone flip it
       from the pause screen regardless of what the OS says. */
    var reduceMotion = (function () {
        var stored = localStorage.getItem(MOTION_KEY);
        if (stored !== null) return stored === '1';
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    })();

    /* Medal thresholds — the same table the arcade hub reads, kept here so a
       run can end by naming the next target instead of just a number. Per-game
       because the scoring scales are not comparable: Kessler pays in the tens
       of thousands, Re-entry in the hundreds. Each triple is roughly
       [a competent run, a good run, a run you had to work for]. */
    var TIERS = {
        'gravity-runner': [1500, 5000, 12000],
        'kessler-reversed': [6000, 18000, 40000],
        'last-station': [2500, 8000, 18000],
        'junk-katamari': [1200, 3500, 8000],
        're-entry': [800, 2200, 4500],
        'asteroid-miner': [900, 2600, 6000],
        'slingshot-golf': [1500, 4000, 9000],
        'solar-sailor': [3000, 9000, 20000],
        'planet-defense': [2000, 6500, 15000],
        'orbit-weaver': [2500, 7000, 15000],
        'eclipse': [1200, 4000, 9000]
    };
    var MEDAL_NAMES = ['BRONZE', 'SILVER', 'GOLD'];
    var MEDAL_ICONS = ['🥉', '🥈', '🥇'];

    /** Where this score sits against the game's medals, as display copy. */
    function medalNote(slug, score) {
        var t = TIERS[slug];
        if (!t) return '';
        for (var i = 0; i < 3; i++) {
            if (score < t[i]) {
                return (i > 0 ? MEDAL_ICONS[i - 1] + ' ' + MEDAL_NAMES[i - 1] + ' earned · ' : '')
                    + (t[i] - score).toLocaleString() + ' more for ' + MEDAL_NAMES[i];
            }
        }
        return MEDAL_ICONS[2] + ' GOLD — the top tier';
    }

    function best(slug) {
        var v = Number(localStorage.getItem(BEST_PREFIX + slug + '.best') || 0);
        return isFinite(v) ? v : 0;
    }

    function saveBest(slug, score) {
        if (score > best(slug)) {
            localStorage.setItem(BEST_PREFIX + slug + '.best', String(Math.round(score)));
            return true;
        }
        return false;
    }

    /* ── sound ─────────────────────────────────────────────────────────
       Oscillators only. No audio files to load, and nothing to 404.
       Everything routes through one master gain so mute is a single knob. */
    var actx = null;
    var masterGain = null;
    var muted = localStorage.getItem(MUTE_KEY) === '1';

    function audio() {
        if (!actx) {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (AC) {
                actx = new AC();
                masterGain = actx.createGain();
                masterGain.gain.value = muted ? 0 : 1;
                masterGain.connect(actx.destination);
            }
        }
        if (actx && actx.state === 'suspended') actx.resume();
        return actx;
    }

    function setMuted(m) {
        muted = !!m;
        localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
        if (masterGain) masterGain.gain.value = muted ? 0 : 1;
    }

    var VOICES = {
        blip:  { type: 'square',   f: 660, to: 880, d: 0.07, g: 0.05 },
        pick:  { type: 'triangle', f: 440, to: 880, d: 0.10, g: 0.07 },
        thrust:{ type: 'sawtooth', f: 90,  to: 130, d: 0.09, g: 0.03 },
        hit:   { type: 'square',   f: 300, to: 120, d: 0.12, g: 0.06 },
        boom:  { type: 'sawtooth', f: 180, to: 40,  d: 0.35, g: 0.10 },
        win:   { type: 'triangle', f: 520, to: 1040, d: 0.30, g: 0.09 },
        lose:  { type: 'sawtooth', f: 240, to: 60,  d: 0.55, g: 0.10 },
        tick:  { type: 'sine',     f: 1200, to: 1200, d: 0.04, g: 0.03 }
    };

    function sfx(name, detune) {
        var a = audio();
        if (!a || !VOICES[name] || muted) return;
        var v = VOICES[name];
        var o = a.createOscillator();
        var g = a.createGain();
        var t = a.currentTime;
        o.type = v.type;
        o.frequency.setValueAtTime(v.f * (detune || 1), t);
        o.frequency.exponentialRampToValueAtTime(Math.max(20, v.to * (detune || 1)), t + v.d);
        g.gain.setValueAtTime(v.g, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + v.d);
        o.connect(g); g.connect(masterGain);
        o.start(t); o.stop(t + v.d + 0.02);
    }

    /* ── small maths helpers every game wants ─────────────────────────── */
    var U = {
        rand: function (a, b) { return a + Math.random() * (b - a); },
        randInt: function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); },
        pick: function (arr) { return arr[Math.floor(Math.random() * arr.length)]; },
        clamp: function (v, a, b) { return v < a ? a : v > b ? b : v; },
        lerp: function (a, b, t) { return a + (b - a) * t; },
        dist: function (ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); },
        angleTo: function (ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); },
        wrapAngle: function (a) {
            while (a > Math.PI) a -= Math.PI * 2;
            while (a < -Math.PI) a += Math.PI * 2;
            return a;
        },
        /** Deterministic hash → [0,1). Same inputs, same rock, every frame. */
        hash: function (n) {
            var s = Math.sin(n) * 43758.5453;
            return s - Math.floor(s);
        }
    };

    function glow(c, x, y, r, colour, inner) {
        var grd = c.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, inner || colour);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = grd;
        c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
    }

    /** Same halo, but composited additively so overlapping light stacks into
        bloom instead of painting over itself. Use for anything that emits. */
    function bloom(c, x, y, r, colour, inner) {
        var prev = c.globalCompositeOperation;
        c.globalCompositeOperation = 'lighter';
        glow(c, x, y, r, colour, inner);
        c.globalCompositeOperation = prev;
    }

    /** Jagged rock outline around the origin. `seed` makes each rock's
        silhouette unique and stable across frames — pass the rock's own id,
        not its vertex index. Caller translates/rotates first, then fills. */
    function rockPath(c, r, seed, verts) {
        verts = verts || 8;
        c.beginPath();
        for (var i = 0; i < verts; i++) {
            var a = (i / verts) * 6.2832
                + (U.hash(seed * 269.5 + i * 183.3) - 0.5) * (3.4 / verts);
            var rr = r * (0.72 + 0.36 * U.hash(seed * 127.1 + i * 311.7));
            var x = Math.cos(a) * rr, y = Math.sin(a) * rr;
            if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.closePath();
    }

    /* ── colour helpers for the backdrop ──────────────────────────────── */
    function hexToRgb(hex) {
        var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        if (!m) return { r: 34, g: 211, b: 238 };
        var n = parseInt(m[1], 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }

    function rgbToHue(c) {
        var r = c.r / 255, g = c.g / 255, b = c.b / 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        if (max === min) return 200;
        var d = max - min, h;
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        return h * 60;
    }

    var STAR_TINTS = ['#ffffff', '#ffffff', '#cfe1ff', '#b8ccff', '#ffe9c9', '#9fb7ff'];

    function create(cfg) {
        var slug = cfg.slug;
        var accent = cfg.accent || '#64ffda';

        document.title = cfg.title + ' — SpaceVerse Arcade';

        /* ── DOM ──────────────────────────────────────────────────────── */
        var root = document.body;
        root.className = 'arcade';
        root.style.setProperty('--accent', accent);

        var canvas = document.createElement('canvas');
        canvas.id = 'game';
        // Games that draw their own reticle ask for the OS pointer to go away,
        // so the player is not tracking two cursors at once.
        if (cfg.hideCursor) canvas.style.cursor = 'none';
        root.appendChild(canvas);
        var c = canvas.getContext('2d');

        var hud = el('div', 'a-hud');
        var scoreEl = el('div', 'a-score');
        var extraEl = el('div', 'a-extra');
        hud.appendChild(scoreEl); hud.appendChild(extraEl);

        var topbar = el('div', 'a-top');
        topbar.innerHTML =
            '<a class="a-chip" href="/games">← Arcade</a>' +
            '<span class="a-name">' + cfg.title + '</span>' +
            '<span class="a-grow"></span>' +
            '<button class="a-chip a-mute" id="a-mute" title="Mute (M)">' + (muted ? '🔇' : '🔊') + '</button>' +
            '<span class="a-best">BEST ' + best(slug).toLocaleString() + '</span>';

        var flashEl = el('div', 'a-flash');

        var menu = el('div', 'a-screen');
        menu.innerHTML =
            '<div class="a-card">' +
            '<h1>' + cfg.title + '</h1>' +
            '<p class="a-tag">' + cfg.tagline + '</p>' +
            '<ul class="a-controls">' +
            (cfg.controls || []).concat([['P · Esc', 'Pause'], ['M', 'Mute']]).map(function (r) {
                return '<li><kbd>' + r[0] + '</kbd><span>' + r[1] + '</span></li>';
            }).join('') +
            '</ul>' +
            '<button class="a-btn" id="a-play">PLAY</button>' +
            '</div>';

        var over = el('div', 'a-screen a-hidden');
        over.innerHTML =
            '<div class="a-card">' +
            '<h1 id="a-over-title">GAME OVER</h1>' +
            '<p class="a-tag" id="a-over-note"></p>' +
            '<div class="a-final" id="a-final">0</div>' +
            '<p class="a-tag" id="a-best-note"></p>' +
            '<p class="a-tag a-medal" id="a-medal-note"></p>' +
            '<div class="a-row">' +
            '<button class="a-btn" id="a-again">PLAY AGAIN</button>' +
            '<a class="a-btn a-ghost" href="/games">ARCADE</a>' +
            '</div></div>';

        var pauseScr = el('div', 'a-screen a-hidden');
        pauseScr.innerHTML =
            '<div class="a-card">' +
            '<h1>PAUSED</h1>' +
            '<p class="a-tag">P or Esc resumes. Your run is waiting.</p>' +
            '<label class="a-toggle"><input type="checkbox" id="a-motion"' +
            (reduceMotion ? ' checked' : '') + '><span>Reduce motion (no screen shake)</span></label>' +
            '<div class="a-row">' +
            '<button class="a-btn" id="a-resume">RESUME</button>' +
            '<a class="a-btn a-ghost" href="/games">QUIT</a>' +
            '</div></div>';

        root.appendChild(topbar);
        root.appendChild(hud);
        root.appendChild(flashEl);
        root.appendChild(menu);
        root.appendChild(over);
        root.appendChild(pauseScr);

        function el(tag, cls) { var e = document.createElement(tag); e.className = cls || ''; return e; }

        /* ── sizing ───────────────────────────────────────────────────── */
        var W = 0, H = 0, dpr = 1;
        function resize() {
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = window.innerWidth;
            H = window.innerHeight;
            canvas.width = Math.floor(W * dpr);
            canvas.height = Math.floor(H * dpr);
            canvas.style.width = W + 'px';
            canvas.style.height = H + 'px';
            c.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.w = W; g.h = H;
            sky = null; // star density tracks the viewport
            // Games that draw a crosshair at the pointer would otherwise park
            // it in the top-left corner until the first mouse move.
            if (!pointerSeen) { g.pointer.x = W / 2; g.pointer.y = H / 2; }
            if (cfg.onResize) cfg.onResize(g);
        }
        window.addEventListener('resize', resize);

        /* ── the shared space backdrop ────────────────────────────────────
           Every game used to open draw() with a flat opaque fillRect; this is
           the replacement. Base void, two nebula washes tinted off the game's
           accent, three parallax star layers with twinkle, and the occasional
           meteor. One call, and the arcade stops looking like ten screens of
           dead vantablack. */
        var sky = null;

        function buildSky() {
            var area = W * H;
            var perLayer = Math.min(220, Math.max(60, Math.round(area / 9000)));
            var layers = [];
            var zs = [0.35, 0.6, 1];
            for (var l = 0; l < 3; l++) {
                var stars = [];
                var n = Math.round(perLayer * (l === 2 ? 0.55 : 1));
                for (var i = 0; i < n; i++) {
                    stars.push({
                        x: Math.random() * W, y: Math.random() * H,
                        r: zs[l] < 1 ? U.rand(0.5, 1.1) : U.rand(0.9, 1.9),
                        a: U.rand(0.25, zs[l] < 1 ? 0.55 : 0.9),
                        tw: U.rand(0.6, 2.4), ph: U.rand(0, 6.2832),
                        col: U.pick(STAR_TINTS)
                    });
                }
                layers.push({ z: zs[l], stars: stars });
            }
            var hue = rgbToHue(hexToRgb(accent));
            var nebulae = [];
            for (var k = 0; k < 3; k++) {
                nebulae.push({
                    fx: U.rand(0.1, 0.9), fy: U.rand(0.1, 0.9),
                    fr: U.rand(0.34, 0.6),
                    hue: (hue + [0, -40, 35][k] + 360) % 360,
                    sp: U.rand(0.02, 0.05), ph: U.rand(0, 6.2832),
                    // Enough to colour the void without ever competing with the
                    // play field: three of these stack additively, so the
                    // per-cloud figure reads about triple where they overlap.
                    a: U.rand(0.085, 0.14)
                });
            }
            sky = { layers: layers, nebulae: nebulae, meteor: null, nextMeteor: U.rand(4, 10) };
        }

        function space(ctx, opts) {
            opts = opts || {};
            if (!sky) buildSky();
            ctx.fillStyle = opts.bg || '#04060f';
            ctx.fillRect(0, 0, W, H);

            var t = skyT;
            var camX = opts.camX || 0, camY = opts.camY || 0;
            var par = opts.par == null ? 0.25 : opts.par;
            var dx = opts.driftX == null ? -5 : opts.driftX;
            var dy = opts.driftY == null ? 1.5 : opts.driftY;

            ctx.save();
            if (opts.nebula !== false) {
                ctx.globalCompositeOperation = 'lighter';
                for (var k = 0; k < sky.nebulae.length; k++) {
                    var nb = sky.nebulae[k];
                    var nx = nb.fx * W + Math.sin(t * nb.sp + nb.ph) * W * 0.06 - camX * 0.04 * par * 4;
                    var ny = nb.fy * H + Math.cos(t * nb.sp * 0.8 + nb.ph) * H * 0.05 - camY * 0.04 * par * 4;
                    var nr = nb.fr * Math.max(W, H);
                    var grd = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr);
                    grd.addColorStop(0, 'hsla(' + nb.hue + ', 70%, 55%, ' + nb.a + ')');
                    grd.addColorStop(0.55, 'hsla(' + nb.hue + ', 75%, 45%, ' + (nb.a * 0.4) + ')');
                    grd.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = grd;
                    ctx.fillRect(0, 0, W, H);
                }
                ctx.globalCompositeOperation = 'source-over';
            }

            for (var l = 0; l < sky.layers.length; l++) {
                var layer = sky.layers[l];
                var z = layer.z;
                var ox = (dx * t - camX * par) * z;
                var oy = (dy * t - camY * par) * z;
                for (var i = 0; i < layer.stars.length; i++) {
                    var s = layer.stars[i];
                    var x = s.x + ox; x -= Math.floor(x / W) * W;
                    var y = s.y + oy; y -= Math.floor(y / H) * H;
                    var a = s.a * (0.72 + 0.28 * Math.sin(t * s.tw + s.ph));
                    ctx.globalAlpha = a;
                    ctx.fillStyle = s.col;
                    if (s.r < 1.2) ctx.fillRect(x, y, s.r + 0.4, s.r + 0.4);
                    else { ctx.beginPath(); ctx.arc(x, y, s.r, 0, 6.2832); ctx.fill(); }
                }
            }
            ctx.globalAlpha = 1;

            // ambient meteor: rare, cheap, and it makes the sky feel live
            if (opts.meteors !== false) {
                sky.nextMeteor -= g.dt;
                if (!sky.meteor && sky.nextMeteor <= 0) {
                    var ma = U.rand(0.5, 1.1);
                    sky.meteor = {
                        x: U.rand(W * 0.1, W * 0.9), y: -30,
                        vx: Math.cos(ma) * U.rand(380, 560), vy: Math.sin(ma) * U.rand(380, 560),
                        life: 0.9, age: 0
                    };
                    sky.nextMeteor = U.rand(7, 16);
                }
                if (sky.meteor) {
                    var m = sky.meteor;
                    m.age += g.dt; m.x += m.vx * g.dt; m.y += m.vy * g.dt;
                    var fade = Math.max(0, 1 - m.age / m.life);
                    if (fade <= 0 || m.y > H + 40) sky.meteor = null;
                    else {
                        ctx.globalCompositeOperation = 'lighter';
                        var tail = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 0.13, m.y - m.vy * 0.13);
                        tail.addColorStop(0, 'rgba(255,255,255,' + (0.85 * fade) + ')');
                        tail.addColorStop(1, 'rgba(255,255,255,0)');
                        ctx.strokeStyle = tail;
                        ctx.lineWidth = 1.6;
                        ctx.beginPath();
                        ctx.moveTo(m.x, m.y);
                        ctx.lineTo(m.x - m.vx * 0.13, m.y - m.vy * 0.13);
                        ctx.stroke();
                        ctx.globalCompositeOperation = 'source-over';
                    }
                }
            }
            ctx.restore();
        }

        /* ── game object handed to the game ───────────────────────────── */
        var particles = [];
        var g = {
            w: 0, h: 0, t: 0, dt: 0, score: 0, running: false,
            keys: Object.create(null),
            pointer: { x: 0, y: 0, down: false, downX: 0, downY: 0, justDown: false, justUp: false },
            s: {},                       // the game's own state bag
            accent: accent,
            rand: U.rand, randInt: U.randInt, pickOne: U.pick,
            clamp: U.clamp, lerp: U.lerp, dist: U.dist, angleTo: U.angleTo, wrapAngle: U.wrapAngle,
            hash: U.hash,
            glow: glow,
            bloom: bloom,
            rockPath: rockPath,
            space: space,
            sfx: sfx,
            key: function (code) { return !!g.keys[code]; },
            setScore: function (v) { g.score = v; },
            addScore: function (v) { g.score += v; },
            /** Big centred word for a moment. The cheapest game-feel there is. */
            flash: function (text, colour, ms) {
                flashEl.textContent = text;
                flashEl.style.color = colour || accent;
                flashEl.classList.add('show');
                clearTimeout(flashEl._t);
                flashEl._t = setTimeout(function () { flashEl.classList.remove('show'); }, ms || 700);
            },
            /** Games call this every frame; most frames the string is
                identical, and re-writing innerHTML would reparse and relayout
                at 60Hz for nothing. */
            hud: function (html) {
                if (html === lastHud) return;
                lastHud = html;
                extraEl.innerHTML = html;
            },
            shake: function (amount) { shake = Math.max(shake, amount); },
            burst: function (x, y, opts) {
                opts = opts || {};
                var n = opts.n || 14;
                for (var i = 0; i < n; i++) {
                    var a = opts.angle == null ? Math.random() * 6.2832
                        : opts.angle + U.rand(-(opts.spread || 0.6), opts.spread || 0.6);
                    var sp = U.rand(opts.speed ? opts.speed * 0.4 : 60, opts.speed || 220);
                    particles.push({
                        x: x, y: y,
                        vx: Math.cos(a) * sp + (opts.vx || 0),
                        vy: Math.sin(a) * sp + (opts.vy || 0),
                        life: U.rand(0.25, opts.life || 0.7),
                        age: 0,
                        r: opts.size || U.rand(1.5, 3.5),
                        col: opts.colour || accent,
                        drag: opts.drag == null ? 1.6 : opts.drag,
                        spark: opts.shape === 'spark'
                    });
                }
            },
            over: function (note, won) { endRun(note, won); }
        };

        /* ── input ────────────────────────────────────────────────────── */
        window.addEventListener('keydown', function (e) {
            if (e.code === 'Escape') {
                // Never nuke a live run on one keypress. Esc pauses first;
                // quitting is a deliberate click on the pause screen.
                if (g.running) togglePause();
                else window.location.href = '/games';
                return;
            }
            if (e.code === 'KeyP') { if (g.running) togglePause(); return; }
            if (e.code === 'KeyM') { toggleMute(); return; }
            if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.key) >= 0) e.preventDefault();
            if (paused) return;
            if (!g.keys[e.code] && cfg.keyDown) cfg.keyDown(g, e.code);
            g.keys[e.code] = true;
            if ((e.code === 'Space' || e.code === 'Enter') && !g.running) {
                if (!over.classList.contains('a-hidden') || !menu.classList.contains('a-hidden')) startRun();
            }
        });
        window.addEventListener('keyup', function (e) {
            g.keys[e.code] = false;
            if (cfg.keyUp) cfg.keyUp(g, e.code);
        });
        window.addEventListener('blur', function () { g.keys = Object.create(null); });

        var pointerSeen = false;
        function pos(e) {
            var r = canvas.getBoundingClientRect();
            g.pointer.x = e.clientX - r.left;
            g.pointer.y = e.clientY - r.top;
            pointerSeen = true;
        }
        canvas.addEventListener('pointerdown', function (e) {
            pos(e); audio();
            if (paused) return;
            g.pointer.down = true; g.pointer.justDown = true;
            g.pointer.downX = g.pointer.x; g.pointer.downY = g.pointer.y;
            if (g.running && cfg.pointerDown) cfg.pointerDown(g);
        });
        canvas.addEventListener('pointermove', function (e) {
            pos(e);
            if (g.running && !paused && cfg.pointerMove) cfg.pointerMove(g);
        });
        window.addEventListener('pointerup', function (e) {
            pos(e);
            if (paused) return;
            g.pointer.down = false; g.pointer.justUp = true;
            if (g.running && cfg.pointerUp) cfg.pointerUp(g);
        });
        canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        canvas.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });

        /* ── pause & mute ─────────────────────────────────────────────── */
        var paused = false;

        /** The HUD lives under the overlays, so while one is open it would
            otherwise show through as a blurred smudge. */
        function syncOverlayState() {
            var open = !menu.classList.contains('a-hidden')
                || !over.classList.contains('a-hidden')
                || !pauseScr.classList.contains('a-hidden');
            root.classList.toggle('a-overlay-open', open);
        }

        function togglePause() {
            if (!g.running) return;
            paused = !paused;
            pauseScr.classList.toggle('a-hidden', !paused);
            syncOverlayState();
            if (!paused) g.keys = Object.create(null);
        }

        function toggleMute() {
            setMuted(!muted);
            document.getElementById('a-mute').textContent = muted ? '🔇' : '🔊';
        }

        /* ── run control ──────────────────────────────────────────────── */
        var shake = 0;
        var raf = null;
        var lastT = 0;
        var skyT = 0; // backdrop clock: runs on the menu too, freezes on pause
        var scorePop = 0, lastShown = -1, lastHud = null;

        function startRun() {
            menu.classList.add('a-hidden');
            over.classList.add('a-hidden');
            pauseScr.classList.add('a-hidden');
            paused = false;
            particles.length = 0;
            shake = 0;
            g.t = 0; g.dt = 0; g.score = 0; g.s = {};
            g.pointer.down = false;
            extraEl.innerHTML = ''; lastHud = '';
            syncOverlayState();
            audio();
            cfg.init(g);
            g.running = true;
        }

        function endRun(note, won) {
            if (!g.running) return;
            g.running = false;
            sfx(won ? 'win' : 'lose');
            var final = Math.round(g.score);
            var isBest = saveBest(slug, final);
            document.getElementById('a-over-title').textContent = won ? (cfg.winTitle || 'RUN COMPLETE') : (cfg.overTitle || 'GAME OVER');
            document.getElementById('a-over-title').style.color = won ? accent : '#ff8b8b';
            document.getElementById('a-over-note').textContent = note || '';
            document.getElementById('a-final').textContent =
                (cfg.scoreLabel || 'SCORE') + ' ' + final.toLocaleString();
            document.getElementById('a-best-note').textContent = isBest
                ? '★ NEW PERSONAL BEST'
                : 'Best ' + best(slug).toLocaleString();
            document.getElementById('a-medal-note').textContent = medalNote(slug, best(slug));
            topbar.querySelector('.a-best').textContent = 'BEST ' + best(slug).toLocaleString();
            over.classList.remove('a-hidden');
            syncOverlayState();
        }

        function loop(t) {
            raf = requestAnimationFrame(loop);
            var dt = lastT ? Math.min(0.034, (t - lastT) / 1000) : 0;
            lastT = t;
            if (paused) dt = 0;
            g.dt = dt;
            skyT += dt;
            // g.t advances on the menu too so idle scenes breathe; startRun
            // zeroes it, so gameplay clocks are unaffected.
            g.t += dt;

            if (g.running) cfg.update(g, dt);
            // Not running: the game may animate its own idle scene behind the
            // menu and the game-over card. Without this the "live" menu is a
            // freeze-frame with a moving starfield behind it.
            else if (cfg.idle) cfg.idle(g, dt);

            // particles run even after the game ends, so the last explosion
            // finishes on screen instead of freezing mid-bloom.
            for (var i = particles.length - 1; i >= 0; i--) {
                var p = particles[i];
                p.age += dt;
                if (p.age >= p.life) { particles.splice(i, 1); continue; }
                p.x += p.vx * dt; p.y += p.vy * dt;
                var d = Math.exp(-p.drag * dt);
                p.vx *= d; p.vy *= d;
            }

            c.setTransform(dpr, 0, 0, dpr, 0, 0);
            c.clearRect(0, 0, W, H);

            if (shake > 0.2) {
                // Reduced motion keeps the decay (so callers still see shake
                // settle) but never translates the world.
                if (!reduceMotion) c.translate(U.rand(-shake, shake), U.rand(-shake, shake));
                shake *= Math.exp(-7 * dt);
            } else shake = 0;

            if (g.running || cfg.initMenu) cfg.draw(g, c);
            else space(c);

            // Particles render additively: overlapping debris reads as light,
            // which is the whole difference between "confetti" and "explosion".
            c.save();
            c.globalCompositeOperation = 'lighter';
            for (var j = 0; j < particles.length; j++) {
                var q = particles[j];
                var alpha = Math.max(0, 1 - q.age / q.life);
                c.globalAlpha = alpha;
                if (q.spark) {
                    c.strokeStyle = q.col;
                    c.lineWidth = Math.max(1, q.r * 0.7);
                    c.beginPath();
                    c.moveTo(q.x, q.y);
                    c.lineTo(q.x - q.vx * 0.03, q.y - q.vy * 0.03);
                    c.stroke();
                } else {
                    c.globalAlpha = alpha * 0.28;
                    c.fillStyle = q.col;
                    c.beginPath(); c.arc(q.x, q.y, q.r * 2.6, 0, 6.2832); c.fill();
                    c.globalAlpha = alpha;
                    c.beginPath(); c.arc(q.x, q.y, q.r, 0, 6.2832); c.fill();
                }
            }
            c.restore();
            c.globalAlpha = 1;

            // Score pop: a jump of any real size kicks the readout, so points
            // land as an event instead of a number quietly ticking over.
            var shown = Math.round(g.score);
            if (shown !== lastShown) {
                if (shown - lastShown >= 25) scorePop = 1;
                lastShown = shown;
                scoreEl.textContent = (cfg.scoreLabel || 'SCORE') + ' ' + shown.toLocaleString();
            }
            if (scorePop > 0.001) {
                scorePop *= Math.exp(-9 * dt);
                scoreEl.style.transform = 'scale(' + (1 + scorePop * 0.13) + ')';
            } else if (scorePop) {
                scorePop = 0;
                scoreEl.style.transform = '';
            }

            g.pointer.justDown = false;
            g.pointer.justUp = false;
        }

        document.addEventListener('visibilitychange', function () {
            if (document.hidden && g.running && !paused) togglePause();
        });

        document.getElementById('a-play').onclick = startRun;
        document.getElementById('a-again').onclick = startRun;
        document.getElementById('a-resume').onclick = togglePause;
        document.getElementById('a-mute').onclick = toggleMute;
        document.getElementById('a-motion').onchange = function () {
            reduceMotion = this.checked;
            localStorage.setItem(MOTION_KEY, reduceMotion ? '1' : '0');
        };

        resize();
        // The loop runs from page load: the menu sits over a live, drifting
        // sky instead of a freeze-frame, and the game-over screen keeps the
        // final scene breathing behind the glass.
        if (cfg.initMenu) cfg.initMenu(g);
        syncOverlayState();
        raf = requestAnimationFrame(loop);

        // QA handle, same convention as the mission pages.
        var api = { start: startRun, g: g, cfg: cfg, pause: togglePause, mute: toggleMute };
        window.__arcade = api;
        return api;
    }

    window.Arcade = { create: create, best: best, sfx: sfx, u: U, glow: glow, bloom: bloom, rockPath: rockPath };
})();

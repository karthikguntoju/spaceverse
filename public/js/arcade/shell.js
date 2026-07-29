/**
 * Arcade shell — the part every game in /games shares.
 *
 * Deliberately a plain classic script with no imports. The rest of the app runs
 * three different Three.js versions on different pages; the arcade opts out of
 * that entirely so a game page is a single canvas that starts in under a second.
 *
 * A game supplies a config object to Arcade.create() and gets back a run loop,
 * input, particles, screen shake, sound, pause-on-blur, and the menu/over
 * screens. Scores here are local bragging rights in localStorage only — they are
 * never sent to the server, so nothing in this file can influence mission XP.
 */
(function () {
    'use strict';

    var BEST_PREFIX = 'spaceverse.arcade.';

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
       Oscillators only. No audio files to load, and nothing to 404. */
    var actx = null;
    function audio() {
        if (!actx) {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (AC) actx = new AC();
        }
        if (actx && actx.state === 'suspended') actx.resume();
        return actx;
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
        if (!a || !VOICES[name]) return;
        var v = VOICES[name];
        var o = a.createOscillator();
        var g = a.createGain();
        var t = a.currentTime;
        o.type = v.type;
        o.frequency.setValueAtTime(v.f * (detune || 1), t);
        o.frequency.exponentialRampToValueAtTime(Math.max(20, v.to * (detune || 1)), t + v.d);
        g.gain.setValueAtTime(v.g, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + v.d);
        o.connect(g); g.connect(a.destination);
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
        }
    };

    function glow(c, x, y, r, colour, inner) {
        var grd = c.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, inner || colour);
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = grd;
        c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
    }

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
            '<span class="a-best">BEST ' + best(slug).toLocaleString() + '</span>';

        var flashEl = el('div', 'a-flash');

        var menu = el('div', 'a-screen');
        menu.innerHTML =
            '<div class="a-card">' +
            '<h1>' + cfg.title + '</h1>' +
            '<p class="a-tag">' + cfg.tagline + '</p>' +
            '<ul class="a-controls">' +
            (cfg.controls || []).map(function (r) {
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
            '<div class="a-row">' +
            '<button class="a-btn" id="a-again">PLAY AGAIN</button>' +
            '<a class="a-btn a-ghost" href="/games">ARCADE</a>' +
            '</div></div>';

        root.appendChild(topbar);
        root.appendChild(hud);
        root.appendChild(flashEl);
        root.appendChild(menu);
        root.appendChild(over);

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
            if (cfg.onResize) cfg.onResize(g);
        }
        window.addEventListener('resize', resize);

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
            glow: glow,
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
            hud: function (html) { extraEl.innerHTML = html; },
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
                        drag: opts.drag == null ? 1.6 : opts.drag
                    });
                }
            },
            over: function (note, won) { endRun(note, won); }
        };

        /* ── input ────────────────────────────────────────────────────── */
        window.addEventListener('keydown', function (e) {
            if (e.code === 'Escape') { window.location.href = '/games'; return; }
            if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.key) >= 0) e.preventDefault();
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

        function pos(e) {
            var r = canvas.getBoundingClientRect();
            g.pointer.x = e.clientX - r.left;
            g.pointer.y = e.clientY - r.top;
        }
        canvas.addEventListener('pointerdown', function (e) {
            pos(e); audio();
            g.pointer.down = true; g.pointer.justDown = true;
            g.pointer.downX = g.pointer.x; g.pointer.downY = g.pointer.y;
            if (g.running && cfg.pointerDown) cfg.pointerDown(g);
        });
        canvas.addEventListener('pointermove', function (e) {
            pos(e);
            if (g.running && cfg.pointerMove) cfg.pointerMove(g);
        });
        window.addEventListener('pointerup', function (e) {
            pos(e);
            g.pointer.down = false; g.pointer.justUp = true;
            if (g.running && cfg.pointerUp) cfg.pointerUp(g);
        });
        canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        canvas.addEventListener('touchstart', function (e) { e.preventDefault(); }, { passive: false });

        /* ── run control ──────────────────────────────────────────────── */
        var shake = 0;
        var raf = null;
        var lastT = 0;
        var paused = false;

        function startRun() {
            menu.classList.add('a-hidden');
            over.classList.add('a-hidden');
            particles.length = 0;
            shake = 0;
            g.t = 0; g.dt = 0; g.score = 0; g.s = {};
            g.pointer.down = false;
            extraEl.innerHTML = '';
            audio();
            cfg.init(g);
            g.running = true;
            lastT = 0;
            if (raf) cancelAnimationFrame(raf);
            raf = requestAnimationFrame(loop);
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
            topbar.querySelector('.a-best').textContent = 'BEST ' + best(slug).toLocaleString();
            over.classList.remove('a-hidden');
        }

        function loop(t) {
            raf = requestAnimationFrame(loop);
            var dt = lastT ? Math.min(0.034, (t - lastT) / 1000) : 0;
            lastT = t;
            if (paused) dt = 0;
            g.dt = dt;

            if (g.running) {
                g.t += dt;
                cfg.update(g, dt);
            }

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
                c.translate(U.rand(-shake, shake), U.rand(-shake, shake));
                shake *= Math.exp(-7 * dt);
            } else shake = 0;

            cfg.draw(g, c);

            c.save();
            for (var j = 0; j < particles.length; j++) {
                var q = particles[j];
                c.globalAlpha = Math.max(0, 1 - q.age / q.life);
                c.fillStyle = q.col;
                c.beginPath(); c.arc(q.x, q.y, q.r, 0, 6.2832); c.fill();
            }
            c.restore();
            c.globalAlpha = 1;

            scoreEl.textContent = (cfg.scoreLabel || 'SCORE') + ' ' + Math.round(g.score).toLocaleString();
            g.pointer.justDown = false;
            g.pointer.justUp = false;
        }

        document.addEventListener('visibilitychange', function () { paused = document.hidden; });

        document.getElementById('a-play').onclick = startRun;
        document.getElementById('a-again').onclick = startRun;

        resize();
        // Draw one frame of the idle scene behind the menu, so the page never
        // shows an empty black rectangle while the player reads the controls.
        if (cfg.initMenu) { cfg.initMenu(g); cfg.draw(g, c); }

        // QA handle, same convention as the mission pages.
        var api = { start: startRun, g: g, cfg: cfg };
        window.__arcade = api;
        return api;
    }

    window.Arcade = { create: create, best: best, sfx: sfx, u: U, glow: glow };
})();

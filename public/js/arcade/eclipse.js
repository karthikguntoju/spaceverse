/**
 * Eclipse — stealth, except the guard is a star.
 *
 * The Sun floods the whole system with light. Planets on their orbits cast
 * moving umbra cones, and those cones are the only cover there is. Shield
 * burns down in the light and crawls back in the dark, so the game is reading
 * where the shadows will be, not where they are. Data crystals pay out, and
 * of course they never spawn anywhere convenient.
 *
 * Two rules the art has to obey, because the whole game is one read:
 *   – cover is a CARVED VOLUME: near-black fill, hard violet edge, no haze.
 *   – ambience is HAZE: wide, soft, slow, and never edged.
 * Anything that blurs those two categories is a bug, not a style choice.
 */
(function () {
    'use strict';

    var SUN_R = 30;
    var DRAIN = 14;         // shield per second in open sunlight
    var REGEN = 6;          // shield per second in shadow
    var CRYSTALS = 3;       // alive at once
    var SHIP_R = 9;         // visible hull half-size — the hitbox uses this
    var GRACE = 0.4;        // seconds of free exposure when you leave cover
    var CHAIN_WINDOW = 4;   // seconds to bank the next crystal for 1.5x
    var PHASE_LEN = 45;     // seconds per escalation phase
    var FORECAST = 3;       // seconds ahead the ghost cones project

    var LILAC = '#ded1ff';  // ship in shadow
    var SUNLIT = '#ffe9c9'; // ship fully exposed

    /* Corona warms one step per phase, so the sky itself says "later". */
    var CORONA = [
        'rgba(255,201,88,0.32)',
        'rgba(255,176,72,0.36)',
        'rgba(255,148,62,0.40)',
        'rgba(255,120,54,0.45)',
        'rgba(255,96,48,0.50)'
    ];
    var SUN_RIM = ['#ff9a3d', '#ff8a34', '#ff7a2e', '#ff6a2a', '#ff5c28'];

    /* ── light-field canvases, at module scope ────────────────────────────
       These are full-viewport backing stores. `g.s` is rebuilt on every
       init(), so hanging them off state meant a fresh multi-megabyte canvas
       pair on every single replay. They belong to the module and are resized
       only when the viewport actually changes.

         GB — the sun's radial falloff. Pure geometry, so it is baked once
              per size and tinted at composite time with globalAlpha.
         HB — the volumetric haze wedges. Rebuilt on a slow shimmer tick
              rather than per frame; the shimmer's period is ~9s, so a 6Hz
              rebuild is visually continuous at a tenth of the cost.
         LC — the per-frame working copy: draw the two caches, punch the
              umbras out of it, composite once. */
    var LC = null, LX = null;
    var GB = null, GX = null;
    var HB = null, HX = null;
    var cacheW = 0, cacheH = 0;
    var hazeTick = -1;

    function ensureCanvases() {
        if (LC) return;
        LC = document.createElement('canvas'); LX = LC.getContext('2d');
        GB = document.createElement('canvas'); GX = GB.getContext('2d');
        HB = document.createElement('canvas'); HX = HB.getContext('2d');
    }

    function sizeLight(g) {
        ensureCanvases();
        var w = Math.max(1, Math.round(g.w));
        var h = Math.max(1, Math.round(g.h));
        if (w === cacheW && h === cacheH) return;
        cacheW = w; cacheH = h;
        LC.width = w; LC.height = h;
        GB.width = w; GB.height = h;
        HB.width = w; HB.height = h;
        buildGradient();
        hazeTick = -1;
    }

    /** The sun's falloff, baked at full strength. Flare brightness and the
        slow breathing ride on globalAlpha at composite time, so no gradient
        object is ever allocated inside the frame loop. */
    function buildGradient() {
        var cx = cacheW / 2, cy = cacheH / 2;
        var R = Math.max(cacheW, cacheH) * 0.8;
        GX.setTransform(1, 0, 0, 1, 0, 0);
        GX.clearRect(0, 0, cacheW, cacheH);
        var lg = GX.createRadialGradient(cx, cy, SUN_R, cx, cy, R);
        lg.addColorStop(0, 'rgba(255,214,140,1)');
        lg.addColorStop(0.5, 'rgba(255,196,110,0.5)');
        lg.addColorStop(1, 'rgba(255,180,90,0)');
        GX.fillStyle = lg;
        GX.fillRect(0, 0, cacheW, cacheH);
    }

    /* Five WIDE wedges, each smeared across three offset copies at ±3° with
       falling alpha, breathing out of phase with one another. The old build
       drew twelve hard-edged triangles at the same order of alpha as the
       umbra cones, which meant a god ray and a shadow cone were the same
       visual object — fatal in a game whose entire skill is reading cover.
       These have no readable edge at any single frame. They are weather. */
    var HAZE_OFF = [0, 0.05236, -0.05236];
    var HAZE_FADE = [1, 0.6, 0.34];

    function buildHaze(t) {
        var cx = cacheW / 2, cy = cacheH / 2;
        var R = Math.max(cacheW, cacheH) * 0.95;
        HX.setTransform(1, 0, 0, 1, 0, 0);
        HX.clearRect(0, 0, cacheW, cacheH);
        HX.save();
        HX.translate(cx, cy);
        HX.rotate(t * 0.03);
        for (var i = 0; i < 5; i++) {
            var base = 0.025 * (0.5 + 0.5 * Math.sin(t * 0.7 + i));
            var a0 = (i / 5) * 6.2832;
            for (var k = 0; k < 3; k++) {
                HX.save();
                HX.rotate(a0 + HAZE_OFF[k]);
                HX.fillStyle = 'rgba(255,220,150,' + (base * HAZE_FADE[k]).toFixed(4) + ')';
                HX.beginPath();
                HX.moveTo(SUN_R, 0);
                HX.lineTo(R, -R * 0.17);
                HX.lineTo(R, R * 0.17);
                HX.closePath();
                HX.fill();
                HX.restore();
            }
        }
        HX.restore();
    }

    /* ── maths ────────────────────────────────────────────────────────── */
    function orbitD(g, p) { return p.df * Math.min(g.w, g.h); }

    function halfWidth(g, p) { return Math.asin(Math.min(1, p.r / orbitD(g, p))); }

    function far(g) { return Math.max(2400, Math.max(g.w, g.h) * 2.2); }

    function conePath(ctx, cx, cy, d, a, hw, f) {
        var a1 = a - hw, a2 = a + hw;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a1) * d, cy + Math.sin(a1) * d);
        ctx.lineTo(cx + Math.cos(a1) * f, cy + Math.sin(a1) * f);
        ctx.lineTo(cx + Math.cos(a2) * f, cy + Math.sin(a2) * f);
        ctx.lineTo(cx + Math.cos(a2) * d, cy + Math.sin(a2) * d);
        ctx.closePath();
    }

    function mixHex(a, b, t) {
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        var ar = parseInt(a.substr(1, 2), 16), ag = parseInt(a.substr(3, 2), 16), ab = parseInt(a.substr(5, 2), 16);
        var br = parseInt(b.substr(1, 2), 16), bg = parseInt(b.substr(3, 2), 16), bb = parseInt(b.substr(5, 2), 16);
        return 'rgb(' + Math.round(ar + (br - ar) * t) + ','
            + Math.round(ag + (bg - ag) * t) + ','
            + Math.round(ab + (bb - ab) * t) + ')';
    }

    function roundRect(ctx, x, y, w, h, r) {
        if (w < r * 2) r = w / 2;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }

    /**
     * Is a body of radius `rad` wholly inside some planet's drawn umbra?
     *
     * Two things the old version got wrong on a game that lives and dies at
     * the shadow boundary: it shrank the logical cone to 96% of the drawn
     * one (so the pixels lied by 4%), and it treated the ship as a point
     * against a nine-pixel triangle (so half the hull could bake while the
     * game said you were safe). Now the hull's own angular half-width at its
     * distance is added, and the cone is the one you can see.
     */
    function inShadow(g, x, y, rad) {
        var s = g.s;
        if (!s || !s.planets) return false;
        var cx = g.w / 2, cy = g.h / 2;
        var sa = g.angleTo(cx, cy, x, y);
        var sd = g.dist(cx, cy, x, y);
        var own = Math.asin(Math.min(1, (rad || 0) / Math.max(1, sd)));
        for (var i = 0; i < s.planets.length; i++) {
            var p = s.planets[i];
            var d = orbitD(g, p);
            if (sd <= d) continue;
            if (Math.abs(g.wrapAngle(sa - p.a)) + own < halfWidth(g, p)) return true;
        }
        return false;
    }

    /* ── setup ────────────────────────────────────────────────────────────
       Crystals sample an ELLIPSE, not a circle. A radius keyed to
       min(w,h) put every spawn inside a 662px-wide band on a 1280x720
       frame — the outer ~309px each side was sky the player never had a
       reason to fly into. Each axis now gets its own span, so the field
       fills the frame it is actually drawn in. Planet clearance (and now
       the star) still gates each candidate. */
    function spawnCrystal(g) {
        var s = g.s;
        var cx = g.w / 2, cy = g.h / 2;
        for (var tries = 0; tries < 30; tries++) {
            var a = g.rand(0, 6.2832);
            var x = cx + Math.cos(a) * g.rand(g.w * 0.09, g.w * 0.42);
            var y = cy + Math.sin(a) * g.rand(g.h * 0.16, g.h * 0.44);
            if (x < 30 || x > g.w - 30 || y < 60 || y > g.h - 46) continue;
            if (g.dist(x, y, cx, cy) < SUN_R + 42) continue;
            var clear = true;
            for (var i = 0; i < s.planets.length; i++) {
                var p = s.planets[i];
                if (g.dist(x, y, p.x, p.y) < p.r + 26) { clear = false; break; }
            }
            if (clear) return { x: x, y: y, ph: g.rand(0, 6.2832), risky: false };
        }
        return { x: cx + g.w * 0.28, y: cy, ph: 0, risky: false };
    }

    function placePlanets(g) {
        var s = g.s;
        var cx = g.w / 2, cy = g.h / 2;
        for (var i = 0; i < s.planets.length; i++) {
            var p = s.planets[i];
            var d = orbitD(g, p);
            p.x = cx + Math.cos(p.a) * d;
            p.y = cy + Math.sin(p.a) * d;
        }
    }

    /** A crystal sitting in open sunlight pays 2.5x. The player has to be
        able to price that before committing, so risk is recomputed every
        frame and shows up in the crystal's own colour. */
    function markRisk(g) {
        var s = g.s;
        if (!s || !s.crystals) return;
        for (var i = 0; i < s.crystals.length; i++) {
            var cr = s.crystals[i];
            cr.risky = !inShadow(g, cr.x, cr.y, 0);
        }
    }

    function init(g) {
        var s = {
            ship: { x: g.w / 2, y: g.h * 0.82, vx: 0, vy: 0 },
            shield: 100,
            planets: [],
            crystals: [],
            got: 0,
            lit: false,
            grace: GRACE,
            graceMax: GRACE,    // phases 5+ shave this down; see phaseBeat()
            phase: 1,
            mul: 1,
            lastPick: -99,
            chain: 0,
            flare: { next: 14, active: 0, warned: false },
            burnTick: 0,
            pulses: []
        };
        g.s = s;

        // Four orbits, mixed speeds and directions, so the shadow map never
        // repeats and no single hiding spot survives a full rotation.
        var defs = [
            { df: 0.14, r: 16, speed: 0.30, hue: 210 },
            { df: 0.21, r: 24, speed: -0.19, hue: 30 },
            { df: 0.285, r: 20, speed: 0.13, hue: 160 },
            { df: 0.36, r: 28, speed: -0.085, hue: 270 }
        ];
        for (var i = 0; i < defs.length; i++) {
            var p = defs[i];
            p.a = g.rand(0, 6.2832);
            p.x = 0; p.y = 0;
            p.ring = i === 3;   // the outer gas giant gets the ring
            s.planets.push(p);
        }
        placePlanets(g);

        for (var k = 0; k < CRYSTALS; k++) s.crystals.push(spawnCrystal(g));
        markRisk(g);
        sizeLight(g);
    }

    /** A new body running the wrong way. Speed alone is a difficulty number;
        a new cone changes the *shape* of the map, which is a difficulty the
        player can see. */
    function addRetroBody(g, df, r, speed, hue, col, spark) {
        var s = g.s;
        var p = {
            df: df, r: r, speed: speed, hue: hue,
            a: g.rand(0, 6.2832), x: 0, y: 0, ring: false, retro: true
        };
        s.planets.push(p);
        placePlanets(g);
        g.burst(p.x, p.y, { n: 26, colour: col, speed: 260, life: 0.7 });
        g.burst(p.x, p.y, { n: 10, colour: spark, speed: 340, life: 0.5, shape: 'spark' });
    }

    /**
     * What actually changes at the top of phase `n`, and what the banner is
     * therefore allowed to say.
     *
     * The old build stopped escalating at t=75s (speed capped) and t=90s
     * (last new body), so every banner after that announced a change that
     * was not happening. Now: orbit speed is unbounded, phase 3 and phase 4
     * each land a counter-orbiting body, and from phase 5 the free-exposure
     * grace window shrinks a step per phase until it bottoms out. Whatever
     * this returns is literally true of the phase the player just entered.
     */
    function phaseBeat(g, phase) {
        var s = g.s;
        // `>=`, not `===`: the body count is the one-shot guard, so a phase
        // that arrives late still gets its beat instead of silently skipping.
        if (phase >= 3 && s.planets.length < 5) {
            addRetroBody(g, 0.098, 14, -0.46, 340, '#fb7185', '#ffd9e2');
            return 'RETROGRADE BODY';
        }
        // Outside the gas giant, not between two existing orbits — the inner
        // lanes are already packed tight enough that a sixth body there would
        // clip its neighbours. It also throws cover across the outer frame,
        // which is exactly where crystals can now spawn.
        if (phase >= 4 && s.planets.length < 6) {
            addRetroBody(g, 0.45, 20, -0.42, 292, '#c084fc', '#efe1ff');
            return 'SECOND COUNTER-ORBIT';
        }
        if (phase >= 5) {
            var ng = Math.max(0.12, GRACE - (phase - 4) * 0.07);
            if (ng < s.graceMax - 0.001) {
                s.graceMax = ng;
                return 'GRACE ' + ng.toFixed(2) + 's';
            }
        }
        return 'ORBITS ACCELERATING';
    }

    /* ── the menu scene keeps turning ─────────────────────────────────── */
    function idle(g, dt) {
        var s = g.s;
        if (!s || !s.planets) return;
        for (var i = 0; i < s.planets.length; i++) s.planets[i].a += s.planets[i].speed * dt;
        placePlanets(g);
        markRisk(g);
        for (var pu = s.pulses.length - 1; pu >= 0; pu--) {
            s.pulses[pu].age += dt;
            if (s.pulses[pu].age > 0.6) s.pulses.splice(pu, 1);
        }
    }

    /* ── update ───────────────────────────────────────────────────────── */
    function update(g, dt) {
        var s = g.s;
        var sh = s.ship;
        var cx = g.w / 2, cy = g.h / 2;

        // Escalation, announced — and the announcement has to be true.
        var phase = 1 + Math.floor(g.t / PHASE_LEN);
        if (phase !== s.phase) {
            s.phase = phase;
            g.flash('PHASE ' + phase + ' — ' + phaseBeat(g, phase), '#a78bfa', 1300);
            g.sfx('win', 0.75);
            g.shake(5);
        }

        /* Logarithmic and unbounded, rather than linear to a hard ceiling at
           t=75s. It still doubles by the end of phase 2 and it never stops
           climbing, so "ORBITS ACCELERATING" stays a fact at minute ten. */
        var mul = 1 + Math.log1p(g.t / 45);
        s.mul = mul;
        for (var i = 0; i < s.planets.length; i++) s.planets[i].a += s.planets[i].speed * mul * dt;
        placePlanets(g);

        // flare timeline: warn, burn, reschedule
        var f = s.flare;
        if (f.active > 0) {
            f.active -= dt;
        } else {
            if (!f.warned && g.t > f.next - 2) {
                f.warned = true;
                g.flash('FLARE INCOMING', '#fbbf24', 900);
                g.sfx('tick', 0.5);
            }
            if (g.t > f.next) {
                f.active = 3;
                f.warned = false;
                // Same log curve as the orbits: the gap keeps closing instead
                // of flat-lining at 0.6x from t=120s onward.
                f.next = g.t + g.rand(11, 17) * Math.max(0.35, 1 / (1 + Math.log1p(g.t / 90)));
                g.shake(6);
                g.sfx('boom', 1.6);
            }
        }
        var flaring = f.active > 0;

        var ax = 0, ay = 0, ACC = 430;
        if (g.key('KeyW') || g.key('ArrowUp')) ay -= 1;
        if (g.key('KeyS') || g.key('ArrowDown')) ay += 1;
        if (g.key('KeyA') || g.key('ArrowLeft')) ax -= 1;
        if (g.key('KeyD') || g.key('ArrowRight')) ax += 1;
        if (g.pointer.down) {
            var pa = g.angleTo(sh.x, sh.y, g.pointer.x, g.pointer.y);
            var pd = g.dist(sh.x, sh.y, g.pointer.x, g.pointer.y);
            if (pd > 14) { ax += Math.cos(pa); ay += Math.sin(pa); }
        }
        var al = Math.hypot(ax, ay);
        if (al > 0) {
            sh.vx += (ax / al) * ACC * dt;
            sh.vy += (ay / al) * ACC * dt;
            if (Math.random() < 0.5) {
                var ba = Math.atan2(ay, ax) + Math.PI;
                g.burst(sh.x, sh.y, { n: 1, angle: ba, spread: 0.4, speed: 90, colour: '#a78bfa', life: 0.35, size: 1.5, shape: 'spark' });
            }
        }
        var damp = Math.exp(-1.9 * dt);
        sh.vx *= damp; sh.vy *= damp;
        sh.x += sh.vx * dt; sh.y += sh.vy * dt;

        // soft walls; drifting off-screen is not an escape plan
        if (sh.x < 14) { sh.x = 14; sh.vx = Math.abs(sh.vx) * 0.4; }
        if (sh.x > g.w - 14) { sh.x = g.w - 14; sh.vx = -Math.abs(sh.vx) * 0.4; }
        if (sh.y < 52) { sh.y = 52; sh.vy = Math.abs(sh.vy) * 0.4; }
        if (sh.y > g.h - 14) { sh.y = g.h - 14; sh.vy = -Math.abs(sh.vy) * 0.4; }

        // planets are terrain, not cover you can merge with
        for (var pi = 0; pi < s.planets.length; pi++) {
            var p = s.planets[pi];
            var pd2 = g.dist(sh.x, sh.y, p.x, p.y);
            if (pd2 < p.r + 12) {
                var push = g.angleTo(p.x, p.y, sh.x, sh.y);
                sh.x = p.x + Math.cos(push) * (p.r + 12);
                sh.y = p.y + Math.sin(push) * (p.r + 12);
                sh.vx += Math.cos(push) * 60;
                sh.vy += Math.sin(push) * 60;
                // A shove from the inner body must never be the thing that
                // feeds you to the star — that death has to be yours.
                var rd = g.dist(sh.x, sh.y, cx, cy);
                if (rd < SUN_R + 16) {
                    var oa = g.angleTo(cx, cy, sh.x, sh.y);
                    sh.x = cx + Math.cos(oa) * (SUN_R + 16);
                    sh.y = cy + Math.sin(oa) * (SUN_R + 16);
                    sh.vx += -Math.sin(oa) * 40 + Math.cos(oa) * 50;
                    sh.vy += Math.cos(oa) * 40 + Math.sin(oa) * 50;
                }
            }
        }

        if (g.dist(sh.x, sh.y, cx, cy) < SUN_R + 14) {
            g.burst(sh.x, sh.y, { n: 50, colour: '#fbbf24', speed: 380, life: 0.9 });
            g.burst(sh.x, sh.y, { n: 24, colour: '#fff3c4', speed: 480, life: 0.6, shape: 'spark' });
            g.shake(26); g.sfx('boom');
            g.over('You flew into the star you were hiding from.');
            return;
        }

        // The whole hull has to clear the cone, and leaving cover costs you
        // s.graceMax of nothing before the burn starts — long enough to read
        // the hull warming from lilac to sunlit and get back in. Phases 5+
        // shrink that window, which is the late-game escalation.
        var covered = inShadow(g, sh.x, sh.y, SHIP_R);
        s.lit = !covered;
        if (covered) {
            s.grace = s.graceMax;
            s.shield = Math.min(100, s.shield + REGEN * dt);
        } else {
            if (s.grace > 0) {
                s.grace = Math.max(0, s.grace - dt);
                if (s.grace === 0) g.sfx('tick', 0.6);
            } else {
                s.shield -= DRAIN * (flaring ? 2.5 : 1) * dt;
                s.burnTick -= dt;
                if (s.burnTick <= 0) { g.sfx('tick', 0.8); s.burnTick = 0.55; }
                if (Math.random() < 0.35) {
                    g.burst(sh.x, sh.y, { n: 1, colour: flaring ? '#ff9a3d' : '#fbbf24', speed: 70, life: 0.4, size: 1.4, shape: 'spark' });
                }
                if (s.shield <= 0) {
                    g.burst(sh.x, sh.y, { n: 60, colour: '#ff9a3d', speed: 420, life: 1 });
                    g.shake(24); g.sfx('boom');
                    g.over('Shield cooked with ' + s.got + ' crystals recovered. The dark was right there.');
                    return;
                }
            }
        }

        markRisk(g);

        for (var ci = s.crystals.length - 1; ci >= 0; ci--) {
            var cr = s.crystals[ci];
            if (g.dist(sh.x, sh.y, cr.x, cr.y) < 22) {
                // Price the pickup by where it sat, not by the fact of it.
                var exposed = inShadow(g, cr.x, cr.y, 0) ? 1 : 2.5;
                var chained = (g.t - s.lastPick) < CHAIN_WINDOW;
                var gain = Math.round(400 * exposed * (1 + s.got * 0.05) * (chained ? 1.5 : 1));
                var heal = exposed > 1 ? 18 : 12;

                s.got++;
                s.chain = chained ? s.chain + 1 : 1;
                s.lastPick = g.t;
                s.shield = Math.min(100, s.shield + heal);
                g.addScore(gain);
                g.sfx('pick', 1 + s.got * 0.04);

                var col = exposed > 1 ? '#fb7185' : '#a78bfa';
                g.burst(cr.x, cr.y, { n: exposed > 1 ? 26 : 18, colour: col, speed: 230, life: 0.6 });
                g.burst(cr.x, cr.y, { n: 8, colour: '#e9d5ff', speed: 300, life: 0.45, shape: 'spark' });
                s.pulses.push({ x: cr.x, y: cr.y, r: 10, age: 0, risky: exposed > 1 });
                g.flash('+' + gain.toLocaleString() + (chained ? ' ×1.5 CHAIN' : '') + ' · SHIELD +' + heal, col, 620);
                if (chained) g.shake(3);

                s.crystals.splice(ci, 1);
                s.crystals.push(spawnCrystal(g));
                markRisk(g);
            }
        }

        for (var pu = s.pulses.length - 1; pu >= 0; pu--) {
            s.pulses[pu].age += dt;
            if (s.pulses[pu].age > 0.6) s.pulses.splice(pu, 1);
        }

        g.addScore(10 * dt);

        var state = covered
            ? '<b style="color:#a78bfa">IN SHADOW</b>'
            : (s.grace > 0 ? '<b style="color:#fcd34d">EXPOSING</b>' : '<b style="color:#fbbf24">EXPOSED</b>');

        var left = CHAIN_WINDOW - (g.t - s.lastPick);
        var chainRow = '';
        if (left > 0) {
            // Quantised so the cached HUD string changes ~5x/s, not 60x/s.
            var frac = Math.round((left / CHAIN_WINDOW) * 20) / 20;
            chainRow = '<br>CHAIN <b style="color:#fbbf24">×1.5</b> '
                + '<span style="display:inline-block;width:11px;height:11px;border-radius:50%;vertical-align:-1px;'
                + 'background:conic-gradient(#fbbf24 0turn ' + frac + 'turn,rgba(251,191,36,0.18) ' + frac + 'turn 1turn)"></span>';
        }

        /* No shield percentage here. The gauge bottom-left is the shield
           instrument — labelled, ticked, with the 30% threshold marked — and
           printing the same number in the opposite corner made the player
           check two places for one fact. This row carries the state word the
           gauge cannot: whether the burn has started. */
        var graceRow = s.graceMax < GRACE - 0.001
            ? ' · GRACE <b style="color:#fcd34d">' + s.graceMax.toFixed(2) + 's</b>'
            : '';

        g.hud(state + '<br>'
            + 'CRYSTALS <b>' + s.got + '</b> · PHASE <b>' + s.phase + '</b>'
            + graceRow
            + chainRow
            + (flaring ? '<br><b style="color:#ff9a3d">SOLAR FLARE</b>' : ''));
    }

    /* ── draw ─────────────────────────────────────────────────────────── */
    function draw(g, c) {
        var s = g.s;
        if (!s || !s.planets) return;
        var cx = g.w / 2, cy = g.h / 2;
        var f = s.flare;
        var flaring = f.active > 0;
        var F = far(g);
        var phi = Math.min(CORONA.length - 1, (s.phase || 1) - 1);
        // Phases past the end of the palette keep swelling the star instead
        // of freezing the sky's read of "how late is it" at phase 5.
        var over = Math.max(0, (s.phase || 1) - CORONA.length);

        g.space(c, { bg: '#04050e', driftX: -3, driftY: 1 });

        /* ── the light field ─────────────────────────────────────────────
           Per frame this is now: clear, two cached blits, N destination-out
           cones, one composite. No gradient allocation, no wedge geometry. */
        sizeLight(g);
        var tick = Math.floor(g.t * 6);
        if (tick !== hazeTick) { hazeTick = tick; buildHaze(g.t); }

        var la = (flaring ? 0.30 : 0.16) + Math.sin(g.t * 1.3) * 0.015;
        LX.setTransform(1, 0, 0, 1, 0, 0);
        LX.globalCompositeOperation = 'source-over';
        LX.clearRect(0, 0, cacheW, cacheH);
        LX.globalAlpha = la;
        LX.drawImage(GB, 0, 0);
        LX.globalAlpha = 1;
        LX.drawImage(HB, 0, 0);

        LX.globalCompositeOperation = 'destination-out';
        for (var i = 0; i < s.planets.length; i++) {
            var p = s.planets[i];
            conePath(LX, cx, cy, orbitD(g, p), p.a, halfWidth(g, p), F);
            LX.fill();
        }
        LX.globalCompositeOperation = 'source-over';

        c.save();
        c.globalCompositeOperation = 'lighter';
        c.drawImage(LC, 0, 0, g.w, g.h);
        c.restore();

        /* ── cover, carved ───────────────────────────────────────────────
           Near-black fill plus a hard violet edge on both boundaries. The
           haze above has no edge at all, so the two can never be confused:
           if it has a line down the side of it, you can hide in it. */
        c.save();
        for (var si = 0; si < s.planets.length; si++) {
            var sp = s.planets[si];
            var sd = orbitD(g, sp);
            var shw = halfWidth(g, sp);
            conePath(c, cx, cy, sd, sp.a, shw, F);
            c.fillStyle = 'rgba(2,3,12,0.55)';
            c.fill();

            var b1 = sp.a - shw, b2 = sp.a + shw;
            c.strokeStyle = 'rgba(167,139,250,0.35)';
            c.lineWidth = 3;
            c.beginPath();
            c.moveTo(cx + Math.cos(b1) * sd, cy + Math.sin(b1) * sd);
            c.lineTo(cx + Math.cos(b1) * F, cy + Math.sin(b1) * F);
            c.moveTo(cx + Math.cos(b2) * sd, cy + Math.sin(b2) * sd);
            c.lineTo(cx + Math.cos(b2) * F, cy + Math.sin(b2) * F);
            c.stroke();
        }
        c.restore();

        /* ── the forecast ────────────────────────────────────────────────
           Where every cone will be in three seconds — the instrument that
           turns "plan a route through moving cover" into something you can
           actually do.

           It used to be a 10%-alpha violet fill drawn UNDER the cover, so
           the real umbra painted its own 55% black back over the overlapping
           half and what survived was a tint nobody could name. Now it is the
           edge only: two dashed boundary rays, marching outward, plus a
           chevron on the leading ray pointing the way the wipe is sweeping.
           Lines, not volume, so it can never be mistaken for cover you can
           hide in — it is where the dark is *going*. */
        var m = Math.min(g.w, g.h);
        var fmul = s.mul || 1;
        c.save();
        c.lineWidth = 2;
        c.strokeStyle = 'rgba(167,139,250,0.55)';
        c.setLineDash([9, 7]);
        c.lineDashOffset = -g.t * 26;
        for (var gi = 0; gi < s.planets.length; gi++) {
            var gp = s.planets[gi];
            var gd = orbitD(g, gp);
            /* Lead angle is clamped. The fast inner body at a late-phase
               multiplier sweeps well past 180° in three seconds, and a
               forecast that has wrapped around the far side of the star is
               not information — it is a second set of lines pointing at
               nothing. Capped, every marker still reads as "the next wipe,
               coming from that side". */
            var dl = gp.speed * fmul * FORECAST;
            if (dl > 1.15) dl = 1.15; else if (dl < -1.15) dl = -1.15;
            var ga = gp.a + dl;
            var ghw = halfWidth(g, gp);
            var e1 = ga - ghw, e2 = ga + ghw;
            c.beginPath();
            c.moveTo(cx + Math.cos(e1) * gd, cy + Math.sin(e1) * gd);
            c.lineTo(cx + Math.cos(e1) * F, cy + Math.sin(e1) * F);
            c.moveTo(cx + Math.cos(e2) * gd, cy + Math.sin(e2) * gd);
            c.lineTo(cx + Math.cos(e2) * F, cy + Math.sin(e2) * F);
            c.stroke();

            /* Chevron on whichever ray is out front, aimed along the sweep.
               It rides the ray at a readable distance outside the orbit, but
               never past the frame edge — on the outer orbits that limit
               bites near vertical, so the marker fades out rather than
               popping off-screen. */
            var fwd = gp.speed >= 0;
            var lead = fwd ? e2 : e1;
            var cl = Math.abs(Math.cos(lead)), sl = Math.abs(Math.sin(lead));
            var maxr = Math.min(cl > 0.002 ? (g.w / 2 - 26) / cl : 1e9,
                sl > 0.002 ? (g.h / 2 - 62) / sl : 1e9);
            var room = maxr - gd - 16;
            if (room <= 0) continue;
            var ar = gd + Math.min(m * 0.17, room * 0.7);
            c.save();
            c.setLineDash([]);
            c.globalAlpha = Math.min(1, room / 40);
            c.translate(cx + Math.cos(lead) * ar, cy + Math.sin(lead) * ar);
            c.rotate(lead + (fwd ? 1.5708 : -1.5708));
            c.fillStyle = 'rgba(167,139,250,0.8)';
            c.beginPath();
            c.moveTo(8, 0); c.lineTo(-4.5, -5.5); c.lineTo(-4.5, 5.5);
            c.closePath(); c.fill();
            c.restore();
        }
        c.restore();

        // ── the Sun ──────────────────────────────────────────────────────
        var coronaR = SUN_R * (flaring ? 4.6 : 3.2)
            * (1 + Math.min(1.1, over * 0.16)) * (1 + Math.sin(g.t * 1.7) * 0.05);
        g.bloom(c, cx, cy, coronaR, flaring ? 'rgba(255,150,58,0.50)' : CORONA[phi]);
        if (over > 0) g.bloom(c, cx, cy, coronaR * 0.72, 'rgba(255,72,40,' + Math.min(0.28, over * 0.05) + ')');
        var body = c.createRadialGradient(cx - SUN_R * 0.25, cy - SUN_R * 0.25, SUN_R * 0.1, cx, cy, SUN_R);
        body.addColorStop(0, '#fffbe9');
        body.addColorStop(0.55, '#ffe289');
        body.addColorStop(1, SUN_RIM[phi]);
        c.fillStyle = body;
        c.beginPath(); c.arc(cx, cy, SUN_R, 0, 6.2832); c.fill();

        // ── orbits: the other half of the forecast tool ──────────────────
        c.strokeStyle = 'rgba(167,139,250,0.22)';
        c.lineWidth = 1;
        for (var oi = 0; oi < s.planets.length; oi++) {
            c.beginPath(); c.arc(cx, cy, orbitD(g, s.planets[oi]), 0, 6.2832); c.stroke();
        }

        for (var pi = 0; pi < s.planets.length; pi++) {
            var pl = s.planets[pi];
            var toSun = pl.a + Math.PI;
            var grd = c.createRadialGradient(
                pl.x + Math.cos(toSun) * pl.r * 0.5, pl.y + Math.sin(toSun) * pl.r * 0.5, pl.r * 0.15,
                pl.x, pl.y, pl.r * 1.15);
            grd.addColorStop(0, 'hsl(' + pl.hue + ', 55%, 64%)');
            grd.addColorStop(1, 'hsl(' + pl.hue + ', 55%, 15%)');

            if (pl.ring) {
                // back half only — the body will occlude it
                c.save();
                c.translate(pl.x, pl.y); c.rotate(0.5);
                c.strokeStyle = 'hsla(' + pl.hue + ', 60%, 70%, 0.35)';
                c.lineWidth = 3;
                c.beginPath(); c.ellipse(0, 0, pl.r * 1.7, pl.r * 0.55, 0, Math.PI, 6.2832); c.stroke();
                c.restore();
            }

            c.fillStyle = grd;
            c.beginPath(); c.arc(pl.x, pl.y, pl.r, 0, 6.2832); c.fill();

            if (pl.ring) {
                // front half, after the fill, so the ring actually crosses it
                c.save();
                c.translate(pl.x, pl.y); c.rotate(0.5);
                c.strokeStyle = 'hsla(' + pl.hue + ', 65%, 78%, 0.5)';
                c.lineWidth = 3;
                c.beginPath(); c.ellipse(0, 0, pl.r * 1.7, pl.r * 0.55, 0, 0, Math.PI); c.stroke();
                c.restore();
            }

            g.bloom(c, pl.x + Math.cos(toSun) * pl.r * 0.7, pl.y + Math.sin(toSun) * pl.r * 0.7,
                pl.r * 0.9, 'hsla(' + pl.hue + ', 70%, 70%, 0.12)');
        }

        // ── crystals: colour is the price tag ────────────────────────────
        for (var ci = 0; ci < s.crystals.length; ci++) {
            var cr = s.crystals[ci];
            var risky = cr.risky;
            var pulse = 1 + Math.sin(g.t * (risky ? 6.5 : 3) + cr.ph) * (risky ? 0.26 : 0.15);
            g.bloom(c, cr.x, cr.y, (risky ? 24 : 20) * pulse,
                risky ? 'rgba(251,113,133,0.42)' : 'rgba(167,139,250,0.35)');
            c.save();
            c.translate(cr.x, cr.y);
            c.rotate(g.t * (risky ? 2.6 : 1.6) + cr.ph);
            c.fillStyle = risky ? '#ffd7de' : '#e9d5ff';
            c.beginPath();
            c.moveTo(0, -8); c.lineTo(5.5, 0); c.lineTo(0, 8); c.lineTo(-5.5, 0);
            c.closePath(); c.fill();
            c.strokeStyle = risky ? '#fb7185' : 'rgba(167,139,250,0.9)';
            c.lineWidth = 1.4; c.stroke();
            c.restore();

            if (risky) {
                c.save();
                c.font = '600 10px "Space Grotesk", Inter, sans-serif';
                c.textAlign = 'center';
                c.fillStyle = '#fb7185';
                c.globalAlpha = 0.75 + 0.25 * Math.sin(g.t * 6.5 + cr.ph);
                c.fillText('×2.5', cr.x, cr.y - 17);
                c.restore();
            }
        }

        c.save();
        c.globalCompositeOperation = 'lighter';
        for (var pu = 0; pu < s.pulses.length; pu++) {
            var plu = s.pulses[pu];
            var pf = 1 - plu.age / 0.6;
            c.strokeStyle = plu.risky
                ? 'rgba(251,113,133,' + (0.75 * pf) + ')'
                : 'rgba(167,139,250,' + (0.7 * pf) + ')';
            c.lineWidth = 2.5 * pf + 0.5;
            c.beginPath(); c.arc(plu.x, plu.y, plu.r + plu.age * 170, 0, 6.2832); c.stroke();
        }
        c.restore();

        // ── the ship ─────────────────────────────────────────────────────
        var sh = s.ship;
        var va = Math.hypot(sh.vx, sh.vy) > 12 ? Math.atan2(sh.vy, sh.vx) : -1.5708;
        var warm = s.lit ? 1 - (s.grace / (s.graceMax || GRACE)) : 0;
        g.bloom(c, sh.x, sh.y, 22 + warm * 10,
            warm > 0.02 ? 'rgba(251,191,36,' + (0.25 + warm * 0.08) + ')' : 'rgba(167,139,250,0.25)');
        c.save();
        c.translate(sh.x, sh.y);
        c.rotate(va);
        c.fillStyle = mixHex(LILAC, SUNLIT, warm);
        c.beginPath();
        c.moveTo(9, 0); c.lineTo(-7, -6); c.lineTo(-4, 0); c.lineTo(-7, 6);
        c.closePath(); c.fill();
        c.restore();

        /* Shield state, drawn where the eye already is. The sweep is the
           shield you have lost — a full red ring means the next second of
           sunlight ends the run. */
        var deficit = 1 - Math.max(0, Math.min(100, s.shield)) / 100;
        c.save();
        c.strokeStyle = 'rgba(255,255,255,0.09)';
        c.lineWidth = 2;
        c.beginPath(); c.arc(sh.x, sh.y, 17, 0, 6.2832); c.stroke();
        if (deficit > 0.005) {
            var crit = s.shield < 30;
            c.strokeStyle = '#fb7185';
            c.lineWidth = crit ? 3.2 : 2.2;
            c.globalAlpha = crit ? 0.6 + 0.4 * Math.sin(g.t * 8) : 0.55;
            c.lineCap = 'round';
            c.beginPath();
            c.arc(sh.x, sh.y, 17, -1.5708, -1.5708 + deficit * 6.2832);
            c.stroke();
        }
        c.restore();

        /* ── burn vignette, edges only ───────────────────────────────────
           This used to tint the entire frame orange-brown for most of a run,
           which flattened every contrast the game depends on. It now reddens
           the frame's outer ring and leaves the play field alone. */
        if (s.lit || s.shield < 30) {
            var burn = s.lit ? (flaring ? 0.34 : 0.20) : 0;
            if (s.shield < 30) burn = Math.max(burn, 0.22 + Math.sin(g.t * 6) * 0.08);
            var vg = c.createRadialGradient(cx, cy, Math.min(g.w, g.h) * 0.55, cx, cy, Math.max(g.w, g.h) * 0.8);
            vg.addColorStop(0, 'rgba(255,90,40,0)');
            vg.addColorStop(1, 'rgba(255,90,40,' + burn + ')');
            c.fillStyle = vg;
            c.fillRect(0, 0, g.w, g.h);
        }

        drawShieldGauge(g, c, s);
    }

    /** The shield readout as an instrument: labelled, bounded, ticked, and
        with the 30% failure threshold marked on the scale. */
    function drawShieldGauge(g, c, s) {
        var frac = Math.max(0, Math.min(1, s.shield / 100));
        var bw = Math.max(160, Math.min(340, g.w * 0.34));
        var bh = 10;
        var bx = 22;
        var by = g.h - 26;
        var crit = frac < 0.3;

        c.save();
        c.font = '600 10px "Space Grotesk", Inter, sans-serif';
        c.textBaseline = 'alphabetic';
        c.textAlign = 'left';
        c.fillStyle = 'rgba(232,238,252,0.55)';
        c.fillText('SHIELD', bx, by - 7);

        c.textAlign = 'right';
        c.font = '600 12px "Space Grotesk", Inter, sans-serif';
        c.fillStyle = crit ? '#fb7185' : '#e8eefc';
        c.fillText(Math.round(s.shield) + '%', bx + bw, by - 6);

        // track
        roundRect(c, bx, by, bw, bh, bh / 2);
        c.fillStyle = 'rgba(8,10,22,0.55)';
        c.fill();
        c.strokeStyle = 'rgba(232,238,252,0.18)';
        c.lineWidth = 1;
        c.stroke();

        // charge
        if (frac > 0.01) {
            c.save();
            roundRect(c, bx, by, bw, bh, bh / 2);
            c.clip();
            c.fillStyle = crit ? '#fb7185' : '#a78bfa';
            c.fillRect(bx, by, bw * frac, bh);
            c.globalCompositeOperation = 'lighter';
            c.fillStyle = crit ? 'rgba(251,113,133,0.35)' : 'rgba(167,139,250,0.30)';
            c.fillRect(bx + bw * frac - 14, by, 14, bh);
            c.restore();
        }

        // quarter ticks
        c.strokeStyle = 'rgba(232,238,252,0.20)';
        c.lineWidth = 1;
        c.beginPath();
        for (var q = 1; q < 4; q++) {
            var qx = Math.round(bx + bw * (q / 4)) + 0.5;
            c.moveTo(qx, by + 2); c.lineTo(qx, by + bh - 2);
        }
        c.stroke();

        // the one number that matters: 30% is where the frame starts screaming
        var tx = Math.round(bx + bw * 0.3) + 0.5;
        c.strokeStyle = '#fb7185';
        c.lineWidth = 2;
        c.globalAlpha = crit ? 0.55 + 0.45 * Math.sin(g.t * 8) : 0.85;
        c.beginPath();
        c.moveTo(tx, by - 3); c.lineTo(tx, by + bh + 3);
        c.stroke();
        c.globalAlpha = 1;
        c.font = '600 9px "Space Grotesk", Inter, sans-serif';
        c.textAlign = 'center';
        c.fillStyle = 'rgba(251,113,133,0.85)';
        c.fillText('30', tx, by + bh + 12);
        c.restore();
    }

    Arcade.create({
        slug: 'eclipse',
        title: 'ECLIPSE',
        accent: '#a78bfa',
        tagline: 'The Sun sees everything it touches. Planets drag their shadows around their orbits — stay inside the dark cones, follow the dashed lines and arrows to see where the dark is sweeping next, and chain crystals inside four seconds for the bonus.',
        controls: [['WASD / ↑↓←→', 'thrust'], ['HOLD MOUSE', 'fly toward the cursor']],
        scoreLabel: 'SCORE',
        overTitle: 'BURNED',
        winTitle: 'RUN COMPLETE',
        init: init,
        initMenu: init,
        idle: idle,
        update: update,
        draw: draw,
        onResize: function (g) {
            if (g.s && g.s.planets) { sizeLight(g); placePlanets(g); markRisk(g); }
        }
    });
})();

/**
 * Space Junk Katamari — a bolt with ambition.
 *
 * Eat anything smaller than you and grow; touch anything bigger and it knocks a
 * chunk off. Sixty seconds. The comedy is entirely in the rank names, so they
 * are load-bearing: BOLT → ... → MOON is the actual progress bar.
 *
 * Three things carry the feel and all three are structural rather than
 * decorative: the camera pulls back as you grow (a MOON has to fit on screen),
 * the field escalates with the clock instead of staying statistically frozen,
 * and every piece of debris is drawn as its own collision circle so nothing
 * ever shears you with empty space.
 */
(function () {
    'use strict';

    var RUN_S = 60;
    var START_R = 11;
    var FOLLOW = 5.2;           // how hard the blob chases the cursor
    var EAT_MARGIN = 0.94;      // must be this much smaller than you to be eaten
    var DANGER_MARGIN = 1.18;   // must be this much bigger than you to hurt
    var JUNK_N = 220;
    var HUNTER_MAX = 5;
    var TRAIL_N = 20;
    var WALL_NEAR = 200;        // how close to a wall before the boundary lights
    var EMOJI = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    var UI_FONT = '"Space Grotesk", Inter, sans-serif';

    /* One fixed light direction for the whole field. Every rock shades toward
       it, which is what turns 220 separate sprites into one lit scene. */
    var LX = -0.6, LY = -0.8;

    var RANKS = [
        { r: 0,   name: 'BOLT' },
        { r: 16,  name: 'SCREW' },
        { r: 24,  name: 'WRENCH' },
        { r: 34,  name: 'HULL PANEL' },
        { r: 48,  name: 'CUBESAT' },
        { r: 66,  name: 'SATELLITE' },
        { r: 88,  name: 'SPACE STATION' },
        { r: 115, name: 'SMALL MOON' },
        { r: 150, name: 'MOON' }
    ];

    /* The "you did it" bar, named once. It used to be a bare 66 in update()
       while the win card hard-coded the word MOON, so a SATELLITE was
       congratulated as a moon by the headline its own subtitle contradicted. */
    var WIN_RANK = 5;                    // SATELLITE
    var WIN_R = RANKS[WIN_RANK].r;

    var JUNK = ['🔩', '🔧', '🪛', '📡', '🛰️', '🔋', '📻', '🧯', '🪝', '⚙️'];
    var HUNTER_ICONS = ['🛰️', '📡', '🛸'];

    /* ── rock shading, cached ──────────────────────────────────────────────
       Four classes × five lightness buckets = twenty gradient objects for the
       life of the page, instead of one per visible rock per frame (~55 × 60/s).
       Safe to share because the fill is done in the piece's *unit* local frame:
       the draw code scales by j.r and unrotates, so a single gradient running
       along the fixed light vector lands identically on every rock at every
       size and spin. */
    var SHADE = {
        hunter: { h: 18,  s: 80, l: 60, dark: 'hsl(2,58%,17%)',   n: [] },
        danger: { h: 6,   s: 48, l: 55, dark: 'hsl(2,44%,15%)',   n: [] },
        edible: { h: 258, s: 42, l: 66, dark: 'hsl(258,44%,23%)', n: [] },
        inert:  { h: 232, s: 15, l: 55, dark: 'hsl(232,20%,17%)', n: [] }
    };
    var SHADE_BUCKETS = 5;

    function shadeGrad(c, cls, bucket) {
        var def = SHADE[cls];
        var grd = def.n[bucket];
        if (grd) return grd;
        // buckets 0..4 → −4.5 … +4.5 points of lightness, the same spread the
        // per-rock hash used to produce continuously.
        var l = def.l + (bucket - (SHADE_BUCKETS - 1) / 2) * (9 / (SHADE_BUCKETS - 1));
        grd = c.createLinearGradient(LX, LY, -LX, -LY);
        grd.addColorStop(0, 'hsl(' + def.h + ',' + def.s + '%,' + l.toFixed(1) + '%)');
        grd.addColorStop(1, def.dark);
        def.n[bucket] = grd;
        return grd;
    }

    function rankIndex(r) {
        var i = 0;
        for (var k = 0; k < RANKS.length; k++) if (r >= RANKS[k].r) i = k;
        return i;
    }

    function rankOf(r) { return RANKS[rankIndex(r)].name; }

    /* ── world-space particles ─────────────────────────────────────────────
       The shell's own burst() lives in screen space, which is correct for a
       fixed-camera game and wrong for this one: an explosion emitted at the
       wreck would sit still while the world scrolled out from under it. These
       carry world coordinates and get the camera subtracted at draw time, so
       the debris stays where the thing died. */
    function fx(s, x, y, o) {
        var n = o.n || 10;
        for (var i = 0; i < n; i++) {
            var a = Math.random() * 6.2832;
            var sp = (o.speed || 140) * (0.32 + Math.random() * 0.68);
            s.fx.push({
                x: x, y: y,
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                life: (o.life || 0.5) * (0.6 + Math.random() * 0.6), age: 0,
                r: o.size || 2.4,
                col: o.colour || '#d9c6ff',
                spark: !!o.spark,
                drag: o.drag == null ? 1.7 : o.drag
            });
        }
        if (s.fx.length > 460) s.fx.splice(0, s.fx.length - 460);
    }

    function stepFx(s, dt) {
        for (var i = s.fx.length - 1; i >= 0; i--) {
            var p = s.fx[i];
            p.age += dt;
            if (p.age >= p.life) { s.fx.splice(i, 1); continue; }
            p.x += p.vx * dt; p.y += p.vy * dt;
            var d = Math.exp(-p.drag * dt);
            p.vx *= d; p.vy *= d;
        }
    }

    /* ── camera ────────────────────────────────────────────────────────────
       At zoom < 1 the viewport shows more world than the canvas is wide, so
       the clamp has to work in visible-world units or the pulled-back view
       runs off the end of the map. */
    function follow(g, s) {
        var z = s.zoom;
        var hw = g.w / (2 * z), hh = g.h / (2 * z);
        var loX = hw - g.w / 2, hiX = s.worldW - g.w / 2 - hw;
        var loY = hh - g.h / 2, hiY = s.worldH - g.h / 2 - hh;
        s.camX = loX > hiX ? (loX + hiX) / 2 : g.clamp(s.me.x - g.w / 2, loX, hiX);
        s.camY = loY > hiY ? (loY + hiY) / 2 : g.clamp(s.me.y - g.h / 2, loY, hiY);
    }

    /* ── spawning ─────────────────────────────────────────────────────────
       phase runs 0 → 1 across the minute and it is the escalation: sizes
       stretch upward, drift speeds up, and the field the player finishes in
       is nothing like the one they started in. */
    function spawnJunk(g, radiusHint, scatter) {
        var s = g.s;
        var phase = s.phase;
        // Sizes are drawn relative to the player and biased small: squaring a
        // uniform roll puts roughly two thirds of the field below your own size
        // early on. The phase term stretches the top of that range, so late
        // rolls reach far past you.
        var u = Math.random();
        var r = radiusHint * (0.25 + u * u * (1.2 + phase * 1.4));
        r = g.clamp(r, 5, 210);
        var x, y;
        if (scatter) {
            // Opening fill: spread through the whole world. Spawning the first
            // batch at the edges (as later ones do) leaves the player alone in
            // the middle of an empty screen for the first ten seconds.
            x = g.rand(0, s.worldW);
            y = g.rand(0, s.worldH);
            if (g.dist(x, y, s.me.x, s.me.y) < 110) x += 170;  // never start inside the player
        } else {
            var edge = Math.floor(Math.random() * 4);
            x = edge === 0 ? -r - 20 : edge === 1 ? s.worldW + r + 20 : g.rand(0, s.worldW);
            y = edge === 2 ? -r - 20 : edge === 3 ? s.worldH + r + 20 : g.rand(0, s.worldH);
        }
        var drift = 1 + phase * 1.8;
        s.junk.push({
            id: s.nextId++,
            x: x, y: y, r: r,
            vx: g.rand(-26, 26) * drift, vy: g.rand(-26, 26) * drift,
            rot: Math.random() * 6.28, spin: g.rand(-1.6, 1.6),
            icon: g.pickOne(JUNK),
            hunter: false
        });
    }

    /** A piece that wants you. Spawns off the edge of your view and closes. */
    function spawnHunter(g) {
        var s = g.s, me = s.me;
        if (s.hunters >= HUNTER_MAX) return;
        var r = g.clamp(me.r * g.rand(1.25, 1.75), 14, 210);
        var a = Math.random() * 6.2832;
        var d = Math.max(g.w, g.h) * 0.62 + r;
        s.junk.push({
            id: s.nextId++,
            x: g.clamp(me.x + Math.cos(a) * d, r, s.worldW - r),
            y: g.clamp(me.y + Math.sin(a) * d, r, s.worldH - r),
            r: r, vx: 0, vy: 0,
            rot: Math.random() * 6.28, spin: g.rand(-0.9, 0.9),
            icon: g.pickOne(HUNTER_ICONS),
            hunter: true
        });
        s.hunters++;
    }

    function init(g) {
        var s = {
            // 2.6 screens across. The camera pulls back to 0.42 late in the run
            // and a 1.5-screen world would simply run out of map behind it.
            worldW: g.w * 2.6, worldH: g.h * 2.6,
            me: null,
            junk: [],
            stuck: [],
            fx: [],                  // world-space debris (see fx())
            time: RUN_S,
            phase: 0,
            eaten: 0,
            rank: RANKS[0].name,
            camX: 0, camY: 0, zoom: 1,
            hunters: 0, hunterWave: false,
            pulses: [],              // expanding rings on each absorb
            hitFlash: 0,             // red rim timer after a shear
            wallCd: 0,
            pushX: 0, pushY: 0,      // which way the player is steering
            kbdT: 0,                 // 1 while steering on keys, then decays
            nearL: 0, nearR: 0, nearT: 0, nearB: 0,
            trail: [], trailH: 0, trailN: 0,
            nextId: 1, idleT: 0
        };
        s.me = { x: s.worldW * 0.5, y: s.worldH * 0.5, r: START_R, vx: 0, vy: 0 };
        g.s = s;
        // Fixed ring buffer for the motion trail: no per-frame allocations.
        for (var t = 0; t < TRAIL_N; t++) s.trail.push({ x: s.me.x, y: s.me.y });
        for (var i = 0; i < JUNK_N; i++) spawnJunk(g, START_R, true);
        follow(g, s);
    }

    function update(g, dt) {
        var s = g.s;
        var me = s.me;

        s.time -= dt;
        s.phase = g.clamp(1 - s.time / RUN_S, 0, 1);
        if (s.time <= 0) {
            g.flash('TIME', g.accent, 1200);
            // The headline is written from the rank you actually reached, so it
            // can never disagree with the line underneath it.
            var finalRank = rankOf(me.r);
            CFG.winTitle = 'BEHOLD, A ' + finalRank;
            g.over('You finished as a ' + finalRank + ' — ' + s.eaten + ' pieces of junk absorbed.',
                me.r >= WIN_R);
            return;
        }

        // The turn: with twenty seconds left the field stops being scenery.
        if (!s.hunterWave && s.time < 20) {
            s.hunterWave = true;
            var wave = g.randInt(3, 5);
            for (var hw = 0; hw < wave; hw++) spawnHunter(g);
            g.flash('HUNTERS INBOUND', '#ff8b8b', 1100);
            g.sfx('boom');
            g.shake(10);
        }

        // Chase the cursor in world space. The zoom has to be undone here or
        // the blob drifts further from the pointer the further you are from
        // the centre of the screen.
        var z = s.zoom;
        var tx = (g.pointer.x - g.w / 2) / z + g.w / 2 + s.camX;
        var ty = (g.pointer.y - g.h / 2) / z + g.h / 2 + s.camY;

        // Keys replace the pointer target outright. Overwriting one axis left
        // the other still aimed at a cursor the player cannot see (hideCursor),
        // so holding A alone slid the blob diagonally toward the mouse with
        // nothing on screen to explain it. Normalised, so a diagonal is not
        // 1.41× faster than a straight line.
        var kx = 0, ky = 0;
        if (g.key('ArrowLeft') || g.key('KeyA')) kx -= 1;
        if (g.key('ArrowRight') || g.key('KeyD')) kx += 1;
        if (g.key('ArrowUp') || g.key('KeyW')) ky -= 1;
        if (g.key('ArrowDown') || g.key('KeyS')) ky += 1;
        if (kx || ky) {
            var kl = Math.hypot(kx, ky);
            tx = me.x + (kx / kl) * 300;
            ty = me.y + (ky / kl) * 300;
            s.kbdT = 1;
        } else {
            s.kbdT = Math.max(0, s.kbdT - dt * 2.5);
        }

        var pdx = tx - me.x, pdy = ty - me.y;
        var plen = Math.hypot(pdx, pdy) || 1;
        s.pushX = pdx / plen; s.pushY = pdy / plen;

        // Bigger means slower. Without this, growth has no cost and the last
        // twenty seconds are a formality.
        var agility = FOLLOW * (START_R / me.r) * 1.9;
        me.vx += pdx * agility * dt;
        me.vy += pdy * agility * dt;
        var damp = Math.exp(-3.2 * dt);
        me.vx *= damp; me.vy *= damp;
        me.x += me.vx * dt; me.y += me.vy * dt;

        // Soft walls. A hard clamp made the edge of the world an invisible
        // event: you simply stopped, with no cause on screen. Bouncing means
        // contact reads as contact, and the boundary is drawn to match.
        var thump = 0;
        if (me.x - me.r < 0) {
            me.x = me.r; if (me.vx < 0) { thump = -me.vx; me.vx *= -0.4; }
        } else if (me.x + me.r > s.worldW) {
            me.x = s.worldW - me.r; if (me.vx > 0) { thump = me.vx; me.vx *= -0.4; }
        }
        if (me.y - me.r < 0) {
            me.y = me.r; if (me.vy < 0) { thump = Math.max(thump, -me.vy); me.vy *= -0.4; }
        } else if (me.y + me.r > s.worldH) {
            me.y = s.worldH - me.r; if (me.vy > 0) { thump = Math.max(thump, me.vy); me.vy *= -0.4; }
        }
        s.wallCd = Math.max(0, s.wallCd - dt);
        if (thump > 180 && s.wallCd <= 0) {
            s.wallCd = 0.3;
            g.sfx('hit', 0.5);
            g.shake(Math.min(7, thump * 0.012));
            fx(s, me.x, me.y, { n: 9, colour: '#b48bff', speed: 170, life: 0.4, size: 1.5, spark: true });
        }

        s.nearL = g.clamp(1 - (me.x - me.r) / WALL_NEAR, 0, 1);
        s.nearR = g.clamp(1 - (s.worldW - me.r - me.x) / WALL_NEAR, 0, 1);
        s.nearT = g.clamp(1 - (me.y - me.r) / WALL_NEAR, 0, 1);
        s.nearB = g.clamp(1 - (s.worldH - me.r - me.y) / WALL_NEAR, 0, 1);

        // Motion trail: overwrite slots in the fixed ring buffer.
        var tp = s.trail[s.trailH];
        tp.x = me.x; tp.y = me.y;
        s.trailH = (s.trailH + 1) % TRAIL_N;
        if (s.trailN < TRAIL_N) s.trailN++;

        if (s.hitFlash > 0) s.hitFlash = Math.max(0, s.hitFlash - dt);
        for (var pi = s.pulses.length - 1; pi >= 0; pi--) {
            s.pulses[pi].age += dt;
            if (s.pulses[pi].age > 0.6) s.pulses.splice(pi, 1);
        }
        stepFx(s, dt);

        var hunterSpeed = 40 + s.phase * 90;

        for (var i = s.junk.length - 1; i >= 0; i--) {
            var j = s.junk[i];

            if (j.hunter) {
                // Steers, rather than drifts. Slow enough to outrun while you
                // are small and agile; the danger is being cornered.
                var ha = g.angleTo(j.x, j.y, me.x, me.y);
                j.vx += (Math.cos(ha) * hunterSpeed - j.vx) * 1.7 * dt;
                j.vy += (Math.sin(ha) * hunterSpeed - j.vy) * 1.7 * dt;
            }

            j.x += j.vx * dt; j.y += j.vy * dt;
            j.rot += j.spin * dt;

            if (j.hunter) {
                j.x = g.clamp(j.x, j.r, s.worldW - j.r);
                j.y = g.clamp(j.y, j.r, s.worldH - j.r);
            } else if (j.x < -300 || j.x > s.worldW + 300 || j.y < -300 || j.y > s.worldH + 300) {
                s.junk.splice(i, 1);
                continue;
            }

            var d = g.dist(me.x, me.y, j.x, j.y);
            if (d > me.r + j.r) continue;

            if (j.r < me.r * EAT_MARGIN) {
                // Absorb: area adds, so eating small things stops mattering as
                // you grow and you have to go after the scary ones.
                var newArea = me.r * me.r + j.r * j.r * 0.62;
                me.r = Math.sqrt(newArea);
                s.eaten++;
                g.addScore(Math.round(10 + j.r * 3));
                s.stuck.push({ a: Math.random() * 6.2832, d: g.rand(0.55, 0.92), icon: j.icon, size: j.r });
                if (s.stuck.length > 40) s.stuck.shift();
                g.sfx('pick', 1.4 - Math.min(0.8, me.r / 220));
                fx(s, j.x, j.y, { n: 7, colour: '#b48bff', speed: 110, life: 0.4 });
                fx(s, j.x, j.y,
                    { n: 8, colour: '#d9c6ff', speed: 150 + j.r * 2, life: 0.45, size: 1.6, spark: true });
                // Bigger meals ring louder and kick harder, capped at the
                // shakes the game already uses so nothing new out-rattles a shear.
                s.pulses.push({ x: j.x, y: j.y, r: j.r, age: 0 });
                g.shake(Math.min(9, 1 + j.r * 0.18));
                s.junk.splice(i, 1);

                if (j.hunter) {
                    s.hunters--;
                    g.addScore(180);
                    g.flash('HUNTER DOWN', '#ffd9a0', 700);
                    fx(s, j.x, j.y, { n: 16, colour: '#ff9d5c', speed: 260, life: 0.55, size: 1.8, spark: true });
                    g.shake(11);
                    if (s.time > 4) spawnHunter(g);
                }
                spawnJunk(g, me.r);

                var nr = rankOf(me.r);
                if (nr !== s.rank) {
                    s.rank = nr;
                    g.flash(nr, '#b48bff', 1000);
                    g.sfx('win');
                    g.shake(9);
                    fx(s, me.x, me.y, { n: 22, colour: '#e2d4ff', speed: 210 + me.r * 2, life: 0.7, size: 1.7, spark: true });
                }
            } else {
                // Only clearly bigger junk hurts. Without this neutral band,
                // anything within a few percent of your own size punishes you,
                // and the early game is nothing but getting shoved around.
                var lost = j.r > me.r * DANGER_MARGIN ? Math.min(me.r - START_R * 0.6, me.r * 0.10) : 0;
                if (lost > 0.4) {
                    me.r = Math.max(START_R * 0.7, me.r - lost);
                    for (var k = 0; k < 3 && s.stuck.length; k++) s.stuck.pop();
                    g.shake(13);
                    g.sfx('hit');
                    g.flash('SHEARED', '#ff8b8b', 500);
                    fx(s, me.x, me.y, { n: 15, colour: '#ff8b8b', speed: 220, life: 0.55 });
                    fx(s, me.x, me.y,
                        { n: 11, colour: '#ff5d5d', speed: 260, life: 0.5, size: 1.8, spark: true });
                    s.hitFlash = 0.25;
                }
                var a = g.angleTo(j.x, j.y, me.x, me.y);
                me.vx += Math.cos(a) * 340;
                me.vy += Math.sin(a) * 340;
                j.vx -= Math.cos(a) * (j.hunter ? 90 : 40);
                j.vy -= Math.sin(a) * (j.hunter ? 90 : 40);
            }
        }

        while (s.junk.length < JUNK_N) spawnJunk(g, me.r);

        follow(g, s);

        // One number for your size, and it is the rank bar. The old HUD showed
        // a raw radius next to a score labelled MASS — two figures both
        // claiming to be how big you are.
        var ri = rankIndex(me.r);
        var nxt = RANKS[ri + 1];
        var pct = nxt
            ? Math.round(g.clamp((me.r - RANKS[ri].r) / (nxt.r - RANKS[ri].r), 0, 1) * 100)
            : 100;
        g.hud(
            'YOU ARE A <b>' + s.rank + '</b>' +
            '<div style="margin:5px 0 3px;width:190px;height:8px;border-radius:99px;' +
            'background:rgba(255,255,255,0.13);box-shadow:inset 0 0 0 1px rgba(180,139,255,0.28);overflow:hidden">' +
            '<div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,#7c5cff,#e2d4ff)"></div>' +
            '</div>' +
            (nxt ? pct + '% TO <b>' + nxt.name + '</b>' : '<b>MAX RANK — MOON</b>') +
            '<br>ABSORBED <b>' + s.eaten + '</b> · TIME <b>' + s.time.toFixed(1) + 's</b>'
        );
    }

    /** Additive band running inward from one wall of the world. */
    function wallGlow(c, near, x, y, w, h, gx0, gy0, gx1, gy1) {
        var a = 0.22 + 0.38 * near;   // idle 0.22 → 0.60 on contact
        var grd = c.createLinearGradient(gx0, gy0, gx1, gy1);
        grd.addColorStop(0, 'rgba(180,139,255,' + a.toFixed(3) + ')');
        grd.addColorStop(1, 'rgba(180,139,255,0)');
        c.fillStyle = grd;
        c.fillRect(x, y, w, h);
    }

    /** Screen-edge wash in the direction the player is pushing. */
    function vignette(c, W, H, amt, side) {
        if (amt < 0.02) return;
        var D = 190, grd;
        if (side === 0) grd = c.createLinearGradient(0, 0, D, 0);
        else if (side === 1) grd = c.createLinearGradient(W, 0, W - D, 0);
        else if (side === 2) grd = c.createLinearGradient(0, 0, 0, D);
        else grd = c.createLinearGradient(0, H, 0, H - D);
        grd.addColorStop(0, 'rgba(180,139,255,' + (0.34 * amt).toFixed(3) + ')');
        grd.addColorStop(1, 'rgba(180,139,255,0)');
        c.fillStyle = grd;
        if (side === 0) c.fillRect(0, 0, D, H);
        else if (side === 1) c.fillRect(W - D, 0, D, H);
        else if (side === 2) c.fillRect(0, 0, W, D);
        else c.fillRect(0, H - D, W, D);
    }

    function draw(g, c) {
        var s = g.s;
        var me = s.me;

        // The signature Katamari beat: the camera pulls back as you grow, so a
        // MOON is a moon on screen instead of a purple wall.
        var zt = g.clamp(28 / me.r, 0.42, 1);
        s.zoom += (zt - s.zoom) * 0.06;
        var zoom = s.zoom;

        g.space(c, { bg: '#05030f', camX: s.camX, camY: s.camY, par: 0.4 * zoom });

        c.save();
        c.translate(g.w / 2, g.h / 2);
        c.scale(zoom, zoom);
        c.translate(-g.w / 2, -g.h / 2);

        // Visible bounds in pre-scale coordinates: at zoom < 1 there is more
        // world on screen than the canvas is wide, and everything that culls
        // or tiles has to know that.
        var vx0 = (g.w - g.w / zoom) / 2, vx1 = g.w - vx0;
        var vy0 = (g.h - g.h / zoom) / 2, vy1 = g.h - vy0;
        var px = 1 / zoom;   // one device pixel, in world units

        // Parallax grid so movement reads even in empty space — thinned out
        // so the starfield underneath still reads through it.
        c.strokeStyle = 'rgba(180,139,255,0.05)';
        c.lineWidth = px;
        var step = 90;
        var gx = -(s.camX % step); while (gx > vx0) gx -= step;
        for (; gx < vx1; gx += step) {
            c.beginPath(); c.moveTo(gx, vy0); c.lineTo(gx, vy1); c.stroke();
        }
        var gy = -(s.camY % step); while (gy > vy0) gy -= step;
        for (; gy < vy1; gy += step) {
            c.beginPath(); c.moveTo(vx0, gy); c.lineTo(vx1, gy); c.stroke();
        }

        // ── the edge of the world, drawn ─────────────────────────────────
        var bx = -s.camX, by = -s.camY;
        var yTop = Math.max(by, vy0), yBot = Math.min(by + s.worldH, vy1);
        var xLef = Math.max(bx, vx0), xRig = Math.min(bx + s.worldW, vx1);
        c.save();
        c.globalCompositeOperation = 'lighter';
        var BAND = 150;
        if (yBot > yTop) {
            if (bx + BAND > vx0 && bx < vx1) {
                wallGlow(c, s.nearL, bx, yTop, BAND, yBot - yTop, bx, 0, bx + BAND, 0);
            }
            var rx = bx + s.worldW;
            if (rx - BAND < vx1 && rx > vx0) {
                wallGlow(c, s.nearR, rx - BAND, yTop, BAND, yBot - yTop, rx, 0, rx - BAND, 0);
            }
        }
        if (xRig > xLef) {
            if (by + BAND > vy0 && by < vy1) {
                wallGlow(c, s.nearT, xLef, by, xRig - xLef, BAND, 0, by, 0, by + BAND);
            }
            var ry = by + s.worldH;
            if (ry - BAND < vy1 && ry > vy0) {
                wallGlow(c, s.nearB, xLef, ry - BAND, xRig - xLef, BAND, 0, ry, 0, ry - BAND);
            }
        }
        c.restore();
        c.strokeStyle = 'rgba(180,139,255,0.22)';
        c.lineWidth = 2 * px;
        c.strokeRect(bx, by, s.worldW, s.worldH);

        // ── the field ────────────────────────────────────────────────────
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        for (var i = 0; i < s.junk.length; i++) {
            var j = s.junk[i];
            var jx = j.x - s.camX, jy = j.y - s.camY;
            var pad = j.r + 40;
            if (jx < vx0 - pad || jx > vx1 + pad || jy < vy0 - pad || jy > vy1 + pad) continue;

            var edible = j.r < me.r * EAT_MARGIN;
            var dangerous = j.r > me.r * DANGER_MARGIN;
            var cls = j.hunter ? 'hunter' : dangerous ? 'danger' : edible ? 'edible' : 'inert';
            // Five lightness buckets instead of a continuous per-rock hash: the
            // variation still reads, and the gradient can be cached (see SHADE).
            var bucket = Math.min(SHADE_BUCKETS - 1,
                Math.floor(g.hash(j.id * 7.31) * SHADE_BUCKETS));
            var rpx = j.r * zoom;   // this rock's on-screen radius, in device px

            c.save();
            c.translate(jx, jy);
            c.rotate(j.rot);
            // The art IS the hitbox now. An emoji glyph at font = r*1.9 had a
            // silhouette that agreed with the collision circle in neither
            // extent nor aspect, so half the shears came out of empty space.
            g.rockPath(c, j.r, j.id, 7);
            // The path is already baked into device space, so unrotating and
            // scaling to unit size changes only the frame the *gradient* is
            // measured in — which is what lets one cached object fill every rock
            // at any size or spin. The light still comes from one fixed world
            // direction, so the shading holds still while the rock tumbles.
            c.save();
            c.rotate(-j.rot);
            c.scale(j.r, j.r);
            c.fillStyle = shadeGrad(c, cls, bucket);
            c.fill();
            c.restore();
            // "Can I eat this" is the only read that matters, and eleven points
            // of HSL lightness was not carrying it. Edible gets its own rim
            // instead of sharing the field's generic white hairline.
            if (edible) {
                c.strokeStyle = 'rgba(217,198,255,0.75)';
                c.lineWidth = 1.5 * px;
            } else {
                c.strokeStyle = 'rgba(255,255,255,0.13)';
                c.lineWidth = px;
            }
            c.stroke();
            if (rpx > 11) {
                // On top, unclipped, near full alpha. Clipped inside an r-radius
                // polygon at r*1.25 you saw the middle few pixels of a glyph, so
                // the field read as grey asteroid soup rather than space junk.
                c.globalAlpha = 0.85;
                c.fillStyle = '#f2ecff';
                c.font = Math.round(j.r * 0.9) + 'px ' + EMOJI;
                c.fillText(j.icon, 0, 0);
                c.globalAlpha = 1;
            }
            c.restore();

            if (edible && rpx > 4 && g.dist(me.x, me.y, j.x, j.y) < me.r + j.r + 260) {
                // Food within reach gets a breath of light: target acquisition
                // in a field of two hundred objects needs an affordance loud
                // enough to see, and a slow pulse so it reads as an invitation.
                var ba = 0.32 + 0.09 * Math.sin(g.t * 2.1 + j.id * 0.7);
                g.bloom(c, jx, jy, j.r * 2.3, 'rgba(180,139,255,' + ba.toFixed(3) + ')');
            }

            // Red ring means "this one will hurt you", not merely "too big to
            // eat" — marking harmless neighbours as threats teaches fear of the
            // wrong things.
            if (dangerous) {
                c.strokeStyle = j.hunter ? 'rgba(255,157,92,0.6)' : 'rgba(255,139,139,0.45)';
                c.lineWidth = 2 * px;
                c.beginPath(); c.arc(jx, jy, j.r + 3, 0, 6.2832); c.stroke();
                if (j.hunter || g.dist(me.x, me.y, j.x, j.y) < me.r + j.r + 140) {
                    c.globalCompositeOperation = 'lighter';
                    c.strokeStyle = (j.hunter ? 'rgba(255,140,60,' : 'rgba(255,90,90,')
                        + (0.18 + 0.16 * Math.sin(g.t * (j.hunter ? 9 : 6) + i * 1.7)) + ')';
                    c.lineWidth = 3 * px;
                    c.beginPath(); c.arc(jx, jy, j.r + 8, 0, 6.2832); c.stroke();
                    c.globalCompositeOperation = 'source-over';
                }
                if (j.hunter) g.bloom(c, jx, jy, j.r * 2.6, 'rgba(255,120,60,0.22)');
            }
        }

        // Absorb shockwaves: soft rings that expand from every meal.
        c.save();
        c.globalCompositeOperation = 'lighter';
        for (var pu = 0; pu < s.pulses.length; pu++) {
            var pl = s.pulses[pu];
            var pf = 1 - pl.age / 0.6;
            c.strokeStyle = 'rgba(180,139,255,' + (0.6 * pf) + ')';
            c.lineWidth = (2.5 * pf + 0.5) * px;
            c.beginPath();
            c.arc(pl.x - s.camX, pl.y - s.camY, pl.r + pl.age * (140 + pl.r * 2), 0, 6.2832);
            c.stroke();
        }

        // World-space debris, drawn where it happened.
        for (var fi = 0; fi < s.fx.length; fi++) {
            var q = s.fx[fi];
            var qx = q.x - s.camX, qy = q.y - s.camY;
            var al = Math.max(0, 1 - q.age / q.life);
            c.globalAlpha = al;
            if (q.spark) {
                c.strokeStyle = q.col;
                c.lineWidth = Math.max(px, q.r * 0.7);
                c.beginPath();
                c.moveTo(qx, qy);
                c.lineTo(qx - q.vx * 0.03, qy - q.vy * 0.03);
                c.stroke();
            } else {
                c.fillStyle = q.col;
                c.globalAlpha = al * 0.28;
                c.beginPath(); c.arc(qx, qy, q.r * 2.6, 0, 6.2832); c.fill();
                c.globalAlpha = al;
                c.beginPath(); c.arc(qx, qy, q.r, 0, 6.2832); c.fill();
            }
        }
        c.globalAlpha = 1;
        c.restore();

        // ── the blob ─────────────────────────────────────────────────────
        var mx = me.x - s.camX, my = me.y - s.camY;

        // Motion trail: fading additive circles read from the ring buffer,
        // oldest first so the newest sits closest to the blob.
        if (s.trailN > 1) {
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.fillStyle = '#8f6bd8';
            for (var tk = 0; tk < s.trailN; tk++) {
                var tpos = s.trail[(s.trailH - s.trailN + tk + TRAIL_N * 2) % TRAIL_N];
                var tf = (tk + 1) / s.trailN;
                c.globalAlpha = 0.06 * tf;
                c.beginPath();
                c.arc(tpos.x - s.camX, tpos.y - s.camY, me.r * (0.45 + 0.5 * tf), 0, 6.2832);
                c.fill();
            }
            c.restore();
            c.globalAlpha = 1;
        }

        // At r=11 on a near-black field the player was the dimmest thing on
        // screen. Halo, specular and a bright rim make the one object you must
        // track the brightest object in frame.
        g.bloom(c, mx, my, me.r * 3.2, 'rgba(180,139,255,0.42)');

        var body = c.createRadialGradient(mx - me.r * 0.35, my - me.r * 0.4, me.r * 0.08, mx, my, me.r);
        body.addColorStop(0, '#3b2566');
        body.addColorStop(1, '#1c1038');
        c.fillStyle = body;
        c.beginPath(); c.arc(mx, my, me.r, 0, 6.2832); c.fill();

        // Everything it has eaten, stuck to the outside, lit by the same
        // specular pass so the hull reads as one object.
        c.save();
        c.beginPath(); c.arc(mx, my, me.r * 1.35, 0, 6.2832); c.clip();
        for (var k2 = 0; k2 < s.stuck.length; k2++) {
            var st = s.stuck[k2];
            var sa = st.a + g.t * 0.5;
            var ssz = Math.min(st.size, me.r * 0.42);
            var sx = mx + Math.cos(sa) * me.r * st.d;
            var sy = my + Math.sin(sa) * me.r * st.d;
            if (ssz * zoom < 3) continue;
            c.save();
            c.translate(sx, sy);
            c.rotate(sa);
            c.globalAlpha = 0.85;
            c.font = Math.round(ssz * 1.7) + 'px ' + EMOJI;
            c.fillText(st.icon, 0, 0);
            c.restore();
            var w = -Math.sin(sa);
            if (w > 0.9) {
                g.bloom(c, sx, sy, ssz * 1.2 + 6, 'rgba(230,214,255,' + ((w - 0.9) / 0.1 * 0.55) + ')');
            }
        }
        c.globalAlpha = 1;
        c.restore();

        c.save();
        c.beginPath(); c.arc(mx, my, me.r, 0, 6.2832); c.clip();
        var spec = c.createRadialGradient(mx - me.r * 0.45, my - me.r * 0.5, 0, mx, my, me.r * 1.1);
        spec.addColorStop(0, 'rgba(214,190,255,0.9)');
        spec.addColorStop(0.45, 'rgba(180,139,255,0.25)');
        spec.addColorStop(1, 'rgba(180,139,255,0)');
        c.fillStyle = spec;
        c.fillRect(mx - me.r, my - me.r, me.r * 2, me.r * 2);
        c.restore();

        // Counter-rotating inner ring: a small gyroscope that says "this thing
        // is spinning" at any size, including eleven pixels.
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.translate(mx, my);
        c.rotate(-g.t * 0.9);
        c.strokeStyle = 'rgba(217,198,255,0.5)';
        c.lineWidth = Math.max(1.4 * px, me.r * 0.045);
        for (var seg = 0; seg < 6; seg++) {
            var a0 = seg * 1.0472;
            c.beginPath(); c.arc(0, 0, me.r * 0.7, a0, a0 + 0.62); c.stroke();
        }
        c.restore();

        c.strokeStyle = '#d9c6ff';
        c.lineWidth = 3 * px;   // three device pixels at every zoom level
        c.beginPath(); c.arc(mx, my, me.r, 0, 6.2832); c.stroke();

        // Red rim flash while a shear is still stinging.
        if (s.hitFlash > 0) {
            c.globalCompositeOperation = 'lighter';
            c.strokeStyle = 'rgba(255,90,90,' + (s.hitFlash / 0.25 * 0.85) + ')';
            c.lineWidth = 4.5 * px;
            c.beginPath(); c.arc(mx, my, me.r + 2 * px, 0, 6.2832); c.stroke();
            c.globalCompositeOperation = 'source-over';
        }

        c.restore();  // ── end of the zoomed world ──────────────────────────

        // ── screen space ─────────────────────────────────────────────────
        c.save();
        c.globalCompositeOperation = 'lighter';
        // Pressing into a wall you are already against: the screen answers.
        vignette(c, g.w, g.h, Math.max(0, -s.pushX) * s.nearL, 0);
        vignette(c, g.w, g.h, Math.max(0, s.pushX) * s.nearR, 1);
        vignette(c, g.w, g.h, Math.max(0, -s.pushY) * s.nearT, 2);
        vignette(c, g.w, g.h, Math.max(0, s.pushY) * s.nearB, 3);

        // Off-screen hunters get a chevron, so being chased is never a
        // surprise arriving from behind the bezel.
        if (g.running) {
            for (var hi2 = 0; hi2 < s.junk.length; hi2++) {
                var hj = s.junk[hi2];
                if (!hj.hunter) continue;
                var hsx = (hj.x - s.camX - g.w / 2) * zoom + g.w / 2;
                var hsy = (hj.y - s.camY - g.h / 2) * zoom + g.h / 2;
                if (hsx > 30 && hsx < g.w - 30 && hsy > 30 && hsy < g.h - 30) continue;
                var ca = Math.atan2(hsy - g.h / 2, hsx - g.w / 2);
                var cx = g.clamp(hsx, 26, g.w - 26), cy = g.clamp(hsy, 26, g.h - 26);
                c.save();
                c.translate(cx, cy);
                c.rotate(ca);
                c.fillStyle = 'rgba(255,140,60,' + (0.45 + 0.25 * Math.sin(g.t * 7)) + ')';
                c.beginPath();
                c.moveTo(11, 0); c.lineTo(-7, 7); c.lineTo(-7, -7);
                c.closePath(); c.fill();
                c.restore();
            }
        }
        c.restore();

        // Reticle: the OS cursor is hidden, so the thing the blob is chasing
        // has to be drawn — and it fades out while the keys are steering,
        // because then it is not the thing the blob is chasing.
        if (g.running && s.kbdT < 0.97) {
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.strokeStyle = 'rgba(180,139,255,' + (0.6 * (1 - s.kbdT)).toFixed(3) + ')';
            c.lineWidth = 1.4;
            var rr = 8 + Math.sin(g.t * 4) * 1.6;
            c.beginPath(); c.arc(g.pointer.x, g.pointer.y, rr, 0, 6.2832); c.stroke();
            c.beginPath();
            c.moveTo(g.pointer.x - rr - 6, g.pointer.y); c.lineTo(g.pointer.x - rr - 2, g.pointer.y);
            c.moveTo(g.pointer.x + rr + 2, g.pointer.y); c.lineTo(g.pointer.x + rr + 6, g.pointer.y);
            c.stroke();
            c.restore();
        }

        // Last ten seconds: a countdown big enough to feel, faint enough to
        // play through.
        if (g.running && s.time < 10) {
            var secs = Math.ceil(s.time);
            var frac2 = secs - s.time;               // 0 → 1 within each second
            c.save();
            c.globalAlpha = 0.16 * (1 - frac2);
            c.fillStyle = s.time < 5 ? '#ff8b8b' : '#b48bff';
            c.font = '600 ' + Math.round(Math.min(g.w, g.h) * (0.2 + frac2 * 0.06)) + 'px ' + UI_FONT;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText(String(secs), g.w / 2, g.h / 2);
            c.restore();
        }

        c.textAlign = 'left';
        c.textBaseline = 'alphabetic';

        // Timer bar across the bottom of the play area.
        var frac = Math.max(0, s.time / RUN_S);
        c.fillStyle = 'rgba(255,255,255,0.09)';
        c.fillRect(0, g.h - 7, g.w, 7);
        c.fillStyle = frac < 0.2 ? '#ff8b8b' : '#b48bff';
        c.fillRect(0, g.h - 7, g.w * frac, 7);
        if (s.hunterWave && g.running) {
            // The twenty-second mark, marked.
            c.fillStyle = 'rgba(255,157,92,0.75)';
            c.fillRect(g.w * (20 / RUN_S) - 1, g.h - 11, 2, 11);
        }
    }

    /* The menu used to be a freeze-frame with a starfield behind it. This
       drifts the whole field and walks the blob, so the mechanic is legible
       before anyone presses PLAY — and the last scene of a finished run keeps
       breathing behind the score card. */
    function idle(g, dt) {
        var s = g.s;
        if (!s || !s.me) return;
        var me = s.me;
        s.idleT += dt;
        var t = s.idleT;

        var tx = s.worldW * 0.5 + Math.cos(t * 0.21) * g.w * 0.34;
        var ty = s.worldH * 0.5 + Math.sin(t * 0.16) * g.h * 0.3;
        var k = Math.min(1, dt * 0.8);
        me.x += (tx - me.x) * k;
        me.y += (ty - me.y) * k;

        var tp = s.trail[s.trailH];
        tp.x = me.x; tp.y = me.y;
        s.trailH = (s.trailH + 1) % TRAIL_N;
        if (s.trailN < TRAIL_N) s.trailN++;

        for (var i = 0; i < s.junk.length; i++) {
            var j = s.junk[i];
            j.x += j.vx * dt * 0.6;
            j.y += j.vy * dt * 0.6;
            j.rot += j.spin * dt * 0.6;
            if (j.x < -220) j.x += s.worldW + 440;
            else if (j.x > s.worldW + 220) j.x -= s.worldW + 440;
            if (j.y < -220) j.y += s.worldH + 440;
            else if (j.y > s.worldH + 220) j.y -= s.worldH + 440;
        }

        for (var pi = s.pulses.length - 1; pi >= 0; pi--) {
            s.pulses[pi].age += dt;
            if (s.pulses[pi].age > 0.6) s.pulses.splice(pi, 1);
        }
        if (s.hitFlash > 0) s.hitFlash = Math.max(0, s.hitFlash - dt);
        stepFx(s, dt);
        follow(g, s);
    }

    /* Held in a variable so the run can rewrite winTitle before g.over(): the
       shell reads cfg.winTitle at the moment the card is filled in. */
    var CFG = {
        slug: 'junk-katamari',
        title: 'SPACE JUNK KATAMARI',
        accent: '#b48bff',
        tagline: 'You are a runaway bolt. Roll into anything smaller and it sticks to you. Anything ringed in red is bigger than you and will shear pieces off. The camera pulls back as you grow — and with twenty seconds left, some of the junk starts hunting.',
        controls: [
            ['MOUSE', 'the blob chases your cursor'],
            ['TOUCH', 'drag with your finger down — it only follows while held'],
            ['WASD / ↑←↓→', 'steer instead']
        ],
        scoreLabel: 'SALVAGE',
        overTitle: 'TIME UP',
        // Placeholder only — update() overwrites this with the rank actually
        // reached, so the headline can never contradict the note under it.
        winTitle: 'BEHOLD, A ' + RANKS[WIN_RANK].name,
        hideCursor: true,
        init: init,
        initMenu: init,
        idle: idle,
        update: update,
        draw: draw
    };

    Arcade.create(CFG);
})();

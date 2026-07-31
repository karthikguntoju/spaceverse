/**
 * Slingshot Golf — nine holes, gravity does the putting.
 *
 * Grab the ball, pull back, release: everything after the release is physics.
 * The course is generated per run, so the nine holes are never the same twice,
 * and the gravity field is drawn rather than implied — you read the flow lines
 * and the contour rings instead of guessing what the halo means.
 *
 * Two input paths, one aim model. Pointer drags and arrow keys both write to
 * {aimAngle, aimPower}; the ghost preview, the charge bloom and the power arc
 * are driven off that pair, so a keyboard-only player gets the identical read.
 */
(function () {
    'use strict';

    var HOLES = 9;
    var G = 5200;
    var MAX_POWER = 620;
    var STEP = 1 / 120;             // fixed physics step: a slow frame cannot change a shot
    var DRAG_RANGE = 190;           // px of pull-back that equals full power
    var ARM_RADIUS = 90;            // you have to grab the ball, not just click the void
    var GHOST_SAMPLES = 45;         // roughly the first third of a flight
    var GHOST_DT = STEP * 2.2;
    var SOI = 2.4;                  // sphere of influence, in planet radii
    var PREVIEWS_PER_HOLE = 3;
    var SETTLE_MAX = 6;             // hard cap on watching a ball orbit with no input
    var FIELD_COLS = 40, FIELD_ROWS = 24;
    var ROT_BASE = 1.4;             // rad/s, before the held-key acceleration
    var POW_RATE = 0.8;             // power units/s on Up/Down
    var FONT = '600 %spx "Space Grotesk", Inter, sans-serif';

    function font(px) { return FONT.replace('%s', px); }

    /* ── course generation ────────────────────────────────────────────── */

    // Small deterministic generator. The seed is per RUN now, not per build,
    // so a course is reproducible within a run and fresh on the next one.
    function seeded(seed) {
        var s = seed >>> 0;
        return function () {
            s = (s * 1664525 + 1013904223) >>> 0;
            return s / 4294967296;
        };
    }

    /** Stable seed for "today" — same course for everyone on the same date. */
    function dailySeed() {
        var d = new Date();
        var n = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
        return (n * 2654435761) >>> 0;
    }

    /** ?daily in the URL locks the course to the date; otherwise every run is new. */
    function newRunSeed() {
        if (/[?&]daily(=|&|$)/.test(window.location.search)) return dailySeed();
        return (((Math.random() * 4294967296) >>> 0) ^ (Date.now() & 0xffffffff)) >>> 0;
    }

    /** What the hole index unlocks. Holes 1-3 teach pull, 4-6 add push, 7-9 add timing. */
    function holeFeature(n) {
        if (n >= 6) return 'MOVING PLANET';
        if (n >= 3) return 'REPULSORS';
        return 'PULL ONLY';
    }

    function buildHole(g, n, runSeed) {
        var rnd = seeded((runSeed + n * 7919) >>> 0);
        var W = g.w, H = g.h;
        var hole = {
            tee: { x: W * 0.13, y: H * (0.3 + rnd() * 0.4) },
            cup: { x: W * (0.76 + rnd() * 0.14), y: H * (0.22 + rnd() * 0.56), r: 22 },
            planets: [],
            par: 2 + Math.floor(n / 3),
            hasMover: false,
            feature: holeFeature(n)
        };
        var allowRepel = n >= 3;
        var count = 1 + Math.floor(n / 2);
        var i;
        for (i = 0; i < count; i++) {
            var r = 26 + rnd() * (34 + n * 3);
            var px = W * (0.30 + rnd() * 0.40);
            var py = H * (0.15 + rnd() * 0.70);
            var repelRoll = rnd();
            var hue = 200 + Math.floor(rnd() * 120);
            // Keep planets clear of the tee and the cup, or a hole can be impossible.
            if (g.dist(px, py, hole.tee.x, hole.tee.y) < r + 120) px += 160;
            if (g.dist(px, py, hole.cup.x, hole.cup.y) < r + 90) px -= 130;
            var repel = allowRepel && repelRoll < 0.32;
            hole.planets.push({
                x: px, y: py, r: r,
                mass: r * (repel ? -1.1 : 1),
                hue: repel ? 340 : hue,
                // Cosmetic only, and deliberately NOT drawn from rnd(): pulling
                // another sample would reshuffle every hole after this one.
                ring: g.hash(n * 91.7 + i * 37.3) < 0.3,
                orbit: null
            });
        }

        // Holes 7-9 put one planet on rails. The ghost preview only ever shows a
        // snapshot, so a moving well turns the shot into a question of when.
        if (n >= 6) {
            var mi = Math.floor(rnd() * hole.planets.length);
            var mp = hole.planets[mi];
            if (mp.mass < 0) { mp.mass = -mp.mass; mp.hue = 200 + Math.floor(rnd() * 120); }
            var rad = 60 + rnd() * 95;
            var cx = mp.x, cy = mp.y;
            // Shrink the orbit until the planet cannot sit on the cup or the tee.
            for (var t = 0; t < 7; t++) {
                var clearCup = Math.abs(g.dist(cx, cy, hole.cup.x, hole.cup.y) - rad) > mp.r + hole.cup.r + 30;
                var clearTee = Math.abs(g.dist(cx, cy, hole.tee.x, hole.tee.y) - rad) > mp.r + 50;
                if (clearCup && clearTee) break;
                rad *= 0.72;
            }
            mp.orbit = { cx: cx, cy: cy, rad: rad, ang: rnd() * 6.2832, spd: 0.3 + rnd() * 0.35 };
            mp.x = cx + Math.cos(mp.orbit.ang) * rad;
            mp.y = cy + Math.sin(mp.orbit.ang) * rad;
            hole.hasMover = true;
        }
        return hole;
    }

    /* ── the gravity field, made visible ──────────────────────────────────
       A grid of net-acceleration samples, built once per hole (and refreshed
       at 8Hz on holes with a mover). Drawn as two batched paths so 960 hairs
       cost two strokes, not 960. */
    function buildField(g) {
        var s = g.s;
        var pls = s.data.planets;
        var cells = [];
        var sx = g.w / FIELD_COLS, sy = g.h / FIELD_ROWS;
        for (var iy = 0; iy < FIELD_ROWS; iy++) {
            for (var ix = 0; ix < FIELD_COLS; ix++) {
                var x = (ix + 0.5) * sx, y = (iy + 0.5) * sy;
                var ax = 0, ay = 0, nd = 1e9, rep = false;
                for (var i = 0; i < pls.length; i++) {
                    var pl = pls[i];
                    var dx = pl.x - x, dy = pl.y - y;
                    var d2 = Math.max(900, dx * dx + dy * dy);
                    var d = Math.sqrt(d2);
                    if (d - pl.r < nd) { nd = d - pl.r; rep = pl.mass < 0; }
                    var f = (G * pl.mass) / d2;
                    ax += (dx / d) * f; ay += (dy / d) * f;
                }
                if (nd < 6) continue;                       // inside a body: nothing to show
                var m = Math.hypot(ax, ay);
                if (m < 0.35) continue;                     // too weak to read as anything
                var len = Math.min(16, 2 + m * 0.55);
                cells.push({ x: x, y: y, dx: (ax / m) * len, dy: (ay / m) * len, rep: rep });
            }
        }
        s.field = cells;
        s.fieldT = g.t;
    }

    function maybeRebuildField(g) {
        var s = g.s;
        if (!s.data.hasMover) return;
        if (g.t - s.fieldT < 0.12) return;
        buildField(g);
    }

    /* ── state ────────────────────────────────────────────────────────── */

    function seedAim(g) {
        var s = g.s;
        s.aimAngle = g.angleTo(s.ball.x, s.ball.y, s.data.cup.x, s.data.cup.y);
        s.aimPower = 0.55;
        s.rotHold = 0;
    }

    function resetBall(g) {
        var s = g.s;
        s.ball = { x: s.data.tee.x, y: s.data.tee.y, vx: 0, vy: 0 };
        s.trail.length = 0;
        s.settle = 0;
        s.acc = 0;
        s.flying = false;
    }

    function init(g) {
        var seed = newRunSeed();
        g.s = {
            runSeed: seed,
            daily: /[?&]daily(=|&|$)/.test(window.location.search),
            hole: 0, strokes: 0, total: 0, par: 0,
            data: null,
            ball: { x: 0, y: 0, vx: 0, vy: 0 },
            flying: false,
            trail: [], trailN: 0,
            ghost: [], ghostEnd: null,
            previewCharges: PREVIEWS_PER_HOLE, previewUsed: false,
            arming: false, inputMode: 'pointer',
            aimAngle: 0, aimPower: 0.55, rotHold: 0,
            settle: 0, acc: 0, done: false,
            pulses: [],
            field: [], fieldT: -9,
            baseW: g.w, baseH: g.h,
            demoWait: 0.5
        };
        g.s.data = buildHole(g, 0, seed);
        resetBall(g);
        seedAim(g);
        buildField(g);
        g.setScore(0);
    }

    /* ── aiming: one model, two input paths ───────────────────────────── */

    function aimVector(g) {
        var s = g.s;
        if (s.inputMode === 'key') {
            var pw = s.aimPower;
            return {
                angle: s.aimAngle, power: pw,
                vx: Math.cos(s.aimAngle) * pw * MAX_POWER,
                vy: Math.sin(s.aimAngle) * pw * MAX_POWER
            };
        }
        // Pointer: the launch vector points AWAY from the pointer, like a sling.
        var dx = s.ball.x - g.pointer.x, dy = s.ball.y - g.pointer.y;
        var len = Math.hypot(dx, dy);
        if (len < 1) return { angle: s.aimAngle, power: 0, vx: 0, vy: 0 };
        var power = Math.min(len, DRAG_RANGE) / DRAG_RANGE;
        return {
            angle: Math.atan2(dy, dx), power: power,
            vx: (dx / len) * power * MAX_POWER,
            vy: (dy / len) * power * MAX_POWER
        };
    }

    /** Is the player currently lining a shot up? Drives ghost, bloom and arc. */
    function aimActive(g) {
        var s = g.s;
        if (s.flying) return false;
        if (s.inputMode === 'key') return true;
        return s.arming && g.pointer.down;
    }

    function aimTick(g, dt) {
        var s = g.s;
        if (s.flying) { s.rotHold = 0; return; }
        var left = g.key('ArrowLeft') || g.key('KeyA');
        var right = g.key('ArrowRight') || g.key('KeyD');
        var up = g.key('ArrowUp') || g.key('KeyW');
        var down = g.key('ArrowDown') || g.key('KeyS');

        if (left !== right) {
            // Accelerates while held: a tap nudges, a hold sweeps.
            s.rotHold += dt;
            var rate = ROT_BASE * (1 + Math.min(s.rotHold * 1.6, 2));
            s.aimAngle = g.wrapAngle(s.aimAngle + (right ? 1 : -1) * rate * dt);
            s.inputMode = 'key';
        } else {
            s.rotHold = 0;
        }
        if (up !== down) {
            s.aimPower = g.clamp(s.aimPower + (up ? 1 : -1) * POW_RATE * dt, 0, 1);
            s.inputMode = 'key';
        }
        // Keep the keyboard aim in step with the drag, so switching hands mid-hole
        // does not snap the shot somewhere else.
        if (s.inputMode === 'pointer' && s.arming && g.pointer.down) {
            var a = aimVector(g);
            if (a.power > 0.02) { s.aimAngle = a.angle; s.aimPower = a.power; }
        }
    }

    /* ── physics ──────────────────────────────────────────────────────── */

    /** One physics step, shared by the live ball and the dotted preview. */
    function step(g, p, dt) {
        var pls = g.s.data.planets;
        for (var i = 0; i < pls.length; i++) {
            var pl = pls[i];
            var dx = pl.x - p.x, dy = pl.y - p.y;
            var d2 = Math.max(400, dx * dx + dy * dy);
            var d = Math.sqrt(d2);
            var f = (G * pl.mass) / d2;
            p.vx += (dx / d) * f * dt;
            p.vy += (dy / d) * f * dt;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
    }

    /** Orbiting planets advance on the same fixed step as the ball. */
    function advancePlanets(g, h) {
        var pls = g.s.data.planets;
        for (var i = 0; i < pls.length; i++) {
            var o = pls[i].orbit;
            if (!o) continue;
            o.ang += o.spd * h;
            pls[i].x = o.cx + Math.cos(o.ang) * o.rad;
            pls[i].y = o.cy + Math.sin(o.ang) * o.rad;
        }
    }

    function endDemo(g, wait) {
        var s = g.s;
        resetBall(g);
        s.demoWait = wait;
    }

    function demoNextHole(g) {
        var s = g.s;
        s.hole = (s.hole + 1) % HOLES;
        s.data = buildHole(g, s.hole, s.runSeed);
        resetBall(g);
        buildField(g);
        s.demoWait = 1.1;
    }

    /** Returns true when the shot ended and the caller must stop stepping. */
    function physicsTick(g, h, demo) {
        var s = g.s, i, p;
        step(g, s.ball, h);
        s.settle += h;

        s.trailN++;
        if (s.trailN % 2 === 0) {
            s.trail.push({ x: s.ball.x, y: s.ball.y });
            if (s.trail.length > 240) s.trail.shift();
        }

        for (i = 0; i < s.data.planets.length; i++) {
            p = s.data.planets[i];
            if (p.mass <= 0) continue;              // repulsors are shells: you fly through
            if (g.dist(s.ball.x, s.ball.y, p.x, p.y) < p.r + 5) {
                s.flying = false;
                g.burst(s.ball.x, s.ball.y, { n: demo ? 10 : 16, colour: '#ff8b8b', speed: 190, shape: 'spark' });
                if (demo) { endDemo(g, 0.9); return true; }
                g.sfx('hit'); g.shake(8);
                g.flash('CRASHED — +1 STROKE', '#ff8b8b', 800);
                s.strokes++;
                resetBall(g);
                return true;
            }
        }

        var cup = s.data.cup;
        if (g.dist(s.ball.x, s.ball.y, cup.x, cup.y) < cup.r &&
            Math.hypot(s.ball.vx, s.ball.vy) < 700) {
            s.flying = false;
            g.sfx('win');
            g.burst(cup.x, cup.y, { n: 34, colour: g.accent, speed: 260, life: 0.9 });
            g.burst(cup.x, cup.y, { n: 16, colour: '#d9ffe1', speed: 360, life: 0.55, shape: 'spark' });
            s.pulses.push({ x: cup.x, y: cup.y, r: cup.r, age: 0 });
            if (demo) { demoNextHole(g); return true; }
            var d = s.strokes - s.data.par;
            g.flash(d <= -2 ? 'EAGLE' : d === -1 ? 'BIRDIE' : d === 0 ? 'PAR' : 'BOGEY +' + d, g.accent, 1100);
            nextHole(g);
            return true;
        }

        var out = s.ball.x < -80 || s.ball.x > g.w + 80 || s.ball.y < -80 || s.ball.y > g.h + 80;
        if (out || s.settle > SETTLE_MAX) {
            s.flying = false;
            if (demo) { endDemo(g, 0.7); return true; }
            g.flash(out ? 'LOST IN SPACE — +1 STROKE' : 'STALLED — +1 STROKE', '#ff8b8b', 900);
            g.sfx('lose');
            s.strokes++;
            resetBall(g);
            return true;
        }
        return false;
    }

    /** True fixed-timestep accumulator: every step is exactly STEP, leftover carried. */
    function runSteps(g, dt, demo) {
        var s = g.s;
        s.acc += dt;
        if (s.acc > 0.2) s.acc = 0.2;               // no spiral of death after a tab switch
        var guard = 0;
        while (s.acc >= STEP && guard++ < 40) {
            s.acc -= STEP;
            advancePlanets(g, STEP);
            if (s.flying && physicsTick(g, STEP, demo)) return true;
        }
        return false;
    }

    /* ── the preview ──────────────────────────────────────────────────────
       Deliberately short and deliberately rationed. It shows the launch arc up
       to the first gravity well and then stops: past that point you are reading
       the field, not tracing a line. Three charges a hole. */
    function updateGhost(g) {
        var s = g.s;
        s.ghost.length = 0;
        s.ghostEnd = null;
        if (!aimActive(g) || s.previewCharges <= 0) return;
        var aim = aimVector(g);
        if (aim.power < 0.05) return;

        var pls = s.data.planets;
        var armed = [];
        var k;
        for (k = 0; k < pls.length; k++) {
            armed.push(g.dist(s.ball.x, s.ball.y, pls[k].x, pls[k].y) > pls[k].r * SOI);
        }

        var probe = { x: s.ball.x, y: s.ball.y, vx: aim.vx, vy: aim.vy };
        for (var i = 0; i < GHOST_SAMPLES; i++) {
            step(g, probe, GHOST_DT);
            s.ghost.push({ x: probe.x, y: probe.y, a: 1 - i / GHOST_SAMPLES });
            for (k = 0; k < pls.length; k++) {
                if (!armed[k]) continue;
                var soi = pls[k].r * SOI;
                if (g.dist(probe.x, probe.y, pls[k].x, pls[k].y) < soi) {
                    s.ghostEnd = { x: probe.x, y: probe.y, r: soi, px: pls[k].x, py: pls[k].y, rep: pls[k].mass < 0 };
                    s.previewUsed = true;
                    return;
                }
            }
            if (probe.x < -60 || probe.x > g.w + 60 || probe.y < -60 || probe.y > g.h + 60) break;
        }
        s.previewUsed = true;
    }

    /* ── shots ────────────────────────────────────────────────────────── */

    function fire(g) {
        var s = g.s;
        if (!s || s.flying || s.done) return;
        var aim = aimVector(g);
        if (aim.power < 0.06) return;
        s.ball.vx = aim.vx; s.ball.vy = aim.vy;
        s.flying = true;
        s.strokes++;
        s.settle = 0;
        s.acc = 0;
        s.arming = false;
        if (s.previewUsed && s.previewCharges > 0) {
            s.previewCharges--;
            if (s.previewCharges === 0) g.flash('NO PREVIEW LEFT — READ THE FIELD', '#ffd08a', 900);
        }
        s.previewUsed = false;
        s.ghost.length = 0; s.ghostEnd = null;
        g.sfx('thrust', 1 + aim.power);
        g.burst(s.ball.x, s.ball.y, {
            n: 10, colour: '#8dffa0', speed: 120 + aim.power * 180,
            life: 0.4, shape: 'spark', angle: aim.angle, spread: 0.5
        });
    }

    function recall(g) {
        var s = g.s;
        if (!s || !s.flying || s.done) return;
        s.flying = false;
        s.strokes++;
        g.sfx('lose');
        g.flash('RECALLED — +1 STROKE', '#ff8b8b', 800);
        resetBall(g);
    }

    function nextHole(g) {
        var s = g.s;
        s.total += s.strokes;
        s.par += s.data.par;
        s.hole++;
        if (s.hole >= HOLES) {
            s.done = true;
            var diff = s.total - s.par;
            // Score rewards being under par; the raw stroke count is the honest number.
            g.setScore(Math.max(0, 5000 - s.total * 90 + Math.max(0, -diff) * 400));
            g.over('Nine holes in ' + s.total + ' strokes (par ' + s.par + ', ' +
                (diff === 0 ? 'level par' : diff > 0 ? '+' + diff : diff) + ').', diff <= 0);
            return;
        }
        s.data = buildHole(g, s.hole, s.runSeed);
        s.strokes = 0;
        s.previewCharges = PREVIEWS_PER_HOLE;
        s.previewUsed = false;
        resetBall(g);
        seedAim(g);
        buildField(g);
        g.flash('HOLE ' + (s.hole + 1) + ' · PAR ' + s.data.par + ' · ' + s.data.feature, g.accent, 1200);
    }

    /* ── input hooks ──────────────────────────────────────────────────── */

    function pointerDown(g) {
        var s = g.s;
        if (!s || !s.data || s.done || s.flying) return;
        // A click in the void is not a stroke: you have to grab the ball.
        if (g.dist(g.pointer.x, g.pointer.y, s.ball.x, s.ball.y) < ARM_RADIUS) {
            s.arming = true;
            s.inputMode = 'pointer';
            g.sfx('blip', 0.8);
        } else {
            s.arming = false;
            g.sfx('tick', 0.7);
        }
    }

    function pointerUp(g) {
        var s = g.s;
        if (!s || !s.data) return;
        if (!s.arming) return;                       // never fire from an unarmed drag
        s.arming = false;
        fire(g);
    }

    function keyDown(g, code) {
        var s = g.s;
        if (!g.running || !s || !s.data || s.done) return;
        if (code === 'Space' || code === 'Enter') { fire(g); return; }
        if (code === 'KeyR') { recall(g); return; }
        if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown' ||
            code === 'KeyA' || code === 'KeyD' || code === 'KeyW' || code === 'KeyS') {
            if (s.inputMode !== 'key') { s.inputMode = 'key'; s.arming = false; }
            s.rotHold = 0;
        }
    }

    function keyUp(g, code) {
        var s = g.s;
        if (!s || !s.data) return;
        if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'KeyA' || code === 'KeyD') s.rotHold = 0;
    }

    /* ── update ───────────────────────────────────────────────────────── */

    function decayPulses(g, dt) {
        var s = g.s;
        for (var i = s.pulses.length - 1; i >= 0; i--) {
            s.pulses[i].age += dt;
            if (s.pulses[i].age > 0.6) s.pulses.splice(i, 1);
        }
    }

    function hudHtml(g) {
        var s = g.s;
        var dots = '';
        for (var i = 0; i < PREVIEWS_PER_HOLE; i++) dots += (i < s.previewCharges ? '●' : '○');
        var line = 'HOLE <b>' + (s.hole + 1) + '/' + HOLES + '</b> · PAR <b>' + s.data.par +
            '</b> · <b>' + s.data.feature + '</b><br>' +
            'STROKES <b>' + s.strokes + '</b> · TOTAL <b>' + (s.total + s.strokes) + '</b><br>' +
            'PREVIEW <b>' + dots + '</b> · AIM <b>' + (s.inputMode === 'key' ? 'KEYS' : 'DRAG') + '</b>';
        if (s.flying) {
            line += '<br>R RECALL · <b>' + Math.ceil(Math.max(0, SETTLE_MAX - s.settle)) + 's</b>';
        }
        return line;
    }

    function update(g, dt) {
        var s = g.s;
        if (s.done) return;
        decayPulses(g, dt);
        aimTick(g, dt);
        runSteps(g, dt, false);
        if (s.done) return;
        maybeRebuildField(g);
        updateGhost(g);
        g.hud(hudHtml(g));
    }

    /** Menu / game-over scene: the course plays itself behind the glass. */
    function idle(g, dt) {
        var s = g.s;
        if (!s || !s.data) return;
        decayPulses(g, dt);
        s.previewCharges = PREVIEWS_PER_HOLE;
        s.inputMode = 'key';
        if (!s.flying) {
            s.demoWait -= dt;
            s.aimAngle = g.angleTo(s.ball.x, s.ball.y, s.data.cup.x, s.data.cup.y) + Math.sin(g.t * 0.6) * 0.45;
            s.aimPower = 0.58 + Math.sin(g.t * 0.9) * 0.22;
            if (s.demoWait <= 0) {
                var aim = aimVector(g);
                s.ball.vx = aim.vx; s.ball.vy = aim.vy;
                s.flying = true;
                s.settle = 0; s.acc = 0;
                s.trail.length = 0;
            }
        }
        runSteps(g, dt, true);
        maybeRebuildField(g);
        updateGhost(g);
    }

    /* ── resize ───────────────────────────────────────────────────────────
       buildHole bakes the viewport in, so without this a resize can leave the
       cup off-screen mid-round. Rescale everything, including the live ball. */
    function onResize(g) {
        var s = g.s;
        if (!s || !s.data || !s.baseW || !s.baseH) return;
        var sx = g.w / s.baseW, sy = g.h / s.baseH;
        if (!isFinite(sx) || !isFinite(sy) || sx <= 0 || sy <= 0) return;
        s.baseW = g.w; s.baseH = g.h;
        if (Math.abs(sx - 1) < 0.0005 && Math.abs(sy - 1) < 0.0005) return;

        var d = s.data, i;
        d.tee.x *= sx; d.tee.y *= sy;
        d.cup.x *= sx; d.cup.y *= sy;
        for (i = 0; i < d.planets.length; i++) {
            var p = d.planets[i];
            p.x *= sx; p.y *= sy;
            if (p.orbit) {
                p.orbit.cx *= sx; p.orbit.cy *= sy;
                p.orbit.rad *= Math.min(sx, sy);
            }
        }
        s.ball.x *= sx; s.ball.y *= sy;
        s.ball.vx *= sx; s.ball.vy *= sy;
        for (i = 0; i < s.trail.length; i++) { s.trail[i].x *= sx; s.trail[i].y *= sy; }
        for (i = 0; i < s.pulses.length; i++) { s.pulses[i].x *= sx; s.pulses[i].y *= sy; }
        buildField(g);
    }

    /* ── drawing ──────────────────────────────────────────────────────── */

    function powerColour(p) {
        var hue = p < 0.55 ? 140 - (p / 0.55) * 95 : 45 - ((p - 0.55) / 0.45) * 45;
        return 'hsl(' + Math.round(hue) + ',90%,' + Math.round(58 + (1 - p) * 6) + '%)';
    }

    function roundRect(c, x, y, w, h, r) {
        c.beginPath();
        c.moveTo(x + r, y);
        c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r);
        c.lineTo(x + w, y + h - r); c.arcTo(x + w, y + h, x + w - r, y + h, r);
        c.lineTo(x + r, y + h); c.arcTo(x, y + h, x, y + h - r, r);
        c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r);
        c.closePath();
    }

    /** Net-acceleration hairs. Two batched paths, one per sign. */
    function drawField(g, c) {
        var s = g.s;
        if (!s.field.length) return;
        c.save();
        c.lineWidth = 1.2;
        c.lineCap = 'round';
        for (var pass = 0; pass < 2; pass++) {
            var any = false;
            c.beginPath();
            for (var i = 0; i < s.field.length; i++) {
                var f = s.field[i];
                if ((f.rep ? 1 : 0) !== pass) continue;
                any = true;
                // Off-centre so the head sits in the direction of the pull.
                c.moveTo(f.x - f.dx * 0.35, f.y - f.dy * 0.35);
                c.lineTo(f.x + f.dx * 0.65, f.y + f.dy * 0.65);
            }
            if (any) {
                c.strokeStyle = pass ? 'rgba(255,139,167,0.10)' : 'rgba(141,255,160,0.10)';
                c.stroke();
            }
        }
        c.restore();
    }

    /** Dashed equipotentials. Dashes crawl inward on pullers, outward on pushers. */
    function drawContours(g, c) {
        var s = g.s;
        var mult = [1.6, 2.4, 3.4];
        c.save();
        c.lineWidth = 1;
        c.setLineDash([6, 8]);
        for (var i = 0; i < s.data.planets.length; i++) {
            var p = s.data.planets[i];
            var rep = p.mass < 0;
            c.lineDashOffset = rep ? g.t * 18 : -g.t * 18;
            for (var k = 0; k < 3; k++) {
                var a = 0.30 - k * 0.07;
                c.strokeStyle = rep
                    ? 'rgba(255,139,167,' + a + ')'
                    : 'hsla(' + p.hue + ',80%,72%,' + a + ')';
                c.beginPath();
                c.arc(p.x, p.y, p.r * mult[k], 0, 6.2832);
                c.stroke();
            }
        }
        c.restore();
    }

    function drawPlanets(g, c) {
        var s = g.s;
        for (var i = 0; i < s.data.planets.length; i++) {
            var p = s.data.planets[i];
            var repel = p.mass < 0;

            // The rail a moving planet runs on, so timing is something you can see.
            if (p.orbit) {
                c.save();
                c.strokeStyle = 'rgba(232,238,252,0.16)';
                c.setLineDash([3, 8]); c.lineWidth = 1;
                c.lineDashOffset = -g.t * 26;
                c.beginPath(); c.arc(p.orbit.cx, p.orbit.cy, p.orbit.rad, 0, 6.2832); c.stroke();
                c.restore();
            }

            var haloR = p.r * 3.2 * (repel ? 1 + 0.06 * Math.sin(g.t * 2) : 1);
            g.bloom(c, p.x, p.y, haloR, repel ? 'rgba(255,139,167,0.16)' : 'hsla(' + p.hue + ',80%,60%,0.16)');

            // Back half of the ring first — it belongs behind the body.
            if (p.ring) {
                c.save();
                c.strokeStyle = repel ? 'rgba(255,176,196,0.42)' : 'hsla(' + p.hue + ',70%,72%,0.42)';
                c.setLineDash([7, 6]); c.lineWidth = 2;
                c.beginPath(); c.ellipse(p.x, p.y, p.r * 1.75, p.r * 0.42, -0.4, 0, 6.2832); c.stroke();
                c.restore();
            }

            if (repel) {
                // Non-solid by design, so it is drawn non-solid: the starfield
                // shows straight through and the outline is dashed, not a rim.
                c.save();
                c.globalAlpha = 0.45;
                var rg = c.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.35, p.r * 0.1, p.x, p.y, p.r);
                rg.addColorStop(0, '#ffb0c4'); rg.addColorStop(1, '#7a2942');
                c.fillStyle = rg;
                c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.2832); c.fill();
                c.restore();

                c.save();
                c.strokeStyle = 'rgba(255,176,196,0.85)';
                c.setLineDash([6, 7]); c.lineWidth = 2;
                c.lineDashOffset = g.t * 22;
                c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.2832); c.stroke();
                c.restore();

                // Outward chevrons: "this one pushes, and you can fly through it".
                c.save();
                c.strokeStyle = 'rgba(255,176,196,0.55)';
                c.lineWidth = 1.6;
                for (var k = 0; k < 6; k++) {
                    var a = k * 1.0472 + g.t * 0.35;
                    var rr = p.r * 0.55 + (0.5 + 0.5 * Math.sin(g.t * 2.2 + k)) * p.r * 0.3;
                    var cx = p.x + Math.cos(a) * rr, cy = p.y + Math.sin(a) * rr;
                    c.beginPath();
                    c.moveTo(cx - Math.cos(a - 0.6) * 6, cy - Math.sin(a - 0.6) * 6);
                    c.lineTo(cx, cy);
                    c.lineTo(cx - Math.cos(a + 0.6) * 6, cy - Math.sin(a + 0.6) * 6);
                    c.stroke();
                }
                c.restore();
            } else {
                var grd = c.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.35, p.r * 0.1, p.x, p.y, p.r);
                grd.addColorStop(0, 'hsl(' + p.hue + ',70%,66%)');
                grd.addColorStop(1, 'hsl(' + p.hue + ',65%,25%)');
                c.fillStyle = grd;
                c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.2832); c.fill();
                // Terminator: a soft shadow on the far side so the disc reads spherical.
                var sh = c.createLinearGradient(p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r);
                sh.addColorStop(0, 'rgba(0,0,0,0)');
                sh.addColorStop(1, 'rgba(0,0,0,0.45)');
                c.save();
                c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.2832); c.clip();
                c.fillStyle = sh; c.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
                c.restore();
            }

            // …and the front half of the ring AFTER the body, so it passes in
            // front of the sphere instead of reading as a broken arc.
            if (p.ring) {
                c.save();
                c.strokeStyle = repel ? 'rgba(255,196,212,0.75)' : 'hsla(' + p.hue + ',75%,80%,0.75)';
                c.setLineDash([7, 6]); c.lineWidth = 2;
                c.beginPath(); c.ellipse(p.x, p.y, p.r * 1.75, p.r * 0.42, -0.4, 0, Math.PI); c.stroke();
                c.restore();
            }
        }
    }

    function drawCup(g, c) {
        var s = g.s, cup = s.data.cup;
        g.bloom(c, cup.x, cup.y, cup.r * 3, 'rgba(141,255,160,0.22)');
        c.save();
        c.strokeStyle = 'rgba(141,255,160,0.35)';
        c.lineWidth = 1.5;
        c.setLineDash([4, 6]);
        c.lineDashOffset = -g.t * 16;
        c.beginPath(); c.arc(cup.x, cup.y, cup.r + 12 + Math.sin(g.t * 2) * 2, 0, 6.2832); c.stroke();
        c.restore();
        c.strokeStyle = '#8dffa0'; c.lineWidth = 3;
        c.beginPath(); c.arc(cup.x, cup.y, cup.r, 0, 6.2832); c.stroke();
        c.strokeStyle = 'rgba(141,255,160,0.45)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(cup.x, cup.y - cup.r); c.lineTo(cup.x, cup.y - cup.r - 26); c.stroke();
        // Flag pennant, waving on a breeze that does not exist in space.
        var fw = Math.sin(g.t * 3) * 2.5;
        c.fillStyle = '#8dffa0';
        c.beginPath();
        c.moveTo(cup.x, cup.y - cup.r - 26);
        c.lineTo(cup.x + 10, cup.y - cup.r - 23 + fw * 0.5);
        c.lineTo(cup.x + 20, cup.y - cup.r - 20 + fw);
        c.lineTo(cup.x + 10, cup.y - cup.r - 17 + fw * 0.5);
        c.lineTo(cup.x, cup.y - cup.r - 14);
        c.closePath(); c.fill();
    }

    function drawGhost(g, c) {
        var s = g.s;
        if (!s.ghost.length) return;
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.fillStyle = '#cfe8ff';
        for (var q = 0; q < s.ghost.length; q++) {
            var d = s.ghost[q];
            c.globalAlpha = 0.6 * d.a;
            c.beginPath(); c.arc(d.x, d.y, 2.1 * (0.6 + 0.4 * d.a), 0, 6.2832); c.fill();
        }
        c.restore();
        if (!s.ghostEnd) return;
        var e = s.ghostEnd;
        c.save();
        c.strokeStyle = e.rep ? 'rgba(255,176,196,0.5)' : 'rgba(255,214,138,0.5)';
        c.setLineDash([5, 7]); c.lineWidth = 1.4;
        c.lineDashOffset = -g.t * 22;
        c.beginPath(); c.arc(e.px, e.py, e.r, 0, 6.2832); c.stroke();
        c.restore();
        c.fillStyle = e.rep ? 'rgba(255,176,196,0.8)' : 'rgba(255,214,138,0.8)';
        c.font = font(11);
        c.textAlign = 'center';
        c.fillText(e.rep ? 'PUSH FIELD' : 'GRAVITY WELL', e.x, e.y - 13);
        c.textAlign = 'left';
    }

    function drawAim(g, c) {
        var s = g.s;
        var aim = aimVector(g);
        var col = powerColour(aim.power);
        var bx = s.ball.x, by = s.ball.y;

        // The charge bloom: more pull-back, more light. Same for both inputs.
        g.bloom(c, bx, by, 28 + aim.power * 34, 'rgba(141,255,160,' + (0.10 + aim.power * 0.24) + ')');

        // Pull-back arc — the power gauge lives on the ball, not in the corner.
        c.save();
        c.lineCap = 'round';
        c.strokeStyle = 'rgba(255,255,255,0.14)'; c.lineWidth = 5;
        c.beginPath(); c.arc(bx, by, 30, 0, 6.2832); c.stroke();
        c.strokeStyle = col; c.lineWidth = 5;
        c.beginPath(); c.arc(bx, by, 30, -Math.PI / 2, -Math.PI / 2 + 6.2832 * aim.power); c.stroke();
        c.restore();

        // The band you are stretching, drawn opposite the launch direction.
        c.save();
        c.strokeStyle = 'rgba(255,255,255,0.32)';
        c.setLineDash([4, 5]); c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(bx, by);
        c.lineTo(bx - Math.cos(aim.angle) * aim.power * DRAG_RANGE,
                 by - Math.sin(aim.angle) * aim.power * DRAG_RANGE);
        c.stroke();
        c.restore();

        // Launch vector.
        var reach = 34 + aim.power * 74;
        var lx = bx + Math.cos(aim.angle) * reach;
        var ly = by + Math.sin(aim.angle) * reach;
        c.strokeStyle = col; c.lineWidth = 2.5;
        c.beginPath();
        c.moveTo(bx + Math.cos(aim.angle) * 13, by + Math.sin(aim.angle) * 13);
        c.lineTo(lx, ly);
        c.stroke();
        c.fillStyle = col;
        c.beginPath();
        c.moveTo(lx, ly);
        c.lineTo(lx - Math.cos(aim.angle - 0.42) * 12, ly - Math.sin(aim.angle - 0.42) * 12);
        c.lineTo(lx - Math.cos(aim.angle + 0.42) * 12, ly - Math.sin(aim.angle + 0.42) * 12);
        c.closePath(); c.fill();

        // The number, because "about two thirds" is not a power setting.
        c.font = font(12);
        c.textAlign = 'center';
        c.fillStyle = col;
        c.fillText(Math.round(aim.power * 100) + '%', bx, by + 48);
        c.textAlign = 'left';
    }

    function drawLabel(g, c, msg, x, y) {
        c.font = font(12);
        var tw = c.measureText(msg).width;
        var ly = Math.max(24, y);
        c.save();
        c.fillStyle = 'rgba(8,14,26,0.74)';
        roundRect(c, x - tw / 2 - 11, ly - 11, tw + 22, 22, 11);
        c.fill();
        c.strokeStyle = 'rgba(141,255,160,0.35)'; c.lineWidth = 1; c.stroke();
        c.fillStyle = 'rgba(232,238,252,0.92)';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(msg, x, ly);
        c.restore();
        c.textAlign = 'left'; c.textBaseline = 'alphabetic';
    }

    function draw(g, c) {
        var s = g.s;
        g.space(c, { bg: '#04070f' });
        if (!s || !s.data) return;

        drawField(g, c);
        drawContours(g, c);
        drawPlanets(g, c);
        drawCup(g, c);

        // Where a failed shot puts you back.
        var tee = s.data.tee;
        c.save();
        c.strokeStyle = 'rgba(232,238,252,0.22)';
        c.setLineDash([3, 4]); c.lineWidth = 1;
        c.beginPath(); c.arc(tee.x, tee.y, 9, 0, 6.2832); c.stroke();
        c.restore();

        // Sink shockwaves.
        c.save();
        c.globalCompositeOperation = 'lighter';
        for (var pu = 0; pu < s.pulses.length; pu++) {
            var pw = s.pulses[pu];
            var pf = 1 - pw.age / 0.6;
            c.strokeStyle = 'rgba(141,255,160,' + (0.7 * pf) + ')';
            c.lineWidth = 2.5 * pf + 0.5;
            c.beginPath(); c.arc(pw.x, pw.y, pw.r + pw.age * 190, 0, 6.2832); c.stroke();
        }
        c.restore();

        // Trail fades toward its tail instead of sitting at one alpha.
        c.lineWidth = 2;
        for (var t = 1; t < s.trail.length; t++) {
            c.strokeStyle = 'rgba(141,255,160,' + (0.45 * t / s.trail.length) + ')';
            c.beginPath();
            c.moveTo(s.trail[t - 1].x, s.trail[t - 1].y);
            c.lineTo(s.trail[t].x, s.trail[t].y);
            c.stroke();
        }

        drawGhost(g, c);

        // The grab zone, while it still needs teaching or a click just missed it.
        if (!s.flying && (s.hole < 2 || (g.pointer.down && !s.arming))) {
            c.save();
            c.strokeStyle = 'rgba(141,255,160,0.14)';
            c.setLineDash([5, 9]); c.lineWidth = 1;
            c.lineDashOffset = -g.t * 12;
            c.beginPath(); c.arc(s.ball.x, s.ball.y, ARM_RADIUS, 0, 6.2832); c.stroke();
            c.restore();
        }

        if (aimActive(g)) drawAim(g, c);

        if (s.flying) g.bloom(c, s.ball.x, s.ball.y, 30, 'rgba(141,255,160,0.28)');
        g.bloom(c, s.ball.x, s.ball.y, 22, 'rgba(255,255,255,0.35)');
        c.fillStyle = '#fff';
        c.beginPath(); c.arc(s.ball.x, s.ball.y, 6.5, 0, 6.2832); c.fill();

        // Instructions live next to the action, and only while they are news.
        if (!s.flying && s.hole < 2) {
            drawLabel(g, c,
                s.inputMode === 'key' ? '← → aim  ·  ↑ ↓ power  ·  SPACE fire'
                                      : 'Grab the ball, pull back, release',
                s.ball.x, s.ball.y - 40);
        }
    }

    Arcade.create({
        slug: 'slingshot-golf',
        title: 'SLINGSHOT GOLF',
        accent: '#8dffa0',
        tagline: 'Nine holes across a freshly generated solar system. Pull back from the ball, read the gravity field, and let the well curve your shot into the cup. Pink shells push and you fly straight through them. Three trajectory previews a hole — after that you read the field.',
        controls: [
            ['DRAG', 'grab the ball, pull back'],
            ['RELEASE', 'take the shot'],
            ['← →', 'rotate aim'],
            ['↑ ↓', 'power'],
            ['SPACE', 'fire'],
            ['R', 'recall the ball']
        ],
        scoreLabel: 'SCORE',
        overTitle: 'ROUND OVER',
        winTitle: 'UNDER PAR',
        init: init,
        initMenu: init,
        idle: idle,
        update: update,
        draw: draw,
        onResize: onResize,
        pointerDown: pointerDown,
        pointerUp: pointerUp,
        keyDown: keyDown,
        keyUp: keyUp
    });
})();

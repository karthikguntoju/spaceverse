/**
 * Solar Sailor — no engine, only sunlight and a star that pulls back.
 *
 * The sail only ever pushes along its own normal, away from the Sun. You cannot
 * brake and you cannot pull toward the light. What you *can* do is fall: the Sun
 * has gravity, so every run is a closed orbit you deform rather than a straight
 * line you steer. Angling the sail across the light raises, lowers and rotates
 * that orbit, and the corona is a slingshot you get paid for skimming.
 *
 * Everything lives in system-relative coordinates (offsets from the Sun), so the
 * whole scene can be lifted clear of the menu card without the physics noticing.
 */
(function () {
    'use strict';

    var REF = 1080;             // viewport short side the tuning was done against
    var GATE_R = 46;            // gate one's aperture; later gates shrink
    var GATES = 12;
    var TIME_LIMIT = 100;
    var GM_REF = 9.0e6;         // Sun gravity at the reference viewport
    var LIGHTNESS = 0.34;       // peak radiation pressure as a fraction of gravity
    var ESCAPE_GRACE = 5.0;     // seconds outside the frame before the run ends
    var HEAT_CAP = 2500;        // solar charge ceiling — a 3.5x gate multiplier
    var GOLD = '255,211,90';
    var GREEN = '141,255,160';

    /* Precomputed stroke colours for the two hot polylines. The trail and the
       prediction arc used to build a fresh rgba() template string and issue a
       separate stroke() for every segment — ~245 of each, every frame. They
       now bucket into a handful of fixed alphas, so a frame costs 14 strokes
       and allocates nothing. */
    var TRAIL_STEPS = 8, PRED_STEPS = 6;
    var TRAIL_COL = [], TRAIL_LW = [], PRED_COL = [];
    (function () {
        var i, f;
        for (i = 0; i < TRAIL_STEPS; i++) {
            f = (i + 0.5) / TRAIL_STEPS;
            TRAIL_COL.push('rgba(' + GOLD + ',' + (0.30 * f * f).toFixed(3) + ')');
            TRAIL_LW.push(0.6 + f * 2.2);
        }
        for (i = 0; i < PRED_STEPS; i++) {
            f = 1 - (i + 0.5) / PRED_STEPS;
            PRED_COL.push('rgba(125,232,255,' + (0.42 * f).toFixed(3) + ')');
        }
    })();

    /* ── scale ────────────────────────────────────────────────────────────
       gm scales as the cube of the viewport so orbital *periods* are the same
       on a laptop and a monitor; distances and speeds then scale linearly. */
    function mag(x, y) { return Math.sqrt(x * x + y * y); }
    function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
    function scl(g) { return Math.min(g.w, g.h) / REF; }
    function sunR(g) { var r = Math.min(g.w, g.h) * 0.0426; return r < 28 ? 28 : (r > 52 ? 52 : r); }
    function sunGM(g) { var k = scl(g); return GM_REF * k * k * k; }

    /* Every distance in this game used to key off the short side, which on a
       16:9 monitor left a third of the width permanently empty. This is the
       horizontal stretch the course is laid out through: 1 on a square
       viewport, capped at 1.5 so an ultrawide does not smear the orbit flat. */
    function aspectK(g) {
        var k = g.w / Math.min(g.w, g.h);
        return k < 1 ? 1 : (k > 1.5 ? 1.5 : k);
    }

    /** How far out a gate of radius r may sit along heading `a`, in pre-stretch
        units — the x term carries the stretch it is about to be multiplied by,
        so the cap is elliptical the same way the placement is. */
    function radiusCap(g, a, r, kx) {
        var m = Math.min(g.w, g.h) * 0.46;
        var ca = Math.abs(Math.cos(a)), sa = Math.abs(Math.sin(a));
        if (ca > 0.001) m = Math.min(m, (g.w * 0.5 - r - 14) / (ca * kx));
        if (sa > 0.001) m = Math.min(m, (g.h * 0.5 - r - 14) / sa);
        return m;
    }

    /* ── view centre ──────────────────────────────────────────────────────
       Running: the Sun sits mid-screen. Idle: it parks clear of the menu card
       instead of behind it. 26% of the height was not enough — at 720p that is
       187px and the card's top edge is ~172px, so the best asset in the game
       spent the whole attract loop inside a glass panel. Now the target is
       derived from where the card actually starts, floored so the Sun never
       clips the top bar, and on anything wider than 1000px the whole system
       slides off-centre so the orbit straddles the card instead of hiding
       under it. The lerp means a finished run lifts into that frame instead
       of cutting. */
    var viewX = 0, viewY = 0, viewSet = false;

    function stepView(g, dt) {
        var tx = g.w * 0.5;
        var ty = g.h * 0.5;
        if (!g.running) {
            ty = Math.min(g.h * 0.26, (g.h - 58) / 2 - 270);
            var floor = sunR(g) + 70;
            if (ty < floor) ty = floor;
            if (g.w > 1000) tx = Math.max(sunR(g) + 200, g.w * 0.5 - 300);
        }
        if (!viewSet) { viewX = tx; viewY = ty; viewSet = true; return; }
        var k = 6 * dt; if (k > 1) k = 1;
        viewX += (tx - viewX) * k;
        viewY += (ty - viewY) * k;
    }

    function syncGates(s) {
        for (var i = 0; i < s.gates.length; i++) {
            s.gates[i].x = viewX + s.gates[i].ox;
            s.gates[i].y = viewY + s.gates[i].oy;
        }
    }

    /* ── gates ────────────────────────────────────────────────────────────
       Golden-angle spread rings the Sun instead of clumping, and because the
       angle always advances in the direction of travel the gates arrive in
       order as you orbit. Candidates that would intersect an existing ring get
       re-rolled: overlapping torii read as a rendering bug, not a course. */
    function placeGate(g, n, existing) {
        var S = Math.min(g.w, g.h);
        var kx = aspectK(g);
        // Each gate owns its radius from birth. Clearing one no longer resizes
        // the other eleven; the field itself draws the difficulty curve.
        var r = Math.max(26, GATE_R - n * 2.1);
        var best = null, bestGap = -1e9;
        for (var t = 0; t < 40; t++) {
            var a = n * 2.399 + g.rand(-0.32, 0.32);
            var d = S * (0.22 + ((n * 0.11) % 0.20) + g.rand(-0.03, 0.03));
            d = Math.min(d, radiusCap(g, a, r, kx));
            // Elliptical, not circular: the x offset carries the viewport's
            // aspect so a 16:9 course uses the width it has been given.
            var ox = Math.cos(a) * d * kx, oy = Math.sin(a) * d;
            var sep = 1e9, gap = 1e9;
            for (var i = 0; i < existing.length; i++) {
                var e = mag(ox - existing[i].ox, oy - existing[i].oy);
                if (e < sep) sep = e;
                if (e - r - existing[i].r < gap) gap = e - r - existing[i].r;
            }
            // Rank on clear air between rims, so the fallback after the retry
            // budget runs out is still the least-overlapping candidate.
            if (gap > bestGap) { bestGap = gap; best = { ox: ox, oy: oy, a: a, d: d }; }
            if (sep >= 2.1 * GATE_R) break;
        }

        // The golden angle folds back on itself every fifth gate, so a handful
        // of layouts have no clean slot to roll into. Walk the survivor along
        // its own radius until it clears — radial-only, so the spread survives.
        var minD = S * 0.19;
        var maxD = radiusCap(g, best.a, r, kx);
        if (maxD < minD) maxD = minD;
        for (var pass = 0; pass < 16 && existing.length; pass++) {
            var worst = null, worstGap = 1e9;
            for (var j = 0; j < existing.length; j++) {
                var gj = mag(best.ox - existing[j].ox, best.oy - existing[j].oy) - r - existing[j].r;
                if (gj < worstGap) { worstGap = gj; worst = existing[j]; }
            }
            if (worstGap >= 8) break;
            var push = 10 - worstGap;
            var nd = best.d + (best.d >= worst.d ? push : -push);
            if (nd > maxD || nd < minD) nd = best.d - (best.d >= worst.d ? push : -push);
            best.d = Math.max(minD, Math.min(maxD, nd));
            best.ox = Math.cos(best.a) * best.d * kx;
            best.oy = Math.sin(best.a) * best.d;
        }

        best.r = r;
        best.kx = kx;
        best.hit = false;
        best.x = 0; best.y = 0;

        /* ── the second difficulty axis ───────────────────────────────────
           Radius bottoms out at 26px on gate 11, so on the old curve the last
           three gates were the same problem three times. Past gate 8 the ring
           starts caring *how* you arrive: score only counts when your velocity
           has a positive component along the gate's normal, which turns a
           late gate from "aim at a dot" into "arrive on this heading". Past
           gate 10 it also drifts along its own orbit, so the heading you
           planned two gates ago is not the heading you need. */
        best.dirA = n >= 7 ? best.a + 1.5708 + g.rand(-0.45, 0.45) : null;
        best.drift = n >= 9
            ? (0.045 + (n - 9) * 0.016) * (Math.random() < 0.5 ? -1 : 1)
            : 0;
        return best;
    }

    function blankState(g) {
        return {
            ship: { ox: 0, oy: 0, vx: 0, vy: 0 },
            sail: 0.6,              // sail normal angle, radians
            gates: [],
            idx: 0,
            time: TIME_LIMIT,
            trail: [],
            passed: 0,
            pulses: [],             // expanding rings on gate clears
            heatWarn: 0,            // cooldown on the proximity tick
            wrongWarn: 0,           // cooldown on the wrong-approach nudge
            heatBank: 0,            // solar charge, banked in the corona
            heatNow: 0,
            lit: 0,
            escape: 0,              // seconds spent outside the frame
            feather: 0,
            S: Math.min(g.w, g.h),
            menu: false,
            overHold: 0
        };
    }

    function init(g) {
        var s = blankState(g);
        g.s = s;
        // Snap straight to the play framing. init() runs before the shell flips
        // g.running, so stepView would still be aiming at the menu centre here.
        viewX = g.w * 0.5; viewY = g.h * 0.5; viewSet = true;

        for (var i = 0; i < GATES; i++) s.gates.push(placeGate(g, i, s.gates));
        syncGates(s);

        // Start half an orbit behind gate one, at exactly that gate's altitude
        // and exactly circular speed. Doing nothing coasts you through the first
        // gate for free, which teaches gravity before it charges you for it.
        // Measured off the gate's real position, not its polar parameter: the
        // course is elliptical now, so `d` is no longer the gate's altitude and
        // using it would have quietly broken the free first gate.
        var g0 = s.gates[0];
        var startA = Math.atan2(g0.oy, g0.ox) + Math.PI;
        var startD = mag(g0.ox, g0.oy);
        s.ship.ox = Math.cos(startA) * startD;
        s.ship.oy = Math.sin(startA) * startD;
        var vc = Math.sqrt(sunGM(g) / startD);
        s.ship.vx = Math.cos(startA + 1.5708) * vc;
        s.ship.vy = Math.sin(startA + 1.5708) * vc;
        // Edge-on and trailing: for the whole first half-orbit the Sun is behind
        // the sail, so the coast to gate one is pure gravity and costs nothing.
        s.sail = startA - 1.42;
    }

    /* ── attract scene ────────────────────────────────────────────────────
       A real Kepler ellipse with the Sun at the focus, gates threaded onto it,
       and a ship that flies the whole course on loop. The idle screen is now a
       demonstration of the mechanic instead of a freeze-frame. */
    var MENU_SPEED = 0.28;

    function menuPos(s, nu) {
        var r = s.p / (1 + s.e * Math.cos(nu));
        var a = nu + s.rot;
        return { x: Math.cos(a) * r * (s.kx || 1), y: Math.sin(a) * r, r: r };
    }

    function initMenu(g) {
        var s = blankState(g);
        var S = Math.min(g.w, g.h);
        s.menu = true;
        s.p = S * 0.17;
        s.e = 0.28;
        s.rot = -0.25;
        s.nu = 0.9;
        s.kx = aspectK(g);
        g.s = s;
        viewSet = false;
        stepView(g, 0);

        // The parked Sun sits high, so the loop above it has a hard ceiling.
        // Sample the ellipse's own upward reach and scale the orbit — and the
        // rings threaded on it — to fit that band, rather than letting the
        // attract course run off the top of a 720p screen.
        var up = 0;
        for (var q = 0; q < 48; q++) {
            var yy = menuPos(s, q * 0.1309).y;
            if (-yy > up) up = -yy;
        }
        var room = viewY - 34;
        var fit = (up > room && up > 0) ? Math.max(0.5, room / up) : 1;
        s.p *= fit;
        s.fit = fit;

        for (var i = 0; i < GATES; i++) {
            var nu = i * (6.2832 / GATES) + 0.25;
            var p = menuPos(s, nu);
            s.gates.push({
                ox: p.x, oy: p.y, a: Math.atan2(p.y, p.x), d: p.r,
                r: Math.max(14, Math.max(26, GATE_R - i * 2.1) * fit),
                hit: false, x: 0, y: 0
            });
        }
        syncGates(s);

        var st = menuPos(s, s.nu);
        s.ship.ox = st.x; s.ship.oy = st.y;
        s.prevOx = st.x; s.prevOy = st.y;
        s.sail = Math.atan2(st.y, st.x);
    }

    function idle(g, dt) {
        var s = g.s;
        if (!s || !s.gates) { initMenu(g); s = g.s; }
        stepView(g, dt);

        // A finished run holds on screen long enough to read, then hands the
        // canvas back to the attract loop.
        if (!s.menu) {
            s.overHold += dt;
            for (var pi = s.pulses.length - 1; pi >= 0; pi--) {
                s.pulses[pi].age += dt;
                if (s.pulses[pi].age > 0.6) s.pulses.splice(pi, 1);
            }
            syncGates(s);
            if (s.overHold < 2.4) return;
            initMenu(g); s = g.s;
        }

        syncGates(s);

        // Kepler's second law: sweep faster near periapsis, slower at apoapsis.
        var r = s.p / (1 + s.e * Math.cos(s.nu));
        var hMom = Math.sqrt(sunGM(g) * s.p);
        s.nu += (hMom / (r * r)) * MENU_SPEED * dt;
        if (s.nu > 6.2832) s.nu -= 6.2832;

        var pos = menuPos(s, s.nu);
        s.prevOx = s.ship.ox; s.prevOy = s.ship.oy;
        s.ship.ox = pos.x; s.ship.oy = pos.y;
        if (dt > 0) {
            s.ship.vx = (s.ship.ox - s.prevOx) / dt;
            s.ship.vy = (s.ship.oy - s.prevOy) / dt;
        }

        // The sail visibly tilts through its whole range so the idle screen
        // shows the light arrow growing and collapsing.
        var toShip = Math.atan2(s.ship.oy, s.ship.ox);
        s.sail = toShip + Math.sin(g.t * 0.5) * 1.15;
        s.lit = Math.max(0, Math.cos(g.wrapAngle(s.sail - toShip)));

        if (s.lit > 0.25 && Math.random() < 0.5) {
            g.burst(viewX + s.ship.ox - Math.cos(s.sail) * 16, viewY + s.ship.oy - Math.sin(s.sail) * 16,
                { n: 1, angle: s.sail, spread: 0.5, speed: 60, colour: '#ffd35a', life: 0.5, size: 1.8, shape: 'spark' });
        }

        s.trail.push({ x: s.ship.ox, y: s.ship.oy });
        if (s.trail.length > 190) s.trail.shift();

        for (var pj = s.pulses.length - 1; pj >= 0; pj--) {
            s.pulses[pj].age += dt;
            if (s.pulses[pj].age > 0.6) s.pulses.splice(pj, 1);
        }

        var gt = s.gates[s.idx];
        if (gt && mag(s.ship.ox - gt.ox, s.ship.oy - gt.oy) < gt.r) {
            gt.hit = true;
            s.idx++;
            s.pulses.push({ x: gt.x, y: gt.y, r: gt.r, age: 0 });
            g.burst(gt.x, gt.y, { n: 14, colour: '#ffd35a', speed: 200, life: 0.6 });
            if (s.idx >= GATES) {
                s.idx = 0;
                for (var k = 0; k < s.gates.length; k++) s.gates[k].hit = false;
            }
        }
    }

    /* ── run ──────────────────────────────────────────────────────────── */
    function update(g, dt) {
        var s = g.s;
        var sh = s.ship;
        stepView(g, dt);

        // Late gates walk their own orbit. Cleared ones stop, so the course
        // behind you stays where you left it.
        for (var di = s.idx; di < s.gates.length; di++) {
            var dg = s.gates[di];
            if (!dg.drift) continue;
            dg.a += dg.drift * dt;
            dg.ox = Math.cos(dg.a) * dg.d * (dg.kx || 1);
            dg.oy = Math.sin(dg.a) * dg.d;
            if (dg.dirA != null) dg.dirA += dg.drift * dt;
        }
        syncGates(s);
        s.wrongWarn = Math.max(0, s.wrongWarn - dt);

        var GMv = sunGM(g);
        var SR = sunR(g);

        s.time -= dt;
        if (s.time <= 0) {
            g.over('Out of time with ' + s.passed + ' of ' + GATES + ' gates cleared.', false);
            return;
        }

        var toShip = Math.atan2(sh.oy, sh.ox);

        if (g.key('KeyA') || g.key('ArrowLeft')) s.sail -= 2.1 * dt;
        if (g.key('KeyD') || g.key('ArrowRight')) s.sail += 2.1 * dt;
        if (g.key('ShiftLeft') || g.key('ShiftRight')) {
            // Feather: swing the sail to the nearest edge-on attitude and coast.
            var side = g.wrapAngle(s.sail - toShip) >= 0 ? 1.5708 : -1.5708;
            s.sail += g.wrapAngle((toShip + side) - s.sail) * Math.min(1, 8 * dt);
            s.feather = 1;
        } else s.feather = Math.max(0, s.feather - dt * 3);
        if (g.pointer.down) {
            // Point the sail normal at the cursor: the mouse says "push me that way".
            var want = Math.atan2((g.pointer.y - viewY) - sh.oy, (g.pointer.x - viewX) - sh.ox);
            s.sail += g.wrapAngle(want - s.sail) * Math.min(1, 5 * dt);
        }

        var d = Math.max(SR + 6, mag(sh.ox, sh.oy));

        // Gravity first. Without it a sail pointed the wrong way was a run that
        // had already ended and had not been told yet.
        var gm = GMv;
        var ga = gm / (d * d);
        sh.vx -= Math.cos(toShip) * ga * dt;
        sh.vy -= Math.sin(toShip) * ga * dt;

        // Only the component of sunlight along the sail normal does anything,
        // and light never pulls: a sail edge-on to the Sun gets nothing.
        var incidence = Math.cos(g.wrapAngle(s.sail - toShip));
        var lit = incidence > 0 ? incidence : 0;
        s.lit = lit;
        var force = (gm * LIGHTNESS / (d * d)) * lit * lit;
        sh.vx += Math.cos(s.sail) * force * dt;
        sh.vy += Math.sin(s.sail) * force * dt;

        if (force > 6 * scl(g)) {
            g.burst(viewX + sh.ox - Math.cos(s.sail) * 16, viewY + sh.oy - Math.sin(s.sail) * 16,
                { n: 1, angle: s.sail, spread: 0.5, speed: 60, colour: '#ffd35a', life: 0.5, size: 1.8, shape: 'spark' });
        }

        sh.ox += sh.vx * dt; sh.oy += sh.vy * dt;

        s.trail.push({ x: sh.ox, y: sh.oy });
        if (s.trail.length > 190) s.trail.shift();

        for (var pi = s.pulses.length - 1; pi >= 0; pi--) {
            s.pulses[pi].age += dt;
            if (s.pulses[pi].age > 0.6) s.pulses.splice(pi, 1);
        }

        // Skimming the corona banks solar charge. It still shakes, sparks and
        // ticks — but now the risk has a number attached to it.
        var sunD = mag(sh.ox, sh.oy);
        s.heatNow = 0;
        if (sunD < SR * 2.6) {
            var heat = clamp01(1 - (sunD - SR) / (SR * 1.6));
            s.heatNow = heat;
            s.heatBank = Math.min(HEAT_CAP, s.heatBank + heat * 120 * dt);
            if (Math.random() < heat * 0.5) {
                g.burst(viewX + sh.ox, viewY + sh.oy, { n: 1, colour: '#ff9a3d', speed: 90, life: 0.4, size: 1.6, shape: 'spark' });
            }
            g.shake(heat * 2.5);
            s.heatWarn -= dt;
            if (s.heatWarn <= 0) { g.sfx('tick', 0.7 + heat * 0.5); s.heatWarn = 0.5 - heat * 0.25; }
        }

        if (sunD < SR + 8) {
            g.burst(viewX + sh.ox, viewY + sh.oy, { n: 60, colour: '#ffd35a', speed: 420, life: 1 });
            g.burst(viewX + sh.ox, viewY + sh.oy, { n: 30, colour: '#ff9a3d', speed: 520, life: 0.8, shape: 'spark' });
            g.shake(30); g.sfx('boom');
            g.over('You flew into the Sun. It is very bright and very final.', false);
            return;
        }

        // Leaving the system is a warning with a clock on it, not a silent
        // sentence handed down twenty seconds earlier. Gravity can still pull
        // you back, so the five seconds are genuinely playable.
        var sx = viewX + sh.ox, sy = viewY + sh.oy;
        var outside = sx < -40 || sx > g.w + 40 || sy < -40 || sy > g.h + 40;
        if (outside) {
            if (s.escape <= 0) { g.sfx('hit', 0.6); g.flash('LEAVING THE SYSTEM', '#ff8b8b', 900); }
            s.escape += dt;
            if (s.escape >= ESCAPE_GRACE) {
                g.sfx('lose');
                g.over('You left the system with ' + s.passed + ' gates cleared. Nothing out here to push against.', false);
                return;
            }
        } else if (s.escape > 0) {
            s.escape -= dt * 1.6;
            if (s.escape <= 0) { s.escape = 0; g.flash('BACK IN THE LIGHT', '#8dffa0', 600); }
        }

        var gate = s.gates[s.idx];
        var inGate = gate && mag(sh.ox - gate.ox, sh.oy - gate.oy) < gate.r;
        // Past gate 8 the ring only counts if you come through it the right
        // way. Falling through backwards is not a clear — it is a warning and
        // another lap.
        if (inGate && gate.dirA != null
            && (sh.vx * Math.cos(gate.dirA) + sh.vy * Math.sin(gate.dirA)) <= 0) {
            inGate = false;
            if (s.wrongWarn <= 0) {
                g.sfx('hit', 0.8);
                g.flash('WRONG APPROACH', '#ff8b8b', 700);
                s.wrongWarn = 1.4;
            }
        }
        if (inGate) {
            gate.hit = true;
            s.passed++;
            s.idx++;
            // Early gates are generous with time; late gates barely pay.
            var bonus = Math.max(4, 8 - Math.floor(s.passed / 3));
            s.time += bonus;
            var mult = 1 + s.heatBank / 1000;
            g.addScore(Math.round((500 + s.time * 8) * mult));
            var banked = s.heatBank;
            s.heatBank = 0;
            g.sfx('win', 1 + s.passed * 0.03);
            g.burst(gate.x, gate.y, { n: 22, colour: '#ffd35a', speed: 240, life: 0.7 });
            g.burst(gate.x, gate.y, { n: 10, colour: '#fff3c4', speed: 320, life: 0.5, shape: 'spark' });
            if (banked > 80) {
                g.burst(gate.x, gate.y, { n: 18, colour: '#ff9a3d', speed: 380, life: 0.8, shape: 'spark' });
                g.sfx('pick', 1.3);
            }
            s.pulses.push({ x: gate.x, y: gate.y, r: gate.r, age: 0 });
            g.flash('GATE ' + s.passed + ' · +' + bonus + 's' + (mult > 1.05 ? '  ×' + mult.toFixed(2) : ''), '#ffd35a', 650);
            if (s.idx >= s.gates.length) {
                g.addScore(4000 + Math.round(s.time * 60));
                g.over('All ' + GATES + ' gates cleared with ' + s.time.toFixed(1) + 's to spare.', true);
                return;
            }
        }

        var speed = mag(sh.vx, sh.vy);
        var chargeRow = s.heatBank > 20
            ? 'SOLAR CHARGE <b style="color:#ff9a3d">×' + (1 + s.heatBank / 1000).toFixed(2) + '</b><br>'
            : '';
        var escRow = s.escape > 0
            ? '<b style="color:#ff8b8b">RETURN ' + (ESCAPE_GRACE - s.escape).toFixed(1) + 's</b><br>'
            : '';
        // On a directional gate the pass/fail test is live, so the constraint
        // is something you steer against rather than something you discover.
        var cur = s.gates[s.idx];
        var apRow = '';
        if (cur && cur.dirA != null) {
            var ok = (sh.vx * Math.cos(cur.dirA) + sh.vy * Math.sin(cur.dirA)) > 0;
            apRow = 'APPROACH <b style="color:' + (ok ? '#8dffa0' : '#ff8b8b') + '">'
                + (ok ? 'ALIGNED' : 'WRONG WAY') + '</b>'
                + (cur.drift ? ' · <b style="color:#ff9a3d">DRIFTING</b>' : '') + '<br>';
        }
        g.hud('GATE <b>' + Math.min(s.idx + 1, GATES) + ' / ' + GATES + '</b><br>' +
              'SPEED <b>' + Math.round(speed) + '</b> · SAIL <b>' + Math.round(lit * 100) + '% lit</b><br>' +
              chargeRow + apRow + escRow +
              'TIME <b style="color:' + (s.time < 12 ? '#ff8b8b' : '#e8eefc') + '">' + s.time.toFixed(1) + 's</b>');
    }

    /* ── trajectory prediction ────────────────────────────────────────────
       Same integrator as update(), run forward with the sail held where it is.
       This is the difference between "plan two gates ahead" as a design note
       and as something the screen actually tells you. */
    var predBuf = [];

    function predict(g, s) {
        var GMv = sunGM(g), SR = sunR(g);
        var x = s.ship.ox, y = s.ship.oy, vx = s.ship.vx, vy = s.ship.vy;
        var h = 1 / 45, n = 110;
        predBuf.length = 0;
        for (var i = 0; i < n; i++) {
            var dd = mag(x, y);
            if (dd < SR + 7) break;
            var a = Math.atan2(y, x);
            var ga = GMv / (dd * dd);
            var inc = Math.cos(g.wrapAngle(s.sail - a));
            var f = inc > 0 ? (GMv * LIGHTNESS / (dd * dd)) * inc * inc : 0;
            vx += (-Math.cos(a) * ga + Math.cos(s.sail) * f) * h;
            vy += (-Math.sin(a) * ga + Math.sin(s.sail) * f) * h;
            x += vx * h; y += vy * h;
            predBuf.push(x, y);
        }
        return predBuf;
    }

    /* ── the Sun ─────────────────────────────────────────────────────── */
    function drawSun(g, c, cx, cy, SR, boost) {
        var t = g.t;
        var pulse = 1 + Math.sin(t * 1.7) * 0.05;

        // Corona: additive, breathing, with slow-turning light rays.
        g.bloom(c, cx, cy, Math.min(g.w, g.h) * 0.5, 'rgba(255,166,60,' + (0.10 * boost).toFixed(3) + ')');
        g.bloom(c, cx, cy, SR * 3.4 * pulse, 'rgba(255,196,80,' + (0.30 * Math.min(boost, 1.8)).toFixed(3) + ')');
        // The menu screen lays a 62% scrim and a 10px blur over the canvas, so
        // the idle Sun needs a heavier corona to read as a star through it.
        if (boost > 1) {
            g.bloom(c, cx, cy, SR * 6.5, 'rgba(255,180,70,0.22)');
            g.bloom(c, cx, cy, SR * 1.9, 'rgba(255,240,190,0.50)');
        }

        c.save();
        c.globalCompositeOperation = 'lighter';
        c.translate(cx, cy);
        c.rotate(t * 0.05);
        for (var i = 0; i < 10; i++) {
            c.rotate(0.6283);
            var len = SR * (2.4 + Math.sin(t * 1.3 + i * 2.1) * 0.5);
            var ra = (0.05 + 0.04 * Math.sin(t * 1.1 + i * 1.7)) * boost;
            var ray = c.createLinearGradient(SR, 0, len, 0);
            ray.addColorStop(0, 'rgba(255,211,90,' + ra + ')');
            ray.addColorStop(1, 'rgba(255,211,90,0)');
            c.fillStyle = ray;
            c.beginPath();
            c.moveTo(SR * 0.9, -SR * 0.16);
            c.lineTo(len, 0);
            c.lineTo(SR * 0.9, SR * 0.16);
            c.closePath(); c.fill();
        }
        c.restore();

        // Photosphere: white-hot core falling to orange at the limb.
        var body = c.createRadialGradient(cx - SR * 0.25, cy - SR * 0.25, SR * 0.1, cx, cy, SR);
        body.addColorStop(0, '#fffbe9');
        body.addColorStop(0.55, '#ffe289');
        body.addColorStop(1, '#ff9a3d');
        c.fillStyle = body;
        c.beginPath(); c.arc(cx, cy, SR, 0, 6.2832); c.fill();

        // Granulation: dark convection cells drifting under the clip.
        c.save();
        c.beginPath(); c.arc(cx, cy, SR, 0, 6.2832); c.clip();
        c.globalAlpha = 0.12;
        c.fillStyle = '#ff8a2d';
        for (var k = 0; k < 6; k++) {
            var ka = t * (0.08 + g.hash(k * 7.3) * 0.06) + g.hash(k * 3.1) * 6.2832;
            var kd = SR * (0.25 + g.hash(k * 5.7) * 0.45);
            c.beginPath();
            c.arc(cx + Math.cos(ka) * kd, cy + Math.sin(ka) * kd, SR * (0.18 + g.hash(k * 9.2) * 0.16), 0, 6.2832);
            c.fill();
        }
        c.restore();

        // Prominences: three plasma loops crawling around the rim.
        c.save();
        c.globalCompositeOperation = 'lighter';
        for (var p = 0; p < 3; p++) {
            var pa = t * 0.12 + p * 2.09;
            var px = cx + Math.cos(pa) * SR, py = cy + Math.sin(pa) * SR;
            var hh = SR * (0.35 + 0.15 * Math.sin(t * 0.9 + p * 2.5));
            c.strokeStyle = 'rgba(255,140,50,' + (0.25 + 0.15 * Math.sin(t * 1.4 + p)) + ')';
            c.lineWidth = 2.2;
            c.beginPath();
            c.moveTo(px + Math.cos(pa + 1.35) * 8, py + Math.sin(pa + 1.35) * 8);
            c.quadraticCurveTo(
                cx + Math.cos(pa) * (SR + hh), cy + Math.sin(pa) * (SR + hh),
                px + Math.cos(pa - 1.35) * 8, py + Math.sin(pa - 1.35) * 8);
            c.stroke();
        }
        c.restore();
    }

    /* ── gates ────────────────────────────────────────────────────────── */
    function drawGate(g, c, gt, rank, shx, shy) {
        var col = GOLD, alpha, lw, num = false, numA = 1;
        if (rank < 0) { col = GREEN; alpha = 0.26; lw = 2; }
        else if (rank === 0) { alpha = 1; lw = 4; num = true; }
        else if (rank === 1) { alpha = 0.55; lw = 3; num = true; numA = 0.8; }
        else if (rank === 2) { alpha = 0.35; lw = 2.4; num = true; numA = 0.5; }
        else { alpha = 0.16; lw = 2; }

        var near = clamp01(1 - mag(shx - gt.x, shy - gt.y) / 400);

        // Aperture: a soft disc so the ring reads as a hole with depth in it.
        var grd = c.createRadialGradient(gt.x, gt.y, 0, gt.x, gt.y, gt.r * 0.82);
        grd.addColorStop(0, 'rgba(' + col + ',' + (0.14 * alpha).toFixed(3) + ')');
        grd.addColorStop(1, 'rgba(' + col + ',0)');
        c.fillStyle = grd;
        c.beginPath(); c.arc(gt.x, gt.y, gt.r * 0.82, 0, 6.2832); c.fill();

        // Torus: inner lip plus outer rim instead of one flat hoop.
        c.strokeStyle = 'rgba(' + col + ',' + (alpha * 0.45).toFixed(3) + ')';
        c.lineWidth = Math.max(1, lw * 0.55);
        c.beginPath(); c.arc(gt.x, gt.y, gt.r * 0.82, 0, 6.2832); c.stroke();
        c.strokeStyle = 'rgba(' + col + ',' + alpha + ')';
        c.lineWidth = lw;
        c.beginPath(); c.arc(gt.x, gt.y, gt.r, 0, 6.2832); c.stroke();

        // Six ticks turning slowly — the ring reads as machinery, not an arc.
        c.save();
        c.translate(gt.x, gt.y);
        c.rotate(g.t * 0.4);
        c.strokeStyle = 'rgba(' + col + ',' + (alpha * 0.7).toFixed(3) + ')';
        c.lineWidth = Math.max(1.2, lw * 0.6);
        for (var k = 0; k < 6; k++) {
            var ta = k * 1.0472;
            c.beginPath();
            c.moveTo(Math.cos(ta) * gt.r, Math.sin(ta) * gt.r);
            c.lineTo(Math.cos(ta) * gt.r * 1.16, Math.sin(ta) * gt.r * 1.16);
            c.stroke();
        }
        c.restore();

        // Directional gate: a bracket on the face you have to enter through and
        // an arrow along the heading that scores. Drawn for live gates only —
        // a cleared ring has no rule left to state.
        if (rank >= 0 && gt.dirA != null) {
            var aa = alpha * (rank === 0 ? 1 : 0.65);
            c.save();
            c.translate(gt.x, gt.y);
            c.rotate(gt.dirA);
            c.strokeStyle = 'rgba(' + GREEN + ',' + (aa * 0.9).toFixed(3) + ')';
            c.lineWidth = Math.max(1.6, lw * 1.1);
            c.beginPath(); c.arc(0, 0, gt.r * 1.3, 1.9199, 4.3633); c.stroke();
            c.lineWidth = Math.max(1.4, lw * 0.75);
            c.beginPath();
            c.moveTo(-gt.r * 1.5, 0); c.lineTo(gt.r * 0.6, 0);
            c.moveTo(gt.r * 0.6, 0); c.lineTo(gt.r * 0.14, -gt.r * 0.32);
            c.moveTo(gt.r * 0.6, 0); c.lineTo(gt.r * 0.14, gt.r * 0.32);
            c.stroke();
            c.restore();
        }

        // Proximity bloom: the target physically brightens as you close on it.
        if (rank >= 0 && rank <= 2 && near > 0.01) {
            g.bloom(c, gt.x, gt.y, gt.r * 2.6, 'rgba(' + col + ',' + (0.30 * near * alpha).toFixed(3) + ')');
        }
        return num ? numA : 0;
    }

    /** Control point for an arc that bows away from the Sun, the way an orbit
        between two points actually curves. */
    function bow(cx, cy, ax, ay, bx, by, k) {
        var mx = (ax + bx) * 0.5, my = (ay + by) * 0.5;
        var rx = mx - cx, ry = my - cy;
        var rl = mag(rx, ry) || 1;
        var chord = mag(bx - ax, by - ay);
        return { x: mx + rx / rl * chord * k, y: my + ry / rl * chord * k };
    }

    /* ── the ship ─────────────────────────────────────────────────────── */
    function drawShip(g, c, s, x, y, toShip) {
        var lit = s.lit;

        g.bloom(c, x, y, 30 + lit * 18, 'rgba(255,243,196,' + (0.10 + lit * 0.16).toFixed(3) + ')');

        c.save();
        c.translate(x, y);
        c.rotate(s.sail);

        // Sail: a bowed plate perpendicular to its normal. The normal is +x,
        // so the Sun is off to -x and the plate bulges away from the light.
        var face = c.createLinearGradient(-4, 0, 10, 0);
        face.addColorStop(0, 'rgba(255,243,196,' + (0.20 + lit * 0.72).toFixed(3) + ')');
        face.addColorStop(1, 'rgba(255,196,90,' + (0.08 + lit * 0.30).toFixed(3) + ')');
        c.fillStyle = face;
        c.beginPath();
        c.moveTo(0, -31);
        c.quadraticCurveTo(9, 0, 0, 31);
        c.quadraticCurveTo(3, 0, 0, -31);
        c.closePath();
        c.fill();
        c.strokeStyle = 'rgba(255,251,233,' + (0.35 + lit * 0.6).toFixed(3) + ')';
        c.lineWidth = 1.6;
        c.beginPath();
        c.moveTo(0, -31); c.quadraticCurveTo(9, 0, 0, 31);
        c.stroke();

        // Boom, shrouds and payload.
        c.strokeStyle = 'rgba(232,238,252,0.75)'; c.lineWidth = 1.3;
        c.beginPath(); c.moveTo(0, 0); c.lineTo(-17, 0); c.stroke();
        c.beginPath();
        c.moveTo(-17, 0); c.lineTo(0, -31);
        c.moveTo(-17, 0); c.lineTo(0, 31);
        c.globalAlpha = 0.45; c.stroke(); c.globalAlpha = 1;

        c.fillStyle = '#e8eefc';
        c.beginPath(); c.arc(-19, 0, 4.5, 0, 6.2832); c.fill();
        c.fillStyle = 'rgba(125,232,255,0.9)';
        c.beginPath(); c.arc(-19, 0, 2, 0, 6.2832); c.fill();

        // Solar charge banked in the payload, as an arc that fills up.
        if (s.heatBank > 20) {
            var frac = clamp01(s.heatBank / HEAT_CAP);
            c.strokeStyle = 'rgba(255,154,61,0.9)';
            c.lineWidth = 2.2;
            c.beginPath();
            c.arc(-19, 0, 8.5, -1.5708, -1.5708 + 6.2832 * frac);
            c.stroke();
        }

        // Arrow along the normal: where the light will actually push you.
        c.strokeStyle = 'rgba(255,211,90,' + (0.2 + lit * 0.8).toFixed(3) + ')';
        c.lineWidth = 2;
        var alen = 14 + lit * lit * 34;
        c.beginPath(); c.moveTo(10, 0); c.lineTo(10 + alen, 0); c.stroke();
        c.beginPath();
        c.moveTo(10 + alen, 0); c.lineTo(10 + alen - 7, -4.5);
        c.moveTo(10 + alen, 0); c.lineTo(10 + alen - 7, 4.5);
        c.stroke();
        c.restore();

        // Feather indicator: the sail is deliberately edge-on and coasting.
        if (s.feather > 0.02) {
            c.strokeStyle = 'rgba(125,232,255,' + (0.5 * s.feather).toFixed(3) + ')';
            c.lineWidth = 1.4;
            c.setLineDash([3, 5]);
            c.beginPath(); c.arc(x, y, 40, 0, 6.2832); c.stroke();
            c.setLineDash([]);
        }

        // Velocity arrow: momentum you cannot see is momentum you cannot plan.
        var sp = mag(s.ship.vx, s.ship.vy);
        if (sp > 5) {
            var va = Math.atan2(s.ship.vy, s.ship.vx);
            var vl = Math.min(78, sp * 0.32);
            c.strokeStyle = 'rgba(125,232,255,0.75)'; c.lineWidth = 2;
            c.beginPath(); c.moveTo(x, y);
            c.lineTo(x + Math.cos(va) * vl, y + Math.sin(va) * vl);
            c.stroke();
        }
    }

    /* ── frame ────────────────────────────────────────────────────────── */
    function draw(g, c) {
        var s = g.s;
        if (!s || !s.gates) return;
        var cx = viewX, cy = viewY;
        var SR = sunR(g);
        var sh = s.ship;
        var shx = cx + sh.ox, shy = cy + sh.oy;

        g.space(c, { bg: '#04050d', driftX: -4, driftY: 1 });

        // The attract screen lays a 62% scrim and a 10px blur over the canvas,
        // so the idle Sun is lit harder to survive it. Omitting this argument
        // made every corona alpha NaN and threw on addColorStop each frame.
        drawSun(g, c, cx, cy, SR, g.running ? 1 : 1.7);

        // Target altitude: a faint circle at the next gate's orbital radius, so
        // "raise the orbit" is a thing you can see rather than infer.
        var tgt = s.gates[s.idx];
        if (tgt) {
            c.save();
            c.strokeStyle = 'rgba(' + GOLD + ',0.10)';
            c.lineWidth = 1;
            c.setLineDash([2, 9]);
            c.lineDashOffset = -g.t * 12;
            // The gate's true orbital radius, not its polar parameter — the
            // course is stretched horizontally, so those are no longer equal.
            c.beginPath(); c.arc(cx, cy, mag(tgt.ox, tgt.oy), 0, 6.2832); c.stroke();
            c.setLineDash([]);
            c.restore();
        }

        // Gates, back to front so the live ones bloom over the dead ones.
        c.textAlign = 'center';
        for (var i = 0; i < s.gates.length; i++) {
            var gt = s.gates[i];
            var rank = gt.hit ? -1 : (i - s.idx);
            if (rank < -1) rank = -1;
            var numA = drawGate(g, c, gt, rank, shx, shy);
            if (numA > 0) {
                var fs = rank === 0 ? 17 : 14;
                c.fillStyle = 'rgba(' + GOLD + ',' + numA + ')';
                c.font = '600 ' + fs + 'px "Space Grotesk", Inter, sans-serif';
                c.fillText(String(i + 1), gt.x, gt.y + fs * 0.35);
            }
        }
        c.textAlign = 'left';

        // Lookahead chain: projected position → this gate → the next one, so the
        // turn you are about to need is legible before you commit to it.
        var g1 = s.gates[s.idx], g2 = s.gates[s.idx + 1];
        if (g1) {
            var px = shx + sh.vx * 0.45, py = shy + sh.vy * 0.45;
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.strokeStyle = 'rgba(' + GOLD + ',0.34)';
            c.lineWidth = 1.7;
            c.setLineDash([7, 11]);
            c.lineDashOffset = -g.t * 34;
            c.beginPath();
            c.moveTo(px, py);
            var q1 = bow(cx, cy, px, py, g1.x, g1.y, 0.22);
            c.quadraticCurveTo(q1.x, q1.y, g1.x, g1.y);
            if (g2) {
                var q2 = bow(cx, cy, g1.x, g1.y, g2.x, g2.y, 0.3);
                c.quadraticCurveTo(q2.x, q2.y, g2.x, g2.y);
            }
            c.stroke();
            c.setLineDash([]);
            c.restore();
        }

        // Gate-clear shockwaves.
        c.save();
        c.globalCompositeOperation = 'lighter';
        for (var pu = 0; pu < s.pulses.length; pu++) {
            var pl = s.pulses[pu];
            var pf = 1 - pl.age / 0.6;
            c.strokeStyle = 'rgba(' + GOLD + ',' + (0.7 * pf).toFixed(3) + ')';
            c.lineWidth = 2.5 * pf + 0.5;
            c.beginPath(); c.arc(pl.x, pl.y, pl.r + pl.age * 190, 0, 6.2832); c.stroke();
        }
        c.restore();

        // Trail, additive and fading toward its tail.
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.lineCap = 'round';
        for (var t = 1; t < s.trail.length; t++) {
            var f = t / s.trail.length;
            c.strokeStyle = 'rgba(' + GOLD + ',' + (0.30 * f * f).toFixed(3) + ')';
            c.lineWidth = 0.6 + f * 2.2;
            c.beginPath();
            c.moveTo(cx + s.trail[t - 1].x, cy + s.trail[t - 1].y);
            c.lineTo(cx + s.trail[t].x, cy + s.trail[t].y);
            c.stroke();
        }
        c.restore();

        // Where this attitude actually takes you over the next ~2.4s.
        if (g.running) {
            var pts = predict(g, s);
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.lineWidth = 1.6;
            for (var q = 2; q < pts.length; q += 2) {
                var pf2 = 1 - (q / pts.length);
                c.strokeStyle = 'rgba(125,232,255,' + (0.42 * pf2).toFixed(3) + ')';
                c.beginPath();
                c.moveTo(cx + pts[q - 2], cy + pts[q - 1]);
                c.lineTo(cx + pts[q], cy + pts[q + 1]);
                c.stroke();
            }
            if (pts.length >= 2) {
                c.fillStyle = 'rgba(125,232,255,0.5)';
                c.beginPath(); c.arc(cx + pts[pts.length - 2], cy + pts[pts.length - 1], 2.6, 0, 6.2832); c.fill();
            }
            c.restore();
        }

        // Sunlight arriving at the ship, with the photons visibly travelling.
        var toShip = Math.atan2(sh.oy, sh.ox);
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.strokeStyle = 'rgba(' + GOLD + ',' + (0.10 + s.lit * 0.20).toFixed(3) + ')';
        c.setLineDash([5, 12]);
        c.lineDashOffset = -g.t * 110;
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(cx + Math.cos(toShip) * SR, cy + Math.sin(toShip) * SR);
        c.lineTo(shx, shy);
        c.stroke();
        c.setLineDash([]);
        c.restore();

        drawShip(g, c, s, shx, shy, toShip);

        // Leaving the system: an edge marker, a heading home and a countdown.
        if (s.escape > 0) {
            var left = ESCAPE_GRACE - s.escape;
            var puls = 0.55 + 0.45 * Math.sin(g.t * 9);
            var vg = c.createRadialGradient(g.w / 2, g.h / 2, Math.min(g.w, g.h) * 0.28,
                                            g.w / 2, g.h / 2, Math.max(g.w, g.h) * 0.7);
            vg.addColorStop(0, 'rgba(255,60,60,0)');
            vg.addColorStop(1, 'rgba(255,60,60,' + (0.30 * puls).toFixed(3) + ')');
            c.fillStyle = vg;
            c.fillRect(0, 0, g.w, g.h);

            var mx = Math.max(28, Math.min(g.w - 28, shx));
            var my = Math.max(56, Math.min(g.h - 40, shy));
            var home = Math.atan2(cy - shy, cx - shx);
            c.save();
            c.translate(mx, my);
            c.strokeStyle = 'rgba(255,139,139,' + (0.55 + 0.45 * puls).toFixed(3) + ')';
            c.lineWidth = 2.4;
            c.beginPath(); c.arc(0, 0, 15, 0, 6.2832); c.stroke();
            c.rotate(home);
            c.beginPath();
            c.moveTo(16, 0); c.lineTo(38, 0);
            c.moveTo(38, 0); c.lineTo(29, -7);
            c.moveTo(38, 0); c.lineTo(29, 7);
            c.stroke();
            c.restore();

            c.fillStyle = 'rgba(255,139,139,0.95)';
            c.font = '600 15px "Space Grotesk", Inter, sans-serif';
            c.textAlign = 'center';
            c.fillText('RETURN  ' + left.toFixed(1) + 's', mx, my + 34);
            c.textAlign = 'left';
        }

        // Corona heat rim: the reward side of the gamble, on the ship itself.
        if (s.heatNow > 0.02) {
            g.bloom(c, shx, shy, 46 + s.heatNow * 40, 'rgba(255,154,61,' + (0.20 * s.heatNow).toFixed(3) + ')');
        }

        // Aim reticle — the OS cursor is hidden, so this is the pointer.
        var rx = g.pointer.x, ry = g.pointer.y;
        var rl = g.pointer.down ? 0.85 : 0.35;
        c.strokeStyle = 'rgba(' + GOLD + ',' + rl + ')';
        c.lineWidth = 1.3;
        c.beginPath(); c.arc(rx, ry, 9, 0, 6.2832); c.stroke();
        c.beginPath();
        c.moveTo(rx - 15, ry); c.lineTo(rx - 4, ry);
        c.moveTo(rx + 4, ry); c.lineTo(rx + 15, ry);
        c.moveTo(rx, ry - 15); c.lineTo(rx, ry - 4);
        c.moveTo(rx, ry + 4); c.lineTo(rx, ry + 15);
        c.stroke();

        if (g.running) {
            var frac = Math.max(0, s.time / TIME_LIMIT);
            c.fillStyle = 'rgba(255,255,255,0.08)';
            c.fillRect(0, g.h - 7, g.w, 7);
            c.fillStyle = frac < 0.15 ? '#ff8b8b' : '#ffd35a';
            c.fillRect(0, g.h - 7, g.w * Math.min(1, frac), 7);
            if (frac < 0.15) {
                c.save();
                c.globalCompositeOperation = 'lighter';
                c.globalAlpha = 0.4 + 0.4 * Math.sin(g.t * 8);
                c.fillStyle = '#ff8b8b';
                c.fillRect(0, g.h - 7, g.w * Math.min(1, frac), 7);
                c.restore();
            }
        }
    }

    function onResize(g) {
        viewSet = false;
        var s = g.s;
        if (!g.running || !s || !s.gates) { initMenu(g); return; }
        // Keep the course proportional to the new viewport: gm scales with the
        // cube of the short side, so distances and speeds scale linearly.
        var nS = Math.min(g.w, g.h);
        var k = s.S ? nS / s.S : 1;
        if (isFinite(k) && k > 0 && k !== 1) {
            for (var i = 0; i < s.gates.length; i++) {
                s.gates[i].ox *= k; s.gates[i].oy *= k; s.gates[i].d *= k;
            }
            s.ship.ox *= k; s.ship.oy *= k;
            s.ship.vx *= k; s.ship.vy *= k;
            for (var t = 0; t < s.trail.length; t++) { s.trail[t].x *= k; s.trail[t].y *= k; }
        }
        s.S = nS;
        stepView(g, 0);
        syncGates(s);
    }

    Arcade.create({
        slug: 'solar-sailor',
        title: 'SOLAR SAILOR',
        accent: '#ffd35a',
        tagline: 'You have no engine. The Sun pulls you in and its light pushes you out along the yellow arrow — never inward. Bend the orbit through all twelve gates, and skim the corona to bank charge for a bigger payout.',
        controls: [
            ['A / D', 'rotate the sail'],
            ['HOLD MOUSE', 'aim the sail normal at the cursor'],
            ['SHIFT', 'feather the sail edge-on and coast']
        ],
        scoreLabel: 'SCORE',
        overTitle: 'ADRIFT',
        winTitle: 'ALL GATES CLEARED',
        hideCursor: true,
        init: init,
        initMenu: initMenu,
        idle: idle,
        update: update,
        draw: draw,
        onResize: onResize
    });
})();

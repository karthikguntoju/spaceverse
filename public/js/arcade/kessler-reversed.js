/**
 * Kessler Reversed — you are paid to cause the cascade.
 *
 * The mission version of Kessler asks you to prevent a chain reaction, which is
 * a job. This asks you to start one and then watch, which is a firework. Same
 * physics, opposite goal, and all the payoff is in the ripple.
 *
 * A contract is three bolts and one SHUNT. The bolts are the aim; the shunt is
 * the save — a single right-click (or two-finger tap) that kicks every fragment
 * near the cursor outward, so a chain about to die in an empty gap can be shoved
 * into the next lane instead. Three shots plus one shunt is four real decisions,
 * and the shunt is the only one you make while the debris is already flying.
 *
 * The field is rebuilt per run from one of four seeded layouts, each with its
 * own score multiplier, so "which lane is busiest" is a fresh question every
 * time. One satellite in eight is hardened: it eats its first fragment and
 * turns cold blue, which makes where you aim inside a lane matter.
 */
(function () {
    'use strict';

    var TAU = 6.2832;

    var SATS = 210;
    var SHOTS_TOTAL = 3;

    /* Cascade economy. Each kill throws FRAG_PER_KILL fragments and each
       fragment is spent on the collision it causes, so the branching factor is
       2 × (chance a fragment finds a target before it burns out) — a number
       that falls as the lane thins, which is what makes a cascade stop.
       It used to be 3 fragments that were never consumed and lived nine
       seconds: one bolt scythed the sky (measured: 178 of 210 kills on shot 1,
       and a full wipe in 100% of runs), so shots 2 and 3 were decoration and
       the score ran to ~314k against a 40k gold tier. At 2 and 1.0s a first
       bolt takes about a third of the field, all three shots pay, and a total
       cascade goes back to being something you brag about. */
    var FRAG_PER_KILL = 2;
    var FRAG_SPEED = 190;
    var FRAG_LIFE = 1.0;
    var SAT_R = 4.2;
    var FRAG_R = 2.4;
    var PULSE_LIFE = 0.45;

    /* Satellites live on rings 3..8 at `maxR * (0.22 + ring * 0.085)`. Every
       radius in this file goes through ringR(), so the drawn lanes and the
       occupied orbits cannot drift apart again. */
    var RING_LO = 3, RING_HI = 8, RING_N = RING_HI - RING_LO + 1;
    var RING_JITTER = 7;
    var BAND_W = RING_JITTER * 2 + 4;   // annulus wide enough to hold the jitter

    /* Broad-phase gate for fragment/satellite tests. The widest real contact
       distance is (biggest satellite ≈ 6) + FRAG_R + 1.5 ≈ 10, so 13 rejects
       almost everything while keeping 3px of margin over a genuine hit. */
    var GATE = 13;

    var SHUNT_R = 150;
    /* Debris burns out in a second, so a shunt that only nudged velocity by 55
       against a base ~200 was a firework with no consequence. The shunt is one
       of four decisions in a run: it now pushes hard AND hands the fragments a
       fresh lifetime, which is exactly the advertised save — a chain dying in
       an empty gap gets the range to reach the next lane. */
    var SHUNT_V = 130;
    var SHUNT_COL = '#7ee7ff';
    var HARD_COL = '#9fb7ff';
    var HARD_TOP = '#dce6ff';

    var BASE_TAGLINE = 'A demolition contract. Two hundred satellites, three bolts, one shunt. ' +
        'Fire into the busiest lane you can find, shunt the debris when the chain starts to starve, ' +
        'then let it settle and fire again.';

    /* Four seeded fields. Inner lanes are short, so debris crosses them again
       and again — cheap chains, and the multiplier says so. Outer lanes are
       long and thin: harder to light, worth more when they go. */
    var LAYOUTS = [
        { id: 'DENSE INNER',  mult: 0.90, w: [6, 5, 4, 2, 1, 1], note: 'traffic stacked low — short lanes, short fuses' },
        { id: 'DENSE OUTER',  mult: 1.35, w: [1, 1, 2, 4, 5, 6], note: 'traffic stacked high — long lanes, long odds' },
        { id: 'TWO CLUSTERS', mult: 1.20, w: [1, 1, 1, 1, 1, 1], note: 'two knots of traffic and a lot of dead sky' },
        { id: 'UNIFORM',      mult: 1.00, w: [1, 1, 1, 1, 1, 1], note: 'an even sky — no favours either way' }
    ];

    function ringR(maxR, ring) { return maxR * (0.22 + ring * 0.085); }

    /* The menu card's tagline is the one crisp surface on the menu (the canvas
       sits behind a blurred scrim), so the layout announcement goes there. */
    var menuTag = null;
    function announce(s) {
        if (!menuTag || !s) return;
        menuTag.textContent = BASE_TAGLINE + '  FIELD: ' + s.layout + ' — ' + s.layoutNote +
            '. Score ×' + s.mult.toFixed(2) + '.';
    }

    /* The shell hands cfg.pointerDown the game object but not the event, so the
       button lands here first: a capture-phase listener on the document always
       runs before the canvas's own at-target handler. Right mouse button, or a
       non-primary touch pointer (a second finger), means shunt rather than fire. */
    var shuntRequested = false;
    document.addEventListener('pointerdown', function (e) {
        shuntRequested = (e.button === 2) ||
            (e.pointerType && e.pointerType !== 'mouse' && e.isPrimary === false);
    }, true);

    /* The OS cursor is hidden over the canvas, so the reticle has to stand in
       for it everywhere the canvas is actually reachable — including the top
       strip, which the (pointer-events:none) topbar lets clicks fall through
       even while the menu card is up. */
    var overCanvas = false;

    /* `deny` is the answer to a click the game cannot honour: the reticle drops
       its colour and gets struck through, so a refused input still reads as an
       input rather than as a dead mouse. */
    function reticle(g, c, hot, deny) {
        var r = deny ? 9 : hot ? 11 : 6;
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.strokeStyle = deny ? 'rgba(138,160,200,0.85)'
            : hot ? 'rgba(251,191,36,0.9)' : 'rgba(232,238,252,0.5)';
        c.lineWidth = deny ? 2 : 1.5;
        c.beginPath();
        c.arc(g.pointer.x, g.pointer.y, r, 0, TAU);
        c.moveTo(g.pointer.x - r - 6, g.pointer.y); c.lineTo(g.pointer.x - r - 1, g.pointer.y);
        c.moveTo(g.pointer.x + r + 1, g.pointer.y); c.lineTo(g.pointer.x + r + 6, g.pointer.y);
        c.moveTo(g.pointer.x, g.pointer.y - r - 6); c.lineTo(g.pointer.x, g.pointer.y - r - 1);
        c.moveTo(g.pointer.x, g.pointer.y + r + 1); c.lineTo(g.pointer.x, g.pointer.y + r + 6);
        if (deny) {
            c.moveTo(g.pointer.x - r * 0.72, g.pointer.y - r * 0.72);
            c.lineTo(g.pointer.x + r * 0.72, g.pointer.y + r * 0.72);
        }
        c.stroke();
        c.restore();
    }

    /* ── aim ray ───────────────────────────────────────────────────────────
       Bolts always launch from (cx, h + 40). The keyboard steers `s.aimA` and
       parks the reticle on that ray, so the pointer path and the key path are
       the same geometry and fire through the same function. */

    function rayT(g, s) {
        var oy = g.h + 40;
        var ca = Math.cos(s.aimA), sn = Math.sin(s.aimA);
        var t = (oy - 12) / -sn;                              // sn is always < 0
        if (ca > 0.001) t = Math.min(t, (g.w - 12 - s.cx) / ca);
        else if (ca < -0.001) t = Math.min(t, (s.cx - 12) / -ca);
        return t;
    }

    function aimBy(g, s, d) {
        if (s.aimA == null) s.aimA = g.angleTo(s.cx, g.h + 40, g.pointer.x, g.pointer.y);
        // Clamped to the upward half-plane: a bolt fired sideways off the
        // bottom corner can never reach a lane.
        s.aimA = g.clamp(s.aimA + d, -Math.PI + 0.16, -0.16);
        var t = rayT(g, s) * 0.72;
        g.pointer.x = s.cx + Math.cos(s.aimA) * t;
        g.pointer.y = g.h + 40 + Math.sin(s.aimA) * t;
    }

    /* ── field ─────────────────────────────────────────────────────────── */

    function makeField(g) {
        var cx = g.w / 2, cy = g.h / 2;
        var maxR = Math.min(g.w, g.h) * 0.46;

        // One seed drives the whole field, so a layout is reproducible and the
        // menu can promise exactly the sky you are about to shoot at.
        var seed = 1 + Math.floor(Math.random() * 99991);
        var n = seed;
        function rnd() { n += 1; return g.hash(n * 12.9898 + seed * 0.618); }

        var lay = LAYOUTS[Math.min(LAYOUTS.length - 1, Math.floor(rnd() * LAYOUTS.length))];
        var clustered = lay.id === 'TWO CLUSTERS';

        var cum = [], tot = 0, k;
        for (k = 0; k < RING_N; k++) { tot += lay.w[k]; cum[k] = tot; }

        var anchorA = rnd() * TAU;
        var anchorB = anchorA + 2.0 + rnd() * 2.2;

        var sats = [];
        var ringSpawn = [0, 0, 0, 0, 0, 0];
        for (var i = 0; i < SATS; i++) {
            var t = rnd() * tot, ri = RING_N - 1;
            for (k = 0; k < RING_N; k++) { if (t <= cum[k]) { ri = k; break; } }
            var ring = RING_LO + ri;
            ringSpawn[ri]++;

            var r = ringR(maxR, ring) + (rnd() - 0.5) * RING_JITTER * 2;

            var a;
            if (clustered && rnd() > 0.12) {
                a = (rnd() < 0.5 ? anchorA : anchorB) + (rnd() - 0.5) * 1.1;
            } else {
                a = rnd() * TAU;
            }
            a -= Math.floor(a / TAU) * TAU;

            var hue = 210 + (rnd() - 0.5) * 44;
            var hard = (i % 8) === 3;                 // 1 in 8, evenly spread
            var rf = ri / (RING_N - 1);               // 0 inner … 1 outer

            // Size falls off with orbit: the low lanes read as closer traffic,
            // and a hardened bus is visibly a bigger, duller target.
            var rad = SAT_R * (1.18 - 0.34 * rf) * (0.92 + rnd() * 0.16) + (hard ? 0.6 : 0);
            var reach = rad + FRAG_R + 1.5;

            var sat = {
                ring: ring, ri: ri,
                id: i + 1,               // stable seed for this bus's silhouette
                r: r,
                a: a,
                w: (clustered ? 1 : (rnd() < 0.5 ? 1 : -1)) *
                   (0.34 - r / (maxR * 6)) * (clustered ? 1 : 0.85 + rnd() * 0.3),
                alive: true,
                hard: hard, cracked: false,
                // Precomputed at spawn: 210 of these draw every frame, so the
                // draw loop must never build a colour string or a gradient.
                rad: rad,
                hi: rad * 0.46,          // highlight cap radius
                lit: rad * 0.34,         // how far the cap sits toward Earth
                hit2: reach * reach,     // squared contact distance
                col: hard ? 'hsl(' + hue.toFixed(1) + ',24%,54%)' : 'hsl(' + hue.toFixed(1) + ',85%,72%)',
                colTop: hard ? 'hsl(' + hue.toFixed(1) + ',30%,72%)' : 'hsl(' + hue.toFixed(1) + ',92%,88%)',
                panel: false, pa: 0, pw: 0, panelCol: ''
            };
            // Roughly 1 in 6 carries a solar-panel bar, turning slowly so the
            // field has motion at rest as well as around the planet.
            if (i % 6 === 0) {
                sat.panel = true;
                sat.pa = rnd() * TAU;
                sat.pw = (rnd() - 0.5) * 0.5;
                sat.panelCol = hard ? 'hsl(' + hue.toFixed(1) + ',18%,36%)'
                                    : 'hsl(' + hue.toFixed(1) + ',65%,46%)';
            }
            sats.push(sat);
        }

        var ringMax = 1;
        for (k = 0; k < RING_N; k++) if (ringSpawn[k] > ringMax) ringMax = ringSpawn[k];

        // City lights live on the dark limb (lower-right, away from the
        // gradient highlight). Fractions of Earth radius, so resize survives.
        var city = [];
        for (k = 0; k < 5; k++) {
            city.push({
                a: 0.88 + (g.hash(k * 13.7 + 3.1) - 0.5) * 1.5,
                f: 0.62 + g.hash(k * 7.1 + 1.7) * 0.33,
                r: 0.8 + g.hash(k * 3.3 + 5.9) * 0.7,
                tw: 1.5 + g.hash(k * 9.4 + 2.3) * 3.4,
                ph: g.hash(k * 5.5 + 8.1) * TAU
            });
        }

        return {
            cx: cx, cy: cy, maxR: maxR, sats: sats, city: city,
            seed: seed, layout: lay.id, layoutNote: lay.note, mult: lay.mult,
            ringSpawn: ringSpawn, ringAlive: ringSpawn.slice(), ringMax: ringMax
        };
    }

    /* The field on the menu is the field you play. initMenu builds one and
       parks it here; the first startRun adopts it instead of rolling a new
       sky, so the lanes you were reading do not vanish on PLAY. */
    var parked = null;

    function init(g) {
        if (parked && parked.shotNum === 0 && parked.killed === 0) {
            g.s = parked;
            parked = null;
            return;
        }
        var f = makeField(g);
        g.s = {
            cx: f.cx, cy: f.cy, maxR: f.maxR,
            sats: f.sats,
            city: f.city,
            seed: f.seed,
            layout: f.layout, layoutNote: f.layoutNote, mult: f.mult,
            ringSpawn: f.ringSpawn, ringAlive: f.ringAlive, ringMax: f.ringMax,
            frags: [],
            shot: null,
            shotsLeft: SHOTS_TOTAL,
            shotNum: 0,          // how many shots have been fired so far
            resolving: false,    // a shot (or its debris) is still playing out
            killed: 0,
            hardCracked: 0,
            chain: 0,
            bestChain: 0,
            chainT: 0,
            chainScale: 1,
            settleT: 0,
            pulses: [],
            slowmo: 1,
            shuntLeft: 1,
            shuntFx: null,
            wash: 0, washTier: 0,
            tierT: 0, tierWord: '',
            cascadeShown: false,
            aimA: null,          // keyboard aim angle; null = follow the pointer
            denyT: 0,            // "that click could not be honoured" timer
            hx: []               // scratch buffer for batched armour rings
        };
        announce(g.s);
    }

    function initMenu(g) {
        init(g);
        parked = g.s;
    }

    /* ── the cascade ───────────────────────────────────────────────────── */

    var TIER_WORDS = ['', 'CHAIN REACTION', 'CASCADE', 'KESSLER SYNDROME'];

    function killSat(g, s, sat, sx, sy) {
        sat.alive = false;
        s.killed++;
        s.chain++;
        s.chainT = 1.8;
        s.ringAlive[sat.ri]--;
        s.bestChain = Math.max(s.bestChain, s.chain);

        var chain = s.chain;
        g.addScore(Math.round((100 + chain * 12) * s.mult * (sat.hard ? 1.6 : 1)));

        // Everything below scales with the chain: the run is the cascade, so
        // the twentieth kill must not feel like the first.
        var heat = Math.min(1, chain / 40);
        g.shake(Math.min(22, 2 + chain * 0.32));
        g.sfx('hit', 1 + Math.min(1.4, chain * 0.035));
        g.burst(sx, sy, { n: 9 + Math.round(heat * 12), colour: '#fbbf24', speed: 170 + heat * 190, life: 0.5 + heat * 0.25, size: 2 });
        g.burst(sx, sy, { n: 6 + Math.round(heat * 10), colour: '#fff3c4', speed: 280 + heat * 260, life: 0.45, size: 1.6, shape: 'spark' });
        s.pulses.push({ x: sx, y: sy, age: 0, heat: heat });

        // Counter kicks 8% per kill and eases back down between them.
        s.chainScale = Math.min(2.0, s.chainScale * 1.08);

        // Every tenth kill drops back into slow motion, so a long cascade is a
        // sequence of held beats instead of one undifferentiated blur.
        if (s.killed % 10 === 0) s.slowmo = Math.min(s.slowmo, 0.5);

        // Chain milestones wash the whole screen in additive amber.
        var tier = chain === 5 ? 1 : chain === 15 ? 2 : chain === 40 ? 3 : 0;
        if (tier) {
            s.wash = 0.2; s.washTier = tier;
            s.tierT = 1.1; s.tierWord = TIER_WORDS[tier];
            g.sfx('boom', 0.7 + tier * 0.25);
            g.shake(10 + tier * 6);
        }

        for (var i = 0; i < FRAG_PER_KILL; i++) {
            var a = Math.random() * TAU;
            var sp = FRAG_SPEED * g.rand(0.6, 1.5);
            s.frags.push({
                x: sx, y: sy,
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                life: FRAG_LIFE
            });
        }
    }

    function shunt(g) {
        var s = g.s;
        if (!s) return;
        if (s.shuntLeft <= 0) { g.sfx('tick', 0.55); g.flash('SHUNT SPENT', '#8aa0c8', 500); return; }
        s.shuntLeft--;
        var px = g.pointer.x, py = g.pointer.y;
        var moved = 0;
        for (var i = 0; i < s.frags.length; i++) {
            var fr = s.frags[i];
            var dx = fr.x - px, dy = fr.y - py;
            var d = Math.hypot(dx, dy);
            if (d > SHUNT_R) continue;
            if (d < 0.001) { dx = 1; dy = 0; d = 1; }
            fr.vx += (dx / d) * SHUNT_V;
            fr.vy += (dy / d) * SHUNT_V;
            if (fr.life < FRAG_LIFE) fr.life = FRAG_LIFE;   // second wind
            moved++;
        }
        s.shuntFx = { x: px, y: py, age: 0, n: moved };
        g.shake(8);
        g.sfx('boom', 1.6);
        g.burst(px, py, { n: 18, colour: SHUNT_COL, speed: 300, life: 0.45, size: 1.7, shape: 'spark' });
        g.flash(moved ? 'SHUNT · ' + moved + ' PUSHED' : 'SHUNT · NOTHING IN RANGE', SHUNT_COL, 650);
    }

    /* ── update ────────────────────────────────────────────────────────── */

    function update(g, dt) {
        var s = g.s;
        var rdt = dt;            // unscaled: aim and UI timers ignore slow-mo
        dt *= s.slowmo;

        var i, j, k;

        // Keyboard aim, polled so a held key sweeps instead of stepping once
        // per keypress. The reticle is parked on the ray, so Space fires down
        // exactly the same path a click does.
        var turn = 0;
        if (g.key('ArrowLeft') || g.key('KeyA')) turn -= 1;
        if (g.key('ArrowRight') || g.key('KeyD')) turn += 1;
        if (turn) aimBy(g, s, turn * 1.25 * rdt);

        if (s.denyT > 0) s.denyT -= rdt;

        // Orbits keep turning the whole time, so the field the debris flies into
        // is never the field you aimed at. That is where the luck lives.
        // Angles stay wrapped to [0, TAU) because the broad phase compares them.
        for (i = 0; i < s.sats.length; i++) {
            var st = s.sats[i];
            if (!st.alive) continue;
            st.a += st.w * dt;
            if (st.a >= TAU) st.a -= TAU; else if (st.a < 0) st.a += TAU;
            if (st.panel) st.pa += st.pw * dt;
        }

        // A shot is just a fast fragment with a brighter tail. It moves ~15px a
        // frame, so it is stepped four times against the field: a bolt that
        // visibly passes through a satellite used to be able to miss it.
        if (s.shot) {
            var sh = s.shot;
            var sdt = dt * 0.25;
            for (var step = 0; step < 4 && s.shot; step++) {
                sh.x += sh.vx * sdt; sh.y += sh.vy * sdt;
                var shR = Math.hypot(sh.x - s.cx, sh.y - s.cy);
                for (k = 0; k < s.sats.length; k++) {
                    var sa = s.sats[k];
                    if (!sa.alive) continue;
                    if (sa.r > shR + GATE || sa.r < shR - GATE) continue;
                    var kx = s.cx + Math.cos(sa.a) * sa.r;
                    var ky = s.cy + Math.sin(sa.a) * sa.r;
                    var kdx = sh.x - kx, kdy = sh.y - ky;
                    var kr = sa.rad + 5;
                    if (kdx * kdx + kdy * kdy < kr * kr) {
                        // A kinetic bolt goes through armour; only debris is
                        // slow enough for a hardened bus to shrug off.
                        killSat(g, s, sa, kx, ky);
                        s.shot = null;
                        s.slowmo = 0.32;
                        break;
                    }
                }
            }
            if (s.shot) {
                sh.life -= dt;
                g.burst(sh.x, sh.y, { n: 1, speed: 20, colour: '#ffffff', life: 0.35, size: 2 });
                if (sh.life <= 0 || sh.x < -60 || sh.x > g.w + 60 || sh.y < -60 || sh.y > g.h + 60) {
                    // A miss just spends the bolt; the contract still has more.
                    s.shot = null;
                    g.flash('MISS', '#ff8b8b', 900);
                }
            }
        }

        if (s.slowmo < 1) s.slowmo = Math.min(1, s.slowmo + dt * 1.6);

        // Fragment sweep. Two broad-phase gates run before any trigonometry:
        // the fragment's own orbital radius (one hypot per fragment, hoisted
        // out of the satellite loop) and its arc distance along the lane. What
        // used to be frags × sats object allocations plus a hypot each is now
        // a couple of compares for all but the handful of genuine candidates.
        for (var f = s.frags.length - 1; f >= 0; f--) {
            var fr = s.frags[f];
            fr.x += fr.vx * dt; fr.y += fr.vy * dt;
            fr.life -= dt;
            var out = fr.x < -80 || fr.x > g.w + 80 || fr.y < -80 || fr.y > g.h + 80;
            if (fr.life <= 0 || out) { s.frags.splice(f, 1); continue; }

            var fdx = fr.x - s.cx, fdy = fr.y - s.cy;
            var frR = Math.hypot(fdx, fdy);
            var frA = Math.atan2(fdy, fdx);
            if (frA < 0) frA += TAU;

            for (j = 0; j < s.sats.length; j++) {
                var sb = s.sats[j];
                if (!sb.alive) continue;
                if (sb.r > frR + GATE || sb.r < frR - GATE) continue;
                var da = sb.a - frA;
                if (da > 3.1416) da -= TAU; else if (da < -3.1416) da += TAU;
                var arc = da * sb.r;                       // ≥ true chord, so safe to reject on
                if (arc > GATE || arc < -GATE) continue;

                var qx = s.cx + Math.cos(sb.a) * sb.r;
                var qy = s.cy + Math.sin(sb.a) * sb.r;
                var ddx = fr.x - qx, ddy = fr.y - qy;
                if (ddx * ddx + ddy * ddy >= sb.hit2) continue;

                if (sb.hard && !sb.cracked) {
                    // Hardened bus: the first fragment is spent on the shell.
                    sb.cracked = true;
                    sb.col = HARD_COL; sb.colTop = HARD_TOP;
                    s.hardCracked++;
                    g.burst(qx, qy, { n: 6, colour: HARD_COL, speed: 150, life: 0.3, size: 1.4, shape: 'spark' });
                    g.sfx('tick', 0.7);
                    s.frags.splice(f, 1);
                    break;
                }
                killSat(g, s, sb, qx, qy);
                // The fragment is spent in the collision it causes, the same
                // way one is spent on a hardened shell. Letting it fly on was
                // what turned every contract into a guaranteed total wipe.
                s.frags.splice(f, 1);
                break;
            }
        }

        for (var pi = s.pulses.length - 1; pi >= 0; pi--) {
            s.pulses[pi].age += dt;
            if (s.pulses[pi].age > PULSE_LIFE) s.pulses.splice(pi, 1);
        }

        if (s.shuntFx) { s.shuntFx.age += dt; if (s.shuntFx.age > 0.5) s.shuntFx = null; }
        if (s.wash > 0) s.wash -= dt;
        if (s.tierT > 0) s.tierT -= dt;

        s.chainT -= dt;
        if (s.chainT <= 0 && s.chain > 0) { s.chain = 0; s.chainScale = 1; }
        s.chainScale += (1 - s.chainScale) * Math.min(1, dt * 4);

        var aliveCount = 0;
        for (var m = 0; m < s.sats.length; m++) if (s.sats[m].alive) aliveCount++;

        var dots = '';
        for (var d = 0; d < SHOTS_TOTAL; d++) dots += (d < s.shotsLeft ? '●' : '○') + (d < SHOTS_TOTAL - 1 ? ' ' : '');
        g.hud('DESTROYED <b>' + s.killed + ' / ' + SATS + '</b><br>' +
              'LONGEST CHAIN <b>' + s.bestChain + '</b><br>' +
              'SHOTS <b>' + dots + '</b> · SHUNT <b style="color:' +
                  (s.shuntLeft > 0 ? SHUNT_COL + '">READY' : '#7d8aa6">SPENT') + '</b><br>' +
              'FIELD <b>' + s.layout + '</b> ×' + s.mult.toFixed(2) + ' · DEBRIS <b>' + s.frags.length + '</b>');

        if (aliveCount === 0 && !s.cascadeShown) {
            // Guarded: without the flag this re-fired every frame once the sky
            // was empty, and the banner never left the screen.
            s.cascadeShown = true;
            g.addScore(Math.round(5000 * s.mult));
            g.flash('TOTAL CASCADE', '#fbbf24', 1400);
            g.sfx('win');
        }

        // Chain settled: either hand the player the next bolt or close the
        // contract. A miss resolves through this exact same path.
        if (s.resolving && !s.shot && s.frags.length === 0) {
            s.settleT += dt;
            if (s.settleT > 1.1) {
                s.resolving = false;
                s.settleT = 0;
                if (s.shotsLeft > 0 && aliveCount > 0) {
                    g.flash('SHOT ' + (s.shotNum + 1) + ' OF ' + SHOTS_TOTAL, '#fbbf24', 900);
                    g.sfx('blip');
                } else {
                    var pct = Math.round((s.killed / SATS) * 100);
                    g.over(s.killed + ' of ' + SATS + ' satellites destroyed (' + pct + '% of the field) across ' +
                        s.shotNum + ' shot' + (s.shotNum === 1 ? '' : 's') + ', longest chain ' + s.bestChain +
                        '. Field ' + s.layout + ' at ×' + s.mult.toFixed(2) + '.',
                        s.killed > SATS * 0.35);
                    return;
                }
            }
        } else {
            s.settleT = 0;
        }
    }

    /* Menu and game-over scene. Without this the "live" menu is a freeze-frame
       with a moving starfield behind it. */
    function idle(g, dt) {
        var s = g.s;
        if (!s || !s.sats) return;
        for (var i = 0; i < s.sats.length; i++) {
            var st = s.sats[i];
            if (!st.alive) continue;
            st.a += st.w * dt * 0.55;      // the sky idles slower than it plays
            if (st.a >= TAU) st.a -= TAU; else if (st.a < 0) st.a += TAU;
            if (st.panel) st.pa += st.pw * dt * 0.55;
        }
        // Let anything still on screen when the run ended finish and settle
        // rather than hanging mid-bloom behind the card.
        for (var pi = s.pulses.length - 1; pi >= 0; pi--) {
            s.pulses[pi].age += dt;
            if (s.pulses[pi].age > PULSE_LIFE) s.pulses.splice(pi, 1);
        }
        if (s.shuntFx) { s.shuntFx.age += dt; if (s.shuntFx.age > 0.5) s.shuntFx = null; }
        if (s.wash > 0) s.wash -= dt;
        if (s.tierT > 0) s.tierT -= dt;
        if (s.chainT > 0) {
            s.chainT -= dt;
            if (s.chainT <= 0) { s.chain = 0; s.chainScale = 1; }
        }
        s.chainScale += (1 - s.chainScale) * Math.min(1, dt * 4);
    }

    /* Centre, radius and every orbit are cached at init; a window resize used
       to leave the field on the old geometry while the aim origin tracked the
       new one. Rescale in place so alive flags and chains survive. */
    function onResize(g) {
        var s = g.s;
        if (!s || !s.sats || !s.maxR) return;
        var ncx = g.w / 2, ncy = g.h / 2;
        var nmax = Math.min(g.w, g.h) * 0.46;
        var kk = nmax / s.maxR;
        var ocx = s.cx, ocy = s.cy;
        var i;
        for (i = 0; i < s.sats.length; i++) s.sats[i].r *= kk;
        for (i = 0; i < s.frags.length; i++) {
            s.frags[i].x = ncx + (s.frags[i].x - ocx) * kk;
            s.frags[i].y = ncy + (s.frags[i].y - ocy) * kk;
        }
        for (i = 0; i < s.pulses.length; i++) {
            s.pulses[i].x = ncx + (s.pulses[i].x - ocx) * kk;
            s.pulses[i].y = ncy + (s.pulses[i].y - ocy) * kk;
        }
        if (s.shot) {
            s.shot.x = ncx + (s.shot.x - ocx) * kk;
            s.shot.y = ncy + (s.shot.y - ocy) * kk;
        }
        s.cx = ncx; s.cy = ncy; s.maxR = nmax;
    }

    function pointerDown(g) {
        var s = g.s;
        if (shuntRequested) { shuntRequested = false; shunt(g); return; }
        // Fire only when a bolt remains and the previous chain has fully
        // resolved — chains play out one at a time. Every refusal answers,
        // though: clicking during the cascade is the most natural thing in the
        // game to do, and it used to return in silence, which is indis-
        // tinguishable from a broken mouse.
        if (s.shot) return;                      // bolt already in the air
        if (s.frags.length > 0) {
            s.denyT = 0.45;
            g.sfx('tick', 0.5);
            g.flash('CHAIN STILL RUNNING', '#8aa0c8', 450);
            return;
        }
        if (s.shotsLeft <= 0) {
            s.denyT = 0.45;
            g.sfx('tick', 0.5);
            g.flash('CONTRACT SPENT', '#8aa0c8', 450);
            return;
        }
        s.shotsLeft--;
        s.shotNum++;
        s.resolving = true;
        s.settleT = 0;
        var ox = s.cx, oy = g.h + 40;
        var a = g.angleTo(ox, oy, g.pointer.x, g.pointer.y);
        s.shot = { x: ox, y: oy, vx: Math.cos(a) * 900, vy: Math.sin(a) * 900, life: 4 };
        g.sfx('thrust');
        g.flash('FIRED', '#fbbf24', 500);
    }

    /* Moving the mouse hands aim back to the pointer, so the next arrow press
       starts from where you are looking rather than from a stale angle. */
    function pointerMove(g) {
        if (g.s) g.s.aimA = null;
    }

    /* The whole game was mouse-only: a keyboard player could press Space on the
       menu to start a run and then had no way to take a single action in it.
       Arrows/A-D steer, Space fires through pointerDown, Shift shunts. */
    function keyDown(g, code) {
        if (!g.running) return;                  // Space on the menu = PLAY
        var s = g.s;
        if (!s || !s.sats) return;

        if (code === 'Space' || code === 'Enter') {
            // A stale right-click must never turn a keyboard shot into a shunt.
            shuntRequested = false;
            pointerDown(g);
            return;
        }
        if (code === 'ShiftLeft' || code === 'ShiftRight') {
            // Halfway up the aim ray: the stretch of lane the debris is
            // actually crossing, and reachable without a mouse.
            if (s.aimA == null) s.aimA = g.angleTo(s.cx, g.h + 40, g.pointer.x, g.pointer.y);
            var t = rayT(g, s) * 0.36;
            g.pointer.x = s.cx + Math.cos(s.aimA) * t;
            g.pointer.y = g.h + 40 + Math.sin(s.aimA) * t;
            shunt(g);
            return;
        }
        // One nudge on the press so a tap is a tap; holding is swept in update.
        if (code === 'ArrowLeft' || code === 'KeyA') aimBy(g, s, -0.05);
        else if (code === 'ArrowRight' || code === 'KeyD') aimBy(g, s, 0.05);
    }

    /* ── draw ──────────────────────────────────────────────────────────── */

    function draw(g, c) {
        var s = g.s;
        g.space(c, { bg: '#03060f' });
        if (!s || !s.sats) return;

        var i;

        // Traffic lanes. These are the *actual* orbit radii, and each carries a
        // filled annulus whose weight tracks how much of that lane is still
        // flying — so a busy ring reads as a busy ring, and clearing one shows.
        // The band used to top out at 5% alpha, which is invisible: the one
        // instrument for the one decision in the game could not be read.
        for (i = 0; i < RING_N; i++) {
            var rr = ringR(s.maxR, RING_LO + i);
            var dens = s.ringAlive[i] / s.ringMax;
            if (dens < 0) dens = 0;
            var pulse = 0.88 + 0.12 * Math.sin(g.t * 0.7 + i * 1.1);
            c.strokeStyle = 'rgba(122,162,255,' + (0.16 * (0.22 + 0.78 * dens) * pulse).toFixed(4) + ')';
            c.lineWidth = BAND_W;
            c.beginPath(); c.arc(s.cx, s.cy, rr, 0, TAU); c.stroke();
            c.strokeStyle = 'rgba(122,162,255,' + (0.14 * (0.3 + 0.7 * dens)).toFixed(4) + ')';
            c.lineWidth = 1;
            c.beginPath(); c.arc(s.cx, s.cy, rr, 0, TAU); c.stroke();
        }

        // Earth: ambient haze, additive atmosphere halo, body, then a bright
        // additive rim so the limb reads as an atmosphere and not an outline.
        var eR = s.maxR * 0.19;
        g.glow(c, s.cx, s.cy, s.maxR * 0.34, 'rgba(40,110,200,0.30)');
        g.bloom(c, s.cx, s.cy, eR * 1.5, 'rgba(79,157,232,0.22)');
        var grd = c.createRadialGradient(s.cx - eR * 0.34, s.cy - eR * 0.4, eR * 0.06, s.cx, s.cy, eR);
        grd.addColorStop(0, '#3f86d8'); grd.addColorStop(1, '#123a68');
        c.fillStyle = grd;
        c.beginPath(); c.arc(s.cx, s.cy, eR, 0, TAU); c.fill();
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.strokeStyle = 'rgba(79,157,232,0.45)';
        c.lineWidth = 2;
        c.beginPath(); c.arc(s.cx, s.cy, eR + 1, 0, TAU); c.stroke();
        // Brighter crescent on the sun side, so the sphere has a direction.
        c.strokeStyle = 'rgba(150,205,255,0.5)';
        c.lineWidth = 2.4;
        c.beginPath(); c.arc(s.cx, s.cy, eR + 1, 3.34, 5.6); c.stroke();
        // City lights: warm specks on the night limb, breathing rather than
        // pinned, which is the difference between a planet and a decal.
        for (var ci = 0; ci < s.city.length; ci++) {
            var ct = s.city[ci];
            var tw = 0.6 + 0.4 * Math.sin(g.t * ct.tw + ct.ph);
            c.globalAlpha = 0.55 + 0.45 * tw;
            c.fillStyle = '#ffd9a0';
            var cxx = s.cx + Math.cos(ct.a) * eR * ct.f;
            var cyy = s.cy + Math.sin(ct.a) * eR * ct.f;
            c.beginPath(); c.arc(cxx, cyy, ct.r * (0.75 + 0.35 * tw), 0, TAU); c.fill();
        }
        c.globalAlpha = 1;
        c.restore();

        // 210 satellites: a body plus a light cap fakes a lit sphere with zero
        // gradients. The cap rides the Earth-facing side using the cos/sin
        // already computed for the position, so lighting is directional for
        // free. Panel sats add one rotated fillRect.
        //
        // Anything over 3.5px gets a real seeded silhouette instead of a
        // circle: two flat arcs at this size read as confetti, and a field of
        // 210 identical dots has no texture at all. The small outer-lane buses
        // stay circles — under 3.5px a hexagon is wasted vertices.
        var hx = s.hx, hn = 0;
        for (i = 0; i < s.sats.length; i++) {
            var st = s.sats[i];
            if (!st.alive) continue;
            var ca = Math.cos(st.a), sn = Math.sin(st.a);
            var x = s.cx + ca * st.r;
            var y = s.cy + sn * st.r;
            if (st.panel) {
                c.save();
                c.translate(x, y);
                c.rotate(st.pa);
                c.fillStyle = st.panelCol;
                c.fillRect(-7.5, -1.3, 15, 2.6);
                c.restore();
            }
            c.fillStyle = st.col;
            if (st.rad > 3.5) {
                // translate/untranslate rather than save/restore: this runs on
                // over a hundred satellites a frame, and the shell resets the
                // transform at the top of every frame anyway.
                c.translate(x, y);
                g.rockPath(c, st.rad, st.id, 6);
                c.fill();
                c.translate(-x, -y);
            } else {
                c.beginPath(); c.arc(x, y, st.rad, 0, TAU); c.fill();
            }
            c.fillStyle = st.colTop;
            c.beginPath(); c.arc(x - ca * st.lit, y - sn * st.lit, st.hi, 0, TAU); c.fill();
            if (st.hard && !st.cracked) { hx[hn++] = x; hx[hn++] = y; hx[hn++] = st.rad; }
        }
        // Armour rings for the hardened buses, batched into one stroke so the
        // "aim here and you waste a fragment" signal costs a single path.
        if (hn) {
            c.strokeStyle = 'rgba(159,183,255,0.55)';
            c.lineWidth = 1.2;
            c.beginPath();
            for (i = 0; i < hn; i += 3) {
                c.moveTo(hx[i] + hx[i + 2] + 2.2, hx[i + 1]);
                c.arc(hx[i], hx[i + 1], hx[i + 2] + 2.2, 0, TAU);
            }
            c.stroke();
        }

        // Live count on each lane's outer edge, fanned so six chips never stack.
        // A tinted band tells you which lane is busier; a number tells you by
        // how much, and says CLEAR the moment a lane is finished — which is the
        // only readout that makes "aim at the busiest lane" an actual decision
        // rather than a guess. Drawn after the traffic so it stays legible.
        c.save();
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.font = '600 11px "Space Grotesk", Inter, sans-serif';
        for (i = 0; i < RING_N; i++) {
            var na = s.ringAlive[i];
            if (na < 0) na = 0;
            var cang = -1.16 + i * 0.078;
            var crr = ringR(s.maxR, RING_LO + i) + BAND_W * 0.5 + 9;
            var lx = s.cx + Math.cos(cang) * crr;
            var ly = s.cy + Math.sin(cang) * crr;
            var lbl = na ? String(na) : 'CLEAR';
            var lw = lbl.length * 6.8 + 12;
            c.fillStyle = 'rgba(4,9,22,0.62)';
            c.fillRect(lx - lw * 0.5, ly - 8, lw, 16);
            c.strokeStyle = na ? 'rgba(122,162,255,0.42)' : 'rgba(251,191,36,0.5)';
            c.lineWidth = 1;
            c.strokeRect(lx - lw * 0.5, ly - 8, lw, 16);
            c.fillStyle = na
                ? 'rgba(198,216,255,' + (0.55 + 0.45 * (na / s.ringMax)).toFixed(3) + ')'
                : 'rgba(251,191,36,0.85)';
            c.fillText(lbl, lx, ly + 0.5);
        }
        c.restore();

        // Fragments as additive streaks along velocity: reads as debris in
        // motion, and the whole cloud is one batched stroke.
        if (s.frags.length) {
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.strokeStyle = '#ff8b8b';
            c.lineWidth = 2;
            c.beginPath();
            for (var f = 0; f < s.frags.length; f++) {
                var fr = s.frags[f];
                c.moveTo(fr.x, fr.y);
                c.lineTo(fr.x - fr.vx * 0.03, fr.y - fr.vy * 0.03);
            }
            c.stroke();
            c.restore();
        }

        // Kill shockwaves: short expanding rings, additive, hotter deeper into
        // a chain.
        if (s.pulses.length) {
            c.save();
            c.globalCompositeOperation = 'lighter';
            for (var pu = 0; pu < s.pulses.length; pu++) {
                var pl = s.pulses[pu];
                var pf = 1 - pl.age / PULSE_LIFE;
                c.strokeStyle = 'rgba(251,191,36,' + (0.6 * pf * (0.7 + pl.heat * 0.6)).toFixed(3) + ')';
                c.lineWidth = (2 * pf + 0.5) * (1 + pl.heat);
                c.beginPath(); c.arc(pl.x, pl.y, 6 + pl.age * 260, 0, TAU); c.stroke();
            }
            c.restore();
        }

        if (s.shuntFx) {
            var sf = s.shuntFx.age / 0.5;
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.strokeStyle = 'rgba(126,231,255,' + (0.75 * (1 - sf)).toFixed(3) + ')';
            c.lineWidth = 3 * (1 - sf) + 1;
            c.beginPath(); c.arc(s.shuntFx.x, s.shuntFx.y, SHUNT_R * (0.25 + sf * 0.85), 0, TAU); c.stroke();
            g.bloom(c, s.shuntFx.x, s.shuntFx.y, 70 * (1 - sf) + 20, 'rgba(126,231,255,' + (0.3 * (1 - sf)).toFixed(3) + ')');
            c.restore();
        }

        if (s.shot) {
            c.save();
            c.globalCompositeOperation = 'lighter';
            var tg = c.createLinearGradient(s.shot.x, s.shot.y, s.shot.x - s.shot.vx * 0.05, s.shot.y - s.shot.vy * 0.05);
            tg.addColorStop(0, 'rgba(255,240,200,0.9)');
            tg.addColorStop(1, 'rgba(255,240,200,0)');
            c.strokeStyle = tg; c.lineWidth = 3;
            c.beginPath();
            c.moveTo(s.shot.x, s.shot.y);
            c.lineTo(s.shot.x - s.shot.vx * 0.05, s.shot.y - s.shot.vy * 0.05);
            c.stroke();
            c.restore();
            g.bloom(c, s.shot.x, s.shot.y, 22, 'rgba(255,255,255,0.7)');
            c.fillStyle = '#fff';
            c.beginPath(); c.arc(s.shot.x, s.shot.y, 3.4, 0, TAU); c.fill();
        }

        // Milestone wash: the whole frame catches light for a fifth of a second.
        if (s.wash > 0) {
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.fillStyle = 'rgba(251,191,36,' + (0.04 * s.washTier * (s.wash / 0.2)).toFixed(4) + ')';
            c.fillRect(0, 0, g.w, g.h);
            c.restore();
        }

        // The chain counter is the scoreboard of the firework, kicked 8% on
        // every kill and easing back between them. It used to sit dead centre
        // at up to 220px and additive, which meant the payoff frame of the
        // whole game was a number covering Earth, the cascade it was counting,
        // and both prompts underneath it. It reads just as loud in the upper
        // third at half the size, over sky rather than over the show.
        if (s.chain >= 2 && s.chainT > 0) {
            var base = g.clamp(g.w * 0.09, 36, 70);
            var px = Math.round(base * s.chainScale);
            var al = g.clamp(s.chainT / 0.8, 0, 1);
            // Far enough down that the milestone word above it clears the topbar.
            var cty = Math.max(g.h * 0.22, px * 0.8 + 62);
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.font = '600 ' + px + 'px "Space Grotesk", Inter, sans-serif';
            c.fillStyle = 'rgba(251,191,36,' + (0.82 * al).toFixed(3) + ')';
            c.fillText('x' + s.chain, g.w / 2, cty);
            c.font = '600 13px "Space Grotesk", Inter, sans-serif';
            c.fillStyle = 'rgba(255,243,196,' + (0.55 * al).toFixed(3) + ')';
            c.fillText('CHAIN', g.w / 2, cty + px * 0.62);
            if (s.tierT > 0) {
                c.font = '600 21px "Space Grotesk", Inter, sans-serif';
                c.fillStyle = 'rgba(255,255,255,' + (0.9 * g.clamp(s.tierT / 0.6, 0, 1)).toFixed(3) + ')';
                c.fillText(s.tierWord, g.w / 2, cty - px * 0.72);
            }
            c.restore();
        }

        if (!g.running) {
            if (overCanvas) reticle(g, c, false);
            return;
        }

        var ready = s.shotsLeft > 0 && !s.shot && s.frags.length === 0;

        // Aim line whenever a bolt is ready and the field is quiet.
        if (ready) {
            var ax = s.cx, ay = g.h + 40;
            var aa = g.angleTo(ax, ay, g.pointer.x, g.pointer.y);
            c.strokeStyle = 'rgba(251,191,36,0.55)';
            c.setLineDash([10, 10]); c.lineWidth = 2;
            c.beginPath();
            c.moveTo(ax, ay);
            c.lineTo(ax + Math.cos(aa) * 2200, ay + Math.sin(aa) * 2200);
            c.stroke();
            c.setLineDash([]);

            c.save();
            c.textAlign = 'center';
            c.fillStyle = 'rgba(232,238,252,0.75)';
            c.font = '600 15px "Space Grotesk", Inter, sans-serif';
            c.fillText('SHOT ' + (s.shotNum + 1) + ' OF ' + SHOTS_TOTAL + ' — aim and click', g.w / 2, g.h - 34);
            c.restore();
        }

        // Shunt affordance: while debris is live and the shunt is unspent, the
        // cursor carries its own blast radius so the decision is visible.
        if (s.shuntLeft > 0 && s.frags.length > 0) {
            c.save();
            c.strokeStyle = 'rgba(126,231,255,0.28)';
            c.setLineDash([6, 8]); c.lineWidth = 1.4;
            c.beginPath(); c.arc(g.pointer.x, g.pointer.y, SHUNT_R, 0, TAU); c.stroke();
            c.setLineDash([]);
            c.textAlign = 'center';
            c.fillStyle = 'rgba(126,231,255,0.6)';
            c.font = '600 12px "Space Grotesk", Inter, sans-serif';
            c.fillText('RIGHT-CLICK · SHUNT', g.pointer.x, g.pointer.y - SHUNT_R - 10);
            c.restore();
        }

        // Reticle, since the OS pointer is hidden on the canvas.
        reticle(g, c, ready);
    }

    Arcade.create({
        slug: 'kessler-reversed',
        title: 'KESSLER REVERSED',
        accent: '#fbbf24',
        hideCursor: true,
        tagline: BASE_TAGLINE,
        controls: [
            ['CLICK', 'fire a bolt (3 per contract)'],
            ['RIGHT-CLICK', 'SHUNT — kick nearby debris outward (1 per run)'],
            ['2-FINGER TAP', 'shunt, on touch'],
            ['MOVE', 'aim']
        ],
        scoreLabel: 'SCORE',
        overTitle: 'CONTRACT CLOSED',
        winTitle: 'CASCADE ACHIEVED',
        init: init,
        initMenu: initMenu,
        update: update,
        idle: idle,
        draw: draw,
        pointerDown: pointerDown,
        onResize: onResize
    });

    // The menu card and canvas exist only after create() returns, so the first
    // field's announcement is replayed onto the card here.
    var screens = document.querySelectorAll('.a-screen');
    if (screens.length) menuTag = screens[0].querySelector('.a-tag');
    if (window.__arcade && window.__arcade.g) announce(window.__arcade.g.s);

    var cv = document.getElementById('game');
    if (cv) {
        cv.addEventListener('pointerenter', function () { overCanvas = true; });
        cv.addEventListener('pointerleave', function () { overCanvas = false; });
    }
})();

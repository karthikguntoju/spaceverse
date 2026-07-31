/**
 * Asteroid Miner — a game about greed, wearing a mining hat.
 *
 * The whole game is one question: can I still get home carrying this? So the
 * tractor never takes anything you did not ask for — you hold the beam on a
 * single crate until it latches — and Space throws the last crate back out if
 * the answer turns out to be no. Mass is the price of everything: it slows the
 * turn, lowers the top speed, and keeps your momentum long after you wanted it
 * gone. A loaded ship handles like a barge, and that is the point.
 */
(function () {
    var O2_START = 75;          // seconds
    var THRUST = 430;
    var BASE_R = 54;
    var TETHER = 120;           // tractor beam reach
    var HULL_MAX = 3;
    var CARGO_MAX = 8;          // the tow can only hold so much
    var LOCK_TIME = 0.5;        // how long the beam must stay on a crate
    var ORE_FLOOR = 18;         // the field never drops below this many crates
    var ROCK_COOL = 0.5;        // per-rock hit cooldown, not a blanket i-frame
    var LABEL_R = 320;          // value labels only near the ship

    /** The play field, clamped so the boundary and the deep ore stay reachable
        on screen instead of hiding past the left and right edges. */
    function fieldRadius(g) {
        return Math.min(Math.min(g.w, g.h) * 0.95, Math.hypot(g.w, g.h) * 0.42);
    }

    function makeOre(g, cx, cy, dd, s) {
        var ang = Math.random() * 6.2832;
        var depth = g.clamp((dd - BASE_R) / (s.fieldR - BASE_R), 0, 1);
        return {
            x: cx + Math.cos(ang) * dd,
            y: cy + Math.sin(ang) * dd,
            r: 9 + depth * 7,
            value: Math.round(80 + depth * depth * 620),
            // Mass is the whole economy. Deep crates are worth ~8x a shallow
            // one and cost about 2.5x the handling, so the greedy load is
            // always the one you might not get home.
            mass: 0.24 + depth * 0.36,
            vx: g.rand(-9, 9), vy: g.rand(-9, 9),
            held: false, noGrab: 0,
            rot: Math.random() * 6.28, spin: g.rand(-0.9, 0.9),
            ph: Math.random() * 6.2832       // pulse phase, so glows don't sync
        };
    }

    function makeRock(g, s, a, d) {
        var seed = g.rand(1, 999);
        var r0 = g.rand(14, 40);
        // A few rocks carry faint mineral veins; endpoints are baked at spawn
        // so the hot loop only strokes, never recomputes.
        var veins = null;
        if (g.hash(seed * 13.7) < 0.3) {
            veins = [];
            var nv = g.hash(seed * 7.7) < 0.5 ? 1 : 2;
            for (var j = 0; j < nv; j++) {
                var va = g.hash(seed * 3.3 + j * 5.1) * 6.2832;
                var vd = r0 * (0.15 + g.hash(seed * 9.9 + j) * 0.3);
                var vl = r0 * 0.45;
                veins.push(
                    Math.cos(va) * vd, Math.sin(va) * vd,
                    Math.cos(va + 0.5) * (vd + vl), Math.sin(va + 0.5) * (vd + vl));
            }
        }
        return {
            x: g.w / 2 + Math.cos(a) * d, y: g.h / 2 + Math.sin(a) * d,
            r: r0, seed: seed, veins: veins,
            rot: Math.random() * 6.28, spin: g.rand(-1.1, 1.1),
            vx: g.rand(-16, 16), vy: g.rand(-16, 16),
            cool: 0, hazard: false
        };
    }

    /** A drifting hazard: red, tumbling, and it leans toward you. One joins the
        field every shift from the third on, so escalation is something in the
        world and not just a number multiplying the oxygen drain. */
    function makeHazard(g, s) {
        var a = Math.random() * 6.2832;
        var h = makeRock(g, s, a, s.fieldR * 0.96);
        h.r = g.rand(19, 27);
        h.hazard = true;
        h.spin = g.rand(-2.4, 2.4);
        h.veins = null;
        h.vx = Math.cos(a + Math.PI) * 70;
        h.vy = Math.sin(a + Math.PI) * 70;
        s.rocks.push(h);
        return h;
    }

    function makeField(g, s) {
        // 54, not the old 70. Each rock now bills you separately and the tow
        // turns like a barge, so the same density that used to cost one hull
        // point per cluster would cost three. Fewer rocks, each one meaning it.
        for (var i = 0; i < 54; i++) {
            s.rocks.push(makeRock(g, s, Math.random() * 6.2832, g.rand(BASE_R + 120, s.fieldR)));
        }
        // Ore value scales with distance from base: the deep stuff is the prize.
        for (var k = 0; k < 26; k++) {
            s.ore.push(makeOre(g, g.w / 2, g.h / 2, g.rand(BASE_R + 150, s.fieldR), s));
        }
    }

    /** Loose bodies drift and get nudged back in when they wander past the rim. */
    function drift(g, b, cx, cy, R, push, dt) {
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (g.dist(b.x, b.y, cx, cy) > R) {
            var a = g.angleTo(b.x, b.y, cx, cy);
            b.vx += Math.cos(a) * push * dt;
            b.vy += Math.sin(a) * push * dt;
        }
    }

    function init(g) {
        var s = {
            ship: { x: g.w / 2, y: g.h / 2 + 90, vx: 0, vy: 0, a: -1.57 },
            rocks: [], ore: [], carried: [],
            o2: O2_START, hull: HULL_MAX, banked: 0, trips: 0,
            fieldR: fieldRadius(g),
            hitCool: 0,         // cosmetic damage flash only — hits are per-rock
            kick: 0,            // brief speed-cap lift so an impact still throws you
            shift: 1,           // each bank increments this and tightens the run
            drain: 1,           // oxygen drain multiplier, *1.06 per shift
            o2Tick: 0,          // low-oxygen warning metronome
            mass: 1,            // ship + cargo: steering, top speed, and drift
            thrusting: false,
            lockOre: null, lockT: 0,   // tractor lock-on target and progress
            menu: false, idleT: 0,
            trail: [],          // last ~18 ship positions
            pulses: []          // expanding rings on bank
        };
        g.s = s;
        makeField(g, s);
    }

    function initMenu(g) {
        init(g);
        g.s.menu = true;
    }

    /* ── tractor ──────────────────────────────────────────────────────────
       Nothing attaches by proximity. The beam takes the single nearest crate
       inside reach, and only while you are asking for it, and only after it
       holds the lock long enough that brushing past cannot cost you a trip. */
    function tractor(g, s, dt) {
        var sh = s.ship;
        var grabbing = g.pointer.down || g.key('ShiftLeft') || g.key('ShiftRight');
        var target = null, bestD = TETHER;
        if (grabbing && s.carried.length < CARGO_MAX) {
            for (var o = 0; o < s.ore.length; o++) {
                var ore = s.ore[o];
                if (ore.held || ore.noGrab > 0) continue;
                var d = g.dist(sh.x, sh.y, ore.x, ore.y);
                if (d < bestD) { bestD = d; target = ore; }
            }
        }
        if (target !== s.lockOre) { s.lockOre = target; s.lockT = 0; }
        if (!target) return;

        s.lockT += dt;
        // Sparks crawl up the beam so the lock reads as work being done.
        if (Math.random() < dt / 0.05) {
            var f = Math.random();
            g.burst(g.lerp(target.x, sh.x, f), g.lerp(target.y, sh.y, f),
                { n: 1, colour: '#a7ffe9', speed: 40, life: 0.25, size: 1.3, shape: 'spark' });
        }
        if (s.lockT >= LOCK_TIME) {
            target.held = true;
            s.carried.push(target);
            s.lockOre = null; s.lockT = 0;
            g.sfx('pick', 1 + s.carried.length * 0.06);
            g.burst(target.x, target.y, { n: 10, colour: '#7aa2ff', speed: 140, life: 0.4 });
            if (s.carried.length >= CARGO_MAX) g.flash('TOW FULL — ' + CARGO_MAX + '/' + CARGO_MAX, '#ffd35a', 700);
        }
    }

    /** Space: throw the last crate back out. It leaves with the ship's
        velocity, which makes it both an escape hatch and a way to ditch weight
        toward the base and pick it up again on the next pass. */
    function jettison(g) {
        var s = g.s;
        if (!s || !s.carried || !s.carried.length) return;
        var sh = s.ship;
        var ore = s.carried.pop();
        ore.held = false;
        ore.noGrab = 0.9;
        ore.vx = sh.vx + Math.cos(sh.a + Math.PI) * 60;
        ore.vy = sh.vy + Math.sin(sh.a + Math.PI) * 60;
        ore.spin = g.rand(-3, 3);
        if (s.lockOre === ore) { s.lockOre = null; s.lockT = 0; }
        g.sfx('blip', 0.6);
        g.burst(ore.x, ore.y, { n: 12, colour: '#ffd35a', angle: sh.a + Math.PI, spread: 0.7, speed: 200, life: 0.4, shape: 'spark' });
        g.flash('JETTISONED −' + ore.value.toLocaleString(), '#ffd35a', 550);
    }

    function keyDown(g, code) {
        if (code === 'Space' && g.running) jettison(g);
    }

    function update(g, dt) {
        var s = g.s;
        var sh = s.ship;
        var cx = g.w / 2, cy = g.h / 2;
        var i, o, ore;

        s.o2 -= dt * s.drain;
        if (s.o2 <= 0) {
            g.sfx('lose'); g.shake(12);
            g.over('Oxygen ran out ' + Math.round(g.dist(sh.x, sh.y, cx, cy)) + ' px from the airlock on shift ' + s.shift + '. You banked ' + s.banked + ' credits.');
            return;
        }
        if (s.o2 < O2_START * 0.25) {
            s.o2Tick -= dt;
            if (s.o2Tick <= 0) { g.sfx('tick'); s.o2Tick = 2; }
        }

        /* ── flight ────────────────────────────────────────────────────────
           Mass is in every term: it divides the thrust, it slows the turn, it
           lowers the top speed, and it takes the drag out of the damping so a
           loaded ship keeps going long after you stopped asking it to. */
        var mass = 1;
        for (i = 0; i < s.carried.length; i++) mass += s.carried[i].mass;
        s.mass = mass;
        var accel = THRUST / mass;

        var tx = 0, ty = 0;
        if (g.key('KeyA') || g.key('ArrowLeft')) tx -= 1;
        if (g.key('KeyD') || g.key('ArrowRight')) tx += 1;
        if (g.key('KeyW') || g.key('ArrowUp')) ty -= 1;
        if (g.key('KeyS') || g.key('ArrowDown')) ty += 1;
        if (g.pointer.down) {
            var pa = g.angleTo(sh.x, sh.y, g.pointer.x, g.pointer.y);
            tx += Math.cos(pa); ty += Math.sin(pa);
        }
        var tl = Math.hypot(tx, ty);
        s.thrusting = tl > 0.01;
        if (s.thrusting) {
            var want = Math.atan2(ty, tx);
            var turn = 3.2 * dt / mass;
            var diff = g.wrapAngle(want - sh.a);
            sh.a = g.wrapAngle(sh.a + g.clamp(diff, -turn, turn));
            // Thrust follows the nose, not the cursor, so the turn rate is a
            // real cost: swinging a full tow around takes seconds you do not
            // have. A quarter of the push stays on while you come about.
            var align = Math.max(0, Math.cos(g.wrapAngle(want - sh.a)));
            var push = accel * (0.25 + 0.75 * align);
            sh.vx += Math.cos(sh.a) * push * dt;
            sh.vy += Math.sin(sh.a) * push * dt;
            if (Math.random() < 0.6) {
                g.burst(sh.x - Math.cos(sh.a) * 12, sh.y - Math.sin(sh.a) * 12,
                    { n: 1, angle: sh.a + Math.PI, spread: 0.4, speed: 160, colour: '#7aa2ff', life: 0.35, size: 1.8, shape: 'spark' });
            }
        }
        var damp = Math.exp(-(0.55 / Math.sqrt(mass)) * dt);
        sh.vx *= damp; sh.vy *= damp;

        // Top speed falls off with the load — a full tow simply cannot outrun
        // anything. The cap lifts for a moment after an impact so a rock still
        // throws you clear instead of the clamp eating the knockback.
        var maxV = 260 / Math.sqrt(mass);
        if (s.kick > 0) { s.kick -= dt; maxV = Math.max(maxV, 300); }
        var spd = Math.hypot(sh.vx, sh.vy);
        if (spd > maxV) { sh.vx *= maxV / spd; sh.vy *= maxV / spd; }
        sh.x += sh.vx * dt; sh.y += sh.vy * dt;

        s.trail.push({ x: sh.x, y: sh.y });
        if (s.trail.length > 18) s.trail.shift();
        if (s.hitCool > 0) s.hitCool -= dt;

        for (var pi = s.pulses.length - 1; pi >= 0; pi--) {
            s.pulses[pi].age += dt;
            if (s.pulses[pi].age > 0.6) s.pulses.splice(pi, 1);
        }

        // The field edge is a soft wall, not a death.
        if (g.dist(sh.x, sh.y, cx, cy) > s.fieldR) {
            var ba = g.angleTo(sh.x, sh.y, cx, cy);
            sh.vx += Math.cos(ba) * 600 * dt;
            sh.vy += Math.sin(ba) * 600 * dt;
        }

        /* ── rocks ─────────────────────────────────────────────────────────
           The cooldown lives on the rock that hit you, not on the ship, so a
           dense cluster is three separate bills instead of one. */
        for (i = 0; i < s.rocks.length; i++) {
            var r = s.rocks[i];
            if (r.cool > 0) r.cool -= dt;
            if (r.hazard) {
                var ha = g.angleTo(r.x, r.y, sh.x, sh.y);
                r.vx += Math.cos(ha) * 46 * dt;
                r.vy += Math.sin(ha) * 46 * dt;
                var hs = Math.hypot(r.vx, r.vy);
                if (hs > 90) { r.vx *= 90 / hs; r.vy *= 90 / hs; }
                r.x += r.vx * dt; r.y += r.vy * dt;
            } else {
                drift(g, r, cx, cy, s.fieldR, 40, dt);
            }
            // The airlock keeps its own approach clear. Without this, rocks
            // drift inward over a long run, park on the bank ring, and the one
            // place you have to reach becomes the one place you cannot.
            var bd = g.dist(r.x, r.y, cx, cy);
            if (bd < BASE_R + 46) {
                var oa = g.angleTo(cx, cy, r.x, r.y);
                r.vx += Math.cos(oa) * 150 * dt;
                r.vy += Math.sin(oa) * 150 * dt;
            }
            r.rot += r.spin * dt;

            if (r.cool <= 0 && g.dist(sh.x, sh.y, r.x, r.y) < r.r + 11) {
                s.hull--;
                r.cool = ROCK_COOL;
                s.hitCool = 0.45;
                s.kick = 0.45;
                s.o2 -= r.hazard ? 8 : 5;
                var ka = g.angleTo(r.x, r.y, sh.x, sh.y);
                sh.vx += Math.cos(ka) * 260; sh.vy += Math.sin(ka) * 260;
                r.vx -= Math.cos(ka) * 60; r.vy -= Math.sin(ka) * 60;
                g.shake(r.hazard ? 22 : 16); g.sfx('hit');
                g.burst(sh.x, sh.y, { n: 16, colour: '#ff8b8b', speed: 220 });
                g.flash(s.hull > 0
                    ? (r.hazard ? 'DRIFTER HIT — 8s OXYGEN LOST' : 'HULL BREACH — 5s OXYGEN LOST')
                    : 'HULL GONE', '#ff8b8b', 700);
                if (s.hull <= 0) {
                    g.burst(sh.x, sh.y, { n: 60, colour: '#ffd35a', speed: 420, life: 1 });
                    g.burst(sh.x, sh.y, { n: 24, colour: '#ffffff', speed: 520, life: 0.7, shape: 'spark' });
                    g.shake(34); g.sfx('boom');
                    g.over('Hull failed in the deep field. Banked ' + s.banked + ' credits over ' + s.trips + ' trips.');
                    return;
                }
            }
        }

        // Loose ore drifts with the field; jettisoned crates coast on the
        // velocity you threw them with and settle.
        for (o = 0; o < s.ore.length; o++) {
            ore = s.ore[o];
            ore.rot += ore.spin * dt;
            if (ore.held) continue;
            if (ore.noGrab > 0) ore.noGrab -= dt;
            drift(g, ore, cx, cy, s.fieldR, 40, dt);
            var od = Math.exp(-0.6 * dt);
            ore.vx *= od; ore.vy *= od;
        }

        tractor(g, s, dt);

        // Towed ore trails behind in a line, which is also the visual weight
        // cue: spaced far enough apart that eight crates read as a train you
        // are dragging, not one gold brick stuck to the tail.
        for (var t = 0; t < s.carried.length; t++) {
            var ct = s.carried[t];
            var tgtX = sh.x - Math.cos(sh.a) * (30 + t * 27);
            var tgtY = sh.y - Math.sin(sh.a) * (30 + t * 27);
            ct.x = g.lerp(ct.x, tgtX, Math.min(1, 7 * dt));
            ct.y = g.lerp(ct.y, tgtY, Math.min(1, 7 * dt));
        }

        // Bank at base: cash out, then the shift turns over — bonus oxygen,
        // faster drain, and the restock seeded deeper into the field.
        if (g.dist(sh.x, sh.y, cx, cy) < BASE_R && s.carried.length) {
            var got = 0, hauled = s.carried.length;
            for (var b = 0; b < hauled; b++) {
                got += s.carried[b].value;
                var idx = s.ore.indexOf(s.carried[b]);
                if (idx >= 0) s.ore.splice(idx, 1);
            }
            s.carried.length = 0;
            s.lockOre = null; s.lockT = 0;
            s.banked += got;
            s.trips++;
            s.shift++;
            s.o2 = Math.min(O2_START, s.o2 + 6);
            s.drain *= 1.06;
            g.setScore(s.banked);
            g.flash('+' + got.toLocaleString() + ' · SHIFT ' + s.shift + ' · +6s O2', g.accent, 900);
            g.sfx('win');
            g.burst(cx, cy, { n: 20, colour: g.accent, speed: 220, life: 0.7 });
            // Spark fountain out of the airlock, plus a shockwave ring.
            g.burst(cx, cy, { n: 26, colour: '#a7ffe9', angle: -1.5708, spread: 0.8, speed: 360, life: 0.8, shape: 'spark' });
            s.pulses.push({ x: cx, y: cy, r: BASE_R, age: 0 });

            // Restock pays back what you took plus interest, and a hard floor
            // keeps the field alive: playing well can no longer starve it.
            var lo = Math.min(s.fieldR * (0.55 + 0.05 * (s.shift - 1)), s.fieldR * 0.92);
            var n = Math.max(5, hauled + 2);
            for (i = 0; i < n; i++) s.ore.push(makeOre(g, cx, cy, g.rand(lo, s.fieldR), s));
            while (s.ore.length < ORE_FLOOR) {
                s.ore.push(makeOre(g, cx, cy, g.rand(BASE_R + 150, s.fieldR), s));
            }

            if (s.shift >= 3) {
                makeHazard(g, s);
                g.flash('SHIFT ' + s.shift + ' · DRIFTER INBOUND', '#ff8b8b', 900);
            }
        }

        var pending = 0;
        for (var p = 0; p < s.carried.length; p++) pending += s.carried[p].value;
        g.hud('OXYGEN <b style="color:' + (s.o2 < O2_START * 0.25 ? '#ff8b8b' : '#e8eefc') + '">' + s.o2.toFixed(1) + 's</b><br>' +
              'HULL <b>' + s.hull + '/' + HULL_MAX + '</b> · SHIFT <b>' + s.shift + '</b> · TRIPS <b>' + s.trips + '</b><br>' +
              'CARGO <b style="color:' + (s.carried.length >= CARGO_MAX ? '#ffd35a' : '#e8eefc') + '">' +
                  s.carried.length + '/' + CARGO_MAX + '</b> · MASS <b>' + s.mass.toFixed(2) + '×</b><br>' +
              'IN THE TOW <b>' + pending.toLocaleString() + '</b> (unbanked)');
    }

    /** Menu and post-run scene. Without this the "live" card sits over a
        freeze-frame of a mining field with a moving starfield behind it. */
    function idle(g, dt) {
        var s = g.s;
        if (!s || !s.ship || !dt) return;
        var cx = g.w / 2, cy = g.h / 2, i;

        for (i = 0; i < s.rocks.length; i++) {
            var r = s.rocks[i];
            drift(g, r, cx, cy, s.fieldR, 40, dt);
            r.rot += r.spin * dt;
        }
        for (i = 0; i < s.ore.length; i++) {
            var ore = s.ore[i];
            ore.rot += ore.spin * dt;
            if (!ore.held) drift(g, ore, cx, cy, s.fieldR, 40, dt);
        }
        for (var pi = s.pulses.length - 1; pi >= 0; pi--) {
            s.pulses[pi].age += dt;
            if (s.pulses[pi].age > 0.6) s.pulses.splice(pi, 1);
        }
        if (s.hitCool > 0) s.hitCool -= dt;

        var sh = s.ship;
        if (s.menu) {
            // A slow patrol loop around the base, so the title screen is a
            // working mine and not a diagram of one.
            s.idleT += dt;
            var orb = BASE_R + 130;
            var oa = s.idleT * 0.24 - 1.2;
            sh.x = cx + Math.cos(oa) * orb;
            sh.y = cy + Math.sin(oa) * orb * 0.6;
            sh.a = Math.atan2(Math.cos(oa) * orb * 0.6, -Math.sin(oa) * orb);
            s.thrusting = Math.sin(s.idleT * 1.9) > 0.15;
        } else {
            // After a run the wreck just coasts; nothing snaps back to a rail.
            sh.vx *= Math.exp(-0.7 * dt); sh.vy *= Math.exp(-0.7 * dt);
            sh.x += sh.vx * dt; sh.y += sh.vy * dt;
            s.thrusting = false;
            for (var t = 0; t < s.carried.length; t++) {
                var ct = s.carried[t];
                ct.x = g.lerp(ct.x, sh.x - Math.cos(sh.a) * (30 + t * 27), Math.min(1, 7 * dt));
                ct.y = g.lerp(ct.y, sh.y - Math.sin(sh.a) * (30 + t * 27), Math.min(1, 7 * dt));
            }
        }
        s.trail.push({ x: sh.x, y: sh.y });
        if (s.trail.length > 18) s.trail.shift();
    }

    /* ── drawing ──────────────────────────────────────────────────────── */

    /** Two passes: a lit body under a rim, then a facet that spins with the
        crate. Flat fills read as UI; this reads as rock with metal in it. */
    function drawOre(g, c, ore, hot) {
        c.save();
        c.translate(ore.x, ore.y);
        c.rotate(ore.rot);
        c.beginPath();
        for (var k = 0; k < 6; k++) {
            var a2 = (k / 6) * 6.2832;
            c.lineTo(Math.cos(a2) * ore.r, Math.sin(a2) * ore.r);
        }
        c.closePath();
        // Light from the world's upper-left: the path is baked in rotated
        // space, the gradient must not be.
        c.rotate(-ore.rot);
        var og = c.createRadialGradient(-ore.r * 0.4, -ore.r * 0.45, ore.r * 0.12, 0, 0, ore.r * 1.25);
        og.addColorStop(0, hot ? '#fff0b8' : '#cfe0ff');
        og.addColorStop(1, hot ? '#c98a12' : '#2f4d96');
        c.fillStyle = og;
        c.fill();
        c.globalAlpha = 0.6;
        c.lineWidth = 1.2;
        c.strokeStyle = hot ? '#ffe6a0' : '#bcd4ff';
        c.stroke();
        c.globalAlpha = 1;
        // Facet: the one highlight that rides the spin, so a tumbling crate
        // catches the light instead of sitting there.
        c.rotate(ore.rot);
        c.beginPath();
        c.moveTo(0, -ore.r * 0.92);
        c.lineTo(ore.r * 0.74, -ore.r * 0.36);
        c.lineTo(0, 0);
        c.closePath();
        c.fillStyle = hot ? 'rgba(255,252,232,0.50)' : 'rgba(226,238,255,0.42)';
        c.fill();
        c.restore();
    }

    function drawShip(g, c, s) {
        var sh = s.ship;
        c.save();
        c.translate(sh.x, sh.y);
        c.rotate(sh.a);
        c.beginPath();
        c.moveTo(17, 0); c.lineTo(-12, -10); c.lineTo(-6, 0); c.lineTo(-12, 10);
        c.closePath();
        if (s.hitCool > 0) {
            c.fillStyle = '#ff8b8b';
        } else {
            var hg = c.createLinearGradient(-12, -11, 12, 11);
            hg.addColorStop(0, '#fbfdff');
            hg.addColorStop(0.45, '#c6d4ee');
            hg.addColorStop(1, '#6c7b9c');
            c.fillStyle = hg;
        }
        c.fill();
        c.strokeStyle = 'rgba(8,14,30,0.55)';
        c.lineWidth = 1;
        c.stroke();
        // Cockpit.
        c.fillStyle = '#7aa2ff';
        c.beginPath(); c.arc(4, 0, 3, 0, 6.2832); c.fill();
        c.restore();
        // Nav lights: port red, starboard green, both blooming so they read at
        // a glance which way the hull is pointing.
        var np = 0.55 + 0.45 * Math.sin(g.t * 5);
        var lx = Math.cos(sh.a), ly = Math.sin(sh.a);
        var px = sh.x + lx * -12 - ly * -10, py = sh.y + ly * -12 + lx * -10;
        var qx = sh.x + lx * -12 - ly * 10, qy = sh.y + ly * -12 + lx * 10;
        g.bloom(c, px, py, 8, 'rgba(255,90,90,' + (0.30 + 0.3 * np) + ')', 'rgba(255,150,150,0.95)');
        g.bloom(c, qx, qy, 8, 'rgba(90,255,150,' + (0.30 + 0.3 * (1 - np)) + ')', 'rgba(160,255,200,0.95)');
    }

    function draw(g, c) {
        var s = g.s;
        var cx = g.w / 2, cy = g.h / 2;
        var sh = s.ship;
        var i, o, ore;
        g.space(c, { bg: '#03060f' });

        c.strokeStyle = 'rgba(122,162,255,0.14)';
        c.setLineDash([4, 10]); c.lineWidth = 1.5;
        c.beginPath(); c.arc(cx, cy, s.fieldR, 0, 6.2832); c.stroke();
        c.setLineDash([]);

        // Base.
        g.glow(c, cx, cy, BASE_R * 2.4, 'rgba(100,255,218,0.16)');
        c.strokeStyle = g.accent; c.lineWidth = 2.5;
        c.beginPath(); c.arc(cx, cy, BASE_R, 0, 6.2832); c.stroke();
        c.fillStyle = 'rgba(100,255,218,0.10)';
        c.fill();
        // In banking range the ring breathes at you: this is where money happens.
        if (g.dist(sh.x, sh.y, cx, cy) < BASE_R) {
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.strokeStyle = 'rgba(100,255,218,' + (0.3 + 0.22 * Math.sin(g.t * 4)) + ')';
            c.lineWidth = 3;
            c.beginPath(); c.arc(cx, cy, BASE_R + 7 + Math.sin(g.t * 4) * 3, 0, 6.2832); c.stroke();
            c.restore();
        }
        c.fillStyle = 'rgba(159,179,204,0.9)';
        c.font = '600 11px "Space Grotesk", Inter, sans-serif'; c.textAlign = 'center';
        c.fillText('BANK ORE HERE', cx, cy + 4);
        c.textAlign = 'left';

        // Bank shockwaves.
        c.save();
        c.globalCompositeOperation = 'lighter';
        for (var pu = 0; pu < s.pulses.length; pu++) {
            var pl = s.pulses[pu];
            var pf = 1 - pl.age / 0.6;
            c.strokeStyle = 'rgba(100,255,218,' + (0.7 * pf) + ')';
            c.lineWidth = 2.5 * pf + 0.5;
            c.beginPath(); c.arc(pl.x, pl.y, pl.r + pl.age * 220, 0, 6.2832); c.stroke();
        }
        c.restore();

        for (i = 0; i < s.rocks.length; i++) {
            var r = s.rocks[i];
            if (r.hazard) {
                var hp = 0.5 + 0.5 * Math.sin(g.t * 5 + r.seed);
                g.bloom(c, r.x, r.y, r.r * 2.8, 'rgba(255,110,110,' + (0.14 + 0.12 * hp) + ')');
            }
            c.save(); c.translate(r.x, r.y); c.rotate(r.rot);
            g.rockPath(c, r.r, r.seed);
            // Light the rock from the world's upper-left, not the rock's:
            // the path is baked in rotated space, the gradient is not.
            c.rotate(-r.rot);
            var grd = c.createRadialGradient(-r.r * 0.45, -r.r * 0.45, r.r * 0.15, 0, 0, r.r * 1.2);
            grd.addColorStop(0, r.hazard ? '#ff8b8b' : '#6a7288');
            grd.addColorStop(1, r.hazard ? '#5c1c24' : '#3a4152');
            c.fillStyle = grd;
            c.fill();
            if (r.hazard) {
                c.strokeStyle = 'rgba(255,139,139,0.75)';
                c.lineWidth = 1.4;
                c.stroke();
            }
            if (r.veins) {
                c.rotate(r.rot);   // veins ride the surface, so they spin with it
                c.strokeStyle = 'rgba(154,178,222,0.16)';
                c.lineWidth = 1.1;
                c.beginPath();
                for (var vv = 0; vv < r.veins.length; vv += 4) {
                    c.moveTo(r.veins[vv], r.veins[vv + 1]);
                    c.lineTo(r.veins[vv + 2], r.veins[vv + 3]);
                }
                c.stroke();
            }
            c.restore();
        }

        for (o = 0; o < s.ore.length; o++) {
            ore = s.ore[o];
            var hot = ore.value > 380;
            var onScreen = ore.x > -30 && ore.x < g.w + 30 && ore.y > -30 && ore.y < g.h + 30;
            if (!onScreen) continue;               // the edge pass handles these
            var pr = ore.r * 3 * (1 + 0.15 * Math.sin(g.t * 3 + ore.ph));
            g.bloom(c, ore.x, ore.y, pr, hot ? 'rgba(255,211,90,0.30)' : 'rgba(122,162,255,0.26)');
            // The occasional glitter spark, so the field reads as treasure.
            if (g.dt > 0 && Math.random() < g.dt / 0.7) {
                g.burst(ore.x + (Math.random() - 0.5) * ore.r, ore.y + (Math.random() - 0.5) * ore.r,
                    { n: 1, colour: hot ? '#fff3c4' : '#dce8ff', speed: 34, life: 0.35, size: 1.4, shape: 'spark' });
            }
            drawOre(g, c, ore, hot);
            // Value labels only near the ship: twenty of them at once was a
            // wall of overlapping numbers nobody could read.
            if (!ore.held && g.dist(sh.x, sh.y, ore.x, ore.y) < LABEL_R) {
                c.fillStyle = hot ? 'rgba(255,226,150,0.85)' : 'rgba(232,238,252,0.62)';
                c.font = '600 10px "Space Grotesk", Inter, sans-serif'; c.textAlign = 'center';
                c.fillText(ore.value, ore.x, ore.y - ore.r - 6);
                c.textAlign = 'left';
            }
        }

        // Tow line: additive, and it sags under the cargo's weight.
        if (s.carried.length) {
            var sag = Math.min(16, 2 + (s.mass - 1) * 6);
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.strokeStyle = 'rgba(100,255,218,0.34)'; c.lineWidth = 1.4;
            c.beginPath(); c.moveTo(sh.x, sh.y);
            var qx = sh.x, qy = sh.y;
            for (var tw = 0; tw < s.carried.length; tw++) {
                var co = s.carried[tw];
                c.quadraticCurveTo((qx + co.x) / 2, (qy + co.y) / 2 + sag, co.x, co.y);
                qx = co.x; qy = co.y;
            }
            c.stroke();
            c.restore();
            for (var cb = 0; cb < s.carried.length; cb++) {
                g.bloom(c, s.carried[cb].x, s.carried[cb].y, s.carried[cb].r * 2.2, 'rgba(100,255,218,0.22)');
            }
        }

        // Tractor reach, and the lock-on beam when you are asking for a crate.
        c.strokeStyle = s.lockOre ? 'rgba(100,255,218,0.26)' : 'rgba(100,255,218,0.11)';
        c.lineWidth = 1;
        c.beginPath(); c.arc(sh.x, sh.y, TETHER, 0, 6.2832); c.stroke();
        if (s.lockOre) {
            var lp = Math.min(1, s.lockT / LOCK_TIME);
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.strokeStyle = 'rgba(167,255,233,' + (0.25 + 0.5 * lp) + ')';
            c.lineWidth = 1 + 2 * lp;
            c.beginPath(); c.moveTo(sh.x, sh.y); c.lineTo(s.lockOre.x, s.lockOre.y); c.stroke();
            // The ring closes as the lock completes.
            c.strokeStyle = 'rgba(167,255,233,0.9)';
            c.lineWidth = 2;
            c.beginPath();
            c.arc(s.lockOre.x, s.lockOre.y, s.lockOre.r + 7, -1.5708, -1.5708 + 6.2832 * lp);
            c.stroke();
            c.restore();
        }

        // Position trail: a short additive ribbon of where you just were.
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.lineWidth = 1.3;
        for (var tr = 1; tr < s.trail.length; tr++) {
            c.strokeStyle = 'rgba(122,162,255,' + (0.32 * tr / s.trail.length) + ')';
            c.beginPath();
            c.moveTo(s.trail[tr - 1].x, s.trail[tr - 1].y);
            c.lineTo(s.trail[tr].x, s.trail[tr].y);
            c.stroke();
        }
        c.restore();

        if (s.thrusting) {
            g.bloom(c, sh.x - Math.cos(sh.a) * 11, sh.y - Math.sin(sh.a) * 11, 15,
                'rgba(122,162,255,0.55)', 'rgba(220,232,255,0.8)');
        }
        drawShip(g, c, s);

        // Aim reticle — the OS cursor is hidden, so the heading you are asking
        // for is drawn in the same language as everything else.
        var rr = 7 + (g.pointer.down ? 2.5 * Math.sin(g.t * 9) : 0);
        c.strokeStyle = g.pointer.down ? 'rgba(167,255,233,0.85)' : 'rgba(122,162,255,0.5)';
        c.lineWidth = 1.2;
        c.beginPath(); c.arc(g.pointer.x, g.pointer.y, rr, 0, 6.2832); c.stroke();
        c.beginPath();
        c.moveTo(g.pointer.x - 12, g.pointer.y); c.lineTo(g.pointer.x - rr - 2, g.pointer.y);
        c.moveTo(g.pointer.x + rr + 2, g.pointer.y); c.lineTo(g.pointer.x + 12, g.pointer.y);
        c.moveTo(g.pointer.x, g.pointer.y - 12); c.lineTo(g.pointer.x, g.pointer.y - rr - 2);
        c.moveTo(g.pointer.x, g.pointer.y + rr + 2); c.lineTo(g.pointer.x, g.pointer.y + 12);
        c.stroke();

        // Oxygen bar along the bottom — the clock you actually watch.
        var frac = Math.max(0, s.o2 / O2_START);
        c.fillStyle = 'rgba(255,255,255,0.08)';
        c.fillRect(0, g.h - 8, g.w, 8);
        if (frac < 0.25) {
            c.fillStyle = 'rgba(255,139,139,' + (0.6 + 0.4 * Math.sin(g.t * 6)) + ')';
        } else {
            c.fillStyle = '#7aa2ff';
        }
        c.fillRect(0, g.h - 8, g.w * frac, 8);

        /* ── edge indicators ───────────────────────────────────────────────
           The field is wider than the window. Everything worth flying toward
           gets a marker on the rim, sized by what it is worth, so a late shift
           is a choice between visible options instead of a blind search. */
        var m = 26;
        for (o = 0; o < s.ore.length; o++) {
            ore = s.ore[o];
            if (ore.held) continue;
            if (ore.x > -30 && ore.x < g.w + 30 && ore.y > -30 && ore.y < g.h + 30) continue;
            edgeMark(g, c, sh, ore.x, ore.y, m,
                5 + Math.min(9, ore.value / 90),
                ore.value > 380 ? '#ffd35a' : '#7aa2ff', 0.5);
        }
        for (i = 0; i < s.rocks.length; i++) {
            var hz = s.rocks[i];
            if (!hz.hazard) continue;
            if (hz.x > -30 && hz.x < g.w + 30 && hz.y > -30 && hz.y < g.h + 30) continue;
            edgeMark(g, c, sh, hz.x, hz.y, m, 9, '#ff8b8b', 0.5 + 0.25 * Math.sin(g.t * 6));
        }
        c.globalAlpha = 1;
    }

    /** A triangle on the window rim pointing the way to something off-screen. */
    function edgeMark(g, c, sh, x, y, m, size, colour, alpha) {
        var ang = g.angleTo(sh.x, sh.y, x, y);
        var dx = Math.cos(ang), dy = Math.sin(ang);
        var t = 1e9;
        if (dx > 1e-6) t = Math.min(t, (g.w - m - sh.x) / dx);
        else if (dx < -1e-6) t = Math.min(t, (m - sh.x) / dx);
        if (dy > 1e-6) t = Math.min(t, (g.h - m - sh.y) / dy);
        else if (dy < -1e-6) t = Math.min(t, (m - sh.y) / dy);
        if (!isFinite(t) || t < 0) t = 0;
        var ex = g.clamp(sh.x + dx * t, m, g.w - m);
        var ey = g.clamp(sh.y + dy * t, m, g.h - m);
        c.save();
        c.globalAlpha = alpha;
        c.translate(ex, ey); c.rotate(ang);
        c.fillStyle = colour;
        c.beginPath();
        c.moveTo(size, 0);
        c.lineTo(-size * 0.8, -size * 0.6);
        c.lineTo(-size * 0.45, 0);
        c.lineTo(-size * 0.8, size * 0.6);
        c.closePath();
        c.fill();
        c.restore();
    }

    Arcade.create({
        slug: 'asteroid-miner',
        title: 'ASTEROID MINER',
        accent: '#7aa2ff',
        hideCursor: true,
        tagline: 'Hold the beam on a crate to take it — nothing loads itself. Deep ore pays far more and handles far worse: a full tow turns like a barge and stops like one. Space throws the last crate back out when the answer is no.',
        controls: [
            ['CLICK / HOLD', 'thrust toward the cursor'],
            ['WASD / ↑←↓→', 'thrust'],
            ['HOLD SHIFT / CLICK', 'lock the beam onto the nearest crate'],
            ['SPACE', 'jettison the last crate']
        ],
        scoreLabel: 'CREDITS',
        overTitle: 'RUN ENDED',
        init: init,
        initMenu: initMenu,
        idle: idle,
        keyDown: keyDown,
        update: update,
        draw: draw
    });
})();

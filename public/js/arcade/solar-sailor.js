/**
 * Solar Sailor — no engine, only sunlight and regret.
 *
 * The sail only ever pushes along its own normal, away from the Sun. You cannot
 * brake and you cannot pull toward the light, so every gate is planned two
 * gates early. Angling the sail across the light is how you turn.
 */
(function () {
    var SUN_R = 46;
    var PRESSURE = 2600000;     // radiation pressure constant, tuned by feel
    var GATE_R = 46;
    var GATES = 12;
    var TIME_LIMIT = 100;

    function placeGate(g, n) {
        // Golden-angle spread so the gates ring the Sun instead of clumping.
        // The radius band is capped against the SHORT screen side, or gates
        // land off the top and bottom edges on a wide window.
        var a = (n * 2.399) + g.rand(-0.25, 0.25);
        var d = Math.min(g.w, g.h) * (0.20 + ((n * 0.11) % 0.26));
        return { x: g.w / 2 + Math.cos(a) * d, y: g.h / 2 + Math.sin(a) * d, hit: false, a: a };
    }

    function init(g) {
        var s = {
            ship: { x: 0, y: 0, vx: 0, vy: 0 },
            sail: 0.6,                 // sail normal angle, radians
            gates: [],
            idx: 0,
            time: TIME_LIMIT,
            trail: [],
            passed: 0
        };
        g.s = s;
        for (var i = 0; i < GATES; i++) s.gates.push(placeGate(g, i));

        // Start on the far side of the Sun from the first gate. Dropping the
        // ship at a fixed point lets it drift through gate one for free, which
        // teaches the player that doing nothing works.
        var startA = s.gates[0].a + Math.PI;
        var startD = Math.min(g.w, g.h) * 0.36;
        s.ship.x = g.w / 2 + Math.cos(startA) * startD;
        s.ship.y = g.h / 2 + Math.sin(startA) * startD;
        s.ship.vx = Math.cos(startA + 1.57) * 55;
        s.ship.vy = Math.sin(startA + 1.57) * 55;
        s.sail = startA;    // sail starts facing directly away from the Sun
    }

    function update(g, dt) {
        var s = g.s;
        var sh = s.ship;
        var cx = g.w / 2, cy = g.h / 2;

        s.time -= dt;
        if (s.time <= 0) {
            g.over('Out of time with ' + s.passed + ' of ' + GATES + ' gates cleared.', false);
            return;
        }

        if (g.key('KeyA') || g.key('ArrowLeft')) s.sail -= 2.0 * dt;
        if (g.key('KeyD') || g.key('ArrowRight')) s.sail += 2.0 * dt;
        if (g.pointer.down) {
            // Point the sail normal at the cursor: the mouse says "push me that way".
            var want = g.angleTo(sh.x, sh.y, g.pointer.x, g.pointer.y);
            s.sail += g.wrapAngle(want - s.sail) * Math.min(1, 5 * dt);
        }

        var toShip = g.angleTo(cx, cy, sh.x, sh.y);
        var d = Math.max(SUN_R + 6, g.dist(cx, cy, sh.x, sh.y));

        // Only the component of sunlight along the sail normal does anything,
        // and light never pulls: a sail edge-on to the Sun gets nothing.
        var incidence = Math.cos(g.wrapAngle(s.sail - toShip));
        var force = incidence > 0 ? (PRESSURE / (d * d)) * incidence * incidence : 0;
        sh.vx += Math.cos(s.sail) * force * dt;
        sh.vy += Math.sin(s.sail) * force * dt;

        if (force > 6) {
            g.burst(sh.x - Math.cos(s.sail) * 16, sh.y - Math.sin(s.sail) * 16,
                { n: 1, angle: s.sail, spread: 0.5, speed: 60, colour: '#ffd35a', life: 0.5, size: 1.8 });
        }

        sh.x += sh.vx * dt; sh.y += sh.vy * dt;

        s.trail.push({ x: sh.x, y: sh.y });
        if (s.trail.length > 150) s.trail.shift();

        if (g.dist(sh.x, sh.y, cx, cy) < SUN_R + 8) {
            g.burst(sh.x, sh.y, { n: 60, colour: '#ffd35a', speed: 420, life: 1 });
            g.shake(30); g.sfx('boom');
            g.over('You flew into the Sun. It is very bright and very final.');
            return;
        }
        if (sh.x < -120 || sh.x > g.w + 120 || sh.y < -120 || sh.y > g.h + 120) {
            g.sfx('lose');
            g.over('You drifted out of the system with ' + s.passed + ' gates cleared. Nothing out here to push against.');
            return;
        }

        var gate = s.gates[s.idx];
        if (gate && g.dist(sh.x, sh.y, gate.x, gate.y) < GATE_R) {
            gate.hit = true;
            s.passed++;
            s.idx++;
            s.time += 6;    // each gate buys time, so a good line extends the run
            g.addScore(500 + Math.round(s.time * 8));
            g.sfx('win', 1 + s.passed * 0.03);
            g.burst(gate.x, gate.y, { n: 22, colour: '#ffd35a', speed: 240, life: 0.7 });
            g.flash('GATE ' + s.passed + ' · +6s', '#ffd35a', 600);
            if (s.idx >= s.gates.length) {
                g.addScore(4000 + Math.round(s.time * 60));
                g.over('All ' + GATES + ' gates cleared with ' + s.time.toFixed(1) + 's to spare.', true);
                return;
            }
        }

        var speed = Math.hypot(sh.vx, sh.vy);
        g.hud('GATE <b>' + (s.idx + 1) + ' / ' + GATES + '</b><br>' +
              'SPEED <b>' + Math.round(speed) + '</b> · SAIL <b>' + Math.round(incidence * 100) + '% lit</b><br>' +
              'TIME <b style="color:' + (s.time < 12 ? '#ff8b8b' : '#e8eefc') + '">' + s.time.toFixed(1) + 's</b>');
    }

    function draw(g, c) {
        var s = g.s;
        var cx = g.w / 2, cy = g.h / 2;
        c.fillStyle = '#04050d';
        c.fillRect(0, 0, g.w, g.h);

        g.glow(c, cx, cy, Math.min(g.w, g.h) * 0.5, 'rgba(255,196,60,0.12)');
        g.glow(c, cx, cy, SUN_R * 3, 'rgba(255,211,90,0.45)');
        c.fillStyle = '#fff3c4';
        c.beginPath(); c.arc(cx, cy, SUN_R, 0, 6.2832); c.fill();

        // Gates: next one bright, later ones dim, cleared ones ghosted.
        for (var i = 0; i < s.gates.length; i++) {
            var gt = s.gates[i];
            var isNext = i === s.idx;
            c.strokeStyle = gt.hit ? 'rgba(141,255,160,0.25)'
                : isNext ? '#ffd35a' : 'rgba(255,211,90,0.22)';
            c.lineWidth = isNext ? 4 : 2;
            c.beginPath(); c.arc(gt.x, gt.y, GATE_R, 0, 6.2832); c.stroke();
            if (isNext) {
                g.glow(c, gt.x, gt.y, GATE_R * 2.2, 'rgba(255,211,90,0.20)');
                c.fillStyle = '#ffd35a';
                c.font = '700 15px Orbitron, sans-serif'; c.textAlign = 'center';
                c.fillText(String(i + 1), gt.x, gt.y + 5);
                c.textAlign = 'left';
            }
        }

        c.strokeStyle = 'rgba(255,211,90,0.35)'; c.lineWidth = 2;
        c.beginPath();
        for (var t = 0; t < s.trail.length; t++) c.lineTo(s.trail[t].x, s.trail[t].y);
        c.stroke();

        var sh = s.ship;

        // Sunlight arriving at the ship, drawn so the incidence angle is visible.
        var toShip = g.angleTo(cx, cy, sh.x, sh.y);
        c.strokeStyle = 'rgba(255,211,90,0.18)';
        c.setLineDash([4, 8]); c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(cx, cy); c.lineTo(sh.x, sh.y); c.stroke();
        c.setLineDash([]);

        c.save();
        c.translate(sh.x, sh.y);
        c.rotate(s.sail);
        // Sail is a plate perpendicular to its normal; the normal points +x here.
        var lit = Math.max(0, Math.cos(g.wrapAngle(s.sail - toShip)));
        c.fillStyle = 'rgba(255,243,196,' + (0.25 + lit * 0.7) + ')';
        c.fillRect(-2, -30, 5, 60);
        c.strokeStyle = '#e8eefc'; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(0, 0); c.lineTo(-16, 0); c.stroke();
        c.fillStyle = '#e8eefc';
        c.beginPath(); c.arc(-18, 0, 4.5, 0, 6.2832); c.fill();
        // Arrow along the normal: where the light will actually push you.
        c.strokeStyle = 'rgba(255,211,90,' + (0.2 + lit * 0.8) + ')'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(6, 0); c.lineTo(20 + lit * 22, 0); c.stroke();
        c.restore();

        // Velocity arrow, because momentum you cannot see is momentum you cannot plan.
        var sp = Math.hypot(sh.vx, sh.vy);
        if (sp > 5) {
            var va = Math.atan2(sh.vy, sh.vx);
            c.strokeStyle = 'rgba(100,255,218,0.7)'; c.lineWidth = 2;
            c.beginPath(); c.moveTo(sh.x, sh.y);
            c.lineTo(sh.x + Math.cos(va) * Math.min(70, sp * 0.35), sh.y + Math.sin(va) * Math.min(70, sp * 0.35));
            c.stroke();
        }

        var frac = Math.max(0, s.time / TIME_LIMIT);
        c.fillStyle = 'rgba(255,255,255,0.08)';
        c.fillRect(0, g.h - 7, g.w, 7);
        c.fillStyle = frac < 0.15 ? '#ff8b8b' : '#ffd35a';
        c.fillRect(0, g.h - 7, g.w * frac, 7);
    }

    Arcade.create({
        slug: 'solar-sailor',
        title: 'SOLAR SAILOR',
        accent: '#ffd35a',
        tagline: 'You have no engine. Sunlight pushes on your sail along the yellow arrow, and only ever away from the Sun. Angle the sail to curve through all twelve gates before the clock runs out.',
        controls: [['A / D', 'rotate the sail'], ['HOLD MOUSE', 'aim the sail normal at the cursor'], ['ESC', 'back to arcade']],
        scoreLabel: 'SCORE',
        overTitle: 'ADRIFT',
        winTitle: 'ALL GATES CLEARED',
        init: init,
        initMenu: init,
        update: update,
        draw: draw
    });
})();

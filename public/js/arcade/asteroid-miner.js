/**
 * Asteroid Miner — a game about greed, wearing a mining hat.
 *
 * Ore is worth more the deeper you go. Oxygen is fixed for the whole run and
 * every kilo of ore you tow slows you down, so the interesting question is
 * never "can I grab this" but "can I still get home carrying it".
 */
(function () {
    var O2_START = 75;          // seconds
    var THRUST = 430;
    var BASE_R = 54;
    var TETHER = 120;           // tractor beam reach
    var HULL_MAX = 3;

    function makeRocks(g, s) {
        for (var i = 0; i < 70; i++) {
            var a = Math.random() * 6.2832;
            var d = g.rand(BASE_R + 120, s.fieldR);
            s.rocks.push({
                x: g.w / 2 + Math.cos(a) * d,
                y: g.h / 2 + Math.sin(a) * d,
                r: g.rand(14, 40),
                rot: Math.random() * 6.28, spin: g.rand(-1.1, 1.1),
                vx: g.rand(-16, 16), vy: g.rand(-16, 16)
            });
        }
        // Ore value scales with distance from base: the deep stuff is the prize.
        for (var k = 0; k < 26; k++) {
            var ang = Math.random() * 6.2832;
            var dd = g.rand(BASE_R + 150, s.fieldR);
            var depth = (dd - BASE_R) / (s.fieldR - BASE_R);
            s.ore.push({
                x: g.w / 2 + Math.cos(ang) * dd,
                y: g.h / 2 + Math.sin(ang) * dd,
                r: 9 + depth * 7,
                value: Math.round(80 + depth * depth * 620),
                mass: 0.5 + depth * 1.6,
                held: false, rot: Math.random() * 6.28
            });
        }
    }

    function init(g) {
        var s = {
            ship: { x: g.w / 2, y: g.h / 2 + 90, vx: 0, vy: 0, a: -1.57 },
            rocks: [], ore: [], carried: [],
            o2: O2_START, hull: HULL_MAX, banked: 0, trips: 0,
            fieldR: Math.min(g.w, g.h) * 0.95,
            hitCool: 0
        };
        g.s = s;
        makeRocks(g, s);
    }

    function update(g, dt) {
        var s = g.s;
        var sh = s.ship;
        var cx = g.w / 2, cy = g.h / 2;

        s.o2 -= dt;
        if (s.o2 <= 0) {
            g.sfx('lose'); g.shake(12);
            g.over('Oxygen ran out ' + Math.round(g.dist(sh.x, sh.y, cx, cy)) + ' px from the airlock. You banked ' + s.banked + ' credits.');
            return;
        }
        if (s.o2 < 12 && Math.floor(s.o2 * 2) !== Math.floor((s.o2 + dt) * 2)) g.sfx('tick');

        // Steering: pointer sets heading, keys work too.
        var mass = 1;
        for (var m = 0; m < s.carried.length; m++) mass += s.carried[m].mass;
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
        if (tl > 0.01) {
            sh.vx += (tx / tl) * accel * dt;
            sh.vy += (ty / tl) * accel * dt;
            sh.a = Math.atan2(ty, tx);
            if (Math.random() < 0.6) {
                g.burst(sh.x - Math.cos(sh.a) * 12, sh.y - Math.sin(sh.a) * 12,
                    { n: 1, angle: sh.a + Math.PI, spread: 0.4, speed: 150, colour: '#7aa2ff', life: 0.3, size: 2 });
            }
        }
        var damp = Math.exp(-0.55 * dt);
        sh.vx *= damp; sh.vy *= damp;
        sh.x += sh.vx * dt; sh.y += sh.vy * dt;

        // The field edge is a soft wall, not a death.
        var fd = g.dist(sh.x, sh.y, cx, cy);
        if (fd > s.fieldR) {
            var ba = g.angleTo(sh.x, sh.y, cx, cy);
            sh.vx += Math.cos(ba) * 600 * dt;
            sh.vy += Math.sin(ba) * 600 * dt;
        }

        for (var i = 0; i < s.rocks.length; i++) {
            var r = s.rocks[i];
            r.x += r.vx * dt; r.y += r.vy * dt; r.rot += r.spin * dt;
            var rd = g.dist(r.x, r.y, cx, cy);
            if (rd > s.fieldR) {
                var ra = g.angleTo(r.x, r.y, cx, cy);
                r.vx += Math.cos(ra) * 40 * dt; r.vy += Math.sin(ra) * 40 * dt;
            }
            if (s.hitCool <= 0 && g.dist(sh.x, sh.y, r.x, r.y) < r.r + 11) {
                s.hull--;
                s.hitCool = 1.2;
                s.o2 -= 5;
                var ka = g.angleTo(r.x, r.y, sh.x, sh.y);
                sh.vx += Math.cos(ka) * 260; sh.vy += Math.sin(ka) * 260;
                g.shake(16); g.sfx('hit');
                g.burst(sh.x, sh.y, { n: 16, colour: '#ff8b8b', speed: 220 });
                g.flash(s.hull > 0 ? 'HULL BREACH — 5s OXYGEN LOST' : 'HULL GONE', '#ff8b8b', 700);
                if (s.hull <= 0) {
                    g.burst(sh.x, sh.y, { n: 60, colour: '#ffd35a', speed: 420, life: 1 });
                    g.shake(34); g.sfx('boom');
                    g.over('Hull failed in the deep field. Banked ' + s.banked + ' credits over ' + s.trips + ' trips.');
                    return;
                }
            }
        }
        if (s.hitCool > 0) s.hitCool -= dt;

        // Tractor beam: nearest loose ore inside reach comes with you.
        for (var o = 0; o < s.ore.length; o++) {
            var ore = s.ore[o];
            if (ore.held) continue;
            if (g.dist(sh.x, sh.y, ore.x, ore.y) < TETHER) {
                ore.held = true;
                s.carried.push(ore);
                g.sfx('pick', 1 + s.carried.length * 0.06);
                g.burst(ore.x, ore.y, { n: 8, colour: '#7aa2ff', speed: 120, life: 0.35 });
            }
        }
        // Towed ore trails behind in a line, which is also the visual weight cue.
        for (var t = 0; t < s.carried.length; t++) {
            var ct = s.carried[t];
            var tgtX = sh.x - Math.cos(sh.a) * (26 + t * 17);
            var tgtY = sh.y - Math.sin(sh.a) * (26 + t * 17);
            ct.x = g.lerp(ct.x, tgtX, Math.min(1, 7 * dt));
            ct.y = g.lerp(ct.y, tgtY, Math.min(1, 7 * dt));
            ct.rot += dt;
        }

        // Bank at base.
        if (g.dist(sh.x, sh.y, cx, cy) < BASE_R && s.carried.length) {
            var got = 0;
            for (var b = 0; b < s.carried.length; b++) {
                got += s.carried[b].value;
                var idx = s.ore.indexOf(s.carried[b]);
                if (idx >= 0) s.ore.splice(idx, 1);
            }
            s.carried.length = 0;
            s.banked += got;
            s.trips++;
            g.setScore(s.banked);
            g.flash('+' + got.toLocaleString() + ' BANKED', g.accent, 900);
            g.sfx('win');
            g.burst(cx, cy, { n: 24, colour: g.accent, speed: 220 });

            // Restock the deep field so a good run never runs out of temptation.
            for (var n = 0; n < 5; n++) {
                var aa = Math.random() * 6.2832;
                var dd = g.rand(s.fieldR * 0.55, s.fieldR);
                var depth = (dd - BASE_R) / (s.fieldR - BASE_R);
                s.ore.push({
                    x: cx + Math.cos(aa) * dd, y: cy + Math.sin(aa) * dd,
                    r: 9 + depth * 7, value: Math.round(80 + depth * depth * 620),
                    mass: 0.5 + depth * 1.6, held: false, rot: 0
                });
            }
        }

        var pending = 0;
        for (var p = 0; p < s.carried.length; p++) pending += s.carried[p].value;
        g.hud('OXYGEN <b style="color:' + (s.o2 < 15 ? '#ff8b8b' : '#e8eefc') + '">' + s.o2.toFixed(1) + 's</b><br>' +
              'HULL <b>' + s.hull + '/' + HULL_MAX + '</b> · TRIPS <b>' + s.trips + '</b><br>' +
              'IN THE TOW <b>' + pending.toLocaleString() + '</b> (unbanked)');
    }

    function draw(g, c) {
        var s = g.s;
        var cx = g.w / 2, cy = g.h / 2;
        c.fillStyle = '#03060f';
        c.fillRect(0, 0, g.w, g.h);

        c.strokeStyle = 'rgba(122,162,255,0.10)';
        c.setLineDash([4, 10]); c.lineWidth = 1.5;
        c.beginPath(); c.arc(cx, cy, s.fieldR, 0, 6.2832); c.stroke();
        c.setLineDash([]);

        // Base.
        g.glow(c, cx, cy, BASE_R * 2.4, 'rgba(100,255,218,0.16)');
        c.strokeStyle = g.accent; c.lineWidth = 2.5;
        c.beginPath(); c.arc(cx, cy, BASE_R, 0, 6.2832); c.stroke();
        c.fillStyle = 'rgba(100,255,218,0.10)';
        c.fill();
        c.fillStyle = 'rgba(159,179,204,0.9)';
        c.font = '600 11px Inter, sans-serif'; c.textAlign = 'center';
        c.fillText('BANK ORE HERE', cx, cy + 4);
        c.textAlign = 'left';

        for (var i = 0; i < s.rocks.length; i++) {
            var r = s.rocks[i];
            c.save(); c.translate(r.x, r.y); c.rotate(r.rot);
            c.fillStyle = '#4c5468';
            c.beginPath();
            for (var v = 0; v < 8; v++) {
                var ang = (v / 8) * 6.2832;
                var rr = r.r * (0.75 + ((v * 53) % 11) / 30);
                c.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
            }
            c.closePath(); c.fill();
            c.restore();
        }

        for (var o = 0; o < s.ore.length; o++) {
            var ore = s.ore[o];
            var hot = ore.value > 380;
            g.glow(c, ore.x, ore.y, ore.r * 3, hot ? 'rgba(255,211,90,0.30)' : 'rgba(122,162,255,0.24)');
            c.save(); c.translate(ore.x, ore.y); c.rotate(ore.rot);
            c.fillStyle = hot ? '#ffd35a' : '#7aa2ff';
            c.beginPath();
            for (var k = 0; k < 6; k++) {
                var a2 = (k / 6) * 6.2832;
                c.lineTo(Math.cos(a2) * ore.r, Math.sin(a2) * ore.r);
            }
            c.closePath(); c.fill();
            c.restore();
            if (!ore.held) {
                c.fillStyle = 'rgba(232,238,252,0.65)';
                c.font = '600 10px Inter, sans-serif'; c.textAlign = 'center';
                c.fillText(ore.value, ore.x, ore.y - ore.r - 6);
                c.textAlign = 'left';
            }
        }

        // Tow line.
        var sh = s.ship;
        if (s.carried.length) {
            c.strokeStyle = 'rgba(100,255,218,0.4)'; c.lineWidth = 1.6;
            c.beginPath(); c.moveTo(sh.x, sh.y);
            for (var t = 0; t < s.carried.length; t++) c.lineTo(s.carried[t].x, s.carried[t].y);
            c.stroke();
        }

        // Tractor reach, so the grab radius is never a mystery.
        c.strokeStyle = 'rgba(100,255,218,0.13)';
        c.beginPath(); c.arc(sh.x, sh.y, TETHER, 0, 6.2832); c.stroke();

        c.save();
        c.translate(sh.x, sh.y); c.rotate(sh.a);
        c.fillStyle = s.hitCool > 0 ? '#ff8b8b' : '#e8eefc';
        c.beginPath(); c.moveTo(14, 0); c.lineTo(-10, -8); c.lineTo(-5, 0); c.lineTo(-10, 8);
        c.closePath(); c.fill();
        c.restore();

        // Oxygen bar along the bottom — the clock you actually watch.
        var frac = Math.max(0, s.o2 / O2_START);
        c.fillStyle = 'rgba(255,255,255,0.08)';
        c.fillRect(0, g.h - 8, g.w, 8);
        c.fillStyle = frac < 0.2 ? '#ff8b8b' : '#7aa2ff';
        c.fillRect(0, g.h - 8, g.w * frac, 8);
    }

    Arcade.create({
        slug: 'asteroid-miner',
        title: 'ASTEROID MINER',
        accent: '#7aa2ff',
        tagline: 'Fly out, tow ore back, bank it at the base ring. Deep ore is worth far more and weighs far more. Oxygen only runs one way, and unbanked ore is worth nothing.',
        controls: [['CLICK / HOLD', 'thrust toward the cursor'], ['WASD / ↑←↓→', 'thrust'], ['FLY NEAR ORE', 'tractor it automatically'], ['ESC', 'back to arcade']],
        scoreLabel: 'CREDITS',
        overTitle: 'RUN ENDED',
        init: init,
        initMenu: init,
        update: update,
        draw: draw
    });
})();

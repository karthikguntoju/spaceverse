/**
 * Re-Entry — the corridor, and how narrow it is.
 *
 * Steep burns you up. Shallow skips you back into space. Between them is a
 * band a few degrees wide that you have to hold while the capsule shakes, and
 * that band is the entire game. Landing accuracy decides the score.
 */
(function () {
    var START_ALT = 90000;      // metres
    var START_VEL = 7800;       // m/s
    var HEAT_MAX = 100;
    var TURN = 1.35;            // radians/s of attitude authority

    // The survivable window, in radians below horizontal.
    var MIN_ANGLE = 0.09;
    var MAX_ANGLE = 0.33;

    function init(g) {
        g.s = {
            alt: START_ALT,
            vel: START_VEL,
            angle: 0.20,            // flight path angle below horizontal
            heat: 0,
            x: 0,                   // lateral offset from the pad, metres
            drift: g.rand(-1, 1) * 900,
            padHalf: 700,
            debris: [],
            debrisT: 1.2,
            skipT: 0,
            plasma: 0,
            landed: false,
            stars: Array.from({ length: 90 }, function () {
                return { x: g.rand(0, g.w), y: g.rand(0, g.h), r: g.rand(0.4, 1.5) };
            }),
            // Streaks rushing past are the only thing that says "falling". The
            // capsule itself never moves on screen, so without these the first
            // twenty seconds look like a still image with numbers on it.
            streaks: Array.from({ length: 70 }, function () {
                return { x: g.rand(0, g.w), y: g.rand(0, g.h), len: g.rand(14, 60), sp: g.rand(0.7, 1.5) };
            })
        };
    }

    /** How thick the air is here. Never quite zero, so there is always a sheath. */
    function densityAt(alt) {
        var f = 1 - alt / START_ALT;
        return Math.min(1.6, 0.10 + f * f * 1.9);
    }

    function update(g, dt) {
        var s = g.s;

        var left = g.key('ArrowLeft') || g.key('KeyA');
        var right = g.key('ArrowRight') || g.key('KeyD');
        // Pointer works too: cursor above the capsule pitches up, below pitches down.
        if (g.pointer.down) {
            if (g.pointer.y < g.h * 0.45) left = true;
            else if (g.pointer.y > g.h * 0.55) right = true;
        }
        if (left) s.angle -= TURN * dt * 0.35;     // shallower
        if (right) s.angle += TURN * dt * 0.35;    // steeper
        s.angle = g.clamp(s.angle, -0.05, 0.62);

        // Air gets thicker as you fall; density is what turns angle into heat.
        var density = densityAt(s.alt);

        var dragK = density * (0.55 + s.angle * 2.4);
        s.vel -= s.vel * dragK * dt * 0.55;
        s.vel = Math.max(90, s.vel);

        var descent = s.vel * Math.sin(s.angle);
        s.alt -= descent * dt;
        s.x += (s.vel * Math.cos(s.angle) * 0.06 + s.drift * density) * dt;

        // Scroll the streak layer at the rate you are actually falling.
        var streakSpeed = 90 + Math.abs(descent) * 0.22;
        for (var st = 0; st < s.streaks.length; st++) {
            var k = s.streaks[st];
            k.y += streakSpeed * k.sp * dt;
            if (k.y > g.h + 60) { k.y = -60; k.x = g.rand(0, g.w); }
        }

        var heatIn = density * (s.vel / START_VEL) * (12 + s.angle * 190);
        var heatOut = 26 * (1 - density * 0.5);
        s.heat = g.clamp(s.heat + (heatIn - heatOut) * dt, 0, HEAT_MAX + 1);
        s.plasma = g.clamp(heatIn / 40, 0, 1);

        if (s.heat >= HEAT_MAX) {
            g.burst(g.w / 2, g.h * 0.42, { n: 70, colour: '#ffb46b', speed: 460, life: 1.1 });
            g.shake(34); g.sfx('boom');
            g.over('Burned up at ' + Math.round(s.alt / 1000) + ' km. Your entry angle was too steep.');
            return;
        }

        // Too shallow at speed and the atmosphere throws you back out.
        if (s.angle < MIN_ANGLE && s.alt > 20000 && s.vel > 3000) {
            s.skipT += dt;
            g.flash('SKIPPING OUT — PITCH DOWN', '#ffd35a', 300);
            if (s.skipT > 2.4) {
                g.sfx('lose');
                g.over('You skipped off the atmosphere and back into space. Nobody is coming to get you.');
                return;
            }
        } else s.skipT = Math.max(0, s.skipT - dt);

        if (s.angle > MAX_ANGLE) g.shake(3 + (s.angle - MAX_ANGLE) * 40);

        // Weather cells and old debris in the descent corridor.
        s.debrisT -= dt;
        if (s.debrisT <= 0 && s.alt < 78000 && s.alt > 6000) {
            s.debrisT = g.rand(0.5, 1.3);
            s.debris.push({ x: g.rand(0.1, 0.9) * g.w, y: -40, r: g.rand(12, 30), v: g.rand(120, 260) });
        }
        for (var i = s.debris.length - 1; i >= 0; i--) {
            var d = s.debris[i];
            d.y += (d.v + s.vel * 0.02) * dt;
            if (d.y > g.h + 60) { s.debris.splice(i, 1); continue; }
            if (g.dist(d.x, d.y, g.w / 2, g.h * 0.42) < d.r + 16) {
                s.debris.splice(i, 1);
                s.heat = Math.min(HEAT_MAX + 1, s.heat + 22);
                g.shake(18); g.sfx('hit');
                g.flash('IMPACT — HEAT SPIKE', '#ff8b8b', 600);
                g.burst(g.w / 2, g.h * 0.42, { n: 16, colour: '#ff8b8b', speed: 220 });
            }
        }

        if (s.alt <= 0) {
            s.alt = 0;
            var off = Math.abs(s.x);
            var soft = s.vel < 260;
            var onPad = off < s.padHalf;
            var acc = Math.max(0, 1 - off / (s.padHalf * 3));
            var score = 0;
            if (soft) score += 4000 + Math.round(acc * 6000);
            if (onPad) score += 3000;
            score += Math.round((HEAT_MAX - s.heat) * 20);
            g.setScore(score);

            if (!soft) {
                g.burst(g.w / 2, g.h * 0.78, { n: 60, colour: '#ff8b8b', speed: 400, life: 1 });
                g.shake(30);
                g.over('You hit the ground at ' + Math.round(s.vel) + ' m/s. That is a crater, not a landing.');
            } else {
                g.burst(g.w / 2, g.h * 0.78, { n: 30, colour: g.accent, speed: 220, life: 0.9 });
                g.over(onPad
                    ? 'Touchdown on the pad, ' + Math.round(off) + ' m from centre, at ' + Math.round(s.vel) + ' m/s.'
                    : 'Soft landing, but ' + Math.round(off) + ' m off the pad. Bring a long walk.', true);
            }
            return;
        }

        g.addScore(dt * 40);
        var band = s.angle < MIN_ANGLE ? 'TOO SHALLOW' : s.angle > MAX_ANGLE ? 'TOO STEEP' : 'IN THE CORRIDOR';
        g.hud('ALTITUDE <b>' + (s.alt / 1000).toFixed(1) + ' km</b><br>' +
              'VELOCITY <b>' + Math.round(s.vel) + ' m/s</b><br>' +
              'ANGLE <b>' + (s.angle * 57.3).toFixed(1) + '°</b> — <b style="color:' +
              (band === 'IN THE CORRIDOR' ? '#64ffda' : '#ff8b8b') + '">' + band + '</b><br>' +
              'OFF PAD <b>' + Math.round(s.x) + ' m</b>');
    }

    function draw(g, c) {
        var s = g.s;
        var horizon = g.h * 0.78;
        var density = densityAt(s.alt);

        // Sky goes from black to orange as the air thickens.
        var sky = c.createLinearGradient(0, 0, 0, g.h);
        sky.addColorStop(0, 'rgb(' + Math.round(3 + density * 40) + ',' + Math.round(6 + density * 12) + ',' + Math.round(15 + density * 20) + ')');
        sky.addColorStop(1, 'rgb(' + Math.round(10 + density * 190) + ',' + Math.round(14 + density * 90) + ',' + Math.round(30 + density * 30) + ')');
        c.fillStyle = sky;
        c.fillRect(0, 0, g.w, g.h);

        c.globalAlpha = Math.max(0, 1 - density);
        c.fillStyle = '#cfe0ff';
        for (var i = 0; i < s.stars.length; i++) c.fillRect(s.stars[i].x, s.stars[i].y, s.stars[i].r, s.stars[i].r);
        c.globalAlpha = 1;

        // Air rushing past. Colour warms with density so the streaks double as
        // an ambient heat readout you catch without looking at the gauge.
        c.strokeStyle = density > 0.7 ? 'rgba(255,180,107,0.45)'
            : density > 0.35 ? 'rgba(255,220,170,0.30)' : 'rgba(207,224,255,0.22)';
        c.lineWidth = 1.4;
        c.beginPath();
        for (var k = 0; k < s.streaks.length; k++) {
            var sk = s.streaks[k];
            c.moveTo(sk.x, sk.y);
            c.lineTo(sk.x, sk.y + sk.len * (0.6 + density));
        }
        c.stroke();

        // Ground, and the pad you are aiming at.
        if (s.alt < 55000) {
            var reveal = g.clamp(1 - s.alt / 55000, 0, 1);
            c.fillStyle = 'rgba(28,48,38,' + reveal + ')';
            c.fillRect(0, horizon, g.w, g.h - horizon);
            var padX = g.w / 2 - s.x * 0.08;
            c.fillStyle = 'rgba(100,255,218,' + (reveal * 0.9) + ')';
            c.fillRect(padX - s.padHalf * 0.08, horizon - 4, s.padHalf * 0.16, 8);
            c.strokeStyle = 'rgba(100,255,218,' + (reveal * 0.5) + ')';
            c.setLineDash([5, 7]); c.lineWidth = 1.5;
            c.beginPath(); c.moveTo(padX, horizon); c.lineTo(padX, horizon - 70 * reveal); c.stroke();
            c.setLineDash([]);
        }

        for (var d = 0; d < s.debris.length; d++) {
            var db = s.debris[d];
            c.fillStyle = 'rgba(170,150,140,0.85)';
            c.beginPath(); c.arc(db.x, db.y, db.r, 0, 6.2832); c.fill();
        }

        // Capsule with a plasma sheath in front of the heat shield.
        var cx = g.w / 2, cy = g.h * 0.42;
        if (s.plasma > 0.05) {
            g.glow(c, cx, cy + 22, 60 + s.plasma * 90,
                'rgba(255,' + Math.round(190 - s.plasma * 120) + ',80,' + (0.25 + s.plasma * 0.5) + ')');
            for (var t = 0; t < 3; t++) {
                g.burst(cx + g.rand(-14, 14), cy + 20, {
                    n: 1, angle: 1.57, spread: 0.5,
                    speed: 200 + s.plasma * 320, life: 0.35,
                    colour: s.plasma > 0.6 ? '#fff1c0' : '#ffb46b', size: 2.4
                });
            }
        }
        c.save();
        c.translate(cx, cy);
        c.rotate(s.angle * 0.8);
        c.fillStyle = '#dfe7f7';
        c.beginPath();
        c.moveTo(-17, -14); c.lineTo(17, -14); c.lineTo(22, 10); c.lineTo(-22, 10);
        c.closePath(); c.fill();
        c.fillStyle = s.heat > 70 ? '#ff9d5a' : '#5a6b86';
        c.beginPath();
        c.moveTo(-22, 10); c.lineTo(22, 10); c.lineTo(15, 22); c.lineTo(-15, 22);
        c.closePath(); c.fill();
        c.restore();

        // The corridor gauge: the whole game in one widget on the right.
        var gx = g.w - 74, gy = g.h * 0.26, gh = g.h * 0.44;
        c.fillStyle = 'rgba(255,255,255,0.08)';
        c.fillRect(gx, gy, 26, gh);
        var toY = function (a) { return gy + gh * (a / 0.62); };
        c.fillStyle = 'rgba(100,255,218,0.30)';
        c.fillRect(gx, toY(MIN_ANGLE), 26, toY(MAX_ANGLE) - toY(MIN_ANGLE));
        c.fillStyle = s.angle < MIN_ANGLE || s.angle > MAX_ANGLE ? '#ff8b8b' : '#64ffda';
        c.fillRect(gx - 5, toY(s.angle) - 2.5, 36, 5);
        c.fillStyle = 'rgba(159,179,204,0.9)';
        c.font = '600 10px Inter, sans-serif';
        c.textAlign = 'center';
        c.fillText('SHALLOW', gx + 13, gy - 22);
        c.fillText('ANGLE', gx + 13, gy - 9);
        c.fillText('STEEP', gx + 13, gy + gh + 16);

        // Heat bar to the left of the angle gauge, far enough that the two
        // captions do not collide on a narrow window.
        var hx = gx - 48;
        c.fillStyle = 'rgba(255,255,255,0.08)';
        c.fillRect(hx, gy, 14, gh);
        var hh = gh * (s.heat / HEAT_MAX);
        c.fillStyle = s.heat > 80 ? '#ff5a5a' : s.heat > 55 ? '#ffb46b' : '#ffd35a';
        c.fillRect(hx, gy + gh - hh, 14, hh);
        c.fillText('HEAT', hx + 7, gy - 9);
        c.textAlign = 'left';
    }

    Arcade.create({
        slug: 're-entry',
        title: 'RE-ENTRY',
        accent: '#ff8b5a',
        tagline: 'Mach 25 and falling. Hold the capsule inside the green corridor on the right: too steep and you burn up, too shallow and you skip back into space. Land soft, land on the pad.',
        controls: [['← / A', 'pitch shallower'], ['→ / D', 'pitch steeper'], ['CLICK top/bottom', 'same, with a mouse'], ['ESC', 'back to arcade']],
        scoreLabel: 'SCORE',
        overTitle: 'LOST',
        winTitle: 'TOUCHDOWN',
        init: init,
        initMenu: init,
        update: update,
        draw: draw
    });
})();

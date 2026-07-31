/**
 * Re-Entry — the corridor, and how narrow it is.
 *
 * Steep burns you up. Shallow skips you back into space. Between them is a
 * band a few degrees wide that you have to hold while the capsule shakes.
 * That is the vertical game. The horizontal game is cross-range: wind pushes
 * you off the pad and banking is the only thing that pushes back — and banking
 * costs heat, so the two axes argue with each other the whole way down.
 */
(function () {
    var START_ALT = 90000;      // metres
    var START_VEL = 7800;       // m/s
    var HEAT_MAX = 100;
    var TURN = 1.35;            // radians/s of attitude authority
    var BANK_K = 0.04;          // cross-range metres per m/s of velocity, per second
    var PX_PER_M = 0.08;        // screen pixels per metre of cross-range
    var PAD_HALF = 2600;        // half-width of the pad, metres
    var MILE = 10000;           // corridor bonus every 10 km descended
    var HORIZON_F = 0.78;       // where the limb ends up at touchdown

    // The survivable window, in radians below horizontal.
    var MIN_ANGLE = 0.09;
    var MAX_ANGLE = 0.33;

    /* ── setup ────────────────────────────────────────────────────────── */

    function newStreak(g, y) {
        // sx is the streak's offset from the capsule, not an absolute x: the
        // whole field radiates from wherever the capsule currently is.
        return {
            sx: g.rand(-1, 1) * g.w * 0.62,
            y: y,
            len: g.rand(16, 62),
            sp: g.rand(0.7, 1.6),
            w: g.rand(0.8, 2.6),
            a: g.rand(0.10, 0.55)
        };
    }

    function init(g) {
        var i;
        var side = Math.random() < 0.5 ? -1 : 1;
        var s = {
            alt: START_ALT,
            vel: START_VEL,
            angle: 0.20,            // flight path angle below horizontal
            bank: -0,               // −1 full left, +1 full right
            heat: 0,
            heatSum: 0,             // cumulative — drives the ablation scars
            // Cross-range error in metres. You start off-target on purpose;
            // nulling it is the job.
            x: side * g.rand(2400, 5000),
            drift: g.rand(-1, 1) * 95,   // high-altitude wind, m/s at unit density
            padHalf: PAD_HALF,
            debris: [],
            warns: [],              // telegraphed spawns, 0.8s ahead of the rock
            debrisT: 1.4,
            skipT: 0,
            plasma: 0,
            descent: 0,
            mile: START_ALT - MILE,
            streak: 0,
            bestStreak: 0,
            landed: false,
            destroyed: false,
            ended: false,
            ringT: -1,              // set to g.t at touchdown; draws the pad pulse
            stars: [],
            streaks: [],
            clouds: []
        };
        for (i = 0; i < 90; i++) {
            s.stars.push({
                x: g.rand(0, g.w), y: g.rand(0, g.h * 0.8), r: g.rand(0.4, 1.5),
                tw: g.rand(0.8, 2.6), ph: g.rand(0, 6.2832)
            });
        }
        for (i = 0; i < 70; i++) s.streaks.push(newStreak(g, g.rand(-60, g.h)));
        for (i = 0; i < 30; i++) {
            s.clouds.push({
                u: g.rand(-1, 1), yo: g.rand(0, 1),
                rx: g.rand(26, 92), sq: g.rand(0.16, 0.32), a: g.rand(0.10, 0.30)
            });
        }
        g.s = s;
    }

    /** How thick the air is here. Never quite zero, so there is always a sheath. */
    function densityAt(alt) {
        var f = 1 - alt / START_ALT;
        return Math.min(1.6, 0.10 + f * f * 1.9);
    }

    /** Screen x of the capsule. The correction has to be visible or it is not a control. */
    function capX(g, s) {
        return g.w / 2 + g.clamp(-s.x * PX_PER_M, -g.w * 0.35, g.w * 0.35);
    }

    /** Top of Earth's limb: rises to meet the horizon line as you fall. */
    function limbTopY(g, s) {
        return g.h * HORIZON_F + g.clamp(s.alt / 70000, 0, 1) * g.h * 0.20;
    }

    function limbAlpha(s) {
        var a = (START_ALT - s.alt) / 20000;
        return a < 0 ? 0 : a > 1 ? 1 : a;
    }

    function scrollStreaks(g, s, descent, dt) {
        var speed = 90 + Math.abs(descent) * 0.22;
        for (var i = 0; i < s.streaks.length; i++) {
            var k = s.streaks[i];
            k.y += speed * k.sp * dt;
            if (k.y > g.h + 70) {
                var fresh = newStreak(g, -70);
                k.sx = fresh.sx; k.y = fresh.y; k.len = fresh.len;
                k.sp = fresh.sp; k.w = fresh.w; k.a = fresh.a;
            }
        }
    }

    function scrollClouds(g, s, descent, dt) {
        // Deliberately 0.15x the air speed: clouds belong to the ground, not
        // to the wind rushing past the window.
        var band = g.h * 0.34;
        var speed = 0.15 * (90 + Math.abs(descent) * 0.22);
        for (var i = 0; i < s.clouds.length; i++) {
            var cl = s.clouds[i];
            cl.yo += (speed / band) * dt;
            if (cl.yo > 1) { cl.yo -= 1; cl.u = g.rand(-1, 1); cl.rx = g.rand(26, 92); }
        }
    }

    function spinDebris(s, dt) {
        for (var i = 0; i < s.debris.length; i++) s.debris[i].rot += s.debris[i].spin * dt;
    }

    /* ── update ───────────────────────────────────────────────────────── */

    function update(g, dt) {
        var s = g.s, i;

        /* pitch: W/S and the arrow keys. Up is shallower, down is steeper. */
        var up = g.key('ArrowUp') || g.key('KeyW');
        var down = g.key('ArrowDown') || g.key('KeyS');
        /* bank: A/D and left/right. This is the cross-range axis the score
           actually pays for. */
        var bankL = g.key('ArrowLeft') || g.key('KeyA');
        var bankR = g.key('ArrowRight') || g.key('KeyD');

        var bankTarget = (bankR ? 1 : 0) - (bankL ? 1 : 0);
        if (g.pointer.down) {
            if (g.pointer.y < g.h * 0.45) up = true;
            else if (g.pointer.y > g.h * 0.55) down = true;
            var px = (g.pointer.x - g.w / 2) / (g.w * 0.34);
            if (Math.abs(px) > 0.12) bankTarget += g.clamp(px, -1, 1);
        }

        if (up) s.angle -= TURN * dt * 0.35;
        if (down) s.angle += TURN * dt * 0.35;
        s.angle = g.clamp(s.angle, -0.05, 0.62);

        bankTarget = g.clamp(bankTarget, -1, 1);
        s.bank += (bankTarget - s.bank) * Math.min(1, dt * 6);
        if (Math.abs(s.bank) < 0.004) s.bank = 0;

        // Air gets thicker as you fall; density is what turns angle into heat.
        var density = densityAt(s.alt);

        var dragK = density * (0.55 + s.angle * 2.4);
        s.vel -= s.vel * dragK * dt * 0.55;
        s.vel = Math.max(90, s.vel);

        var descent = s.vel * Math.sin(s.angle);
        s.descent = descent;
        s.alt -= descent * dt;

        // Cross-range: a wind that shoves you off the pad, and a bank that
        // shoves back. Bank authority scales with velocity, so the cheap time
        // to fix your aim is early — when the air is thin and it costs no heat.
        var wind = s.drift * density * (1 + 0.5 * Math.sin(g.t * 0.35));
        s.x += wind * dt;
        s.x -= s.bank * s.vel * BANK_K * dt;

        scrollStreaks(g, s, descent, dt);
        scrollClouds(g, s, descent, dt);
        spinDebris(s, dt);

        var heatIn = density * (s.vel / START_VEL) * (12 + s.angle * 190);
        heatIn *= 1 + Math.abs(s.bank) * 0.4;      // a bank is a bigger cross-section
        var heatOut = 26 * (1 - density * 0.5);
        s.heat = g.clamp(s.heat + (heatIn - heatOut) * dt, 0, HEAT_MAX + 1);
        s.heatSum += heatIn * dt;
        s.plasma = g.clamp(heatIn / 40, 0, 1);

        if (s.heat >= HEAT_MAX) {
            g.burst(capX(g, s), g.h * 0.42, { n: 70, colour: '#ffb46b', speed: 460, life: 1.1 });
            g.shake(34); g.sfx('boom');
            s.destroyed = true; s.ended = true;
            g.over('Burned up at ' + Math.round(s.alt / 1000) + ' km. Your entry angle was too steep.');
            return;
        }

        // Too shallow at speed and the atmosphere throws you back out.
        if (s.angle < MIN_ANGLE && s.alt > 20000 && s.vel > 3000) {
            s.skipT += dt;
            g.flash('SKIPPING OUT — PITCH DOWN', '#ffd35a', 300);
            if (s.skipT > 2.4) {
                g.sfx('lose');
                s.ended = true;
                g.over('You skipped off the atmosphere and back into space. Nobody is coming to get you.');
                return;
            }
        } else s.skipT = Math.max(0, s.skipT - dt);

        if (s.angle > MAX_ANGLE) g.shake(3 + (s.angle - MAX_ANGLE) * 40);

        /* Every 10 km is a checkpoint. Hold the corridor through it and the
           run pays out mid-flight instead of banking everything on touchdown. */
        while (s.alt <= s.mile && s.mile > 0) {
            if (s.angle >= MIN_ANGLE && s.angle <= MAX_ANGLE) {
                s.streak++;
                if (s.streak > s.bestStreak) s.bestStreak = s.streak;
                g.addScore(250);
                g.flash('CORRIDOR +250  ×' + s.streak, '#64ffda', 620);
                g.sfx('pick', 1 + Math.min(s.streak, 6) * 0.06);
            } else {
                s.streak = 0;
                g.flash('OUT OF CORRIDOR — STREAK LOST', '#ff8b8b', 620);
                g.sfx('hit', 0.7);
            }
            s.mile -= MILE;
        }

        /* Weather cells and old debris. Telegraphed 0.8s ahead so they are a
           dodge, not a dice roll, and packed tighter as the air thickens. */
        s.debrisT -= dt;
        if (s.debrisT <= 0 && s.alt < 78000 && s.alt > 5000) {
            s.debrisT = g.rand(0.5, 1.3) * (0.4 + s.alt / START_ALT);
            s.warns.push({ x: g.rand(0.1, 0.9) * g.w, t: 0.8, r: g.rand(12, 30) });
            g.sfx('tick', 0.75);
        }
        for (i = s.warns.length - 1; i >= 0; i--) {
            var wn = s.warns[i];
            wn.t -= dt;
            if (wn.t <= 0) {
                s.warns.splice(i, 1);
                s.debris.push({
                    x: wn.x, y: -50, r: wn.r, v: g.rand(120, 260),
                    seed: g.rand(1, 9000), rot: g.rand(0, 6.2832), spin: g.rand(-2.2, 2.2)
                });
            }
        }

        var cx = capX(g, s);
        for (i = s.debris.length - 1; i >= 0; i--) {
            var d = s.debris[i];
            d.y += (d.v + s.vel * 0.02) * dt;
            if (d.y > g.h + 60) { s.debris.splice(i, 1); continue; }
            if (g.dist(d.x, d.y, cx, g.h * 0.42) < d.r + 16) {
                s.debris.splice(i, 1);
                s.heat = Math.min(HEAT_MAX + 1, s.heat + 22);
                g.shake(18); g.sfx('hit');
                g.flash('IMPACT — HEAT SPIKE', '#ff8b8b', 600);
                g.burst(cx, g.h * 0.42, { n: 16, colour: '#ff8b8b', speed: 220 });
            }
        }

        if (s.alt <= 0) {
            s.alt = 0;
            s.descent = 0;
            s.ended = true;
            var gx = capX(g, s);
            var off = Math.abs(s.x);
            var soft = s.vel < 260;
            var onPad = off < s.padHalf;
            var acc = Math.max(0, 1 - off / (s.padHalf * 3));
            var score = 0;
            if (soft) score += 4000 + Math.round(acc * 6000);
            if (onPad) score += 3000;
            score += Math.round((HEAT_MAX - s.heat) * 20);
            score += s.bestStreak * 120;
            // addScore, not setScore: the corridor bonuses earned on the way
            // down are part of the run, not a discarded draft.
            g.addScore(score);

            if (!soft) {
                s.destroyed = true;
                g.burst(gx, g.h * HORIZON_F, { n: 60, colour: '#ff8b8b', speed: 400, life: 1 });
                g.burst(gx, g.h * HORIZON_F, { n: 26, colour: '#ffd35a', speed: 540, life: 0.6, shape: 'spark' });
                g.shake(42);
                g.over('You hit the ground at ' + Math.round(s.vel) + ' m/s. That is a crater, not a landing.');
            } else {
                s.landed = true;
                s.plasma = 0;
                g.burst(gx, g.h * HORIZON_F, { n: 30, colour: g.accent, speed: 220, life: 0.9 });
                // Dust kicked up by the touchdown: heavy drag so it hangs low.
                g.burst(gx, g.h * HORIZON_F, { n: 24, colour: '#9aa3ad', speed: 130, life: 1.1, drag: 4.5, size: 2.6 });
                s.ringT = g.t;
                g.over(onPad
                    ? 'Touchdown on the pad, ' + Math.round(off) + ' m from centre, at ' + Math.round(s.vel) + ' m/s.'
                    : 'Soft landing, but ' + Math.round(off) + ' m off the pad. Bring a long walk.', true);
            }
            return;
        }

        g.addScore(dt * 30);
        var band = s.angle < MIN_ANGLE ? 'TOO SHALLOW' : s.angle > MAX_ANGLE ? 'TOO STEEP' : 'IN THE CORRIDOR';
        var offNow = Math.round(Math.abs(s.x));
        var cue = offNow < 220 ? '<b style="color:#64ffda">ON LINE</b>'
            : (s.x > 0 ? '<b>BANK ▶ D</b>' : '<b>BANK ◀ A</b>');
        g.hud('ALTITUDE <b>' + (s.alt / 1000).toFixed(1) + ' km</b><br>' +
              'VELOCITY <b>' + Math.round(s.vel) + ' m/s</b><br>' +
              'ANGLE <b>' + (s.angle * 57.3).toFixed(1) + '°</b> — <b style="color:' +
              (band === 'IN THE CORRIDOR' ? '#64ffda' : '#ff8b8b') + '">' + band + '</b><br>' +
              'OFF PAD <b style="color:' + (offNow < s.padHalf ? '#64ffda' : '#ffd35a') + '">' +
              offNow.toLocaleString() + ' m</b> ' + cue + '<br>' +
              'CORRIDOR STREAK <b style="color:' + (s.streak ? '#64ffda' : '#9fb3cc') + '">×' + s.streak + '</b>');
    }

    /* ── idle: the menu and the game-over card sit over a live scene ──── */

    function idle(g, dt) {
        var s = g.s;
        if (!s || !s.streaks) return;
        if (!s.ended) {
            // Menu: a capsule holding station high up, swaying on the wind.
            s.alt = 68000 + Math.sin(g.t * 0.28) * 4200;
            s.angle = 0.20 + Math.sin(g.t * 0.55) * 0.055;
            s.bank = Math.sin(g.t * 0.33) * 0.5;
            s.x = g.clamp(s.x - s.bank * 300 * dt, -5200, 5200);
            s.plasma = 0.24 + 0.13 * Math.sin(g.t * 1.7);
            s.descent = 780 + Math.sin(g.t * 0.5) * 190;
        } else {
            // After the run: keep the final frame breathing rather than frozen.
            s.descent = s.landed ? 120 : 320;
            if (s.destroyed) s.plasma = Math.max(0, s.plasma - dt * 0.5);
        }
        scrollStreaks(g, s, s.descent, dt);
        scrollClouds(g, s, s.descent, dt);
        spinDebris(s, dt);
        for (var i = s.debris.length - 1; i >= 0; i--) {
            s.debris[i].y += s.debris[i].v * 0.35 * dt;
            if (s.debris[i].y > g.h + 60) s.debris.splice(i, 1);
        }
    }

    /* ── draw ─────────────────────────────────────────────────────────── */

    function drawEarth(g, c, s, density) {
        var la = limbAlpha(s);
        if (la <= 0.001) return;

        var top = limbTopY(g, s);
        var R = Math.max(g.w, g.h) * 1.55;
        var cy = top + R;
        var cx = g.w / 2;
        var reveal = g.clamp(1 - s.alt / 55000, 0, 1);

        c.save();
        c.globalAlpha = la;

        // The body of the planet: nadir is warm land, the limb edge falls off
        // to deep ocean blue. Only the outer ~12% of the disc is on screen, so
        // the whole ramp lives out there.
        c.beginPath();
        c.arc(cx, cy, R, 0, 6.2832);
        var grd = c.createRadialGradient(cx, cy, R * 0.88, cx, cy, R);
        grd.addColorStop(0, 'rgb(150,124,86)');
        grd.addColorStop(0.40, 'rgb(46,124,124)');
        grd.addColorStop(0.75, 'rgb(18,62,110)');
        grd.addColorStop(1, 'rgb(8,24,56)');
        c.fillStyle = grd;
        c.fill();

        // Terrain wash: the old 55km "rectangle appears" moment, now a tint
        // sliding over a planet that has been there the whole descent.
        if (reveal > 0.001) {
            c.save();
            c.beginPath(); c.arc(cx, cy, R, 0, 6.2832); c.clip();
            var tg = c.createLinearGradient(0, top, 0, g.h);
            tg.addColorStop(0, 'rgba(38,64,50,' + (reveal * 0.55) + ')');
            tg.addColorStop(1, 'rgba(16,32,26,' + (reveal * 0.92) + ')');
            c.fillStyle = tg;
            c.fillRect(0, top, g.w, g.h - top + 4);
            c.restore();
        }

        // Clouds, clipped to the disc and drifting at a fraction of the air speed.
        c.save();
        c.beginPath(); c.arc(cx, cy, R, 0, 6.2832); c.clip();
        var band = g.h * 0.34;
        for (var i = 0; i < s.clouds.length; i++) {
            var cl = s.clouds[i];
            var y = top + cl.yo * band;
            if (y > g.h + 40) continue;
            var x = cx + cl.u * g.w * (0.45 + cl.yo * 0.62);
            var rx = cl.rx * (0.55 + cl.yo * 1.15);
            var a = cl.a * g.clamp(cl.yo * 5, 0, 1) * g.clamp((1 - cl.yo) * 3, 0, 1);
            if (a <= 0.004) continue;
            c.save();
            c.translate(x, y);
            c.scale(1, cl.sq);
            var cg = c.createRadialGradient(0, 0, 0, 0, 0, rx);
            cg.addColorStop(0, 'rgba(255,255,255,' + a.toFixed(3) + ')');
            cg.addColorStop(0.55, 'rgba(235,244,255,' + (a * 0.5).toFixed(3) + ')');
            cg.addColorStop(1, 'rgba(255,255,255,0)');
            c.fillStyle = cg;
            c.beginPath(); c.arc(0, 0, rx, 0, 6.2832); c.fill();
            c.restore();
        }
        c.restore();

        // The pad, sitting on the limb where you are actually going.
        if (reveal > 0.001) {
            var half = s.padHalf * PX_PER_M;
            c.fillStyle = 'rgba(100,255,218,' + (reveal * 0.9) + ')';
            c.fillRect(cx - half, top - 4, half * 2, 8);
            c.fillStyle = 'rgba(255,255,255,' + (reveal * 0.55) + ')';
            c.fillRect(cx - 2, top - 5, 4, 10);
            c.strokeStyle = 'rgba(100,255,218,' + (reveal * 0.5) + ')';
            c.setLineDash([5, 7]); c.lineWidth = 1.5;
            c.beginPath(); c.moveTo(cx, top); c.lineTo(cx, top - 80 * reveal); c.stroke();
            c.setLineDash([]);
        }

        // Atmosphere: a hard additive rim on the limb plus the haze above it.
        c.globalCompositeOperation = 'lighter';
        c.strokeStyle = 'rgba(120,190,255,0.5)';
        c.lineWidth = 6;
        c.beginPath(); c.arc(cx, cy, R - 3, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
        var hz = c.createLinearGradient(0, top - 46, 0, top + 6);
        hz.addColorStop(0, 'rgba(120,190,255,0)');
        hz.addColorStop(1, 'rgba(120,190,255,' + (0.16 + density * 0.10).toFixed(3) + ')');
        c.fillStyle = hz;
        c.fillRect(0, top - 46, g.w, 52);
        c.restore();
    }

    function drawStreaks(g, c, s, density, cx) {
        var rgb = density > 0.7 ? '255,180,107' : density > 0.35 ? '255,220,170' : '207,224,255';
        var lf = g.clamp(Math.abs(s.descent) / 1500, 0.3, 2.2) * (0.6 + density);
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.strokeStyle = 'rgba(' + rgb + ',1)';
        c.lineCap = 'round';
        for (var i = 0; i < s.streaks.length; i++) {
            var k = s.streaks[i];
            var len = k.len * lf;
            c.globalAlpha = k.a;
            c.lineWidth = k.w;
            c.beginPath();
            // Splayed: near end tight to the capsule, far end thrown outward,
            // so the field reads as flow past a body instead of falling rain.
            c.moveTo(cx + k.sx, k.y);
            c.lineTo(cx + k.sx * 1.18, k.y + len);
            c.stroke();
        }
        c.restore();
        c.globalAlpha = 1;
    }

    function drawDebris(g, c, s, density) {
        var i;
        // Telegraph first: a pulsing reticle where the next rock will enter.
        for (i = 0; i < s.warns.length; i++) {
            var wn = s.warns[i];
            var p = 1 - wn.t / 0.8;
            var pulse = 0.35 + 0.45 * Math.abs(Math.sin(p * 11));
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.strokeStyle = 'rgba(255,211,90,' + pulse.toFixed(3) + ')';
            c.lineWidth = 1.6;
            var rr = wn.r * (1.9 - p * 0.75);
            c.beginPath(); c.arc(wn.x, 74, rr, 0, 6.2832); c.stroke();
            c.beginPath();
            c.moveTo(wn.x - 9, 74 + rr + 6);
            c.lineTo(wn.x, 74 + rr + 15);
            c.lineTo(wn.x + 9, 74 + rr + 6);
            c.stroke();
            c.globalAlpha = 0.22 * pulse;
            c.setLineDash([4, 10]);
            c.beginPath(); c.moveTo(wn.x, 74 + rr + 18); c.lineTo(wn.x, g.h * 0.42); c.stroke();
            c.setLineDash([]);
            c.restore();
        }

        for (i = 0; i < s.debris.length; i++) {
            var db = s.debris[i];
            if (density > 0.3) {
                g.bloom(c, db.x, db.y - db.r * 0.35, db.r * 1.9,
                    'rgba(255,140,70,' + (density * 0.20).toFixed(3) + ')');
            }
            c.save();
            c.translate(db.x, db.y);
            c.rotate(db.rot);
            var dg = c.createLinearGradient(-db.r, -db.r, db.r, db.r);
            dg.addColorStop(0, 'rgb(' + Math.round(148 + density * 70) + ',' +
                Math.round(132 + density * 34) + ',122)');
            dg.addColorStop(1, '#2c2621');
            c.fillStyle = dg;
            g.rockPath(c, db.r, db.seed, 9);
            c.fill();
            c.strokeStyle = 'rgba(255,170,110,' + (0.12 + density * 0.32).toFixed(3) + ')';
            c.lineWidth = 1.2;
            c.stroke();
            c.restore();
        }
    }

    function drawCapsule(g, c, s, cx, cy) {
        if (s.destroyed) {
            if (s.plasma > 0.02) {
                g.bloom(c, cx, cy, 70 + s.plasma * 60,
                    'rgba(255,140,70,' + (s.plasma * 0.5).toFixed(3) + ')');
            }
            return;
        }

        if (s.plasma > 0.05) {
            // Additive: overlapping sheath layers stack into heat instead of paint.
            g.bloom(c, cx, cy + 22, 60 + s.plasma * 90,
                'rgba(255,' + Math.round(190 - s.plasma * 120) + ',80,' + (0.25 + s.plasma * 0.5) + ')');
            for (var t = 0; t < 3; t++) {
                var pv = s.plasma * (0.7 + Math.random() * 0.45);
                g.burst(cx + g.rand(-14, 14), cy + 20, {
                    n: 1, angle: 1.57, spread: 0.5,
                    speed: 200 + s.plasma * 320, life: 0.35,
                    colour: pv > 0.8 ? '#ffffff' : pv > 0.55 ? '#fff1c0' : pv > 0.3 ? '#ffb46b' : '#ff8a3d',
                    size: 2.4, shape: 'spark'
                });
            }
        }

        // Plasma streamers: hot air peeling off the shield and whipping away.
        if (s.plasma > 0.35) {
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.lineWidth = 2;
            for (var w = 0; w < 3; w++) {
                var wx = cx + (w - 1) * 13 - s.bank * 10;
                var wob = Math.sin(g.t * 13 + w * 2.4) * 8 + s.bank * 16;
                var wlen = 34 + s.plasma * 70;
                c.strokeStyle = 'rgba(255,' + (w === 1 ? 214 : 170) + ',110,' +
                    ((0.08 + s.plasma * 0.2) * (0.75 + 0.25 * Math.sin(g.t * 9 + w * 1.7))).toFixed(3) + ')';
                c.beginPath();
                c.moveTo(wx, cy + 20);
                c.quadraticCurveTo(wx + wob, cy + 20 + wlen * 0.55, wx + wob * 1.7, cy + 20 + wlen);
                c.stroke();
            }
            c.restore();
        }

        c.save();
        c.translate(cx, cy);
        c.rotate(s.landed ? 0 : s.angle * 0.8 + s.bank * 0.34);

        // Hull.
        c.fillStyle = '#dfe7f7';
        c.beginPath();
        c.moveTo(-17, -14); c.lineTo(17, -14); c.lineTo(22, 10); c.lineTo(-22, 10);
        c.closePath();
        c.fill();

        // Firelight thrown up off the shield onto the hull.
        var lit = c.createLinearGradient(0, 10, 0, -8);
        lit.addColorStop(0, 'rgba(255,150,60,' + s.plasma.toFixed(3) + ')');
        lit.addColorStop(1, 'rgba(255,150,60,0)');
        c.fillStyle = lit;
        c.beginPath();
        c.moveTo(-17, -14); c.lineTo(17, -14); c.lineTo(22, 10); c.lineTo(-22, 10);
        c.closePath();
        c.fill();

        // Specular rim, upper-left: the one edge catching the sun.
        c.strokeStyle = 'rgba(255,255,255,0.5)';
        c.lineWidth = 1.5;
        c.lineJoin = 'round';
        c.beginPath();
        c.moveTo(-20.5, 8); c.lineTo(-16.2, -12.8); c.lineTo(16.2, -12.8);
        c.stroke();

        // Heat shield.
        c.fillStyle = s.heat > 70 ? '#ff9d5a' : '#5a6b86';
        c.beginPath();
        c.moveTo(-22, 10); c.lineTo(22, 10); c.lineTo(15, 22); c.lineTo(-15, 22);
        c.closePath(); c.fill();

        // Ablation: the shield keeps a record of everything it has eaten.
        var scar = g.clamp(s.heatSum / 900, 0, 0.72);
        if (scar > 0.02) {
            c.strokeStyle = 'rgba(22,14,10,' + scar.toFixed(3) + ')';
            c.lineWidth = 2.4;
            c.lineCap = 'round';
            for (var q = 0; q < 3; q++) {
                var sxp = -11 + q * 11;
                c.beginPath();
                c.moveTo(sxp - 2, 11.5);
                c.quadraticCurveTo(sxp + 2.5, 16.5, sxp + 0.5, 21);
                c.stroke();
            }
            c.strokeStyle = 'rgba(255,120,50,' + (scar * 0.45).toFixed(3) + ')';
            c.lineWidth = 1;
            c.beginPath(); c.moveTo(-15, 21.4); c.lineTo(15, 21.4); c.stroke();
        }
        c.restore();
    }

    /** Cross-range tape: the pad is at the notch, you are the marker. */
    function drawTape(g, c, s) {
        var tw = Math.min(g.w * 0.52, 620);
        var tx = g.w / 2 - tw / 2;
        var ty = g.h - 56;
        var SPAN = 9000;

        c.fillStyle = 'rgba(255,255,255,0.07)';
        c.fillRect(tx, ty, tw, 8);
        var padW = (s.padHalf / SPAN) * tw;
        c.fillStyle = 'rgba(100,255,218,0.30)';
        c.fillRect(g.w / 2 - padW, ty, padW * 2, 8);
        c.fillStyle = 'rgba(255,255,255,0.55)';
        c.fillRect(g.w / 2 - 1, ty - 4, 2, 16);

        var mx = g.w / 2 + g.clamp(-s.x / SPAN, -1, 1) * (tw / 2);
        var on = Math.abs(s.x) < s.padHalf;
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.fillStyle = on ? '#64ffda' : '#ffd35a';
        c.beginPath();
        c.moveTo(mx, ty - 2); c.lineTo(mx + 7, ty - 12); c.lineTo(mx - 7, ty - 12);
        c.closePath(); c.fill();
        c.restore();

        c.fillStyle = 'rgba(159,179,204,0.75)';
        c.font = '600 10px "Space Grotesk", Inter, sans-serif';
        c.textAlign = 'center';
        c.fillText('CROSS-RANGE  ·  A / D TO BANK', g.w / 2, ty + 24);
        c.textAlign = 'left';
    }

    function drawGauges(g, c, s) {
        var gx = g.w - 74, gy = g.h * 0.26, gh = g.h * 0.44;
        c.fillStyle = 'rgba(255,255,255,0.08)';
        c.fillRect(gx, gy, 26, gh);
        var toY = function (a) { return gy + gh * (a / 0.62); };
        c.fillStyle = 'rgba(100,255,218,0.30)';
        c.fillRect(gx, toY(MIN_ANGLE), 26, toY(MAX_ANGLE) - toY(MIN_ANGLE));

        // Numbered edges: the corridor stops being a mystery green smear.
        c.strokeStyle = 'rgba(100,255,218,0.75)';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(gx - 6, toY(MIN_ANGLE) + 0.5); c.lineTo(gx + 26, toY(MIN_ANGLE) + 0.5);
        c.moveTo(gx - 6, toY(MAX_ANGLE) - 0.5); c.lineTo(gx + 26, toY(MAX_ANGLE) - 0.5);
        c.stroke();
        c.font = '600 9px "Space Grotesk", Inter, sans-serif';
        c.fillStyle = 'rgba(180,235,222,0.95)';
        c.textAlign = 'right';
        c.fillText((MIN_ANGLE * 57.2958).toFixed(1) + '°', gx - 8, toY(MIN_ANGLE) + 3);
        c.fillText((MAX_ANGLE * 57.2958).toFixed(1) + '°', gx - 8, toY(MAX_ANGLE) + 3);

        c.fillStyle = s.angle < MIN_ANGLE || s.angle > MAX_ANGLE ? '#ff8b8b' : '#64ffda';
        c.fillRect(gx - 2, toY(s.angle) - 2.5, 30, 5);

        c.fillStyle = 'rgba(159,179,204,0.9)';
        c.font = '600 10px "Space Grotesk", Inter, sans-serif';
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

    /** The mouse control was invisible. Now it paints itself while you hold. */
    function drawPointerZones(g, c, s) {
        var px = g.pointer.x, py = g.pointer.y;
        var hint = g.running && g.t < 7 ? g.clamp((7 - g.t) / 2, 0, 1) * 0.45 : 0;

        if (hint > 0 && !g.pointer.down) {
            c.save();
            c.setLineDash([6, 10]);
            c.strokeStyle = 'rgba(255,255,255,' + (0.16 * hint).toFixed(3) + ')';
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(0, g.h * 0.45); c.lineTo(g.w, g.h * 0.45);
            c.moveTo(0, g.h * 0.55); c.lineTo(g.w, g.h * 0.55);
            c.stroke();
            c.setLineDash([]);
            c.font = '600 11px "Space Grotesk", Inter, sans-serif';
            c.fillStyle = 'rgba(255,255,255,' + (0.5 * hint).toFixed(3) + ')';
            c.textAlign = 'left';
            c.fillText('CLICK HERE — PITCH SHALLOWER', 26, g.h * 0.45 - 12);
            c.fillText('CLICK HERE — PITCH STEEPER', 26, g.h * 0.55 + 20);
            c.fillText('DRAG LEFT / RIGHT — BANK', 26, g.h * 0.5 + 4);
            c.restore();
        }

        if (!g.pointer.down) return;

        var top = py < g.h * 0.45, bottom = py > g.h * 0.55;
        if (top || bottom) {
            var y0 = top ? 0 : g.h * 0.55;
            var hgt = top ? g.h * 0.45 : g.h * 0.45;
            var wash = c.createLinearGradient(0, top ? 0 : g.h, 0, top ? hgt : g.h * 0.55);
            wash.addColorStop(0, 'rgba(255,139,90,0.12)');
            wash.addColorStop(1, 'rgba(255,139,90,0)');
            c.fillStyle = wash;
            c.fillRect(0, y0, g.w, hgt);
        }

        c.save();
        c.globalCompositeOperation = 'lighter';
        c.strokeStyle = 'rgba(255,190,150,0.75)';
        c.lineWidth = 1.6;
        c.beginPath(); c.arc(px, py, 17, 0, 6.2832); c.stroke();
        c.fillStyle = 'rgba(255,210,170,0.9)';
        if (top || bottom) {
            var d = top ? -1 : 1;
            c.beginPath();
            c.moveTo(px, py + d * 9);
            c.lineTo(px - 7, py - d * 3);
            c.lineTo(px + 7, py - d * 3);
            c.closePath(); c.fill();
        }
        var bx = (g.pointer.x - g.w / 2) / (g.w * 0.34);
        if (Math.abs(bx) > 0.12) {
            var sgn = bx > 0 ? 1 : -1;
            c.beginPath();
            c.moveTo(px + sgn * 30, py);
            c.lineTo(px + sgn * 20, py - 6);
            c.lineTo(px + sgn * 20, py + 6);
            c.closePath(); c.fill();
        }
        c.restore();
    }

    function draw(g, c) {
        var s = g.s;
        var horizon = g.h * HORIZON_F;
        var density = densityAt(s.alt);
        var cx = capX(g, s);

        // Sky goes from black to orange as the air thickens.
        var sky = c.createLinearGradient(0, 0, 0, g.h);
        sky.addColorStop(0, 'rgb(' + Math.round(3 + density * 40) + ',' + Math.round(6 + density * 12) + ',' + Math.round(15 + density * 20) + ')');
        sky.addColorStop(1, 'rgb(' + Math.round(10 + density * 190) + ',' + Math.round(14 + density * 90) + ',' + Math.round(30 + density * 30) + ')');
        c.fillStyle = sky;
        c.fillRect(0, 0, g.w, g.h);

        // Stars twinkle up where the air is thin, then density fades them out.
        var starA = Math.max(0, 1 - density);
        c.fillStyle = '#cfe0ff';
        for (var i = 0; i < s.stars.length; i++) {
            var sr = s.stars[i];
            c.globalAlpha = starA * (0.7 + 0.3 * Math.sin(g.t * sr.tw + sr.ph));
            c.fillRect(sr.x, sr.y, sr.r, sr.r);
        }
        c.globalAlpha = 1;

        drawEarth(g, c, s, density);
        drawStreaks(g, c, s, density, cx);

        // Touchdown pulse: one soft ring rolling out across the pad.
        if (s.ringT > 0) {
            var ra = g.t - s.ringT;
            if (ra < 1.6) {
                var rf = g.clamp(1 - ra / 1.6, 0, 1);
                c.save();
                c.globalCompositeOperation = 'lighter';
                c.strokeStyle = 'rgba(100,255,218,' + (0.45 * rf) + ')';
                c.lineWidth = 2.5 * rf + 0.5;
                c.beginPath();
                c.ellipse(g.w / 2, horizon, 18 + ra * 240, (18 + ra * 240) * 0.16, 0, 0, 6.2832);
                c.stroke();
                c.restore();
            }
        }

        drawDebris(g, c, s, density);
        drawCapsule(g, c, s, cx, s.landed ? limbTopY(g, s) - 15 : g.h * 0.42);
        drawPointerZones(g, c, s);
        drawTape(g, c, s);
        drawGauges(g, c, s);
    }

    Arcade.create({
        slug: 're-entry',
        title: 'RE-ENTRY',
        accent: '#ff8b5a',
        tagline: 'Mach 25 and falling. Hold the capsule inside the green corridor on the right — too steep and you burn up, too shallow and you skip back into space — while you bank across the wind onto the pad. Banking costs heat. Choose.',
        controls: [
            ['W / ↑', 'pitch shallower'],
            ['S / ↓', 'pitch steeper'],
            ['A / D', 'bank left / right toward the pad'],
            ['CLICK', 'top half pitches up, bottom pitches down, drag to bank']
        ],
        scoreLabel: 'SCORE',
        overTitle: 'LOST',
        winTitle: 'TOUCHDOWN',
        init: init,
        initMenu: init,
        idle: idle,
        update: update,
        draw: draw
    });
})();

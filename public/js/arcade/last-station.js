/**
 * Last Station — Missile Command in a gravity well.
 *
 * Rocks spiral in from every edge. Your laser is hitscan with heat, so the
 * decision is never "can I hit it" but "is this the rock worth the heat".
 * Big rocks split when shot, so panic-firing at the biggest thing on screen is
 * the classic way to lose.
 */
(function () {
    var STATION_R = 34;
    var SHIELD_MAX = 3;
    var HEAT_MAX = 100;
    var HEAT_PER_SHOT = 17;
    var COOL_RATE = 34;         // heat per second bled off
    var OVERHEAT_LOCK = 1.5;    // seconds locked out after redlining

    var TIERS = [
        { r: 9,  hp: 1, split: 0, score: 100, speed: 1.35, col: '#ff8ba7' },
        { r: 15, hp: 1, split: 2, score: 60,  speed: 1.0,  col: '#ffb46b' },
        { r: 23, hp: 2, split: 2, score: 40,  speed: 0.78, col: '#c9a0ff' }
    ];

    function spawnRock(g, tier, x, y, dir) {
        var s = g.s;
        var t = TIERS[tier];
        if (x == null) {
            // Just off the nearest screen edge, not off the corner. Spawning at
            // 0.62 * the long side puts rocks nearly a full screen away, so most
            // of a wave is spent watching an empty board.
            var a = Math.random() * 6.2832;
            var rad = Math.min(g.w, g.h) * 0.60;
            x = g.w / 2 + Math.cos(a) * rad;
            y = g.h / 2 + Math.sin(a) * rad;
            dir = g.angleTo(x, y, g.w / 2 + g.rand(-30, 30), g.h / 2 + g.rand(-30, 30));
        }
        var sp = (62 + s.wave * 7) * t.speed * g.rand(0.85, 1.15);
        s.rocks.push({
            x: x, y: y, tier: tier, r: t.r, hp: t.hp,
            vx: Math.cos(dir) * sp, vy: Math.sin(dir) * sp,
            spin: g.rand(-2, 2), rot: Math.random() * 6.28,
            // A slight tangential push makes them spiral rather than fall straight,
            // which is the difference between "aim once" and "track".
            curl: g.rand(-0.5, 0.5)
        });
    }

    function init(g) {
        g.s = {
            rocks: [], beams: [],
            shields: SHIELD_MAX,
            heat: 0, locked: 0,
            wave: 1, waveT: 0, spawnT: 0.6, toSpawn: 6,
            killed: 0, repeatT: 0,
            stars: Array.from({ length: 110 }, function () {
                return { x: g.rand(0, g.w), y: g.rand(0, g.h), r: g.rand(0.4, 1.6) };
            })
        };
    }

    function fire(g) {
        var s = g.s;
        s.repeatT = 0.11;
        if (s.locked > 0) { g.sfx('tick', 0.5); return; }
        var ax = g.pointer.x, ay = g.pointer.y;
        s.beams.push({ x: ax, y: ay, age: 0 });
        s.heat += HEAT_PER_SHOT;
        g.sfx('blip', 1.4);
        if (s.heat >= HEAT_MAX) {
            s.heat = HEAT_MAX;
            s.locked = OVERHEAT_LOCK;
            g.flash('OVERHEATED', '#ff8b8b', 700);
            g.sfx('lose', 1.6);
        }

        var hit = null;
        for (var i = 0; i < s.rocks.length; i++) {
            var r = s.rocks[i];
            if (g.dist(ax, ay, r.x, r.y) < r.r + 10) { hit = i; break; }
        }
        if (hit == null) {
            g.burst(ax, ay, { n: 5, colour: '#7aa2ff', speed: 90, life: 0.25 });
            return;
        }

        var rock = s.rocks[hit];
        rock.hp--;
        g.burst(rock.x, rock.y, { n: 8, colour: TIERS[rock.tier].col, speed: 140, life: 0.35 });
        if (rock.hp > 0) { g.sfx('tick'); return; }

        var t = TIERS[rock.tier];
        g.addScore(t.score);
        s.killed++;
        g.shake(4 + rock.tier * 2);
        g.sfx('hit');
        g.burst(rock.x, rock.y, { n: 18, colour: t.col, speed: 230, life: 0.6 });
        s.rocks.splice(hit, 1);

        // Splitting is the trap: shooting the big scary one puts two more on
        // the board, so the correct move is often to leave it and clear space.
        for (var k = 0; k < t.split; k++) {
            var a = g.angleTo(g.w / 2, g.h / 2, rock.x, rock.y) + Math.PI + g.rand(-0.9, 0.9);
            spawnRock(g, rock.tier - 1, rock.x, rock.y, a);
        }
    }

    function update(g, dt) {
        var s = g.s;
        var cx = g.w / 2, cy = g.h / 2;

        s.heat = Math.max(0, s.heat - COOL_RATE * dt);
        if (s.locked > 0) s.locked -= dt;

        // Holding the button keeps firing. Heat, not a fire-rate timer, is what
        // stops you — so the limit the player feels is the one drawn on screen.
        s.repeatT -= dt;
        if (g.pointer.down && s.repeatT <= 0) {
            fire(g);
            s.repeatT = 0.11;
        }

        // Wave pacing: spawn a budget of rocks, then a short breather.
        s.waveT += dt;
        if (s.toSpawn > 0) {
            s.spawnT -= dt;
            if (s.spawnT <= 0) {
                var tier = Math.random() < Math.min(0.55, 0.15 + s.wave * 0.05) ? 2 : (Math.random() < 0.5 ? 1 : 0);
                spawnRock(g, tier);
                s.toSpawn--;
                s.spawnT = Math.max(0.35, 1.5 - s.wave * 0.07);
            }
        } else if (s.rocks.length === 0) {
            s.wave++;
            s.toSpawn = 5 + s.wave * 2;
            s.spawnT = 1.0;
            g.addScore(250 * s.wave);
            g.flash('WAVE ' + s.wave, g.accent, 900);
            g.sfx('win');
            s.shields = Math.min(SHIELD_MAX, s.shields + (s.wave % 3 === 0 ? 1 : 0));
        }

        for (var i = s.rocks.length - 1; i >= 0; i--) {
            var r = s.rocks[i];
            var a = g.angleTo(r.x, r.y, cx, cy);
            var d = g.dist(r.x, r.y, cx, cy);
            var pull = 30 + s.wave * 3;
            r.vx += Math.cos(a) * pull * dt + Math.cos(a + 1.57) * r.curl * pull * dt;
            r.vy += Math.sin(a) * pull * dt + Math.sin(a + 1.57) * r.curl * pull * dt;
            var sp = Math.hypot(r.vx, r.vy);
            var cap = 95 + s.wave * 10;
            if (sp > cap) { r.vx = r.vx / sp * cap; r.vy = r.vy / sp * cap; }
            r.x += r.vx * dt; r.y += r.vy * dt;
            r.rot += r.spin * dt;

            if (d < STATION_R + r.r) {
                s.rocks.splice(i, 1);
                s.shields--;
                g.shake(22);
                g.sfx('boom');
                g.burst(r.x, r.y, { n: 26, colour: '#ff8b8b', speed: 300, life: 0.8 });
                if (s.shields <= 0) {
                    g.burst(cx, cy, { n: 70, colour: '#ffd35a', speed: 460, life: 1.2 });
                    g.shake(40);
                    g.over('The station broke up on wave ' + s.wave + ' after ' + s.killed + ' kills.');
                    return;
                }
                g.flash('SHIELD DOWN — ' + s.shields + ' LEFT', '#ff8b8b', 800);
            }
        }

        for (var b = s.beams.length - 1; b >= 0; b--) {
            s.beams[b].age += dt;
            if (s.beams[b].age > 0.12) s.beams.splice(b, 1);
        }

        g.addScore(dt * 6);
        g.hud('WAVE <b>' + s.wave + '</b> · SHIELDS <b>' + s.shields + '</b><br>' +
              'ROCKS <b>' + s.rocks.length + '</b>' + (s.locked > 0 ? ' · <b style="color:#ff8b8b">LOCKED</b>' : ''));
    }

    function draw(g, c) {
        var s = g.s;
        var cx = g.w / 2, cy = g.h / 2;
        c.fillStyle = '#03060f';
        c.fillRect(0, 0, g.w, g.h);

        c.fillStyle = 'rgba(207,224,255,0.5)';
        for (var i = 0; i < s.stars.length; i++) {
            c.fillRect(s.stars[i].x, s.stars[i].y, s.stars[i].r, s.stars[i].r);
        }

        c.strokeStyle = 'rgba(255,139,167,0.10)';
        c.lineWidth = 1;
        for (var ring = 1; ring <= 4; ring++) {
            c.beginPath(); c.arc(cx, cy, ring * Math.min(g.w, g.h) * 0.11, 0, 6.2832); c.stroke();
        }

        // Station and its shields.
        g.glow(c, cx, cy, 90, 'rgba(100,255,218,0.16)');
        for (var sh = 0; sh < s.shields; sh++) {
            c.strokeStyle = 'rgba(100,255,218,' + (0.5 - sh * 0.1) + ')';
            c.lineWidth = 2.4;
            c.beginPath(); c.arc(cx, cy, STATION_R + 9 + sh * 8, 0, 6.2832); c.stroke();
        }
        c.fillStyle = '#e8eefc';
        c.beginPath(); c.arc(cx, cy, STATION_R * 0.5, 0, 6.2832); c.fill();
        c.strokeStyle = g.accent; c.lineWidth = 3;
        c.beginPath(); c.arc(cx, cy, STATION_R, 0, 6.2832); c.stroke();
        c.save(); c.translate(cx, cy); c.rotate(g.t * 0.6);
        c.strokeStyle = 'rgba(232,238,252,0.75)'; c.lineWidth = 4;
        c.beginPath(); c.moveTo(-STATION_R - 8, 0); c.lineTo(STATION_R + 8, 0); c.stroke();
        c.restore();

        for (var k = 0; k < s.rocks.length; k++) {
            var r = s.rocks[k];
            var t = TIERS[r.tier];
            c.save(); c.translate(r.x, r.y); c.rotate(r.rot);
            c.fillStyle = t.col;
            c.beginPath();
            for (var v = 0; v < 7; v++) {
                var ang = (v / 7) * 6.2832;
                var rr = r.r * (0.78 + ((v * 37) % 10) / 28);
                c.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
            }
            c.closePath(); c.fill();
            if (r.hp > 1) {
                c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 2;
                c.stroke();
            }
            c.restore();
        }

        // Laser beams from the station to where you clicked.
        for (var b = 0; b < s.beams.length; b++) {
            var bm = s.beams[b];
            c.globalAlpha = 1 - bm.age / 0.12;
            c.strokeStyle = '#ff8ba7'; c.lineWidth = 3;
            c.beginPath(); c.moveTo(cx, cy); c.lineTo(bm.x, bm.y); c.stroke();
            c.globalAlpha = 1;
            g.glow(c, bm.x, bm.y, 26, 'rgba(255,139,167,0.55)');
        }

        // Crosshair.
        var px = g.pointer.x, py = g.pointer.y;
        c.strokeStyle = s.locked > 0 ? '#ff8b8b' : 'rgba(255,255,255,0.8)';
        c.lineWidth = 1.6;
        c.beginPath(); c.arc(px, py, 13, 0, 6.2832); c.stroke();
        c.beginPath();
        c.moveTo(px - 20, py); c.lineTo(px - 6, py);
        c.moveTo(px + 6, py); c.lineTo(px + 20, py);
        c.moveTo(px, py - 20); c.lineTo(px, py - 6);
        c.moveTo(px, py + 6); c.lineTo(px, py + 20);
        c.stroke();

        // Heat bar, bottom centre where the eye is already looking.
        var bw = Math.min(340, g.w - 60);
        var bx = (g.w - bw) / 2, by = g.h - 34;
        c.fillStyle = 'rgba(255,255,255,0.10)';
        c.fillRect(bx, by, bw, 9);
        c.fillStyle = s.locked > 0 ? '#ff8b8b' : (s.heat > 70 ? '#ffb46b' : g.accent);
        c.fillRect(bx, by, bw * (s.heat / HEAT_MAX), 9);
        c.fillStyle = 'rgba(159,179,204,0.9)';
        c.font = '600 11px Inter, sans-serif';
        c.textAlign = 'center';
        c.fillText(s.locked > 0 ? 'LASER LOCKED OUT' : 'LASER HEAT', g.w / 2, by - 7);
        c.textAlign = 'left';
    }

    Arcade.create({
        slug: 'last-station',
        title: 'LAST STATION',
        accent: '#ff8ba7',
        tagline: 'Everything falls toward you. Click a rock to vaporize it — but the big ones split into two when they break, and your laser overheats. Three shields, endless waves.',
        controls: [['CLICK', 'fire laser'], ['HOLD', 'rapid fire'], ['ESC', 'back to arcade']],
        scoreLabel: 'SCORE',
        overTitle: 'STATION LOST',
        init: init,
        initMenu: init,
        update: update,
        draw: draw,
        pointerDown: fire
    });
})();

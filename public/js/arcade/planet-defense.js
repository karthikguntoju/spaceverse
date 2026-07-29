/**
 * Planet Defense — tower defense where the lanes are orbits.
 *
 * Asteroids fall inward along a ring; you buy turrets and gravity wells and drop
 * them onto the rings. Wells do no damage at all, which is the point: slowing a
 * lane so the lasers get more shots is usually worth more than more lasers.
 */
(function () {
    var EARTH_R = 40;
    var RINGS = 3;
    var HP_MAX = 12;

    var TOWERS = {
        laser: { cost: 60,  colour: '#5ad7ff', range: 130, dps: 34, name: 'LASER' },
        well:  { cost: 45,  colour: '#b48bff', range: 105, slow: 0.45, name: 'GRAVITY WELL' },
        flak:  { cost: 110, colour: '#ffb46b', range: 92,  dps: 62, splash: 46, name: 'FLAK' }
    };

    function ringR(g, i) {
        return Math.min(g.w, g.h) * (0.19 + i * 0.11);
    }

    function init(g) {
        g.s = {
            towers: [],
            rocks: [],
            hp: HP_MAX,
            salvage: 190,       // enough for three towers before the first wave lands
            wave: 0,
            spawnLeft: 0,
            spawnT: 0,
            between: 4,
            picked: 'laser',
            killed: 0,
            hover: null
        };
    }

    function startWave(g) {
        var s = g.s;
        s.wave++;
        s.spawnLeft = 4 + s.wave * 2;
        s.spawnT = 0;
        g.flash('WAVE ' + s.wave, '#5ad7ff', 1000);
        g.sfx('win');
    }

    function spawnRock(g) {
        var s = g.s;
        var a = Math.random() * 6.2832;
        // Spawn just outside the outermost ring rather than off in the corners:
        // a long dead approach makes every wave start with ten seconds of
        // watching nothing happen.
        var startR = Math.min(g.w, g.h) * 0.50;
        var hp = 22 + s.wave * 13;
        var big = Math.random() < Math.min(0.4, 0.08 + s.wave * 0.035);
        s.rocks.push({
            a: a, r: startR,
            hp: big ? hp * 2.6 : hp, max: big ? hp * 2.6 : hp,
            speed: (34 + s.wave * 2.8) * (big ? 0.72 : 1) * g.rand(0.9, 1.1),
            slow: 0, size: big ? 20 : 12, spin: g.rand(-2, 2), rot: 0,
            worth: big ? 45 : 20
        });
    }

    function update(g, dt) {
        var s = g.s;
        var cx = g.w / 2, cy = g.h / 2;

        if (s.spawnLeft <= 0 && s.rocks.length === 0) {
            s.between -= dt;
            if (s.between <= 0) {
                if (s.wave > 0) {
                    s.salvage += 40 + s.wave * 12;
                    g.addScore(300 * s.wave);
                }
                s.between = 6;
                startWave(g);
            }
        } else if (s.spawnLeft > 0) {
            s.spawnT -= dt;
            if (s.spawnT <= 0) {
                spawnRock(g);
                s.spawnLeft--;
                s.spawnT = Math.max(0.35, 1.5 - s.wave * 0.06);
            }
        }

        for (var i = s.rocks.length - 1; i >= 0; i--) {
            var r = s.rocks[i];
            r.slow = 0;
            r.rot += r.spin * dt;
        }

        // Towers fire. Targeting is "closest to Earth in range", which is the
        // only rule that never loses a rock it could have killed.
        for (var t = 0; t < s.towers.length; t++) {
            var tw = s.towers[t];
            var def = TOWERS[tw.kind];
            tw.x = cx + Math.cos(tw.a) * ringR(g, tw.ring);
            tw.y = cy + Math.sin(tw.a) * ringR(g, tw.ring);
            tw.cool -= dt;

            var target = null, bestR = Infinity;
            for (var k = 0; k < s.rocks.length; k++) {
                var rk = s.rocks[k];
                var rx = cx + Math.cos(rk.a) * rk.r, ry = cy + Math.sin(rk.a) * rk.r;
                if (g.dist(tw.x, tw.y, rx, ry) > def.range) continue;
                if (tw.kind === 'well') { rk.slow = Math.max(rk.slow, def.slow); continue; }
                if (rk.r < bestR) { bestR = rk.r; target = rk; }
            }
            tw.target = target;
            if (!target || tw.kind === 'well' || tw.cool > 0) continue;

            tw.cool = 0.35;
            var tx = cx + Math.cos(target.a) * target.r;
            var ty = cy + Math.sin(target.a) * target.r;
            target.hp -= def.dps * 0.35;
            g.sfx('blip', 1.7);
            g.burst(tx, ty, { n: 4, colour: def.colour, speed: 90, life: 0.25, size: 2 });

            if (def.splash) {
                for (var m = 0; m < s.rocks.length; m++) {
                    var o = s.rocks[m];
                    if (o === target) continue;
                    var ox = cx + Math.cos(o.a) * o.r, oy = cy + Math.sin(o.a) * o.r;
                    if (g.dist(tx, ty, ox, oy) < def.splash) o.hp -= def.dps * 0.18;
                }
                g.burst(tx, ty, { n: 8, colour: def.colour, speed: 150, life: 0.35 });
            }
        }

        for (var j = s.rocks.length - 1; j >= 0; j--) {
            var rock = s.rocks[j];
            rock.r -= rock.speed * (1 - rock.slow) * dt;

            if (rock.hp <= 0) {
                var dx = cx + Math.cos(rock.a) * rock.r, dy = cy + Math.sin(rock.a) * rock.r;
                g.burst(dx, dy, { n: 16, colour: '#ffb46b', speed: 220, life: 0.6 });
                s.salvage += rock.worth;
                s.killed++;
                g.addScore(rock.worth * 4);
                g.sfx('hit');
                s.rocks.splice(j, 1);
                continue;
            }

            if (rock.r <= EARTH_R) {
                s.rocks.splice(j, 1);
                s.hp -= rock.size > 16 ? 3 : 1;
                g.shake(20); g.sfx('boom');
                g.burst(cx + Math.cos(rock.a) * EARTH_R, cy + Math.sin(rock.a) * EARTH_R,
                    { n: 26, colour: '#ff8b8b', speed: 260, life: 0.8 });
                g.flash('IMPACT', '#ff8b8b', 600);
                if (s.hp <= 0) {
                    g.burst(cx, cy, { n: 80, colour: '#ffd35a', speed: 480, life: 1.3 });
                    g.shake(40);
                    g.over('Earth fell on wave ' + s.wave + '. ' + s.killed + ' asteroids destroyed.');
                    return;
                }
            }
        }

        var d = TOWERS[s.picked];
        g.hud('WAVE <b>' + Math.max(1, s.wave) + '</b> · EARTH <b style="color:' + (s.hp < 5 ? '#ff8b8b' : '#e8eefc') + '">' + s.hp + '/' + HP_MAX + '</b><br>' +
              'SALVAGE <b>' + s.salvage + '</b><br>' +
              'BUILDING <b style="color:' + d.colour + '">' + d.name + ' (' + d.cost + ')</b> — press 1/2/3');
    }

    function placeAt(g, px, py) {
        var s = g.s;
        var cx = g.w / 2, cy = g.h / 2;
        var def = TOWERS[s.picked];
        if (s.salvage < def.cost) { g.flash('NOT ENOUGH SALVAGE', '#ff8b8b', 600); g.sfx('lose', 1.6); return; }

        // Snap onto the nearest ring — towers live on orbits, same as the rocks.
        var d = g.dist(px, py, cx, cy);
        var ring = 0, bestGap = Infinity;
        for (var i = 0; i < RINGS; i++) {
            var gap = Math.abs(d - ringR(g, i));
            if (gap < bestGap) { bestGap = gap; ring = i; }
        }
        if (bestGap > 60) { g.flash('PLACE ON AN ORBIT RING', '#ffb46b', 700); return; }

        var a = g.angleTo(cx, cy, px, py);
        for (var t = 0; t < s.towers.length; t++) {
            var tw = s.towers[t];
            if (tw.ring === ring && Math.abs(g.wrapAngle(tw.a - a)) < 0.22) {
                g.flash('TOO CLOSE TO ANOTHER TOWER', '#ffb46b', 700);
                return;
            }
        }

        s.salvage -= def.cost;
        s.towers.push({ kind: s.picked, ring: ring, a: a, cool: 0, x: 0, y: 0 });
        g.sfx('pick');
        g.burst(cx + Math.cos(a) * ringR(g, ring), cy + Math.sin(a) * ringR(g, ring),
            { n: 12, colour: def.colour, speed: 130 });
    }

    function draw(g, c) {
        var s = g.s;
        var cx = g.w / 2, cy = g.h / 2;
        c.fillStyle = '#03060f';
        c.fillRect(0, 0, g.w, g.h);

        for (var i = 0; i < RINGS; i++) {
            c.strokeStyle = 'rgba(90,215,255,0.14)';
            c.lineWidth = 22;
            c.beginPath(); c.arc(cx, cy, ringR(g, i), 0, 6.2832); c.stroke();
            c.strokeStyle = 'rgba(90,215,255,0.35)';
            c.lineWidth = 1;
            c.beginPath(); c.arc(cx, cy, ringR(g, i), 0, 6.2832); c.stroke();
        }

        g.glow(c, cx, cy, EARTH_R * 3, 'rgba(60,130,220,0.22)');
        var grd = c.createRadialGradient(cx - 14, cy - 16, 5, cx, cy, EARTH_R);
        grd.addColorStop(0, '#4f9de8'); grd.addColorStop(1, '#12406e');
        c.fillStyle = grd;
        c.beginPath(); c.arc(cx, cy, EARTH_R, 0, 6.2832); c.fill();

        // Health arc around Earth.
        c.strokeStyle = s.hp < 5 ? '#ff8b8b' : '#64ffda';
        c.lineWidth = 4;
        c.beginPath();
        c.arc(cx, cy, EARTH_R + 8, -1.57, -1.57 + 6.2832 * (s.hp / HP_MAX));
        c.stroke();

        for (var t = 0; t < s.towers.length; t++) {
            var tw = s.towers[t];
            var def = TOWERS[tw.kind];
            c.strokeStyle = def.colour + '33';
            c.lineWidth = 1;
            c.beginPath(); c.arc(tw.x, tw.y, def.range, 0, 6.2832); c.stroke();
            if (tw.kind === 'well') {
                g.glow(c, tw.x, tw.y, def.range * 0.8, 'rgba(180,139,255,0.10)');
                c.strokeStyle = def.colour; c.lineWidth = 2;
                c.beginPath(); c.arc(tw.x, tw.y, 9 + Math.sin(g.t * 3) * 2, 0, 6.2832); c.stroke();
            } else {
                c.fillStyle = def.colour;
                c.beginPath(); c.arc(tw.x, tw.y, 8, 0, 6.2832); c.fill();
            }
            if (tw.target) {
                var rx = cx + Math.cos(tw.target.a) * tw.target.r;
                var ry = cy + Math.sin(tw.target.a) * tw.target.r;
                c.globalAlpha = Math.max(0, 1 - (0.35 - tw.cool) / 0.12);
                c.strokeStyle = def.colour; c.lineWidth = 2;
                c.beginPath(); c.moveTo(tw.x, tw.y); c.lineTo(rx, ry); c.stroke();
                c.globalAlpha = 1;
            }
        }

        for (var k = 0; k < s.rocks.length; k++) {
            var r = s.rocks[k];
            var x = cx + Math.cos(r.a) * r.r, y = cy + Math.sin(r.a) * r.r;
            c.save(); c.translate(x, y); c.rotate(r.rot);
            c.fillStyle = r.slow > 0 ? '#9a8ec2' : '#8a8474';
            c.beginPath();
            for (var v = 0; v < 7; v++) {
                var ang = (v / 7) * 6.2832;
                c.lineTo(Math.cos(ang) * r.size * (0.8 + ((v * 41) % 9) / 26), Math.sin(ang) * r.size * (0.8 + ((v * 29) % 9) / 26));
            }
            c.closePath(); c.fill();
            c.restore();
            // HP pip.
            c.fillStyle = 'rgba(0,0,0,0.5)';
            c.fillRect(x - r.size, y - r.size - 8, r.size * 2, 3);
            c.fillStyle = '#8dffa0';
            c.fillRect(x - r.size, y - r.size - 8, r.size * 2 * Math.max(0, r.hp / r.max), 3);
        }

        // Ghost of the tower you are about to place.
        var def2 = TOWERS[s.picked];
        var px = g.pointer.x, py = g.pointer.y;
        var pd = g.dist(px, py, cx, cy);
        var ring = 0, bestGap = Infinity;
        for (var q = 0; q < RINGS; q++) {
            var gap = Math.abs(pd - ringR(g, q));
            if (gap < bestGap) { bestGap = gap; ring = q; }
        }
        if (bestGap < 60) {
            var a = g.angleTo(cx, cy, px, py);
            var gx = cx + Math.cos(a) * ringR(g, ring), gy = cy + Math.sin(a) * ringR(g, ring);
            c.globalAlpha = s.salvage >= def2.cost ? 0.55 : 0.2;
            c.strokeStyle = def2.colour; c.lineWidth = 1.5;
            c.beginPath(); c.arc(gx, gy, def2.range, 0, 6.2832); c.stroke();
            c.fillStyle = def2.colour;
            c.beginPath(); c.arc(gx, gy, 8, 0, 6.2832); c.fill();
            c.globalAlpha = 1;
        }

        // Build palette.
        var kinds = ['laser', 'well', 'flak'];
        var bw = 132, total = kinds.length * (bw + 8) - 8;
        var bx0 = (g.w - total) / 2, by = g.h - 52;
        for (var b = 0; b < kinds.length; b++) {
            var kd = TOWERS[kinds[b]];
            var bx = bx0 + b * (bw + 8);
            var on = s.picked === kinds[b];
            c.fillStyle = on ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
            c.strokeStyle = s.salvage >= kd.cost ? kd.colour : 'rgba(255,255,255,0.15)';
            c.lineWidth = on ? 2.4 : 1;
            c.beginPath();
            if (c.roundRect) c.roundRect(bx, by, bw, 40, 10); else c.rect(bx, by, bw, 40);
            c.fill(); c.stroke();
            c.fillStyle = s.salvage >= kd.cost ? '#e8eefc' : 'rgba(232,238,252,0.4)';
            c.font = '700 11px Orbitron, sans-serif'; c.textAlign = 'center';
            c.fillText(kd.name, bx + bw / 2, by + 17);
            c.font = '600 11px Inter, sans-serif';
            c.fillStyle = kd.colour;
            c.fillText((b + 1) + ' · ' + kd.cost + ' salvage', bx + bw / 2, by + 32);
            c.textAlign = 'left';
        }
    }

    function keyDown(g, code) {
        if (code === 'Digit1') g.s.picked = 'laser';
        if (code === 'Digit2') g.s.picked = 'well';
        if (code === 'Digit3') g.s.picked = 'flak';
    }

    function pointerDown(g) {
        var s = g.s;
        // Clicking the palette selects; clicking the field places.
        var kinds = ['laser', 'well', 'flak'];
        var bw = 132, total = kinds.length * (bw + 8) - 8;
        var bx0 = (g.w - total) / 2, by = g.h - 52;
        if (g.pointer.y >= by && g.pointer.y <= by + 40) {
            for (var b = 0; b < kinds.length; b++) {
                var bx = bx0 + b * (bw + 8);
                if (g.pointer.x >= bx && g.pointer.x <= bx + bw) { s.picked = kinds[b]; g.sfx('tick'); return; }
            }
        }
        placeAt(g, g.pointer.x, g.pointer.y);
    }

    Arcade.create({
        slug: 'planet-defense',
        title: 'PLANET DEFENSE',
        accent: '#5ad7ff',
        tagline: 'Asteroids fall inward down the orbit rings. Drop lasers, flak and gravity wells onto the rings to stop them. Wells do no damage — they buy your lasers more time, which is usually worth more.',
        controls: [['CLICK RING', 'place the selected tower'], ['1 / 2 / 3', 'laser · gravity well · flak'], ['ESC', 'back to arcade']],
        scoreLabel: 'SCORE',
        overTitle: 'EARTH LOST',
        init: init,
        initMenu: init,
        update: update,
        draw: draw,
        pointerDown: pointerDown,
        keyDown: keyDown
    });
})();

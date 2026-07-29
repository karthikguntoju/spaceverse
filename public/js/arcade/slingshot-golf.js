/**
 * Slingshot Golf — nine holes, gravity does the putting.
 *
 * Drag back from the ball, release, and the shot is over: everything after the
 * release is physics. Holes are laid out from a fixed seed so every player gets
 * the same nine and scores are comparable.
 */
(function () {
    var HOLES = 9;
    var G = 5200;
    var MAX_POWER = 620;
    var STEP = 1 / 120;         // fixed physics step, so a slow frame cannot change a shot

    // Small deterministic generator: same course for everyone, every time.
    function seeded(seed) {
        var s = seed >>> 0;
        return function () {
            s = (s * 1664525 + 1013904223) >>> 0;
            return s / 4294967296;
        };
    }

    function buildHole(g, n) {
        var rnd = seeded(0xC0FFEE + n * 7919);
        var W = g.w, H = g.h;
        var hole = {
            ball: { x: W * 0.13, y: H * (0.3 + rnd() * 0.4) },
            cup: { x: W * (0.76 + rnd() * 0.14), y: H * (0.22 + rnd() * 0.56), r: 22 },
            planets: [],
            par: 2 + Math.floor(n / 3)
        };
        var count = 1 + Math.floor(n / 2);
        for (var i = 0; i < count; i++) {
            var r = 26 + rnd() * (34 + n * 3);
            var px = W * (0.30 + rnd() * 0.40);
            var py = H * (0.15 + rnd() * 0.70);
            // Keep planets clear of the tee and the cup, or a hole can be impossible.
            if (g.dist(px, py, hole.ball.x, hole.ball.y) < r + 120) px += 160;
            if (g.dist(px, py, hole.cup.x, hole.cup.y) < r + 90) px -= 130;
            hole.planets.push({
                x: px, y: py, r: r,
                mass: r * (n >= 5 && rnd() < 0.3 ? -1.1 : 1),   // late holes get repulsors
                hue: 200 + Math.floor(rnd() * 120)
            });
        }
        return hole;
    }

    function init(g) {
        g.s = {
            hole: 0,
            strokes: 0,
            total: 0,
            par: 0,
            data: buildHole(g, 0),
            ball: null,
            flying: false,
            trail: [],
            ghost: [],
            aiming: false,
            settle: 0,
            done: false
        };
        g.s.ball = { x: g.s.data.ball.x, y: g.s.data.ball.y, vx: 0, vy: 0 };
        g.setScore(0);
    }

    function aimVector(g) {
        var s = g.s;
        var dx = s.ball.x - g.pointer.x;
        var dy = s.ball.y - g.pointer.y;
        var len = Math.hypot(dx, dy);
        var power = Math.min(len, 190) / 190;
        if (len < 1) return { vx: 0, vy: 0, power: 0 };
        return { vx: (dx / len) * power * MAX_POWER, vy: (dy / len) * power * MAX_POWER, power: power };
    }

    /** One physics step, shared by the live ball and the dotted preview. */
    function step(g, p, dt) {
        var s = g.s;
        for (var i = 0; i < s.data.planets.length; i++) {
            var pl = s.data.planets[i];
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
        s.data = buildHole(g, s.hole);
        s.ball = { x: s.data.ball.x, y: s.data.ball.y, vx: 0, vy: 0 };
        s.strokes = 0;
        s.trail.length = 0;
        s.flying = false;
        g.flash('HOLE ' + (s.hole + 1) + ' · PAR ' + s.data.par, g.accent, 1100);
    }

    function update(g, dt) {
        var s = g.s;
        if (s.done) return;

        if (!s.flying) {
            // Preview the shot while dragging: this is a puzzle, not a dexterity test.
            if (g.pointer.down) {
                var aim = aimVector(g);
                var probe = { x: s.ball.x, y: s.ball.y, vx: aim.vx, vy: aim.vy };
                s.ghost.length = 0;
                for (var i = 0; i < 150; i++) {
                    step(g, probe, STEP * 2.2);
                    if (i % 4 === 0) s.ghost.push({ x: probe.x, y: probe.y });
                    var stop = false;
                    for (var k = 0; k < s.data.planets.length; k++) {
                        var pl = s.data.planets[k];
                        if (pl.mass > 0 && g.dist(probe.x, probe.y, pl.x, pl.y) < pl.r + 4) stop = true;
                    }
                    if (stop || probe.x < -60 || probe.x > g.w + 60 || probe.y < -60 || probe.y > g.h + 60) break;
                }
            } else s.ghost.length = 0;
            g.hud('HOLE <b>' + (s.hole + 1) + '/' + HOLES + '</b> · PAR <b>' + s.data.par + '</b><br>' +
                  'STROKES THIS HOLE <b>' + s.strokes + '</b><br>TOTAL <b>' + (s.total + s.strokes) + '</b>');
            return;
        }

        // Fixed-step integration with the leftover carried between frames.
        s.settle += dt;
        var acc = dt;
        while (acc > 0) {
            var h = Math.min(STEP, acc);
            acc -= h;
            step(g, s.ball, h);

            for (var j = 0; j < s.data.planets.length; j++) {
                var p = s.data.planets[j];
                if (p.mass <= 0) continue;
                if (g.dist(s.ball.x, s.ball.y, p.x, p.y) < p.r + 5) {
                    s.flying = false;
                    g.sfx('hit'); g.shake(8);
                    g.burst(s.ball.x, s.ball.y, { n: 14, colour: '#ff8b8b', speed: 180 });
                    g.flash('CRASHED — +1 STROKE', '#ff8b8b', 800);
                    s.strokes++;
                    s.ball = { x: s.data.ball.x, y: s.data.ball.y, vx: 0, vy: 0 };
                    s.trail.length = 0;
                    return;
                }
            }

            if (g.dist(s.ball.x, s.ball.y, s.data.cup.x, s.data.cup.y) < s.data.cup.r &&
                Math.hypot(s.ball.vx, s.ball.vy) < 700) {
                s.flying = false;
                g.sfx('win');
                g.burst(s.data.cup.x, s.data.cup.y, { n: 34, colour: g.accent, speed: 260, life: 0.9 });
                var d = s.strokes - s.data.par;
                g.flash(d <= -2 ? 'EAGLE' : d === -1 ? 'BIRDIE' : d === 0 ? 'PAR' : 'BOGEY +' + d, g.accent, 1100);
                nextHole(g);
                return;
            }
        }

        s.trail.push({ x: s.ball.x, y: s.ball.y });
        if (s.trail.length > 220) s.trail.shift();

        var out = s.ball.x < -80 || s.ball.x > g.w + 80 || s.ball.y < -80 || s.ball.y > g.h + 80;
        if (out || s.settle > 12) {
            s.flying = false;
            g.flash(out ? 'LOST IN SPACE — +1 STROKE' : 'OUT OF TIME — +1 STROKE', '#ff8b8b', 900);
            g.sfx('lose');
            s.strokes++;
            s.ball = { x: s.data.ball.x, y: s.data.ball.y, vx: 0, vy: 0 };
            s.trail.length = 0;
        }

        g.hud('HOLE <b>' + (s.hole + 1) + '/' + HOLES + '</b> · PAR <b>' + s.data.par + '</b><br>' +
              'STROKES THIS HOLE <b>' + s.strokes + '</b><br>TOTAL <b>' + (s.total + s.strokes) + '</b>');
    }

    function pointerUp(g) {
        var s = g.s;
        if (s.flying || s.done) return;
        var aim = aimVector(g);
        if (aim.power < 0.06) return;
        s.ball.vx = aim.vx; s.ball.vy = aim.vy;
        s.flying = true;
        s.strokes++;
        s.settle = 0;
        s.ghost.length = 0;
        g.sfx('thrust', 1 + aim.power);
    }

    function draw(g, c) {
        var s = g.s;
        c.fillStyle = '#04070f';
        c.fillRect(0, 0, g.w, g.h);

        for (var i = 0; i < s.data.planets.length; i++) {
            var p = s.data.planets[i];
            var repel = p.mass < 0;
            g.glow(c, p.x, p.y, p.r * 3.2, repel ? 'rgba(255,139,167,0.16)' : 'hsla(' + p.hue + ',80%,60%,0.16)');
            var grd = c.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.35, p.r * 0.1, p.x, p.y, p.r);
            if (repel) { grd.addColorStop(0, '#ffb0c4'); grd.addColorStop(1, '#7a2942'); }
            else { grd.addColorStop(0, 'hsl(' + p.hue + ',70%,66%)'); grd.addColorStop(1, 'hsl(' + p.hue + ',65%,25%)'); }
            c.fillStyle = grd;
            c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.2832); c.fill();
            if (repel) {
                c.strokeStyle = 'rgba(255,139,167,0.5)';
                c.setLineDash([5, 6]); c.lineWidth = 1.5;
                c.beginPath(); c.arc(p.x, p.y, p.r + 14, 0, 6.2832); c.stroke();
                c.setLineDash([]);
            }
        }

        // Cup.
        var cup = s.data.cup;
        g.glow(c, cup.x, cup.y, cup.r * 3, 'rgba(141,255,160,0.22)');
        c.strokeStyle = '#8dffa0'; c.lineWidth = 3;
        c.beginPath(); c.arc(cup.x, cup.y, cup.r, 0, 6.2832); c.stroke();
        c.strokeStyle = 'rgba(141,255,160,0.45)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(cup.x, cup.y - cup.r); c.lineTo(cup.x, cup.y - cup.r - 26); c.stroke();
        c.fillStyle = '#8dffa0';
        c.beginPath();
        c.moveTo(cup.x, cup.y - cup.r - 26); c.lineTo(cup.x + 20, cup.y - cup.r - 20); c.lineTo(cup.x, cup.y - cup.r - 14);
        c.closePath(); c.fill();

        c.strokeStyle = 'rgba(141,255,160,0.35)'; c.lineWidth = 2;
        c.beginPath();
        for (var t = 0; t < s.trail.length; t++) c.lineTo(s.trail[t].x, s.trail[t].y);
        c.stroke();

        if (s.ghost.length) {
            c.fillStyle = 'rgba(232,238,252,0.45)';
            for (var q = 0; q < s.ghost.length; q++) {
                c.beginPath(); c.arc(s.ghost[q].x, s.ghost[q].y, 2.1, 0, 6.2832); c.fill();
            }
        }

        if (!s.flying && g.pointer.down) {
            c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 2;
            c.beginPath(); c.moveTo(s.ball.x, s.ball.y); c.lineTo(g.pointer.x, g.pointer.y); c.stroke();
        }

        g.glow(c, s.ball.x, s.ball.y, 22, 'rgba(255,255,255,0.35)');
        c.fillStyle = '#fff';
        c.beginPath(); c.arc(s.ball.x, s.ball.y, 6.5, 0, 6.2832); c.fill();

        if (!s.flying) {
            c.fillStyle = 'rgba(232,238,252,0.6)';
            c.font = '600 13px Inter, sans-serif'; c.textAlign = 'center';
            c.fillText('Drag back from the ball and release', g.w / 2, g.h - 26);
            c.textAlign = 'left';
        }
    }

    Arcade.create({
        slug: 'slingshot-golf',
        title: 'SLINGSHOT GOLF',
        accent: '#8dffa0',
        tagline: 'Nine holes across a solar system. Drag back from the ball to aim, release, and let gravity curve the shot into the cup. Pink planets push instead of pull. Fewest strokes wins.',
        controls: [['DRAG', 'aim and set power'], ['RELEASE', 'take the shot'], ['ESC', 'back to arcade']],
        scoreLabel: 'SCORE',
        overTitle: 'ROUND OVER',
        winTitle: 'UNDER PAR',
        init: init,
        initMenu: init,
        update: update,
        draw: draw,
        pointerUp: pointerUp
    });
})();

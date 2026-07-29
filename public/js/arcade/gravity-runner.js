/**
 * Gravity Runner — one button, real gravity, near-misses pay.
 *
 * The ship always flies right and always accelerates. Holding thrusts up;
 * releasing lets planets pull. Skimming a planet close builds a multiplier,
 * which is the whole reason to fly dangerously instead of down the middle.
 */
(function () {
    var THRUST = 980;           // px/s^2 upward while held
    var BASE_SPEED = 300;       // px/s forward at t=0
    var SPEED_GAIN = 11;        // px/s added per second survived
    var G = 240000;             // gravity constant, tuned by feel not by Newton
    var SKIM = 62;              // extra px beyond a planet's radius that counts as a skim

    var GAP = 108;              // clearance left beside each planet

    /**
     * Places a planet so that a gap reachable from the previous gap always
     * exists.
     *
     * Purely random placement produces consecutive planets at opposite extremes
     * of the screen, which no amount of thrust can weave between — measured bot
     * runs died to planets every few seconds because some runs were simply
     * impossible. Choosing the gap first, within reach of the last one, and
     * hanging the planet off it guarantees a line exists. Skimming is still
     * optional; only the score cares.
     */
    function spawnPlanet(g, x, prevGapY, reach) {
        var r = g.rand(28, 92);
        var gapY = g.clamp(prevGapY + g.rand(-reach, reach), 120, g.h - 120);
        var above = Math.random() < 0.5;
        var y = above ? gapY - (r + GAP) : gapY + (r + GAP);
        if (y < r + 16) y = gapY + (r + GAP);
        if (y > g.h - r - 16) y = gapY - (r + GAP);
        return {
            x: x, y: y, r: r, gapY: gapY,
            hue: g.pickOne([196, 210, 24, 280, 158, 340]),
            skimmed: false, ring: Math.random() < 0.28
        };
    }

    function init(g) {
        g.s = {
            ship: { x: g.w * 0.26, y: g.h / 2, vy: 0 },
            camX: 0,
            speed: BASE_SPEED,
            planets: [],
            mult: 1,
            multT: 0,
            trail: [],
            stars: Array.from({ length: 130 }, function () {
                return { x: g.rand(0, g.w * 2), y: g.rand(0, g.h), z: g.rand(0.2, 1) };
            }),
            dist: 0,
            lastGapY: g.h / 2,
            nextX: g.w + 220
        };
        for (var i = 0; i < 7; i++) addPlanet(g);
    }

    /** Appends one planet at the running spawn cursor and advances it. */
    function addPlanet(g) {
        var s = g.s;
        var spacing = Math.max(250, g.rand(320, 540) - Math.min(140, g.t * 2.6));
        var reach = 330 * (spacing / Math.max(240, s.speed));
        var p = spawnPlanet(g, s.nextX, s.lastGapY, reach);
        s.lastGapY = p.gapY;
        s.nextX += spacing;
        s.planets.push(p);
    }

    function update(g, dt) {
        var s = g.s;
        var sh = s.ship;

        s.speed = BASE_SPEED + g.t * SPEED_GAIN;
        s.camX += s.speed * dt;
        s.dist += s.speed * dt;

        // Thrust: pointer held, space, or up arrow. All three, because at an expo
        // half the people reach for the mouse and half reach for the keyboard.
        var thrusting = g.pointer.down || g.key('Space') || g.key('ArrowUp') || g.key('KeyW');
        sh.vy += (thrusting ? -THRUST : 0) * dt;
        sh.vy += 440 * dt;   // constant downward drift so releasing always means falling

        for (var i = 0; i < s.planets.length; i++) {
            var p = s.planets[i];
            var px = p.x - s.camX;
            var dx = px - sh.x, dy = p.y - sh.y;
            var d2 = dx * dx + dy * dy;
            var d = Math.sqrt(d2);
            if (d < 1) d = 1;
            var pull = (G * (p.r / 60)) / Math.max(d2, 900);
            sh.vy += (dy / d) * pull * dt;

            if (d < p.r + 12) {
                g.burst(sh.x, sh.y, { n: 46, colour: '#ff8b8b', speed: 420, life: 0.9 });
                g.burst(sh.x, sh.y, { n: 22, colour: '#ffd35a', speed: 260 });
                g.shake(26);
                g.sfx('boom');
                g.over('You flew into a planet at ' + Math.round(s.speed) + ' px/s.');
                return;
            }
            if (!p.skimmed && d < p.r + SKIM && px < sh.x) {
                p.skimmed = true;
                s.mult = Math.min(9, s.mult + 1);
                s.multT = 2.4;
                g.addScore(50 * s.mult);
                g.sfx('blip', 1 + s.mult * 0.08);
                g.flash('SKIM ×' + s.mult, '#ffd35a', 420);
                g.burst(sh.x, sh.y, { n: 10, colour: '#ffd35a', speed: 140, life: 0.4 });
            }
        }

        if (thrusting && Math.random() < 0.7) {
            g.burst(sh.x - 12, sh.y + 3, { n: 1, angle: Math.PI * 0.92, spread: 0.35, speed: 190, colour: '#7aa2ff', life: 0.3, size: 2.2 });
        }

        sh.vy = g.clamp(sh.vy, -720, 820);
        sh.y += sh.vy * dt;

        // The ceiling is a scrape, not a death. Measured bot play died to the
        // ceiling as often as to planets, which made the game about fighting
        // your own thrust instead of reading the field. The floor still kills,
        // so doing nothing still loses.
        if (sh.y < 14) {
            sh.y = 14;
            if (sh.vy < 0) {
                sh.vy = 0;
                g.shake(3);
                g.burst(sh.x, 14, { n: 3, colour: '#7aa2ff', speed: 90, life: 0.25, size: 1.6 });
            }
        }

        s.trail.push({ x: sh.x, y: sh.y });
        if (s.trail.length > 26) s.trail.shift();

        s.multT -= dt;
        if (s.multT <= 0 && s.mult > 1) { s.mult = 1; s.multT = 0; }

        if (sh.y > g.h - 10) {
            g.burst(sh.x, sh.y, { n: 30, colour: '#ff8b8b', speed: 300 });
            g.shake(18);
            g.sfx('boom');
            g.over('You fell out of the corridor.');
            return;
        }

        // Recycle planets and keep the field ahead populated.
        for (var j = s.planets.length - 1; j >= 0; j--) {
            if (s.planets[j].x - s.camX < -180) s.planets.splice(j, 1);
        }
        while (s.planets.length < 8) addPlanet(g);

        g.addScore(s.speed * dt * 0.06 * s.mult);
        g.hud('SPEED <b>' + Math.round(s.speed) + '</b><br>MULTIPLIER <b>×' + s.mult + '</b>');
    }

    function draw(g, c) {
        var s = g.s;
        c.fillStyle = '#03060f';
        c.fillRect(0, 0, g.w, g.h);

        for (var i = 0; i < s.stars.length; i++) {
            var st = s.stars[i];
            var x = ((st.x - s.camX * st.z * 0.35) % (g.w + 40) + g.w + 40) % (g.w + 40) - 20;
            c.globalAlpha = 0.25 + st.z * 0.55;
            c.fillStyle = '#cfe0ff';
            c.fillRect(x, st.y, st.z * 2, st.z * 2);
        }
        c.globalAlpha = 1;

        for (var p, k = 0; k < s.planets.length; k++) {
            p = s.planets[k];
            var px = p.x - s.camX;
            if (px < -160 || px > g.w + 200) continue;
            g.glow(c, px, p.y, p.r * 2.5, 'hsla(' + p.hue + ',80%,60%,0.16)');
            if (p.ring) {
                c.strokeStyle = 'hsla(' + p.hue + ',70%,72%,0.5)';
                c.lineWidth = 3;
                c.beginPath(); c.ellipse(px, p.y, p.r * 1.75, p.r * 0.42, -0.4, 0, 6.2832); c.stroke();
            }
            var grd = c.createRadialGradient(px - p.r * 0.35, p.y - p.r * 0.4, p.r * 0.1, px, p.y, p.r);
            grd.addColorStop(0, 'hsl(' + p.hue + ',70%,66%)');
            grd.addColorStop(1, 'hsl(' + p.hue + ',65%,26%)');
            c.fillStyle = grd;
            c.beginPath(); c.arc(px, p.y, p.r, 0, 6.2832); c.fill();

            // The skim ring is the game's only teacher: it shows exactly how
            // close "close" is, so the risk is a judgement rather than a guess.
            if (!p.skimmed) {
                c.strokeStyle = 'rgba(255,211,90,0.22)';
                c.setLineDash([6, 9]); c.lineWidth = 1.6;
                c.beginPath(); c.arc(px, p.y, p.r + SKIM, 0, 6.2832); c.stroke();
                c.setLineDash([]);
            }
        }

        for (var t = 0; t < s.trail.length; t++) {
            c.globalAlpha = (t / s.trail.length) * 0.5;
            c.fillStyle = g.accent;
            c.beginPath(); c.arc(s.trail[t].x, s.trail[t].y, 3.4 * (t / s.trail.length), 0, 6.2832); c.fill();
        }
        c.globalAlpha = 1;

        var sh = s.ship;
        g.glow(c, sh.x, sh.y, 46, 'rgba(100,255,218,0.28)');
        c.save();
        c.translate(sh.x, sh.y);
        c.rotate(g.clamp(sh.vy / 1400, -0.6, 0.6));
        c.fillStyle = g.accent;
        c.beginPath();
        c.moveTo(15, 0); c.lineTo(-11, -8); c.lineTo(-6, 0); c.lineTo(-11, 8);
        c.closePath(); c.fill();
        c.restore();
    }

    Arcade.create({
        slug: 'gravity-runner',
        title: 'GRAVITY RUNNER',
        accent: '#64ffda',
        tagline: 'One button. You always fly right, always faster. Planets pull you in — skim their dashed ring for a score multiplier, touch one and you are dust. The ceiling only scrapes; the floor does not forgive.',
        controls: [['HOLD', 'thrust upward'], ['RELEASE', 'fall'], ['SPACE / ↑', 'same as hold'], ['ESC', 'back to arcade']],
        scoreLabel: 'SCORE',
        overTitle: 'DUST',
        init: init,
        initMenu: init,
        update: update,
        draw: draw
    });
})();

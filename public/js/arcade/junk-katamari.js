/**
 * Space Junk Katamari — a bolt with ambition.
 *
 * Eat anything smaller than you and grow; touch anything bigger and it knocks a
 * chunk off. Sixty seconds. The comedy is entirely in the rank names, so they
 * are load-bearing: BOLT → ... → MOON is the actual progress bar.
 */
(function () {
    var RUN_S = 60;
    var START_R = 11;
    var FOLLOW = 5.2;           // how hard the blob chases the cursor
    var EAT_MARGIN = 0.94;      // must be this much smaller than you to be eaten

    var RANKS = [
        { r: 0,   name: 'BOLT' },
        { r: 16,  name: 'SCREW' },
        { r: 24,  name: 'WRENCH' },
        { r: 34,  name: 'HULL PANEL' },
        { r: 48,  name: 'CUBESAT' },
        { r: 66,  name: 'SATELLITE' },
        { r: 88,  name: 'SPACE STATION' },
        { r: 115, name: 'SMALL MOON' },
        { r: 150, name: 'MOON' }
    ];

    var JUNK = ['🔩', '🔧', '🪛', '📡', '🛰️', '🔋', '📻', '🧯', '🪝', '⚙️'];

    function rankOf(r) {
        var name = RANKS[0].name;
        for (var i = 0; i < RANKS.length; i++) if (r >= RANKS[i].r) name = RANKS[i].name;
        return name;
    }

    function spawnJunk(g, radiusHint, scatter) {
        var s = g.s;
        // Sizes are drawn relative to the player and biased small: squaring a
        // uniform roll puts roughly two thirds of the field below your own size.
        // A flat distribution around the player reads as "everything is bigger
        // than me", because only the narrow band just under your radius is food.
        var u = Math.random();
        var r = radiusHint * (0.25 + u * u * 1.6);
        r = g.clamp(r, 5, 200);
        var x, y;
        if (scatter) {
            // Opening fill: spread through the whole world. Spawning the first
            // batch at the edges (as later ones do) leaves the player alone in
            // the middle of an empty screen for the first ten seconds.
            x = g.rand(0, s.worldW);
            y = g.rand(0, s.worldH);
            if (g.dist(x, y, s.me.x, s.me.y) < 90) x += 140;   // never start inside the player
        } else {
            var edge = Math.floor(Math.random() * 4);
            x = edge === 0 ? -r - 20 : edge === 1 ? s.worldW + r + 20 : g.rand(0, s.worldW);
            y = edge === 2 ? -r - 20 : edge === 3 ? s.worldH + r + 20 : g.rand(0, s.worldH);
        }
        s.junk.push({
            x: x, y: y, r: r,
            vx: g.rand(-26, 26), vy: g.rand(-26, 26),
            rot: Math.random() * 6.28, spin: g.rand(-1.6, 1.6),
            icon: g.pickOne(JUNK)
        });
    }

    function init(g) {
        g.s = {
            // A world 1.5 screens across keeps the junk dense enough that there
            // is always something in frame. At 2.2 the field reads as an empty
            // grid with the occasional bolt in it.
            worldW: g.w * 1.5, worldH: g.h * 1.5,
            me: { x: g.w * 0.75, y: g.h * 0.75, r: START_R, vx: 0, vy: 0 },
            junk: [],
            stuck: [],
            time: RUN_S,
            eaten: 0,
            rank: 'BOLT',
            camX: 0, camY: 0
        };
        for (var i = 0; i < 150; i++) spawnJunk(g, START_R, true);
    }

    function update(g, dt) {
        var s = g.s;
        var me = s.me;

        s.time -= dt;
        if (s.time <= 0) {
            g.flash('TIME', g.accent, 1200);
            g.over('You finished as a ' + rankOf(me.r) + ' — ' + s.eaten + ' pieces of junk absorbed.', me.r >= 66);
            return;
        }

        // Chase the cursor in world space.
        var tx = g.pointer.x + s.camX;
        var ty = g.pointer.y + s.camY;
        if (g.key('ArrowLeft') || g.key('KeyA')) tx = me.x - 300;
        if (g.key('ArrowRight') || g.key('KeyD')) tx = me.x + 300;
        if (g.key('ArrowUp') || g.key('KeyW')) ty = me.y - 300;
        if (g.key('ArrowDown') || g.key('KeyS')) ty = me.y + 300;

        // Bigger means slower. Without this, growth has no cost and the last
        // twenty seconds are a formality.
        var agility = FOLLOW * (START_R / me.r) * 1.9;
        me.vx += (tx - me.x) * agility * dt;
        me.vy += (ty - me.y) * agility * dt;
        var damp = Math.exp(-3.2 * dt);
        me.vx *= damp; me.vy *= damp;
        me.x += me.vx * dt; me.y += me.vy * dt;
        me.x = g.clamp(me.x, me.r, s.worldW - me.r);
        me.y = g.clamp(me.y, me.r, s.worldH - me.r);

        for (var i = s.junk.length - 1; i >= 0; i--) {
            var j = s.junk[i];
            j.x += j.vx * dt; j.y += j.vy * dt;
            j.rot += j.spin * dt;
            if (j.x < -300 || j.x > s.worldW + 300 || j.y < -300 || j.y > s.worldH + 300) {
                s.junk.splice(i, 1);
                continue;
            }

            var d = g.dist(me.x, me.y, j.x, j.y);
            if (d > me.r + j.r) continue;

            if (j.r < me.r * EAT_MARGIN) {
                // Absorb: area adds, so eating small things stops mattering as
                // you grow and you have to go after the scary ones.
                var newArea = me.r * me.r + j.r * j.r * 0.62;
                me.r = Math.sqrt(newArea);
                s.eaten++;
                g.addScore(Math.round(10 + j.r * 3));
                s.stuck.push({ a: Math.random() * 6.2832, d: g.rand(0.55, 0.92), icon: j.icon, size: j.r });
                if (s.stuck.length > 40) s.stuck.shift();
                g.sfx('pick', 1.4 - Math.min(0.8, me.r / 220));
                g.burst(j.x - s.camX, j.y - s.camY, { n: 6, colour: '#b48bff', speed: 110, life: 0.35 });
                s.junk.splice(i, 1);
                spawnJunk(g, me.r);

                var nr = rankOf(me.r);
                if (nr !== s.rank) {
                    s.rank = nr;
                    g.flash(nr, '#b48bff', 1000);
                    g.sfx('win');
                    g.shake(9);
                }
            } else {
                // Only clearly bigger junk hurts. Without this neutral band,
                // anything within a few percent of your own size punishes you,
                // and the early game is nothing but getting shoved around.
                var lost = j.r > me.r * 1.18 ? Math.min(me.r - START_R * 0.6, me.r * 0.10) : 0;
                if (lost > 0.4) {
                    me.r = Math.max(START_R * 0.7, me.r - lost);
                    for (var k = 0; k < 3 && s.stuck.length; k++) s.stuck.pop();
                    g.shake(13);
                    g.sfx('hit');
                    g.flash('SHEARED', '#ff8b8b', 500);
                    g.burst(me.x - s.camX, me.y - s.camY, { n: 14, colour: '#ff8b8b', speed: 220 });
                }
                var a = g.angleTo(j.x, j.y, me.x, me.y);
                me.vx += Math.cos(a) * 340;
                me.vy += Math.sin(a) * 340;
                j.vx -= Math.cos(a) * 40; j.vy -= Math.sin(a) * 40;
            }
        }

        while (s.junk.length < 150) spawnJunk(g, me.r);

        // Camera follows with the player slightly ahead of centre.
        s.camX = g.clamp(me.x - g.w / 2, 0, s.worldW - g.w);
        s.camY = g.clamp(me.y - g.h / 2, 0, s.worldH - g.h);

        g.hud('YOU ARE A <b>' + s.rank + '</b><br>SIZE <b>' + Math.round(me.r) + '</b> · ABSORBED <b>' + s.eaten + '</b><br>' +
              'TIME <b>' + s.time.toFixed(1) + 's</b>');
    }

    function draw(g, c) {
        var s = g.s;
        var me = s.me;
        c.fillStyle = '#05030f';
        c.fillRect(0, 0, g.w, g.h);

        // Parallax grid so movement reads even in empty space.
        c.strokeStyle = 'rgba(180,139,255,0.08)';
        c.lineWidth = 1;
        var step = 90;
        for (var x = -(s.camX % step); x < g.w; x += step) {
            c.beginPath(); c.moveTo(x, 0); c.lineTo(x, g.h); c.stroke();
        }
        for (var y = -(s.camY % step); y < g.h; y += step) {
            c.beginPath(); c.moveTo(0, y); c.lineTo(g.w, y); c.stroke();
        }

        c.textAlign = 'center';
        c.textBaseline = 'middle';
        for (var i = 0; i < s.junk.length; i++) {
            var j = s.junk[i];
            var jx = j.x - s.camX, jy = j.y - s.camY;
            if (jx < -140 || jx > g.w + 140 || jy < -140 || jy > g.h + 140) continue;
            var edible = j.r < me.r * EAT_MARGIN;
            var dangerous = j.r > me.r * 1.18;
            c.save();
            c.translate(jx, jy);
            c.rotate(j.rot);
            c.font = Math.round(j.r * 1.9) + 'px serif';
            c.globalAlpha = edible ? 1 : 0.95;
            c.fillText(j.icon, 0, 0);
            c.restore();
            // Red ring means "this one will hurt you", not merely "too big to
            // eat" — marking harmless neighbours as threats teaches fear of the
            // wrong things.
            if (dangerous) {
                c.strokeStyle = 'rgba(255,139,139,0.45)';
                c.lineWidth = 2;
                c.beginPath(); c.arc(jx, jy, j.r + 3, 0, 6.2832); c.stroke();
            }
        }

        // The blob itself, with everything it has eaten stuck to the outside.
        var mx = me.x - s.camX, my = me.y - s.camY;
        g.glow(c, mx, my, me.r * 2.4, 'rgba(180,139,255,0.22)');
        c.fillStyle = '#241640';
        c.beginPath(); c.arc(mx, my, me.r, 0, 6.2832); c.fill();
        c.strokeStyle = '#b48bff'; c.lineWidth = 2.5;
        c.beginPath(); c.arc(mx, my, me.r, 0, 6.2832); c.stroke();

        for (var k = 0; k < s.stuck.length; k++) {
            var st = s.stuck[k];
            var a = st.a + g.t * 0.5;
            c.save();
            c.translate(mx + Math.cos(a) * me.r * st.d, my + Math.sin(a) * me.r * st.d);
            c.rotate(a);
            c.font = Math.round(Math.min(st.size, me.r * 0.42) * 1.7) + 'px serif';
            c.fillText(st.icon, 0, 0);
            c.restore();
        }
        c.textAlign = 'left';
        c.textBaseline = 'alphabetic';

        // Timer bar across the top of the play area.
        var frac = Math.max(0, s.time / RUN_S);
        c.fillStyle = 'rgba(255,255,255,0.09)';
        c.fillRect(0, g.h - 7, g.w, 7);
        c.fillStyle = frac < 0.2 ? '#ff8b8b' : '#b48bff';
        c.fillRect(0, g.h - 7, g.w * frac, 7);
    }

    Arcade.create({
        slug: 'junk-katamari',
        title: 'SPACE JUNK KATAMARI',
        accent: '#b48bff',
        tagline: 'You are a runaway bolt. Roll into anything smaller and it sticks to you. Anything ringed in red is bigger than you and will shear pieces off. Sixty seconds to become a moon.',
        controls: [['MOUSE', 'the blob chases your cursor'], ['WASD / ↑←↓→', 'steer instead'], ['ESC', 'back to arcade']],
        scoreLabel: 'MASS',
        overTitle: 'TIME UP',
        winTitle: 'BEHOLD, A MOON',
        init: init,
        initMenu: init,
        update: update,
        draw: draw
    });
})();

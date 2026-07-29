/**
 * Kessler Reversed — you are paid to cause the cascade.
 *
 * The mission version of Kessler asks you to prevent a chain reaction, which is
 * a job. This asks you to start one with a single bolt and then watch, which is
 * a firework. Same physics, opposite goal, and all the payoff is in the ripple.
 */
(function () {
    var SATS = 210;
    var FRAG_PER_KILL = 3;
    var FRAG_SPEED = 190;
    var FRAG_LIFE = 9;
    var SAT_R = 4.2;
    var FRAG_R = 2.4;

    function makeField(g) {
        var cx = g.w / 2, cy = g.h / 2;
        var maxR = Math.min(g.w, g.h) * 0.46;
        var sats = [];
        for (var i = 0; i < SATS; i++) {
            var ring = 3 + Math.floor(Math.random() * 6);
            var r = maxR * (0.22 + ring * 0.085) + g.rand(-7, 7);
            sats.push({
                r: r,
                a: Math.random() * 6.2832,
                w: (Math.random() < 0.5 ? 1 : -1) * (0.34 - r / (maxR * 6)) * g.rand(0.85, 1.15),
                alive: true,
                hue: 210 + g.rand(-18, 26)
            });
        }
        return { cx: cx, cy: cy, maxR: maxR, sats: sats };
    }

    function init(g) {
        var f = makeField(g);
        g.s = {
            cx: f.cx, cy: f.cy, maxR: f.maxR,
            sats: f.sats,
            frags: [],
            fired: false,
            shot: null,
            killed: 0,
            chain: 0,
            bestChain: 0,
            chainT: 0,
            settleT: 0,
            slowmo: 1
        };
    }

    function killSat(g, s, sat, sx, sy) {
        sat.alive = false;
        s.killed++;
        s.chain++;
        s.chainT = 1.8;
        s.bestChain = Math.max(s.bestChain, s.chain);
        g.addScore(100 + s.chain * 12);
        g.shake(Math.min(16, 2 + s.chain * 0.25));
        g.sfx('hit', 1 + Math.min(1.4, s.chain * 0.035));
        g.burst(sx, sy, { n: 9, colour: '#fbbf24', speed: 170, life: 0.5, size: 2 });

        for (var i = 0; i < FRAG_PER_KILL; i++) {
            var a = Math.random() * 6.2832;
            var sp = FRAG_SPEED * g.rand(0.6, 1.5);
            s.frags.push({
                x: sx, y: sy,
                vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                life: FRAG_LIFE
            });
        }
    }

    function update(g, dt) {
        var s = g.s;
        dt *= s.slowmo;

        if (!s.fired) {
            s.settleT = 0;
        }

        // Orbits keep turning the whole time, so the field the debris flies into
        // is never the field you aimed at. That is where the luck lives.
        for (var i = 0; i < s.sats.length; i++) {
            var st = s.sats[i];
            if (!st.alive) continue;
            st.a += st.w * dt;
        }

        function satXY(st) {
            return { x: s.cx + Math.cos(st.a) * st.r, y: s.cy + Math.sin(st.a) * st.r };
        }

        // The single shot is just a fast fragment with a brighter tail.
        if (s.shot) {
            s.shot.x += s.shot.vx * dt;
            s.shot.y += s.shot.vy * dt;
            s.shot.life -= dt;
            g.burst(s.shot.x, s.shot.y, { n: 1, speed: 20, colour: '#ffffff', life: 0.35, size: 2 });
            for (var k = 0; k < s.sats.length; k++) {
                var sa = s.sats[k];
                if (!sa.alive) continue;
                var p = satXY(sa);
                if (g.dist(s.shot.x, s.shot.y, p.x, p.y) < SAT_R + 5) {
                    killSat(g, s, sa, p.x, p.y);
                    s.shot = null;
                    s.slowmo = 0.35;
                    break;
                }
            }
            if (s.shot && (s.shot.life <= 0 || s.shot.x < -60 || s.shot.x > g.w + 60 || s.shot.y < -60 || s.shot.y > g.h + 60)) {
                s.shot = null;
                g.flash('MISS', '#ff8b8b', 900);
            }
        }

        if (s.slowmo < 1) s.slowmo = Math.min(1, s.slowmo + dt * 1.6);

        for (var f = s.frags.length - 1; f >= 0; f--) {
            var fr = s.frags[f];
            fr.x += fr.vx * dt; fr.y += fr.vy * dt;
            fr.life -= dt;
            var out = fr.x < -80 || fr.x > g.w + 80 || fr.y < -80 || fr.y > g.h + 80;
            if (fr.life <= 0 || out) { s.frags.splice(f, 1); continue; }

            for (var j = 0; j < s.sats.length; j++) {
                var sb = s.sats[j];
                if (!sb.alive) continue;
                var q = satXY(sb);
                if (g.dist(fr.x, fr.y, q.x, q.y) < SAT_R + FRAG_R + 1.5) {
                    killSat(g, s, sb, q.x, q.y);
                    break;
                }
            }
        }

        s.chainT -= dt;
        if (s.chainT <= 0 && s.chain > 0) s.chain = 0;

        var aliveCount = 0;
        for (var m = 0; m < s.sats.length; m++) if (s.sats[m].alive) aliveCount++;

        g.hud('DESTROYED <b>' + s.killed + ' / ' + SATS + '</b><br>' +
              'LONGEST CHAIN <b>' + s.bestChain + '</b><br>' +
              'DEBRIS IN FLIGHT <b>' + s.frags.length + '</b>');

        if (s.fired && !s.shot && s.frags.length === 0) {
            s.settleT += dt;
            if (s.settleT > 1.1) {
                var pct = Math.round((s.killed / SATS) * 100);
                g.over(s.killed + ' of ' + SATS + ' satellites destroyed (' + pct + '% of the field), longest chain ' + s.bestChain + '.', s.killed > SATS * 0.35);
            }
        }
        if (aliveCount === 0) {
            g.flash('TOTAL CASCADE', '#fbbf24', 1400);
        }
    }

    function pointerDown(g) {
        var s = g.s;
        if (s.fired) return;
        s.fired = true;
        var a = g.angleTo(g.w / 2, g.h + 40, g.pointer.x, g.pointer.y);
        s.shot = { x: g.w / 2, y: g.h + 40, vx: Math.cos(a) * 900, vy: Math.sin(a) * 900, life: 4 };
        g.sfx('thrust');
        g.flash('FIRED', '#fbbf24', 500);
    }

    function draw(g, c) {
        var s = g.s;
        c.fillStyle = '#03060f';
        c.fillRect(0, 0, g.w, g.h);

        // Orbit rings, faint, purely so the field reads as orbits not confetti.
        c.strokeStyle = 'rgba(122,162,255,0.07)';
        c.lineWidth = 1;
        for (var r = 0.28; r < 1.0; r += 0.085) {
            c.beginPath(); c.arc(s.cx, s.cy, s.maxR * r, 0, 6.2832); c.stroke();
        }

        g.glow(c, s.cx, s.cy, s.maxR * 0.34, 'rgba(40,110,200,0.30)');
        var grd = c.createRadialGradient(s.cx - 18, s.cy - 22, 6, s.cx, s.cy, s.maxR * 0.19);
        grd.addColorStop(0, '#3f86d8'); grd.addColorStop(1, '#123a68');
        c.fillStyle = grd;
        c.beginPath(); c.arc(s.cx, s.cy, s.maxR * 0.19, 0, 6.2832); c.fill();

        for (var i = 0; i < s.sats.length; i++) {
            var st = s.sats[i];
            if (!st.alive) continue;
            var x = s.cx + Math.cos(st.a) * st.r;
            var y = s.cy + Math.sin(st.a) * st.r;
            c.fillStyle = 'hsl(' + st.hue + ',85%,72%)';
            c.beginPath(); c.arc(x, y, SAT_R, 0, 6.2832); c.fill();
        }

        c.fillStyle = '#ff8b8b';
        for (var f = 0; f < s.frags.length; f++) {
            var fr = s.frags[f];
            c.beginPath(); c.arc(fr.x, fr.y, FRAG_R, 0, 6.2832); c.fill();
        }

        if (s.shot) {
            g.glow(c, s.shot.x, s.shot.y, 20, 'rgba(255,255,255,0.7)');
            c.fillStyle = '#fff';
            c.beginPath(); c.arc(s.shot.x, s.shot.y, 3.4, 0, 6.2832); c.fill();
        }

        // Aim line before the one shot is spent.
        if (!s.fired) {
            var ax = g.w / 2, ay = g.h + 40;
            var a = g.angleTo(ax, ay, g.pointer.x || g.w / 2, g.pointer.y || g.h / 2);
            c.strokeStyle = 'rgba(251,191,36,0.55)';
            c.setLineDash([10, 10]); c.lineWidth = 2;
            c.beginPath();
            c.moveTo(ax, ay);
            c.lineTo(ax + Math.cos(a) * 2200, ay + Math.sin(a) * 2200);
            c.stroke();
            c.setLineDash([]);

            c.fillStyle = 'rgba(232,238,252,0.75)';
            c.font = '600 15px Inter, sans-serif';
            c.textAlign = 'center';
            c.fillText('ONE SHOT — aim and click', g.w / 2, g.h - 34);
            c.textAlign = 'left';
        }
    }

    Arcade.create({
        slug: 'kessler-reversed',
        title: 'KESSLER REVERSED',
        accent: '#fbbf24',
        tagline: 'A demolition contract. Two hundred satellites, one bolt. Fire it into the busiest lane you can find and watch the wreckage take out everything else. Score is destruction.',
        controls: [['CLICK', 'fire your one shot'], ['MOVE', 'aim'], ['ESC', 'back to arcade']],
        scoreLabel: 'SCORE',
        overTitle: 'CONTRACT CLOSED',
        winTitle: 'CASCADE ACHIEVED',
        init: init,
        initMenu: init,
        update: update,
        draw: draw,
        pointerDown: pointerDown
    });
})();

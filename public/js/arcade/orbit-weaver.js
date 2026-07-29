/**
 * Orbit Weaver — the quiet one.
 *
 * Drag satellites onto orbit rings so every ground zone has signal. Low orbits
 * give a narrow strong beam, high orbits a wide weak one, and two satellites
 * sharing a ring collide. That trade is the whole puzzle: you cannot solve a
 * level by putting everything as high as it goes.
 */
(function () {
    var RINGS = 5;
    var PLANET_R = 78;
    var MIN_SEP = 0.55;         // radians two satellites on one ring must keep apart
    var LEVELS = 8;

    function ringR(g, i) {
        return PLANET_R + 42 + i * (Math.min(g.w, g.h) * 0.055);
    }

    /** Beam half-width and strength for a ring: high = wide but weak. */
    function beam(i) {
        return { half: 0.28 + i * 0.16, strength: 1.0 - i * 0.15 };
    }

    function seeded(seed) {
        var s = seed >>> 0;
        return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    }

    /** Signal a set of satellites delivers to one ground angle. Overlaps add. */
    function coverageAt(g, sats, angle) {
        var total = 0;
        for (var i = 0; i < sats.length; i++) {
            var b = beam(sats[i].ring);
            var off = Math.abs(g.wrapAngle(angle - sats[i].a));
            if (off < b.half) total += b.strength * (1 - (off / b.half) * 0.55);
        }
        return total;
    }

    /**
     * Levels are generated backwards from a solution that is known to work.
     *
     * Generating zones first and hoping the budget can reach them produces
     * levels that are quietly impossible — the demand can simply exceed what
     * any legal placement delivers. Placing a valid satellite set first and
     * then asking each zone for slightly less than that set already provides
     * makes every level solvable by construction.
     */
    function buildLevel(g, n) {
        var rnd = seeded(0xBEEF + n * 104729);
        var budget = Math.min(5, 2 + Math.floor(n * 0.55));
        var want = 3 + Math.floor(n * 0.7);

        for (var attempt = 0; attempt < 80; attempt++) {
            var sol = [];
            var legal = true;
            for (var i = 0; i < budget; i++) {
                var ring = Math.floor(rnd() * RINGS);
                var a = rnd() * 6.2832;
                for (var j = 0; j < sol.length; j++) {
                    if (sol[j].ring === ring && Math.abs(g.wrapAngle(sol[j].a - a)) < MIN_SEP * 1.35) legal = false;
                }
                sol.push({ ring: ring, a: a });
            }
            if (!legal) continue;

            var cands = [];
            var probes = want * 3;
            for (var z = 0; z < probes; z++) {
                var za = (z / probes) * 6.2832 + rnd() * 0.18;
                var got = coverageAt(g, sol, za);
                if (got > 0.34) cands.push({ a: za, need: got * (0.66 + rnd() * 0.22), got: 0 });
            }
            if (cands.length < want) continue;

            // Take an evenly strided sample so the zones stay spread around the
            // planet instead of bunching under one satellite.
            var stride = cands.length / want;
            var zones = [];
            for (var k = 0; k < want; k++) zones.push(cands[Math.floor(k * stride)]);
            return { zones: zones, budget: budget, solution: sol };
        }

        // Fallback: one zone directly under each satellite of a legal set.
        var fb = [];
        for (var f = 0; f < budget; f++) fb.push({ ring: f % RINGS, a: (f / budget) * 6.2832 });
        var fz = [];
        for (var q = 0; q < budget; q++) {
            fz.push({ a: fb[q].a, need: coverageAt(g, fb, fb[q].a) * 0.7, got: 0 });
        }
        return { zones: fz, budget: budget, solution: fb };
    }

    function init(g) {
        g.s = {
            level: 0,
            data: buildLevel(g, 0),
            sats: [],
            drag: null,
            solvedT: 0,
            attempts: 0
        };
        g.setScore(0);
    }

    /** Recompute coverage. Pure function of satellite placement — no history. */
    function evaluate(g) {
        var s = g.s;
        var zones = s.data.zones;
        for (var i = 0; i < s.sats.length; i++) s.sats[i].conflict = false;
        for (var z = 0; z < zones.length; z++) zones[z].got = coverageAt(g, s.sats, zones[z].a);

        for (var a = 0; a < s.sats.length; a++) {
            for (var bb = a + 1; bb < s.sats.length; bb++) {
                if (s.sats[a].ring !== s.sats[bb].ring) continue;
                if (Math.abs(g.wrapAngle(s.sats[a].a - s.sats[bb].a)) < MIN_SEP) {
                    s.sats[a].conflict = true;
                    s.sats[bb].conflict = true;
                }
            }
        }

        var covered = 0, conflicts = 0;
        for (var k = 0; k < zones.length; k++) if (zones[k].got >= zones[k].need) covered++;
        for (var m = 0; m < s.sats.length; m++) if (s.sats[m].conflict) conflicts++;
        return { covered: covered, total: zones.length, conflicts: conflicts };
    }

    function update(g, dt) {
        var s = g.s;
        var res = evaluate(g);

        if (s.solvedT > 0) {
            s.solvedT -= dt;
            if (s.solvedT <= 0) {
                s.level++;
                if (s.level >= LEVELS) {
                    g.over('All ' + LEVELS + ' networks woven in ' + s.attempts + ' placements.', true);
                    return;
                }
                s.data = buildLevel(g, s.level);
                s.sats.length = 0;
                g.flash('LEVEL ' + (s.level + 1), g.accent, 900);
            }
            return;
        }

        if (res.covered === res.total && res.conflicts === 0 && s.sats.length > 0) {
            s.solvedT = 1.3;
            var spare = s.data.budget - s.sats.length;
            g.addScore(700 + spare * 350);
            g.sfx('win');
            g.flash('NETWORK COMPLETE' + (spare > 0 ? ' · ' + spare + ' SPARE' : ''), g.accent, 1200);
            for (var z = 0; z < s.data.zones.length; z++) {
                var zz = s.data.zones[z];
                g.burst(g.w / 2 + Math.cos(zz.a) * PLANET_R, g.h / 2 + Math.sin(zz.a) * PLANET_R,
                    { n: 12, colour: g.accent, speed: 150, life: 0.7 });
            }
            return;
        }

        g.hud('LEVEL <b>' + (s.level + 1) + ' / ' + LEVELS + '</b><br>' +
              'ZONES COVERED <b>' + res.covered + ' / ' + res.total + '</b><br>' +
              'SATELLITES <b>' + s.sats.length + ' / ' + s.data.budget + '</b>' +
              (res.conflicts ? ' · <b style="color:#ff8b8b">' + res.conflicts + ' TOO CLOSE</b>' : ''));
    }

    function nearestRing(g, x, y) {
        var d = g.dist(x, y, g.w / 2, g.h / 2);
        var best = -1, gap = Infinity;
        for (var i = 0; i < RINGS; i++) {
            var gg = Math.abs(d - ringR(g, i));
            if (gg < gap) { gap = gg; best = i; }
        }
        return gap < 34 ? best : -1;
    }

    function pointerDown(g) {
        var s = g.s;
        if (s.solvedT > 0) return;
        var cx = g.w / 2, cy = g.h / 2;

        // Grab an existing satellite first.
        for (var i = 0; i < s.sats.length; i++) {
            var sa = s.sats[i];
            var x = cx + Math.cos(sa.a) * ringR(g, sa.ring);
            var y = cy + Math.sin(sa.a) * ringR(g, sa.ring);
            if (g.dist(g.pointer.x, g.pointer.y, x, y) < 22) {
                // Right-drag equivalent: clicking an existing one picks it up.
                s.drag = sa;
                g.sfx('tick');
                return;
            }
        }

        var ring = nearestRing(g, g.pointer.x, g.pointer.y);
        if (ring < 0) return;
        if (s.sats.length >= s.data.budget) {
            g.flash('OUT OF SATELLITES — DRAG ONE INSTEAD', '#ffb46b', 900);
            return;
        }
        var sat = { ring: ring, a: g.angleTo(cx, cy, g.pointer.x, g.pointer.y), conflict: false };
        s.sats.push(sat);
        s.drag = sat;
        s.attempts++;
        g.sfx('pick');
    }

    function pointerMove(g) {
        var s = g.s;
        if (!s.drag) return;
        var cx = g.w / 2, cy = g.h / 2;
        s.drag.a = g.angleTo(cx, cy, g.pointer.x, g.pointer.y);
        var ring = nearestRing(g, g.pointer.x, g.pointer.y);
        if (ring >= 0) s.drag.ring = ring;
    }

    function pointerUp(g) {
        if (g.s.drag) { g.s.drag = null; g.sfx('blip', 0.8); }
    }

    function keyDown(g, code) {
        // Backspace removes the last satellite, so a wrong drop is not permanent.
        if (code === 'Backspace' || code === 'KeyR') {
            if (g.s.sats.length) { g.s.sats.pop(); g.sfx('tick', 0.7); }
        }
    }

    function draw(g, c) {
        var s = g.s;
        var cx = g.w / 2, cy = g.h / 2;
        c.fillStyle = '#05040e';
        c.fillRect(0, 0, g.w, g.h);

        // The ring under the cursor lights up: "click a ring" is only useful
        // advice if the player can see which ring they are about to click.
        var hoverRing = nearestRing(g, g.pointer.x, g.pointer.y);
        for (var i = 0; i < RINGS; i++) {
            var on = i === hoverRing;
            c.strokeStyle = on ? 'rgba(201,160,255,0.55)' : 'rgba(201,160,255,0.26)';
            c.lineWidth = on ? 2.4 : 1.4;
            c.setLineDash(on ? [] : [3, 8]);
            c.beginPath(); c.arc(cx, cy, ringR(g, i), 0, 6.2832); c.stroke();
            c.setLineDash([]);
        }

        // Beams first, so satellites sit on top of their own footprints.
        for (var k = 0; k < s.sats.length; k++) {
            var sat = s.sats[k];
            var b = beam(sat.ring);
            var r = ringR(g, sat.ring);
            var sx = cx + Math.cos(sat.a) * r, sy = cy + Math.sin(sat.a) * r;
            c.fillStyle = sat.conflict ? 'rgba(255,139,139,0.13)' : 'rgba(201,160,255,0.13)';
            c.beginPath();
            c.moveTo(sx, sy);
            c.arc(cx, cy, PLANET_R, sat.a - b.half, sat.a + b.half);
            c.closePath();
            c.fill();
        }

        // Planet.
        g.glow(c, cx, cy, PLANET_R * 2.2, 'rgba(120,90,200,0.18)');
        var grd = c.createRadialGradient(cx - 24, cy - 28, 8, cx, cy, PLANET_R);
        grd.addColorStop(0, '#5c6fd0'); grd.addColorStop(1, '#1b2050');
        c.fillStyle = grd;
        c.beginPath(); c.arc(cx, cy, PLANET_R, 0, 6.2832); c.fill();

        // Ground zones as arcs on the surface.
        for (var z = 0; z < s.data.zones.length; z++) {
            var zn = s.data.zones[z];
            var ok = zn.got >= zn.need;
            var frac = Math.min(1, zn.got / zn.need);
            c.strokeStyle = ok ? '#64ffda' : 'rgba(255,255,255,0.25)';
            c.lineWidth = 7;
            c.beginPath();
            c.arc(cx, cy, PLANET_R + 4, zn.a - 0.16, zn.a + 0.16);
            c.stroke();
            if (!ok && frac > 0) {
                c.strokeStyle = 'rgba(255,211,90,0.8)';
                c.lineWidth = 7;
                c.beginPath();
                c.arc(cx, cy, PLANET_R + 4, zn.a - 0.16, zn.a - 0.16 + 0.32 * frac);
                c.stroke();
            }
            var lx = cx + Math.cos(zn.a) * (PLANET_R + 22);
            var ly = cy + Math.sin(zn.a) * (PLANET_R + 22);
            c.fillStyle = ok ? '#64ffda' : 'rgba(159,179,204,0.85)';
            c.font = '600 10px Inter, sans-serif';
            c.textAlign = 'center';
            c.fillText(ok ? '✓' : Math.round(frac * 100) + '%', lx, ly + 3);
            c.textAlign = 'left';
        }

        for (var m = 0; m < s.sats.length; m++) {
            var st = s.sats[m];
            var rr = ringR(g, st.ring);
            var x = cx + Math.cos(st.a) * rr, y = cy + Math.sin(st.a) * rr;
            g.glow(c, x, y, 26, st.conflict ? 'rgba(255,139,139,0.4)' : 'rgba(201,160,255,0.35)');
            c.fillStyle = st.conflict ? '#ff8b8b' : '#c9a0ff';
            c.save(); c.translate(x, y); c.rotate(st.a);
            c.fillRect(-5, -5, 10, 10);
            c.fillRect(-13, -2.5, 6, 5);
            c.fillRect(7, -2.5, 6, 5);
            c.restore();
            if (st.conflict) {
                c.strokeStyle = 'rgba(255,139,139,0.6)';
                c.lineWidth = 1.5; c.setLineDash([3, 4]);
                c.beginPath(); c.arc(x, y, 26, 0, 6.2832); c.stroke();
                c.setLineDash([]);
            }
        }

        c.fillStyle = 'rgba(232,238,252,0.55)';
        c.font = '600 12.5px Inter, sans-serif';
        c.textAlign = 'center';
        c.fillText('Click a ring to place · drag to move · BACKSPACE removes the last one', g.w / 2, g.h - 24);
        c.fillText('Low rings: narrow but strong. High rings: wide but weak.', g.w / 2, g.h - 44);
        c.textAlign = 'left';
    }

    Arcade.create({
        slug: 'orbit-weaver',
        title: 'ORBIT WEAVER',
        accent: '#c9a0ff',
        tagline: 'Give every ground zone a signal using only the satellites you are allotted. Low orbits are narrow and strong, high orbits wide and weak, and two satellites on the same ring will collide.',
        controls: [['CLICK RING', 'place a satellite'], ['DRAG', 'move one'], ['BACKSPACE', 'remove the last one'], ['ESC', 'back to arcade']],
        scoreLabel: 'SCORE',
        overTitle: 'NETWORK DOWN',
        winTitle: 'ALL NETWORKS WOVEN',
        init: init,
        initMenu: init,
        update: update,
        draw: draw,
        pointerDown: pointerDown,
        pointerMove: pointerMove,
        pointerUp: pointerUp,
        keyDown: keyDown
    });
})();

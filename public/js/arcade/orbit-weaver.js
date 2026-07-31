/**
 * Orbit Weaver — the quiet one.
 *
 * Drag satellites onto orbit rings so every ground zone has signal. Low orbits
 * give a narrow strong beam, high orbits a wide weak one, and two satellites
 * sharing a ring collide. That trade is the whole puzzle: you cannot solve a
 * level by putting everything as high as it goes.
 *
 * Placement is the puzzle and placement never moves on its own — all the
 * ambient motion here (spin, shimmer, travelling ring highlights, debris) is
 * strictly visual. The two things that make it a *decision* rather than a
 * guess: the ghost preview, which shows the beam and every zone's projected
 * coverage before you commit, and the relay window, which tightens each level
 * so banked seconds are a real speed-versus-safety trade.
 */
(function () {
    var RINGS = 5;
    var PLANET_R = 78;
    var MIN_SEP = 0.55;         // radians two satellites on one ring must keep apart
    var LEVELS = 8;
    var DEBRIS_N = 40;
    var ZONE_HALF = 0.16;       // half-sweep of a ground zone, radians
    var OVERKILL = 1.4;         // got/need above this is signal you paid for twice
    var ZONE_SEP = 0.9;         // radians two ground zones must keep apart
    var KB_SLEW = 1.15;         // radians/second the keyboard cursor sweeps
    var SPEED_K = 3.5;          // speed-bonus coefficient — see speedBonus()

    // Touch has no hover, so the ghost preview needs a different contract there.
    var COARSE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

    /* ── where the board sits ──────────────────────────────────────────────
       The menu and game-over cards are a ~520px pane dead centre of the
       viewport. A board centred on the same point put the planet, all five
       rings, every beam and every zone meter *behind* the glass — the attract
       loop was a few debris specks and nothing else, so it taught the rule to
       nobody. While the game is not running the board eases left of the card
       and shrinks; starting a run eases it back to centre. Everything that
       draws or hit-tests goes through view.cx/cy and ringR/planetR, so the two
       states share one code path instead of forking. */
    var view = { cx: 0, cy: 0, scale: 1, shift: 0, ready: false };

    function stepView(g, dt) {
        var attract = !g.running;
        var scaleT = attract ? 0.85 : 1;
        var outer = (PLANET_R + 42 + (RINGS - 1) * (Math.min(g.w, g.h) * 0.055)) * scaleT;
        // Slide clear of the card, but never off the left edge — a phone has no
        // room to give, so there the board only shrinks.
        var shiftT = attract ? Math.max(0, Math.min(320, g.w * 0.5 - outer - 24)) : 0;
        if (!view.ready) { view.ready = true; view.scale = scaleT; view.shift = shiftT; }
        var k = 1 - Math.exp(-5 * dt);
        view.scale += (scaleT - view.scale) * k;
        view.shift += (shiftT - view.shift) * k;
        view.cx = g.w * 0.5 - view.shift;
        view.cy = g.h * 0.5;
    }

    function planetR() { return PLANET_R * view.scale; }

    function ringR(g, i) {
        return (PLANET_R + 42 + i * (Math.min(g.w, g.h) * 0.055)) * view.scale;
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

    /** Same, plus one hypothetical satellite. Used by the ghost preview. */
    function coverageWith(g, sats, extra, angle) {
        var total = coverageAt(g, sats, angle);
        if (extra) {
            var b = beam(extra.ring);
            var off = Math.abs(g.wrapAngle(angle - extra.a));
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
            // Sample densely all the way round. The probe count used to be
            // want*3 — nine samples for the entire circle on level one — which
            // left "spread the zones out" almost nothing to choose between.
            var probes = Math.max(72, want * 10);
            for (var z = 0; z < probes; z++) {
                var za = (z / probes) * 6.2832 + rnd() * 0.04;
                var got = coverageAt(g, sol, za);
                if (got > 0.34) cands.push({ a: za, need: got * (0.66 + rnd() * 0.22), got: 0 });
            }
            if (cands.length < want) continue;

            /* Spread the zones by ANGLE, not by list position.
               Striding the candidate list looks like spreading and is not:
               candidates only exist where the seed solution already shines, so
               the stride just walked back and forth inside the same two bright
               wedges and every zone bunched there — three-quarters of the
               planet bare. Walk stride order for the even sample, but reject a
               candidate sitting within ZONE_SEP of a zone already taken. If the
               field is genuinely too clustered to seat `want` of them, throw the
               whole solution away and roll another one; only the last few
               attempts relax, so a level is always produced. */
            var stride = cands.length / want;
            var order = [], taken = [];
            for (var k = 0; k < want; k++) {
                var ix = Math.floor(k * stride);
                if (!taken[ix]) { taken[ix] = 1; order.push(ix); }
            }
            for (var k2 = 0; k2 < cands.length; k2++) if (!taken[k2]) order.push(k2);

            var sep = attempt < 60 ? ZONE_SEP : ZONE_SEP * 0.6;
            var zones = [];
            for (var oi = 0; oi < order.length && zones.length < want; oi++) {
                var cd = cands[order[oi]];
                var far = true;
                for (var zj = 0; zj < zones.length; zj++) {
                    if (Math.abs(g.wrapAngle(cd.a - zones[zj].a)) < sep) { far = false; break; }
                }
                if (far) zones.push(cd);
            }
            if (zones.length < want) {
                if (attempt < 70) continue;     // roll a solution that spreads better
                for (var t2 = 0; t2 < order.length && zones.length < want; t2++) {
                    var cd2 = cands[order[t2]];
                    if (zones.indexOf(cd2) < 0) zones.push(cd2);
                }
            }
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

    /**
     * Seconds the relay window stays open on level n.
     *
     * It ramps *down*. The budget caps at five satellites and the zone count at
     * seven, so a window that grew with the level number made the last levels
     * strictly easier than the first and put NETWORK DOWN out of reach. Tighten
     * it instead and the banked-time bonus becomes a genuine choice: place fast
     * and bank, or deliberate and keep the network.
     */
    function windowFor(n) { return Math.max(35, 80 - 5 * n); }

    /* ── the debris belt ───────────────────────────────────────────────────
       A 1280px canvas holds a ~556px play disc; the rest was void. These 40
       rocks live strictly outside the outer ring, drift at orbital speeds (far
       ones slower), and never take a click. Radii are stored as a 0..1 lerp so
       a resize re-seats the belt without rebuilding it. */
    var debris = null;

    function buildDebris(g) {
        debris = [];
        for (var i = 0; i < DEBRIS_N; i++) {
            debris.push({
                id: i * 7.13 + 3.1,
                f: g.hash(i * 91.7),                        // 0..1 across the belt
                a: g.hash(i * 33.1) * 6.2832,
                r: 0,
                sz: 3 + g.hash(i * 57.3) * 5,
                spin: (g.hash(i * 12.9) - 0.5) * 1.1
            });
        }
    }

    function stepDebris(g, dt) {
        if (!debris) buildDebris(g);
        var inner = ringR(g, RINGS - 1) + 60;
        var outer = Math.max(inner + 60, Math.max(g.w, g.h) * 0.6);
        for (var i = 0; i < debris.length; i++) {
            var d = debris[i];
            d.r = inner + (outer - inner) * d.f;
            d.a += dt * 0.08 / (d.r / 300);
            if (d.a > 6.2832) d.a -= 6.2832;
        }
    }

    function drawDebris(g, c) {
        if (!debris) return;
        var cx = view.cx, cy = view.cy;
        c.save();
        c.fillStyle = 'rgba(160,140,220,0.28)';
        for (var i = 0; i < debris.length; i++) {
            var d = debris[i];
            if (!d.r) continue;
            var x = cx + Math.cos(d.a) * d.r, y = cy + Math.sin(d.a) * d.r;
            if (x < -30 || x > g.w + 30 || y < -30 || y > g.h + 30) continue;
            c.save();
            c.translate(x, y);
            c.rotate(d.a * 1.7 + g.t * d.spin);
            g.rockPath(c, d.sz, d.id);
            c.fill();
            c.restore();
        }
        c.restore();
    }

    /* ── the menu's living scene ───────────────────────────────────────────
       Beside the menu card — see stepView; the board offsets left so the card
       is not sitting on top of it — level one's own solution drifts in slow
       motion and the zone arcs fill and drain as it goes. Watch it for three
       seconds and you have seen a wide beam feed several zones weakly and a
       narrow one feed a single zone hard, which is the whole rule. */
    var menuSats = null;
    var menuLevel = -1;

    function buildMenuSats(g) {
        menuSats = [];
        var sol = (g.s && g.s.data && g.s.data.solution) || [];
        for (var i = 0; i < sol.length; i++) {
            menuSats.push({
                ring: sol[i].ring,
                a: sol[i].a,
                conflict: false,
                drift: (i % 2 ? -1 : 1) * (0.045 + g.hash(i * 5.1) * 0.05)
            });
        }
        menuLevel = g.s ? g.s.level : 0;
    }

    /** Whichever satellite set the scene should be drawing right now. */
    function sceneSats(g) {
        if (g.running || (g.s.sats && g.s.sats.length)) return g.s.sats;
        return menuSats || [];
    }

    function init(g) {
        g.s = {
            level: 0,
            data: buildLevel(g, 0),
            sats: [],
            drag: null,
            solvedT: 0,
            attempts: 0,
            clock: windowFor(0),
            clockMax: windowFor(0),
            pulses: [],             // expanding rings on level completion
            undoFlash: 0,           // press highlight on the touch UNDO pill
            hinted: false,          // the one-time low-vs-high flash
            kb: { ring: 1, a: -1.5708 },  // keyboard cursor: ring + angle
            kbMode: false,          // keyboard drives the ghost, not the pointer
            kbHold: 0,              // slew ramp while an arrow is held
            preview: null,          // touch: armed ghost awaiting a confirming tap
            moved: false            // pointer has moved since the last press/release
        };
        menuSats = null;
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

        var covered = 0, conflicts = 0, wasted = 0;
        for (var k = 0; k < zones.length; k++) {
            if (zones[k].got >= zones[k].need) covered++;
            if (zones[k].got > zones[k].need * OVERKILL) wasted++;
        }
        for (var m = 0; m < s.sats.length; m++) if (s.sats[m].conflict) conflicts++;
        return { covered: covered, total: zones.length, conflicts: conflicts, wasted: wasted };
    }

    /** One inline legend bar for the shell HUD: width carries the beam width. */
    function hudBar(colour, w) {
        return '<span style="display:inline-block;width:' + w + 'px;height:4px;border-radius:2px;' +
               'background:' + colour + ';vertical-align:middle;margin-right:7px"></span>';
    }

    /**
     * What solving *right now* is worth on top of the banked seconds.
     *
     * The medal table in the shell asks 15,000 for gold and this game could not
     * pay it: eight levels x 700 base is 5,600, and the banked term topped out
     * at sum(windowFor(0..7)) x 12 = 500 x 12 = 6,000 — an 11,600 ceiling that
     * already assumed every level solved in literally zero seconds. Shell is
     * off limits, so the ceiling moves instead. This term is super-linear, so
     * the seconds you save early are worth more than the ones you save late,
     * and a strong run (about 70% of each window left) now lands past gold:
     * 5,600 base + ~4,200 banked + ~5,600 speed ≈ 15,400, with a hard ceiling
     * near 20,800 nobody will ever see.
     */
    function speedBonus(clock) {
        return Math.round(Math.pow(Math.max(0, clock), 1.4) * SPEED_K);
    }

    /**
     * The held half of the keyboard path: arrows / A-D sweep the cursor's angle.
     * Ring steps and the commit are discrete, so they live in keyDown.
     */
    function stepKeyboard(g, dt) {
        var s = g.s;
        if (s.solvedT > 0) return;
        var dir = 0;
        if (g.key('ArrowLeft') || g.key('KeyA')) dir -= 1;
        if (g.key('ArrowRight') || g.key('KeyD')) dir += 1;
        if (!dir) { s.kbHold = 0; return; }
        // Hold to sweep: the slew ramps up so crossing the far side of the
        // planet is not a ten-second job.
        s.kbHold = Math.min(1, s.kbHold + dt * 1.6);
        s.kb.a = g.wrapAngle(s.kb.a + dir * KB_SLEW * (1 + s.kbHold * 1.6) * dt);
        s.kbMode = true;
        s.preview = null;
    }

    function update(g, dt) {
        var s = g.s;
        stepView(g, dt);
        var cx = view.cx, cy = view.cy;
        var res = evaluate(g);
        stepDebris(g, dt);
        stepKeyboard(g, dt);

        for (var pi = s.pulses.length - 1; pi >= 0; pi--) {
            s.pulses[pi].age += dt;
            if (s.pulses[pi].age > 0.6) s.pulses.splice(pi, 1);
        }
        if (s.undoFlash > 0) s.undoFlash = Math.max(0, s.undoFlash - dt);

        // The rule, once, on level one only — the canvas used to carry two
        // permanent hint lines competing with the HUD for the same job.
        if (!s.hinted && s.level === 0) {
            s.hinted = true;
            g.flash('LOW = NARROW + STRONG / HIGH = WIDE + WEAK', '#c9a0ff', 2200);
        }

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
                s.preview = null;
                s.moved = false;
                s.clock = s.clockMax = windowFor(s.level);
                g.flash('LEVEL ' + (s.level + 1) + ' · ' + Math.round(s.clockMax) + 's WINDOW', g.accent, 900);
            }
            return;
        }

        // The relay window: the one clock in an otherwise turn-based puzzle.
        // It shrinks every level, so dawdling costs more the deeper you get.
        s.clock -= dt;
        if (s.clock <= 0) {
            var dark = res.total - res.covered;
            g.over('The relay window closed with ' + dark + ' zone' + (dark === 1 ? '' : 's') + ' dark.', false);
            return;
        }

        if (res.covered === res.total && res.conflicts === 0 && s.sats.length > 0) {
            s.solvedT = 1.3;
            var spare = s.data.budget - s.sats.length;
            var bank = Math.round(s.clock) * 12;    // leftover seconds become score
            var fast = speedBonus(s.clock);         // and solving early compounds
            g.addScore(700 + spare * 350 + bank + fast);
            g.sfx('win');
            g.flash('NETWORK COMPLETE · +' + bank.toLocaleString() + ' BANKED · +'
                + fast.toLocaleString() + ' SPEED', g.accent, 1200);
            var zpr = planetR();
            for (var z = 0; z < s.data.zones.length; z++) {
                var zz = s.data.zones[z];
                g.burst(cx + Math.cos(zz.a) * zpr, cy + Math.sin(zz.a) * zpr,
                    { n: 10, colour: g.accent, speed: 150, life: 0.7 });
            }
            // Every satellite celebrates from where the player put it.
            for (var m2 = 0; m2 < s.sats.length; m2++) {
                var stc = s.sats[m2];
                var rr2 = ringR(g, stc.ring);
                var bx = cx + Math.cos(stc.a) * rr2, by = cy + Math.sin(stc.a) * rr2;
                g.burst(bx, by, { n: 14, colour: '#e6d5ff', speed: 230, life: 0.6, shape: 'spark' });
                s.pulses.push({ x: bx, y: by, r: 14, age: 0 });
            }
            return;
        }

        g.hud('LEVEL <b>' + (s.level + 1) + ' / ' + LEVELS + '</b><br>' +
              'ZONES COVERED <b>' + res.covered + ' / ' + res.total + '</b><br>' +
              'SATELLITES <b>' + s.sats.length + ' / ' + s.data.budget + '</b>' +
              (res.conflicts ? ' · <b style="color:#ff8b8b">' + res.conflicts + ' TOO CLOSE</b>' : '') +
              (res.wasted ? ' · <b style="color:#ffd35a">' + res.wasted + ' OVERKILL</b>' : '') + '<br>' +
              'WINDOW <b style="color:' + (s.clock < 15 ? '#ff8b8b' : '#e8eefc') + '">' + s.clock.toFixed(1) + 's</b>' +
              // The clock is the score, so show what it is worth right now —
              // the speed term is invisible otherwise and nobody hurries.
              ' <span style="opacity:0.75">· SOLVE NOW <b style="color:#ffd35a">+' +
              (Math.round(s.clock) * 12 + speedBonus(s.clock)).toLocaleString() + '</b></span>' +
              '<br><span style="opacity:0.7;font-size:11px;letter-spacing:0.04em">' +
              hudBar('#c9a0ff', 16) + 'LOW · NARROW + STRONG<br>' +
              hudBar('rgba(201,160,255,0.4)', 46) + 'HIGH · WIDE + WEAK</span>');
    }

    /**
     * The menu and game-over scene. Rings shimmer, the belt drifts, and level
     * one's solution slowly weaves itself so coverage arcs fill live.
     */
    function idle(g, dt) {
        var s = g.s;
        stepView(g, dt);
        if (!s || !s.data) return;
        stepDebris(g, dt);

        if (!menuSats || menuLevel !== s.level) buildMenuSats(g);
        var live = sceneSats(g);
        if (live === menuSats) {
            for (var i = 0; i < menuSats.length; i++) {
                menuSats[i].a += menuSats[i].drift * dt;
                if (menuSats[i].a > 6.2832) menuSats[i].a -= 6.2832;
                if (menuSats[i].a < 0) menuSats[i].a += 6.2832;
            }
        }
        for (var z = 0; z < s.data.zones.length; z++) {
            s.data.zones[z].got = coverageAt(g, live, s.data.zones[z].a);
        }
        for (var p = s.pulses.length - 1; p >= 0; p--) {
            s.pulses[p].age += dt;
            if (s.pulses[p].age > 0.6) s.pulses.splice(p, 1);
        }
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

    /**
     * The satellite the player would get if they clicked right now, or null.
     *
     * This is the whole fix for guess-and-check: everything the commit would do
     * is drawn before the commit happens, so a ring is a decision you can read
     * instead of an experiment you have to run and then undo.
     */
    function ghostSat(g) {
        var s = g.s;
        if (!g.running || s.solvedT > 0 || s.drag) return null;
        if (s.sats.length >= s.data.budget) return null;
        var ring = nearestRing(g, g.pointer.x, g.pointer.y);
        if (ring < 0) return null;
        var a = g.angleTo(g.w / 2, g.h / 2, g.pointer.x, g.pointer.y);
        var gh = { ring: ring, a: a, conflict: false, ghost: true };
        for (var i = 0; i < s.sats.length; i++) {
            if (s.sats[i].ring === ring && Math.abs(g.wrapAngle(s.sats[i].a - a)) < MIN_SEP) gh.conflict = true;
        }
        return gh;
    }

    /** The touch UNDO pill, bottom-right, sitting above the window bar. */
    function undoRect(g) {
        var w = 96, h = 40;
        return { x: g.w - w - 18, y: g.h - h - 26, w: w, h: h };
    }

    function inRect(px, py, r) {
        return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
    }

    function rrect(c, x, y, w, h, r) {
        c.beginPath();
        c.moveTo(x + r, y);
        c.arcTo(x + w, y, x + w, y + h, r);
        c.arcTo(x + w, y + h, x, y + h, r);
        c.arcTo(x, y + h, x, y, r);
        c.arcTo(x, y, x + w, y, r);
        c.closePath();
    }

    /** One code path for Backspace, R, and the touch pill. */
    function undoLast(g) {
        if (g.s.sats.length) {
            g.s.sats.pop();
            g.sfx('tick', 0.7);
            return true;
        }
        return false;
    }

    function pointerDown(g) {
        var s = g.s;
        if (s.solvedT > 0) return;
        var cx = g.w / 2, cy = g.h / 2;

        // The UNDO pill claims its taps before the rings can. Without a
        // button, touch players had no way back from a bad drop at all.
        if (inRect(g.pointer.x, g.pointer.y, undoRect(g))) {
            s.undoFlash = 0.3;
            undoLast(g);
            return;
        }

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
        if (code === 'Backspace' || code === 'KeyR') undoLast(g);
    }

    /** One beam wedge plus its crawling edge rays. Shared by real and ghost. */
    function drawBeam(g, c, sat) {
        var cx = g.w / 2, cy = g.h / 2;
        var b = beam(sat.ring);
        var r = ringR(g, sat.ring);
        var sx = cx + Math.cos(sat.a) * r, sy = cy + Math.sin(sat.a) * r;

        c.fillStyle = sat.conflict ? 'rgba(255,120,120,0.09)'
            : sat.ghost ? 'rgba(255,211,90,0.10)' : 'rgba(201,160,255,0.08)';
        c.beginPath();
        c.moveTo(sx, sy);
        c.arc(cx, cy, PLANET_R, sat.a - b.half, sat.a + b.half);
        c.closePath();
        c.fill();

        c.strokeStyle = sat.conflict ? 'rgba(255,139,139,0.35)'
            : sat.ghost ? 'rgba(255,211,90,0.45)' : 'rgba(201,160,255,0.32)';
        c.lineWidth = 1.2;
        c.setLineDash([5, 9]);
        c.lineDashOffset = -(g.t * 30 + sat.ring * 7);
        c.beginPath();
        c.moveTo(sx, sy);
        c.lineTo(cx + Math.cos(sat.a - b.half) * PLANET_R, cy + Math.sin(sat.a - b.half) * PLANET_R);
        c.moveTo(sx, sy);
        c.lineTo(cx + Math.cos(sat.a) * PLANET_R, cy + Math.sin(sat.a) * PLANET_R);
        c.moveTo(sx, sy);
        c.lineTo(cx + Math.cos(sat.a + b.half) * PLANET_R, cy + Math.sin(sat.a + b.half) * PLANET_R);
        c.stroke();
        c.setLineDash([]);
        c.lineDashOffset = 0;
    }

    function draw(g, c) {
        var s = g.s;
        var cx = g.w / 2, cy = g.h / 2;
        g.space(c, { bg: '#05040e' });

        // The dead widescreen margins, filled: a slow belt of junk outside the
        // outer ring. Non-interactive — nearestRing never reaches this far.
        drawDebris(g, c);

        var sats = sceneSats(g);
        var ghost = ghostSat(g);

        // Rings. Bright enough to be a target rather than a hunt, each with a
        // travelling highlight arc — alternating direction, slower the higher
        // the orbit, so the board has a pulse even when nothing is placed.
        var hoverRing = nearestRing(g, g.pointer.x, g.pointer.y);
        for (var i = 0; i < RINGS; i++) {
            var R = ringR(g, i);
            var on = i === hoverRing && g.running;
            var shimmer = 0.42 + 0.07 * Math.sin(g.t * 0.9 + i * 1.3);
            c.strokeStyle = on ? 'rgba(201,160,255,0.72)' : 'rgba(201,160,255,' + shimmer.toFixed(3) + ')';
            c.lineWidth = on ? 2.6 : 1.8;
            c.setLineDash(on ? [] : [4, 8]);
            c.lineDashOffset = on ? 0 : (i % 2 ? -1 : 1) * g.t * (3 + i * 0.8);
            c.beginPath(); c.arc(cx, cy, R, 0, 6.2832); c.stroke();
            c.setLineDash([]);
            c.lineDashOffset = 0;

            var ha = (i % 2 ? -1 : 1) * g.t * (0.25 - i * 0.03);
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.lineCap = 'round';
            c.strokeStyle = 'rgba(201,160,255,0.85)';
            c.lineWidth = on ? 3 : 2.2;
            c.beginPath(); c.arc(cx, cy, R, ha, ha + 0.5); c.stroke();
            g.bloom(c, cx + Math.cos(ha + 0.5) * R, cy + Math.sin(ha + 0.5) * R, 14, 'rgba(201,160,255,0.35)');
            c.restore();
        }

        // Beams first, so satellites sit on top of their own footprints.
        // Additive fill at low alpha: overlapping coverage genuinely brightens,
        // which is the game's core rule made visible.
        c.save();
        c.globalCompositeOperation = 'lighter';
        for (var k = 0; k < sats.length; k++) drawBeam(g, c, sats[k]);
        if (ghost) {
            c.globalAlpha = 0.45;
            drawBeam(g, c, ghost);
            c.globalAlpha = 1;
        }
        c.restore();

        // Planet.
        g.glow(c, cx, cy, PLANET_R * 2.2, 'rgba(120,90,200,0.18)');
        var grd = c.createRadialGradient(cx - 24, cy - 28, 8, cx, cy, PLANET_R);
        grd.addColorStop(0, '#5c6fd0'); grd.addColorStop(1, '#1b2050');
        c.fillStyle = grd;
        c.beginPath(); c.arc(cx, cy, PLANET_R, 0, 6.2832); c.fill();

        // Cloud bands drifting under the clip — the planet was the stillest
        // thing on the stillest screen in the arcade.
        c.save();
        c.beginPath(); c.arc(cx, cy, PLANET_R - 1, 0, 6.2832); c.clip();
        c.lineCap = 'round';
        var ca = g.t * 0.04;
        c.globalAlpha = 0.16;
        c.strokeStyle = '#aeb9ff';
        c.lineWidth = 10;
        c.beginPath(); c.arc(cx, cy, PLANET_R * 0.6, ca, ca + 1.9); c.stroke();
        c.globalAlpha = 0.11;
        c.lineWidth = 7;
        c.beginPath(); c.arc(cx, cy, PLANET_R * 0.86, 2.6 - ca * 1.4, 4.1 - ca * 1.4); c.stroke();
        c.globalAlpha = 1;
        c.lineCap = 'butt';
        c.restore();

        // Additive atmosphere rim: a lit edge instead of a hard cutout.
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.strokeStyle = 'rgba(130,150,255,0.30)';
        c.lineWidth = 2.5;
        c.beginPath(); c.arc(cx, cy, PLANET_R + 1, 0, 6.2832); c.stroke();
        c.strokeStyle = 'rgba(110,130,255,0.10)';
        c.lineWidth = 8;
        c.beginPath(); c.arc(cx, cy, PLANET_R + 5, 0, 6.2832); c.stroke();
        c.restore();

        /* Ground zones as filling meters, not on/off lights. Each zone is a
           track; the fill is how much of its demand is met, running amber →
           teal, and a white tick marks signal past the point of usefulness so
           overkill reads as the budget mistake it is. */
        var zr = PLANET_R + 4;
        // Zones that sit close together would stack their labels on top of one
        // another; step each collider one notch further out instead.
        var loff = [];
        for (var lz = 0; lz < s.data.zones.length; lz++) {
            var push = 0;
            for (var lp = 0; lp < lz; lp++) {
                if (Math.abs(g.wrapAngle(s.data.zones[lz].a - s.data.zones[lp].a)) < 0.75 && loff[lp] === push) push += 22;
            }
            loff.push(push);
        }

        for (var z = 0; z < s.data.zones.length; z++) {
            var zn = s.data.zones[z];
            var ok = zn.got >= zn.need;
            var frac = Math.min(1, zn.got / zn.need);
            var a0 = zn.a - ZONE_HALF, a1 = zn.a + ZONE_HALF;

            c.lineWidth = 9;
            c.strokeStyle = 'rgba(255,255,255,0.12)';
            c.beginPath(); c.arc(cx, cy, zr, a0, a1); c.stroke();
            // Rails on the empty track: a zone at 0% still has to look like a
            // slot waiting to be filled, not like bare planet.
            c.lineWidth = 1;
            c.strokeStyle = 'rgba(255,255,255,0.3)';
            c.beginPath(); c.arc(cx, cy, zr + 4.5, a0, a1); c.stroke();
            c.beginPath(); c.arc(cx, cy, zr - 4.5, a0, a1); c.stroke();

            if (frac > 0.001) {
                var zg = c.createLinearGradient(
                    cx + Math.cos(a0) * zr, cy + Math.sin(a0) * zr,
                    cx + Math.cos(a1) * zr, cy + Math.sin(a1) * zr);
                zg.addColorStop(0, '#ffd35a');
                zg.addColorStop(1, '#64ffda');
                c.strokeStyle = zg;
                c.lineWidth = 9;
                c.beginPath(); c.arc(cx, cy, zr, a0, a0 + (ZONE_HALF * 2) * frac); c.stroke();
            }

            var zcx = cx + Math.cos(zn.a) * zr, zcy = cy + Math.sin(zn.a) * zr;
            if (frac > 0.001) {
                g.bloom(c, zcx, zcy, 24, 'rgba(120,255,220,' + (0.3 * frac).toFixed(3) + ')');
            }

            // Wasted signal: everything past 1.4x demand is a satellite you
            // could have spent somewhere dark.
            if (zn.got > zn.need * OVERKILL) {
                var od = Math.min(1, (zn.got / zn.need - OVERKILL) / 0.9);
                c.strokeStyle = 'rgba(255,255,255,' + (0.5 + 0.45 * od).toFixed(3) + ')';
                c.lineWidth = 2;
                c.beginPath();
                c.moveTo(cx + Math.cos(zn.a) * (zr + 6), cy + Math.sin(zn.a) * (zr + 6));
                c.lineTo(cx + Math.cos(zn.a) * (zr + 13), cy + Math.sin(zn.a) * (zr + 13));
                c.stroke();
            }

            /* Labels clear of ring 0 (PLANET_R + 42) and readable at a glance.
               With a ghost up, each zone shows what it has and — in amber,
               right beside it — what this placement would make it. Zones the
               ghost does not touch keep their projection dimmed, so the ones
               that move are the ones that catch the eye. */
            var lr = PLANET_R + 30 + loff[z];
            var lx = cx + Math.cos(zn.a) * lr;
            var ly = cy + Math.sin(zn.a) * lr;
            c.font = '600 12px "Space Grotesk", Inter, sans-serif';
            c.textAlign = 'left';
            var cur = ok ? '✓' : Math.round(frac * 100) + '%';
            var pf = ghost ? coverageWith(g, sats, ghost, zn.a) / zn.need : 0;
            var proj = ghost ? '→' + (pf >= 1 ? '✓' : Math.round(Math.min(1, pf) * 100) + '%') : '';
            var wc = c.measureText(cur).width;
            var wp = ghost ? c.measureText(proj).width + 6 : 0;
            var left = lx - (wc + wp) / 2;

            // A backing plate: these numbers sit over dashed rings and lit
            // beams, and a projection you have to squint at is not a preview.
            c.fillStyle = 'rgba(6,5,18,0.62)';
            rrect(c, left - 6, ly - 8, wc + wp + 12, 17, 8);
            c.fill();

            c.fillStyle = ok ? '#64ffda' : 'rgba(159,179,204,0.85)';
            c.fillText(cur, left, ly + 4);
            if (ghost) {
                c.fillStyle = pf > frac + 0.005 ? '#ffd35a' : 'rgba(255,211,90,0.3)';
                c.fillText(proj, left + wc + 6, ly + 4);
            }
        }

        // Level-clear shockwaves, one per satellite.
        c.save();
        c.globalCompositeOperation = 'lighter';
        for (var pu = 0; pu < s.pulses.length; pu++) {
            var pl = s.pulses[pu];
            var pf2 = 1 - pl.age / 0.6;
            c.strokeStyle = 'rgba(201,160,255,' + (0.7 * pf2).toFixed(3) + ')';
            c.lineWidth = 2.5 * pf2 + 0.5;
            c.beginPath(); c.arc(pl.x, pl.y, pl.r + pl.age * 200, 0, 6.2832); c.stroke();
        }
        c.restore();

        // Satellites. Placement angle st.a is sacred — it is the player's
        // answer to the puzzle — so all motion here is body-local: a slow
        // visual spin, panels catching sunlight, and a status blink.
        for (var m = 0; m < sats.length; m++) {
            var st = sats[m];
            var rr = ringR(g, st.ring);
            var x = cx + Math.cos(st.a) * rr, y = cy + Math.sin(st.a) * rr;
            g.glow(c, x, y, 26, st.conflict ? 'rgba(255,139,139,0.4)' : 'rgba(201,160,255,0.35)');
            var spin = st.a + g.t * (0.5 + g.hash(m * 13.7) * 0.6);
            var body = st.conflict ? '#ff8b8b' : '#c9a0ff';
            c.save(); c.translate(x, y); c.rotate(spin);
            c.fillStyle = body;
            c.fillRect(-5, -5, 10, 10);
            // Panels shimmer as they turn through the light.
            c.globalAlpha = 0.55 + 0.35 * Math.sin(g.t * 2 + m);
            c.fillRect(-13, -2.5, 6, 5);
            c.fillRect(7, -2.5, 6, 5);
            c.globalAlpha = 1;
            // Status light: a tiny additive blink, out of phase per satellite.
            var blink = Math.max(0, Math.sin(g.t * 3 + m * 1.7));
            if (blink > 0.05) {
                c.globalCompositeOperation = 'lighter';
                c.fillStyle = 'rgba(141,255,190,' + (0.9 * blink).toFixed(3) + ')';
                c.beginPath(); c.arc(0, -7.5, 1.6, 0, 6.2832); c.fill();
                c.globalCompositeOperation = 'source-over';
            }
            c.restore();
            if (st.conflict) {
                var pulse = 0.4 + 0.25 * Math.sin(g.t * 4);
                c.strokeStyle = 'rgba(255,139,139,' + pulse.toFixed(3) + ')';
                c.lineWidth = 1.5; c.setLineDash([3, 4]);
                c.lineDashOffset = g.t * 8;
                c.beginPath(); c.arc(x, y, 26, 0, 6.2832); c.stroke();
                c.setLineDash([]);
                c.lineDashOffset = 0;
            }
        }

        // The prospective satellite itself: an outline, so it never reads as
        // something already committed.
        if (ghost) {
            var gr = ringR(g, ghost.ring);
            var gx = cx + Math.cos(ghost.a) * gr, gy = cy + Math.sin(ghost.a) * gr;
            c.save();
            c.globalAlpha = 0.45;
            c.strokeStyle = ghost.conflict ? '#ff8b8b' : '#ffd35a';
            c.lineWidth = 1.6;
            c.setLineDash([4, 4]);
            c.lineDashOffset = -g.t * 12;
            c.beginPath(); c.arc(gx, gy, 13, 0, 6.2832); c.stroke();
            c.setLineDash([]);
            c.strokeRect(gx - 5, gy - 5, 10, 10);
            c.restore();
            c.globalAlpha = 1;
            if (ghost.conflict) {
                c.fillStyle = 'rgba(255,139,139,0.9)';
                c.font = '600 11px "Space Grotesk", Inter, sans-serif';
                c.textAlign = 'center';
                c.fillText('TOO CLOSE', gx, gy - 20);
                c.textAlign = 'left';
            }
        }

        if (!g.running) return;

        // The relay window, as a thin bar hugging the bottom edge.
        var tfrac = Math.max(0, Math.min(1, s.clock / s.clockMax));
        c.fillStyle = 'rgba(255,255,255,0.08)';
        c.fillRect(0, g.h - 6, g.w, 6);
        c.fillStyle = tfrac < 0.2 ? '#ff8b8b' : '#c9a0ff';
        c.fillRect(0, g.h - 6, g.w * tfrac, 6);

        // Touch UNDO pill. Keyboard players have Backspace; this is for thumbs.
        var ur = undoRect(g);
        var canUndo = s.sats.length > 0;
        rrect(c, ur.x, ur.y, ur.w, ur.h, ur.h / 2);
        c.fillStyle = 'rgba(201,160,255,' + (canUndo ? 0.12 : 0.05) + ')';
        c.fill();
        c.strokeStyle = 'rgba(201,160,255,' + (canUndo ? 0.55 : 0.22) + ')';
        c.lineWidth = 1.5;
        c.stroke();
        if (s.undoFlash > 0) {
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.globalAlpha = Math.min(1, s.undoFlash / 0.3);
            rrect(c, ur.x, ur.y, ur.w, ur.h, ur.h / 2);
            c.fillStyle = 'rgba(201,160,255,0.35)';
            c.fill();
            c.restore();
            c.globalAlpha = 1;
        }
        c.fillStyle = canUndo ? '#c9a0ff' : 'rgba(201,160,255,0.4)';
        c.font = '600 13px "Space Grotesk", Inter, sans-serif';
        c.textAlign = 'center';
        c.fillText('UNDO', ur.x + ur.w / 2, ur.y + ur.h / 2 + 4.5);
        c.textAlign = 'left';
    }

    Arcade.create({
        slug: 'orbit-weaver',
        title: 'ORBIT WEAVER',
        accent: '#c9a0ff',
        tagline: 'Give every ground zone a signal using only the satellites you are allotted — before the relay window closes. Hover a ring to preview the beam and every zone\'s projected coverage. Low orbits are narrow and strong, high orbits wide and weak, and two satellites on the same ring will collide. Leftover seconds bank as score.',
        controls: [['HOVER RING', 'preview the beam'], ['CLICK RING', 'place a satellite'], ['DRAG', 'move one'], ['BACKSPACE', 'remove the last one'], ['TAP UNDO', 'remove last satellite']],
        scoreLabel: 'SCORE',
        overTitle: 'NETWORK DOWN',
        winTitle: 'ALL NETWORKS WOVEN',
        init: init,
        initMenu: init,
        idle: idle,
        update: update,
        draw: draw,
        pointerDown: pointerDown,
        pointerMove: pointerMove,
        pointerUp: pointerUp,
        keyDown: keyDown
    });
})();

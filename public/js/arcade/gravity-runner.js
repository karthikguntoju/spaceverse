/**
 * Gravity Runner — one button, real gravity, near-misses pay.
 *
 * The ship always flies right and always accelerates. Holding thrusts up;
 * releasing lets planets pull. Skimming a planet close builds a multiplier,
 * which is the whole reason to fly dangerously instead of down the middle.
 *
 * Two things the first version got wrong and this one does not:
 *   · the corridor that kills you is now drawn, so the floor is a place on
 *     screen rather than an invisible rule you learn by dying;
 *   · the first two and a half seconds are graced, so the run starts when you
 *     understand the control instead of ending before the first planet lands.
 */
(function () {
    var THRUST = 980;           // px/s^2 upward while held, at BASE_SPEED
    var BASE_SPEED = 300;       // px/s forward at t=0
    var SPEED_GAIN = 11;        // px/s added per second survived
    // Speed used to run away forever: 1,020 px/s at a minute, 3,600 at five,
    // while thrust and the vy clamp stayed where they were. Vertical authority
    // per horizontal metre collapsed and the course flattened into a straight
    // line that was both unreactable and dull. Velocity now stops here and the
    // escalation moves into density — see addPlanet() and eventGap().
    var SPEED_CAP = 1150;
    var CAP_T = (SPEED_CAP - BASE_SPEED) / SPEED_GAIN;   // ~77s in
    var G = 240000;             // gravity constant, tuned by feel not by Newton
    var SKIM = 62;              // extra px beyond a planet's radius that counts as a skim
    var DRIFT = 440;            // constant downward pull once the grace window closes
    var GRACE = 2.5;            // seconds before that drift reaches full strength

    var GAP = 108;              // clearance left beside each planet
    var BAND = 60;              // painted height of the ceiling and floor hazard bands
    var CHEV = 46;              // hazard chevron pitch along those bands
    var MAX_MULT = 20;
    var EVENT_EVERY = 1500;     // metres between field events, early on
    var EVENT_FLOOR = 1100;     // and the tightest that cadence ever gets
    var CALL_MS = 420;          // how long one queued event callout holds the banner

    /** Field-event spacing in world px. Past the speed cap this is the ramp:
        the run gets busier instead of faster. */
    function eventGap(g) {
        return Math.max(EVENT_FLOOR, EVENT_EVERY - Math.max(0, g.t - CAP_T) * 6);
    }

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
     *
     * That guarantee used to have a hole. The radius was rolled against a fixed
     * 92px ceiling and the planet was then clamped on screen; on a landscape
     * phone (g.h about 400-480) the gap band and the planet band overlapped, so
     * the clamp could drag a planet straight back on top of the very gap it had
     * been hung off — an unpassable spawn. The radius is now derived from the
     * room that side of the gap actually has, so the clamp is a formality, and
     * if it ever does fire the gap is recomputed from the FINAL y rather than
     * left pointing at where the planet used to be.
     */
    function spawnPlanet(g, x, prevGapY, reach) {
        // Keep the gap band proportional on short viewports; a flat 120px
        // margin eats a 400px window alive.
        var edge = Math.min(120, g.h * 0.18);
        var gapY = g.clamp(prevGapY + g.rand(-reach, reach), edge, Math.max(edge + 20, g.h - edge));

        // A planet centre sits exactly r + GAP from the gap and must still clear
        // the frame by 14px, so the radius each side can afford is
        // (room - GAP - 14) / 2. Solve for r instead of rolling and clamping.
        var roomUp = (gapY - GAP - 14) / 2;
        var roomDown = (g.h - gapY - GAP - 14) / 2;
        var above;
        if (roomUp >= 22 && roomDown >= 22) above = Math.random() < 0.5;
        else if (roomUp >= 22) above = true;
        else if (roomDown >= 22) above = false;
        else above = roomUp >= roomDown;      // degenerate window: take the better half

        var maxR = Math.max(10, Math.min(92, g.h * 0.26, above ? roomUp : roomDown));
        var r = g.rand(Math.min(28, maxR), maxR);
        var y = above ? gapY - (r + GAP) : gapY + (r + GAP);
        // Formality on any sane viewport; the arbiter of last resort on a tiny
        // one — and whatever it does, the gap follows the planet.
        y = g.clamp(y, r + 14, Math.max(r + 14, g.h - r - 14));
        gapY = g.clamp(above ? y + (r + GAP) : y - (r + GAP), 24, Math.max(30, g.h - 24));
        return {
            x: x, y: y, r: r, gapY: gapY,
            hue: g.pickOne([196, 210, 24, 280, 158, 340]),
            seed: Math.random() * 997,
            skimmed: false, prevD: 1e9,
            ring: Math.random() < 0.34
        };
    }

    function init(g) {
        g.s = {
            ship: { x: g.w * 0.26, y: g.h / 2, vy: 0 },
            camX: 0,
            speed: BASE_SPEED,
            auth: 1,            // vertical-authority multiplier, tracks speed
            planets: [],
            events: [],
            eventN: 0,
            callQ: [],          // pending event callouts, drained one at a time
            callT: 0,
            mult: 1,
            multT: 0,
            multMax: 1,
            trail: [],
            dist: 0,
            grace: GRACE,
            hinted: false,
            thrusting: false,
            neb: [],
            lastGapY: g.h / 2,
            nextX: g.w + 220
        };
        // The shell's own nebulae are anchored to a camera that never comes
        // back, so on a run this long they slide off and the sky goes flat
        // black. These wrap, so the colour survives minute ten.
        var hues = [196, 268, 168];
        for (var n = 0; n < 3; n++) {
            g.s.neb.push({
                wx: g.rand(0, 1) * (g.w + 900),
                fy: g.rand(0.15, 0.85),
                fr: g.rand(0.4, 0.72),
                hue: hues[n] + g.rand(-14, 14),
                a: g.rand(0.09, 0.15),
                sp: g.rand(0.05, 0.09)
            });
        }
        for (var i = 0; i < 7; i++) addPlanet(g);
        // Schedule the first field event past the opening planets so the run has
        // a moment of plain flying before it starts throwing furniture.
        g.s.nextEvent = g.s.nextX + 1200;
    }

    /** Appends one planet at the running spawn cursor and advances it. */
    function addPlanet(g) {
        var s = g.s;
        var late = Math.max(0, g.t - CAP_T);
        // Two ramps. Before the cap the spacing roll tightens with time; after
        // it, velocity has stopped climbing so the floor itself falls and the
        // corridor keeps getting harder without getting faster.
        var floor = Math.max(190, 250 - late * 0.9);
        var spacing = Math.max(floor,
            g.rand(320, 540) - Math.min(140, g.t * 2.6) - Math.min(130, late * 1.5));
        // Reach is what the ship can actually cover in the time the gap takes to
        // arrive — 0.5*a*t^2 with a safety factor — not a constant. Thrust now
        // scales with speed, so the allowed gap delta scales with it too instead
        // of shrinking towards zero and ironing the course flat.
        var cross = spacing / Math.max(240, s.speed);
        var reach = g.clamp(0.34 * THRUST * (s.speed / BASE_SPEED) * cross * cross,
            70, g.h * 0.42);
        var p = spawnPlanet(g, s.nextX, s.lastGapY, reach);
        s.lastGapY = p.gapY;
        s.nextX += spacing;
        s.planets.push(p);
    }

    /* ── field events ──────────────────────────────────────────────────────
       One obstacle type is a demo, not a game. Every 1500m the field hands the
       player something that is not a planet, cycling so all three are seen. The
       spawn cursor is advanced past the event, which is what keeps a pulsar from
       materialising inside a planet. */
    function spawnEvent(g) {
        var s = g.s;
        var x = s.nextX + 140;
        var kind = ['debris', 'pulsar', 'gate'][s.eventN % 3];
        s.eventN++;

        if (kind === 'debris') {
            var rocks = [];
            for (var i = 0; i < 5; i++) {
                rocks.push({
                    x: x + g.rand(0, 300),
                    y: g.rand(90, Math.max(100, g.h - 90)),
                    r: g.rand(9, 17),
                    seed: Math.random() * 997,
                    vx: -g.rand(90, 190),      // on top of the world scroll: fast
                    vy: g.rand(-70, 70),
                    rot: g.rand(0, 6.2832),
                    spin: g.rand(-2.4, 2.4)
                });
            }
            s.events.push({ kind: 'debris', x: x, rocks: rocks, announced: false });
        } else if (kind === 'pulsar') {
            // Scaled to the viewport: a fixed 102px flare spans the entire
            // corridor on a short window, which is death you cannot fly around.
            var base = Math.min(24, g.h * 0.05);
            var amp = Math.min(78, g.h * 0.16);
            s.events.push({
                kind: 'pulsar', x: x + 120,
                y: g.clamp(s.lastGapY + g.rand(-90, 90), 130, Math.max(140, g.h - 130)),
                base: base, amp: amp, kr: base, ph: g.rand(0, 6.2832), announced: false
            });
        } else {
            s.events.push({
                kind: 'gate', x: x + 120,
                y: g.clamp(s.lastGapY + g.rand(-60, 60), 120, Math.max(130, g.h - 120)),
                half: 58, passed: false, missed: false, announced: false
            });
        }
        s.nextX += 420;
    }

    /** Nose attitude. The divisor tracks the vy clamp, which now scales with
        speed — leave it fixed and the hull saturates at ±0.6 late in a run and
        stops reading as a response to anything. */
    function shipRot(g, sh) {
        return g.clamp(sh.vy / (1400 * ((g.s && g.s.auth) || 1)), -0.6, 0.6);
    }

    /** Two circles on the hull instead of one point at the centre, so the thing
        that kills you is the shape you can see. */
    function hullHit(g, sh, cx, cy, rad) {
        var rot = shipRot(g, sh);
        var co = Math.cos(rot), si = Math.sin(rot);
        var nx = sh.x + 13 * co, ny = sh.y + 13 * si;
        if (Math.hypot(nx - cx, ny - cy) < rad + 4.5) return true;
        var tx = sh.x - 9 * co, ty = sh.y - 9 * si;
        return Math.hypot(tx - cx, ty - cy) < rad + 8;
    }

    function die(g, note, colour) {
        var sh = g.s.ship;
        g.burst(sh.x, sh.y, { n: 46, colour: colour || '#ff8b8b', speed: 420, life: 0.9 });
        g.burst(sh.x, sh.y, { n: 22, colour: '#ffd35a', speed: 260 });
        g.burst(sh.x, sh.y, { n: 24, colour: '#fff1c0', speed: 540, life: 0.6, shape: 'spark' });
        g.shake(34);
        g.sfx('boom');
        g.over(note);
    }

    /** A flash the player earned — a skim, a threaded gate. It owns the banner
        for its full duration; queued event callouts wait behind it instead of
        stomping the reward the player just worked for. */
    function say(g, s, text, colour, ms) {
        g.flash(text, colour, ms);
        s.callT = Math.max(s.callT || 0, ms / 1000);
    }

    /** Drains the callout queue one name at a time.
        The old throttle was a flat 2.2s while events arrive every 1500 world px
        — under 1.5s apart past 1,000 px/s — so most pulsars and belts showed up
        unannounced at exactly the speeds where the warning earns its keep. Now
        every event gets its name for CALL_MS; they just take turns. */
    function pumpCalls(g, s, dt) {
        if (s.callT > 0) s.callT -= dt;
        if (s.callT > 0 || !s.callQ.length) return;
        var q = s.callQ.shift();
        g.flash(q.t, q.c, CALL_MS);
        s.callT = CALL_MS / 1000 + 0.06;
    }

    function bumpMult(g, gain) {
        var s = g.s;
        s.mult = Math.min(MAX_MULT, s.mult + (gain || 1));
        // A long streak is only worth protecting if it survives long enough to
        // be worth protecting. The window grows with the streak.
        s.multMax = 2.4 + s.mult * 0.15;
        s.multT = s.multMax;
    }

    /** Runs the event field. `live` is false on the menu, where nothing may kill
        anything and nothing may score. Returns true if the run just ended. */
    function stepEvents(g, dt, live) {
        var s = g.s, sh = s.ship, i, j;
        // Only on a live run: a callout left in the queue when you died has no
        // business firing across the game-over card.
        if (live) pumpCalls(g, s, dt);
        for (i = s.events.length - 1; i >= 0; i--) {
            var e = s.events[i];
            var ex = e.x - s.camX;

            // Queue the name rather than firing it: everything gets announced,
            // in order, and nothing is dropped for arriving in a busy second.
            if (live && !e.announced && ex < g.w + 120) {
                e.announced = true;
                if (e.kind === 'debris') s.callQ.push({ t: 'DEBRIS BELT', c: '#ff8b8b' });
                else if (e.kind === 'pulsar') s.callQ.push({ t: 'PULSAR', c: '#ffb08a' });
                else s.callQ.push({ t: 'GATE — THREAD IT', c: g.accent });
                // A callout for something already behind you is noise, not a
                // warning. Never let the queue run more than two deep.
                while (s.callQ.length > 2) s.callQ.shift();
            }

            if (e.kind === 'debris') {
                for (j = 0; j < e.rocks.length; j++) {
                    var rk = e.rocks[j];
                    rk.x += rk.vx * dt;
                    rk.y += rk.vy * dt;
                    rk.rot += rk.spin * dt;
                    if (rk.y < 58 || rk.y > g.h - 58) rk.vy = -rk.vy;
                    rk.y = g.clamp(rk.y, 58, Math.max(60, g.h - 58));
                    if (live && hullHit(g, sh, rk.x - s.camX, rk.y, rk.r)) {
                        die(g, 'A debris belt found your hull.');
                        return true;
                    }
                }
            } else if (e.kind === 'pulsar') {
                // Cubed sine: quiet most of the cycle, then a short lethal bloom.
                var pu = Math.pow(0.5 + 0.5 * Math.sin(g.t * 2.1 + e.ph), 3);
                e.kr = e.base + e.amp * pu;
                if (live && hullHit(g, sh, ex, e.y, e.kr)) {
                    die(g, 'The pulsar caught you mid-flare.', '#ffb08a');
                    return true;
                }
            } else if (e.kind === 'gate') {
                if (live && !e.passed && ex <= sh.x) {
                    e.passed = true;
                    if (Math.abs(sh.y - e.y) < e.half) {
                        var pay = 200 * s.mult;
                        g.addScore(pay);
                        bumpMult(g, 1);
                        g.sfx('pick', 1 + s.mult * 0.05);
                        say(g, s, 'THREADED +' + pay, g.accent, 620);
                        g.burst(sh.x, sh.y, { n: 18, colour: g.accent, speed: 300, life: 0.6, shape: 'spark' });
                        g.shake(5);
                    } else {
                        e.missed = true;
                        g.sfx('tick', 0.7);
                    }
                }
            }

            if (ex < -420) s.events.splice(i, 1);
        }
        return false;
    }

    /** Trail samples remember the camera they were laid down at, so the wake
        streams behind a ship whose own x never moves. */
    function pushTrail(g, s) {
        var sh = s.ship;
        var maxLen = Math.round(g.clamp(20 + s.speed * 0.05, 20, 44));
        // Recycle the sample that falls off the tail instead of allocating a
        // fresh one every frame; in the steady state this pushes nothing at all
        // onto the heap, which matters at 60Hz for the whole length of a run.
        var node = s.trail.length >= maxLen ? s.trail.shift() : { x: 0, y: 0, cx: 0 };
        node.x = sh.x; node.y = sh.y; node.cx = s.camX;
        s.trail.push(node);
        while (s.trail.length > maxLen) s.trail.shift();
    }

    function recycle(g) {
        var s = g.s;
        for (var j = s.planets.length - 1; j >= 0; j--) {
            if (s.planets[j].x - s.camX < -180) s.planets.splice(j, 1);
        }
        while (s.planets.length < 8) addPlanet(g);
        if (s.nextX >= s.nextEvent) {
            spawnEvent(g);
            s.nextEvent += eventGap(g);
        }
    }

    function update(g, dt) {
        var s = g.s;
        var sh = s.ship;

        if (!s.hinted) {
            s.hinted = true;
            say(g, s, 'HOLD TO CLIMB', g.accent, 1200);
        }

        s.speed = Math.min(SPEED_CAP, BASE_SPEED + g.t * SPEED_GAIN);
        s.camX += s.speed * dt;
        s.dist += s.speed * dt;

        // What matters is vertical authority per horizontal metre. At 1150 px/s
        // the ship crosses a 250px gap in 0.22s, and a fixed 980 px/s^2 buys
        // about 24px of climb in that time — not a game. So every vertical term
        // scales together with speed: thrust, the drift that answers it, gravity,
        // and the clamp on top. Scaling the thrust alone would just turn the late
        // run into a balloon that cannot come back down.
        var auth = s.speed / BASE_SPEED;
        s.auth = auth;

        // Thrust: pointer held, space, or up arrow. All three, because at an expo
        // half the people reach for the mouse and half reach for the keyboard.
        var thrusting = g.pointer.down || g.key('Space') || g.key('ArrowUp') || g.key('KeyW');
        s.thrusting = thrusting;
        sh.vy += (thrusting ? -THRUST * auth : 0) * dt;

        // Constant downward drift so releasing always means falling — but eased
        // in over the grace window. At full strength an idle player hit the floor
        // in about 1.3s, which is before the first planet is even on screen.
        sh.vy += DRIFT * auth * (1 - s.grace / GRACE) * dt;
        if (s.grace > 0) s.grace = Math.max(0, s.grace - dt);

        for (var i = 0; i < s.planets.length; i++) {
            var p = s.planets[i];
            var px = p.x - s.camX;
            var dx = px - sh.x, dy = p.y - sh.y;
            var d2 = dx * dx + dy * dy;
            var d = Math.sqrt(d2);
            if (d < 1) d = 1;
            // Scaled with the rest: at speed you are inside a planet's well for
            // a third as long, so an unscaled pull would stop mattering exactly
            // when the planets are hardest to read.
            var pull = (G * (p.r / 60)) / Math.max(d2, 900) * auth;
            sh.vy += (dy / d) * pull * dt;

            if (hullHit(g, sh, px, p.y, p.r)) {
                die(g, 'You flew into a planet at ' + Math.round(s.speed) + ' px/s.');
                return;
            }

            // Credit the skim at closest approach, not once the planet is safely
            // behind you. The reward is supposed to land on the moment of danger.
            if (!p.skimmed) {
                if (d > p.prevD && p.prevD <= p.r + SKIM) {
                    p.skimmed = true;
                    bumpMult(g, 1);
                    g.addScore(50 * s.mult);
                    g.sfx('blip', 1 + s.mult * 0.05);
                    say(g, s, 'SKIM ×' + s.mult, '#ffd35a', 420);
                    g.burst(sh.x, sh.y, { n: 10, colour: '#ffd35a', speed: 140, life: 0.4 });
                }
                p.prevD = d;
            }
        }

        if (thrusting && Math.random() < 0.7) {
            g.burst(sh.x - 12, sh.y + 3, { n: 1, angle: Math.PI * 0.92, spread: 0.35, speed: 190, colour: '#7aa2ff', life: 0.3, size: 2.2, shape: 'spark' });
        }

        // Riding a hot multiplier: the hull itself starts shedding gold.
        if (s.mult >= 4 && Math.random() < 0.08 + s.mult * 0.02) {
            g.burst(sh.x + g.rand(-9, 4), sh.y + g.rand(-7, 7),
                { n: 1, colour: '#ffd35a', speed: 90, life: 0.45, size: 1.6, shape: 'spark' });
        }

        sh.vy = g.clamp(sh.vy, -720 * auth, 820 * auth);
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

        pushTrail(g, s);

        s.multT -= dt;
        if (s.multT <= 0 && s.mult > 1) { s.mult = 1; s.multT = 0; }

        if (sh.y > g.h - 10) {
            g.burst(sh.x, sh.y, { n: 30, colour: '#ff8b8b', speed: 300 });
            g.burst(sh.x, sh.y, { n: 14, colour: '#ffd35a', speed: 440, life: 0.5, shape: 'spark' });
            g.shake(26);
            g.sfx('boom');
            g.over('You fell out of the corridor.');
            return;
        }

        if (stepEvents(g, dt, true)) return;
        recycle(g);

        g.addScore(s.speed * dt * 0.06 * s.mult);
        // Naming the cap matters: without it the player watching the number stop
        // reads it as the run running out of ramp, when in fact the ramp has
        // moved into how close together the field arrives.
        g.hud('SPEED <b>' + Math.round(s.speed) + (s.speed >= SPEED_CAP ? ' MAX' : '') + '</b>'
            + '<br>MULTIPLIER <b>×' + s.mult + '</b>'
            + '<br>DISTANCE <b>' + (Math.round(s.dist / 100) * 100).toLocaleString() + ' m</b>');
    }

    /* Menu attract loop. The scene flies itself down the corridor so the card
       sits over a live run instead of a freeze-frame. Nothing here can kill or
       score — stepEvents is called with live = false. */
    function idle(g, dt) {
        var s = g.s;
        if (!s || !s.ship || !dt) return;
        var sh = s.ship;

        s.camX += 210 * dt;
        s.thrusting = false;
        // The attract loop flies at a fixed 210 px/s, so the authority multiplier
        // a dead run left behind would only flatten the hull's attitude.
        s.auth = 1;

        var target = g.h / 2, bestDx = 1e9;
        for (var i = 0; i < s.planets.length; i++) {
            var dx = (s.planets[i].x - s.camX) - sh.x;
            if (dx > -40 && dx < bestDx) { bestDx = dx; target = s.planets[i].gapY; }
        }
        var ny = g.lerp(sh.y, target + Math.sin(g.t * 1.6) * 12, Math.min(1, dt * 2.2));
        sh.vy = g.clamp((ny - sh.y) / Math.max(dt, 0.001), -700, 700);
        sh.y = ny;

        pushTrail(g, s);
        stepEvents(g, dt, false);
        recycle(g);
    }

    /* ── drawing ───────────────────────────────────────────────────────── */

    /** The ceiling scrape and the lethal floor, made visible. Most runs used to
        end against a boundary the player had never been shown. */
    function drawCorridor(g, c, s) {
        var w = g.w, h = g.h;
        var prox = g.clamp((120 - (h - s.ship.y)) / 120, 0, 1);
        var floorA = 0.35 + 0.25 * prox;
        var off = -(s.camX % CHEV);
        var x;

        // floor: a gradient wall, hotter the closer you get to it
        var fg = c.createLinearGradient(0, h - BAND, 0, h);
        fg.addColorStop(0, 'rgba(255,139,139,0)');
        fg.addColorStop(1, 'rgba(255,139,139,' + floorA.toFixed(3) + ')');
        c.fillStyle = fg;
        c.fillRect(0, h - BAND, w, BAND);

        // ceiling: cooler, because it only scrapes
        var cg = c.createLinearGradient(0, 0, 0, BAND);
        cg.addColorStop(0, 'rgba(122,162,255,0.22)');
        cg.addColorStop(1, 'rgba(122,162,255,0)');
        c.fillStyle = cg;
        c.fillRect(0, 0, w, BAND);

        // hazard chevrons, offset by the world scroll so the walls move with you
        c.lineWidth = 2;
        c.lineJoin = 'round';
        c.strokeStyle = 'rgba(255,139,139,' + (0.22 + 0.4 * prox).toFixed(3) + ')';
        c.beginPath();
        for (x = off - CHEV; x < w + CHEV; x += CHEV) {
            c.moveTo(x, h - 7);
            c.lineTo(x + CHEV * 0.5, h - 23);
            c.lineTo(x + CHEV, h - 7);
        }
        c.stroke();

        c.strokeStyle = 'rgba(122,162,255,0.20)';
        c.beginPath();
        for (x = off - CHEV; x < w + CHEV; x += CHEV) {
            c.moveTo(x, 7);
            c.lineTo(x + CHEV * 0.5, 23);
            c.lineTo(x + CHEV, 7);
        }
        c.stroke();

        // the two lines that actually matter: kill below, scrape above
        c.strokeStyle = 'rgba(255,139,139,' + (0.45 + 0.45 * prox).toFixed(3) + ')';
        c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(0, h - 10); c.lineTo(w, h - 10); c.stroke();

        c.strokeStyle = 'rgba(122,162,255,0.35)';
        c.setLineDash([10, 8]);
        c.lineDashOffset = -s.camX * 0.5;
        c.lineWidth = 1.2;
        c.beginPath(); c.moveTo(0, 14); c.lineTo(w, 14); c.stroke();
        c.setLineDash([]);
        c.lineDashOffset = 0;
    }

    /** Deep colour wash, parallaxed at a fraction of the world and wrapped so it
        can never run out. Additive, so the shell's stars read straight through. */
    function drawNebula(g, c, s) {
        var P = g.w + 900;
        c.save();
        c.globalCompositeOperation = 'lighter';
        for (var i = 0; i < s.neb.length; i++) {
            var nb = s.neb[i];
            var x = (nb.wx - s.camX * nb.sp) % P;
            if (x < 0) x += P;
            x -= 450;
            var y = nb.fy * g.h + Math.sin(g.t * 0.18 + i) * g.h * 0.04;
            var r = nb.fr * Math.max(g.w, g.h) * 0.5;
            var grd = c.createRadialGradient(x, y, 0, x, y, r);
            grd.addColorStop(0, 'hsla(' + nb.hue + ',70%,55%,' + nb.a.toFixed(3) + ')');
            grd.addColorStop(0.55, 'hsla(' + nb.hue + ',75%,45%,' + (nb.a * 0.4).toFixed(3) + ')');
            grd.addColorStop(1, 'rgba(0,0,0,0)');
            c.fillStyle = grd;
            c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
        }
        c.restore();
    }

    function drawPlanet(g, c, s, p) {
        var px = p.x - s.camX;
        var r = p.r, hue = p.hue;

        g.bloom(c, px, p.y, r * 2.5, 'hsla(' + hue + ',80%,60%,0.16)');

        // back half of the ring first — it belongs behind the sphere
        if (p.ring) {
            c.strokeStyle = 'hsla(' + hue + ',70%,72%,0.3)';
            c.lineWidth = 3;
            c.beginPath();
            c.ellipse(px, p.y, r * 1.75, r * 0.42, -0.4, 0, 6.2832);
            c.stroke();
        }

        var grd = c.createRadialGradient(px - r * 0.35, p.y - r * 0.4, r * 0.1, px, p.y, r);
        grd.addColorStop(0, 'hsl(' + hue + ',72%,68%)');
        grd.addColorStop(0.55, 'hsl(' + hue + ',68%,44%)');
        grd.addColorStop(1, 'hsl(' + hue + ',65%,20%)');
        c.fillStyle = grd;
        c.beginPath(); c.arc(px, p.y, r, 0, 6.2832); c.fill();

        // surface: three latitude bands and a terminator, clipped to the disc
        c.save();
        c.beginPath(); c.arc(px, p.y, r, 0, 6.2832); c.clip();
        c.fillStyle = 'hsla(' + hue + ',60%,20%,0.18)';
        for (var b = 0; b < 3; b++) {
            var by = p.y + (b - 1) * r * 0.44 + Math.sin(p.seed + b * 2.1) * r * 0.07;
            var bh = r * (0.09 + 0.06 * g.hash(p.seed + b));
            c.beginPath(); c.ellipse(px, by, r * 1.04, bh, 0, 0, 6.2832); c.fill();
        }
        var sg = c.createLinearGradient(px - r, p.y - r, px + r, p.y + r);
        sg.addColorStop(0, 'rgba(0,0,0,0)');
        sg.addColorStop(0.5, 'rgba(0,0,0,0)');
        sg.addColorStop(1, 'rgba(3,6,15,0.5)');
        c.fillStyle = sg;
        c.fillRect(px - r, p.y - r, r * 2, r * 2);
        c.restore();

        // lit limb on the upper-left, additive so it reads as light not paint
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.strokeStyle = 'hsla(' + hue + ',90%,80%,0.35)';
        c.lineWidth = r * 0.12;
        c.beginPath();
        c.arc(px, p.y, r * 0.94, Math.PI * 0.95, Math.PI * 1.6);
        c.stroke();
        c.restore();

        // and the front half of the ring last, so it crosses the disc
        if (p.ring) {
            c.strokeStyle = 'hsla(' + hue + ',75%,82%,0.62)';
            c.lineWidth = 3;
            c.beginPath();
            c.ellipse(px, p.y, r * 1.75, r * 0.42, -0.4, 0, Math.PI);
            c.stroke();
        }

        // The skim ring is the game's only teacher: it shows exactly how close
        // "close" is. It now drifts and breathes, because the one element that
        // explains the core risk should not be the stillest thing on screen.
        if (!p.skimmed) {
            var near = Math.hypot(px - s.ship.x, p.y - s.ship.y) < 400;
            var a = near ? 0.18 + 0.14 * Math.sin(g.t * 4) : 0.18;
            c.strokeStyle = 'rgba(255,211,90,' + a.toFixed(3) + ')';
            c.setLineDash([6, 9]);
            c.lineDashOffset = -g.t * 26;
            c.lineWidth = near ? 2 : 1.6;
            c.beginPath(); c.arc(px, p.y, r + SKIM, 0, 6.2832); c.stroke();
            c.setLineDash([]);
            c.lineDashOffset = 0;
        }
    }

    function drawEvents(g, c, s) {
        for (var i = 0; i < s.events.length; i++) {
            var e = s.events[i];
            var ex = e.x - s.camX;

            if (e.kind === 'debris') {
                for (var j = 0; j < e.rocks.length; j++) {
                    var rk = e.rocks[j];
                    var rx = rk.x - s.camX;
                    if (rx < -60 || rx > g.w + 60) continue;
                    g.bloom(c, rx, rk.y, rk.r * 3, 'rgba(255,139,139,0.26)');
                    c.save();
                    c.translate(rx, rk.y);
                    c.rotate(rk.rot);
                    g.rockPath(c, rk.r, rk.seed, 7);
                    var rg = c.createLinearGradient(-rk.r, -rk.r, rk.r, rk.r);
                    rg.addColorStop(0, '#8b93a8');
                    rg.addColorStop(1, '#3a4257');
                    c.fillStyle = rg;
                    c.fill();
                    c.strokeStyle = 'rgba(255,139,139,0.9)';
                    c.lineWidth = 1.8;
                    c.stroke();
                    c.restore();
                }
            } else if (e.kind === 'pulsar') {
                if (ex < -160 || ex > g.w + 200) continue;
                c.strokeStyle = 'rgba(255,139,139,0.16)';
                c.setLineDash([4, 7]);
                c.lineDashOffset = -g.t * 20;
                c.lineWidth = 1.4;
                c.beginPath(); c.arc(ex, e.y, e.base + e.amp, 0, 6.2832); c.stroke();
                c.setLineDash([]);
                c.lineDashOffset = 0;

                // The one lethal interior in the game, and it used to be the one
                // unshaded surface: a flat 10% wash inside a hard 2.5px ring,
                // with no falloff and nothing to say how close the flare was.
                // Now the disc is a graded body of plasma keyed to the charge
                // phase, so it visibly CHARGES rather than merely growing.
                var ch = g.clamp((e.kr - e.base) / Math.max(1, e.amp), 0, 1);
                var core = 0.14 + 0.46 * ch;
                c.save();
                c.globalCompositeOperation = 'lighter';
                var kg = c.createRadialGradient(ex, e.y, 0, ex, e.y, e.kr);
                kg.addColorStop(0, 'rgba(255,242,222,' + (core * 0.85).toFixed(3) + ')');
                // Hottest at ~0.6 of the kill radius: the flare is a shell of
                // plasma, and the rim it kills at is the coolest part of it.
                kg.addColorStop(0.6, 'rgba(255,' + Math.round(168 - 46 * ch) + ','
                    + Math.round(146 - 26 * ch) + ',' + core.toFixed(3) + ')');
                kg.addColorStop(0.88, 'rgba(255,126,120,' + (core * 0.5).toFixed(3) + ')');
                kg.addColorStop(1, 'rgba(255,110,110,' + (core * 0.18).toFixed(3) + ')');
                c.fillStyle = kg;
                c.beginPath(); c.arc(ex, e.y, e.kr, 0, 6.2832); c.fill();
                c.restore();

                g.bloom(c, ex, e.y, e.kr * (1.5 + 0.5 * ch),
                    'rgba(255,139,139,' + (0.16 + 0.2 * ch).toFixed(3) + ')');
                // The rim thickens and brightens with the charge instead of
                // sitting at a constant 2.5px whatever the flare is doing.
                c.strokeStyle = 'rgba(255,' + Math.round(196 - 40 * ch) + ',150,'
                    + (0.34 + 0.56 * ch).toFixed(3) + ')';
                c.lineWidth = 1.2 + 2.2 * ch;
                c.beginPath(); c.arc(ex, e.y, e.kr, 0, 6.2832); c.stroke();
                g.bloom(c, ex, e.y, 22 + 26 * ch,
                    'rgba(255,240,205,' + (0.5 + 0.35 * ch).toFixed(3) + ')');
            } else {
                if (ex < -120 || ex > g.w + 160) continue;
                var a = e.passed ? 0.14 : 0.45 + 0.2 * Math.sin(g.t * 5);
                var col = e.missed ? '255,139,139' : '100,255,218';
                c.save();
                c.globalCompositeOperation = 'lighter';
                var beam = c.createLinearGradient(ex - 9, 0, ex + 9, 0);
                beam.addColorStop(0, 'rgba(' + col + ',0)');
                beam.addColorStop(0.5, 'rgba(' + col + ',' + (a * 0.35).toFixed(3) + ')');
                beam.addColorStop(1, 'rgba(' + col + ',0)');
                c.fillStyle = beam;
                c.fillRect(ex - 9, e.y - e.half, 18, e.half * 2);
                c.strokeStyle = 'rgba(' + col + ',' + a.toFixed(3) + ')';
                c.lineWidth = 3;
                c.lineCap = 'round';
                c.beginPath();
                c.moveTo(ex, e.y - e.half - 24); c.lineTo(ex, e.y - e.half);
                c.moveTo(ex, e.y + e.half); c.lineTo(ex, e.y + e.half + 24);
                c.stroke();
                c.lineCap = 'butt';
                c.restore();
                g.bloom(c, ex, e.y - e.half, 24, 'rgba(' + col + ',0.32)');
                g.bloom(c, ex, e.y + e.half, 24, 'rgba(' + col + ',0.32)');

                if (!e.passed) {
                    c.font = '600 12px "Space Grotesk", Inter, sans-serif';
                    c.textAlign = 'center';
                    c.fillStyle = 'rgba(100,255,218,0.75)';
                    c.fillText('+' + (200 * s.mult), ex, e.y - e.half - 32);
                    c.textAlign = 'left';
                }
            }
        }
    }

    /* One stroked ribbon instead of 26 separate circles stacked on a ship whose
       x never changes — that read as a string of beads, not a wake.

       Everything it needs is hoisted to module scope. The first version built a
       fresh array of up to 44 objects AND a new Path2D on every single frame,
       including while the menu sat idling, which is 60 garbage paths a second
       for a curve that is three floats different from the last one. */
    var TRAIL_W = [8, 4, 1.5];
    var TRAIL_A = [0.10, 0.22, 0.7];
    var trailX = new Float32Array(48);
    var trailY = new Float32Array(48);

    function drawTrail(g, c, s) {
        var n = s.trail.length;
        if (n < 3) return;
        if (n > trailX.length) {
            trailX = new Float32Array(n);
            trailY = new Float32Array(n);
        }
        for (var i = 0; i < n; i++) {
            var t = s.trail[i];
            trailX[i] = t.x - (s.camX - t.cx);
            trailY[i] = t.y;
        }

        c.save();
        c.globalCompositeOperation = 'lighter';
        c.lineCap = 'round';
        c.lineJoin = 'round';
        c.strokeStyle = g.accent;
        // Built straight on the context: stroke() does not consume the current
        // path, so the three widening passes reuse one build for free.
        c.beginPath();
        c.moveTo(trailX[0], trailY[0]);
        for (var k = 1; k < n - 1; k++) {
            c.quadraticCurveTo(trailX[k], trailY[k],
                (trailX[k] + trailX[k + 1]) * 0.5, (trailY[k] + trailY[k + 1]) * 0.5);
        }
        c.lineTo(trailX[n - 1], trailY[n - 1]);
        for (var p = 0; p < 3; p++) {
            c.globalAlpha = TRAIL_A[p];
            c.lineWidth = TRAIL_W[p];
            c.stroke();
        }
        c.restore();
        c.globalAlpha = 1;
    }

    function drawShip(g, c, s) {
        var sh = s.ship;
        g.bloom(c, sh.x, sh.y, 46, 'rgba(100,255,218,0.28)');
        if (s.thrusting) {
            g.bloom(c, sh.x - 14, sh.y + 2, 26 + Math.sin(g.t * 40) * 4, 'rgba(122,162,255,0.4)');
        }
        c.save();
        c.translate(sh.x, sh.y);
        c.rotate(shipRot(g, sh));

        var hull = c.createLinearGradient(-11, -8, 12, 8);
        hull.addColorStop(0, '#bffff0');
        hull.addColorStop(0.5, g.accent);
        hull.addColorStop(1, '#1f9f8b');
        c.fillStyle = hull;
        c.beginPath();
        c.moveTo(15, 0); c.lineTo(-11, -8); c.lineTo(-6, 0); c.lineTo(-11, 8);
        c.closePath(); c.fill();

        c.strokeStyle = 'rgba(255,255,255,0.55)';
        c.lineWidth = 1;
        c.beginPath(); c.moveTo(15, 0); c.lineTo(-11, -8); c.stroke();

        c.fillStyle = '#03060f';
        c.beginPath(); c.ellipse(1.5, -1.4, 3, 1.8, -0.2, 0, 6.2832); c.fill();
        c.restore();

        // multiplier meter, parked on the ship so the streak is read where the
        // eye already is instead of in the corner of the screen
        if (s.mult > 1) {
            var frac = g.clamp(s.multT / Math.max(0.001, s.multMax), 0, 1);
            var gw = 46, gx = sh.x - gw / 2, gy = sh.y - 34;
            c.fillStyle = 'rgba(255,211,90,0.18)';
            c.fillRect(gx, gy, gw, 3);
            c.fillStyle = '#ffd35a';
            c.fillRect(gx, gy, gw * frac, 3);
            c.font = '600 13px "Space Grotesk", Inter, sans-serif';
            c.textAlign = 'center';
            c.fillStyle = 'rgba(255,211,90,0.92)';
            c.fillText('×' + s.mult, sh.x, gy - 5);
            c.textAlign = 'left';
        }
    }

    function draw(g, c) {
        var s = g.s;
        if (!s || !s.ship) { g.space(c); return; }

        // One starfield, not two. The shared backdrop takes the world scroll as
        // camX, so its three parallax layers track the run instead of being
        // undercut by a flatter fourth layer of single-colour dots.
        g.space(c, {
            bg: '#03060f',
            camX: s.camX,
            par: 0.22,
            driftX: 0,
            driftY: 0,
            nebula: false,
            meteors: true
        });
        drawNebula(g, c, s);

        for (var k = 0; k < s.planets.length; k++) {
            var p = s.planets[k];
            var px = p.x - s.camX;
            if (px < -160 - p.r || px > g.w + 200 + p.r) continue;
            drawPlanet(g, c, s, p);
        }

        drawEvents(g, c, s);
        drawCorridor(g, c, s);
        drawTrail(g, c, s);
        drawShip(g, c, s);
    }

    Arcade.create({
        slug: 'gravity-runner',
        title: 'GRAVITY RUNNER',
        accent: '#64ffda',
        tagline: 'One button. You always fly right, always faster. Planets pull you in — skim their dashed ring for a score multiplier, touch one and you are dust. Thread the gates, dodge the belts, time the pulsars. The blue ceiling only scrapes; the red floor does not forgive.',
        controls: [['HOLD', 'thrust upward'], ['RELEASE', 'fall'], ['SPACE / ↑', 'same as hold']],
        scoreLabel: 'SCORE',
        overTitle: 'DUST',
        init: init,
        initMenu: init,
        idle: idle,
        update: update,
        draw: draw
    });
})();

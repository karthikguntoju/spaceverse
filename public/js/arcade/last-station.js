/**
 * Last Station — Missile Command in a gravity well.
 *
 * Rocks spiral in from every edge. Your laser is hitscan with heat, so the
 * decision is never "can I hit it" but "is this the rock worth the heat".
 * Big rocks split when shot, so panic-firing at the biggest thing on screen is
 * the classic way to lose.
 *
 * From wave 3 the loop gains a second verb: the EMP. It costs the entire heat
 * bar — you buy a clear ring around the hull and pay with a laser lockout —
 * which turns "shoot the nearest thing" into "when do I spend the room".
 */
(function () {
    var STATION_R = 34;
    var SHIELD_MAX = 3;
    var HEAT_MAX = 100;
    var HEAT_PER_SHOT = 17;
    var COOL_RATE = 34;         // heat per second bled off
    var OVERHEAT_LOCK = 1.5;    // seconds locked out after redlining
    var BEAM_SLOP = 14;         // beam half-width for the ray hit-test
    var COMBO_WINDOW = 1.5;     // seconds between kills before the chain resets

    var WARN_LEAD = 1.2;        // seconds a chevron burns before its rock arrives
    var EMP_WAVE = 3;           // the wave the second verb unlocks on
    var EMP_R = 180;            // blast radius
    var EMP_FREEZE = 1.5;       // seconds a caught rock is dead in the water
    var EMP_PUSH = 120;         // px/s outward shove
    var EMP_FILL = 11;          // seconds to charge from empty
    var VOLATILE_R = 90;        // chain-kill radius on a volatile rock

    var TIERS = [
        // Tier 0 used to be r:9 in near-accent pink over a pink radar sweep —
        // the fastest tier and the hardest one to see. Bigger, and rimmed.
        { r: 12, hp: 1, split: 0, score: 100, speed: 1.35, col: '#ff8ba7', rim: '#fff1f5' },
        { r: 15, hp: 1, split: 2, score: 60,  speed: 1.0,  col: '#ffb46b' },
        { r: 23, hp: 2, split: 2, score: 40,  speed: 0.78, col: '#c9a0ff' }
    ];

    /** Lighten (f > 0) or darken (f < 0) a #rrggbb toward white / black. */
    function shade(hex, f) {
        var n = parseInt(hex.slice(1), 16);
        var r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
        if (f >= 0) {
            r += (255 - r) * f; gg += (255 - gg) * f; b += (255 - b) * f;
        } else {
            r *= 1 + f; gg *= 1 + f; b *= 1 + f;
        }
        return 'rgb(' + Math.round(r) + ',' + Math.round(gg) + ',' + Math.round(b) + ')';
    }

    /** #rrggbb + alpha → rgba(), so gradients and haloes stay one colour. */
    function rgba(hex, a) {
        var n = parseInt(hex.slice(1), 16);
        return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    }

    function skinOf(col, rim) {
        return {
            col: col, lite: shade(col, 0.45), dark: shade(col, -0.55),
            aura: rgba(col, 0.17), rim: rim || null
        };
    }

    // Precompute the gradient stops once so the draw loop only builds gradients,
    // never colour strings.
    for (var ti = 0; ti < TIERS.length; ti++) {
        TIERS[ti].lite = shade(TIERS[ti].col, 0.45);
        TIERS[ti].dark = shade(TIERS[ti].col, -0.55);
        TIERS[ti].aura = rgba(TIERS[ti].col, 0.17);
    }

    // Two rare variants on the big tier. Both read at a glance before they are
    // in range, which is the point: they change what the correct shot is.
    var ARMOURED = skinOf('#9fb7ff');
    var VOLATILE = skinOf('#ffd35a');

    function rockSkin(r) {
        return r.armoured ? ARMOURED : r.volatile ? VOLATILE : TIERS[r.tier];
    }

    /** Where a ray from the centre leaves the viewport, inset from the edge. */
    function edgePoint(g, a, inset) {
        var dx = Math.cos(a), dy = Math.sin(a);
        var hw = Math.max(20, g.w / 2 - inset), hh = Math.max(20, g.h / 2 - inset);
        var tx = Math.abs(dx) > 1e-4 ? hw / Math.abs(dx) : 1e9;
        var ty = Math.abs(dy) > 1e-4 ? hh / Math.abs(dy) : 1e9;
        var t = Math.min(tx, ty);
        return { x: g.w / 2 + dx * t, y: g.h / 2 + dy * t };
    }

    function spawnRock(g, tier, x, y, dir, opts) {
        var s = g.s;
        var t = TIERS[tier];
        opts = opts || {};
        if (x == null) {
            var a = opts.ang == null ? Math.random() * 6.2832 : opts.ang;
            var rad = Math.min(g.w, g.h) * 0.60;
            x = g.w / 2 + Math.cos(a) * rad;
            y = g.h / 2 + Math.sin(a) * rad;
            dir = g.angleTo(x, y, g.w / 2 + g.rand(-30, 30), g.h / 2 + g.rand(-30, 30));
        }
        var sp = (62 + s.wave * 7) * t.speed * g.rand(0.85, 1.15);
        var rock = {
            x: x, y: y, tier: tier, r: t.r, hp: t.hp,
            vx: Math.cos(dir) * sp, vy: Math.sin(dir) * sp,
            spin: g.rand(-2, 2), rot: Math.random() * 6.28,
            seed: g.rand(0, 100),   // frame-stable silhouette via g.rockPath
            frozen: 0,
            armoured: false, volatile: false,
            // A slight tangential push makes them spiral rather than fall straight,
            // which is the difference between "aim once" and "track".
            curl: g.rand(-0.5, 0.5)
        };
        if (opts.kind === 'armoured') { rock.armoured = true; rock.hp = 4; rock.r = t.r + 2; }
        else if (opts.kind === 'volatile') { rock.volatile = true; }
        s.rocks.push(rock);
        return rock;
    }

    /** Roll the drop table for a wave spawn. Splits never roll — only tier 2. */
    function rollKind(tier) {
        if (tier !== 2) return null;
        var roll = Math.random();
        if (roll < 0.12) return 'armoured';
        if (roll < 0.20) return 'volatile';
        return null;
    }

    function freshState() {
        return {
            rocks: [], beams: [], warns: [],
            shields: SHIELD_MAX,
            heat: 0, locked: 0,
            emp: 0, empFx: 0, ventT: 0,
            wave: 1, waveT: 0, spawnT: 0.25, toSpawn: 9,
            killed: 0, repeatT: 0, idleT: 0, demoT: 1.2,
            combo: 0, comboT: 0,
            menu: false
        };
    }

    function init(g) {
        g.s = freshState();
    }

    /** The board behind the menu card: a live orbit, not a freeze-frame. */
    function initMenu(g) {
        init(g);
        var s = g.s;
        s.menu = true;
        for (var i = 0; i < 5; i++) {
            var r = spawnRock(g, i % 3, null, null, null, { ang: (i / 5) * 6.2832 + 0.4 });
            var a = g.angleTo(g.w / 2, g.h / 2, r.x, r.y);
            var sp = g.rand(46, 64);
            r.vx = Math.cos(a + 1.5708) * sp;
            r.vy = Math.sin(a + 1.5708) * sp;
        }
    }

    /* ── targeting ─────────────────────────────────────────────────────
       One ray-cast, shared by the trigger and the reticle, so the bracket
       the player sees is literally the rock the beam would take. */
    function castTarget(g, px, py) {
        var s = g.s;
        var cx = g.w / 2, cy = g.h / 2;
        var len = g.dist(cx, cy, px, py);
        var dx, dy;
        if (len < 1) { dx = 0; dy = -1; } else { dx = (px - cx) / len; dy = (py - cy) / len; }
        var maxL = Math.hypot(g.w, g.h);
        var hit = -1, hitProj = maxL;
        for (var i = 0; i < s.rocks.length; i++) {
            var r = s.rocks[i];
            var ox = r.x - cx, oy = r.y - cy;
            var proj = ox * dx + oy * dy;
            if (proj < STATION_R || proj > maxL) continue;
            var perp = Math.abs(ox * dy - oy * dx);
            if (perp < r.r + BEAM_SLOP && proj < hitProj) { hit = i; hitProj = proj; }
        }
        return { dx: dx, dy: dy, hit: hit, proj: hitProj, maxL: maxL };
    }

    /* ── kills ─────────────────────────────────────────────────────────
       One path for every death so volatile chains, splits and combo all
       behave identically whether the killer was the beam or a neighbour. */
    function killRock(g, idx, chain) {
        var s = g.s;
        var rock = s.rocks[idx];
        if (!rock) return;
        var t = TIERS[rock.tier];
        var skin = rockSkin(rock);
        s.rocks.splice(idx, 1);

        g.addScore(rock.armoured ? t.score * 2 : t.score);
        s.killed++;
        if (s.comboT > 0) s.combo++; else s.combo = 1;
        s.comboT = COMBO_WINDOW;
        if (s.wave >= EMP_WAVE) s.emp = Math.min(1, s.emp + 0.045);

        g.burst(rock.x, rock.y, { n: 18, colour: skin.col, speed: 230, life: 0.6 });
        g.burst(rock.x, rock.y, { n: 10, colour: '#fff1f5', speed: 320, life: 0.45, shape: 'spark' });

        if (rock.volatile) {
            // A bomb, not a rock: the reward for holding fire until it drifts
            // into the middle of a cluster.
            g.shake(18);
            g.sfx('boom', 1.2);
            g.burst(rock.x, rock.y, { n: 40, colour: '#ffd35a', speed: 430, life: 0.9 });
            g.burst(rock.x, rock.y, { n: 16, colour: '#fff6d6', speed: 520, life: 0.5, shape: 'spark' });
            if (chain === 0) g.flash('VOLATILE', '#ffd35a', 520);
            if (chain < 4) {
                var victims = [];
                for (var j = 0; j < s.rocks.length; j++) {
                    if (g.dist(s.rocks[j].x, s.rocks[j].y, rock.x, rock.y) <= VOLATILE_R) victims.push(s.rocks[j]);
                }
                for (var v = 0; v < victims.length; v++) {
                    var vi = s.rocks.indexOf(victims[v]);
                    if (vi >= 0) killRock(g, vi, chain + 1);
                }
            }
            return;
        }

        g.shake(4 + rock.tier * 2);
        if (chain === 0) g.sfx('hit', 1 + Math.min(6, s.combo - 1) * 0.08);
        if (chain === 0 && s.combo >= 3) g.flash('x' + s.combo, '#ffd35a', 500);

        // Splitting is the trap: shooting the big scary one puts two more on
        // the board, so the correct move is often to leave it and clear space.
        for (var k = 0; k < t.split; k++) {
            var a = g.angleTo(g.w / 2, g.h / 2, rock.x, rock.y) + Math.PI + g.rand(-0.9, 0.9);
            spawnRock(g, rock.tier - 1, rock.x, rock.y, a);
        }
    }

    /* ── weapons ───────────────────────────────────────────────────────── */
    var rightHeld = false;

    function fire(g) {
        var s = g.s;
        // The right button is the EMP, not a second trigger.
        if (rightHeld) { empFire(g); return; }
        s.repeatT = 0.11;
        if (s.locked > 0) { g.sfx('tick', 0.5); return; }
        var cx = g.w / 2, cy = g.h / 2;

        // The beam is a ray from the station through the crosshair and on to
        // the screen edge — the drawn line IS the weapon, not a decoration.
        var tgt = castTarget(g, g.pointer.x, g.pointer.y);

        s.heat += HEAT_PER_SHOT;
        g.sfx('blip', 1.4);
        if (s.heat >= HEAT_MAX) {
            s.heat = HEAT_MAX;
            s.locked = OVERHEAT_LOCK;
            g.flash('OVERHEATED', '#ff8b8b', 700);
            g.sfx('lose', 1.6);
        }

        var reach = tgt.hit >= 0 ? tgt.proj : tgt.maxL;
        s.beams.push({
            mx: cx + tgt.dx * STATION_R, my: cy + tgt.dy * STATION_R,
            ex: cx + tgt.dx * reach, ey: cy + tgt.dy * reach,
            hit: tgt.hit >= 0, age: 0
        });

        if (tgt.hit < 0) return;

        var rock = s.rocks[tgt.hit];
        var skin = rockSkin(rock);
        rock.hp--;
        g.burst(rock.x, rock.y, { n: 8, colour: skin.col, speed: 140, life: 0.35 });
        if (rock.hp > 0) {
            // Armour spalling reads differently from a body hit, so the player
            // learns the blue rocks take four without being told.
            if (rock.armoured && rock.hp === 2) {
                g.sfx('hit', 0.8);
                g.burst(rock.x, rock.y, { n: 12, colour: '#9fb7ff', speed: 240, life: 0.5, shape: 'spark' });
            } else {
                g.sfx('tick', rock.armoured ? 1.6 : 1);
            }
            return;
        }
        killRock(g, tgt.hit, 0);
    }

    function empFire(g) {
        var s = g.s;
        if (s.wave < EMP_WAVE) { g.sfx('tick', 0.4); return; }
        if (s.emp < 1) { g.sfx('tick', 0.5); return; }

        var cx = g.w / 2, cy = g.h / 2;
        s.emp = 0;
        // The whole cost, in one line: you buy space and lose the laser.
        s.heat = HEAT_MAX;
        s.locked = OVERHEAT_LOCK;
        s.empFx = 0.7;
        g.flash('EMP', '#8dffa0', 620);
        g.sfx('boom', 0.65);
        g.shake(12);
        g.burst(cx, cy, { n: 44, colour: '#8dffa0', speed: 520, life: 0.7, shape: 'spark' });

        for (var i = 0; i < s.rocks.length; i++) {
            var r = s.rocks[i];
            if (g.dist(r.x, r.y, cx, cy) > EMP_R) continue;
            var a = g.angleTo(cx, cy, r.x, r.y);
            r.frozen = EMP_FREEZE;
            r.vx = Math.cos(a) * EMP_PUSH;
            r.vy = Math.sin(a) * EMP_PUSH;
            r.spin *= 0.15;
            g.burst(r.x, r.y, { n: 7, colour: '#8dffa0', speed: 130, life: 0.5 });
        }
    }

    /* ── update ────────────────────────────────────────────────────────── */
    function update(g, dt) {
        var s = g.s;
        var cx = g.w / 2, cy = g.h / 2;

        s.heat = Math.max(0, s.heat - COOL_RATE * dt);
        if (s.empFx > 0) s.empFx = Math.max(0, s.empFx - dt);
        if (s.wave >= EMP_WAVE && s.emp < 1) s.emp = Math.min(1, s.emp + dt / EMP_FILL);

        if (s.locked > 0) {
            s.locked -= dt;
            // Redlined: the station vents little grey smoke puffs until the
            // laser comes back.
            if (Math.random() < dt * 16) {
                g.burst(cx + g.rand(-0.6, 0.6) * STATION_R, cy + g.rand(-0.6, 0.6) * STATION_R,
                    { n: 1, colour: '#8d95a6', speed: 50, vy: -28, life: 0.9, size: 2.6, drag: 3.5 });
            }
        }

        // Last shield: the hull is holed and venting, every 0.4s, permanently.
        if (s.shields === 1) {
            s.ventT -= dt;
            if (s.ventT <= 0) {
                s.ventT = 0.4;
                var va = g.rand(0, 6.2832);
                g.burst(cx + Math.cos(va) * STATION_R * 0.7, cy + Math.sin(va) * STATION_R * 0.7,
                    { n: 7, colour: '#ff8b8b', speed: 130, life: 0.7, size: 2.2, angle: va, spread: 0.5 });
            }
        }

        if (s.comboT > 0) {
            s.comboT -= dt;
            if (s.comboT <= 0) s.combo = 0;
        }

        // Holding the button (or Space) keeps firing. Heat, not a fire-rate
        // timer, is what stops you — so the limit the player feels is the one
        // drawn on screen.
        s.repeatT -= dt;
        if (((g.pointer.down && !rightHeld) || g.key('Space')) && s.repeatT <= 0) {
            fire(g);
            s.repeatT = 0.11;
        }

        // Wave pacing: telegraph a budget of rocks, then a short breather.
        s.waveT += dt;
        if (s.toSpawn > 0) {
            s.spawnT -= dt;
            if (s.spawnT <= 0) {
                var tier = Math.random() < Math.min(0.55, 0.15 + s.wave * 0.05) ? 2 : (Math.random() < 0.5 ? 1 : 0);
                // Nothing arrives unannounced: the chevron burns for WARN_LEAD
                // seconds on the edge the rock will cross.
                s.warns.push({ a: Math.random() * 6.2832, t: WARN_LEAD, tier: tier, kind: rollKind(tier) });
                g.sfx('tick', 0.7);
                s.toSpawn--;
                s.spawnT = Math.max(0.28, 1.2 - s.wave * 0.07);
            }
        } else if (s.rocks.length === 0 && s.warns.length === 0) {
            s.wave++;
            s.toSpawn = 5 + s.wave * 2;
            s.spawnT = 0.8;
            g.addScore(250 * s.wave);
            g.flash('WAVE ' + s.wave, g.accent, 900);
            g.sfx('win');
            s.shields = Math.min(SHIELD_MAX, s.shields + (s.wave % 3 === 0 ? 1 : 0));
            if (s.wave === EMP_WAVE) {
                s.emp = 1;
                g.flash('EMP ONLINE — SHIFT', '#8dffa0', 1200);
            }
        }

        for (var w = s.warns.length - 1; w >= 0; w--) {
            s.warns[w].t -= dt;
            if (s.warns[w].t <= 0) {
                spawnRock(g, s.warns[w].tier, null, null, null, { ang: s.warns[w].a, kind: s.warns[w].kind });
                s.warns.splice(w, 1);
            }
        }

        for (var i = s.rocks.length - 1; i >= 0; i--) {
            var r = s.rocks[i];
            if (r.frozen > 0) {
                // EMP'd: no gravity, no threat, just coasting outward while you
                // decide what to do with the room you just bought.
                r.frozen -= dt;
                r.x += r.vx * dt; r.y += r.vy * dt;
                r.rot += r.spin * 0.25 * dt;
                continue;
            }
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
              'ROCKS <b>' + s.rocks.length + '</b>' +
              (s.warns.length ? ' · <b style="color:#ffd35a">INBOUND ' + s.warns.length + '</b>' : '') +
              (s.locked > 0 ? ' · <b style="color:#ff8b8b">LOCKED</b>' : ''));
    }

    /* ── idle ──────────────────────────────────────────────────────────
       Runs behind the menu and the game-over card. The menu sits under a
       blur(10px) scrim over 62% black, so fine detail is wasted there: what
       survives is the bright stuff. The station keeps picking rocks off, which
       both animates the board and shows the player what the verb is. */
    function idle(g, dt) {
        var s = g.s;
        if (!s || !s.rocks) return;
        var cx = g.w / 2, cy = g.h / 2;
        var far = Math.max(g.w, g.h) * 0.75;

        s.idleT -= dt;
        if (s.idleT <= 0 && s.rocks.length < 8) {
            s.idleT = g.rand(0.5, 1.2);
            // Bias to the big tiers: a r:23 rock still reads through the blur.
            var nt = Math.random() < 0.5 ? 2 : (Math.random() < 0.7 ? 1 : 0);
            var nr = spawnRock(g, nt, null, null, null,
                { ang: Math.random() * 6.2832, kind: Math.random() < 0.25 ? (Math.random() < 0.5 ? 'armoured' : 'volatile') : null });
            var na = g.angleTo(cx, cy, nr.x, nr.y);
            var nsp = g.rand(44, 62);
            nr.vx = Math.cos(na + 1.5708) * nsp;
            nr.vy = Math.sin(na + 1.5708) * nsp;
        }

        // Automated defence: one hitscan beam every second or so. Additive
        // pink over a white core is the one thing the scrim cannot flatten.
        s.demoT -= dt;
        if (s.demoT <= 0 && s.rocks.length) {
            s.demoT = g.rand(0.75, 1.5);
            // Farthest rock, not nearest: the menu card covers the middle of
            // the screen, so a shot at a close rock happens where nobody can
            // see it. Below 300px there is nothing worth showing.
            var pick = -1, pd = 300;
            for (var q = 0; q < s.rocks.length; q++) {
                var qd = g.dist(s.rocks[q].x, s.rocks[q].y, cx, cy);
                if (qd > pd) { pd = qd; pick = q; }
            }
            if (pick >= 0) {
                var tr = s.rocks[pick];
                var ta = g.angleTo(cx, cy, tr.x, tr.y);
                s.beams.push({
                    mx: cx + Math.cos(ta) * STATION_R, my: cy + Math.sin(ta) * STATION_R,
                    ex: tr.x, ey: tr.y, hit: true, age: 0
                });
                g.burst(tr.x, tr.y, { n: 20, colour: rockSkin(tr).col, speed: 250, life: 0.7 });
                g.burst(tr.x, tr.y, { n: 12, colour: '#fff1f5', speed: 340, life: 0.5, shape: 'spark' });
                if (tr.volatile) g.burst(tr.x, tr.y, { n: 34, colour: '#ffd35a', speed: 420, life: 0.9 });
                s.rocks.splice(pick, 1);
            } else {
                s.demoT = 0.3;   // nothing worth showing yet; look again shortly
            }
        }

        for (var i = s.rocks.length - 1; i >= 0; i--) {
            var r = s.rocks[i];
            var a = g.angleTo(r.x, r.y, cx, cy);
            var d = g.dist(r.x, r.y, cx, cy);
            r.frozen = 0;
            // Gravity plus a strong tangential term: they fall into orbit
            // instead of straight down the well.
            r.vx += (Math.cos(a) * 30 + Math.cos(a + 1.5708) * 34) * dt;
            r.vy += (Math.sin(a) * 30 + Math.sin(a + 1.5708) * 34) * dt;
            var sp = Math.hypot(r.vx, r.vy);
            if (sp > 92) { r.vx = r.vx / sp * 92; r.vy = r.vy / sp * 92; }
            r.x += r.vx * dt; r.y += r.vy * dt;
            r.rot += r.spin * dt;

            if (d < STATION_R + r.r + 4) {
                s.rocks.splice(i, 1);
                g.burst(r.x, r.y, { n: 12, colour: rockSkin(r).col, speed: 190, life: 0.6 });
            } else if (d > far) {
                s.rocks.splice(i, 1);
            }
        }

        for (var b = s.beams.length - 1; b >= 0; b--) {
            s.beams[b].age += dt;
            if (s.beams[b].age > 0.12) s.beams.splice(b, 1);
        }
        if (s.empFx > 0) s.empFx = Math.max(0, s.empFx - dt);
    }

    /* ── station ───────────────────────────────────────────────────────
       A lit body: gradient hull with a fixed key light, four turning panels,
       and damage that is legible from across the screen. */
    function drawStation(g, c, cx, cy, s) {
        var pa = g.t * 0.35;
        var p, a;

        // Solar panels — four quads on short booms just outside the hull.
        for (p = 0; p < 4; p++) {
            a = pa + p * 1.5708;
            var ax = cx + Math.cos(a) * (STATION_R + 10);
            var ay = cy + Math.sin(a) * (STATION_R + 10);
            c.save();
            c.strokeStyle = 'rgba(190,206,236,0.55)';
            c.lineWidth = 2.4;
            c.beginPath();
            c.moveTo(cx + Math.cos(a) * STATION_R * 0.8, cy + Math.sin(a) * STATION_R * 0.8);
            c.lineTo(ax, ay);
            c.stroke();

            c.translate(ax, ay);
            c.rotate(a);
            var pw = 30, ph = 14;
            var pg = c.createLinearGradient(-pw / 2, -ph / 2, pw / 2, ph / 2);
            // Panels catch the light as they turn, so the whole assembly reads
            // as one rotating object rather than four floating rectangles.
            var lit = 0.45 + 0.55 * Math.max(0, Math.cos(a + 2.356));
            pg.addColorStop(0, shade('#2a3c66', lit * 0.35));
            pg.addColorStop(0.45, shade('#6f8fd8', lit * 0.4));
            pg.addColorStop(1, '#1d2947');
            c.fillStyle = pg;
            c.fillRect(-pw / 2, -ph / 2, pw, ph);
            c.strokeStyle = 'rgba(206,224,255,0.45)';
            c.lineWidth = 1;
            c.strokeRect(-pw / 2, -ph / 2, pw, ph);
            c.beginPath();
            for (var cell = 1; cell < 3; cell++) {
                c.moveTo(-pw / 2 + (pw / 3) * cell, -ph / 2);
                c.lineTo(-pw / 2 + (pw / 3) * cell, ph / 2);
            }
            c.moveTo(-pw / 2, 0); c.lineTo(pw / 2, 0);
            c.strokeStyle = 'rgba(206,224,255,0.22)';
            c.stroke();
            c.restore();
        }

        // Hull.
        var hx = cx + Math.cos(-2.356) * STATION_R * 0.45;
        var hy = cy + Math.sin(-2.356) * STATION_R * 0.45;
        var hull = c.createRadialGradient(hx, hy, STATION_R * 0.1, cx, cy, STATION_R * 1.02);
        hull.addColorStop(0, '#dfe8ff');
        hull.addColorStop(0.5, '#8e9dc4');
        hull.addColorStop(1, '#3a4a6b');
        c.fillStyle = hull;
        c.beginPath(); c.arc(cx, cy, STATION_R, 0, 6.2832); c.fill();

        // Equator band and rim light.
        c.save();
        c.beginPath(); c.arc(cx, cy, STATION_R, 0, 6.2832); c.clip();
        c.fillStyle = 'rgba(24,32,54,0.5)';
        c.fillRect(cx - STATION_R, cy - 4, STATION_R * 2, 8);
        c.fillStyle = 'rgba(141,255,160,0.16)';
        c.fillRect(cx - STATION_R, cy - 2, STATION_R * 2, 2);

        // Lit ports along the band: the cheapest way to say "crewed".
        for (var win = -1; win <= 1; win++) {
            c.fillStyle = 'rgba(255,224,168,' + (0.5 + 0.3 * Math.sin(g.t * 1.7 + win)) + ')';
            c.fillRect(cx + win * 13 - 2.5, cy - 1.5, 5, 3);
        }

        // Hull damage: cracks at two shields, more at one. Deterministic paths
        // so the same break sits in the same place every frame.
        if (s.shields <= 2) {
            var cracks = s.shields <= 1 ? 3 : 2;
            // Hot metal glows through the split once the last shield is gone.
            var passes = s.shields <= 1 ? 2 : 1;
            c.lineCap = 'round';
            for (var pass = 0; pass < passes; pass++) {
                if (pass === 0) {
                    c.strokeStyle = 'rgba(12,16,28,0.85)';
                    c.lineWidth = 2.4;
                } else {
                    c.strokeStyle = 'rgba(255,139,139,' + (0.35 + 0.3 * Math.sin(g.t * 7)) + ')';
                    c.lineWidth = 1.2;
                }
                for (var k = 0; k < cracks; k++) {
                    // Breaks run from the rim inward, not out of the middle of
                    // the hull — that is what an impact actually looks like.
                    var ca = g.hash(k * 41.7 + 3) * 6.2832;
                    c.beginPath();
                    c.moveTo(cx + Math.cos(ca) * STATION_R * 1.02, cy + Math.sin(ca) * STATION_R * 1.02);
                    for (var seg = 1; seg <= 3; seg++) {
                        var sa = ca + (g.hash(k * 91.3 + seg * 17.1) - 0.5) * 0.8;
                        var sr = STATION_R * (1.02 - seg * 0.26);
                        c.lineTo(cx + Math.cos(sa) * sr, cy + Math.sin(sa) * sr);
                    }
                    c.stroke();
                }
            }
        }
        c.restore();

        c.strokeStyle = 'rgba(226,236,255,0.55)';
        c.lineWidth = 1.2;
        c.beginPath(); c.arc(cx, cy, STATION_R, 0, 6.2832); c.stroke();

        // Comms mast and dish, turning with the panels.
        c.save();
        c.translate(cx, cy);
        c.rotate(pa * 1.6);
        c.strokeStyle = 'rgba(232,238,252,0.7)';
        c.lineWidth = 2;
        c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -STATION_R - 12); c.stroke();
        c.fillStyle = 'rgba(232,238,252,0.85)';
        c.beginPath(); c.arc(0, -STATION_R - 13, 4, 0, 6.2832); c.fill();
        c.restore();

        // Nav lights on the boom tips, blinking in opposite phase.
        var nx = Math.cos(pa) * (STATION_R + 10), ny = Math.sin(pa) * (STATION_R + 10);
        var blink = 0.5 + 0.5 * Math.sin(g.t * 3);
        g.bloom(c, cx + nx, cy + ny, 10, 'rgba(255,139,139,' + (0.2 + 0.6 * blink) + ')');
        g.bloom(c, cx - nx, cy - ny, 10, 'rgba(100,255,218,' + (0.2 + 0.6 * (1 - blink)) + ')');
    }

    function drawRock(g, c, r) {
        var skin = rockSkin(r);
        // A soft halo in the rock's own colour: it gives every rock presence
        // against the void, and it is the part that survives the blurred
        // scrim on the menu.
        g.bloom(c, r.x, r.y, r.r * 2.3, skin.aura);
        c.save();
        c.translate(r.x, r.y);
        c.rotate(r.rot);
        // Light stays upper-left in world space even as the rock spins:
        // counter-rotate the highlight offset by the rock's rotation.
        var hx = Math.cos(-2.356 - r.rot) * r.r * 0.5;
        var hy = Math.sin(-2.356 - r.rot) * r.r * 0.5;
        var grd = c.createRadialGradient(hx, hy, r.r * 0.15, 0, 0, r.r * 1.15);
        grd.addColorStop(0, skin.lite);
        grd.addColorStop(0.55, skin.col);
        grd.addColorStop(1, skin.dark);
        c.fillStyle = grd;
        g.rockPath(c, r.r, r.seed, 7 + r.tier * 2);
        c.fill();

        // Tier 0 gets a bright rim so the fastest, smallest rock never
        // disappears into the pink radar wash behind it.
        if (skin.rim) {
            c.strokeStyle = skin.rim;
            c.lineWidth = 1.5;
            c.stroke();
        }
        if (r.armoured && r.hp > 2) {
            c.strokeStyle = 'rgba(226,236,255,0.9)';
            c.lineWidth = 2.4;
            c.stroke();
            c.strokeStyle = 'rgba(159,183,255,0.85)';
            c.lineWidth = 1.2;
            c.beginPath(); c.arc(0, 0, r.r * 0.55, 0, 6.2832); c.stroke();
        } else if (r.hp > 1 && !r.armoured) {
            c.strokeStyle = 'rgba(255,255,255,0.8)';
            c.lineWidth = 2;
            c.stroke();
        }
        c.restore();

        if (r.volatile) {
            var pulse = 0.5 + 0.5 * Math.sin(g.t * 8 + r.seed);
            g.bloom(c, r.x, r.y, r.r * 2.4, 'rgba(255,211,90,' + (0.16 + 0.26 * pulse) + ')');
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.strokeStyle = 'rgba(255,246,214,' + (0.4 + 0.5 * pulse) + ')';
            c.lineWidth = 1.6;
            c.setLineDash([4, 5]);
            c.beginPath(); c.arc(r.x, r.y, r.r + 6, g.t * 2, g.t * 2 + 6.2832); c.stroke();
            c.setLineDash([]);
            c.restore();
        }
        if (r.frozen > 0) {
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.strokeStyle = 'rgba(141,255,160,' + (0.35 + 0.35 * Math.min(1, r.frozen)) + ')';
            c.lineWidth = 2;
            c.beginPath(); c.arc(r.x, r.y, r.r + 4, 0, 6.2832); c.stroke();
            c.restore();
        }
    }

    /** Pulsing chevron on the screen edge, WARN_LEAD seconds before contact. */
    function drawWarn(g, c, w) {
        var p = edgePoint(g, w.a, 26);
        // Keep the marker clear of the chrome: the top bar owns the first 58px
        // and the heat/EMP bars own the last 58.
        if (p.y > g.h - 58) p.y = g.h - 58;
        if (p.y < 70) p.y = 70;
        var urgency = 1 - Math.max(0, w.t) / WARN_LEAD;
        var pulse = 0.35 + 0.65 * Math.abs(Math.sin(g.t * (7 + urgency * 9)));
        var skin = w.kind === 'armoured' ? ARMOURED : w.kind === 'volatile' ? VOLATILE : TIERS[w.tier];
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.translate(p.x, p.y);
        c.rotate(w.a);
        c.globalAlpha = pulse;
        c.strokeStyle = skin.col;
        c.lineWidth = 3;
        c.lineCap = 'round';
        for (var i = 0; i < 2; i++) {
            var o = i * 9;
            c.beginPath();
            c.moveTo(7 + o, -11);
            c.lineTo(-2 + o, 0);
            c.lineTo(7 + o, 11);
            c.stroke();
        }
        c.globalAlpha = pulse * 0.5;
        c.lineWidth = 1.4;
        c.beginPath();
        c.moveTo(-6, 0);
        c.lineTo(-14 - urgency * 16, 0);
        c.stroke();
        c.restore();
        c.globalAlpha = 1;
        g.bloom(c, p.x, p.y, 26, 'rgba(255,255,255,' + (0.05 + 0.1 * pulse) + ')');
    }

    /** Reticle: reactive, and the only pointer on screen (hideCursor). */
    function drawReticle(g, c, s, tgt) {
        var px = g.pointer.x, py = g.pointer.y;
        var locked = s.locked > 0;
        var hasTarget = tgt.hit >= 0;
        var col = locked ? '#ff8b8b' : (hasTarget ? '#8dffa0' : 'rgba(255,255,255,0.82)');
        // Overheated: the rings fly apart, so the state is readable at the one
        // place the eye already is.
        var off = locked ? s.locked * 8 : 0;

        c.save();
        c.strokeStyle = col;
        c.lineWidth = 1.6;
        c.lineCap = 'round';
        if (off > 0.3) {
            var spin = g.t * 4;
            var q, a0;
            for (q = 0; q < 3; q++) {
                a0 = spin + q * 2.0944;
                c.beginPath(); c.arc(px, py, 13 + off, a0, a0 + 1.3); c.stroke();
            }
            for (q = 0; q < 3; q++) {
                a0 = -spin * 1.4 + q * 2.0944;
                c.beginPath(); c.arc(px, py, Math.max(4, 13 - off * 0.6), a0, a0 + 1.1); c.stroke();
            }
        } else {
            c.beginPath(); c.arc(px, py, 13, 0, 6.2832); c.stroke();
            if (hasTarget) {
                c.globalAlpha = 0.5;
                c.beginPath(); c.arc(px, py, 6, 0, 6.2832); c.stroke();
                c.globalAlpha = 1;
            }
        }
        c.beginPath();
        c.moveTo(px - 20 - off, py); c.lineTo(px - 6 - off, py);
        c.moveTo(px + 6 + off, py); c.lineTo(px + 20 + off, py);
        c.moveTo(px, py - 20 - off); c.lineTo(px, py - 6 - off);
        c.moveTo(px, py + 6 + off); c.lineTo(px, py + 20 + off);
        c.stroke();
        c.restore();

        if (!hasTarget) return;

        // Snap a bracket onto whatever the beam would actually take.
        var r = g.s.rocks[tgt.hit];
        if (!r) return;
        var b = r.r + 8;
        var arm = Math.max(5, b * 0.42);
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.strokeStyle = '#8dffa0';
        c.lineWidth = 2;
        c.lineCap = 'round';
        var corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
        for (var i = 0; i < 4; i++) {
            var sx = corners[i][0], sy = corners[i][1];
            c.beginPath();
            c.moveTo(r.x + sx * b, r.y + sy * b - sy * arm);
            c.lineTo(r.x + sx * b, r.y + sy * b);
            c.lineTo(r.x + sx * b - sx * arm, r.y + sy * b);
            c.stroke();
        }
        c.restore();
        g.bloom(c, r.x, r.y, r.r + 18, 'rgba(141,255,160,0.16)');
    }

    function drawBars(g, c, s) {
        var barW = Math.min(430, g.w - 70);
        var bx = (g.w - barW) / 2, by = g.h - 34;
        var heatW = Math.round(barW * 0.60);
        var gap = 16;
        var empW = barW - heatW - gap;
        var ex = bx + heatW + gap;

        c.font = '600 11px "Space Grotesk", Inter, sans-serif';
        c.textAlign = 'center';

        // Heat.
        c.fillStyle = s.locked > 0 ? 'rgba(255,107,107,0.22)' : 'rgba(255,255,255,0.10)';
        c.fillRect(bx, by, heatW, 9);
        c.fillStyle = s.locked > 0 ? '#ff8b8b' : (s.heat > 70 ? '#ffb46b' : g.accent);
        c.fillRect(bx, by, heatW * (s.heat / HEAT_MAX), 9);
        c.fillStyle = s.locked > 0 ? 'rgba(255,139,139,0.95)' : 'rgba(159,179,204,0.9)';
        c.fillText(s.locked > 0 ? 'LASER LOCKED OUT' : 'LASER HEAT', bx + heatW / 2, by - 7);

        // EMP: the second verb gets its own meter, right next to the cost.
        var ready = s.wave >= EMP_WAVE && s.emp >= 1;
        c.fillStyle = 'rgba(255,255,255,0.10)';
        c.fillRect(ex, by, empW, 9);
        if (s.wave >= EMP_WAVE) {
            c.fillStyle = ready ? '#8dffa0' : '#5aa6ff';
            c.fillRect(ex, by, empW * s.emp, 9);
            if (ready) {
                var pulse = 0.5 + 0.5 * Math.sin(g.t * 5);
                g.bloom(c, ex + empW / 2, by + 4, 40, 'rgba(141,255,160,' + (0.12 + 0.16 * pulse) + ')');
            }
        }
        c.fillStyle = s.wave >= EMP_WAVE
            ? (ready ? 'rgba(141,255,160,0.95)' : 'rgba(159,179,204,0.9)')
            : 'rgba(159,179,204,0.45)';
        c.fillText(s.wave < EMP_WAVE ? 'EMP · WAVE ' + EMP_WAVE
            : (ready ? 'EMP READY · SHIFT' : 'EMP CHARGING'), ex + empW / 2, by - 7);

        c.textAlign = 'left';
    }

    function draw(g, c) {
        var s = g.s;
        var cx = g.w / 2, cy = g.h / 2;
        g.space(c, { bg: '#03060f' });

        c.strokeStyle = 'rgba(255,139,167,0.10)';
        c.lineWidth = 1;
        for (var ring = 1; ring <= 4; ring++) {
            c.beginPath(); c.arc(cx, cy, ring * Math.min(g.w, g.h) * 0.11, 0, 6.2832); c.stroke();
        }

        // Radar sweep: a faint additive wedge, one full turn every ~4 seconds.
        var sweepA = g.t * 1.5708;
        var sweepR = Math.min(g.w, g.h) * 0.44;
        c.save();
        c.globalCompositeOperation = 'lighter';
        var swGrd = c.createRadialGradient(cx, cy, STATION_R * 0.4, cx, cy, sweepR);
        swGrd.addColorStop(0, 'rgba(255,139,167,0.10)');
        swGrd.addColorStop(1, 'rgba(255,139,167,0)');
        c.fillStyle = swGrd;
        c.beginPath();
        c.moveTo(cx, cy);
        c.arc(cx, cy, sweepR, sweepA - 0.5, sweepA);
        c.closePath();
        c.fill();
        c.strokeStyle = 'rgba(255,139,167,0.22)';
        c.lineWidth = 1.4;
        c.beginPath();
        c.moveTo(cx, cy);
        c.lineTo(cx + Math.cos(sweepA) * sweepR, cy + Math.sin(sweepA) * sweepR);
        c.stroke();
        c.restore();

        // Shield rings — additive, so they read as energy fields, and they breathe.
        g.bloom(c, cx, cy, 90, 'rgba(100,255,218,0.16)');
        c.save();
        c.globalCompositeOperation = 'lighter';
        for (var sh = 0; sh < s.shields; sh++) {
            c.strokeStyle = 'rgba(100,255,218,' + (0.42 - sh * 0.09 + 0.08 * Math.sin(g.t * 2 + sh * 2.1)) + ')';
            c.lineWidth = 2.4;
            c.beginPath(); c.arc(cx, cy, STATION_R + 20 + sh * 8, 0, 6.2832); c.stroke();
        }
        c.restore();

        drawStation(g, c, cx, cy, s);

        for (var k = 0; k < s.rocks.length; k++) drawRock(g, c, s.rocks[k]);

        // Laser beams: additive, hot core over a wide halo, bloom at the
        // muzzle and (on a hit) at the impact point.
        c.save();
        c.globalCompositeOperation = 'lighter';
        for (var b = 0; b < s.beams.length; b++) {
            var bm = s.beams[b];
            var bf = 1 - bm.age / 0.12;
            c.globalAlpha = bf;
            c.strokeStyle = 'rgba(255,139,167,0.5)';
            c.lineWidth = 6;
            c.beginPath(); c.moveTo(bm.mx, bm.my); c.lineTo(bm.ex, bm.ey); c.stroke();
            c.strokeStyle = '#ffdfe9';
            c.lineWidth = 2;
            c.beginPath(); c.moveTo(bm.mx, bm.my); c.lineTo(bm.ex, bm.ey); c.stroke();
            c.globalAlpha = 1;
            g.bloom(c, bm.mx, bm.my, 18, 'rgba(255,139,167,' + (0.5 * bf) + ')');
            if (bm.hit) g.bloom(c, bm.ex, bm.ey, 30, 'rgba(255,139,167,' + (0.6 * bf) + ')');
        }
        c.restore();
        c.globalAlpha = 1;

        // EMP shockwave.
        if (s.empFx > 0) {
            var f = 1 - s.empFx / 0.7;
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.strokeStyle = 'rgba(141,255,160,' + (0.75 * (1 - f)) + ')';
            c.lineWidth = 5 * (1 - f) + 1;
            c.beginPath(); c.arc(cx, cy, EMP_R * f, 0, 6.2832); c.stroke();
            c.strokeStyle = 'rgba(255,255,255,' + (0.4 * (1 - f)) + ')';
            c.lineWidth = 1.4;
            c.beginPath(); c.arc(cx, cy, EMP_R * f * 0.72, 0, 6.2832); c.stroke();
            c.restore();
        }

        if (g.running) {
            for (var w = 0; w < s.warns.length; w++) drawWarn(g, c, s.warns[w]);
            drawReticle(g, c, s, castTarget(g, g.pointer.x, g.pointer.y));
            drawBars(g, c, s);
        }
    }

    Arcade.create({
        slug: 'last-station',
        title: 'LAST STATION',
        accent: '#ff8ba7',
        hideCursor: true,
        tagline: 'Everything falls toward you. Click a rock to vaporize it — but the big ones split when they break, blue ones are armoured, gold ones detonate, and your laser overheats. From wave 3 the EMP buys you a clear ring for the price of the whole heat bar.',
        controls: [['CLICK', 'fire laser'], ['SPACE', 'fire'], ['HOLD', 'rapid fire'], ['SHIFT · RMB', 'EMP burst (wave 3)']],
        scoreLabel: 'SCORE',
        overTitle: 'STATION LOST',
        init: init,
        initMenu: initMenu,
        idle: idle,
        update: update,
        draw: draw,
        pointerDown: fire,
        keyDown: function (g, code) {
            if (!g.running) return;
            if (code === 'Space') fire(g);
            else if (code === 'ShiftLeft' || code === 'ShiftRight') empFire(g);
        }
    });

    // The shell's pointer handler does not carry a button, so the right button
    // is tracked here on the capture phase — it runs before the canvas handler,
    // which lets fire() route the click to the EMP instead of the laser.
    window.addEventListener('pointerdown', function (e) {
        if (e.button === 2) rightHeld = true;
    }, true);
    window.addEventListener('pointerup', function (e) {
        if (e.button === 2) rightHeld = false;
    }, true);
    window.addEventListener('blur', function () { rightHeld = false; });
})();

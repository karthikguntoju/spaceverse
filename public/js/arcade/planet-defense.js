/**
 * Planet Defense — tower defense where the lanes are orbits.
 *
 * Asteroids fall inward along orbit rings; you buy turrets and gravity wells
 * and drop them onto the rings. Wells do no damage at all, which is the point:
 * slowing a lane so the lasers get more shots is usually worth more than more
 * lasers.
 *
 * The field is elliptical, not circular. A circle keyed off min(w,h) leaves a
 * 16:9 monitor with two dead columns of black either side of the play area, so
 * every orbit is an ellipse and every polar->cartesian conversion — rocks,
 * towers, ghosts, pulses — goes through the same rx/ry pair.
 */
(function () {
    'use strict';

    var EARTH_R = 40;
    var RINGS = 3;
    var HP_MAX = 12;
    var MAX_LVL = 4;
    var FIRE_COOL = 0.35;
    var SPAWN_U = RINGS + 0.25;   // continuous ring index the rocks fall from
    var LULL = 6;                 // seconds between waves; the countdown arc reads this
    var FACE = '"Space Grotesk", Inter, sans-serif';

    var TOWERS = {
        laser: { cost: 60,  colour: '#5ad7ff', range: 130, dps: 34, name: 'LASER',        bl: 19, bw: 5 },
        well:  { cost: 45,  colour: '#b48bff', range: 105, slow: 0.45, name: 'GRAVITY WELL' },
        flak:  { cost: 110, colour: '#ffb46b', range: 92,  dps: 62, splash: 46, name: 'FLAK', bl: 16, bw: 9 }
    };
    var KINDS = ['laser', 'well', 'flak'];

    function font(px) { return '600 ' + px + 'px ' + FACE; }

    /* ── the elliptical field ─────────────────────────────────────────────
       u is a continuous ring index: 0/1/2 are the three orbits, higher is
       further out, and it goes negative on the last stretch into Earth. */
    function rxAt(g, u) { return g.w * (0.15 + u * 0.085); }
    function ryAt(g, u) { return g.h * (0.19 + u * 0.11); }

    /** The planet shrinks on small viewports. At 360px wide the inner orbit
        sits at rx=54, and a fixed 40px Earth plus its 16px countdown arc would
        be painted straight through that ring's band. */
    function earthR(g) { return g.clamp(Math.min(g.w, g.h) * 0.055, 24, EARTH_R); }

    function ellipsePath(c, x, y, rx, ry) {
        c.beginPath();
        if (c.ellipse) { c.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, 6.2832); return; }
        c.save(); c.translate(x, y); c.scale(1, Math.max(0.05, ry / Math.max(1, rx)));
        c.arc(0, 0, Math.max(0.5, rx), 0, 6.2832);
        c.restore();
    }

    /** Nearest orbit to a screen point, plus its angle and the miss distance.
        On an ellipse the screen angle is not the parametric angle — feeding
        atan2(dy,dx) straight back into cos/sin lands you somewhere else on the
        ring entirely, which reads as "clicked the ring, game says I didn't".
        Unsquashing by rx/ry first is what makes the ghost sit under the cursor. */
    function nearestRing(g, px, py) {
        var cx = g.w / 2, cy = g.h / 2;
        var ring = 0, bestA = 0, best = Infinity;
        for (var i = 0; i < RINGS; i++) {
            var rx = rxAt(g, i), ry = ryAt(g, i);
            var a = Math.atan2((py - cy) / ry, (px - cx) / rx);
            var d = g.dist(px, py, cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
            if (d < best) { best = d; ring = i; bestA = a; }
        }
        return { ring: ring, a: bestA, gap: best };
    }

    /* ── colour + shape helpers ───────────────────────────────────────── */
    function shade(hex, amt) {
        var n = parseInt(hex.slice(1), 16);
        var r = (n >> 16) & 255, gr = (n >> 8) & 255, b = n & 255;
        if (amt >= 0) { r += (255 - r) * amt; gr += (255 - gr) * amt; b += (255 - b) * amt; }
        else { var k = 1 + amt; r *= k; gr *= k; b *= k; }
        return 'rgb(' + (r | 0) + ',' + (gr | 0) + ',' + (b | 0) + ')';
    }

    function hexPath(c, x, y, r, rot) {
        c.beginPath();
        for (var i = 0; i < 6; i++) {
            var a = rot + i * 1.0472;
            var px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
            if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
        }
        c.closePath();
    }

    function rrectPath(c, x, y, w, h, r) {
        c.beginPath();
        if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h);
    }

    function inRect(r, x, y) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }

    /* ── tower stats: one place, so the UI copy can never drift from the sim ──
       Reach is quoted against a 1280x720 field. Without this a 1080p monitor
       gets a field half again as large and the same 130px laser, so the same
       build covers visibly less orbit than it does on a laptop. */
    function fieldScale(g) {
        return g.clamp(Math.sqrt((g.w * g.h) / (1280 * 720)), 0.8, 1.5);
    }
    function baseRange(g, kind) { return TOWERS[kind].range * fieldScale(g); }
    function twRange(g, tw) { return baseRange(g, tw.kind) * Math.pow(1.12, tw.lvl - 1); }
    function twDps(tw) { return (TOWERS[tw.kind].dps || 0) * Math.pow(1.45, tw.lvl - 1); }
    function twSlow(tw) { return Math.min(0.78, (TOWERS[tw.kind].slow || 0) * Math.pow(1.18, tw.lvl - 1)); }
    function upCost(tw) { return Math.round(TOWERS[tw.kind].cost * 1.5 * tw.lvl); }
    function sellValue(tw) { return Math.round(tw.spent * 0.6); }

    function makeTower(kind, ring, a) {
        return {
            kind: kind, ring: ring, a: a, lvl: 1, spent: TOWERS[kind].cost,
            cool: 0, x: 0, y: 0, ang: a, flash: 0, spin: Math.random() * 6.2832, target: null
        };
    }

    /* ── layout that both the painter and the hit-test read ───────────────
       Derived, never hard-coded, so a 360px phone cannot end up with a FLAK
       button hanging off the side of the screen. */
    function palette(g) {
        var gap = 8;
        var bw = Math.min(132, (g.w - 24 - gap * 2) / 3);
        var bh = 40;
        var total = bw * 3 + gap * 2;
        return { bw: bw, bh: bh, gap: gap, x0: (g.w - total) / 2, y: g.h - bh - 12, total: total };
    }

    function panelRect(g, tw) {
        var pw = Math.min(186, g.w - 16), ph = 58;
        var x = g.clamp(tw.x - pw / 2, 8, Math.max(8, g.w - pw - 8));
        var y = tw.y - ph - 22;
        if (y < 8) y = tw.y + 22;
        var pal = palette(g);
        if (y + ph > pal.y - 8) y = Math.max(8, tw.y - ph - 22);
        var bw = (pw - 24) / 2;
        return {
            x: x, y: y, w: pw, h: ph,
            up:   { x: x + 8, y: y + ph - 28, w: bw, h: 22 },
            sell: { x: x + 16 + bw, y: y + ph - 28, w: bw, h: 22 }
        };
    }

    /* ── state ────────────────────────────────────────────────────────── */
    function init(g) {
        g.s = {
            towers: [], rocks: [], pulses: [], pops: [],
            hp: HP_MAX,
            salvage: 190,       // enough for three towers before the first wave lands
            wave: 0,
            spawnLeft: 0, spawnT: 0,
            between: 4, tickSec: 0,
            picked: 'laser',
            killed: 0,
            sel: null,
            cur: { on: false, ring: 1, a: -1.5708 },
            demo: false
        };
    }

    /** The menu board is a live demo, not a frozen empty field. */
    function initMenu(g) {
        init(g);
        var s = g.s;
        s.demo = true;
        s.wave = 4;
        var seed = [
            ['laser', 0, -1.90], ['well', 1, 0.55], ['flak', 1, 2.45],
            ['laser', 2, -0.60], ['laser', 1, -3.05], ['well', 2, 1.75]
        ];
        for (var i = 0; i < seed.length; i++) {
            var tw = makeTower(seed[i][0], seed[i][1], seed[i][2]);
            tw.lvl = 1 + (i % 3 === 0 ? 1 : 0);
            s.towers.push(tw);
        }
        s.spawnT = 0.3;
    }

    function startWave(g) {
        var s = g.s;
        s.wave++;
        s.spawnLeft = 4 + s.wave * 2;
        s.spawnT = 0;
        s.pulses.push({ age: 0 });
        g.flash('WAVE ' + s.wave, '#5ad7ff', 1000);
        g.sfx('win');
    }

    function spawnRock(g, demo) {
        var s = g.s;
        var wave = demo ? Math.max(3, Math.min(8, s.wave)) : s.wave;
        var a = Math.random() * 6.2832;
        var hp = 22 + wave * 13;
        var big = Math.random() < Math.min(0.4, 0.08 + wave * 0.035);
        // Salvage tracks the HP curve now. A flat 20/rock meant the economy
        // quietly inverted against the player about four-fold by wave 10.
        var base = Math.round(20 * (1 + wave * 0.35));
        s.rocks.push({
            a: a, u: SPAWN_U, x: 0, y: 0,
            hp: big ? hp * 2.6 : hp, max: big ? hp * 2.6 : hp,
            speed: (0.50 + wave * 0.042) * (big ? 0.72 : 1) * g.rand(0.9, 1.1),
            slow: 0, slowNew: 0, hit: 0,
            size: big ? 20 : 12, spin: g.rand(-2, 2), rot: 0,
            seed: Math.random() * 1000,
            worth: big ? Math.round(base * 2.25) : base
        });
    }

    /* ── simulation ───────────────────────────────────────────────────────
       One body for the run and for the menu demo. `demo` mutes everything
       that touches the player's score, salvage, planet or ears. */
    function step(g, dt, demo) {
        var s = g.s;
        var cx = g.w / 2, cy = g.h / 2;

        /* waves */
        if (demo) {
            s.spawnT -= dt;
            if (s.spawnT <= 0 && s.rocks.length < 11) { spawnRock(g, true); s.spawnT = g.rand(0.45, 1.05); }
        } else if (s.spawnLeft <= 0 && s.rocks.length === 0) {
            s.between -= dt;
            var sec = Math.max(0, Math.ceil(s.between));
            if (sec !== s.tickSec) { s.tickSec = sec; if (sec > 0 && sec <= 3) g.sfx('tick'); }
            if (s.between <= 0) {
                if (s.wave > 0) {
                    s.salvage += Math.round(40 * (1 + s.wave * 0.35));
                    g.addScore(300 * s.wave);
                }
                s.between = LULL;
                startWave(g);
            }
        } else if (s.spawnLeft > 0) {
            s.spawnT -= dt;
            if (s.spawnT <= 0) {
                spawnRock(g, false);
                s.spawnLeft--;
                s.spawnT = Math.max(0.35, 1.5 - s.wave * 0.06);
            }
        }

        /* keyboard build cursor: held arrows sweep it along its orbit */
        if (!demo && s.cur.on) {
            var fast = g.key('ShiftLeft') || g.key('ShiftRight') ? 2.4 : 1.0;
            if (g.key('ArrowLeft')) s.cur.a -= fast * dt;
            if (g.key('ArrowRight')) s.cur.a += fast * dt;
            s.cur.a = g.wrapAngle(s.cur.a);
        }

        for (var pi = s.pulses.length - 1; pi >= 0; pi--) {
            s.pulses[pi].age += dt;
            if (s.pulses[pi].age > 1.1) s.pulses.splice(pi, 1);
        }
        for (var qi = s.pops.length - 1; qi >= 0; qi--) {
            s.pops[qi].age += dt;
            if (s.pops[qi].age > 0.9) s.pops.splice(qi, 1);
        }

        /* rocks move first, so towers this frame aim at where things are */
        for (var m = 0; m < s.rocks.length; m++) {
            var rm = s.rocks[m];
            rm.rot += rm.spin * dt;
            if (rm.hit > 0) rm.hit -= dt;
            rm.slow = rm.slowNew; rm.slowNew = 0;
            rm.u -= rm.speed * (1 - rm.slow) * dt;
            rm.x = cx + Math.cos(rm.a) * rxAt(g, rm.u);
            rm.y = cy + Math.sin(rm.a) * ryAt(g, rm.u);
        }

        /* towers. Targeting is "deepest into the well", the only rule that
           never loses a rock it could have killed. */
        for (var t = 0; t < s.towers.length; t++) {
            var tw = s.towers[t];
            var def = TOWERS[tw.kind];
            tw.x = cx + Math.cos(tw.a) * rxAt(g, tw.ring);
            tw.y = cy + Math.sin(tw.a) * ryAt(g, tw.ring);
            tw.cool -= dt;
            if (tw.flash > 0) tw.flash = Math.max(0, tw.flash - dt / 0.08);

            var range = twRange(g, tw);
            var target = null, bestU = Infinity;
            for (var k = 0; k < s.rocks.length; k++) {
                var rk = s.rocks[k];
                if (g.dist(tw.x, tw.y, rk.x, rk.y) > range) continue;
                if (tw.kind === 'well') { rk.slowNew = Math.max(rk.slowNew, twSlow(tw)); continue; }
                if (rk.u < bestU) { bestU = rk.u; target = rk; }
            }
            tw.target = target;

            if (tw.kind === 'well') { tw.spin += dt * 1.5; continue; }

            if (target) {
                // Barrel swings onto the target instead of teleporting.
                tw.ang += g.wrapAngle(Math.atan2(target.y - tw.y, target.x - tw.x) - tw.ang)
                    * Math.min(1, dt * 8);
            }
            if (!target || tw.cool > 0) continue;

            tw.cool = FIRE_COOL;
            tw.flash = 1;
            target.hp -= twDps(tw) * FIRE_COOL;
            target.hit = 0.12;
            if (!demo) g.sfx('blip', 1.7 + tw.lvl * 0.06);
            g.burst(target.x, target.y, { n: 4, colour: def.colour, speed: 90, life: 0.25, size: 2 });
            g.burst(tw.x + Math.cos(tw.ang) * def.bl, tw.y + Math.sin(tw.ang) * def.bl,
                { n: 3, colour: shade(def.colour, 0.5), speed: 80, life: 0.16, size: 1.6,
                  angle: tw.ang, spread: 0.5, shape: 'spark' });

            if (def.splash) {
                var splash = def.splash * fieldScale(g);
                for (var sp = 0; sp < s.rocks.length; sp++) {
                    var o = s.rocks[sp];
                    if (o === target) continue;
                    if (g.dist(target.x, target.y, o.x, o.y) < splash) {
                        o.hp -= twDps(tw) * 0.18;
                        o.hit = 0.1;
                    }
                }
                g.burst(target.x, target.y, { n: 8, colour: def.colour, speed: 150, life: 0.35 });
            }
        }

        /* resolve kills and impacts */
        for (var j = s.rocks.length - 1; j >= 0; j--) {
            var rock = s.rocks[j];

            if (rock.hp <= 0) {
                g.burst(rock.x, rock.y, { n: 16, colour: '#ffb46b', speed: 220, life: 0.6 });
                g.burst(rock.x, rock.y, { n: 9, colour: '#ffe2b0', speed: 340, life: 0.45, size: 2, shape: 'spark' });
                s.pops.push({ x: rock.x, y: rock.y, age: 0, txt: '+' + rock.worth });
                if (!demo) {
                    s.salvage += rock.worth;
                    s.killed++;
                    g.addScore(rock.worth * 4);
                    g.sfx('hit');
                }
                s.rocks.splice(j, 1);
                continue;
            }

            var er = earthR(g);
            if (g.dist(rock.x, rock.y, cx, cy) <= er + rock.size * 0.3) {
                s.rocks.splice(j, 1);
                var ia = Math.atan2(rock.y - cy, rock.x - cx);
                if (demo) {
                    g.burst(cx + Math.cos(ia) * er, cy + Math.sin(ia) * er,
                        { n: 12, colour: '#ff8b8b', speed: 170, life: 0.5 });
                    continue;
                }
                s.hp -= rock.size > 16 ? 3 : 1;
                g.shake(20); g.sfx('boom');
                g.burst(cx + Math.cos(ia) * er, cy + Math.sin(ia) * er,
                    { n: 26, colour: '#ff8b8b', speed: 260, life: 0.8 });
                g.flash('IMPACT', '#ff8b8b', 600);
                if (s.hp <= 0) {
                    g.burst(cx, cy, { n: 80, colour: '#ffd35a', speed: 480, life: 1.3 });
                    g.shake(40);
                    s.sel = null;
                    g.over('Earth fell on wave ' + s.wave + '. ' + s.killed + ' asteroids destroyed.');
                    return;
                }
            }
        }

        if (demo) return;

        var d = TOWERS[s.picked];
        var lull = s.spawnLeft <= 0 && s.rocks.length === 0;
        g.hud(
            'WAVE <b>' + Math.max(1, s.wave) + '</b> · EARTH <b style="color:' +
                (s.hp < 5 ? '#ff8b8b' : '#e8eefc') + '">' + s.hp + '/' + HP_MAX + '</b><br>' +
            'SALVAGE <b>' + s.salvage + '</b>' +
                (lull ? ' · <b style="color:#5ad7ff">NEXT WAVE IN ' + Math.max(0, Math.ceil(s.between)) + 'S</b>' : '') + '<br>' +
            'BUILDING <b style="color:' + d.colour + '">' + d.name + ' (' + d.cost + ')</b>' +
            // The long hint wraps to three lines on a phone and buries the field.
            (g.w < 620 ? '' : ' — 1/2/3 · arrows+enter place · click a tower to upgrade')
        );
    }

    function update(g, dt) { step(g, dt, false); }
    function idle(g, dt) { if (g.s && g.s.towers) step(g, dt, true); }

    /* ── build / upgrade / sell ───────────────────────────────────────── */
    function towerAt(g, px, py) {
        var s = g.s, best = null, bd = 20;
        for (var i = 0; i < s.towers.length; i++) {
            var d = g.dist(px, py, s.towers[i].x, s.towers[i].y);
            if (d < bd) { bd = d; best = s.towers[i]; }
        }
        return best;
    }

    function placeOn(g, ring, a) {
        var s = g.s;
        var cx = g.w / 2, cy = g.h / 2;
        var def = TOWERS[s.picked];
        var x = cx + Math.cos(a) * rxAt(g, ring), y = cy + Math.sin(a) * ryAt(g, ring);

        for (var t = 0; t < s.towers.length; t++) {
            if (g.dist(x, y, s.towers[t].x, s.towers[t].y) < 30) {
                g.flash('TOO CLOSE TO ANOTHER TOWER', '#ffb46b', 700);
                g.sfx('lose', 1.8);
                return false;
            }
        }
        if (s.salvage < def.cost) {
            g.flash('NOT ENOUGH SALVAGE', '#ff8b8b', 600);
            g.sfx('lose', 1.6);
            return false;
        }

        s.salvage -= def.cost;
        var tw = makeTower(s.picked, ring, a);
        tw.x = x; tw.y = y;
        s.towers.push(tw);
        g.sfx('pick');
        g.burst(x, y, { n: 12, colour: def.colour, speed: 130 });
        return true;
    }

    function placeAt(g, px, py) {
        var n = nearestRing(g, px, py);
        if (n.gap > 60) { g.flash('PLACE ON AN ORBIT RING', '#ffb46b', 700); return false; }
        return placeOn(g, n.ring, n.a);
    }

    function doUpgrade(g, tw) {
        var s = g.s;
        if (tw.lvl >= MAX_LVL) { g.flash('MAX LEVEL', '#ffb46b', 600); g.sfx('lose', 1.8); return; }
        var cost = upCost(tw);
        if (s.salvage < cost) { g.flash('NOT ENOUGH SALVAGE', '#ff8b8b', 600); g.sfx('lose', 1.6); return; }
        s.salvage -= cost;
        tw.spent += cost;
        tw.lvl++;
        g.sfx('win', 1.5);
        g.burst(tw.x, tw.y, { n: 16, colour: TOWERS[tw.kind].colour, speed: 170, life: 0.5, shape: 'spark' });
        g.flash('LVL ' + tw.lvl, TOWERS[tw.kind].colour, 500);
    }

    function doSell(g, tw) {
        var s = g.s;
        var back = sellValue(tw);
        var i = s.towers.indexOf(tw);
        if (i >= 0) s.towers.splice(i, 1);
        s.salvage += back;
        s.sel = null;
        s.pops.push({ x: tw.x, y: tw.y, age: 0, txt: '+' + back });
        g.burst(tw.x, tw.y, { n: 14, colour: '#8dffa0', speed: 150, life: 0.5 });
        g.sfx('pick', 0.6);
    }

    /* ── input ────────────────────────────────────────────────────────── */
    function pointerDown(g) {
        var s = g.s;
        var px = g.pointer.x, py = g.pointer.y;

        var pal = palette(g);
        if (py >= pal.y && py <= pal.y + pal.bh) {
            for (var b = 0; b < KINDS.length; b++) {
                var bx = pal.x0 + b * (pal.bw + pal.gap);
                if (px >= bx && px <= bx + pal.bw) { s.picked = KINDS[b]; g.sfx('tick'); return; }
            }
        }

        if (s.sel) {
            var r = panelRect(g, s.sel);
            if (inRect(r.up, px, py)) { doUpgrade(g, s.sel); return; }
            if (inRect(r.sell, px, py)) { doSell(g, s.sel); return; }
            if (inRect(r, px, py)) return;
        }

        var hit = towerAt(g, px, py);
        if (hit) { s.sel = s.sel === hit ? null : hit; s.cur.on = false; g.sfx('tick'); return; }
        if (s.sel) { s.sel = null; return; }

        s.cur.on = false;
        placeAt(g, px, py);
    }

    function pointerMove(g) {
        // Touching the mouse hands control back to the pointer.
        if (g.s && g.s.cur) g.s.cur.on = false;
    }

    function keyDown(g, code) {
        var s = g.s;
        // The shell forwards keys on the menu and the game-over card too; the
        // demo board is not something you get to spend salvage on.
        if (!s || !s.cur || !g.running) return;

        if (code === 'Digit1') { s.picked = 'laser'; g.sfx('tick'); return; }
        if (code === 'Digit2') { s.picked = 'well'; g.sfx('tick'); return; }
        if (code === 'Digit3') { s.picked = 'flak'; g.sfx('tick'); return; }

        if (code === 'KeyU') { if (s.sel) doUpgrade(g, s.sel); return; }
        if (code === 'KeyX' || code === 'Delete' || code === 'Backspace') {
            if (s.sel) doSell(g, s.sel);
            return;
        }

        if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' ||
            code === 'ArrowDown' || code === 'Tab') {
            if (!s.cur.on) { s.cur.on = true; s.sel = null; g.sfx('tick'); }
            if (code === 'Tab') s.cur.ring = (s.cur.ring + 1) % RINGS;
            if (code === 'ArrowUp') s.cur.ring = Math.min(RINGS - 1, s.cur.ring + 1);
            if (code === 'ArrowDown') s.cur.ring = Math.max(0, s.cur.ring - 1);
            return;
        }

        if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') {
            if (!s.cur.on) { s.cur.on = true; s.sel = null; return; }
            var cx = g.w / 2, cy = g.h / 2;
            var x = cx + Math.cos(s.cur.a) * rxAt(g, s.cur.ring);
            var y = cy + Math.sin(s.cur.a) * ryAt(g, s.cur.ring);
            var here = towerAt(g, x, y);
            if (here) { s.sel = s.sel === here ? null : here; g.sfx('tick'); return; }
            placeOn(g, s.cur.ring, s.cur.a);
        }
    }

    /* ── painting ─────────────────────────────────────────────────────── */
    function drawEarth(g, c, cx, cy) {
        var ER = earthR(g);
        g.bloom(c, cx, cy, ER * 2.6, 'rgba(79,157,232,0.28)');
        var grd = c.createRadialGradient(cx - ER * 0.35, cy - ER * 0.4, ER * 0.12, cx, cy, ER);
        grd.addColorStop(0, '#63b0f2'); grd.addColorStop(1, '#12406e');
        c.fillStyle = grd;
        c.beginPath(); c.arc(cx, cy, ER, 0, 6.2832); c.fill();

        c.save();
        c.beginPath(); c.arc(cx, cy, ER, 0, 6.2832); c.clip();
        c.strokeStyle = 'rgba(255,255,255,0.17)';
        c.lineCap = 'round';
        for (var cl = 0; cl < 3; cl++) {
            var ca = g.t * 0.05 + cl * 2.4 + g.hash(cl * 17.3) * 6.2832;
            var cr = ER * (0.42 + g.hash(cl * 31.7) * 0.42);
            c.lineWidth = (3.5 + g.hash(cl * 7.9) * 3) * (ER / 40);
            c.beginPath(); c.arc(cx, cy, cr, ca, ca + 1.5 + g.hash(cl * 11.1)); c.stroke();
        }
        c.lineCap = 'butt';
        // Terminator, so the city lights have a night side to sit on. Kept
        // light — this is a 40px disc, not a hero render, and crushing it to
        // black loses the clouds entirely.
        var sh = c.createRadialGradient(cx - ER * 0.45, cy - ER * 0.5, ER * 0.35,
            cx + ER * 0.3, cy + ER * 0.35, ER * 1.6);
        sh.addColorStop(0, 'rgba(0,0,0,0)');
        sh.addColorStop(1, 'rgba(0,4,12,0.42)');
        c.fillStyle = sh;
        c.fillRect(cx - ER, cy - ER, ER * 2, ER * 2);
        c.restore();

        c.save();
        c.globalCompositeOperation = 'lighter';
        c.fillStyle = '#ffd98a';
        for (var ct = 0; ct < 6; ct++) {
            var la = 0.35 + g.hash(ct * 13.7) * 1.05;
            var lr = ER * (0.6 + g.hash(ct * 23.1) * 0.3);
            c.globalAlpha = 0.45 + 0.35 * Math.sin(g.t * 1.8 + ct * 1.9);
            c.beginPath();
            c.arc(cx + Math.cos(la) * lr, cy + Math.sin(la) * lr, 1.2, 0, 6.2832);
            c.fill();
        }
        c.globalAlpha = 1;
        c.strokeStyle = 'rgba(79,157,232,0.5)';
        c.lineWidth = 2.5;
        c.beginPath(); c.arc(cx, cy, ER + 2, 0, 6.2832); c.stroke();
        c.restore();
    }

    function drawTower(g, c, tw, sel) {
        var def = TOWERS[tw.kind];
        var rr = 9 + (tw.lvl - 1) * 1.2;

        // Base: a lit hexagon, not a flat dot.
        var rot = tw.kind === 'well' ? g.t * 0.25 : 0.5236;
        var grd = c.createRadialGradient(tw.x - rr * 0.45, tw.y - rr * 0.55, 1, tw.x, tw.y, rr * 1.35);
        grd.addColorStop(0, shade(def.colour, 0.55));
        grd.addColorStop(1, shade(def.colour, -0.62));
        hexPath(c, tw.x, tw.y, rr, rot);
        c.fillStyle = grd; c.fill();
        c.strokeStyle = shade(def.colour, sel ? 0.75 : 0.2);
        c.lineWidth = sel ? 2 : 1.2;
        c.stroke();

        if (tw.kind === 'well') {
            g.glow(c, tw.x, tw.y, twRange(g, tw) * 0.8, 'rgba(180,139,255,0.09)');
            var wp = 9 + Math.sin(g.t * 3) * 2 + (tw.lvl - 1) * 1.5;
            g.bloom(c, tw.x, tw.y, wp * 2.6, 'rgba(180,139,255,0.32)');
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.strokeStyle = def.colour;
            c.lineWidth = 2;
            var o1 = tw.spin;
            c.beginPath(); c.arc(tw.x, tw.y, rr + 5, o1, o1 + 2.1); c.stroke();
            c.beginPath(); c.arc(tw.x, tw.y, rr + 5, o1 + 3.1416, o1 + 5.24); c.stroke();
            // Counter-rotating inner ring: a well is a machine, not a lamp.
            var o2 = -tw.spin * 1.8;
            c.lineWidth = 1.6;
            c.strokeStyle = shade(def.colour, 0.45);
            c.beginPath(); c.arc(tw.x, tw.y, Math.max(2, rr - 3), o2, o2 + 2.6); c.stroke();
            c.beginPath(); c.arc(tw.x, tw.y, Math.max(2, rr - 3), o2 + 3.1416, o2 + 5.74); c.stroke();
            c.restore();
        } else {
            var bl = def.bl + (tw.lvl - 1) * 2;
            var recoil = tw.flash * 3;
            c.save();
            c.translate(tw.x, tw.y);
            c.rotate(tw.ang);
            // Lit top, shadowed underside, hot muzzle: enough to read as a
            // barrel at 19px rather than a rectangle stuck to a dot.
            c.fillStyle = shade(def.colour, 0.12);
            c.fillRect(-recoil, -def.bw / 2, bl, def.bw);
            c.fillStyle = shade(def.colour, -0.55);
            c.fillRect(-recoil, 0, bl, def.bw / 2);
            c.fillStyle = shade(def.colour, 0.75);
            c.fillRect(bl - 3.5 - recoil, -def.bw / 2, 3.5, def.bw);
            c.strokeStyle = 'rgba(4,8,18,0.75)';
            c.lineWidth = 0.8;
            c.strokeRect(-recoil, -def.bw / 2, bl, def.bw);
            if (tw.flash > 0) {
                c.globalCompositeOperation = 'lighter';
                c.globalAlpha = tw.flash;
                c.fillStyle = '#ffffff';
                var mf = bl - recoil;
                c.beginPath();
                c.moveTo(mf + 11 * tw.flash, 0);
                c.lineTo(mf, -4.5 * tw.flash - 1);
                c.lineTo(mf, 4.5 * tw.flash + 1);
                c.closePath(); c.fill();
                c.globalAlpha = 1;
                c.globalCompositeOperation = 'source-over';
            }
            c.restore();
        }

        // Emitter core — spikes on every shot, settles back in 0.08s.
        g.bloom(c, tw.x, tw.y, 10 + 12 * tw.flash, def.colour);

        for (var lv = 1; lv < tw.lvl; lv++) {
            var pa = -1.5708 + (lv - 1) * 2.0944;
            c.fillStyle = shade(def.colour, 0.65);
            c.beginPath();
            c.arc(tw.x + Math.cos(pa) * (rr + 5), tw.y + Math.sin(pa) * (rr + 5), 1.8, 0, 6.2832);
            c.fill();
        }
    }

    function drawPalette(g, c, s) {
        var pal = palette(g);
        var fs = pal.bw < 104 ? 10 : 11;
        for (var b = 0; b < KINDS.length; b++) {
            var kd = TOWERS[KINDS[b]];
            var bx = pal.x0 + b * (pal.bw + pal.gap);
            var on = s.picked === KINDS[b];
            var can = s.salvage >= kd.cost;
            if (on) g.bloom(c, bx + pal.bw / 2, pal.y + pal.bh / 2, pal.bw * 0.55, 'rgba(255,255,255,0.06)');
            c.fillStyle = on ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
            c.strokeStyle = can ? kd.colour : 'rgba(255,255,255,0.15)';
            c.lineWidth = on ? 2.4 : 1;
            rrectPath(c, bx, pal.y, pal.bw, pal.bh, 10);
            c.fill(); c.stroke();

            c.textAlign = 'center';
            c.font = font(fs);
            c.fillStyle = can ? '#e8eefc' : 'rgba(232,238,252,0.4)';
            c.fillText(kd.name, bx + pal.bw / 2, pal.y + 17);
            c.fillStyle = can ? kd.colour : 'rgba(232,238,252,0.35)';
            c.fillText((b + 1) + ' · ' + kd.cost, bx + pal.bw / 2, pal.y + 32);
            c.textAlign = 'left';
        }
    }

    function drawPanel(g, c, tw) {
        var r = panelRect(g, tw);
        var def = TOWERS[tw.kind];
        var maxed = tw.lvl >= MAX_LVL;
        var cost = upCost(tw);
        var afford = g.s.salvage >= cost && !maxed;

        c.save();
        c.fillStyle = 'rgba(6,12,26,0.88)';
        c.strokeStyle = def.colour;
        c.lineWidth = 1.4;
        rrectPath(c, r.x, r.y, r.w, r.h, 12);
        c.fill(); c.stroke();

        c.textAlign = 'left';
        c.font = font(11);
        c.fillStyle = '#e8eefc';
        c.fillText(def.name + ' · LVL ' + tw.lvl, r.x + 10, r.y + 17);
        c.fillStyle = 'rgba(232,238,252,0.55)';
        c.textAlign = 'right';
        c.fillText(tw.kind === 'well'
            ? Math.round(twSlow(tw) * 100) + '% SLOW'
            : Math.round(twDps(tw)) + ' DPS', r.x + r.w - 10, r.y + 17);

        c.textAlign = 'center';
        c.fillStyle = afford ? 'rgba(90,215,255,0.16)' : 'rgba(255,255,255,0.05)';
        c.strokeStyle = afford ? '#5ad7ff' : 'rgba(255,255,255,0.16)';
        c.lineWidth = 1;
        rrectPath(c, r.up.x, r.up.y, r.up.w, r.up.h, 8); c.fill(); c.stroke();
        c.fillStyle = afford ? '#e8eefc' : 'rgba(232,238,252,0.4)';
        c.font = font(10);
        c.fillText(maxed ? 'MAX LEVEL' : 'UPGRADE ' + cost, r.up.x + r.up.w / 2, r.up.y + 14);

        c.fillStyle = 'rgba(141,255,160,0.13)';
        c.strokeStyle = '#8dffa0';
        rrectPath(c, r.sell.x, r.sell.y, r.sell.w, r.sell.h, 8); c.fill(); c.stroke();
        c.fillStyle = '#e8eefc';
        c.fillText('SELL +' + sellValue(tw), r.sell.x + r.sell.w / 2, r.sell.y + 14);
        c.textAlign = 'left';
        c.restore();
    }

    function draw(g, c) {
        var s = g.s;
        if (!s || !s.towers) return;
        var cx = g.w / 2, cy = g.h / 2;
        var live = g.running;
        g.space(c, { bg: '#03060f' });

        /* orbits */
        for (var i = 0; i < RINGS; i++) {
            var rx = rxAt(g, i), ry = ryAt(g, i);
            c.strokeStyle = 'rgba(90,215,255,0.12)';
            c.lineWidth = 22;
            ellipsePath(c, cx, cy, rx, ry); c.stroke();
            c.strokeStyle = 'rgba(90,215,255,0.32)';
            c.lineWidth = 1;
            ellipsePath(c, cx, cy, rx, ry); c.stroke();
            // Drifting ticks: the orbits read as moving lanes, not painted lines.
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.fillStyle = '#5ad7ff';
            var dir = i % 2 ? -1 : 1;
            for (var d = 0; d < 26; d++) {
                var ta = (d / 26) * 6.2832 + g.t * (0.05 + i * 0.018) * dir;
                c.globalAlpha = 0.12 + 0.22 * Math.abs(Math.sin(ta * 3 + g.t * 0.6));
                c.fillRect(cx + Math.cos(ta) * rx - 1, cy + Math.sin(ta) * ry - 1, 2, 2);
            }
            c.restore();
            c.globalAlpha = 1;
        }

        drawEarth(g, c, cx, cy);
        var ER = earthR(g);

        /* health arc */
        c.strokeStyle = s.hp < 5 ? '#ff8b8b' : '#64ffda';
        c.lineWidth = 4;
        c.beginPath();
        c.arc(cx, cy, ER + 8, -1.5708, -1.5708 + 6.2832 * Math.max(0, s.hp / HP_MAX));
        c.stroke();

        /* countdown arc — the lull between waves is a timer, not a hang */
        var lull = s.spawnLeft <= 0 && s.rocks.length === 0;
        if (live && !s.demo && lull) {
            var frac = g.clamp(s.between / LULL, 0, 1);
            c.save();
            c.globalCompositeOperation = 'lighter';
            c.strokeStyle = '#5ad7ff';
            c.lineWidth = 3;
            c.lineCap = 'round';
            c.globalAlpha = 0.85;
            c.beginPath();
            c.arc(cx, cy, ER + 16, -1.5708, -1.5708 + 6.2832 * frac);
            c.stroke();
            c.restore();
            c.globalAlpha = 1;
            c.font = font(12);
            c.textAlign = 'center';
            c.fillStyle = '#5ad7ff';
            c.fillText('NEXT WAVE ' + Math.max(0, Math.ceil(s.between)) + 's', cx, cy + ER + 36);
            c.textAlign = 'left';
        }

        /* wave shockwave, expanding along the field's own shape */
        c.save();
        c.globalCompositeOperation = 'lighter';
        for (var pu = 0; pu < s.pulses.length; pu++) {
            var pl = s.pulses[pu];
            var pp = pl.age / 1.1, pf = 1 - pp;
            c.strokeStyle = 'rgba(90,215,255,' + (0.55 * pf) + ')';
            c.lineWidth = 3 * pf + 0.5;
            ellipsePath(c, cx, cy,
                ER + pp * (rxAt(g, SPAWN_U) - ER),
                ER + pp * (ryAt(g, SPAWN_U) - ER));
            c.stroke();
        }
        c.restore();

        /* where the ghost would land — computed before the towers so their
           range rings can fade up while you are actually placing */
        var ghost = null;
        if (live) {
            if (s.cur.on) ghost = { ring: s.cur.ring, a: s.cur.a, kb: true };
            // Hovering a tower means you are reading that tower, not siting a
            // new one; stacking a ghost on top of it just makes both illegible.
            else if (!towerAt(g, g.pointer.x, g.pointer.y)) {
                var n = nearestRing(g, g.pointer.x, g.pointer.y);
                if (n.gap < 60) ghost = { ring: n.ring, a: n.a, kb: false };
            }
        }

        /* towers */
        for (var t = 0; t < s.towers.length; t++) {
            var tw = s.towers[t];
            var def = TOWERS[tw.kind];
            var sel = s.sel === tw;
            var near = live && g.dist(g.pointer.x, g.pointer.y, tw.x, tw.y) < 24;
            // Twelve permanent range rings turned the board into spaghetti.
            // Show one when you ask for it, or all of them faintly while building.
            if (near || sel || ghost) {
                c.save();
                c.globalAlpha = (near || sel) ? 0.5 : 0.1;
                c.strokeStyle = def.colour;
                c.lineWidth = 1;
                if (near || sel) c.setLineDash([5, 5]);
                c.beginPath(); c.arc(tw.x, tw.y, twRange(g, tw), 0, 6.2832); c.stroke();
                c.setLineDash([]);
                c.restore();
                c.globalAlpha = 1;
            }
            drawTower(g, c, tw, sel);

            if (tw.target) {
                var beamA = Math.max(0, 1 - (FIRE_COOL - tw.cool) / 0.12);
                if (beamA > 0) {
                    var mx = tw.x + Math.cos(tw.ang) * (def.bl || 0);
                    var my = tw.y + Math.sin(tw.ang) * (def.bl || 0);
                    c.save();
                    c.globalCompositeOperation = 'lighter';
                    c.globalAlpha = beamA;
                    c.strokeStyle = def.colour;
                    c.lineWidth = 2 + (tw.lvl - 1) * 0.6;
                    c.beginPath(); c.moveTo(mx, my); c.lineTo(tw.target.x, tw.target.y); c.stroke();
                    c.globalAlpha = beamA * 0.5;
                    c.strokeStyle = '#ffffff';
                    c.lineWidth = 0.9;
                    c.beginPath(); c.moveTo(mx, my); c.lineTo(tw.target.x, tw.target.y); c.stroke();
                    c.restore();
                    c.globalAlpha = beamA * 0.7;
                    g.bloom(c, tw.target.x, tw.target.y, 17, def.colour);
                    c.globalAlpha = 1;
                }
            }
        }

        /* rocks */
        for (var k = 0; k < s.rocks.length; k++) {
            var r = s.rocks[k];
            var ox = r.x - cx, oy = r.y - cy;
            var ol = Math.max(1, Math.hypot(ox, oy));
            ox /= ol; oy /= ol;

            c.save();
            c.globalCompositeOperation = 'lighter';
            var tg = c.createLinearGradient(r.x, r.y, r.x + ox * r.size * 2.4, r.y + oy * r.size * 2.4);
            tg.addColorStop(0, 'rgba(255,170,110,0.30)');
            tg.addColorStop(1, 'rgba(255,170,110,0)');
            c.strokeStyle = tg;
            c.lineWidth = r.size * 0.8;
            c.lineCap = 'round';
            c.beginPath();
            c.moveTo(r.x, r.y);
            c.lineTo(r.x + ox * r.size * 2.4, r.y + oy * r.size * 2.4);
            c.stroke();
            c.lineCap = 'butt';
            c.restore();

            c.save(); c.translate(r.x, r.y); c.rotate(r.rot);
            var lo = -2.356 - r.rot;
            var rg = c.createRadialGradient(
                Math.cos(lo) * r.size * 0.5, Math.sin(lo) * r.size * 0.5,
                r.size * 0.15, 0, 0, r.size * 1.35);
            if (r.size > 16) { rg.addColorStop(0, '#b7a388'); rg.addColorStop(1, '#6b5743'); }
            else { rg.addColorStop(0, '#a89f8a'); rg.addColorStop(1, '#5d574a'); }
            c.fillStyle = rg;
            g.rockPath(c, r.size, r.seed);
            c.fill();
            if (r.slow > 0) { c.fillStyle = 'rgba(180,139,255,0.3)'; c.fill(); }
            if (r.hit > 0) {
                c.globalCompositeOperation = 'lighter';
                c.fillStyle = 'rgba(255,255,255,' + (r.hit / 0.12 * 0.35) + ')';
                c.fill();
            }
            c.restore();

            c.fillStyle = 'rgba(0,0,0,0.5)';
            c.fillRect(r.x - r.size, r.y - r.size - 8, r.size * 2, 3);
            c.fillStyle = r.hp / r.max < 0.35 ? '#ffd35a' : '#8dffa0';
            c.fillRect(r.x - r.size, r.y - r.size - 8, r.size * 2 * Math.max(0, r.hp / r.max), 3);
        }

        /* salvage floaters */
        c.textAlign = 'center';
        c.font = font(12);
        for (var pz = 0; pz < s.pops.length; pz++) {
            var po = s.pops[pz];
            var pa = Math.max(0, 1 - po.age / 0.9);
            c.globalAlpha = pa;
            c.fillStyle = '#8dffa0';
            c.fillText(po.txt, po.x, po.y - 14 - po.age * 26);
        }
        c.globalAlpha = 1;
        c.textAlign = 'left';

        /* placement ghost */
        if (ghost) {
            var gd = TOWERS[s.picked];
            var gx = cx + Math.cos(ghost.a) * rxAt(g, ghost.ring);
            var gy = cy + Math.sin(ghost.a) * ryAt(g, ghost.ring);
            var afford = s.salvage >= gd.cost;
            c.save();
            c.globalAlpha = afford ? 0.6 : 0.22;
            c.strokeStyle = gd.colour;
            c.lineWidth = 1.5;
            c.setLineDash([6, 6]);
            c.beginPath(); c.arc(gx, gy, baseRange(g, s.picked), 0, 6.2832); c.stroke();
            c.setLineDash([]);
            hexPath(c, gx, gy, 9, gd.slow ? g.t * 0.25 : 0.5236);
            c.fillStyle = gd.colour;
            c.globalAlpha = afford ? 0.42 : 0.16;
            c.fill();
            c.globalAlpha = afford ? 0.9 : 0.3;
            c.stroke();
            if (ghost.kb) {
                // The keyboard cursor needs to be findable at a glance.
                c.globalAlpha = 0.55 + 0.25 * Math.sin(g.t * 6);
                c.beginPath(); c.arc(gx, gy, 17, 0, 6.2832); c.stroke();
                c.globalAlpha = 1;
                c.textAlign = 'center';
                c.font = font(10);
                c.fillStyle = gd.colour;
                c.fillText('ENTER', gx, gy + 32);
                c.textAlign = 'left';
            }
            c.restore();
            c.globalAlpha = 1;
        }

        if (live) {
            drawPalette(g, c, s);
            if (s.sel) drawPanel(g, c, s.sel);
        }
    }

    var api = Arcade.create({
        slug: 'planet-defense',
        title: 'PLANET DEFENSE',
        accent: '#5ad7ff',
        tagline: 'Asteroids fall inward down the orbit rings. Drop lasers, flak and gravity wells onto the rings to stop them. Wells do no damage — they buy your lasers more time, which is usually worth more.',
        controls: [
            ['CLICK RING', 'place the selected tower'],
            ['CLICK TOWER', 'upgrade or sell it'],
            ['1 / 2 / 3', 'laser · gravity well · flak'],
            ['← →  ·  TAB', 'move build cursor · change orbit'],
            ['ENTER  ·  U / X', 'place · upgrade / sell']
        ],
        scoreLabel: 'SCORE',
        overTitle: 'EARTH LOST',
        init: init,
        initMenu: initMenu,
        idle: idle,
        update: update,
        draw: draw,
        pointerDown: pointerDown,
        pointerMove: pointerMove,
        keyDown: keyDown
    });

    // Tab is a build control here; without this it walks focus out of the
    // canvas and onto the topbar links mid-wave.
    window.addEventListener('keydown', function (e) {
        if (e.code === 'Tab' && api && api.g && api.g.running) e.preventDefault();
    }, true);
})();

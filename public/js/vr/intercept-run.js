const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function raySphereDistance(origin, dir, cx, cy, cz, radius) {
    const ocX = cx - origin.x;
    const ocY = cy - origin.y;
    const ocZ = cz - origin.z;
    const proj = ocX * dir.x + ocY * dir.y + ocZ * dir.z;
    if (proj < 0) return null;
    const distSq = ocX * ocX + ocY * ocY + ocZ * ocZ - proj * proj;
    if (distSq > radius * radius) return null;
    return proj;
}

export const INTERCEPT_WAVES = Object.freeze([
    { wave: 1, title: 'Meteor Squall', entries: ['meteor', 'meteor', 'meteor', 'meteor', 'meteor', 'meteor'] },
    { wave: 2, title: 'Rogue Scout Swarm', entries: ['scout', 'scout', 'meteor', 'scout', 'scout', 'scout'] },
    { wave: 3, title: 'Magma Shatter', entries: ['magma', 'scout', 'magma', 'magma', 'scout', 'magma'] },
    { wave: 4, title: 'Heavy Vanguard', entries: ['heavy', 'scout', 'heavy', 'heavy', 'scout', 'heavy'] },
    { wave: 5, title: 'Orbital Siege Core', entries: ['boss'] }
]);

/** Deterministic wave-based dual-wield VR combat simulation for Meta Quest 3. */
export class InterceptRun {
    constructor(random = Math.random) {
        this.random = random;
        this.reset();
    }

    reset() {
        this.state = 'ready';
        this.countdown = 3;
        this.elapsed = 0;
        this.wave = 1;
        this.hull = 100;
        this.empCharge = 25;
        this.railCharge = 0;
        this.score = 0;
        this.combo = 0;
        this.bestCombo = 0;
        this.kills = 0;
        this.deflections = 0;
        this.x = 0;
        this.vx = 0;
        this.serial = 0;
        this.targets = [];
        this.enemyShots = [];
        this.playerShots = [];
        this.waveQueue = [];
        this.spawnTimer = 0.6;
        this.waveBannerTimer = 0;
        this.events = [];
        this.result = '';
    }

    emit(type, payload = {}) {
        this.events.push({ type, ...payload });
    }

    play() {
        if (this.state === 'playing' || this.state === 'countdown') return;
        if (this.state === 'won' || this.state === 'lost') this.reset();
        this.state = 'countdown';
        this.countdown = 3;
    }

    pause() {
        if (this.state === 'playing' || this.state === 'countdown') this.state = 'paused';
    }

    _beginWave(waveNum) {
        this.wave = waveNum;
        const spec = INTERCEPT_WAVES[waveNum - 1];
        this.waveQueue = spec ? [...spec.entries] : [];
        this.spawnTimer = 0.45;
        this.waveBannerTimer = 2.6;
        this.emit('wave-start', { wave: waveNum, title: spec?.title || '' });
    }

    _spawnEntry(kind) {
        const id = ++this.serial;
        const rx = (this.random() * 2 - 1);
        const ry = (this.random() * 2 - 1);

        if (kind === 'boss') {
            const boss = {
                id,
                kind: 'boss',
                x: 0,
                y: 1.5,
                z: -15,
                vx: 0,
                vy: 0,
                vz: 0,
                hp: 10,
                maxHp: 10,
                radius: 1.75,
                fireTimer: 1.8,
                phase: 0
            };
            this.targets.push(boss);
            for (let p = 0; p < 3; p++) {
                this.targets.push({
                    id: ++this.serial,
                    kind: 'pylon',
                    parentId: id,
                    orbitAngle: (p * Math.PI * 2) / 3,
                    x: Math.cos((p * Math.PI * 2) / 3) * 3.1,
                    y: 1.5 + Math.sin((p * Math.PI * 2) / 3) * 2.2,
                    z: -14.2,
                    hp: 2,
                    maxHp: 2,
                    radius: 0.72,
                    fireTimer: 99
                });
            }
            return;
        }

        if (kind === 'meteor' || kind === 'magma') {
            this.targets.push({
                id,
                kind,
                x: rx * 5.8,
                y: 0.4 + this.random() * 2.4,
                z: -34,
                vx: -rx * 0.4,
                vy: -0.1,
                vz: kind === 'magma' ? 5.8 : 6.8 + this.wave * 0.5,
                hp: 1,
                maxHp: 1,
                radius: kind === 'magma' ? 1.15 : 0.95,
                fireTimer: 99
            });
            return;
        }

        const isHeavy = kind === 'heavy';
        this.targets.push({
            id,
            kind,
            x: rx * 6.0,
            y: 0.8 + Math.abs(ry) * 2.2,
            z: -28,
            vx: (id % 2 ? 1 : -1) * (isHeavy ? 1.5 : 2.6),
            vy: 0,
            vz: isHeavy ? 2.1 : 2.8,
            hp: isHeavy ? 3 : 1,
            maxHp: isHeavy ? 3 : 1,
            armored: isHeavy,
            radius: isHeavy ? 1.15 : 0.88,
            fireTimer: isHeavy ? 1.7 : 2.1,
            phase: id * 1.3
        });
    }

    _damageTarget(target, dmg, armoredBreak = false) {
        if (!target || target.hp <= 0) return false;
        if (target.kind === 'boss') {
            const activePylons = this.targets.some(t => t.kind === 'pylon' && t.parentId === target.id && t.hp > 0);
            if (activePylons) {
                this.emit('boss-shielded', { x: target.x, y: target.y, z: target.z });
                return false;
            }
        }
        const applied = target.armored && !armoredBreak ? Math.min(dmg, 1) : dmg;
        if (armoredBreak) target.armored = false;
        target.hp = Math.max(0, target.hp - applied);
        if (target.hp > 0) {
            this.emit('target-hit', { x: target.x, y: target.y, z: target.z, kind: target.kind });
            return false;
        }

        // Destroyed
        this.kills += 1;
        this.combo += 1;
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        const basePts = target.kind === 'boss' ? 2000 : target.kind === 'heavy' ? 400 : target.kind === 'pylon' ? 450 : target.kind === 'magma' ? 220 : 180;
        this.score += basePts + Math.min(this.combo - 1, 12) * 35;
        this.empCharge = Math.min(100, this.empCharge + (target.kind === 'heavy' ? 16 : 9));
        this.emit('target-destroyed', { x: target.x, y: target.y, z: target.z, kind: target.kind });

        if (target.kind === 'magma') {
            for (const side of [-1, 1]) {
                this.targets.push({
                    id: ++this.serial,
                    kind: 'shard',
                    x: target.x + side * 0.7,
                    y: target.y + 0.25,
                    z: target.z,
                    vx: side * 1.4,
                    vy: 0.1,
                    vz: 8.2,
                    hp: 1,
                    maxHp: 1,
                    radius: 0.68,
                    fireTimer: 99
                });
            }
        }
        return true;
    }

    fireBlaster(origin, dir, charged = false) {
        if (this.state !== 'playing' || !origin || !dir) return { hit: false, hits: [] };
        const hits = [];
        const candidates = [];
        for (const t of this.targets) {
            if (t.hp <= 0) continue;
            const d = raySphereDistance(origin, dir, t.x, t.y, t.z, t.radius + (charged ? 0.45 : 0.35));
            if (d !== null) candidates.push({ target: t, dist: d });
        }
        candidates.sort((a, b) => a.dist - b.dist);

        if (charged) {
            this.emit('railgun', { origin, dir });
            for (const c of candidates) {
                this._damageTarget(c.target, 3, true);
                hits.push(c.target);
            }
        } else {
            this.emit('laser', { origin, dir });
            if (candidates.length > 0) {
                const primary = candidates[0].target;
                this._damageTarget(primary, 1, false);
                hits.push(primary);
            }
        }

        this.targets = this.targets.filter(t => t.hp > 0);
        this.playerShots.push({
            id: ++this.serial,
            x: origin.x,
            y: origin.y,
            z: origin.z,
            dx: dir.x,
            dy: dir.y,
            dz: dir.z,
            charged,
            ttl: charged ? 0.28 : 0.14
        });
        return { hit: hits.length > 0, hits };
    }

    deflectWithShield(shieldPos, _shieldNormal = null, shieldRadius = 0.55) {
        if (this.state !== 'playing' || !shieldPos) return 0;
        let deflected = 0;
        const keep = [];
        for (const shot of this.enemyShots) {
            const dist = Math.hypot(shot.x - shieldPos.x, shot.y - shieldPos.y, shot.z - shieldPos.z);
            if (dist <= shieldRadius + 0.35 && shot.z > -4.0) {
                deflected += 1;
                this.deflections += 1;
                this.score += 200;
                this.empCharge = Math.min(100, this.empCharge + 22);
                this.emit('shield-block', { x: shot.x, y: shot.y, z: shot.z });
                // Deflected plasma bolt snaps back at the nearest active target!
                const nearest = this.targets.find(t => t.hp > 0);
                if (nearest) {
                    this._damageTarget(nearest, 3, true);
                    this.playerShots.push({
                        id: ++this.serial,
                        x: shot.x,
                        y: shot.y,
                        z: shot.z,
                        tx: nearest.x,
                        ty: nearest.y,
                        tz: nearest.z,
                        deflected: true,
                        ttl: 0.22
                    });
                }
            } else {
                keep.push(shot);
            }
        }
        this.enemyShots = keep;
        this.targets = this.targets.filter(t => t.hp > 0);
        return deflected;
    }

    triggerEMP() {
        if (this.state !== 'playing' || this.empCharge < 100) return false;
        const clearedShots = this.enemyShots.length;
        this.enemyShots = [];
        this.score += clearedShots * 60 + 350;
        for (const t of this.targets) {
            this._damageTarget(t, 2, true);
        }
        this.targets = this.targets.filter(t => t.hp > 0);
        this.empCharge = 0;
        this.emit('emp', { clearedShots });
        return true;
    }

    update(dt, input = {}) {
        if (!Number.isFinite(dt) || dt <= 0) return;
        dt = Math.min(dt, 0.05);
        this.events = [];

        if (this.state === 'countdown') {
            const prevSec = Math.ceil(this.countdown);
            this.countdown = Math.max(0, this.countdown - dt);
            const nextSec = Math.ceil(this.countdown);
            if (nextSec !== prevSec && nextSec > 0) this.emit('countdown', { n: nextSec });
            if (this.countdown < 0.00001) {
                this.state = 'playing';
                this._beginWave(1);
                this.emit('go');
            }
            return;
        }
        if (this.state !== 'playing') return;

        this.elapsed += dt;
        this.waveBannerTimer = Math.max(0, this.waveBannerTimer - dt);

        // Strafe platform with Left Stick X
        const stickX = Number.isFinite(input.x) ? clamp(input.x, -1, 1) : 0;
        this.vx += (stickX * 4.5 - this.vx) * (1 - Math.exp(-dt * 10));
        this.x = clamp(this.x + this.vx * dt, -3.5, 3.5);

        // Charge rail-lance if Right Grip held
        if (input.chargeHeld) {
            this.railCharge = clamp(this.railCharge + dt / 0.7, 0, 1);
        } else {
            this.railCharge = Math.max(0, this.railCharge - dt * 4);
        }

        // Decay visual shots
        for (const ps of this.playerShots) ps.ttl -= dt;
        this.playerShots = this.playerShots.filter(ps => ps.ttl > 0);

        // Spawn next enemy from wave queue
        if (this.waveQueue.length > 0) {
            this.spawnTimer -= dt;
            if (this.spawnTimer <= 0) {
                const next = this.waveQueue.shift();
                this._spawnEntry(next);
                this.spawnTimer = this.wave === 1 ? 1.45 : this.wave === 4 ? 1.85 : 1.55;
            }
        }

        // Advance active targets
        const boss = this.targets.find(t => t.kind === 'boss');
        for (const t of this.targets) {
            if (t.kind === 'pylon' && boss) {
                t.orbitAngle += dt * 1.1;
                t.x = boss.x + Math.cos(t.orbitAngle) * 3.1;
                t.y = boss.y + Math.sin(t.orbitAngle) * 2.1;
                t.z = boss.z + 0.8;
                continue;
            }
            if (t.kind === 'boss') {
                t.phase += dt;
                t.x = Math.sin(t.phase * 0.55) * 3.2;
                t.fireTimer -= dt;
                if (t.fireTimer <= 0) {
                    t.fireTimer = 2.2;
                    for (const spread of [-0.9, 0, 0.9]) {
                        this._spawnEnemyShot(t, spread);
                    }
                }
                continue;
            }

            if (t.kind === 'scout' || t.kind === 'heavy') {
                t.phase += dt;
                t.x = clamp(t.x + t.vx * dt, -6.5, 6.5);
                if (Math.abs(t.x) >= 6.4) t.vx *= -1;
                if (t.z < -8.5) t.z += t.vz * dt;
                t.fireTimer -= dt;
                if (t.fireTimer <= 0) {
                    t.fireTimer = t.kind === 'heavy' ? 2.1 : 2.5;
                    this._spawnEnemyShot(t, 0);
                }
            } else {
                t.x += (t.vx || 0) * dt;
                t.y += (t.vy || 0) * dt;
                t.z += (t.vz || 0) * dt;
            }

            if (t.z >= -1.2) {
                t.hp = 0;
                this._applyHullDamage(t.kind === 'magma' ? 18 : 14);
            }
        }
        this.targets = this.targets.filter(t => t.hp > 0);

        // Advance enemy plasma bolts toward player's platform
        const nextShots = [];
        for (const s of this.enemyShots) {
            s.x += s.vx * dt;
            s.y += s.vy * dt;
            s.z += s.vz * dt;
            if (s.z >= -0.3) {
                if (Math.abs(s.x - this.x) < 1.45) {
                    this._applyHullDamage(10);
                }
                continue;
            }
            nextShots.push(s);
        }
        this.enemyShots = nextShots;

        if (this.state !== 'playing') return;

        // Wave clear check
        if (this.waveQueue.length === 0 && this.targets.length === 0) {
            if (this.wave >= INTERCEPT_WAVES.length) {
                this.score += Math.round(this.hull * 20);
                this.state = 'won';
                this.result = 'Orbital sector defended!';
                this.emit('won', { score: this.score });
            } else {
                this._beginWave(this.wave + 1);
            }
        }
    }

    _spawnEnemyShot(source, spreadX = 0) {
        const tx = this.x + spreadX;
        const ty = 0.05;
        const tz = -0.3;
        const dx = tx - source.x;
        const dy = ty - source.y;
        const dz = tz - source.z;
        const len = Math.max(0.001, Math.hypot(dx, dy, dz));
        const speed = this.wave === 5 ? 9.5 : 8.5;
        this.enemyShots.push({
            id: ++this.serial,
            x: source.x,
            y: source.y,
            z: source.z,
            vx: (dx / len) * speed,
            vy: (dy / len) * speed,
            vz: (dz / len) * speed
        });
    }

    _applyHullDamage(amount) {
        this.hull = Math.max(0, this.hull - amount);
        this.combo = 0;
        this.emit('hull-hit', { hull: this.hull });
        if (this.hull <= 0) {
            this.state = 'lost';
            this.result = 'Defense platform hull breached.';
            this.emit('lost', { score: this.score });
        }
    }

    status() {
        if (this.state === 'won' || this.state === 'lost') {
            return `${this.result} · ${this.score.toLocaleString()} pts`;
        }
        if (this.state === 'ready') {
            return 'Right Trigger: Blaster · Right Grip: Rail-Lance · Left Trigger: Aegis Shield · Left Grip: EMP';
        }
        if (this.state === 'countdown') return 'Arm Touch Plus Blaster & Aegis Shield · Stand by';
        return `WAVE ${this.wave}/${INTERCEPT_WAVES.length} · HULL ${this.hull}% · EMP ${Math.floor(this.empCharge)}% · ${this.score.toLocaleString()} pts · ${this.combo}×`;
    }
}

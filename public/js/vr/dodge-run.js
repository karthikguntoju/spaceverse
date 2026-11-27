const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const DODGE_LEVELS = Object.freeze({
    practice: { duration: 35, shields: 5, speed: 11.5, acceleration: 0.06, interval: 2.25, minimum: 1.7 },
    normal: { duration: 60, shields: 3, speed: 15, acceleration: 0.14, interval: 1.65, minimum: 0.95 },
    expert: { duration: 75, shields: 3, speed: 17, acceleration: 0.16, interval: 1.35, minimum: 0.78 }
});

function raySphereHit(origin, dir, cx, cy, cz, radius) {
    const ocX = cx - origin.x;
    const ocY = cy - origin.y;
    const ocZ = cz - origin.z;
    const proj = ocX * dir.x + ocY * dir.y + ocZ * dir.z;
    if (proj < 0) return null;
    const distSq = ocX * ocX + ocY * ocY + ocZ * ocZ - proj * proj;
    if (distSq > radius * radius) return null;
    return proj;
}

/** Meta Quest 3 lane-dodger + Touch Plus phase-shield & crystal blaster. */
export class DodgeRun {
    constructor(random = Math.random) {
        this.random = random;
        this.difficulty = 'normal';
        this.reset();
    }

    reset() {
        this.level = DODGE_LEVELS[this.difficulty];
        this.duration = this.level.duration;
        this.state = 'ready';
        this.elapsed = 0;
        this.countdown = 3;
        this.shields = this.level.shields;
        this.hits = 0;
        this.dodged = 0;
        this.x = 0;
        this.streak = 0;
        this.bestStreak = 0;
        this.score = 0;
        this.hazards = [];
        this.crystals = [];
        this.nextSpawn = 0;
        this.nextCrystal = 3.2;
        this.serial = 0;
        this.phaseTimer = 0;
        this.phaseCooldown = 0;
        this.blasterCooldown = 0;
        this.crystalsShot = 0;
        this.rocksBlasted = 0;
        this.events = [];
    }

    setDifficulty(name) {
        if (Object.hasOwn(DODGE_LEVELS, name)) this.difficulty = name;
    }

    get threat() {
        return this.hazards.reduce((nearest, hazard) => !nearest || hazard.z > nearest.z ? hazard : nearest, null);
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

    triggerPhase() {
        if (this.state !== 'playing' || this.phaseCooldown > 0 || this.phaseTimer > 0) return false;
        this.phaseTimer = 1.3;
        this.phaseCooldown = 6.0;
        this.events.push({ type: 'phase-on' });
        return true;
    }

    fireBlaster(origin, dir) {
        if (this.state !== 'playing' || !origin || !dir) return { hit: false };
        let bestCrystal = null;
        let bestDist = Infinity;
        for (const c of this.crystals) {
            const d = raySphereHit(origin, dir, c.x, c.y, c.z, 1.35);
            if (d !== null && d < bestDist) {
                bestDist = d;
                bestCrystal = c;
            }
        }
        if (bestCrystal) {
            this.crystals = this.crystals.filter(c => c !== bestCrystal);
            this.crystalsShot += 1;
            this.streak += 1;
            this.bestStreak = Math.max(this.bestStreak, this.streak);
            this.score += 250 + Math.min(this.streak - 1, 10) * 20;
            this.events.push({ type: 'crystal-hit', x: bestCrystal.x, y: bestCrystal.y, z: bestCrystal.z });
            return { hit: true, kind: 'crystal', target: bestCrystal };
        }

        if (this.blasterCooldown <= 0) {
            let bestRock = null;
            bestDist = Infinity;
            for (const h of this.hazards) {
                const d = raySphereHit(origin, dir, h.x, 0, h.z, 1.25);
                if (d !== null && d < bestDist) {
                    bestDist = d;
                    bestRock = h;
                }
            }
            if (bestRock) {
                this.hazards = this.hazards.filter(h => h !== bestRock);
                this.rocksBlasted += 1;
                this.blasterCooldown = 1.6;
                this.score += 150;
                this.events.push({ type: 'rock-shatter', x: bestRock.x, y: 0, z: bestRock.z });
                return { hit: true, kind: 'rock', target: bestRock };
            }
        }
        this.events.push({ type: 'blaster-miss' });
        return { hit: false };
    }

    update(dt, steering = 0) {
        if (!Number.isFinite(dt) || dt <= 0 || !['playing', 'countdown'].includes(this.state)) return;
        this.events = [];
        dt = Math.min(dt, 0.1);
        this.x += (clamp(Number.isFinite(steering) ? steering : 0, -1, 1) * 3.2 - this.x) * (1 - Math.exp(-dt * 8));
        if (this.state === 'countdown') {
            this.countdown = Math.max(0, this.countdown - dt);
            if (this.countdown <= 0.00001) {
                this.state = 'playing';
                this.events.push({ type: 'go' });
            }
            return;
        }
        this.elapsed = Math.min(this.duration, this.elapsed + dt);
        this.phaseTimer = Math.max(0, this.phaseTimer - dt);
        this.phaseCooldown = Math.max(0, this.phaseCooldown - dt);
        this.blasterCooldown = Math.max(0, this.blasterCooldown - dt);
        this.nextSpawn -= dt;
        this.nextCrystal -= dt;

        const speed = this.level.speed + this.elapsed * this.level.acceleration;
        if (this.nextSpawn <= 0 && this.elapsed + 63 / speed < this.duration) {
            this.hazards.push({
                id: ++this.serial,
                x: (Math.floor(clamp(this.random(), 0, 0.99999) * 3) - 1) * 3.2,
                z: -64,
                speed
            });
            this.nextSpawn = Math.max(this.level.minimum, this.level.interval - this.elapsed * 0.01);
        }

        if (this.nextCrystal <= 0 && this.crystals.length < 3 && this.elapsed + 4 < this.duration) {
            const lane = (Math.floor(clamp(this.random(), 0, 0.99999) * 3) - 1) * 3.2;
            this.crystals.push({
                id: ++this.serial,
                x: lane,
                y: 0.45 + (this.serial % 2) * 0.55,
                z: -58,
                speed: speed * 0.92
            });
            this.nextCrystal = 4.2;
        }

        for (const c of this.crystals) {
            c.z += c.speed * dt;
        }
        this.crystals = this.crystals.filter(c => c.z < -0.5);

        for (const hazard of this.hazards) {
            hazard.z += hazard.speed * dt;
            if (hazard.z < -1 || hazard.resolved) continue;
            hazard.resolved = true;
            if (Math.abs(hazard.x - this.x) < 1.2) {
                if (this.phaseTimer > 0) {
                    this.dodged++;
                    this.streak++;
                    this.bestStreak = Math.max(this.bestStreak, this.streak);
                    this.score += 150 + Math.min(this.streak - 1, 10) * 20;
                    this.events.push({ type: 'phase-dodge' });
                } else {
                    this.hits++;
                    this.shields--;
                    this.streak = 0;
                    this.events.push({ type: 'hit' });
                }
            } else {
                this.dodged++;
                this.streak++;
                this.bestStreak = Math.max(this.bestStreak, this.streak);
                this.score += 100 + Math.min(this.streak - 1, 10) * 20;
                this.events.push({ type: 'dodge' });
            }
            if (this.shields <= 0) {
                this.state = 'lost';
                this.events.push({ type: 'lost' });
                break;
            }
        }
        this.hazards = this.hazards.filter(h => !h.resolved);
        if (this.state === 'playing' && this.elapsed >= this.duration) {
            this.state = 'won';
            this.events.push({ type: 'won' });
        }
        if (this.state === 'won' || this.state === 'lost') {
            this.hazards = [];
            this.crystals = [];
        }
    }

    status() {
        if (this.state === 'won') return `Course cleared · ${this.score.toLocaleString()} pts · best ${this.bestStreak}×`;
        if (this.state === 'lost') return `Out of shields · ${this.score.toLocaleString()} pts`;
        if (this.state === 'ready') return 'Left Stick / Head: Steer · Left Trigger: Phase Shield · Right Trigger: Pulse Blaster';
        if (this.state === 'countdown') return 'Hold Touch Plus controllers · Ready';
        return `${Math.ceil(this.duration - this.elapsed)}s · ${this.shields} shields · ${this.score.toLocaleString()} pts · ${this.streak}×`;
    }
}

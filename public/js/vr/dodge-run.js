const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Local practice game. No leaderboard/XP submission or separate frame loop. */
export class DodgeRun {
    constructor(random = Math.random) { this.random = random; this.reset(); }
    reset() {
        this.state = 'ready'; this.elapsed = 0; this.countdown = 3;
        this.shields = 3; this.hits = 0; this.dodged = 0; this.x = 0;
        this.hazards = []; this.nextSpawn = 0; this.serial = 0;
    }
    play() {
        if (this.state === 'playing' || this.state === 'countdown') return;
        if (this.state === 'won' || this.state === 'lost') this.reset();
        this.state = 'countdown'; this.countdown = 3;
    }
    pause() {
        if (this.state === 'playing' || this.state === 'countdown') this.state = 'paused';
    }
    update(dt, steering = 0) {
        if (!Number.isFinite(dt) || dt <= 0 || !['playing', 'countdown'].includes(this.state)) return;
        dt = Math.min(dt, 0.1);
        this.x += (clamp(Number.isFinite(steering) ? steering : 0, -1, 1) * 3.2 - this.x) * (1 - Math.exp(-dt * 8));
        if (this.state === 'countdown') {
            this.countdown = Math.max(0, this.countdown - dt);
            if (this.countdown <= 0.00001) this.state = 'playing';
            return;
        }
        this.elapsed = Math.min(60, this.elapsed + dt);
        this.nextSpawn -= dt;
        if (this.nextSpawn <= 0 && this.elapsed < 56) {
            this.hazards.push({ id: ++this.serial, x: (Math.floor(clamp(this.random(), 0, 0.99999) * 3) - 1) * 3.2,
                z: -64, speed: 15 + this.elapsed * 0.14 });
            this.nextSpawn = Math.max(0.95, 1.65 - this.elapsed * 0.01);
        }
        for (const hazard of this.hazards) {
            hazard.z += hazard.speed * dt;
            if (hazard.z < -1 || hazard.resolved) continue;
            hazard.resolved = true;
            if (Math.abs(hazard.x - this.x) < 1.2) { this.hits++; this.shields--; }
            else this.dodged++;
            if (this.shields <= 0) { this.state = 'lost'; break; }
        }
        this.hazards = this.hazards.filter(h => !h.resolved);
        if (this.state === 'playing' && this.elapsed >= 60) this.state = 'won';
        if (this.state === 'won' || this.state === 'lost') this.hazards = [];
    }
}

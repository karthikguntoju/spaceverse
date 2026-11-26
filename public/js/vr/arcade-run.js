export const VR_GAMES = Object.freeze({
    'lunar-landing': {
        title: 'Lunar Landing',
        accent: '#cfe1ff',
        duration: 60,
        description: 'Pilot an open-canopy lunar lander onto PAD 01. Feather your retro engine with the right trigger and hold precision hover over craters.',
        controls: 'Left Stick: Lateral & fore/aft translation · Right Trigger: Analog retro burn · Left Grip: Hover stabilizer · A: Start / Pause'
    },
    'orbital-docking': {
        title: 'Orbital Docking',
        accent: '#80e8ff',
        duration: 90,
        description: 'Thread the orbital corridor into an ISS-class station. Match roll alignment, cancel lateral drift, and contact the collar below 0.65 m/s.',
        controls: 'Left Stick: Lateral & vertical RCS · Right Stick: Approach speed & roll · Triggers: Brake / Thrust · A: Start / Pause'
    },
    'satellite-repair': {
        title: 'Satellite Repair',
        accent: '#ffd196',
        duration: 90,
        description: 'Perform a 6DoF spacewalk outside an orbital observatory. Unbolt faulty bays, snatch replacement modules with your left claw, and weld them in.',
        controls: 'Right Trigger: Scan & weld faulty bay · Left Trigger: Grapple spare module · Left Stick: Pod sway · A: Start / Pause'
    },
    'mars-rover': {
        title: 'Mars Rover Expedition',
        accent: '#ffb281',
        duration: 90,
        description: 'Drive a pressurized Mars rover across Jezero canyon. Dodge basalt boulders, harvest solar energy crystals, and drill three core samples.',
        controls: 'Left Stick: Steer · Right Trigger: Throttle · Left Trigger: Brake · Right Grip / Trigger on beacon: Drill core · A: Start / Pause'
    },
    'space-rescue': {
        title: 'Space Rescue',
        accent: '#8ff2d9',
        duration: 70,
        description: 'Rendezvous with a tumbling astronaut in Earth orbit. Match velocity inside 11 m, lock your electromagnetic tether harpoon, and reel them home.',
        controls: 'Left Stick: Strafe MMU pod · Left Trigger (≤ 11 m): Match drift · Right Trigger: Fire tether harpoon · A: Start / Pause'
    }
});

export const VR_ARCADE_META = Object.freeze({
    'orbital-intercept': {
        slug: 'orbital-intercept',
        title: 'Orbital Intercept',
        kicker: 'META QUEST 3 EXCLUSIVE · DUAL WIELD',
        accent: '#64ffda',
        tiers: [2500, 7500, 16000],
        description: 'Dual-wield Touch Plus action in low Earth orbit. Deflect incoming plasma with your Left-Hand Aegis Holo-Shield and shatter waves of rogue drones, magma meteors, and the Orbital Siege Core.',
        questControls: {
            left: [
                'Left Trigger (Hold): Deploy Hex Aegis Shield & deflect bolts',
                'Left Stick: Strafe defense platform',
                'Left Grip (100%): Trigger EMP Shockwave',
                'Y Button / Stick Click: VR Pause Menu'
            ],
            right: [
                'Right Trigger: Fire Twin Plasma Blaster',
                'Right Grip (Hold + Release): Piercing Rail-Lance',
                'A Button: Start / Replay',
                'B Button: Recenter View'
            ]
        }
    },
    'asteroid-dodge': {
        slug: 'asteroid-dodge',
        title: 'Asteroid Dodge',
        kicker: 'META QUEST 3 EXCLUSIVE · REFLEX',
        accent: '#ffb46b',
        tiers: [1800, 5000, 11000],
        description: 'Bank through an illuminated Saturn-ring asteroid trench. Dodge boulders with stick or head lean, blast energy crystals for combo points, and trigger your Phase Shield in emergencies.',
        questControls: {
            left: [
                'Left Stick / Head Lean: Bank between lanes',
                'Left Trigger: Activate Phase Shield (1.3s invulnerability)',
                'Left Grip: VR Menu / Difficulty'
            ],
            right: [
                'Right Trigger: Fire Pulse Blaster (shatter crystals & rocks)',
                'Right Stick Click / B: Recenter View',
                'A Button: Start / Pause / Replay'
            ]
        }
    },
    'lunar-landing': {
        slug: 'lunar-landing',
        title: 'Lunar Landing',
        kicker: 'META QUEST 3 EXCLUSIVE · FLIGHT SIM',
        accent: '#cfe1ff',
        tiers: [1800, 2600, 3400],
        description: VR_GAMES['lunar-landing'].description,
        questControls: {
            left: [
                'Left Stick: Lateral & fore/aft RCS translation',
                'Left Trigger / Grip: Precision hover stabilizer',
                'Left Grip (Tap Menu): VR Menu'
            ],
            right: [
                'Right Trigger: Analog Retro Engine Throttle',
                'A Button: Start / Pause / Replay',
                'B Button: Recenter View'
            ]
        }
    },
    'orbital-docking': {
        slug: 'orbital-docking',
        title: 'Orbital Docking',
        kicker: 'META QUEST 3 EXCLUSIVE · PRECISION',
        accent: '#80e8ff',
        tiers: [1800, 2800, 3800],
        description: VR_GAMES['orbital-docking'].description,
        questControls: {
            left: [
                'Left Stick: X/Y RCS Translation',
                'Left Trigger: Fire Retro Brakes',
                'Left Grip: VR Menu'
            ],
            right: [
                'Right Stick: Roll Alignment & Closing Speed',
                'Right Trigger: Forward Thrust / Select Panel',
                'A Button: Start / Pause · B: Recenter'
            ]
        }
    },
    'satellite-repair': {
        slug: 'satellite-repair',
        title: 'Satellite Repair',
        kicker: 'META QUEST 3 EXCLUSIVE · EVA',
        accent: '#ffd196',
        tiers: [1800, 2600, 3500],
        description: VR_GAMES['satellite-repair'].description,
        questControls: {
            left: [
                'Left Trigger: Grapple Spare Module from Rack',
                'Left Stick: EVA Pod Sway',
                'Left Grip: VR Menu'
            ],
            right: [
                'Right Trigger (Hold): Scan Fault & Plasma Weld',
                'A Button: Start / Pause',
                'B Button: Recenter View'
            ]
        }
    },
    'mars-rover': {
        slug: 'mars-rover',
        title: 'Mars Rover Expedition',
        kicker: 'META QUEST 3 EXCLUSIVE · EXPEDITION',
        accent: '#ffb281',
        tiers: [1800, 2600, 3600],
        description: VR_GAMES['mars-rover'].description,
        questControls: {
            left: [
                'Left Stick: Steer Rover Across Canyon',
                'Left Trigger: Regenerative Brake',
                'Left Grip: VR Menu'
            ],
            right: [
                'Right Trigger: Drive Throttle / Drill Core Sample',
                'A Button: Start / Pause',
                'B Button: Recenter View'
            ]
        }
    },
    'space-rescue': {
        slug: 'space-rescue',
        title: 'Space Rescue',
        kicker: 'META QUEST 3 EXCLUSIVE · EVA RESCUE',
        accent: '#8ff2d9',
        tiers: [1600, 2400, 3200],
        description: VR_GAMES['space-rescue'].description,
        questControls: {
            left: [
                'Left Stick: Strafe Rescue Pod',
                'Left Trigger (≤ 11 m): Engage Drift Match',
                'Left Grip: VR Menu'
            ],
            right: [
                'Right Trigger: Fire Electromagnetic Tether Harpoon',
                'A Button: Start / Pause',
                'B Button: Recenter View'
            ]
        }
    }
});

export const SYSTEMS = ['POWER', 'COMMS', 'OPTICS'];
export const SAMPLE_X = [2.8, -2.6, 1.8];
export const RESCUE_RANGE = 11;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const axis = value => clamp(Number.isFinite(value) ? value : 0, -1, 1);
const slowToward = (value, target, dt, rate) => value + (target - value) * (1 - Math.exp(-dt * rate));

export class ArcadeRun {
    constructor(slug, random = Math.random) {
        if (!Object.hasOwn(VR_GAMES, slug)) throw new Error('Unknown VR arcade game');
        this.slug = slug;
        this.config = VR_GAMES[slug];
        this.random = random;
        this.reset();
    }

    reset() {
        this.state = 'ready';
        this.countdown = 3;
        this.elapsed = 0;
        this.score = 0;
        this.result = '';
        this.feedback = '';
        this.feedbackTime = 0;
        this.events = [];
        this.x = 0;
        this.y = 0;
        this.z = 0;
        this.vx = 0;
        this.vy = 0;
        this.vz = 0;
        this.roll = 0;
        this.altitude = 25;
        this.descent = 0.7;
        this.fuel = 100;
        this.burn = 0;
        this.throttleLevel = 0;
        this.range = this.slug === 'space-rescue' ? 20 : 18;
        this.closing = this.slug === 'space-rescue' ? 0.85 : 0.9;
        this.targetX = 0;
        this.targetY = 0;
        this.podX = 0;
        this.podY = 0;
        this.driftScale = 1;
        this.matched = false;
        this.tetherReel = 0;
        this.samples = 0;
        this.distance = 0;
        this.battery = 100;
        this.rocksHit = 0;
        this.bonusCollected = 0;
        this.collectedCrystals = new Set();
        this.drillProgress = 0;
        this.repairRound = 0;
        this.repairStep = 0;
        this.carryingSpare = null;
        this.weldProgress = 0;
        this.mistakes = 0;
        const firstFault = Math.min(2, Math.floor(clamp(this.random(), 0, 1) * SYSTEMS.length));
        const order = this.random() < 0.5 ? 1 : 2;
        this.faults = Array.from({ length: SYSTEMS.length }, (_, index) => (firstFault + index * order) % 3);
        if (this.slug === 'lunar-landing' || this.slug === 'orbital-docking') this.x = 2.5;
        if (this.slug === 'orbital-docking') this.y = -1.2;
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

    say(message) {
        this.feedback = message;
        this.feedbackTime = 2.6;
    }

    finish(won, message) {
        this.state = won ? 'won' : 'lost';
        this.result = message;
        if (won) this._computeFinalScore();
        this.emit(won ? 'won' : 'lost', { score: this.score });
    }

    _computeFinalScore() {
        const remaining = Math.max(0, this.config.duration - this.elapsed);
        if (this.slug === 'lunar-landing') {
            const offset = Math.hypot(this.x, this.z);
            this.score = Math.round(1200 + Math.max(0, 2.4 - offset) * 500 + Math.max(0, 2.7 - this.descent) * 350 + this.fuel * 14);
        } else if (this.slug === 'orbital-docking') {
            const offset = Math.hypot(this.x, this.y);
            this.score = Math.round(1400 + Math.max(0, 0.75 - offset) * 1400 + Math.max(0, 0.65 - this.closing) * 1200 + remaining * 15);
        } else if (this.slug === 'satellite-repair') {
            this.score = Math.round(1600 + remaining * 22 - this.mistakes * 150);
        } else if (this.slug === 'mars-rover') {
            this.score = Math.round(1200 + this.samples * 350 + this.bonusCollected * 300 + this.battery * 12);
        } else if (this.slug === 'space-rescue') {
            const aimErr = Math.hypot(this.targetX - this.podX, this.targetY - this.podY);
            this.score = Math.round(1500 + remaining * 22 + Math.max(0, 2 - aimErr) * 300);
        }
        this.score = Math.max(100, this.score);
    }

    get sampleDistance() { return (this.samples + 1) * 36 - this.distance; }
    get sampleAligned() {
        return this.sampleDistance <= 2.6 && Math.abs(this.x - SAMPLE_X[this.samples]) <= 1.2;
    }
    get fault() { return SYSTEMS[this.faults[this.repairRound]]; }
    get canMatch() { return this.range <= RESCUE_RANGE && !this.matched; }

    grabSpare(name) {
        if (this.state !== 'playing' || this.slug !== 'satellite-repair') return false;
        if (this.repairStep !== 1) return false;
        if (name !== this.fault) {
            this.mistakes += 1;
            this.elapsed = Math.min(this.elapsed + 4, this.config.duration);
            if (this.elapsed >= this.config.duration) this.finish(false, 'Mission time expired.');
            else {
                this.say('Wrong spare module. Four seconds lost.');
                this.emit('error');
            }
            return false;
        }
        this.carryingSpare = name;
        this.repairStep = 2;
        this.weldProgress = 0;
        this.say(`${name} spare grappled. Weld it into the bay.`);
        this.emit('grab-spare', { system: name });
        return true;
    }

    weldStep(dt, targetName) {
        if (this.state !== 'playing' || this.slug !== 'satellite-repair') return false;
        if (this.repairStep !== 2 || targetName !== this.fault) return false;
        this.weldProgress = clamp(this.weldProgress + dt / 0.85, 0, 1);
        this.emit('weld');
        if (this.weldProgress >= 1) {
            this.weldProgress = 0;
            this.carryingSpare = null;
            this.repairStep = 0;
            this.repairRound += 1;
            if (this.repairRound === SYSTEMS.length) {
                this.finish(true, 'All three systems restored.');
            } else {
                this.say('System welded and online. Check the next fault.');
                this.emit('part-fixed');
            }
        }
        return true;
    }

    action(name) {
        if (this.state !== 'playing') return false;
        if (this.slug === 'lunar-landing' && name === 'brake') {
            if (this.fuel <= 0) { this.say('Fuel depleted.'); return false; }
            this.burn = 0.95;
            this.emit('burn');
            return true;
        }
        if (this.slug === 'orbital-docking' && (name === 'brake' || name === 'thrust')) {
            const change = name === 'brake' ? -0.45 : 0.55;
            this.closing = clamp(this.closing + change, 0, 3);
            this.say(name === 'brake' ? 'Retro thrusters fired.' : 'Forward thrusters fired.');
            this.emit('rcs', { dir: name === 'brake' ? -1 : 1 });
            return true;
        }
        if (this.slug === 'satellite-repair' && name.startsWith('system:')) {
            const target = name.slice(7);
            if (target !== this.fault) {
                this.mistakes += 1;
                this.elapsed = Math.min(this.elapsed + 4, this.config.duration);
                if (this.elapsed >= this.config.duration) this.finish(false, 'Mission time expired.');
                else {
                    this.say('Wrong system. Four seconds lost.');
                    this.emit('error');
                }
                return false;
            }
            this.repairStep += 1;
            if (this.repairStep === 2) {
                this.carryingSpare = target;
                this.emit('grab-spare', { system: target });
            } else if (this.repairStep === 1) {
                this.emit('part-diagnosed', { system: target });
            }
            if (this.repairStep === 3) {
                this.repairStep = 0;
                this.carryingSpare = null;
                this.weldProgress = 0;
                this.repairRound += 1;
                if (this.repairRound === SYSTEMS.length) this.finish(true, 'All three systems restored.');
                else {
                    this.say('System restored. Check the next fault.');
                    this.emit('part-fixed');
                }
            }
            return true;
        }
        if (this.slug === 'mars-rover' && name === 'collect') {
            if (!this.sampleAligned) {
                this.say('Stop near the sample and line up with the beacon.');
                this.emit('error');
                return false;
            }
            this.samples += 1;
            this.drillProgress = 0;
            this.emit('sample-collected', { count: this.samples });
            if (this.samples === SAMPLE_X.length) this.finish(true, 'All three samples secured.');
            else this.say('Sample secured. Heading to the next site.');
            return true;
        }
        if (this.slug === 'space-rescue' && name === 'match') {
            if (!this.canMatch) {
                if (!this.matched) {
                    this.say('Wait until the astronaut is within 11 m.');
                    this.emit('error');
                }
                return false;
            }
            this.matched = true;
            this.say('Drift match engaged. Aim harpoon at the astronaut.');
            this.emit('rcs');
            return true;
        }
        if (this.slug === 'space-rescue' && name === 'tether') {
            if (!this.matched || this.closing > 0.22) {
                this.say('Match drift and wait for the lock.');
                this.emit('error');
                return false;
            }
            this.tetherReel = 0.05;
            this.emit('tether-latch');
            this.finish(true, 'Tether secured. Astronaut recovered.');
            return true;
        }
        return false;
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
                this.emit('go');
            }
            return;
        }
        if (this.state !== 'playing') return;
        this.elapsed = Math.min(this.config.duration, this.elapsed + dt);
        if (this.elapsed >= this.config.duration) {
            this.finish(false, this.slug === 'space-rescue' ? 'Rescue window expired.' : 'Mission time expired.');
            return;
        }
        this.feedbackTime = Math.max(0, this.feedbackTime - dt);

        if (this.slug === 'lunar-landing') {
            this.land(dt, axis(input.x), input.brake, axis(input.z), input.throttle, input.stabilize);
        }
        if (this.slug === 'orbital-docking') {
            this.dock(dt, axis(input.x), axis(input.y), axis(input.thrustAxis), axis(input.rollAxis));
        }
        if (this.slug === 'mars-rover') {
            this.drive(dt, axis(input.x), input.throttle, input.brake, input.drill);
        }
        if (this.slug === 'space-rescue') {
            this.rescue(dt, axis(input.x), axis(input.y));
        }
    }

    land(dt, x, brakeHeld, z = 0, throttle = undefined, stabilize = false) {
        const hover = Boolean(stabilize) && this.fuel > 0;
        const rate = hover ? 5.5 : 2.5;
        this.vx = slowToward(this.vx, hover ? x * 1.2 : x * 3, dt, rate);
        this.vz = slowToward(this.vz, hover ? z * 1.2 : z * 3, dt, rate);
        this.x = clamp(this.x + this.vx * dt, -9, 9);
        this.z = clamp(this.z + this.vz * dt, -9, 9);

        const analog = Number.isFinite(throttle) ? clamp(throttle, 0, 1) : 0;
        const legacyBurn = (this.burn > 0 || brakeHeld) ? 1 : 0;
        const level = this.fuel > 0 ? Math.max(analog, legacyBurn) : 0;
        this.throttleLevel = level;
        this.burn = Math.max(0, this.burn - dt);

        if (level > 0.05) {
            this.fuel = Math.max(0, this.fuel - dt * (7 * level + (hover ? 1.5 : 0)));
            this.emit('thrust', { level });
        } else if (hover) {
            this.fuel = Math.max(0, this.fuel - dt * 1.5);
        }

        // Lunar gravity and retro thrust (supports proportional Quest 3 trigger throttle).
        const accel = 1.62 - level * 6.82;
        this.descent = clamp(this.descent + dt * accel, 0.6, 8);
        this.altitude = Math.max(0, this.altitude - this.descent * dt);
        if (this.altitude > 0) return;

        const aligned = Math.hypot(this.x, this.z) <= 2.4;
        const soft = this.descent <= 2.7 && Math.hypot(this.vx, this.vz) <= 1.3;
        this.finish(
            aligned && soft,
            !aligned ? 'Touchdown outside the pad.' : soft ? 'Soft landing confirmed.' : 'Hard landing. Start braking earlier.'
        );
    }

    dock(dt, x, y, thrustAxis = 0, rollAxis = 0) {
        this.vx = slowToward(this.vx, x * 1.25, dt, 2.1);
        this.vy = slowToward(this.vy, y * 1.25, dt, 2.1);
        this.x = clamp(this.x + this.vx * dt, -5, 5);
        this.y = clamp(this.y + this.vy * dt, -3.5, 3.5);
        if (Math.abs(thrustAxis) > 0.05) {
            this.closing = clamp(this.closing + thrustAxis * dt * 0.9, 0, 3);
        }
        if (Math.abs(rollAxis) > 0.05) {
            this.roll = clamp(this.roll + rollAxis * dt * 1.2, -Math.PI, Math.PI);
        }
        this.range = Math.max(0, this.range - this.closing * dt);
        if (this.range > 0) return;
        const aligned = Math.hypot(this.x, this.y) <= 0.75 && Math.abs(this.roll) <= 0.45;
        const soft = this.closing <= 0.65 && Math.hypot(this.vx, this.vy) <= 0.65;
        this.finish(
            aligned && soft,
            !aligned ? 'Missed the docking collar.' : soft ? 'Capture confirmed. Docked.' : 'Approach too fast. Brake before contact.'
        );
    }

    drive(dt, x, throttle = undefined, brake = undefined, drillHeld = false) {
        this.vx = slowToward(this.vx, x * 2.8, dt, 3);
        this.x = clamp(this.x + this.vx * dt, -5.2, 5.2);
        const stop = (this.samples + 1) * 36 - 2.3;
        const previous = this.distance;

        const trig = Number.isFinite(throttle) ? clamp(throttle, 0, 1) : null;
        const brk = Number.isFinite(brake) ? clamp(brake, 0, 1) : (brake ? 1 : 0);
        const driveSpeed = trig !== null ? (1.8 + trig * 6.4) * (1 - brk * 0.88) : 5 * (1 - brk * 0.8);

        this.distance = Math.min(stop, this.distance + dt * driveSpeed);
        this.battery = Math.max(0, this.battery - dt * (this.distance > previous ? 1.05 : 0.65));

        for (const rock of roverRocks(this.samples)) {
            if (previous < rock.distance && this.distance >= rock.distance && Math.abs(this.x - rock.x) < 1.35) {
                this.rocksHit += 1;
                this.battery = Math.max(0, this.battery - 11);
                this.say('Rock strike. Battery lost.');
                this.emit('rock-hit');
            }
        }

        for (const crystal of roverCrystals(this.samples)) {
            const key = `${this.samples}:${crystal.distance}`;
            if (!this.collectedCrystals.has(key) && previous < crystal.distance && this.distance >= crystal.distance && Math.abs(this.x - crystal.x) < 1.35) {
                this.collectedCrystals.add(key);
                this.bonusCollected += 1;
                this.battery = Math.min(100, this.battery + 10);
                this.say('Solar crystal harvested! +10% battery');
                this.emit('bonus');
            }
        }

        if (drillHeld && this.sampleAligned) {
            this.drillProgress = clamp(this.drillProgress + dt / 0.8, 0, 1);
            this.emit('weld');
            if (this.drillProgress >= 1) this.action('collect');
        } else {
            this.drillProgress = Math.max(0, this.drillProgress - dt * 2);
        }

        if (this.battery <= 0) this.finish(false, 'Rover battery exhausted.');
    }

    rescue(dt, x = 0, y = 0) {
        this.podX = clamp(slowToward(this.podX, x * 2.2, dt, 3), -2.6, 2.6);
        this.podY = clamp(slowToward(this.podY, y * 1.1, dt, 3), -1.3, 1.3);
        if (this.matched) {
            this.closing = slowToward(this.closing, 0, dt, 3);
            this.driftScale = slowToward(this.driftScale, 0.43, dt, 2);
        }
        this.targetX = Math.sin(this.elapsed * 0.46) * 2.5 * this.driftScale;
        this.targetY = Math.sin(this.elapsed * 0.31 + 1) * 0.85 * this.driftScale;
        this.range = Math.max(0, this.range - this.closing * dt);
        if (this.range <= 5.5) this.finish(false, 'Too close for the tether. Match drift sooner.');
    }

    status() {
        if (this.state === 'won' || this.state === 'lost') {
            return this.state === 'won' ? `${this.result} · ${this.score.toLocaleString()} pts` : this.result;
        }
        if (this.state === 'ready') return this.config.controls;
        if (this.state === 'countdown') return 'Hold Touch Plus controllers · Ready';
        if (this.feedbackTime > 0) return this.feedback;
        if (this.slug === 'lunar-landing') {
            const off = Math.hypot(this.x, this.z).toFixed(1);
            return `${Math.ceil(this.altitude)} m · ↓ ${this.descent.toFixed(1)} m/s · fuel ${Math.ceil(this.fuel)}% · pad ${off} m${this.altitude <= 10 && this.descent > 2.7 ? ' · BRAKE' : ''}`;
        }
        if (this.slug === 'orbital-docking') {
            return `${this.range.toFixed(1)} m · closing ${this.closing.toFixed(1)} m/s · offset ${Math.hypot(this.x, this.y).toFixed(1)} m`;
        }
        if (this.slug === 'satellite-repair') {
            return `${['Diagnose', 'Grapple Spare', 'Weld Module'][this.repairStep]} ${this.fault} · ${this.repairRound}/3 systems · ${Math.ceil(this.config.duration - this.elapsed)}s`;
        }
        if (this.slug === 'mars-rover') {
            return `${this.samples}/3 samples · battery ${Math.ceil(this.battery)}% · ${this.sampleAligned ? 'Hold Right Trigger to drill' : 'sample ' + Math.ceil(this.sampleDistance) + ' m'}`;
        }
        return `${this.range.toFixed(1)} m · ${this.matched && this.closing <= 0.22 ? 'Harpoon lock ready' : this.matched ? 'Matching drift' : this.canMatch ? 'Left Trigger: Match drift' : 'Approaching astronaut'}`;
    }
}

export function roverRocks(leg) {
    const start = leg * 36;
    return [
        { x: leg % 2 ? -1.2 : 1, distance: start + 10 },
        { x: leg % 2 ? 3 : -2.4, distance: start + 23 }
    ];
}

export function roverCrystals(leg) {
    const start = leg * 36;
    return [
        { x: leg % 2 ? 2.1 : -2.0, distance: start + 16 }
    ];
}

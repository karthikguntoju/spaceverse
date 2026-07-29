/**
 * Kessler Run — you are the space traffic controller.
 *
 * Satellites arrive on orbits you did not choose. When two pass too close they
 * collide, and the collision does not just cost you two satellites: it produces
 * debris that never goes away and makes the next collision more likely. That is
 * Kessler syndrome, and the mission is to hold it off.
 *
 * You have a fuel budget. Selecting a satellite and burning moves it to a
 * different shell, which is the only tool you have. Spend it on the right ones.
 *
 * The simulation is pure state and pure maths — it imports no Three.js. The host
 * page reads `objects` each frame and draws them however it likes, which is what
 * lets this same mission run on a page using any Three.js version, or none.
 */
import { fieldRisk, MAX_OBJECTS, SHELL_HEIGHT } from '../../shared/kessler-risk.mjs';

const SPAWN_INTERVAL_S = 5;
const DEBRIS_PER_COLLISION = 2;
const FUEL_PER_BURN = 5;
const START_FUEL = 130;
const SURVIVE_MS = 150000;          // clear 2.5 minutes and you win
const CASCADE_LOSS_LIMIT = 10;      // satellites lost before the field is gone

/**
 * Conjunction thresholds.
 *
 * These decide whether this is a game or a slideshow of explosions. An earlier
 * version treated anything within a tenth of a radian as touching, which meant
 * every object in a shell collided immediately: 465 collisions per run, risk
 * pinned at the cap inside 90 seconds, every run unwinnable, and 16 burns of
 * fuel against hundreds of events. There was no decision to make.
 *
 * Now a close pass is genuinely close, and it is announced BEFORE it happens so
 * the player has something to do about it.
 */
const HIT_ANGLE = 0.035;            // radians of along-track separation at closest approach
const SHELL_TOLERANCE = 2.0;        // altitude difference that still counts as same lane
const COLLIDE_ALT = 0.9;            // altitude difference below which a pass actually strikes
const WARN_LEAD_S = 7;              // predicted seconds to impact that triggers a warning
const PAIR_COOLDOWN_S = 10;         // after a pass or a hit, leave the pair alone this long

let nextId = 1;

export function createKesslerRun(deps = {}) {
    const { hud = {}, audio = {} } = deps;

    /** @type {Array<{id:number,altitude:number,inclination:number,angle:number,speed:number,debris:boolean}>} */
    let objects = [];
    let fuel = START_FUEL;
    let lost = 0;
    let spawned = 0;
    let elapsedMs = 0;
    let spawnTimer = 0;
    let selectedId = null;
    let risk = 0;
    let outcome = null;
    let peakRisk = 0;
    let collisions = 0;
    /** key "idA:idB" -> { a, b, ttl } — pairs currently on a close approach. */
    let conjunctions = new Map();
    /** key -> seconds left, so one near-miss does not re-announce every frame. */
    let cooldowns = new Map();
    /** pairs that were ever announced, to tell warned hits from blindsides. */
    let everWarned = new Set();

    const rand = (a, b) => a + Math.random() * (b - a);

    /**
     * Pick a shell for an arriving satellite, biased towards shells that are
     * already busy.
     *
     * Uniformly random shells produced runs where nothing ever shared a lane, so
     * no conjunction ever fired and the player sat watching dots orbit for two
     * and a half minutes and won by doing nothing. Crowding has to be inevitable
     * for there to be a job to do — which is also why real orbital congestion is
     * a problem: everyone wants the same few useful altitudes.
     */
    function chooseShell() {
        const occupancy = new Array(6).fill(0);
        for (const o of objects) {
            const s = Math.floor(o.altitude / SHELL_HEIGHT);
            if (s >= 0 && s < 6) occupancy[s]++;
        }
        // Every shell keeps a base chance so the field still spreads out.
        const weights = occupancy.map((n) => 1 + n * 1.8);
        const total = weights.reduce((a, b) => a + b, 0);
        let roll = Math.random() * total;
        for (let s = 0; s < weights.length; s++) {
            roll -= weights[s];
            if (roll <= 0) return s;
        }
        return weights.length - 1;
    }

    function spawnSatellite() {
        // The cap counts EVERYTHING, debris included. Past it, arrivals stop
        // rather than the field growing without bound: see the merge rule in
        // spawnDebris for what happens to debris at the cap.
        if (objects.length >= MAX_OBJECTS) return;
        const altitude = chooseShell() * SHELL_HEIGHT + rand(2, SHELL_HEIGHT - 2);
        objects.push({
            id: nextId++,
            altitude,
            inclination: rand(0, Math.PI),
            angle: rand(0, Math.PI * 2),
            // Lower orbits are faster, which is both true and what makes the
            // low shells the dangerous ones to let fill up. The jitter matters
            // more than it looks: with speed derived from altitude alone, every
            // object in a shell moved in lockstep and their relative positions
            // never changed, so a pair was either permanently safe or
            // permanently doomed from the moment it spawned. Nothing converged,
            // so nothing the player did could change an outcome.
            speed: (0.9 - (altitude / (SHELL_HEIGHT * 6)) * 0.45) * rand(0.82, 1.18),
            debris: false
        });
        spawned++;
    }

    function spawnDebris(at) {
        for (let i = 0; i < DEBRIS_PER_COLLISION; i++) {
            if (objects.length >= MAX_OBJECTS) {
                // At the cap, new debris merges into the nearest existing cloud
                // instead of adding a body. The field keeps getting more
                // dangerous — debrisPressure still climbs because that cloud
                // counts — without the object count growing without limit
                // exactly when the cascade makes the frame budget tightest.
                const cloud = objects.find((o) => o.debris);
                if (cloud) cloud.mass = (cloud.mass || 1) + 1;
                continue;
            }
            objects.push({
                id: nextId++,
                altitude: at.altitude + rand(-2.5, 2.5),
                inclination: at.inclination + rand(-0.4, 0.4),
                angle: at.angle + rand(-0.3, 0.3),
                speed: at.speed * rand(0.85, 1.15),
                debris: true
            });
        }
    }

    /** Shortest angular separation between two objects, in radians. */
    function angularGap(a, b) {
        let d = Math.abs(a.angle - b.angle) % (Math.PI * 2);
        if (d > Math.PI) d = Math.PI * 2 - d;
        return d;
    }

    /**
     * Seconds until this pair closes to striking distance, or null if they are
     * not converging. Both are on near-circular orbits at constant angular rate,
     * so this is just distance over closing speed.
     */
    function timeToImpact(a, b, gap) {
        const relativeRate = Math.abs(a.speed - b.speed);
        // Matched rates hold their separation forever: never a threat.
        if (relativeRate < 1e-4) return null;
        const closing = gap - HIT_ANGLE;
        if (closing <= 0) return 0;
        const tti = closing / relativeRate;
        return tti;
    }

    /** Do these two share a lane at all? Different shells never interact. */
    function sameLane(a, b) {
        if (Math.abs(a.altitude - b.altitude) > SHELL_TOLERANCE) return false;
        // Objects on very different inclinations are on different planes; they
        // only conflict where those planes cross, which the angular gap covers.
        return true;
    }

    /**
     * Find pairs on a converging close approach and act on them.
     *
     * Two stages, and the two-stage design is the whole game:
     *   WARNING  the pair is closing and within WARN_ANGLE. Announced, tracked,
     *            and the player has WARN_LEAD_S to move one of them.
     *   IMPACT   still together and inside HIT_ANGLE. Now they collide.
     *
     * Debris does not collide with debris. Debris is already debris; letting it
     * self-destruct produced a runaway that ended every run in a cascade the
     * player could not influence. It still kills satellites, which is what makes
     * it dangerous, and it still drives risk through debrisPressure.
     */
    function resolveConjunctions(dt) {
        // Age warnings, and CLEAR the ones that are no longer true. A warning
        // that survives being defused is worse than none: the player burns, the
        // alert stays lit, so they burn again — the same stale entry drained a
        // full tank in under five seconds of testing. Acting on a warning must
        // visibly retire it.
        const byId = new Map(objects.map((o) => [o.id, o]));
        for (const [key, w] of conjunctions) {
            w.ttl -= dt;
            if (w.ttl <= 0) { conjunctions.delete(key); continue; }
            const a = byId.get(w.a);
            const b = byId.get(w.b);
            const stillDangerous = a && b &&
                Math.abs(a.altitude - b.altitude) < COLLIDE_ALT &&
                Math.abs(a.altitude - b.altitude) <= SHELL_TOLERANCE;
            if (!stillDangerous) conjunctions.delete(key);
        }
        for (const [key, t] of cooldowns) {
            const left = t - dt;
            if (left <= 0) cooldowns.delete(key); else cooldowns.set(key, left);
        }

        const dead = new Set();
        // Naive pairwise. At the 120-object cap that is 7,140 checks per tick of
        // trivial arithmetic, which is nothing — and it stays readable, which
        // matters more here than a broadphase would.
        for (let i = 0; i < objects.length; i++) {
            const a = objects[i];
            if (dead.has(a.id)) continue;
            for (let j = i + 1; j < objects.length; j++) {
                const b = objects[j];
                if (dead.has(b.id)) continue;
                if (a.debris && b.debris) continue;      // debris ignores debris
                if (!sameLane(a, b)) continue;

                const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
                if (cooldowns.has(key)) continue;

                // Only pairs at nearly the SAME altitude can actually strike.
                // Sharing a lane is not enough: real satellites pass each other
                // constantly and only a matched altitude turns a pass into a
                // hit. Without this rule every co-lane pair was mathematically
                // guaranteed to collide eventually (different speeds in one
                // lane must close to zero separation), threats accumulated
                // without bound, and no amount of fuel could win.
                const dangerous = Math.abs(a.altitude - b.altitude) < COLLIDE_ALT;

                const gap = angularGap(a, b);

                if (gap > HIT_ANGLE) {
                    // Warn on PREDICTED time to impact, not on distance. Fixed-
                    // angle warnings gave under half a second of real notice at
                    // typical closing rates — an obituary, not a warning.
                    if (!dangerous) continue;
                    const tti = timeToImpact(a, b, gap);
                    if (tti !== null && tti <= WARN_LEAD_S && !conjunctions.has(key)) {
                        conjunctions.set(key, { a: a.id, b: b.id, ttl: tti });
                        everWarned.add(key);
                        if (hud.flash) hud.flash('conjunction');
                        if (audio.blip) audio.blip(420);
                    }
                    continue;
                }

                if (!dangerous) {
                    // A clean pass. Leave the pair alone until they separate.
                    cooldowns.set(key, PAIR_COOLDOWN_S);
                    continue;
                }

                // Impact.
                dead.add(a.id);
                dead.add(b.id);
                if (!a.debris) lost++;
                if (!b.debris) lost++;
                conjunctions.delete(key);
                cooldowns.set(key, PAIR_COOLDOWN_S);
                spawnDebris(a);
                collisions++;
                if (audio.blip) audio.blip(140);
                if (hud.flash) hud.flash('collision', { warned: everWarned.has(key), aDebris: a.debris, bDebris: b.debris });
            }
        }
        if (dead.size) {
            objects = objects.filter((o) => !dead.has(o.id));
            for (const [key, w] of conjunctions) {
                if (dead.has(w.a) || dead.has(w.b)) conjunctions.delete(key);
            }
            if (selectedId && dead.has(selectedId)) selectedId = null;
        }
    }

    return {
        meta: {
            id: 'kessler-run',
            title: 'Kessler Run',
            brief: 'Hold the cascade off for two and a half minutes. Select a satellite, burn to move it.',
            maxMs: SURVIVE_MS + 5000
        },

        init() {
            objects = [];
            fuel = START_FUEL;
            lost = 0;
            spawned = 0;
            elapsedMs = 0;
            spawnTimer = 0;
            selectedId = null;
            risk = 0;
            peakRisk = 0;
            collisions = 0;
            outcome = null;
            conjunctions = new Map();
            cooldowns = new Map();
            everWarned = new Set();
            for (let i = 0; i < 6; i++) spawnSatellite();
        },

        start() {
            if (hud.setFuel) hud.setFuel(fuel, START_FUEL);
        },

        update(dt) {
            if (outcome) return outcome;

            elapsedMs += dt * 1000;
            spawnTimer += dt;
            if (spawnTimer >= SPAWN_INTERVAL_S) {
                spawnTimer = 0;
                spawnSatellite();
            }

            for (const o of objects) o.angle = (o.angle + o.speed * dt) % (Math.PI * 2);

            resolveConjunctions(dt);

            risk = fieldRisk(objects);
            if (risk > peakRisk) peakRisk = risk;
            if (hud.setRisk) hud.setRisk(risk);
            if (hud.setStats) {
                hud.setStats({
                    alive: objects.filter((o) => !o.debris).length,
                    debris: objects.filter((o) => o.debris).length,
                    lost,
                    fuel,
                    collisions,
                    warnings: conjunctions.size,
                    survivedMs: elapsedMs
                });
            }

            if (lost >= CASCADE_LOSS_LIMIT) {
                outcome = { failed: true, reason: 'cascade' };
                return outcome;
            }
            if (elapsedMs >= SURVIVE_MS) {
                outcome = { won: true };
                return outcome;
            }
            return null;
        },

        /* ── player controls, driven by the host page ────────────────── */

        select(id) {
            const found = objects.find((o) => o.id === id && !o.debris);
            selectedId = found ? id : null;
            return selectedId;
        },

        /** Burn the selected satellite up or down a shell. Costs fuel. */
        burn(direction = 1) {
            if (outcome) return false;
            if (fuel < FUEL_PER_BURN) {
                if (hud.flash) hud.flash('no-fuel');
                return false;
            }
            const sat = objects.find((o) => o.id === selectedId && !o.debris);
            if (!sat) return false;

            sat.altitude = Math.max(2, sat.altitude + direction * SHELL_HEIGHT);
            sat.speed = 0.9 - (sat.altitude / (SHELL_HEIGHT * 6)) * 0.45;
            fuel -= FUEL_PER_BURN;
            if (audio.blip) audio.blip(520);
            if (hud.setFuel) hud.setFuel(fuel, START_FUEL);
            return true;
        },

        onInput(event) {
            if (!event) return;
            if (event.type === 'select') this.select(event.id);
            if (event.type === 'burn') this.burn(event.direction);
        },

        end() {
            return {
                satellitesAlive: objects.filter((o) => !o.debris).length,
                satellitesLost: lost,
                fuelSpent: START_FUEL - fuel,
                survivedMs: Math.round(elapsedMs),
                peakRisk: Math.round(peakRisk)
            };
        },

        teardown() {
            objects = [];
        },

        /* Read by the host page each frame to draw the field. */
        objects: () => objects,
        selected: () => selectedId,
        /**
         * Ids currently on a close approach, so the host can light them up.
         * Without this the player is told "collision risk 40%" and given no way
         * to see WHICH pair is the problem, which is the difference between a
         * decision and a number going up on its own.
         */
        warnedIds: () => {
            const ids = new Set();
            for (const [, w] of conjunctions) { ids.add(w.a); ids.add(w.b); }
            return ids;
        },
        /** The most urgent pair, so the host can offer a one-click response. */
        topThreat: () => {
            let worst = null;
            for (const [, w] of conjunctions) {
                if (!worst || w.ttl < worst.ttl) worst = w;
            }
            return worst;
        },
        _state: () => ({ fuel, lost, spawned, risk, peakRisk, elapsedMs, count: objects.length, outcome })
    };
}

export default createKesslerRun;

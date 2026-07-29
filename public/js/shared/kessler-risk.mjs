/**
 * Kessler Run — orbital risk model.
 *
 * Shared by the browser (which shows a live risk meter at 60fps) and the server
 * (which scores the finished run). One implementation, so the number the player
 * watches climbing is the same number they get judged on. Two copies would drift
 * on the first balance pass and the mismatch would read as a scoring bug.
 *
 * This is deliberately NOT routes/simulator.js's calculateLocalCollisionRisk.
 * That function is tuned so the traffic simulator's written analysis reads
 * plausibly, and it takes aggregate orbital parameters rather than object
 * positions. Importing it would mean every game-balance tweak edited the
 * simulator's output. It stays untouched; this is the game's own model.
 *
 * The model itself is intentionally simple and legible, because the player has
 * to be able to see WHY risk is climbing:
 *
 *     risk = shell crowding + closing traffic + debris pressure
 *
 * No file in this module may import Three.js or touch the DOM: it runs in Node.
 */

/** Hard ceiling on tracked objects. See MAX_OBJECTS rationale in the mission. */
export const MAX_OBJECTS = 120;

/** Orbital shells, in scene units of altitude. Crowding is measured per shell. */
export const SHELL_HEIGHT = 12;

/**
 * Risk contributed by how crowded an object's own shell is.
 * Squared because a shell going from 2 to 4 objects is far more than twice as
 * dangerous — every new object can hit every existing one.
 */
export function shellCrowding(countInShell) {
    const n = Math.max(0, countInShell - 1);
    return Math.min(45, n * n * 1.6);
}

/**
 * Risk from objects on crossing orbits. Two things in the same shell at similar
 * inclination are travelling together; at opposing inclinations they close at
 * twice orbital velocity, which is the case that actually kills satellites.
 */
export function closingTraffic(incA, incB) {
    const delta = Math.abs(incA - incB);
    // 0 rad apart: same direction, low relative speed. PI apart: head-on.
    return Math.min(30, (delta / Math.PI) * 30);
}

/** Debris is untracked, unmanoeuvrable and permanent, so it weighs heavier. */
export function debrisPressure(debrisCount) {
    return Math.min(35, debrisCount * 1.1);
}

/**
 * Overall risk percentage for a field of objects, 0-100.
 *
 * @param {Array<{altitude:number, inclination:number, debris:boolean}>} objects
 */
export function fieldRisk(objects) {
    if (!objects || !objects.length) return 0;

    const shells = new Map();
    let debris = 0;
    for (const o of objects) {
        if (o.debris) debris++;
        const shell = Math.floor(o.altitude / SHELL_HEIGHT);
        if (!shells.has(shell)) shells.set(shell, []);
        shells.get(shell).push(o);
    }

    let worstShell = 0;
    let worstClosing = 0;
    for (const [, inShell] of shells) {
        worstShell = Math.max(worstShell, shellCrowding(inShell.length));
        for (let i = 0; i < inShell.length; i++) {
            for (let j = i + 1; j < inShell.length; j++) {
                worstClosing = Math.max(
                    worstClosing,
                    closingTraffic(inShell[i].inclination, inShell[j].inclination)
                );
            }
        }
    }

    const total = worstShell + worstClosing + debrisPressure(debris);
    // Capped below 100 on purpose: a run should always feel survivable for one
    // more tick, and a meter pinned at 100 stops telling the player anything.
    return Math.min(97, Math.round(total * 10) / 10);
}

/**
 * Score a finished Kessler run. Used by the server; exported here so the client
 * can show the same projected score it will actually receive.
 */
export function scoreRun({ satellitesAlive = 0, satellitesLost = 0, fuelSpent = 0, survivedMs = 0 }, { won } = {}) {
    let xp = satellitesAlive * 4 + Math.floor(survivedMs / 10000) * 2;
    xp -= satellitesLost * 3;
    xp -= Math.floor(fuelSpent / 10);
    if (won) xp += 25;
    return Math.max(0, Math.round(xp));
}

export default { fieldRisk, scoreRun, shellCrowding, closingTraffic, debrisPressure, MAX_OBJECTS, SHELL_HEIGHT };

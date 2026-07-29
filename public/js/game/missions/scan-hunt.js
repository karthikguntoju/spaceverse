/**
 * Scan Hunt — a timed knowledge mission in the VR solar system.
 *
 * You are given a fact about a world and have to find and scan the world it
 * describes. Five targets, ninety seconds. Wrong scans cost you.
 *
 * This is the CHEAP mission in the core's proving pair: it adds no renderer, no
 * physics and no new page. Everything it needs already existed — the scene, the
 * pick targets, and a fact for every body and moon. If a mission this thin still
 * needs core changes to work, the core is wrong.
 *
 * It imports no Three.js. The host hands it the solar system through ctx, and
 * asks the host for scene changes rather than reaching into them.
 */

const TARGET_COUNT = 5;
const DURATION_MS = 90000;

export function createScanHunt(deps = {}) {
    // Injected so this can be unit tested without a scene, a renderer, or a
    // browser. The VR page passes the real system and HUD.
    const {
        system,          // solar-system instance: getInfo(key), scannableKeys()
        hud = {},        // { setObjective, setProgress, flash }
        audio = {}       // { blip }
    } = deps;

    let queue = [];
    let index = 0;
    let found = 0;
    let missed = 0;
    let finished = false;

    /**
     * Every body and moon that has a fact worth asking about. Read through the
     * host rather than reaching into the scene graph, so a different host (a
     * test, a flat-screen page) can supply its own list.
     */
    function candidateKeys() {
        if (typeof deps.candidateKeys === 'function') return deps.candidateKeys();
        if (system && typeof system.scannableKeys === 'function') return system.scannableKeys();
        return [];
    }

    function pickTargets(keys) {
        const pool = keys.slice();
        const chosen = [];
        // The Sun is excluded: "find the star at the centre" is not a hunt.
        const eligible = pool.filter((k) => k !== 'sun');
        while (chosen.length < TARGET_COUNT && eligible.length) {
            const i = Math.floor(Math.random() * eligible.length);
            chosen.push(eligible.splice(i, 1)[0]);
        }
        return chosen;
    }

    function currentTarget() {
        return queue[index] || null;
    }

    function announce() {
        const key = currentTarget();
        if (!key) return;
        const info = system && system.getInfo ? system.getInfo(key) : null;
        const clue = info && info.fact ? info.fact : 'Find the next target.';
        if (hud.setObjective) hud.setObjective(clue);
        if (hud.setProgress) hud.setProgress(index, queue.length, missed);
    }

    return {
        meta: {
            id: 'scan-hunt',
            title: 'Scan Hunt',
            brief: `Five worlds, ninety seconds. Read the fact, find the world, scan it.`,
            maxMs: DURATION_MS
        },

        init() {
            const keys = candidateKeys();
            if (!keys.length) {
                // A hunt with nothing to hunt is a bug, not an empty round. Fail
                // loudly here rather than starting a timer over nothing.
                throw new Error('[scan-hunt] no scannable bodies available');
            }
            queue = pickTargets(keys);
            if (!queue.length) throw new Error('[scan-hunt] could not select any targets');
            index = 0;
            found = 0;
            missed = 0;
            finished = false;
        },

        start() {
            announce();
        },

        /**
         * Nothing to advance frame by frame: the clock lives in the core (maxMs)
         * and progress is driven by scans. Returning null every tick is the
         * correct behaviour for a mission that is waiting on the player, and it
         * is also the proof that the core's tick contract does not force a
         * mission to invent per-frame work it does not have.
         */
        update() {
            return finished ? { won: true } : null;
        },

        /**
         * Called by the host when the player scans something.
         * Returns true if it was the target, so the host can react.
         */
        onScan(key) {
            if (finished || !currentTarget()) return false;

            if (key === currentTarget()) {
                found++;
                index++;
                if (audio.blip) audio.blip(880);
                if (hud.flash) hud.flash('correct');
                if (index >= queue.length) {
                    finished = true;
                } else {
                    announce();
                }
                return true;
            }

            missed++;
            if (audio.blip) audio.blip(220);
            if (hud.flash) hud.flash('wrong');
            if (hud.setProgress) hud.setProgress(index, queue.length, missed);
            return false;
        },

        onInput(event) {
            if (event && event.type === 'scan') this.onScan(event.key);
        },

        end(verdict) {
            const elapsedGuess = queue.length ? DURATION_MS : 0;
            return {
                found,
                missed,
                // The core measures real elapsed time and merges it in; this is
                // only a fallback for hosts that do not.
                elapsedMs: (verdict && verdict.elapsedMs) || elapsedGuess,
                targets: queue.length
            };
        },

        teardown() {
            if (hud.setObjective) hud.setObjective('');
        },

        /* exposed for tests and for a host that wants to render its own HUD */
        _state: () => ({ queue: queue.slice(), index, found, missed, finished })
    };
}

export default createScanHunt;

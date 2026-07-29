/**
 * Mission core — the state machine every Spaceverse mission runs on.
 *
 * Three constraints shape this file, and breaking any of them breaks a mission
 * somewhere:
 *
 *   1. It imports NO Three.js. The app runs three different Three.js versions
 *      (0.182 ESM on the VR pages, 0.128 classic scripts on solar-system and
 *      traffic-visualization, 0.160 on a dead page). A core that imported any of
 *      them could only ever run on a third of the site. Missions own renderers;
 *      the core does not.
 *
 *   2. It owns NO frame loop. Inside an immersive WebXR session
 *      `window.requestAnimationFrame` does not fire — three drives frames through
 *      `renderer.setAnimationLoop`, which is what VRApp already uses. A core with
 *      its own rAF would silently freeze every mission the moment a player put on
 *      a headset. So the host pumps `tick(dt)` from whatever loop it owns.
 *
 *   3. Missions report FACTS, never scores. `end()` returns what happened and the
 *      server decides what it was worth. A client that can name its own score can
 *      name any score, and these scores rank people against each other.
 *
 * State machine:
 *
 *      register(mission)
 *            |
 *            v
 *      [ idle ] --run(id)--> [ briefing ] --start()--> [ playing ]
 *          ^                                              |  |  |
 *          |                        update() -> {won} ----+  |  |
 *          |                        update() -> {failed} ----+  |
 *          |                        maxMs exceeded ------------+
 *          |                                              |
 *          |                                              v
 *          |                                        [ ending ]
 *          |                                              |
 *          |                                     end() -> facts
 *          |                                              |
 *          |                                              v
 *          +----- retry() / exit() ----------------- [ results ]
 *                                                          |
 *                                            submit(facts) | (async, never blocks)
 *                                                          v
 *                                              saved | queued for retry
 *
 * abort() cuts from [playing] straight to [idle] with `abandoned: true` in the
 * facts and no submission. It exists because Escape is bound globally in the VR
 * app and would otherwise destroy a run with no record that it happened.
 */

const RUN_ENDPOINT = '/api/game/run';
const QUEUE_KEY = 'spaceverse.runQueue';

/* Missions may omit these; the core checks before calling. */
const OPTIONAL_HOOKS = ['onInput', 'onPause', 'teardown'];
const REQUIRED_HOOKS = ['init', 'start', 'update', 'end'];

/**
 * How long after start() the core waits for its first tick before deciding the
 * host forgot to pump it. Chosen to be far longer than any real frame interval
 * (even a slow first frame with texture uploads) and far shorter than a player's
 * patience. Without this, a mission wired into a page whose loop never calls
 * tick() just sits there looking like a hang, and the failure is invisible on a
 * flat screen because that is not where it happens.
 */
const TICK_WATCHDOG_MS = 2000;

const registry = new Map();

const state = {
    phase: 'idle',          // idle | briefing | playing | ending | results
    mission: null,
    ctx: null,
    elapsedMs: 0,
    startedAt: 0,
    lastTickAt: 0,
    // Tracked as a flag, not inferred from lastTickAt being non-zero.
    // performance.now() measures time since page load, so a mission that starts
    // on the first frame legitimately ticks at t=0 and a truthiness check on the
    // timestamp would report it as never having ticked at all.
    receivedTick: false,
    watchdogId: null,
    warnedNoTick: false
};

const listeners = {
    phase: [],
    result: [],
    warning: []
};

function emit(name, payload) {
    for (const fn of listeners[name] || []) {
        try {
            fn(payload);
        } catch (err) {
            console.error(`[game-core] ${name} listener threw:`, err);
        }
    }
}

function setPhase(phase) {
    state.phase = phase;
    emit('phase', { phase, missionId: state.mission ? state.mission.meta.id : null });
}

/* ── registry ──────────────────────────────────────────────────────── */

export function register(mission) {
    if (!mission || !mission.meta || !mission.meta.id) {
        throw new Error('[game-core] mission needs meta.id');
    }
    const missing = REQUIRED_HOOKS.filter((h) => typeof mission[h] !== 'function');
    if (missing.length) {
        throw new Error(`[game-core] mission "${mission.meta.id}" is missing: ${missing.join(', ')}`);
    }
    if (registry.has(mission.meta.id)) {
        throw new Error(`[game-core] duplicate mission id "${mission.meta.id}"`);
    }
    registry.set(mission.meta.id, mission);
    return mission;
}

/**
 * Remove a registered mission. Registration is deliberately one-shot per id
 * (a duplicate almost always means a page wired the same mission twice), so
 * replacing one has to be explicit rather than a silent overwrite.
 */
export function unregister(id) {
    return registry.delete(id);
}

export function get(id) {
    return registry.get(id) || null;
}

export function list() {
    return Array.from(registry.values()).map((m) => m.meta);
}

/* ── watchdog ──────────────────────────────────────────────────────── */

function armWatchdog() {
    disarmWatchdog();
    state.warnedNoTick = false;
    state.watchdogId = setTimeout(() => {
        if (state.phase !== 'playing') return;
        if (state.receivedTick) return;   // ticks arrived; nothing to warn about
        state.warnedNoTick = true;
        const id = state.mission ? state.mission.meta.id : '(unknown)';
        console.error(
            `[game-core] "${id}" started but received no tick within ${TICK_WATCHDOG_MS}ms. ` +
            'The host page is not pumping MissionCore.tick(dt). Inside a WebXR session ' +
            'this must come from renderer.setAnimationLoop, not requestAnimationFrame.'
        );
        emit('warning', { code: 'no-tick', missionId: id });
    }, TICK_WATCHDOG_MS);
}

function disarmWatchdog() {
    if (state.watchdogId) clearTimeout(state.watchdogId);
    state.watchdogId = null;
}

/* ── run lifecycle ─────────────────────────────────────────────────── */

/**
 * Start a mission. `ctx` is handed to the mission untouched — it is where the
 * host passes its scene, renderer, audio, or anything else the mission needs.
 * The core never reads it.
 */
export async function run(missionId, ctx = {}) {
    if (state.phase === 'playing') {
        throw new Error('[game-core] a mission is already running; abort() first');
    }
    const mission = registry.get(missionId);
    if (!mission) {
        throw new Error(`[game-core] unknown mission "${missionId}"`);
    }

    state.mission = mission;
    state.ctx = ctx;
    state.elapsedMs = 0;
    state.lastTickAt = 0;
    state.receivedTick = false;
    setPhase('briefing');

    try {
        await mission.init(ctx);
    } catch (err) {
        // Surface init failures instead of leaving the player on a brief screen
        // that never becomes a game.
        state.mission = null;
        setPhase('idle');
        throw err;
    }

    await mission.start();
    state.startedAt = now();
    setPhase('playing');
    armWatchdog();
    return mission.meta;
}

/**
 * Advance the running mission. Called by the HOST's frame loop, once per frame.
 * `dt` is seconds since the previous frame.
 *
 * Returns the run result object when the mission ends on this tick, otherwise
 * null — so a host that wants to react immediately can, without subscribing.
 */
export function tick(dt) {
    if (state.phase !== 'playing') return null;

    state.lastTickAt = now();
    state.receivedTick = true;
    state.elapsedMs += dt * 1000;

    let verdict = null;
    try {
        verdict = state.mission.update(dt) || null;
    } catch (err) {
        console.error('[game-core] update() threw; ending run as failed:', err);
        return finish({ failed: true, reason: 'error' });
    }

    const maxMs = state.mission.meta.maxMs;
    if (!verdict && maxMs && state.elapsedMs >= maxMs) {
        verdict = { failed: true, reason: 'timeout' };
    }
    if (!verdict) return null;

    return finish(verdict);
}

/**
 * End the run, collect facts, hand them to the server. Never throws at the
 * caller: a mission that ends is a mission that ends, whatever the network does.
 */
function finish(verdict) {
    disarmWatchdog();
    setPhase('ending');

    let facts = {};
    try {
        facts = state.mission.end(verdict) || {};
    } catch (err) {
        console.error('[game-core] end() threw; submitting what we have:', err);
    }

    const result = {
        missionId: state.mission.meta.id,
        title: state.mission.meta.title,
        won: !!verdict.won,
        failed: !!verdict.failed,
        reason: verdict.reason || null,
        abandoned: !!verdict.abandoned,
        elapsedMs: Math.round(state.elapsedMs),
        facts
    };

    callOptional('teardown');
    setPhase('results');

    // Abandoned runs are not achievements. Nothing is submitted for them, but
    // the result is still emitted so the UI can unwind cleanly.
    if (!result.abandoned) {
        submit(result).then((outcome) => {
            result.saved = outcome.saved;
            result.queued = outcome.queued;
            result.score = outcome.score;
            result.progression = outcome.progression;
            emit('result', result);
        });
    } else {
        result.saved = false;
        result.queued = false;
        emit('result', result);
    }

    return result;
}

/**
 * Stop a run without scoring it. Used when the player leaves deliberately, e.g.
 * the global Escape binding in the VR app.
 */
export function abort(reason = 'abandoned') {
    if (state.phase !== 'playing' && state.phase !== 'briefing') return null;
    if (state.phase === 'briefing') {
        // Nothing started, so nothing to end.
        disarmWatchdog();
        callOptional('teardown');
        state.mission = null;
        setPhase('idle');
        return null;
    }
    return finish({ abandoned: true, reason });
}

export function pause(isPaused) {
    callOptional('onPause', isPaused);
}

export function input(event) {
    callOptional('onInput', event);
}

function callOptional(hook, ...args) {
    if (!state.mission) return;
    if (!OPTIONAL_HOOKS.includes(hook)) return;
    if (typeof state.mission[hook] !== 'function') return;
    try {
        state.mission[hook](...args);
    } catch (err) {
        console.error(`[game-core] ${hook}() threw:`, err);
    }
}

/** Return to idle, ready for another run. */
export function reset() {
    disarmWatchdog();
    state.mission = null;
    state.ctx = null;
    state.elapsedMs = 0;
    state.lastTickAt = 0;
    state.receivedTick = false;
    setPhase('idle');
}

/* ── submission, with an offline queue ─────────────────────────────── */

/**
 * Post a finished run. The score screen has ALREADY rendered by the time this
 * runs — a player who just spent three minutes on a mission does not wait on
 * conference wifi to find out how they did. If the post fails the run is queued
 * and the UI is told plainly that it is not saved, rather than pretending.
 */
export async function submit(result) {
    const payload = {
        missionId: result.missionId,
        won: result.won,
        failed: result.failed,
        elapsedMs: result.elapsedMs,
        facts: result.facts
        // Deliberately no `score`. The server computes it.
    };

    try {
        const res = await fetch(RUN_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        // A successful call is the right moment to drain anything stranded
        // earlier — the network is demonstrably back.
        flushQueue();
        return { saved: true, queued: false, score: body.score, progression: body.progression };
    } catch (err) {
        enqueue(payload);
        console.warn('[game-core] run not saved, queued for retry:', err.message);
        return { saved: false, queued: true, score: null, progression: null };
    }
}

function readQueue() {
    try {
        const raw = sessionStorage.getItem(QUEUE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        // Corrupt or unavailable storage must not take the game down with it.
        return [];
    }
}

function writeQueue(items) {
    try {
        sessionStorage.setItem(QUEUE_KEY, JSON.stringify(items));
    } catch (err) {
        console.warn('[game-core] could not persist run queue:', err.message);
    }
}

function enqueue(payload) {
    const q = readQueue();
    q.push({ payload, queuedAt: new Date().toISOString() });
    writeQueue(q);
}

export function queueDepth() {
    return readQueue().length;
}

/**
 * Drain queued runs oldest-first. Stops at the first failure and puts the
 * remainder back, so ordering is preserved and a still-broken network does not
 * burn through the whole queue re-failing.
 */
export async function flushQueue() {
    const q = readQueue();
    if (!q.length) return { flushed: 0, remaining: 0 };

    let flushed = 0;
    while (q.length) {
        const item = q[0];
        try {
            const res = await fetch(RUN_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(item.payload)
            });
            if (!res.ok) break;
            q.shift();
            flushed++;
        } catch (err) {
            break;
        }
    }
    writeQueue(q);
    return { flushed, remaining: q.length };
}

/* ── subscriptions + introspection ─────────────────────────────────── */

export function on(event, fn) {
    if (!listeners[event]) throw new Error(`[game-core] no such event "${event}"`);
    listeners[event].push(fn);
    return () => {
        const i = listeners[event].indexOf(fn);
        if (i >= 0) listeners[event].splice(i, 1);
    };
}

export function snapshot() {
    return {
        phase: state.phase,
        missionId: state.mission ? state.mission.meta.id : null,
        elapsedMs: Math.round(state.elapsedMs),
        running: state.phase === 'playing',
        receivedTick: state.receivedTick,
        warnedNoTick: state.warnedNoTick,
        queued: queueDepth()
    };
}

function now() {
    return typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();
}

export const TICK_WATCHDOG = TICK_WATCHDOG_MS;

export default {
    register, unregister, get, list, run, tick, abort, pause, input, reset,
    submit, flushQueue, queueDepth, on, snapshot, TICK_WATCHDOG
};

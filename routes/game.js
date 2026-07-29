/**
 * Game missions — run submission and progression.
 *
 * The one rule this file exists to enforce: **the client never names its own
 * score.** It reports what happened (how many targets it found, how long it
 * took, how many satellites it lost) and the server decides what that was worth.
 * The old quiz endpoint took `score` straight from the request body and stored
 * it, which was harmless while scores were private and stops being harmless the
 * moment they rank people against each other.
 *
 * Adding a mission means adding an entry to MISSIONS below. Each declares the
 * facts it reports, the valid range of each, and a pure scoring function. A fact
 * outside its declared range is a rejected run, not a clamped one — out-of-range
 * values mean either a bug or someone poking at the endpoint, and quietly
 * accepting a clamped version hides both.
 */
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const { syncTotals } = require('../models/user-score');

/**
 * The Kessler scoring rule lives in public/js/shared/kessler-risk.mjs so the
 * browser and this server run the identical function. That file is an ES module
 * (the browser has to import it), and this router is CommonJS, so it is loaded
 * once at startup through a dynamic import rather than required.
 */
let scoreKesslerRunImpl = null;
const kesslerReady = import('../public/js/shared/kessler-risk.mjs')
    .then((mod) => { scoreKesslerRunImpl = mod.scoreRun; })
    .catch((err) => { console.error('Could not load shared Kessler scoring:', err); });

function scoreKesslerRun(facts, ctx) {
    if (!scoreKesslerRunImpl) {
        // Only reachable if a run lands in the milliseconds before the dynamic
        // import settles. Refusing to guess beats inventing a second formula.
        throw new Error('Kessler scoring module is not loaded yet');
    }
    return scoreKesslerRunImpl(facts, ctx);
}

function ensureAuthenticated(req, res, next) {
    if (req.session && req.session.userId) return next();
    return res.status(401).json({ success: false, message: 'Authentication required' });
}

/**
 * Mission scoring table.
 *
 * `facts` maps each reported field to [min, max]. `score(facts, ctx)` returns a
 * number of mission XP. Keep these pure: they run on the server, they are the
 * authority, and they need to be testable without a database.
 */
const MISSIONS = {
    'scan-hunt': {
        title: 'Scan Hunt',
        facts: {
            found: [0, 20],
            missed: [0, 40],
            elapsedMs: [0, 15 * 60 * 1000]
        },
        score({ found, missed, elapsedMs }, { won }) {
            if (!found) return 0;
            let xp = found * 10 - missed * 2;
            // Speed bonus, but only for a completed hunt: rewarding a fast
            // failure would make quitting early the optimal strategy.
            if (won) {
                const seconds = elapsedMs / 1000;
                if (seconds < 60) xp += 15;
                else if (seconds < 120) xp += 8;
            }
            return Math.max(0, Math.round(xp));
        }
    },

    'kessler-run': {
        title: 'Kessler Run',
        facts: {
            satellitesAlive: [0, 200],
            satellitesLost: [0, 200],
            fuelSpent: [0, 100],
            survivedMs: [0, 30 * 60 * 1000],
            peakRisk: [0, 100]
        },
        // Imported, not reimplemented. The browser shows a live risk meter and a
        // projected score from this same module, so a copy here would drift on
        // the first balance pass and the player would watch one number while
        // being scored on another.
        score: (facts, ctx) => scoreKesslerRun(facts, ctx)
    },

    'quiz-run': {
        title: 'Launch Checklist',
        facts: {
            correct: [0, 100],
            wrong: [0, 100],
            livesLeft: [0, 3],
            elapsedMs: [0, 60 * 60 * 1000]
        },
        score({ correct, wrong, livesLeft }, { won }) {
            let xp = correct * 3 - wrong;
            if (won) xp += livesLeft * 5;
            return Math.max(0, Math.round(xp));
        }
    }
};

/**
 * Validate reported facts against a mission's declared ranges.
 * Returns { ok: true, facts } or { ok: false, error }.
 */
function validateFacts(mission, reported) {
    const facts = {};
    for (const [key, [min, max]] of Object.entries(mission.facts)) {
        const raw = reported ? reported[key] : undefined;
        const value = raw === undefined ? 0 : Number(raw);
        if (!Number.isFinite(value)) {
            return { ok: false, error: `fact "${key}" is not a number` };
        }
        if (value < min || value > max) {
            return { ok: false, error: `fact "${key}" out of range (${min}..${max})` };
        }
        facts[key] = value;
    }
    return { ok: true, facts };
}

/** Expose the table so tests and tooling can reason about it without a request. */
router.MISSIONS = MISSIONS;
router.validateFacts = validateFacts;
/** Resolves once the shared Kessler scoring module has loaded. */
router.ready = kesslerReady;

// POST /api/game/run — record a finished mission run.
router.post('/run', ensureAuthenticated, async (req, res) => {
    try {
        const { missionId, won, failed, elapsedMs } = req.body || {};

        const mission = MISSIONS[missionId];
        if (!mission) {
            return res.status(400).json({ success: false, message: `Unknown mission "${missionId}"` });
        }

        // elapsedMs is measured by the core rather than the mission, so it
        // arrives alongside the facts rather than inside them. Missions that
        // score on time declare it in their own facts too.
        const reported = Object.assign({}, req.body.facts, {
            elapsedMs: req.body.facts && req.body.facts.elapsedMs !== undefined
                ? req.body.facts.elapsedMs
                : elapsedMs
        });

        const check = validateFacts(mission, reported);
        if (!check.ok) {
            return res.status(400).json({ success: false, message: check.error });
        }

        const score = mission.score(check.facts, { won: !!won, failed: !!failed });

        // Ephemeral sessions have no User document behind them (minted when the
        // database was unreachable). Keep their runs in the session so the
        // player still sees a history for the visit, mirroring the quiz.
        if (req.session.ephemeral) {
            req.session.gameRuns = req.session.gameRuns || [];
            req.session.gameRuns.push({ missionId, score, won: !!won, completedAt: new Date() });
            return res.json({
                success: true,
                persisted: false,
                score,
                progression: null,
                message: 'Scored for this session only — no pilot record behind this login.'
            });
        }

        const UserScore = mongoose.model('UserScore');
        let userScore = await UserScore.findOne({ userId: req.session.userId });
        if (!userScore) userScore = new UserScore({ userId: req.session.userId });

        const previousLevel = userScore.level;
        userScore.missionXp = (userScore.missionXp || 0) + score;
        userScore.totalMissions = (userScore.totalMissions || 0) + 1;

        const newBadges = [];
        if (userScore.totalMissions === 1) {
            newBadges.push({ id: 'first_mission', name: 'First Mission', earnedAt: new Date() });
        }
        if (won && !userScore.badges.some((b) => b.id === `cleared_${missionId}`)) {
            newBadges.push({
                id: `cleared_${missionId}`,
                name: `Cleared: ${mission.title}`,
                earnedAt: new Date()
            });
        }
        userScore.badges.push(...newBadges);

        syncTotals(userScore);
        await userScore.save();

        res.json({
            success: true,
            persisted: true,
            score,
            progression: {
                missionXp: userScore.missionXp,
                totalScore: userScore.totalScore,
                level: userScore.level,
                promoted: userScore.level !== previousLevel,
                totalMissions: userScore.totalMissions,
                newBadges
            }
        });
    } catch (error) {
        console.error('Error recording game run:', error);
        res.status(500).json({ success: false, message: 'Could not record run' });
    }
});

// GET /api/game/missions — what the server is willing to score.
router.get('/missions', (req, res) => {
    res.json({
        success: true,
        missions: Object.entries(MISSIONS).map(([id, m]) => ({
            id,
            title: m.title,
            facts: Object.keys(m.facts)
        }))
    });
});

module.exports = router;

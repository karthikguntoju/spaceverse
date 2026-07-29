/**
 * UserScore — the single progression record for a pilot.
 *
 * This used to live inside routes/simulator.js, where it was owned by one
 * feature while nothing else could reach it. It is now the app-wide progression
 * store: the traffic simulator writes to it, and so do game missions.
 *
 * Two things here need care because this schema already has documents in Atlas:
 *
 *   1. The `level` enum was ['Safe Launcher', 'Orbital Optimizer',
 *      'Space Sustainability Engineer']. Those three values are still valid and
 *      still first, so existing documents keep loading. New ranks are APPENDED.
 *      Renaming or reordering would break every document already stored.
 *
 *   2. `totalScore` is denormalised. The leaderboard used to compute it with an
 *      $add inside an aggregate, which cannot use an index, so ranking anyone
 *      meant a full collection scan — twice, because finding the caller's own
 *      rank was a second scan. Maintained here on every write instead, and
 *      indexed, so both become indexed operations.
 *
 * Score axes stay named for their simulator meaning rather than being renamed to
 * something game-flavoured: views/space-traffic-simulator.html reads them by
 * hardcoded DOM id (safetyScore, sustainabilityScore, efficiencyScore,
 * userLevel), so a rename is a visible breakage for zero benefit.
 */
const mongoose = require('mongoose');

/**
 * Rank ladder, in order. The first three are the original simulator levels and
 * MUST keep their exact strings and positions.
 */
const LEVELS = [
    'Safe Launcher',
    'Orbital Optimizer',
    'Space Sustainability Engineer',
    'Flight Officer',
    'Mission Commander',
    'Flight Director'
];

/**
 * Cumulative totalScore needed to hold each rank, same order as LEVELS.
 *
 * The first three are chosen to reproduce the simulator's original rule exactly.
 * That rule was on the AVERAGE of the three axes: avg >= 80 for the top tier,
 * avg >= 60 for the middle. Three axes, so those are totals of 240 and 180. Any
 * other numbers here would silently re-rank every existing player the first time
 * their document was saved.
 */
const LEVEL_THRESHOLDS = [0, 180, 240, 400, 700, 1100];

const userScoreSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    scores: {
        safetyScore: { type: Number, default: 0, min: 0, max: 100 },
        sustainabilityScore: { type: Number, default: 0, min: 0, max: 100 },
        efficiencyScore: { type: Number, default: 0, min: 0, max: 100 }
    },
    // Uncapped progression from game missions. Separate from the three axes
    // because those cap at 100 each, so without it the ladder would top out at
    // 300 and every rank above 'Space Sustainability Engineer' would be
    // unreachable no matter how many missions a player flew.
    missionXp: { type: Number, default: 0, min: 0 },
    // Axes + missionXp. Denormalised so the leaderboard can sort and rank on an
    // index instead of scanning the collection twice. Kept in sync by
    // syncTotals(). For a document created before missions existed missionXp is
    // 0, so this equals exactly what the old $add aggregate produced.
    totalScore: { type: Number, default: 0, index: -1 },
    level: {
        type: String,
        default: 'Safe Launcher',
        enum: LEVELS
    },
    badges: [{
        id: String,
        name: String,
        earnedAt: { type: Date, default: Date.now }
    }],
    achievements: [{
        id: String,
        name: String,
        description: String,
        progress: Number,
        target: Number,
        earnedAt: Date
    }],
    totalSimulations: { type: Number, default: 0 },
    // Missions completed through the game core, separate from simulator runs so
    // neither counter lies about the other.
    totalMissions: { type: Number, default: 0 },
    lastUpdated: {
        type: Date,
        default: Date.now
    }
});

/** Recompute totalScore and level from the three axes. Call before every save. */
function syncTotals(doc) {
    const s = doc.scores || {};
    doc.totalScore =
        (s.safetyScore || 0) + (s.sustainabilityScore || 0) + (s.efficiencyScore || 0) +
        (doc.missionXp || 0);

    let level = LEVELS[0];
    for (let i = 0; i < LEVELS.length; i++) {
        if (doc.totalScore >= LEVEL_THRESHOLDS[i]) level = LEVELS[i];
    }
    doc.level = level;
    doc.lastUpdated = new Date();
    return doc;
}

// Belt and braces: even a caller that forgets syncTotals cannot persist a
// totalScore that disagrees with the axes it is derived from.
userScoreSchema.pre('save', function preSave(next) {
    syncTotals(this);
    next();
});

const clamp100 = (n) => Math.max(0, Math.min(100, n));

module.exports = {
    userScoreSchema,
    LEVELS,
    LEVEL_THRESHOLDS,
    syncTotals,
    clamp100,
    /** Registered by initializeModels() in routes/simulator.js. */
    model: () => mongoose.model('UserScore')
};

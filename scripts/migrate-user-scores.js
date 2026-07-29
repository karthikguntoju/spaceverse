#!/usr/bin/env node
/**
 * Backfill UserScore.totalScore and UserScore.missionXp.
 *
 * The leaderboard used to compute the total on every read with an $add inside an
 * aggregate. It now sorts on a stored, indexed totalScore instead. Documents
 * written before that change have no such field, so until this runs they all
 * sort as 0 and the leaderboard looks empty.
 *
 * Safe to run more than once: it only writes documents whose stored total
 * disagrees with the value derived from their own axes.
 *
 *   node scripts/migrate-user-scores.js          # apply
 *   node scripts/migrate-user-scores.js --dry    # report only, write nothing
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { userScoreSchema, syncTotals } = require('../models/user-score');

const DRY = process.argv.includes('--dry');

async function main() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGODB_URI is not set. Refusing to guess a database.');
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log(`Connected. Mode: ${DRY ? 'DRY RUN (no writes)' : 'APPLY'}`);

    const UserScore = mongoose.models.UserScore || mongoose.model('UserScore', userScoreSchema);
    const docs = await UserScore.find({});
    console.log(`Found ${docs.length} score documents.`);

    let changed = 0;
    for (const doc of docs) {
        const before = { totalScore: doc.totalScore, level: doc.level };
        if (typeof doc.missionXp !== 'number') doc.missionXp = 0;
        syncTotals(doc);

        if (before.totalScore === doc.totalScore && before.level === doc.level) continue;

        changed++;
        console.log(
            `  ${doc.userId}: totalScore ${before.totalScore ?? '(unset)'} -> ${doc.totalScore}` +
            (before.level !== doc.level ? `, level "${before.level}" -> "${doc.level}"` : '')
        );
        if (!DRY) await doc.save();
    }

    console.log(
        DRY
            ? `Would update ${changed} of ${docs.length} documents. Re-run without --dry to apply.`
            : `Updated ${changed} of ${docs.length} documents.`
    );

    await mongoose.disconnect();
}

main().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});

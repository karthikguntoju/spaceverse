/**
 * Test harness for the Express app.
 *
 * app-enhanced.js is inert when NODE_ENV=test (no listen, no Atlas connection, no
 * seed data insert), so a test can require it and then own the database itself.
 *
 *   startTestDb()  ->  boots an in-memory MongoDB and connects mongoose to it
 *   loadApp()      ->  requires the app AFTER the connection exists, so the
 *                      models it registers bind to the in-memory database
 *   stopTestDb()   ->  disconnects and shuts the in-memory server down
 *
 * Order matters: requiring the app registers Mongoose models at module scope, so
 * the connection has to be up first or those models attach to a dead default
 * connection and every query hangs until the test times out.
 */
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod = null;

async function startTestDb() {
    process.env.NODE_ENV = 'test';
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    process.env.MONGODB_URI = uri;
    await mongoose.connect(uri);
    return uri;
}

function loadApp() {
    // Fresh require each time would re-register models and throw
    // OverwriteModelError, so the module cache is deliberately NOT cleared.
    return require('../../app-enhanced.js');
}

async function stopTestDb() {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
    mongod = null;
}

/** Wipe every collection between tests without paying to rebuild the server. */
async function clearDb() {
    const { collections } = mongoose.connection;
    for (const name of Object.keys(collections)) {
        await collections[name].deleteMany({});
    }
}

/**
 * Log in through the real demo endpoint and return the session cookie, so tests
 * exercise the same identity path a player does rather than forging a session.
 */
async function loginAs(request, app, callsign) {
    const res = await request(app)
        .post('/api/login')
        .send({ username: callsign, password: 'anything' });
    const cookie = res.headers['set-cookie'];
    return { cookie, body: res.body };
}

module.exports = { startTestDb, stopTestDb, clearDb, loadApp, loginAs };

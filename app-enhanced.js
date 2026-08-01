// Enhanced Spaceverse Application
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo').default || require('connect-mongo');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config();
require('dns').setServers(['8.8.8.8', '8.8.4.4']);
const { GoogleGenAI } = require('@google/genai');

// --- Firebase Authentication Setup ---
const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } = require('firebase/auth');

const firebaseConfig = {
  apiKey: "AIzaSyAYuJAIjnHjBvyc5gvZJDJIanc5fnolW0A",
  authDomain: "spaceverse-d263d.firebaseapp.com",
  projectId: "spaceverse-d263d",
  storageBucket: "spaceverse-d263d.firebasestorage.app",
  messagingSenderId: "34859465212",
  appId: "1:34859465212:web:ed34af048d9d1852bfda79"
};

const firebaseApp = initializeApp(firebaseConfig);
const firebaseAuth = getAuth(firebaseApp);
// -------------------------------------

const ai = new GoogleGenAI({}); // Automatically picks up GEMINI_API_KEY from .env

const app = express();

// Diagnostics: capture unexpected errors and exit events to help debugging
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason && reason.stack ? reason.stack : reason);
});
process.on('exit', (code) => {
    console.log('Process exiting with code', code);
});

const PORT = process.env.PORT || 5000;

// A managed host (Render, Railway, Fly, Heroku) assigns the port and routes
// traffic to exactly that number. Scanning for the next free one there is
// actively harmful: if the probe ever comes back false the app binds PORT + 1,
// nothing is listening where the platform is routing, and the health check
// fails with no error that points at the cause. Probing is a local-dev
// convenience for when 5000 is already taken — so it stays, but only off-prod.
const MUST_BIND_ASSIGNED_PORT = process.env.NODE_ENV === 'production' && Boolean(process.env.PORT);

// Function to find an available port
async function findAvailablePort(startPort) {
    const net = require('net');

    function isPortAvailable(port) {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.listen(port, () => {
                server.once('close', () => resolve(true));
                server.close();
            });
            server.on('error', () => resolve(false));
        });
    }

    let port = startPort;
    while (!(await isPortAvailable(port))) {
        port++;
    }
    return port;
}

// Every managed host (Render, Railway, Fly, Heroku) terminates TLS at a proxy
// and forwards over plain HTTP. Without this Express reads the proxy's own
// address as the client IP — which silently breaks per-IP rate limiting — and
// treats the request as insecure, so it refuses to set a `secure` cookie and
// nobody can log in. One hop is what all of the above put in front of us.
const BEHIND_PROXY = process.env.NODE_ENV === 'production' || process.env.TRUST_PROXY === 'true';
if (BEHIND_PROXY) app.set('trust proxy', 1);

// Middleware
app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Shared MongoDB connection options. Defaults are tuned for a stable datacenter
// link; on a home/hotspot connection a brief drop would otherwise surface as
// `MongoNetworkError: connect ETIMEDOUT` instead of being retried transparently.
const MONGO_CONNECT_OPTIONS = {
    serverSelectionTimeoutMS: 30000, // ride out short outages before failing a query
    connectTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    heartbeatFrequencyMS: 15000,     // fewer monitor pings => less noise on a flaky link
    maxPoolSize: 10,
    minPoolSize: 1,
    maxIdleTimeMS: 60000,
    retryWrites: true,
    retryReads: true
};

// Session middleware (must be before routes that need it).
// Use a persistent MongoDB-backed store when a URI is available so sessions
// survive server restarts (otherwise the default in-memory store logs everyone
// out on every restart, causing protected pages to redirect back to home).
// A signing secret checked into the source signs nothing: anyone with the repo
// can mint a session cookie. Fine on a laptop, refused in production — better a
// server that will not boot than one quietly running on a public secret.
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    console.error('SESSION_SECRET is required in production. Set it in the host environment.');
    process.exit(1);
}
const sessionOptions = {
    secret: process.env.SESSION_SECRET || 'spaceverse-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
        // Over HTTPS the cookie must be `secure`, or it travels in the clear and
        // any network between the visitor and us can replay their session.
        secure: BEHIND_PROXY,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    } // 24 hours
};
if (process.env.MONGODB_URI) {
    try {
        const store = MongoStore.create({
            mongoUrl: process.env.MONGODB_URI,
            collectionName: 'sessions',
            ttl: 24 * 60 * 60, // 1 day, matches cookie maxAge
            // Same resilience settings as the main pool: on a flaky link (hotspot,
            // tethering) a short drop should be waited out, not surfaced as an error.
            mongoOptions: MONGO_CONNECT_OPTIONS
        });
        // Without this listener a transient network drop emits an unhandled 'error'
        // event and dumps a full driver stack trace to the console.
        store.on('error', (e) => console.warn('Session store (transient):', e.message));
        sessionOptions.store = store;
        console.log('Session store: MongoDB (persistent across restarts)');
    } catch (e) {
        console.warn('Failed to init MongoStore, using in-memory sessions:', e.message);
    }
} else {
    console.warn('Session store: in-memory (sessions lost on restart — set MONGODB_URI to persist)');
}
app.use(session(sessionOptions));

// Route handlers (must be before static file middleware)
// `/` is the front door: signed-out visitors get the marketing landing page
// (rocket launch intro -> about -> features -> sign in); signed-in pilots get
// the Spaceverse app itself.
app.get('/', (req, res) => {
    if (req.session && req.session.userId) {
        return res.sendFile(path.join(__dirname, 'views', 'home.html'));
    }
    res.sendFile(path.join(__dirname, 'views', 'landing.html'));
});

// Browsers request /favicon.ico unprompted on every page; without this each
// view logged a 404 in the console.
app.get('/favicon.ico', (req, res) => {
    res.type('image/svg+xml').sendFile(path.join(__dirname, 'public', 'favicon.svg'));
});

// Explicit landing route so a signed-in user can still revisit the intro.
app.get('/landing', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'landing.html'));
});

// Explicit app route (mirrors what `/` serves once authenticated).
app.get('/app', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'home.html'));
});

app.get('/solar-system', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'solar-system.html'));
});

app.get('/quiz', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'quiz.html'));
});


app.get('/space-traffic-simulator', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'space-traffic-simulator.html'));
});

app.get('/space-traffic-visualization', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'space-traffic-visualization.html'));
});

app.get('/community-scenarios', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'community-scenarios.html'));
});

app.get('/reviews', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'reviews.html'));
});

app.get('/mission-tracker', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'mission-tracker.html'));
});

app.get('/artemis-2', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'artemis-2-info.html'));
});

app.get('/space-launches', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'space-launches.html'));
});

app.get('/astronomical-events', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'astronomical-events.html'));
});

app.get('/vr-solar-system', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'vr-working.html'));
});

// Add route for original VR page
app.get('/vr-solar-system-original', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'vr-solar-system-original.html'));
});

// Add route for working VR page
app.get('/vr-working', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'vr-working.html'));
});

// Direct entry into the space roller-coaster ride (same page, ride mode preselected)
app.get('/vr-ride', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'vr-working.html'));
});

// Kessler Run. Its own page rather than surgery on space-traffic-visualization,
// whose orbit rendering lives inside a 1600-line inline script with no module
// boundary and no tests. A small self-contained page is the cheaper trade.
app.get('/mission/kessler', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'mission-kessler.html'));
});

// The Arcade. Eleven small self-contained canvas games, each a single HTML page
// with two plain scripts. The slug is checked against a fixed list rather than
// passed to sendFile, so no request can walk out of views/games.
const ARCADE_GAMES = [
    'gravity-runner', 'kessler-reversed', 'last-station', 'junk-katamari', 're-entry',
    'asteroid-miner', 'slingshot-golf', 'solar-sailor', 'planet-defense', 'orbit-weaver',
    'eclipse'
];

app.get('/games', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'games', 'arcade.html'));
});

app.get('/games/:slug', ensureAuthenticated, (req, res) => {
    if (!ARCADE_GAMES.includes(req.params.slug)) return res.redirect('/games');
    res.sendFile(path.join(__dirname, 'views', 'games', `${req.params.slug}.html`));
});

// Planet detail page
app.get('/planet', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'planet-detail.html'));
});

// Add our new VR diagnostic routes
app.get('/vr-diagnostics', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'vr-diagnostics.html'));
});

app.get('/vr-simple', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'vr-simple.html'));
});

app.get('/vr-bundled', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'vr-bundled.html'));
});

// Add our new VR fallback routes
app.get('/vr-fallback', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'vr-fallback.html'));
});

app.get('/vr-pure-html', ensureAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'vr-pure-html.html'));
});

app.use('/images', express.static('images'));
app.use('/galaxy', express.static('galaxy'));
app.use('/public', express.static('public'));
app.use('/models', express.static('models'));
app.use('/src', express.static('src'));
// Serve local builds for important libraries as a CDN fallback
// Addons (examples/jsm) must be registered before the build mount so VRButton etc. resolve
app.use('/lib/three/addons', express.static(path.join(__dirname, 'node_modules', 'three', 'examples', 'jsm')));
app.use('/lib/three', express.static(path.join(__dirname, 'node_modules', 'three', 'build')));
// Optionally expose other local libs if needed in future
// Prefer any local public lib overrides first (useful for CI/local fallbacks)
app.use('/lib/fiber', express.static(path.join(__dirname, 'public', 'lib', 'fiber')));
app.use('/lib/xr', express.static(path.join(__dirname, 'public', 'lib', 'xr')));
// Then fall back to node_modules dist if present
app.use('/lib/fiber', express.static(path.join(__dirname, 'node_modules', '@react-three', 'fiber', 'dist')));
app.use('/lib/xr', express.static(path.join(__dirname, 'node_modules', '@react-three', 'xr', 'dist')));
app.use(express.static('views'));

// Include reviews route (after session middleware)
app.use('/api/reviews', require('./routes/reviews'));

// Simple auth check middleware for routes that require login
function ensureAuthenticated(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }
    // Not authenticated: redirect to home (which has login/register UI)
    return res.redirect('/');
}

// MongoDB connection with optional Atlas support. If no MONGODB_URI is provided
// the server will continue running and use the local `planets.json` fallback.
const uri = process.env.MONGODB_URI;
// Seed from the driver's actual state rather than assuming disconnected. The
// events below only fire on TRANSITIONS, so if a connection is already open when
// this module loads (anything that requires the app after connecting — a test
// harness, a script, a worker) 'connected' has already fired and would never
// fire again, leaving the flag stuck at false and the whole app serving
// file-backed data against a perfectly healthy database.
let dbConnected = mongoose.connection.readyState === 1;

// Keep `dbConnected` in sync with the driver instead of setting it once at
// startup. Previously a drop after boot left it stuck at `true` (queries then
// hung) and a failed first attempt left it stuck at `false` (the app served
// file-backed data forever, which breaks auth, quiz and simulator).
mongoose.connection.on('connected', () => { dbConnected = true; });
mongoose.connection.on('reconnected', () => {
    dbConnected = true;
    console.log('MongoDB reconnected.');
});
mongoose.connection.on('disconnected', () => {
    dbConnected = false;
    console.warn('MongoDB disconnected - serving file-backed data until it returns.');
});
// The driver retries network blips on its own; log them as one line rather than
// letting an unhandled 'error' event print a full stack trace per attempt.
mongoose.connection.on('error', (err) => {
    console.warn('MongoDB (transient):', err.message);
});

async function initializeDatabase() {
    if (!uri) {
        console.warn('MONGODB_URI environment variable is not set. Running in file-backed mode (no DB).');
        return;
    }

    try {
        await mongoose.connect(uri, MONGO_CONNECT_OPTIONS);
        dbConnected = true;
        console.log('MongoDB connection established successfully.');
        console.log('Connected to:', uri.includes('mongodb+srv') ? 'MongoDB Atlas' : 'Local MongoDB');

        // Only insert enhanced data when we have a live DB connection
        if (typeof insertEnhancedPlanetData === 'function') {
            try {
                await insertEnhancedPlanetData();
                console.log('Enhanced planet data insert completed');
            } catch (err) {
                if (err.code !== 11000) {
                    console.error('Failed to insert enhanced planet data:', err);
                }
            }
        } else {
            console.log('Enhanced planet data insert skipped - function not defined');
        }
    } catch (err) {
        dbConnected = false;
        console.error('MongoDB connection error:', err.message);
        console.warn('Continuing without MongoDB - retrying in the background.');
        retryDatabaseConnection();
    }
}

// Retry the initial connection until it succeeds, so a server started while the
// network is down recovers on its own instead of needing a manual restart.
let dbRetryTimer = null;
function retryDatabaseConnection(attempt = 1) {
    if (dbRetryTimer) return;
    const delay = Math.min(30000, 2000 * 2 ** (attempt - 1)); // 2s, 4s, 8s ... capped at 30s
    dbRetryTimer = setTimeout(async () => {
        dbRetryTimer = null;
        if (mongoose.connection.readyState === 1) return;
        console.log(`Retrying MongoDB connection (attempt ${attempt})...`);
        try {
            await mongoose.connect(uri, MONGO_CONNECT_OPTIONS);
            dbConnected = true;
            console.log('MongoDB connection established successfully.');
        } catch (err) {
            console.warn('MongoDB retry failed:', err.message);
            retryDatabaseConnection(attempt + 1);
        }
    }, delay);
    dbRetryTimer.unref?.(); // don't hold the process open just for a retry
}

// User Schema for Login System
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    firebaseUid: { type: String, default: null },
    // Demo pilots are real User documents so progression has something stable to
    // hang off, but they were never authenticated. Their email is synthesised on
    // a reserved TLD and their password is random and discarded, so they can
    // never be logged into through the real Firebase/bcrypt path. The login
    // handler also rejects them explicitly rather than relying on that alone.
    isDemo: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    quizScores: [{
        score: Number,
        totalQuestions: Number,
        completedAt: { type: Date, default: Date.now }
    }]
});

const User = mongoose.model('User', userSchema);

// Initialize space traffic simulator models after User model is defined
const simulatorRoute = require('./routes/simulator');
simulatorRoute.initializeModels();
app.use('/api/simulator', simulatorRoute.router);

// Game missions. Mounted after initializeModels() because it resolves the
// UserScore model by name, which only exists once the line above has run.
app.use('/api/game', require('./routes/game'));

// Planet Schema (Enhanced)
const planetSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    info: { type: String, required: true },
    radius: { type: Number, required: true },
    distance: { type: Number, default: 0 },
    speed: { type: Number, default: 0 },
    rotationSpeed: { type: Number, default: 0.002 },
    textureUrl: { type: String, required: true },
    ringTextureUrl: { type: String },
    facts: [String],
    quizQuestions: [{
        question: String,
        options: [String],
        correctAnswer: Number
    }]
});

const Planet = mongoose.model('Planet', planetSchema);

// J2000 epoch (approx): 2000-01-01T12:00:00 UTC in milliseconds
// Used as a reference epoch for simple mean-anomaly fallback calculations
const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);

// Authentication Routes
// ---------------------------------------------------------------------------
// DEMO AUTH MODE
// While the product is being demoed there is no real account system: any
// callsign/access code combination is accepted and a session is minted on the
// spot. Nothing is written to MongoDB and Firebase is never contacted.
// Set DEMO_AUTH=false in .env to restore the real Firebase + MongoDB flow.
// ---------------------------------------------------------------------------
const DEMO_AUTH = String(process.env.DEMO_AUTH || 'true').toLowerCase() !== 'false';
if (DEMO_AUTH) {
    console.log('Auth mode: DEMO (any credentials accepted, no database writes)');
}

// Turn whatever the visitor typed into a display name. Falls back to a generic
// callsign so a blank submission still produces a usable session.
function demoCallsign(raw) {
    const name = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 32);
    return name || 'Explorer';
}

// Suffix alphabet with the ambiguous glyphs removed (no 0/O, no 1/I/L). A
// callsign is something a player reads off a screen and types back in later, so
// it has to survive being handwritten on a sticker at a booth.
const CALLSIGN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function callsignSuffix() {
    const bytes = crypto.randomBytes(3);
    let out = '';
    for (let i = 0; i < 3; i++) out += CALLSIGN_ALPHABET[bytes[i] % CALLSIGN_ALPHABET.length];
    return out;
}

// Mint an in-memory session. Fallback for when Mongo is unreachable: `userId` is
// a syntactically valid ObjectId so any downstream route that casts it keeps
// working, but no matching User document exists and nothing persists.
function startEphemeralSession(req, username) {
    req.session.userId = new mongoose.Types.ObjectId().toString();
    req.session.username = username;
    req.session.isDemo = true;
    req.session.ephemeral = true;
    req.session.quizScores = [];
}

/**
 * Resolve a typed callsign to a durable demo pilot.
 *
 *   typed "Nova"      -> no exact match -> creates "Nova-K4M", returns it
 *   typed "Nova-K4M"  -> exact match    -> resumes that pilot, rank intact
 *
 * New pilots ALWAYS get a suffix. Without it, two people typing "Nova" would
 * silently share one record and one rank, which is the failure mode this exists
 * to prevent — a collision now produces a visibly different pilot instead. The
 * cost is that returning players have to type their full callsign, which is why
 * it is echoed back on every response and shown in the HUD.
 *
 * Note the security posture, which is unchanged from before: demo mode has no
 * password, so typing someone's exact full callsign resumes their pilot. That is
 * inherent to passwordless access and is why demo mode must not be treated as an
 * account system.
 */
async function resolveDemoPilot(typed) {
    const base = demoCallsign(typed);

    const existing = await User.findOne({ username: base, isDemo: true });
    if (existing) return existing;

    // Random and immediately discarded. Nothing can authenticate as this pilot
    // through the real login path, which additionally rejects isDemo users.
    const throwaway = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);

    for (let attempt = 0; attempt < 5; attempt++) {
        const callsign = `${base.slice(0, 28)}-${callsignSuffix()}`;
        try {
            return await User.create({
                username: callsign,
                // .invalid is reserved by RFC 2606 and can never resolve, so a
                // synthesised address here can never collide with a real one.
                email: `${callsign.toLowerCase()}@demo.invalid`,
                password: throwaway,
                isDemo: true
            });
        } catch (err) {
            // 11000 is a duplicate key: the suffix collided. Try another.
            if (err && err.code === 11000) continue;
            throw err;
        }
    }
    throw new Error('Could not allocate a callsign after 5 attempts');
}

// Attach a durable demo pilot to the session, falling back to an ephemeral one
// if the database is unreachable. A booth demo must still start when Atlas is
// having a bad day; it just will not remember anything afterwards.
async function startDemoSession(req, typed) {
    if (!dbConnected) {
        const callsign = demoCallsign(typed);
        startEphemeralSession(req, callsign);
        return callsign;
    }

    try {
        const pilot = await resolveDemoPilot(typed);
        req.session.userId = pilot._id.toString();
        req.session.username = pilot.username;
        req.session.isDemo = true;
        req.session.ephemeral = false;
        req.session.quizScores = [];
        return pilot.username;
    } catch (err) {
        console.error('Demo pilot lookup failed, falling back to ephemeral:', err.message);
        const callsign = demoCallsign(typed);
        startEphemeralSession(req, callsign);
        return callsign;
    }
}

// Persist the session before responding. Without this the client can navigate
// away before the (async, Mongo-backed) session store has flushed, which drops
// the user straight back onto the landing page.
function respondWithDemoSession(req, res, username, message) {
    req.session.save((err) => {
        if (err) {
            console.error('Demo session save failed:', err.message);
            return res.status(500).json({ error: 'Could not start session. Please try again.' });
        }
        res.json({ success: true, demo: true, message, username });
    });
}

app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (DEMO_AUTH) {
            const callsign = await startDemoSession(req, username || email);
            return respondWithDemoSession(req, res, callsign,
                `Demo pilot created. Your callsign is ${callsign} — type it to return to this rank.`);
        }

        // Check if user already exists in local DB
        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }

        // Register user securely into Firebase Authentication.
        // If the email already exists in Firebase but has no local DB record
        // (e.g. the DB was reset), verify the password by signing in and then
        // rebuild the local record instead of failing.
        let userCredential;
        try {
            userCredential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
        } catch (firebaseErr) {
            if (firebaseErr.code === 'auth/email-already-in-use') {
                try {
                    userCredential = await signInWithEmailAndPassword(firebaseAuth, email, password);
                } catch (signInErr) {
                    return res.status(400).json({ error: 'This email is already registered. Use the correct password, or log in instead.' });
                }
            } else {
                return res.status(400).json({ error: 'Firebase error: ' + firebaseErr.message });
            }
        }

        // Hash password just for legacy compatibility in DB (or could leave empty, but let's keep it consistent)
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create new user in our local MongoDB to store quiz scores and link with Firebase UID
        const user = new User({
            username,
            email,
            password: hashedPassword,
            firebaseUid: userCredential.user.uid // Link to Firebase
        });

        await user.save();
        req.session.userId = user._id;
        req.session.username = user.username;

        res.json({ success: true, message: 'User registered via Firebase!' });
    } catch (error) {
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (DEMO_AUTH) {
            const callsign = await startDemoSession(req, username);
            return respondWithDemoSession(req, res, callsign, `Demo access granted. Callsign: ${callsign}`);
        }

        // Find user by their username to get the email (since Firebase requires email)
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        // Demo pilots have a synthesised email and a random discarded password,
        // so neither branch below could authenticate them anyway. Reject them
        // explicitly rather than leaving that as an accident of the data.
        if (user.isDemo) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        // Verify password natively with Firebase
        try {
            await signInWithEmailAndPassword(firebaseAuth, user.email, password);
        } catch (firebaseErr) {
            // Check legacy bcrypt password as fallback in case they registered before Firebase
            const isValidPassword = await bcrypt.compare(password, user.password);
            if (!isValidPassword) {
                return res.status(400).json({ error: 'Invalid credentials. Firebase sync failed.' });
            }
        }

        req.session.userId = user._id;
        req.session.username = user.username;

        res.json({ success: true, message: 'Login via Firebase successful', username: user.username });
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
});

app.post('/api/google-login', async (req, res) => {
    try {
        const { idToken } = req.body;
        
        const axios = require('axios');
        const response = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`, {
            idToken
        });
        
        const data = response.data;
        
        if (data.error || !data.users || data.users.length === 0) {
            return res.status(400).json({ error: 'Invalid Google Identity token' });
        }
        
        const googleUser = data.users[0];
        const email = googleUser.email;
        const firebaseUid = googleUser.localId;
        const displayName = googleUser.displayName || email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '');
        
        // Find or create user
        let user = await User.findOne({ email });
        if (!user) {
            let uniqueUsername = displayName;
            let count = 1;
            while (await User.findOne({ username: uniqueUsername })) {
                uniqueUsername = `${displayName}${count++}`;
            }
            
            user = new User({
                username: uniqueUsername,
                email: email,
                password: 'GOOGLE_OAUTH_LOGIN',
                firebaseUid: firebaseUid
            });
            await user.save();
        } else if (!user.firebaseUid) {
            user.firebaseUid = firebaseUid;
            await user.save();
        }
        
        req.session.userId = user._id;
        req.session.username = user.username;
        
        res.json({ success: true, message: 'Google Sign-In successful', username: user.username });
    } catch (error) {
        console.error('Google login error', error);
        res.status(500).json({ error: 'Google Login backend verification failed' });
    }
});

app.post('/api/logout', (req, res) => {
    // `destroy` is async against the Mongo-backed store. Responding before it
    // resolves let the very next request still read the old session, so the
    // client could bounce straight back into the app after "signing out".
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout failed:', err.message);
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.clearCookie(sessionOptions.name || 'connect.sid', { path: '/' });
        res.json({ success: true, message: 'Logged out successfully' });
    });
});

app.get('/api/user', (req, res) => {
    if (req.session.userId) {
        res.json({
            loggedIn: true,
            username: req.session.username,
            demo: !!req.session.isDemo,
            // No User document behind this session, so nothing it does will be
            // remembered. The client surfaces this rather than pretending to save.
            ephemeral: !!req.session.ephemeral,
            user: { id: req.session.userId, username: req.session.username }
        });
    } else {
        res.json({ loggedIn: false });
    }
});

// What the host polls to decide whether this instance is alive, so it stays
// cheap and touches nothing. It reports the database rather than depending on
// it: the site is deliberately usable with Mongo down (demo sessions, static
// planet data), and failing the health check there would put the host into a
// restart loop over a degradation the app already handles.
app.get('/api/health', (req, res) => {
    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    res.json({
        status: 'ok',
        uptime: Math.round(process.uptime()),
        db: states[mongoose.connection.readyState] || 'unknown',
        demoAuth: DEMO_AUTH,
        env: process.env.NODE_ENV || 'development'
    });
});

// Quiz Routes
app.post('/api/quiz/submit', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Please login first' });
        }

        const { score, totalQuestions } = req.body;

        // Only EPHEMERAL sessions lack a User document — those are the fallback
        // minted when Mongo is unreachable. Ordinary demo pilots now have a real
        // durable record, so their scores persist like anyone else's. Keying this
        // on isDemo (as it did before durable pilots existed) would silently
        // throw away every demo score at the end of the visit.
        if (req.session.ephemeral) {
            req.session.quizScores = req.session.quizScores || [];
            req.session.quizScores.push({ score, totalQuestions, completedAt: new Date() });
            return res.json({ success: true, message: 'Quiz score saved for this session' });
        }

        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        user.quizScores.push({ score, totalQuestions });
        await user.save();

        res.json({ success: true, message: 'Quiz score saved' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save quiz score' });
    }
});

app.get('/api/quiz/scores', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Please login first' });
        }

        if (req.session.ephemeral) {
            return res.json({ scores: req.session.quizScores || [] });
        }

        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ scores: user.quizScores });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch quiz scores' });
    }
});

// Planet API Routes
app.get('/api/planets', async (req, res) => {
    try {
        if (dbConnected) {
            const planets = await Planet.find().sort({ distance: 1 });
            return res.json(planets);
        }

        // fallback to planets.json in repository
        const fs = require('fs');
        const path = require('path');
        const pj = fs.readFileSync(path.join(__dirname, 'planets.json'), 'utf8');
        const parsed = JSON.parse(pj);
        // normalize to same shape as DB documents
        const normalized = parsed.map(p => ({
            key: (p.key || (p.name || '').toLowerCase()),
            name: p.name || p.key,
            info: p.info || '',
            radius: p.radius || p.size || 5,
            distance: p.distance || p.distanceFromSun || p.sceneDistance || null,
            speed: p.speed || p.orbitalSpeed || 0,
            rotationSpeed: p.rotationSpeed || 0.002,
            textureUrl: p.textureUrl || p.texture || (p.image ? `/images/${p.image}` : ''),
            ringTextureUrl: p.ringTextureUrl || null,
            facts: p.facts || [],
            quizQuestions: p.quizQuestions || []
        }));
        return res.json(normalized);
    } catch (err) {
        res.status(500).json({ error: 'Error fetching planets' });
    }
});

// Ephemeris endpoint: returns current approximate positions for planets
// Tries to use a local astronomy library if available for better accuracy,
// otherwise falls back to a mean-anomaly circular-orbit projection based on orbital period (J2000).
app.get('/api/ephemeris', async (req, res) => {
    try {
        // Load planet source: prefer DB when connected, otherwise fallback to planets.json
        let sourcePlanets = [];
        const fs = require('fs');
        const path = require('path');

        if (mongoose && mongoose.connection && mongoose.connection.readyState === 1) {
            try {
                sourcePlanets = await Planet.find();
            } catch (e) {
                // fallback to file
            }
        }

        if (!sourcePlanets || sourcePlanets.length === 0) {
            // read from planets.json (human-friendly file in repo)
            const pj = fs.readFileSync(path.join(__dirname, 'planets.json'), 'utf8');
            const parsed = JSON.parse(pj);
            // map names to keys used elsewhere (lowercase)
            sourcePlanets = parsed.map(p => ({ key: (p.name || '').toLowerCase(), name: p.name, distance: p.distance || p.distanceFromSun || null, orbitPeriod: p.orbitPeriod || null }));
        }

        // orbital periods in days for common planets (fallback mapping)
        const orbitalPeriods = {
            mercury: 87.969,
            venus: 224.701,
            earth: 365.256,
            mars: 686.98,
            jupiter: 4332.589,
            saturn: 10759,
            uranus: 30688.5,
            neptune: 60182,
            sun: null
        };

        // compute days since J2000
        const now = new Date();
        const daysSinceJ2000 = (now.getTime() - J2000) / (1000 * 60 * 60 * 24);

        // Try to use astronomy-engine if available for improved accuracy (best-effort)
        let Astronomy = null;
        try {
            Astronomy = require('astronomy-engine');
        } catch (err) {
            Astronomy = null;
        }

        const results = [];

        for (const p of sourcePlanets) {
            const key = (p.key || p.name || '').toString().toLowerCase();
            const dist = (p.distance || p.distanceFromSun || p.distanceFromSunKm || 0);

            if (Astronomy && Astronomy.Body) {
                // If astronomy-engine is available, try to compute heliocentric ecliptic coordinates
                try {
                    // astronomy-engine API: Astronomy.Ecliptic? We'll use a conservative call pattern
                    // Note: this block is best-effort and won't throw if API differs; fallback below will handle it.
                    const body = Astronomy.Body[key.toUpperCase()] || Astronomy.Body[key];
                    // If we have a body mapping, compute geocentric/heliocentric position
                    if (body) {
                        const date = new Date();
                        const pos = Astronomy.Position(body, date); // best-effort call
                        // pos will vary by library version; attempt to normalize
                        if (pos && pos.range !== undefined && pos.ra !== undefined) {
                            // convert spherical (range, ra, dec) to cartesian in equatorial coordinates
                            const r = pos.range;
                            const ra = pos.ra * (Math.PI / 180);
                            const dec = (pos.dec || 0) * (Math.PI / 180);
                            const x = r * Math.cos(dec) * Math.cos(ra);
                            const y = r * Math.cos(dec) * Math.sin(ra);
                            const z = r * Math.sin(dec);
                            results.push({ key, x, y, z, source: 'astronomy-engine' });
                            continue;
                        }
                    }
                } catch (e) {
                    // ignore and fall back
                }
            }

            // Fallback: use circular-orbit mean-anomaly projection
            const periodDays = orbitalPeriods[key] || (typeof p.orbitPeriod === 'string' ? parseFloat(p.orbitPeriod) : null) || null;
            let angle = 0;
            if (periodDays && !isNaN(periodDays) && periodDays > 0) {
                const frac = (daysSinceJ2000 % periodDays) / periodDays;
                angle = frac * Math.PI * 2;
            } else {
                // default behavior: static angle 0 (e.g., Sun)
                angle = 0;
            }

            // Interpret distance: if it's a string like '149.6 million km', try to parse numeric millions
            let distanceVal = 0;
            if (typeof dist === 'number') distanceVal = dist;
            else if (typeof dist === 'string') {
                const m = dist.match(/([0-9\.]+)\s*(million|billion)?/i);
                if (m) {
                    const num = parseFloat(m[1]);
                    const scale = (m[2] || '').toLowerCase().includes('billion') ? 1e9 : (m[2] || '').toLowerCase().includes('million') ? 1e6 : 1;
                    // use kilometers as units; scale to an approximate 'scene' distance by dividing
                    distanceVal = (num * scale) / 1e6; // convert km to 'scene units' roughly
                } else {
                    // If the planet document has a 'distance' numeric (scene units) prefer that
                    const maybeNum = parseFloat(dist);
                    if (!isNaN(maybeNum)) distanceVal = maybeNum;
                }
            }

            // If we have no distance numeric, fallback to a default mapping (scene units)
            const defaultDistances = { sun: 0, mercury: 50, venus: 70, earth: 95, mars: 120, jupiter: 180, saturn: 220, uranus: 280, neptune: 320 };
            const sceneDist = (typeof distanceVal === 'number' && distanceVal > 0) ? distanceVal : (defaultDistances[key] || 100);

            // projected cartesian coordinates (y=0 for ecliptic plane)
            const x = sceneDist * Math.cos(angle);
            const y = 0;
            const z = sceneDist * Math.sin(angle);

            results.push({ key, angle, position: { x, y, z }, source: 'fallback' });
        }

        res.json({ generatedAt: new Date().toISOString(), results });
    } catch (err) {
        console.error('Ephemeris error:', err);
        res.status(500).json({ error: 'Failed to compute ephemeris' });
    }
});

app.get('/api/planets/:key/quiz', async (req, res) => {
    try {
        const planetKey = req.params.key;
        const planet = await Planet.findOne({ key: planetKey });

        if (!planet) {
            return res.status(404).json({ error: 'Planet not found' });
        }

        // Check if Gemini API key exists
        if (process.env.GEMINI_API_KEY) {
            try {
                const prompt = `Generate a JSON array of exactly 5 multiple choice trivia questions about the planet ${planet.name}. 
The questions should be interesting, accurate, and completely random/different every time this prompt is called.
Return ONLY valid JSON in the exact format shown below, with no markdown formatting or backticks.
Format:
[
  {
    "question": "Question text here?",
    "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
    "correctAnswer": 0 // The zero-based index of the correct option
  }
]`;
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: prompt,
                });

                let text = response.text;
                // Clean up any potential markdown formatting from the response
                if (text.startsWith('\`\`\`json')) {
                    text = text.replace(/^\`\`\`json/, '').replace(/\`\`\`$/, '').trim();
                } else if (text.startsWith('\`\`\`')) {
                    text = text.replace(/^\`\`\`/, '').replace(/\`\`\`$/, '').trim();
                }

                const generatedQuestions = JSON.parse(text);

                if (Array.isArray(generatedQuestions) && generatedQuestions.length > 0) {
                    return res.json({ questions: generatedQuestions });
                }
            } catch (aiError) {
                console.error("Gemini AI Quiz Generation failed, falling back to database questions:", aiError);
                // Fall down to DB response
            }
        }

        // Fallback to static DB questions if AI fails or no API key is provided
        if (planet.quizQuestions && planet.quizQuestions.length > 0) {
            // Shuffle the available questions and pick up to 5
            const shuffled = planet.quizQuestions.sort(() => 0.5 - Math.random());
            const selectedQuestions = shuffled.slice(0, 5);
            return res.json({ questions: selectedQuestions });
        } else {
            return res.json({ questions: [] });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch quiz questions' });
    }
});

// Enhanced Planet Data with Quiz Questions
const insertEnhancedPlanetData = async () => {
    await Planet.deleteMany({});

    const enhancedPlanets = [
        {
            key: "sun",
            name: "Sun",
            radius: 30,
            textureUrl: '/images/GSFC_20171208_Archive_e001435~orig.jpg',
            markerUrl: null, // Sun doesn't have a marker
            rotationSpeed: 0.0005,
            info: `<p>The Sun is the star at the center of the Solar System.</p><div class="info-item"><span>Type:</span> <span>G-type main-sequence star</span></div><div class="info-item"><span>Diameter:</span> <span>1.39 million km</span></div><div class="info-item"><span>Temperature:</span> <span>5,778 K (surface)</span></div>`,
            facts: [
                "The Sun contains 99.86% of the Solar System's mass",
                "It takes 8 minutes for sunlight to reach Earth",
                "The Sun's core temperature is about 15 million°C"
            ],
            quizQuestions: [
                {
                    question: "What type of star is the Sun?",
                    options: ["Red giant", "G-type main-sequence", "White dwarf", "Neutron star"],
                    correctAnswer: 1
                },
                {
                    question: "How long does it take for sunlight to reach Earth?",
                    options: ["4 minutes", "8 minutes", "12 minutes", "16 minutes"],
                    correctAnswer: 1
                },
                {
                    question: "What percentage of the Solar System's mass does the Sun contain?",
                    options: ["85.5%", "92.3%", "99.86%", "100%"],
                    correctAnswer: 2
                },
                {
                    question: "What is the Sun's core temperature approximately?",
                    options: ["5 million°C", "10 million°C", "15 million°C", "25 million°C"],
                    correctAnswer: 2
                },
                {
                    question: "What process powers the Sun?",
                    options: ["Nuclear fission", "Nuclear fusion", "Chemical burning", "Gravitational collapse"],
                    correctAnswer: 1
                },
                {
                    question: "How old is the Sun approximately?",
                    options: ["2.6 billion years", "4.6 billion years", "8.2 billion years", "13.8 billion years"],
                    correctAnswer: 1
                }
            ]
        },
        {
            key: "mercury",
            name: "Mercury",
            radius: 2.5,
            distance: 50,
            speed: 0.004,
            rotationSpeed: 0.0008,
            textureUrl: '/public/textures/mercury.jpg',
            markerUrl: '/public/markers/mercury.pat',
            info: `<p>Mercury is the smallest planet in our solar system.</p><div class="info-item"><span>Day Length:</span> <span>59 Earth days</span></div><div class="info-item"><span>Year Length:</span> <span>88 Earth days</span></div><div class="info-item"><span>Temperature:</span> <span>-173°C to 427°C</span></div>`,
            facts: [
                "Mercury has no atmosphere to retain heat",
                "It's the fastest orbiting planet",
                "Mercury has extreme temperature variations"
            ],
            quizQuestions: [
                {
                    question: "How long is a day on Mercury?",
                    options: ["24 hours", "59 Earth days", "88 Earth days", "365 Earth days"],
                    correctAnswer: 1
                },
                {
                    question: "What is Mercury's position from the Sun?",
                    options: ["First", "Second", "Third", "Fourth"],
                    correctAnswer: 0
                },
                {
                    question: "How long is Mercury's orbital period (year)?",
                    options: ["59 days", "88 days", "225 days", "365 days"],
                    correctAnswer: 1
                },
                {
                    question: "Why does Mercury have extreme temperature variations?",
                    options: ["It's very small", "No atmosphere", "Far from Sun", "Slow rotation"],
                    correctAnswer: 1
                },
                {
                    question: "What is Mercury's surface mostly covered with?",
                    options: ["Ice", "Lava", "Craters", "Sand"],
                    correctAnswer: 2
                },
                {
                    question: "How many moons does Mercury have?",
                    options: ["0", "1", "2", "4"],
                    correctAnswer: 0
                }
            ]
        },
        {
            key: "venus",
            name: "Venus",
            radius: 4.5,
            distance: 70,
            speed: 0.002,
            rotationSpeed: 0.0006,
            textureUrl: '/public/textures/venus.jpg',
            markerUrl: '/public/markers/venus.pat',
            info: `<p>Venus is the second planet from the Sun.</p><div class="info-item"><span>Day Length:</span> <span>243 Earth days</span></div><div class="info-item"><span>Year Length:</span> <span>225 Earth days</span></div><div class="info-item"><span>Temperature:</span> <span>462°C (surface)</span></div>`,
            facts: [
                "Venus rotates backwards compared to most planets",
                "It's the hottest planet in our solar system",
                "Venus has a thick, toxic atmosphere"
            ],
            quizQuestions: [
                {
                    question: "Why is Venus the hottest planet?",
                    options: ["It's closest to the Sun", "Greenhouse effect", "Nuclear reactions", "Solar flares"],
                    correctAnswer: 1
                },
                {
                    question: "How does Venus rotate compared to Earth?",
                    options: ["Same direction", "Backwards", "Sideways", "It doesn't rotate"],
                    correctAnswer: 1
                },
                {
                    question: "What is Venus's surface temperature?",
                    options: ["200°C", "350°C", "462°C", "600°C"],
                    correctAnswer: 2
                },
                {
                    question: "What is the main component of Venus's atmosphere?",
                    options: ["Oxygen", "Nitrogen", "Carbon dioxide", "Methane"],
                    correctAnswer: 2
                },
                {
                    question: "How long is a day on Venus compared to its year?",
                    options: ["Day is shorter", "Day is longer", "They're equal", "Venus has no day"],
                    correctAnswer: 1
                },
                {
                    question: "What nickname is Venus often given?",
                    options: ["Red Planet", "Morning/Evening Star", "Ice Giant", "Ring World"],
                    correctAnswer: 1
                }
            ]
        },
        {
            key: "earth",
            name: "Earth",
            radius: 5,
            distance: 95,
            speed: 0.001,
            rotationSpeed: 0.01,
            textureUrl: '/public/textures/earth.jpg',
            markerUrl: '/public/markers/earth.pat',
            info: `<p>Our home planet, Earth is the only place we know of so far that's inhabited by living things.</p><div class="info-item"><span>Day Length:</span> <span>24 hours</span></div><div class="info-item"><span>Year Length:</span> <span>365.25 days</span></div><div class="info-item"><span>Atmosphere:</span> <span>78% Nitrogen, 21% Oxygen</span></div>`,
            facts: [
                "Earth is the only known planet with life",
                "71% of Earth's surface is covered by water",
                "Earth has one natural satellite: the Moon"
            ],
            quizQuestions: [
                {
                    question: "What percentage of Earth's surface is covered by water?",
                    options: ["50%", "65%", "71%", "85%"],
                    correctAnswer: 2
                },
                {
                    question: "What is the main component of Earth's atmosphere?",
                    options: ["Oxygen", "Nitrogen", "Carbon dioxide", "Argon"],
                    correctAnswer: 1
                },
                {
                    question: "How many natural satellites does Earth have?",
                    options: ["0", "1", "2", "3"],
                    correctAnswer: 1
                },
                {
                    question: "What is Earth's distance from the Sun?",
                    options: ["93 million miles", "150 million km", "Both A and B", "200 million km"],
                    correctAnswer: 2
                },
                {
                    question: "What protects Earth from harmful solar radiation?",
                    options: ["Atmosphere", "Magnetic field", "Ozone layer", "All of the above"],
                    correctAnswer: 3
                },
                {
                    question: "How old is Earth approximately?",
                    options: ["2.5 billion years", "4.5 billion years", "6.5 billion years", "10 billion years"],
                    correctAnswer: 1
                }
            ]
        },
        {
            key: "mars",
            name: "Mars",
            radius: 3.5,
            distance: 120,
            speed: 0.0008,
            rotationSpeed: 0.009,
            textureUrl: '/public/textures/mars.jpg',
            markerUrl: '/public/markers/mars.pat',
            info: `<p>Mars is the fourth planet from the Sun – a dusty, cold, desert world.</p><div class="info-item"><span>Day Length:</span> <span>24.6 hours</span></div><div class="info-item"><span>Year Length:</span> <span>687 Earth days</span></div><div class="info-item"><span>Moons:</span> <span>2 (Phobos and Deimos)</span></div>`,
            facts: [
                "Mars is known as the Red Planet",
                "It has the largest volcano in the solar system",
                "Mars has polar ice caps made of water and carbon dioxide"
            ],
            quizQuestions: [
                {
                    question: "Why is Mars called the Red Planet?",
                    options: ["Red atmosphere", "Iron oxide on surface", "Red rocks", "Solar radiation"],
                    correctAnswer: 1
                },
                {
                    question: "How many moons does Mars have?",
                    options: ["0", "1", "2", "4"],
                    correctAnswer: 2
                },
                {
                    question: "What are the names of Mars's moons?",
                    options: ["Titan and Europa", "Phobos and Deimos", "Io and Ganymede", "Luna and Selene"],
                    correctAnswer: 1
                },
                {
                    question: "What is the largest volcano in the solar system located on Mars?",
                    options: ["Mount Vesuvius", "Olympus Mons", "Mauna Kea", "Mount Everest"],
                    correctAnswer: 1
                },
                {
                    question: "How long is a Martian day (sol)?",
                    options: ["24 hours", "24.6 hours", "25.2 hours", "26 hours"],
                    correctAnswer: 1
                },
                {
                    question: "What evidence suggests Mars once had liquid water?",
                    options: ["Current rivers", "Dried riverbeds and valleys", "Active geysers", "Floating ice"],
                    correctAnswer: 1
                }
            ]
        },
        {
            key: "jupiter",
            name: "Jupiter",
            radius: 12,
            distance: 180,
            speed: 0.0004,
            rotationSpeed: 0.02,
            textureUrl: '/public/textures/jupiter.jpg',
            markerUrl: '/public/markers/jupiter.pat',
            info: `<p>Jupiter is the largest planet in our solar system - a gas giant with a swirling atmosphere.</p><div class="info-item"><span>Day Length:</span> <span>9.9 hours</span></div><div class="info-item"><span>Year Length:</span> <span>12 Earth years</span></div><div class="info-item"><span>Moons:</span> <span>79+ known moons</span></div>`,
            facts: [
                "Jupiter is a gas giant with no solid surface",
                "It has a Great Red Spot - a storm larger than Earth",
                "Jupiter acts as a 'cosmic vacuum cleaner' protecting inner planets"
            ],
            quizQuestions: [
                {
                    question: "What is Jupiter's Great Red Spot?",
                    options: ["A mountain", "A storm", "A moon", "A volcano"],
                    correctAnswer: 1
                },
                {
                    question: "How many moons does Jupiter have?",
                    options: ["4", "16", "50+", "79+"],
                    correctAnswer: 3
                },
                {
                    question: "What are Jupiter's four largest moons called?",
                    options: ["Galilean moons", "Trojan moons", "Asteroid moons", "Ice moons"],
                    correctAnswer: 0
                },
                {
                    question: "What is Jupiter primarily composed of?",
                    options: ["Rock and metal", "Hydrogen and helium", "Ice and methane", "Carbon dioxide"],
                    correctAnswer: 1
                },
                {
                    question: "How long is Jupiter's day?",
                    options: ["9.9 hours", "24 hours", "15 hours", "30 hours"],
                    correctAnswer: 0
                },
                {
                    question: "What role does Jupiter play in our solar system?",
                    options: ["Heat source", "Cosmic vacuum cleaner", "Light reflector", "Magnetic generator"],
                    correctAnswer: 1
                }
            ]
        },
        {
            key: "saturn",
            name: "Saturn",
            radius: 10,
            distance: 220,
            speed: 0.0003,
            rotationSpeed: 0.018,
            textureUrl: '/public/textures/saturn.jpg',
            ringTextureUrl: '/public/textures/saturn-ring.png',
            markerUrl: '/public/markers/saturn.pat',
            info: `<p>Saturn is famous for its prominent ring system made of ice and rock particles.</p><div class="info-item"><span>Day Length:</span> <span>10.7 hours</span></div><div class="info-item"><span>Year Length:</span> <span>29 Earth years</span></div><div class="info-item"><span>Moons:</span> <span>82+ known moons</span></div>`,
            facts: [
                "Saturn has the most prominent ring system",
                "It's less dense than water - it would float!",
                "Saturn's moon Titan has lakes of liquid methane"
            ],
            quizQuestions: [
                {
                    question: "What makes Saturn unique among planets?",
                    options: ["It's the largest", "It has rings", "It's closest to Sun", "It has no moons"],
                    correctAnswer: 1
                },
                {
                    question: "What is Saturn's density compared to water?",
                    options: ["Much denser", "About the same", "Less dense", "Unknown"],
                    correctAnswer: 2
                },
                {
                    question: "What are Saturn's rings primarily made of?",
                    options: ["Gas and dust", "Ice and rock particles", "Metal debris", "Liquid methane"],
                    correctAnswer: 1
                },
                {
                    question: "Which of Saturn's moons has lakes of liquid methane?",
                    options: ["Enceladus", "Mimas", "Titan", "Iapetus"],
                    correctAnswer: 2
                },
                {
                    question: "How many main ring groups does Saturn have?",
                    options: ["3", "7", "12", "Countless"],
                    correctAnswer: 1
                },
                {
                    question: "What is Saturn's hexagonal feature?",
                    options: ["A moon shape", "A storm at north pole", "A ring pattern", "A surface crater"],
                    correctAnswer: 1
                }
            ]
        },
        {
            key: "uranus",
            name: "Uranus",
            radius: 6,
            distance: 280,
            speed: 0.0002,
            rotationSpeed: 0.015,
            textureUrl: '/public/textures/uranus.jpg',
            markerUrl: '/public/markers/uranus.pat',
            info: `<p>Uranus is an ice giant that rotates on its side, making it unique in our solar system.</p><div class="info-item"><span>Day Length:</span> <span>17.2 hours</span></div><div class="info-item"><span>Year Length:</span> <span>84 Earth years</span></div><div class="info-item"><span>Moons:</span> <span>27 known moons</span></div>`,
            facts: [
                "Uranus rotates on its side - like a rolling ball",
                "It's an ice giant with a blue-green color",
                "Uranus has faint rings that are hard to see"
            ],
            quizQuestions: [
                {
                    question: "How does Uranus rotate compared to other planets?",
                    options: ["Normal", "Backwards", "On its side", "It doesn't rotate"],
                    correctAnswer: 2
                },
                {
                    question: "What type of planet is Uranus?",
                    options: ["Terrestrial", "Gas giant", "Ice giant", "Dwarf planet"],
                    correctAnswer: 2
                },
                {
                    question: "What gives Uranus its blue-green color?",
                    options: ["Oxygen", "Methane", "Nitrogen", "Hydrogen"],
                    correctAnswer: 1
                },
                {
                    question: "Who discovered Uranus?",
                    options: ["Galileo", "Newton", "William Herschel", "Kepler"],
                    correctAnswer: 2
                },
                {
                    question: "How many rings does Uranus have?",
                    options: ["0", "13", "27", "Thousands"],
                    correctAnswer: 1
                },
                {
                    question: "What is unusual about Uranus's magnetic field?",
                    options: ["It's very weak", "It's tilted 60 degrees", "It doesn't exist", "It changes direction"],
                    correctAnswer: 1
                }
            ]
        },
        {
            key: "neptune",
            name: "Neptune",
            radius: 6,
            distance: 320,
            speed: 0.0001,
            rotationSpeed: 0.016,
            textureUrl: '/public/textures/neptune.jpg',
            markerUrl: '/public/markers/neptune.pat',
            info: `<p>Neptune is the most distant planet and the windiest world in our solar system.</p><div class="info-item"><span>Day Length:</span> <span>16.1 hours</span></div><div class="info-item"><span>Year Length:</span> <span>165 Earth years</span></div><div class="info-item"><span>Moons:</span> <span>14 known moons</span></div>`,
            facts: [
                "Neptune has the strongest winds in the solar system",
                "It's the most distant planet from the Sun",
                "Neptune was the first planet discovered through mathematical prediction"
            ],
            quizQuestions: [
                {
                    question: "What is Neptune known for?",
                    options: ["Being the largest", "Having the strongest winds", "Being closest to Sun", "Having no moons"],
                    correctAnswer: 1
                },
                {
                    question: "How was Neptune discovered?",
                    options: ["By accident", "Through mathematical prediction", "Ancient observation", "Space probe"],
                    correctAnswer: 1
                },
                {
                    question: "What is the speed of Neptune's winds?",
                    options: ["500 km/h", "1,200 km/h", "2,100 km/h", "3,000 km/h"],
                    correctAnswer: 2
                },
                {
                    question: "What is Neptune's largest moon?",
                    options: ["Nereid", "Proteus", "Triton", "Larissa"],
                    correctAnswer: 2
                },
                {
                    question: "What is unusual about Neptune's moon Triton?",
                    options: ["It's the largest moon", "It orbits backwards", "It has rings", "It's made of ice"],
                    correctAnswer: 1
                },
                {
                    question: "How long does it take Neptune to orbit the Sun?",
                    options: ["84 years", "165 years", "248 years", "300 years"],
                    correctAnswer: 1
                }
            ]
        }
    ];

    await Planet.insertMany(enhancedPlanets);
    console.log('Enhanced planet data with textures and markers inserted!');
};

// Enhanced planet data insertion is performed only after a successful DB connection
// (see connection logic earlier). No unconditional insertion here.

// Export the app for Vercel, and for supertest.
module.exports = app;

// Only bind a port when this file is the process entry point. Required directly
// (by a test, or by another module) it must stay inert: before this guard,
// `require('./app-enhanced')` connected to Atlas and listened on a port as a
// side effect, which makes the app untestable and leaks a server per test run.
const IS_ENTRY_POINT = require.main === module;

// Under test the module must be completely inert on require: no port, no Atlas
// connection, and above all no insertEnhancedPlanetData() writing seed documents
// into whatever database the connection string happens to point at. Tests own
// their own database lifecycle.
const IS_TEST = process.env.NODE_ENV === 'test';

// Initialize database and start server only if not in Vercel environment
if (IS_TEST) {
    // Intentionally empty. See IS_TEST above.
} else if (IS_ENTRY_POINT && (process.env.NODE_ENV !== 'production' || !process.env.VERCEL)) {
    initializeDatabase().then(() => {
        // ... (remaining logic same as before, but wrapped)
        // Note: For brevity, I'm just showing the structural change
        const resolvePort = MUST_BIND_ASSIGNED_PORT
            ? Promise.resolve(PORT)
            : findAvailablePort(PORT);

        resolvePort.then(availablePort => {
            const server = app.listen(availablePort, () => {
                console.log(`🚀 Enhanced Spaceverse Server is running on http://localhost:${availablePort}`);
            });

            // On a managed host a bind failure must kill the process so the
            // platform reports a failed deploy, rather than leaving a live
            // container that answers nothing.
            server.on('error', (err) => {
                console.error('Server error:', err);
                if (MUST_BIND_ASSIGNED_PORT) process.exit(1);
            });

            process.on('SIGTERM', () => {
                server.close(() => process.exit(0));
            });

            process.on('SIGINT', () => {
                server.close(() => process.exit(0));
            });
        }).catch(err => {
            console.error('Failed to start server:', err);
            process.exit(1);
        });
    });
} else {
    // In Vercel, just initialize the database (Vercel will handle the app instance)
    initializeDatabase().catch(err => console.error('DB Init Error in Vercel:', err));
}


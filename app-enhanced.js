// Enhanced Spaceverse Application
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config();

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

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware (must be before routes that need it)
app.use(session({
    secret: 'spaceverse-secret-key-2024',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

app.use('/images', express.static('images'));
app.use('/galaxy', express.static('galaxy'));
app.use('/public', express.static('public'));
app.use('/models', express.static('models'));
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
let dbConnected = false;

async function initializeDatabase() {
    if (uri) {
        try {
            await mongoose.connect(uri);
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
            console.error('MongoDB connection error:', err);
            console.warn('Continuing without MongoDB - falling back to file-based planet data.');
        }
    } else {
        console.warn('MONGODB_URI environment variable is not set. Running in file-backed mode (no DB).');
    }
}

// User Schema for Login System
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    quizScores: [{ 
        score: Number, 
        totalQuestions: Number, 
        completedAt: { type: Date, default: Date.now } 
    }]
});

const User = mongoose.model('User', userSchema);

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
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        // Check if user already exists
        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create new user
        const user = new User({
            username,
            email,
            password: hashedPassword
        });
        
        await user.save();
        req.session.userId = user._id;
        req.session.username = user.username;
        
        res.json({ success: true, message: 'User registered successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Find user
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        
        // Check password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        
        req.session.userId = user._id;
        req.session.username = user.username;
        
        res.json({ success: true, message: 'Login successful', username: user.username });
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true, message: 'Logged out successfully' });
});

app.get('/api/user', (req, res) => {
    if (req.session.userId) {
        res.json({ loggedIn: true, username: req.session.username });
    } else {
        res.json({ loggedIn: false });
    }
});

// Quiz Routes
app.post('/api/quiz/submit', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Please login first' });
        }
        
        const { score, totalQuestions } = req.body;
        
        const user = await User.findById(req.session.userId);
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
        
        const user = await User.findById(req.session.userId);
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
        const planet = await Planet.findOne({ key: req.params.key });
        if (!planet) {
            return res.status(404).json({ error: 'Planet not found' });
        }
        res.json({ questions: planet.quizQuestions });
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

// Initialize database before starting server
initializeDatabase().then(() => {
    // API endpoints
    app.get('/api/planets', (req, res) => {
        if (dbConnected) {
            // If DB is connected, fetch from MongoDB
            Planet.find({}).then(planets => {
                res.json(planets);
            }).catch(err => {
                console.error('Error fetching planets from DB:', err);
                // Fallback to planets.json if DB query fails
                res.sendFile(path.join(__dirname, 'planets.json'));
            });
        } else {
            // If no DB connection, use planets.json
            res.sendFile(path.join(__dirname, 'planets.json'));
        }
    });
    // Route handlers
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'views', 'home.html'));
    });

    app.get('/solar-system', ensureAuthenticated, (req, res) => {
        res.sendFile(path.join(__dirname, 'views', 'solar-system.html'));
    });

    app.get('/quiz', ensureAuthenticated, (req, res) => {
        res.sendFile(path.join(__dirname, 'views', 'quiz.html'));
    });

    app.get('/about.html', (req, res) => {
        res.sendFile(path.join(__dirname, 'views', 'about.html'));
    });

    // Start the server with automatic port selection and error handling
    findAvailablePort(PORT).then(availablePort => {
        const server = app.listen(availablePort, () => {
            console.log(`🚀 Enhanced Spaceverse Server is running on http://localhost:${availablePort}`);
            console.log('📱 Features available:');
            console.log('   • Home page with authentication');
            console.log('   • 3D Solar System Explorer');
            console.log('   • Interactive Quiz Bot');
            console.log('   • User accounts and progress tracking\n');
            console.log('🌌 Open your browser and navigate to http://localhost:' + availablePort);
        });

        server.on('error', (err) => {
            console.error('Server error:', err);
        });

        // Handle graceful shutdown
        process.on('SIGTERM', () => {
            console.log('SIGTERM received. Shutting down gracefully...');
            server.close(() => {
                console.log('Server closed.');
                process.exit(0);
            });
        });

        process.on('SIGINT', () => {
            console.log('SIGINT received. Shutting down gracefully...');
            server.close(() => {
                console.log('Server closed.');
                process.exit(0);
            });
        });
    }).catch(err => {
        console.error('Failed to start server:', err);
        process.exit(1);
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Enhanced Spaceverse Server is running on http://localhost:${PORT}`);
    console.log(`📱 Features available:`);
    console.log(`   • Home page with authentication`);
    console.log(`   • 3D Solar System Explorer`);
    console.log(`   • Interactive Quiz Bot`);
    console.log(`   • User accounts and progress tracking`);
    console.log(`\n🌌 Open your browser and navigate to http://localhost:${PORT}`);
});
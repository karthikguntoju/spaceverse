const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const axios = require('axios');

// Import existing models (will be accessed dynamically to avoid initialization issues)
let User;
let Simulation;
let UserScore;
let ScenarioHistory;
let SharedScenario;

// Import advanced orbital mechanics module
const advancedOrbitalMechanics = require('./advanced-orbital-mechanics');

// Import NASA API integration module
const nasaApi = require('./nasa-api');

// Offline space-science corpus. Answers the chatbot whenever Gemini is
// unavailable (no key, quota, network) so the assistant is never dead weight.
const spaceKnowledge = require('../services/space-knowledge');

// Create new models for the simulator
const simulationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  scenarioName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  eventType: {
    type: String,
    required: true,
    enum: ['launch', 'adjustment', 'breakup']
  },
  parameters: {
    altitude: { type: Number, required: true, min: 100, max: 5000 }, // km
    inclination: { type: Number, required: true, min: 0, max: 180 }, // degrees
    velocity: { type: Number, required: true, min: 0, max: 15 }, // km/s
    mass: { type: Number, required: true, min: 1, max: 10000 }, // kg
    launchTime: { type: Date, required: true }
  },
  results: {
    beforeState: {
      objectsInLEO: { type: Number, default: 0 },
      objectsInMEO: { type: Number, default: 0 },
      objectsInGEO: { type: Number, default: 0 },
      averageCongestion: { type: Number, default: 0, min: 0, max: 1 },
      collisionProbability: { type: Number, default: 0, min: 0, max: 1 }
    },
    afterState: {
      objectsInLEO: { type: Number, default: 0 },
      objectsInMEO: { type: Number, default: 0 },
      objectsInGEO: { type: Number, default: 0 },
      averageCongestion: { type: Number, default: 0, min: 0, max: 1 },
      collisionProbability: { type: Number, default: 0, min: 0, max: 1 }
    },
    changes: {
      newObjects: { type: Number, default: 0 },
      congestionChange: { type: Number, default: 0 },
      riskChange: { type: Number, default: 0 }
    }
  },
  aiAnalysis: {
    predictionId: String,
    collisionRiskPercentage: { type: Number, min: 0, max: 100 },
    orbitalCongestionIncrease: { type: Number },
    secondaryDebrisProbability: { type: Number, min: 0, max: 100 },
    confidenceLevel: { type: Number, min: 0, max: 100 },
    explanation: String,
    recommendations: [String]
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// The progression schema moved out to models/user-score.js when game missions
// started writing to it too. It is no longer this feature's private record, and
// leaving it defined inside a router named "simulator" made it impossible to
// find. Behaviour is unchanged; see that file for the migration notes.
const { userScoreSchema, syncTotals } = require('../models/user-score');

const scenarioHistorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  simulationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Simulation',
    required: true
  },
  scenarioName: String,
  eventType: {
    type: String,
    enum: ['launch', 'adjustment', 'breakup']
  },
  parametersSnapshot: {
    altitude: Number,
    inclination: Number,
    velocity: Number,
    mass: Number,
    launchTime: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  riskLevel: {
    type: String,
    enum: ['low', 'medium', 'high']
  },
  congestionImpact: {
    type: String,
    enum: ['low', 'medium', 'high']
  }
});

// Schema for shared/community scenarios
const sharedScenarioSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  username: {
    type: String,
    required: true
  },
  scenarioName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    maxlength: 500
  },
  eventType: {
    type: String,
    required: true,
    enum: ['launch', 'adjustment', 'breakup']
  },
  parameters: {
    altitude: { type: Number, required: true, min: 100, max: 5000 }, // km
    inclination: { type: Number, required: true, min: 0, max: 180 }, // degrees
    velocity: { type: Number, required: true, min: 0, max: 15 }, // km/s
    mass: { type: Number, required: true, min: 1, max: 10000 }, // kg
    launchTime: { type: Date, required: true }
  },
  aiAnalysis: {
    collisionRiskPercentage: { type: Number, min: 0, max: 100 },
    orbitalCongestionIncrease: { type: Number },
    secondaryDebrisProbability: { type: Number, min: 0, max: 100 },
    confidenceLevel: { type: Number, min: 0, max: 100 },
    explanation: String,
    recommendations: [String]
  },
  likes: {
    type: Number,
    default: 0
  },
  likedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  comments: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    username: String,
    comment: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Create models
function initializeModels() {
  // Get existing models
  User = mongoose.model('User');

  // Create new models for the simulator
  Simulation = mongoose.model('Simulation', simulationSchema);
  UserScore = mongoose.model('UserScore', userScoreSchema);
  ScenarioHistory = mongoose.model('ScenarioHistory', scenarioHistorySchema);
  SharedScenario = mongoose.model('SharedScenario', sharedScenarioSchema);
}

// Middleware to ensure user is authenticated
function ensureAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.status(401).json({ success: false, message: 'Authentication required' });
}

// Helper function to classify orbit (enhanced)
function classifyOrbit(altitude) {
  if (altitude < 2000) return 'LEO'; // Low Earth Orbit
  if (altitude < 35786) return 'MEO'; // Medium Earth Orbit
  return 'GEO'; // Geostationary Orbit
}

// Helper function to calculate orbital density (enhanced with perturbations)
function calculateOrbitalDensity(altitude, inclination, realCounts) {
  // Use advanced orbital mechanics for more accurate density calculation
  const densityAnalysis = advancedOrbitalMechanics.calculatePerturbedOrbitalDensity(altitude, inclination, {
    startDate: new Date(),
    endDate: new Date(Date.now() + 86400000) // 24 hours from now
  }, realCounts); // pass real counts through

  return densityAnalysis.perturbedDensity;
}

// Helper function to calculate collision probability (enhanced)
function calculateCollisionProbability(density, velocity, mass) {
  // Simplified model - in a real implementation, this would use more complex
  // orbital mechanics and statistical models

  // Base probability increases with density
  let probability = density * 0.001;

  // Higher velocity increases collision energy and risk
  const velocityFactor = Math.min(velocity / 10, 2); // Cap at 2x

  // Larger mass increases damage potential
  const massFactor = Math.min(mass / 1000, 5); // Cap at 5x

  return probability * velocityFactor * massFactor;
}

// Helper function to update gamification scores
async function updateGamificationScores(userId, simulationResults) {
  try {
    // Find or create user score record
    let userScore = await UserScore.findOne({ userId });

    if (!userScore) {
      userScore = new UserScore({ userId });
    }

    // Update scores based on simulation results
    const { collisionRiskPercentage, orbitalCongestionIncrease } = simulationResults.aiAnalysis;

    // Safety score decreases with higher collision risk
    const safetyChange = Math.max(0, 10 - (collisionRiskPercentage / 10));

    // Sustainability score decreases with higher congestion
    const sustainabilityChange = Math.max(0, 8 - (orbitalCongestionIncrease / 5));

    // Efficiency score is based on optimal parameters
    const efficiencyChange = 5; // Simplified - in reality would evaluate parameter optimization

    // Update scores
    userScore.scores.safetyScore = Math.min(100, Math.max(0, userScore.scores.safetyScore + safetyChange));
    userScore.scores.sustainabilityScore = Math.min(100, Math.max(0, userScore.scores.sustainabilityScore + sustainabilityChange));
    userScore.scores.efficiencyScore = Math.min(100, Math.max(0, userScore.scores.efficiencyScore + efficiencyChange));

    // Level and totalScore are derived, not assigned here. syncTotals owns that
    // rule now so the simulator and the game missions cannot drift apart on what
    // a rank means. Its first three thresholds reproduce the average-based rule
    // this function used to apply inline.
    userScore.totalSimulations += 1;
    syncTotals(userScore);

    // Check for new badges
    const newBadges = [];

    // First simulation badge
    if (userScore.totalSimulations === 1) {
      newBadges.push({
        id: 'first_simulation',
        name: 'First Simulation',
        earnedAt: new Date()
      });
    }

    // Low risk expert badge
    if (collisionRiskPercentage < 20) {
      const hasBadge = userScore.badges.some(badge => badge.id === 'low_risk_expert');
      if (!hasBadge) {
        newBadges.push({
          id: 'low_risk_expert',
          name: 'Low Risk Expert',
          earnedAt: new Date()
        });
      }
    }

    // Add new badges
    userScore.badges.push(...newBadges);

    // Save updated scores
    await userScore.save();

    return {
      scores: userScore.scores,
      level: userScore.level,
      newBadges: newBadges
    };
  } catch (error) {
    console.error('Error updating gamification scores:', error);
    // Return default values if update fails
    return {
      scores: { safetyScore: 0, sustainabilityScore: 0, efficiencyScore: 0 },
      level: 'Safe Launcher',
      newBadges: []
    };
  }
}

// POST /api/simulator/run - Run a space traffic simulation
router.post('/run', ensureAuthenticated, async (req, res) => {
  try {
    const { scenarioName, eventType, parameters } = req.body;

    // Validate input
    if (!scenarioName || !eventType || !parameters) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: scenarioName, eventType, or parameters'
      });
    }

    // Validate event type
    if (!['launch', 'adjustment', 'breakup'].includes(eventType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid event type. Must be launch, adjustment, or breakup'
      });
    }

    // Validate parameters
    const { altitude, inclination, velocity, mass, launchTime } = parameters;

    if (altitude < 100 || altitude > 5000) {
      return res.status(400).json({
        success: false,
        message: 'Altitude must be between 100 and 5000 km'
      });
    }

    if (inclination < 0 || inclination > 180) {
      return res.status(400).json({
        success: false,
        message: 'Inclination must be between 0 and 180 degrees'
      });
    }

    if (velocity < 0 || velocity > 15) {
      return res.status(400).json({
        success: false,
        message: 'Velocity must be between 0 and 15 km/s'
      });
    }

    if (mass < 1 || mass > 10000) {
      return res.status(400).json({
        success: false,
        message: 'Mass must be between 1 and 10000 kg'
      });
    }

    // Validate date
    const launchDate = new Date(launchTime);
    if (isNaN(launchDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid launch time format'
      });
    }

    // Run simulation with enhanced orbital mechanics
    const orbitType = classifyOrbit(altitude);

    // Fetch real satellite counts from CelesTrak (graceful fallback built in)
    let realCounts = null;
    try {
      realCounts = await nasaApi.getCelesTrakCounts();
      console.log(`CelesTrak counts (${realCounts.source}): LEO=${realCounts.leoCount}, MEO=${realCounts.meoCount}, GEO=${realCounts.geoCount}`);
    } catch (celestrakErr) {
      console.warn('Could not fetch CelesTrak counts, using hardcoded density:', celestrakErr.message);
    }

    let density = calculateOrbitalDensity(altitude, inclination, realCounts);
    density = Math.max(0, density); // guard against tiny negative floats from orbital perturbations

    // Try to enhance simulation with real-time NASA data
    try {
      // Get space weather data to adjust orbital mechanics
      const spaceWeatherData = await nasaApi.getSpaceWeatherData();

      // Apply space weather effects to density calculations
      // This is a simplified example - in reality, this would be more complex
      if (spaceWeatherData && Array.isArray(spaceWeatherData) && spaceWeatherData.length > 0) {
        const latestStorm = spaceWeatherData[spaceWeatherData.length - 1];
        if (latestStorm && latestStorm.allKpIndex && Array.isArray(latestStorm.allKpIndex) && latestStorm.allKpIndex.length > 0) {
          const kpIndex = latestStorm.allKpIndex[latestStorm.allKpIndex.length - 1].kpIndex;
          // Adjust density based on geomagnetic activity
          density *= (1 + kpIndex / 100);
        }
      }
    } catch (nasaError) {
      console.warn('Could not fetch NASA space weather data:', nasaError.message);
      // Continue with base density calculation if NASA data unavailable
    }

    // Calculate before state (current conditions)
    // Use real satellite counts from CelesTrak when available
    const leoBaseline = (realCounts && realCounts.leoCount > 0) ? realCounts.leoCount : Math.floor(3000 + density * 1000);
    const meoBaseline = (realCounts && realCounts.meoCount > 0) ? realCounts.meoCount : Math.floor(500 + density * 500);
    const geoBaseline = (realCounts && realCounts.geoCount > 0) ? realCounts.geoCount : Math.floor(2000 + density * 300);

    const beforeState = {
      objectsInLEO: orbitType === 'LEO' ? leoBaseline : Math.floor(leoBaseline * 0.9),
      objectsInMEO: orbitType === 'MEO' ? meoBaseline : Math.floor(meoBaseline * 0.9),
      objectsInGEO: orbitType === 'GEO' ? geoBaseline : Math.floor(geoBaseline * 0.9),
      averageCongestion: density,
      collisionProbability: calculateCollisionProbability(density, velocity, mass)
    };

    // Calculate after state (with new object)
    let afterState = { ...beforeState };

    if (eventType === 'launch') {
      // Add new object
      if (orbitType === 'LEO') afterState.objectsInLEO += 1;
      else if (orbitType === 'MEO') afterState.objectsInMEO += 1;
      else afterState.objectsInGEO += 1;

      // Slightly increase congestion
      afterState.averageCongestion = density * 1.01;
      afterState.collisionProbability = calculateCollisionProbability(afterState.averageCongestion, velocity, mass);
    } else if (eventType === 'breakup') {
      // Add multiple objects (debris) with advanced orbital mechanics
      const debrisCount = Math.floor(mass / 100); // Simplified model

      // Try to enhance breakup simulation with NASA asteroid data
      let asteroidInfluence = 1.0;
      try {
        const asteroidData = await nasaApi.getAsteroidData();

        // Check if there are any near-Earth asteroids that might influence debris patterns
        if (asteroidData && asteroidData.near_earth_objects) {
          const today = new Date().toISOString().split('T')[0];
          const todaysAsteroids = asteroidData.near_earth_objects[today] || [];

          // If there are asteroids, slightly increase debris spread
          if (todaysAsteroids.length > 0) {
            asteroidInfluence = 1.0 + (todaysAsteroids.length * 0.05);
          }
        }
      } catch (asteroidError) {
        console.warn('Could not fetch NASA asteroid data:', asteroidError.message);
      }

      // Use advanced orbital mechanics to simulate debris dispersion
      const debrisDistribution = advancedOrbitalMechanics.propagateOrbitWithPerturbations(
        {
          position: [altitude * 1000, 0, 0], // Simplified initial position
          velocity: [0, velocity * 1000, 0]  // Simplified initial velocity
        },
        60, // 60 second time step
        86400, // 24 hour propagation
        {
          mass: mass / debrisCount,
          dragCoefficient: 2.2,
          crossSectionalArea: 0.1
        }
      );

      // Distribute debris across orbital regimes based on propagation results
      const leoDebris = Math.floor(debrisCount * 0.7 * asteroidInfluence); // 70% in LEO, adjusted by asteroid influence
      const meoDebris = Math.floor(debrisCount * 0.2 * asteroidInfluence); // 20% in MEO, adjusted by asteroid influence
      const geoDebris = Math.floor((debrisCount - leoDebris - meoDebris) * asteroidInfluence); // Remaining in GEO, adjusted by asteroid influence

      if (orbitType === 'LEO') afterState.objectsInLEO += leoDebris;
      else if (orbitType === 'MEO') afterState.objectsInMEO += meoDebris;
      else afterState.objectsInGEO += geoDebris;

      // Significantly increase congestion
      afterState.averageCongestion = density * 1.1;
      afterState.collisionProbability = calculateCollisionProbability(afterState.averageCongestion, velocity, mass) * 2;
    }
    // For adjustment, we don't add objects but might change collision probability

    // Calculate changes
    const changes = {
      newObjects: afterState.objectsInLEO + afterState.objectsInMEO + afterState.objectsInGEO -
        (beforeState.objectsInLEO + beforeState.objectsInMEO + beforeState.objectsInGEO),
      congestionChange: afterState.averageCongestion - beforeState.averageCongestion,
      riskChange: afterState.collisionProbability - beforeState.collisionProbability
    };

    // Create simulation record
    const simulation = new Simulation({
      userId: req.session.userId,
      scenarioName,
      eventType,
      parameters: {
        altitude,
        inclination,
        velocity,
        mass,
        launchTime: launchDate
      },
      results: {
        beforeState,
        afterState,
        changes
      }
    });

    // Save simulation
    await simulation.save();

    // Create scenario history record
    const scenarioHistory = new ScenarioHistory({
      userId: req.session.userId,
      simulationId: simulation._id,
      scenarioName,
      eventType,
      parametersSnapshot: {
        altitude,
        inclination,
        velocity,
        mass,
        launchTime: launchDate
      },
      riskLevel: afterState.collisionProbability > 0.01 ? 'high' :
        afterState.collisionProbability > 0.005 ? 'medium' : 'low',
      congestionImpact: changes.congestionChange > 0.1 ? 'high' :
        changes.congestionChange > 0.05 ? 'medium' : 'low'
    });

    await scenarioHistory.save();

    // Call AI service for analysis
    let aiAnalysis = {
      collisionRiskPercentage: 0,
      orbitalCongestionIncrease: 0,
      secondaryDebrisProbability: 0,
      confidenceLevel: 0,
      explanation: 'AI analysis pending',
      recommendations: []
    };

    try {
      // Generate AI analysis locally instead of calling external service
      // This ensures the simulator works even when AI service is unavailable

      // Calculate collision risk percentage based on simulation parameters
      const collisionRiskPercentage = calculateLocalCollisionRisk(beforeState, afterState, parameters);

      // Calculate orbital congestion increase
      const orbitalCongestionIncrease = calculateLocalCongestionChange(beforeState, afterState, eventType);

      // Calculate secondary debris probability based on event type and mass
      const secondaryDebrisProbability = eventType === 'breakup' ?
        Math.min(95, (parameters.mass / 1000) * 25) :
        Math.min(10, (parameters.mass / 1000) * 2);

      // Generate explanation based on parameters
      const explanation = generateLocalExplanation(eventType, parameters, collisionRiskPercentage, orbitalCongestionIncrease, secondaryDebrisProbability);

      // Generate recommendations based on risk factors
      const recommendations = generateLocalRecommendations(eventType, parameters, collisionRiskPercentage, orbitalCongestionIncrease);

      aiAnalysis = {
        predictionId: simulation._id.toString(),
        collisionRiskPercentage: collisionRiskPercentage,
        orbitalCongestionIncrease: orbitalCongestionIncrease,
        secondaryDebrisProbability: secondaryDebrisProbability,
        confidenceLevel: 85, // High confidence for local calculations
        explanation: explanation,
        recommendations: recommendations
      };
    } catch (localAiError) {
      console.error('Local AI analysis error:', localAiError.message);
      // Fallback to default AI analysis
      aiAnalysis = {
        collisionRiskPercentage: 25,
        orbitalCongestionIncrease: 5,
        secondaryDebrisProbability: 10,
        confidenceLevel: 50,
        explanation: 'Local analysis of space traffic impact.',
        recommendations: ['Monitor orbital environment regularly', 'Follow space situational awareness protocols']
      };
    }

    // Update simulation with AI analysis
    simulation.aiAnalysis = aiAnalysis;
    await simulation.save();

    // Update gamification scores
    const gamification = await updateGamificationScores(req.session.userId, { aiAnalysis });

    // Return success response
    res.json({
      success: true,
      simulationId: simulation._id,
      scenarioName,
      results: {
        beforeState,
        afterState,
        changes
      },
      aiAnalysis,
      gamification
    });

  } catch (error) {
    console.error('Simulation error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while running the simulation'
    });
  }
});

// GET /api/simulator/leaderboard - Get leaderboard
router.get('/leaderboard', ensureAuthenticated, async (req, res) => {
  try {
    // Top 10 by stored totalScore. This used to $add the three axes inside an
    // aggregate and sort on the computed field, which no index can serve, so
    // ranking anyone read the whole collection. totalScore is now maintained on
    // write and indexed descending, making this an index scan of 10 documents.
    const leaderboard = await UserScore.find({}, 'userId scores level totalScore')
      .sort({ totalScore: -1 })
      .limit(10)
      .lean();

    // Populate user information
    const userIds = leaderboard.map(entry => entry.userId);
    const users = await User.find({ _id: { $in: userIds } }, 'username');

    // Create user map for quick lookup
    const userMap = {};
    users.forEach(user => {
      userMap[user._id.toString()] = user.username;
    });

    // Format leaderboard data
    // Documents written before totalScore was stored have no such field. Fall
    // back to deriving it so the board reads correctly on a database that has
    // not had scripts/migrate-user-scores.js run against it yet. Those rows sort
    // as 0 until the migration runs, but they never render as blank.
    const derivedTotal = (entry) => {
      if (typeof entry.totalScore === 'number') return entry.totalScore;
      const s = entry.scores || {};
      return (s.safetyScore || 0) + (s.sustainabilityScore || 0) + (s.efficiencyScore || 0);
    };
    // Round to one decimal so the board shows "18.8", not "18.762192526039506".
    const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

    const formattedLeaderboard = leaderboard
      // A score row whose User document is gone (deleted account, wiped dev DB)
      // has nothing to show and was rendering as "Unknown User"; drop it.
      .filter((entry) => userMap[entry.userId.toString()])
      .map((entry, index) => ({
        rank: index + 1,
        username: userMap[entry.userId.toString()],
        totalScore: round1(derivedTotal(entry)),
        level: entry.level
      }));

    // Get current user's rank
    const currentUserScore = await UserScore.findOne({ userId: req.session.userId });
    let currentUserRank = null;

    if (currentUserScore) {
      // Second full scan removed for the same reason: a $expr/$add comparison
      // cannot use an index, so finding one player's rank read every document.
      // A plain range count on the indexed field does the same job.
      const higherScoresCount = await UserScore.countDocuments({
        totalScore: { $gt: currentUserScore.totalScore || 0 }
      });

      currentUserRank = higherScoresCount + 1;
    }

    res.json({
      success: true,
      leaderboard: formattedLeaderboard,
      currentUser: {
        rank: currentUserRank,
        username: req.session.username,
        // Read the stored total rather than re-deriving it from the three axes.
        // Re-deriving here would omit missionXp, so a player's own total would
        // disagree with their own row in the leaderboard above — in the same
        // response.
        totalScore: round1(currentUserScore ? currentUserScore.totalScore : 0),
        level: currentUserScore ? currentUserScore.level : 'Safe Launcher'
      }
    });

  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching leaderboard'
    });
  }
});

// GET /api/simulator/:simulationId - Get a specific simulation (only match valid 24-hex ObjectId)
router.get('/:simulationId([0-9a-fA-F]{24})', ensureAuthenticated, async (req, res) => {
  try {
    const simulation = await Simulation.findOne({
      _id: req.params.simulationId,
      userId: req.session.userId
    }).lean();

    if (!simulation) {
      return res.status(404).json({
        success: false,
        message: 'Simulation not found'
      });
    }

    res.json({
      success: true,
      simulation
    });

  } catch (error) {
    console.error('Error fetching simulation:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching the simulation'
    });
  }
});

// GET /api/simulator/history - Get user's simulation history
router.get('/history', ensureAuthenticated, async (req, res) => {
  try {
    const history = await ScenarioHistory.find({ userId: req.session.userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    res.json({
      success: true,
      history
    });

  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching simulation history'
    });
  }
});

// GET /api/simulator/scores - Get user's gamification scores
router.get('/scores', ensureAuthenticated, async (req, res) => {
  try {
    const userScore = await UserScore.findOne({ userId: req.session.userId }).lean();

    if (!userScore) {
      // Return default scores if none exist
      return res.json({
        success: true,
        scores: {
          safetyScore: 0,
          sustainabilityScore: 0,
          efficiencyScore: 0
        },
        level: 'Safe Launcher',
        badges: [],
        achievements: [],
        totalSimulations: 0
      });
    }

    const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
    const s = userScore.scores || {};
    res.json({
      success: true,
      scores: {
        safetyScore: r1(s.safetyScore),
        sustainabilityScore: r1(s.sustainabilityScore),
        efficiencyScore: r1(s.efficiencyScore)
      },
      level: userScore.level,
      badges: userScore.badges,
      achievements: userScore.achievements,
      totalSimulations: userScore.totalSimulations,
      // Mission progression. Without these the dashboard can show a player's
      // simulator scores but not the rank they actually earned playing.
      missionXp: r1(userScore.missionXp),
      totalMissions: userScore.totalMissions || 0,
      totalScore: r1(userScore.totalScore)
    });

  } catch (error) {
    console.error('Error fetching scores:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching scores'
    });
  }
});

// GET /api/simulator/nasa-data - Get real-time satellite data from NASA
router.get('/nasa-data', ensureAuthenticated, async (req, res) => {
  try {
    // Fetch space weather data and asteroid data, but be resilient to failures
    let spaceWeatherData = [];
    let asteroidData = { element_count: 0, near_earth_objects: {} };

    try {
      spaceWeatherData = await nasaApi.getSpaceWeatherData();
      // Ensure array shape
      if (!Array.isArray(spaceWeatherData)) spaceWeatherData = Array.isArray(spaceWeatherData.data) ? spaceWeatherData.data : [];
    } catch (innerErr) {
      console.warn('NASA space weather fetch failed, using synthetic fallback:', innerErr && innerErr.message ? innerErr.message : innerErr);
      spaceWeatherData = [];
    }

    try {
      asteroidData = await nasaApi.getAsteroidData();
      if (!asteroidData || typeof asteroidData.element_count === 'undefined') {
        asteroidData = { element_count: 0, near_earth_objects: {} };
      }
    } catch (innerErr) {
      console.warn('NASA asteroid fetch failed, using synthetic fallback:', innerErr && innerErr.message ? innerErr.message : innerErr);
      asteroidData = { element_count: 0, near_earth_objects: {} };
    }

    // Fetch satellite counts from CelesTrak
    let satelliteCounts = null;
    try {
      satelliteCounts = await nasaApi.getCelesTrakCounts();
    } catch (celestrakErr) {
      console.warn('CelesTrak fetch failed in /nasa-data:', celestrakErr.message);
    }

    res.json({
      success: true,
      spaceWeather: spaceWeatherData,
      asteroids: asteroidData,
      satelliteCounts: satelliteCounts || { leoCount: 0, meoCount: 0, geoCount: 0, source: 'unavailable' }
    });

  } catch (error) {
    console.error('Unexpected error in /nasa-data:', error && error.stack ? error.stack : error);
    // As a last resort, return safe fallback data instead of a 500 to keep the UI functional
    res.json({ success: true, spaceWeather: [], asteroids: { element_count: 0, near_earth_objects: {} } });
  }
});

// POST /api/simulator/real-time-prediction - Get real-time AI predictions
router.post('/real-time-prediction', ensureAuthenticated, async (req, res) => {
  try {
    const { parameters, currentState, environmentalFactors, timeHorizon } = req.body;

    // Validate input
    if (!parameters || !currentState) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: parameters or currentState'
      });
    }

    // Get user's simulation history
    const userHistory = await ScenarioHistory.find({ userId: req.session.userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // Call AI service for real-time prediction
    let aiAnalysis = {
      collisionRiskPercentage: 0,
      orbitalCongestionIncrease: 0,
      secondaryDebrisProbability: 0,
      confidenceLevel: 0,
      explanation: 'AI analysis pending',
      recommendations: []
    };

    try {
      // Generate real-time prediction locally instead of calling external service

      // Calculate based on current parameters and environmental factors
      const { parameters: params, currentState, environmentalFactors, timeHorizon } = req.body;

      // Calculate risk factors based on parameters
      const collisionRiskPercentage = calculateLocalCollisionRisk(
        currentState,
        { ...currentState, averageCongestion: currentState.averageCongestion * 1.1 }, // Simulate slight increase
        params
      );

      // Calculate congestion impact
      const orbitalCongestionIncrease = calculateLocalCongestionChange(
        currentState,
        { ...currentState, averageCongestion: currentState.averageCongestion * 1.1 },
        'launch' // Default event type
      );

      // Calculate debris probability based on environmental factors
      const secondaryDebrisProbability = environmentalFactors && environmentalFactors.near_earth_objects > 5 ?
        Math.min(50, environmentalFactors.near_earth_objects * 5) :
        10;

      // Generate explanation based on environmental factors
      const envKeys = Object.keys(environmentalFactors || {});
      let explanation = `Real-time prediction for scenario at ${parameters.altitude}km altitude:\n`;
      explanation += `• Current orbital congestion: ${(currentState.averageCongestion * 100).toFixed(1)}%\n`;
      explanation += `• Environmental factors considered: ${envKeys.length ? envKeys.join(', ') : 'none supplied'}\n`;
      explanation += `• Time horizon: ${timeHorizon || 30} days\n`;
      explanation += `• Predicted collision-risk index: ${collisionRiskPercentage.toFixed(1)}/100\n`;

      // Generate recommendations based on environmental conditions
      const recommendations = [];
      if (environmentalFactors && environmentalFactors.geomagnetic_storm_severity > 5) {
        recommendations.push(`Geomagnetic storm detected (severity: ${environmentalFactors.geomagnetic_storm_severity}). Monitor satellite operations closely.`);
      }
      if (environmentalFactors && environmentalFactors.solar_radiation_level > 7) {
        recommendations.push(`High solar radiation detected. Consider protective measures for satellite electronics.`);
      }
      if (environmentalFactors && environmentalFactors.near_earth_objects > 3) {
        recommendations.push(`Increased near-Earth object activity. Enhanced tracking recommended.`);
      }
      recommendations.push('Continue routine space situational awareness operations.');
      recommendations.push('Monitor conjunction data messages for potential close approaches.');

      aiAnalysis = {
        predictionId: `pred_${Date.now()}`,
        collisionRiskPercentage: collisionRiskPercentage,
        orbitalCongestionIncrease: orbitalCongestionIncrease,
        secondaryDebrisProbability: secondaryDebrisProbability,
        confidenceLevel: 75,
        explanation: explanation,
        recommendations: recommendations
      };
    } catch (localPredictionError) {
      console.error('Local real-time prediction error:', localPredictionError.message);
      // Fallback to default AI analysis
      aiAnalysis = {
        collisionRiskPercentage: 25,
        orbitalCongestionIncrease: 5,
        secondaryDebrisProbability: 10,
        confidenceLevel: 50,
        explanation: 'Real-time prediction of space traffic impact.',
        recommendations: ['Monitor orbital environment regularly', 'Follow space situational awareness protocols']
      };
    }

    res.json({
      success: true,
      aiAnalysis
    });

  } catch (error) {
    console.error('Error fetching real-time prediction:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching real-time prediction'
    });
  }
});

// POST /api/simulator/personalized-recommendations - Get personalized recommendations
router.post('/personalized-recommendations', ensureAuthenticated, async (req, res) => {
  try {
    const { currentScenario, userPreferences, skillLevel, riskTolerance } = req.body;

    // Get user's simulation history
    const simulationHistory = await ScenarioHistory.find({ userId: req.session.userId })
      .sort({ createdAt: -1 })
      .lean();

    // Get user's current scores to determine skill level if not provided
    let determinedSkillLevel = skillLevel || 'beginner';
    let determinedRiskTolerance = riskTolerance || 'moderate';

    if (!skillLevel || !riskTolerance) {
      const userScore = await UserScore.findOne({ userId: req.session.userId });
      if (userScore) {
        const avgScore = (userScore.scores.safetyScore + userScore.scores.sustainabilityScore + userScore.scores.efficiencyScore) / 3;

        if (avgScore >= 80) {
          determinedSkillLevel = 'expert';
        } else if (avgScore >= 60) {
          determinedSkillLevel = 'intermediate';
        } else {
          determinedSkillLevel = 'beginner';
        }

        // Determine risk tolerance based on past simulations
        const highRiskSims = simulationHistory.filter(sim =>
          sim.riskLevel === 'high').length;
        const lowRiskSims = simulationHistory.filter(sim =>
          sim.riskLevel === 'low').length;

        if (highRiskSims > simulationHistory.length * 0.6) {
          determinedRiskTolerance = 'aggressive';
        } else if (lowRiskSims > simulationHistory.length * 0.6) {
          determinedRiskTolerance = 'conservative';
        }
      }
    }

    // Call AI service for personalized recommendations
    let recommendations = {
      recommendations: [],
      learningPath: [],
      skillLevel: determinedSkillLevel,
      riskTolerance: determinedRiskTolerance
    };

    try {
      // Generate personalized recommendations locally instead of calling external service

      // Analyze user patterns and generate recommendations
      const userPatterns = {
        preferred_event_types: {},
        common_parameters: {},
        success_rate: 0.7,
        learning_progression: ['beginner', 'intermediate']
      };

      // Count event types from simulation history
      simulationHistory.forEach(sim => {
        const eventType = sim.eventType || 'launch';
        userPatterns.preferred_event_types[eventType] = (userPatterns.preferred_event_types[eventType] || 0) + 1;
      });

      // Generate personalized recommendations based on user patterns
      const localRecommendations = generateLocalRecommendations(
        currentScenario.eventType || 'launch',
        currentScenario.parameters || {},
        30, // Default collision risk
        5   // Default congestion change
      );

      // Add skill-level specific recommendations
      const skillSpecificRecs = [];
      if (determinedSkillLevel === 'beginner') {
        skillSpecificRecs.push('Focus on mastering basic orbital mechanics before attempting complex maneuvers.');
        skillSpecificRecs.push('Practice with low-risk scenarios to build confidence.');
      } else if (determinedSkillLevel === 'intermediate') {
        skillSpecificRecs.push('Experiment with different orbital regimes to broaden your experience.');
        skillSpecificRecs.push('Try coordinating multiple satellite deployments for complex missions.');
      } else {
        skillSpecificRecs.push('Consider contributing advanced scenarios to the community gallery.');
        skillSpecificRecs.push('Develop innovative approaches to space traffic management challenges.');
      }

      // Add risk-tolerance specific recommendations
      const riskSpecificRecs = [];
      if (determinedRiskTolerance === 'conservative') {
        riskSpecificRecs.push('Continue with your safety-first approach to space operations.');
        riskSpecificRecs.push('Consider sharing your risk-averse strategies with the community.');
      } else if (determinedRiskTolerance === 'aggressive') {
        riskSpecificRecs.push('Balance your innovative approach with additional safety checks.');
        riskSpecificRecs.push('Document your high-risk operations for lessons learned.');
      } else {
        riskSpecificRecs.push('Maintain your balanced approach to space mission planning.');
        riskSpecificRecs.push('Consider experimenting with both conservative and aggressive strategies.');
      }

      // Combine all recommendations
      const allRecommendations = [
        ...localRecommendations,
        ...skillSpecificRecs,
        ...riskSpecificRecs
      ];

      recommendations = {
        recommendations: allRecommendations,
        learningPath: determinedSkillLevel === 'beginner' ? ['Fundamentals', 'LEO Operations', 'Basic Maneuvers'] :
          determinedSkillLevel === 'intermediate' ? ['Advanced Orbits', 'Constellation Design', 'Risk Assessment'] :
            ['Expert Techniques', 'Situational Awareness', 'Research & Dev'],
        skillLevel: determinedSkillLevel,
        riskTolerance: determinedRiskTolerance,
        userPatterns: userPatterns
      };
    } catch (localRecsError) {
      console.error('Local personalized recommendations error:', localRecsError.message);
      // Fallback to default recommendations
      recommendations.recommendations = [
        'Explore different orbital scenarios to improve your skills.',
        'Review the AI explanations to better understand risk factors.',
        'Compare your results with the community scenarios for inspiration.'
      ];
      recommendations.learningPath = ['Fundamentals', 'Intermediate Concepts', 'Advanced Techniques'];
    }

    res.json({
      success: true,
      recommendations
    });

  } catch (error) {
    console.error('Error fetching personalized recommendations:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching personalized recommendations'
    });
  }
});

// POST /api/simulator/share-scenario - Share a scenario with the community
router.post('/share-scenario', ensureAuthenticated, async (req, res) => {
  try {
    const { scenarioName, description, eventType, parameters, simulationId } = req.body;

    // Validate input
    if (!scenarioName || !eventType || !parameters) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: scenarioName, eventType, or parameters'
      });
    }

    // Validate event type
    if (!['launch', 'adjustment', 'breakup'].includes(eventType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid event type. Must be launch, adjustment, or breakup'
      });
    }

    // Get simulation data if simulationId provided
    let aiAnalysis = {
      collisionRiskPercentage: 0,
      orbitalCongestionIncrease: 0,
      secondaryDebrisProbability: 0,
      confidenceLevel: 0,
      explanation: '',
      recommendations: []
    };

    if (simulationId) {
      const simulation = await Simulation.findOne({
        _id: simulationId,
        userId: req.session.userId
      });

      if (simulation && simulation.aiAnalysis) {
        aiAnalysis = simulation.aiAnalysis;
      }
    }

    // Create shared scenario
    const sharedScenario = new SharedScenario({
      userId: req.session.userId,
      username: req.session.username,
      scenarioName,
      description: description || '',
      eventType,
      parameters,
      aiAnalysis,
      likes: 0,
      likedBy: [],
      comments: []
    });

    await sharedScenario.save();

    res.json({
      success: true,
      message: 'Scenario shared successfully',
      scenarioId: sharedScenario._id
    });

  } catch (error) {
    console.error('Error sharing scenario:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while sharing scenario'
    });
  }
});

// GET /api/simulator/community-scenarios - Get community-shared scenarios
router.get('/community-scenarios', ensureAuthenticated, async (req, res) => {
  try {
    // Get paginated community scenarios, sorted by likes and recency
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Hide artefacts left by the automated test suites from the public gallery
    // (usernames like "qa-…", "qa2-…", scenario names starting "QA " / "Test ").
    const hideTestData = {
      username: { $not: /^(qa\d*|test|automated)[-_ ]/i },
      scenarioName: { $not: /^(qa|test|automated)\b/i }
    };

    const scenarios = await SharedScenario.find(hideTestData)
      .sort({ likes: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Get total count for pagination
    const totalScenarios = await SharedScenario.countDocuments(hideTestData);

    res.json({
      success: true,
      scenarios,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalScenarios / limit),
        totalScenarios
      }
    });

  } catch (error) {
    console.error('Error fetching community scenarios:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching community scenarios'
    });
  }
});

// POST /api/simulator/like-scenario - Like a community scenario
router.post('/like-scenario/:scenarioId', ensureAuthenticated, async (req, res) => {
  try {
    const { scenarioId } = req.params;

    // Find the scenario
    const scenario = await SharedScenario.findById(scenarioId);
    if (!scenario) {
      return res.status(404).json({
        success: false,
        message: 'Scenario not found'
      });
    }

    // Check if user has already liked
    const alreadyLiked = scenario.likedBy.includes(req.session.userId);

    if (alreadyLiked) {
      // Unlike - remove user from likedBy and decrement likes
      scenario.likedBy = scenario.likedBy.filter(id => id.toString() !== req.session.userId.toString());
      scenario.likes = Math.max(0, scenario.likes - 1);
    } else {
      // Like - add user to likedBy and increment likes
      scenario.likedBy.push(req.session.userId);
      scenario.likes += 1;
    }

    await scenario.save();

    res.json({
      success: true,
      message: alreadyLiked ? 'Scenario unliked' : 'Scenario liked',
      likes: scenario.likes,
      liked: !alreadyLiked
    });

  } catch (error) {
    console.error('Error liking scenario:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while liking scenario'
    });
  }
});

// POST /api/simulator/comment-scenario - Add comment to a community scenario
router.post('/comment-scenario/:scenarioId', ensureAuthenticated, async (req, res) => {
  try {
    const { scenarioId } = req.params;
    const { comment } = req.body;

    // Validate input
    if (!comment || comment.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Comment cannot be empty'
      });
    }

    // Find the scenario
    const scenario = await SharedScenario.findById(scenarioId);
    if (!scenario) {
      return res.status(404).json({
        success: false,
        message: 'Scenario not found'
      });
    }

    // Add comment
    scenario.comments.push({
      userId: req.session.userId,
      username: req.session.username,
      comment: comment.trim(),
      createdAt: new Date()
    });

    scenario.updatedAt = new Date();
    await scenario.save();

    res.json({
      success: true,
      message: 'Comment added successfully',
      comments: scenario.comments
    });

  } catch (error) {
    console.error('Error commenting on scenario:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while commenting on scenario'
    });
  }
});

// GET /api/simulator/scenario-comments/:scenarioId - Get comments for a scenario
router.get('/scenario-comments/:scenarioId', ensureAuthenticated, async (req, res) => {
  try {
    const { scenarioId } = req.params;

    // Find the scenario
    const scenario = await SharedScenario.findById(scenarioId);
    if (!scenario) {
      return res.status(404).json({
        success: false,
        message: 'Scenario not found'
      });
    }

    res.json({
      success: true,
      comments: scenario.comments
    });

  } catch (error) {
    console.error('Error fetching scenario comments:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching scenario comments'
    });
  }
});

// DELETE /api/simulator/comment-scenario/:scenarioId/:commentId - Delete a comment
router.delete('/comment-scenario/:scenarioId/:commentId', ensureAuthenticated, async (req, res) => {
  try {
    const { scenarioId, commentId } = req.params;

    // Find the scenario
    const scenario = await SharedScenario.findById(scenarioId);
    if (!scenario) {
      return res.status(404).json({
        success: false,
        message: 'Scenario not found'
      });
    }

    // Find the comment
    const comment = scenario.comments.id(commentId);
    if (!comment) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    // Ensure the user owns the comment
    if (comment.userId.toString() !== req.session.userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to delete this comment'
      });
    }

    // Remove the comment
    scenario.comments.pull({ _id: commentId });
    scenario.updatedAt = new Date();
    await scenario.save();

    res.json({
      success: true,
      message: 'Comment deleted successfully',
      comments: scenario.comments
    });

  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while deleting the comment'
    });
  }
});

// POST /api/simulator/chatbot-public - Public chatbot endpoint (no auth required)
router.post('/chatbot-public', async (req, res) => {
  try {
    const { question } = req.body;

    if (!question || question.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Question cannot be empty' });
    }

    const answer = await generateGeminiChatbotResponse(question.trim());

    res.json({ success: true, question: question.trim(), answer });
  } catch (error) {
    console.error('Error processing public chatbot question:', error);
    res.status(500).json({ success: false, message: 'An error occurred while processing your question' });
  }
});// POST /api/simulator/chatbot - Chatbot interface for space questions (authenticated)
router.post('/chatbot', ensureAuthenticated, async (req, res) => {
  try {
    const { question } = req.body;

    // Validate input
    if (!question || question.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Question cannot be empty'
      });
    }

    // Process the question and generate a response using Gemini API
    const answer = await generateGeminiChatbotResponse(question.trim());

    res.json({
      success: true,
      question: question.trim(),
      answer
    });

  } catch (error) {
    console.error('Error processing chatbot question:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while processing your question'
    });
  }
});

// Helper function to generate chatbot responses using Gemini API
// Trimmed so a key pasted into .env with a stray leading space still works.
// Never call the network from the test suite — force the offline corpus there.
const GEMINI_KEY = process.env.NODE_ENV === 'test'
  ? ''
  : (process.env.GEMINI_API_KEY || '').trim();

async function generateGeminiChatbotResponse(question) {
  // No key configured: go straight to the offline corpus, no failed network call.
  if (!GEMINI_KEY) return generateSpaceChatbotResponse(question);

  try {
    const { GoogleGenAI } = require('@google/genai');
    const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

    const prompt = `You are the expert space-science assistant for Spaceverse, a space education platform. Answer the question about astronomy, the solar system, orbital mechanics, the Kessler syndrome, stars, black holes, cosmology, rockets or space missions.

Be accurate, engaging and conversational. 2-4 short paragraphs, plain language. If the question is not about space, say so briefly and invite a space question.

Question: ${question}

Answer:`;

    const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
    const answer = (response.text || '').trim();
    if (answer) return answer;
    // Empty completion: fall through to the corpus.
    return generateSpaceChatbotResponse(question);
  } catch (error) {
    console.warn('Gemini chatbot unavailable, using offline corpus:', error.message || error);
    return generateSpaceChatbotResponse(question);
  }
}

// Offline chatbot brain. Delegates to the curated space-science corpus in
// services/space-knowledge.js, which covers orbital mechanics, the Kessler
// syndrome, the solar system, stellar physics, cosmology and the major
// missions. Always returns a useful string.
function generateSpaceChatbotResponse(question) {
  return spaceKnowledge.answerSpaceQuestion(question);
}

// Collision-risk INDEX (0-100), not a literal probability. It is a teaching
// score: a routine LEO launch lands low (~15-30), a heavy fragmentation in a
// crowded shell lands high (75+). The label thresholds in
// generateLocalExplanation() are aligned to these bands so the words match the
// number (the old scale called a nominal ~39 "LOW", which read as a bug).
function calculateLocalCollisionRisk(beforeState, afterState, parameters) {
  const { altitude, inclination, velocity, mass } = parameters;

  // Contribution from how crowded the resulting shell is. Scaled so a busy but
  // routine LEO still leaves room under the MODERATE band for a clean scenario.
  const congestionRisk = Math.min(26, (afterState.averageCongestion || 0) * 34);

  // Altitude band — the 750-950 km debris belt is the danger zone; the Starlink
  // shell below it and self-cleaning VLEO are markedly safer, MEO/GEO safer still.
  let altitudeRisk;
  if (altitude < 450) altitudeRisk = 10;        // VLEO: drag clears debris in months
  else if (altitude < 650) altitudeRisk = 14;   // lower LEO / Starlink shell
  else if (altitude < 950) altitudeRisk = 22;   // debris-belt heart of LEO
  else if (altitude < 1300) altitudeRisk = 15;  // upper LEO
  else if (altitude < 2000) altitudeRisk = 9;   // LEO fringe
  else if (altitude < 35786) altitudeRisk = 4;  // MEO
  else altitudeRisk = 3;                         // GEO

  // Inclination: crossing orbits raise conjunction geometry variety.
  const inclinationRisk = Math.abs(Math.sin(inclination * Math.PI / 180)) * 5;

  // Kinetic energy scales damage potential; normalise to typical LEO speed.
  const velocityRisk = Math.min(10, (velocity / 7.8) * 7);

  // Bigger objects are bigger targets and bigger debris sources.
  const massRisk = Math.min(12, (mass / 1000) * 3.5);

  const total = congestionRisk + altitudeRisk + inclinationRisk + velocityRisk + massRisk;

  // Keep some headroom for uncertainty at the top of the range.
  return Math.round(Math.min(95, total) * 10) / 10;
}

// Helper function to calculate congestion change locally
function calculateLocalCongestionChange(beforeState, afterState, eventType) {
  // Calculate the change in congestion
  const congestionChange = afterState.averageCongestion - beforeState.averageCongestion;

  // Convert to percentage increase/decrease
  let percentageChange = 0;
  if (beforeState.averageCongestion > 0) {
    percentageChange = (congestionChange / beforeState.averageCongestion) * 100;
  } else {
    percentageChange = congestionChange * 100; // If no initial congestion, use absolute value
  }

  // For breakups, congestion increases significantly
  if (eventType === 'breakup') {
    percentageChange *= 3; // Breakups create much more congestion
  }

  // For launches, congestion increases moderately
  else if (eventType === 'launch') {
    percentageChange *= 1.5; // Launches add moderate congestion
  }

  return Math.max(0, percentageChange); // Never negative
}

// Helper function to generate explanation locally
function generateLocalExplanation(eventType, parameters, collisionRisk, congestionChange, debrisProb) {
  const { altitude, inclination, velocity, mass } = parameters;

  let explanation = `Analysis of ${eventType} event at ${altitude}km altitude with ${mass}kg mass, ${inclination}° inclination, and ${velocity}km/s velocity:\n\n`;

  // Collision-risk index band. Thresholds match calculateLocalCollisionRisk()'s
  // 0-100 teaching scale so the label always agrees with the number.
  if (collisionRisk >= 65) {
    explanation += `• HIGH collision-risk index (${collisionRisk.toFixed(1)}/100) — dense shell and energetic object; treat as a conjunction hotspot.\n`;
  } else if (collisionRisk >= 35) {
    explanation += `• MODERATE collision-risk index (${collisionRisk.toFixed(1)}/100) — monitor closely for potential conjunctions.\n`;
  } else {
    explanation += `• LOW collision-risk index (${collisionRisk.toFixed(1)}/100) — favourable orbital conditions.\n`;
  }

  // Add congestion explanation
  if (congestionChange > 10) {
    explanation += `• SIGNIFICANT congestion increase (${congestionChange.toFixed(1)}%) in this orbital regime.\n`;
  } else if (congestionChange > 3) {
    explanation += `• MODERATE congestion increase (${congestionChange.toFixed(1)}%) - adding to orbital traffic.\n`;
  } else {
    explanation += `• MINIMAL congestion impact (${congestionChange.toFixed(1)}%) - limited effect on orbital environment.\n`;
  }

  // Add debris explanation
  if (eventType === 'breakup') {
    explanation += `• CONCERNING debris risk (${debrisProb.toFixed(1)}%) from fragmentation event - potential cascade effects.\n`;
  } else {
    explanation += `• LOW debris generation risk (${debrisProb.toFixed(1)}%) - controlled event.\n`;
  }

  // Add altitude-specific insight
  if (altitude < 500) {
    explanation += `• Very Low Earth Orbit (VLEO) operations face atmospheric drag challenges but shorter debris lifetime.\n`;
  } else if (altitude < 2000) {
    explanation += `• Low Earth Orbit (LEO) is congested with many active satellites and debris.\n`;
  } else if (altitude < 35786) {
    explanation += `• Medium Earth Orbit (MEO) hosts navigation constellations with moderate traffic density.\n`;
  } else {
    explanation += `• Geostationary Orbit (GEO) has precise slot assignments but limited available positions.\n`;
  }

  return explanation;
}

// Helper function to generate recommendations locally
function generateLocalRecommendations(eventType, parameters, collisionRisk, congestionChange) {
  const recommendations = [];

  // Risk-based recommendations
  if (collisionRisk > 60) {
    recommendations.push("Implement enhanced conjunction analysis with 24/7 monitoring");
    recommendations.push("Establish emergency maneuver procedures for collision avoidance");
  } else if (collisionRisk > 30) {
    recommendations.push("Conduct regular conjunction assessments (daily minimum)");
    recommendations.push("Plan contingency maneuvers for high-risk conjunctions");
  } else {
    recommendations.push("Standard conjunction analysis (weekly minimum)");
    recommendations.push("Routine tracking and catalog maintenance");
  }

  // Congestion-based recommendations
  if (congestionChange > 15) {
    recommendations.push("Coordinate with other operators to minimize interference");
    recommendations.push("Consider alternative orbital slots to reduce congestion");
  } else if (congestionChange > 5) {
    recommendations.push("Share orbital data with space situational awareness services");
    recommendations.push("Follow orbital debris mitigation guidelines");
  }

  // Event-type recommendations
  if (eventType === 'launch') {
    recommendations.push("Optimize launch window to minimize collision probability");
    recommendations.push("Implement post-deployment checkout and orbit raising");
  } else if (eventType === 'adjustment') {
    recommendations.push("Calculate optimal delta-V for fuel-efficient maneuver");
    recommendations.push("Verify new orbit doesn't create conjunction risks");
  } else if (eventType === 'breakup') {
    recommendations.push("Track all fragmentation products for collision avoidance");
    recommendations.push("Assess potential Kessler syndrome contribution");
    recommendations.push("Review debris mitigation compliance for future missions");
  }

  // General recommendations
  recommendations.push("Adhere to space situational awareness reporting requirements");
  recommendations.push("Maintain accurate orbital element sharing with community");

  return recommendations;
}

module.exports = {
  router,
  initializeModels
};
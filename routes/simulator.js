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
  level: {
    type: String,
    default: 'Safe Launcher',
    enum: ['Safe Launcher', 'Orbital Optimizer', 'Space Sustainability Engineer']
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
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

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

    // Update level based on average score
    const avgScore = (userScore.scores.safetyScore + userScore.scores.sustainabilityScore + userScore.scores.efficiencyScore) / 3;

    if (avgScore >= 80) {
      userScore.level = 'Space Sustainability Engineer';
    } else if (avgScore >= 60) {
      userScore.level = 'Orbital Optimizer';
    } else {
      userScore.level = 'Safe Launcher';
    }

    // Increment total simulations
    userScore.totalSimulations += 1;
    userScore.lastUpdated = new Date();

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
    // Get top 10 users by total score (sum of all three scores)
    const leaderboard = await UserScore.aggregate([
      {
        $project: {
          userId: 1,
          scores: 1,
          level: 1,
          totalScore: {
            $add: [
              "$scores.safetyScore",
              "$scores.sustainabilityScore",
              "$scores.efficiencyScore"
            ]
          }
        }
      },
      {
        $sort: { totalScore: -1 }
      },
      {
        $limit: 10
      }
    ]);

    // Populate user information
    const userIds = leaderboard.map(entry => entry.userId);
    const users = await User.find({ _id: { $in: userIds } }, 'username');

    // Create user map for quick lookup
    const userMap = {};
    users.forEach(user => {
      userMap[user._id.toString()] = user.username;
    });

    // Format leaderboard data
    const formattedLeaderboard = leaderboard.map((entry, index) => ({
      rank: index + 1,
      username: userMap[entry.userId.toString()] || 'Unknown User',
      totalScore: entry.totalScore,
      level: entry.level
    }));

    // Get current user's rank
    const currentUserScore = await UserScore.findOne({ userId: req.session.userId });
    let currentUserRank = null;

    if (currentUserScore) {
      const currentUserTotal =
        currentUserScore.scores.safetyScore +
        currentUserScore.scores.sustainabilityScore +
        currentUserScore.scores.efficiencyScore;

      const higherScoresCount = await UserScore.countDocuments({
        $expr: {
          $gt: [
            {
              $add: [
                "$scores.safetyScore",
                "$scores.sustainabilityScore",
                "$scores.efficiencyScore"
              ]
            },
            currentUserTotal
          ]
        }
      });

      currentUserRank = higherScoresCount + 1;
    }

    res.json({
      success: true,
      leaderboard: formattedLeaderboard,
      currentUser: {
        rank: currentUserRank,
        username: req.session.username,
        totalScore: currentUserScore ?
          currentUserScore.scores.safetyScore +
          currentUserScore.scores.sustainabilityScore +
          currentUserScore.scores.efficiencyScore : 0,
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

    res.json({
      success: true,
      scores: userScore.scores,
      level: userScore.level,
      badges: userScore.badges,
      achievements: userScore.achievements,
      totalSimulations: userScore.totalSimulations
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
      let explanation = `Real-time prediction for scenario at ${parameters.altitude}km altitude:\n`;
      explanation += `• Current orbital congestion: ${(currentState.averageCongestion * 100).toFixed(1)}%\n`;
      explanation += `• Environmental factors considered: ${JSON.stringify(environmentalFactors || {})}\n`;
      explanation += `• Time horizon: ${timeHorizon || 24} hours\n`;
      explanation += `• Predicted collision risk: ${collisionRiskPercentage.toFixed(1)}%\n`;

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

    const scenarios = await SharedScenario.find()
      .sort({ likes: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Get total count for pagination
    const totalScenarios = await SharedScenario.countDocuments();

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
async function generateGeminiChatbotResponse(question) {
  try {
    console.log('Calling Gemini API for question:', question);

    // Use the newer @google/genai SDK (same one used in app-enhanced.js)
    const { GoogleGenAI } = require('@google/genai');

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Create a space-focused prompt
    const prompt = `You are an expert space science assistant for Spaceverse, a space education platform. Answer the following question about space science, astronomy, planets, stars, galaxies, rocket science, orbital mechanics, black holes, or related space topics.

Be informative, accurate, engaging, and conversational. Keep your response concise but comprehensive (2-4 paragraphs maximum). Use simple language that anyone can understand.

Question: ${question}

Answer:`;

    console.log('Sending prompt to Gemini API');

    const response = await ai.models.generateContent({
      model: 'gemini-flash-latest',
      contents: prompt,
    });

    const answer = response.text;

    console.log('Received response from Gemini API:', answer.substring(0, 100) + '...');

    return answer;
  } catch (error) {
    console.error('Error calling Gemini API:', error.message || error);
    // Fallback to the original response generator if API fails
    return generateSpaceChatbotResponse(question);
  }
}

// Helper function to generate chatbot responses (fallback)
function generateSpaceChatbotResponse(question) {
  // Convert question to lowercase for easier matching
  const lowerQuestion = question.toLowerCase();

  // Define responses for common space questions

  // Greetings
  if (lowerQuestion.includes('hi') || lowerQuestion.includes('hello') || lowerQuestion.includes('hey') || lowerQuestion.includes('greetings')) {
    return "Hello! I'm your Space Science Assistant. I can answer questions about space, astronomy, stars, planets, black holes, and related topics. What would you like to know about the universe today?";
  }

  // Farewells
  if (lowerQuestion.includes('bye') || lowerQuestion.includes('goodbye') || lowerQuestion.includes('see you') || lowerQuestion.includes('farewell')) {
    return "Goodbye! It was great chatting about space with you. Feel free to come back anytime you have more questions about the cosmos. Safe travels through the universe! 🚀";
  }

  // Thanks
  if (lowerQuestion.includes('thank') || lowerQuestion.includes('thanks')) {
    return "You're welcome! I'm glad I could help with your space questions. Keep exploring the cosmos and feel free to ask anytime!";
  }

  if (lowerQuestion.includes('who are you') || lowerQuestion.includes('what are you')) {
    return "I'm a Space Science Assistant powered by AI! I'm here to help you learn about space, astronomy, and the wonders of the universe. Feel free to ask me about planets, stars, galaxies, black holes, or any other space-related topics!";
  }

  // How are you
  if (lowerQuestion.includes('how are you') || lowerQuestion.includes('how do you do')) {
    return "I'm doing great, thank you for asking! I'm here and ready to help you explore the wonders of space. What would you like to learn about today?";
  }
  // Planets
  if (lowerQuestion.includes('how many planets') || lowerQuestion.includes('planets in solar system')) {
    return "There are 8 planets in our solar system: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune. Pluto was reclassified as a 'dwarf planet' in 2006. The planets are divided into rocky inner planets (Mercury, Venus, Earth, Mars) and gas giants (Jupiter, Saturn) plus ice giants (Uranus, Neptune).";
  }

  if (lowerQuestion.includes('what is space') || lowerQuestion.includes('define space')) {
    return "Space, also known as outer space, is the expanse that exists beyond Earth and between celestial bodies. It is a vacuum containing a low density of particles, predominantly a plasma of hydrogen and helium, as well as electromagnetic radiation, magnetic fields, neutrinos, dust, and cosmic rays.";
  }

  if (lowerQuestion.includes('how big is the universe') || lowerQuestion.includes('size of universe')) {
    return "The observable universe is estimated to be about 93 billion light-years in diameter. However, the entire universe could be much larger, and some theories suggest it might be infinite. The universe is also expanding, with distant galaxies moving away from us.";
  }

  if (lowerQuestion.includes('black hole') || lowerQuestion.includes('what is a black hole')) {
    return "A black hole is a region of spacetime where gravity is so strong that nothing—no particles or even electromagnetic radiation such as light—can escape from it. The theory of general relativity predicts that a sufficiently compact mass can deform spacetime to form a black hole.";
  }

  if (lowerQuestion.includes('how do rockets work') || lowerQuestion.includes('rocket propulsion')) {
    return "Rockets work on the principle of Newton's third law of motion: for every action, there is an equal and opposite reaction. They expel mass (burned fuel) at high speed in one direction, which propels the rocket in the opposite direction. This works even in the vacuum of space where there is no air to push against.";
  }

  if (lowerQuestion.includes('what is the speed of light') || lowerQuestion.includes('speed of light')) {
    return "The speed of light in a vacuum is approximately 299,792,458 meters per second (or about 186,282 miles per second). This is roughly 300,000 kilometers per second. According to Einstein's theory of special relativity, nothing can travel faster than the speed of light.";
  }

  if (lowerQuestion.includes('what is gravity') || lowerQuestion.includes('define gravity')) {
    return "Gravity is a natural phenomenon by which all things with mass or energy—including planets, stars, galaxies, and even light—are brought toward one another. On Earth, gravity gives weight to physical objects and causes the ocean tides. Einstein's general theory of relativity describes gravity as a consequence of the curvature of spacetime.";
  }

  if (lowerQuestion.includes('how are stars formed') || lowerQuestion.includes('star formation') || lowerQuestion.includes('formation of stars')) {
    return "Stars form from vast clouds of gas and dust in space called nebulae. Here's the process in simple terms:\n\n1. **Gravitational Collapse**: A region within a nebula becomes denser and starts collapsing under its own gravity.\n\n2. **Protostar Formation**: As the material collapses, it heats up and forms a spinning disk with a hot, dense core called a protostar.\n\n3. **Nuclear Fusion Ignition**: When the core temperature reaches about 10 million degrees Celsius, hydrogen atoms begin fusing into helium—this is nuclear fusion, and it marks the birth of a star!\n\n4. **Main Sequence Star**: The outward pressure from fusion balances the inward pull of gravity, creating a stable star that can shine for billions of years.\n\nOur Sun formed this way about 4.6 billion years ago, and new stars are still being born in nebulae like the Orion Nebula today!";
  }

  if (lowerQuestion.includes('what is a galaxy') || lowerQuestion.includes('define galaxy')) {
    return "A galaxy is a system of millions or billions of stars, together with gas and dust, held together by gravitational attraction. Our solar system is part of the Milky Way galaxy, which contains an estimated 100-400 billion stars. There are many different types of galaxies, including spiral, elliptical, and irregular galaxies.";
  }

  if (lowerQuestion.includes('what is dark matter') || lowerQuestion.includes('dark matter')) {
    return "Dark matter is a form of matter thought to account for approximately 85% of the matter in the universe. It is called 'dark' because it does not appear to interact with the electromagnetic field, making it invisible to direct observation. Its existence is inferred from gravitational effects on visible matter and the structure of the universe.";
  }

  if (lowerQuestion.includes('what is dark energy') || lowerQuestion.includes('dark energy')) {
    return "Dark energy is a mysterious force that is causing the expansion of the universe to accelerate. It makes up about 68% of the universe. Unlike gravity, which pulls things together, dark energy seems to push space apart. Scientists don't yet understand what dark energy is, but its effects are clearly observed through measurements of distant supernovae.";
  }

  if (lowerQuestion.includes('how old is the earth') || lowerQuestion.includes('age of earth')) {
    return "Earth is approximately 4.54 billion years old. Scientists have determined this age through radiometric dating of the oldest Earth materials, as well as meteorites and lunar samples. This age is consistent with the ages of other bodies in the Solar System.";
  }

  if (lowerQuestion.includes('what is the ozone layer') || lowerQuestion.includes('ozone layer')) {
    return "The ozone layer is a region of Earth's stratosphere that absorbs most of the Sun's ultraviolet radiation. It contains a higher concentration of ozone (O3) than the rest of the atmosphere. The ozone layer is mainly found 15 to 35 kilometers above Earth's surface and plays a crucial role in protecting life on Earth from harmful UV radiation.";
  }

  if (lowerQuestion.includes('what is a comet') || lowerQuestion.includes('define comet')) {
    return "A comet is an icy, small Solar System body that, when passing close to the Sun, warms and begins to release gases, a process called outgassing. This produces a visible atmosphere or coma, and sometimes also a tail. These phenomena are due to the effects of solar radiation and the solar wind acting upon the nucleus of the comet.";
  }

  if (lowerQuestion.includes('what is an asteroid') || lowerQuestion.includes('define asteroid')) {
    return "An asteroid is a rocky object that orbits the Sun. Asteroids are smaller than planets but larger than meteoroids. Most asteroids orbit in the asteroid belt between Mars and Jupiter. They are remnants from the formation of the solar system about 4.6 billion years ago.";
  }

  if (lowerQuestion.includes('what is the kuiper belt') || lowerQuestion.includes('kuiper belt')) {
    return "The Kuiper Belt is a region of the outer solar system beyond the orbit of Neptune, extending from about 30 to 50 astronomical units (AU) from the Sun. It is similar to the asteroid belt but is far larger—20 times as wide and 20 to 200 times as massive. The Kuiper Belt is home to three officially recognized dwarf planets: Pluto, Haumea, and Makemake.";
  }

  // Default response for unrecognized questions
  return "That's an interesting question about space! While I don't have a specific answer prepared for that topic, I recommend exploring our Space Traffic Simulator to learn more about orbital mechanics, or checking out our educational content about the solar system. Is there something more specific about space you'd like to know?";
}

// Helper function to calculate collision risk locally
function calculateLocalCollisionRisk(beforeState, afterState, parameters) {
  const { altitude, inclination, velocity, mass } = parameters;

  // Base risk from congestion
  const baseRisk = afterState.averageCongestion * 50; // Scale congestion to percentage

  // Risk from altitude (LEO has higher traffic)
  let altitudeRisk = 0;
  if (altitude < 500) altitudeRisk = 25; // Very low Earth orbit - high risk
  else if (altitude < 1000) altitudeRisk = 15; // Low Earth orbit - medium-high risk
  else if (altitude < 2000) altitudeRisk = 10; // Mid LEO - medium risk
  else if (altitude < 35786) altitudeRisk = 5; // MEO - low risk
  else altitudeRisk = 2; // GEO - very low risk

  // Risk from inclination (equatorial and polar orbits have specific patterns)
  const inclinationRisk = Math.abs(Math.sin(inclination * Math.PI / 180)) * 10;

  // Risk from velocity (higher velocity = higher kinetic energy = higher damage potential)
  const velocityRisk = Math.min(20, (velocity / 7.8) * 15); // Normalize to typical LEO velocity

  // Risk from mass (larger objects cause more damage)
  const massRisk = Math.min(15, (mass / 1000) * 5);

  // Combine all risk factors
  let totalRisk = baseRisk + altitudeRisk + inclinationRisk + velocityRisk + massRisk;

  // Cap at 95% to allow for some uncertainty
  return Math.min(95, totalRisk);
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

  // Add collision risk explanation
  if (collisionRisk > 70) {
    explanation += `• HIGH collision risk (${collisionRisk.toFixed(1)}%) due to dense orbital environment and object characteristics.\n`;
  } else if (collisionRisk > 40) {
    explanation += `• MODERATE collision risk (${collisionRisk.toFixed(1)}%) - monitor closely for potential conjunctions.\n`;
  } else {
    explanation += `• LOW collision risk (${collisionRisk.toFixed(1)}%) - favorable orbital conditions.\n`;
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
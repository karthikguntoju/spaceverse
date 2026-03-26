/**
 * Migration Script: Move data from local MongoDB to MongoDB Atlas
 * 
 * This script copies data from a local MongoDB instance to MongoDB Atlas.
 * Run this script after setting up your MongoDB Atlas cluster and updating
 * your .env file with the Atlas connection string.
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Local MongoDB connection
const localUri = 'mongodb://localhost:27017/spaceverse';

// MongoDB Atlas connection from .env
const atlasUri = process.env.MONGODB_URI;

if (!atlasUri || atlasUri.includes('localhost')) {
  console.error('❌ Error: Please update your .env file with a valid MongoDB Atlas connection string');
  console.error('Current MONGODB_URI:', atlasUri);
  process.exit(1);
}

async function migrateData() {
  console.log('🔄 Starting MongoDB migration from local to Atlas...\n');
  
  try {
    // Connect to local MongoDB
    console.log('🔗 Connecting to local MongoDB...');
    const localConnection = await mongoose.createConnection(localUri);
    console.log('✅ Connected to local MongoDB\n');
    
    // Connect to MongoDB Atlas
    console.log('🔗 Connecting to MongoDB Atlas...');
    const atlasConnection = await mongoose.createConnection(atlasUri);
    console.log('✅ Connected to MongoDB Atlas\n');
    
    // Define schemas
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
    
    // Space Traffic Simulator schemas
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
    
    // Create models for local connection
    const LocalUser = localConnection.model('User', userSchema);
    const LocalPlanet = localConnection.model('Planet', planetSchema);
    const LocalSimulation = localConnection.model('Simulation', simulationSchema);
    const LocalUserScore = localConnection.model('UserScore', userScoreSchema);
    const LocalScenarioHistory = localConnection.model('ScenarioHistory', scenarioHistorySchema);
    
    // Create models for Atlas connection
    const AtlasUser = atlasConnection.model('User', userSchema);
    const AtlasPlanet = atlasConnection.model('Planet', planetSchema);
    const AtlasSimulation = atlasConnection.model('Simulation', simulationSchema);
    const AtlasUserScore = atlasConnection.model('UserScore', userScoreSchema);
    const AtlasScenarioHistory = atlasConnection.model('ScenarioHistory', scenarioHistorySchema);
    
    // Clear existing data in Atlas (optional - remove if you want to preserve existing data)
    console.log('🗑️  Clearing existing data in Atlas...');
    await Promise.all([
      AtlasUser.deleteMany({}),
      AtlasPlanet.deleteMany({}),
      AtlasSimulation.deleteMany({}),
      AtlasUserScore.deleteMany({}),
      AtlasScenarioHistory.deleteMany({})
    ]);
    console.log('✅ Cleared existing data in Atlas\n');
    
    // Migrate Users
    console.log('👥 Migrating Users...');
    const users = await LocalUser.find({});
    if (users.length > 0) {
      await AtlasUser.insertMany(users);
      console.log(`✅ Migrated ${users.length} users\n`);
    } else {
      console.log('ℹ️  No users to migrate\n');
    }
    
    // Migrate Planets
    console.log('🪐 Migrating Planets...');
    const planets = await LocalPlanet.find({});
    if (planets.length > 0) {
      await AtlasPlanet.insertMany(planets);
      console.log(`✅ Migrated ${planets.length} planets\n`);
    } else {
      console.log('ℹ️  No planets to migrate\n');
    }
    
    // Migrate Simulations
    console.log('🛰️  Migrating Simulations...');
    const simulations = await LocalSimulation.find({});
    if (simulations.length > 0) {
      await AtlasSimulation.insertMany(simulations);
      console.log(`✅ Migrated ${simulations.length} simulations\n`);
    } else {
      console.log('ℹ️  No simulations to migrate\n');
    }
    
    // Migrate User Scores
    console.log('🏆 Migrating User Scores...');
    const userScores = await LocalUserScore.find({});
    if (userScores.length > 0) {
      await AtlasUserScore.insertMany(userScores);
      console.log(`✅ Migrated ${userScores.length} user scores\n`);
    } else {
      console.log('ℹ️  No user scores to migrate\n');
    }
    
    // Migrate Scenario History
    console.log('📜 Migrating Scenario History...');
    const scenarioHistories = await LocalScenarioHistory.find({});
    if (scenarioHistories.length > 0) {
      await AtlasScenarioHistory.insertMany(scenarioHistories);
      console.log(`✅ Migrated ${scenarioHistories.length} scenario histories\n`);
    } else {
      console.log('ℹ️  No scenario histories to migrate\n');
    }
    
    // Close connections
    await localConnection.close();
    await atlasConnection.close();
    
    console.log('🎉 Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Update your .env file to use the MongoDB Atlas connection string');
    console.log('2. Deploy your application to your preferred hosting platform');
    console.log('3. Test that everything works correctly with the new database');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration if script is called directly
if (require.main === module) {
  migrateData();
}

module.exports = { migrateData };
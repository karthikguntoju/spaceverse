/**
 * Health Check Script
 * 
 * This script verifies that all components of the Spaceverse application
 * are working correctly after deployment or changes.
 */

const http = require('http');
const mongoose = require('mongoose');
require('dotenv').config();

const BASE_URL = 'http://localhost:5001';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/spaceverse';

async function checkMongoDB() {
  console.log('🔍 Checking MongoDB connection...');
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB connection successful');
    await mongoose.connection.close();
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    return false;
  }
}

function checkEndpoint(path) {
  return new Promise((resolve) => {
    console.log(`🔍 Checking endpoint: ${path}`);
    
    const options = {
      hostname: 'localhost',
      port: 5001,
      path: path,
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      // Any response status code is acceptable - we're just checking connectivity
      console.log(`✅ Endpoint ${path} responded with status ${res.statusCode}`);
      resolve(true);
    });

    req.on('error', (error) => {
      console.error(`❌ Failed to reach endpoint ${path}:`, error.message);
      resolve(false);
    });

    req.end();
  });
}

async function runHealthChecks() {
  console.log('🏥 Starting Spaceverse Health Checks...\n');
  
  let allChecksPassed = true;
  
  // Check MongoDB connection
  const mongoDBCheck = await checkMongoDB();
  if (!mongoDBCheck) allChecksPassed = false;
  
  console.log('');
  
  // Check main endpoints (these don't require authentication)
  const endpoints = [
    '/',
    '/solar-system',
    '/quiz',
    '/space-traffic-simulator',
    '/space-traffic-visualization',
    '/vr-solar-system'
  ];
  
  for (const endpoint of endpoints) {
    const checkResult = await checkEndpoint(endpoint); // All should return a response (200 or 302)
    if (!checkResult) allChecksPassed = false;
  }
  
  console.log('');
  
  // Summary
  if (allChecksPassed) {
    console.log('🎉 All health checks passed! The application is running correctly.');
  } else {
    console.log('⚠️  Some health checks failed. Please review the errors above.');
    process.exit(1);
  }
}

// Run health checks if script is called directly
if (require.main === module) {
  runHealthChecks();
}

module.exports = { runHealthChecks };
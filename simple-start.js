/**
 * Simple Startup Script for Spaceverse
 * This script starts both the main application and AI service with better error handling
 */

const { spawn, exec } = require('child_process');
const path = require('path');
const os = require('os');

console.log('========================================');
console.log('Spaceverse Simple Startup');
console.log('========================================');

let mainAppProcess;
let aiServiceProcess;

// Function to cleanup processes on exit
function cleanup() {
  console.log('\nShutting down services...');
  
  if (mainAppProcess) {
    mainAppProcess.kill();
  }
  
  if (aiServiceProcess) {
    aiServiceProcess.kill();
  }
  
  process.exit(0);
}

// Handle process termination
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Function to start AI Service with better error handling
function startAIService() {
  console.log('Starting AI Service...');
  
  const aiServicePath = path.join(process.cwd(), 'ai-service');
  const pythonCmd = os.platform() === 'win32' ? 'python' : 'python3';
  
  // Try to start the AI service directly first (assuming dependencies are installed)
  aiServiceProcess = spawn(pythonCmd, ['ai_service.py'], {
    stdio: 'inherit',
    cwd: aiServicePath
  });
  
  aiServiceProcess.on('error', (err) => {
    console.error('Failed to start AI service directly:', err.message);
    console.log('\n⚠️  AI Service failed to start. This is likely due to missing Python dependencies.');
    console.log('You can either:');
    console.log('1. Install dependencies manually: cd ai-service && pip install -r requirements.txt');
    console.log('2. Continue using the application without AI features (some simulator features will be limited)');
    console.log('\nStarting Main Application anyway...\n');
    
    // Resolve immediately so the main app can start
    setTimeout(() => {
      console.log('AI service startup attempted (failed)');
    }, 1000);
  });
  
  // Give the AI service time to start
  setTimeout(() => {
    console.log('AI service startup attempted');
  }, 3000);
}

// Function to start Main Application
function startMainApplication() {
  console.log('Starting Main Application...');
  mainAppProcess = spawn('node', ['app-enhanced.js'], {
    stdio: 'inherit',
    cwd: process.cwd()
  });
  
  mainAppProcess.on('error', (err) => {
    console.error('Failed to start main application:', err.message);
  });
  
  mainAppProcess.on('close', (code) => {
    console.log(`Main application exited with code ${code}`);
    cleanup();
  });
}

// Main startup sequence
function startAllServices() {
  try {
    // Start AI Service
    startAIService();
    
    // Small delay to ensure services are ready
    setTimeout(() => {
      // Start Main Application
      startMainApplication();
      
      console.log('\n========================================');
      console.log('Startup sequence completed!');
      console.log('Main App: http://localhost:5002 (or next available port)');
      console.log('AI Service: http://localhost:8001');
      console.log('Press Ctrl+C to stop all services.');
      console.log('========================================');
    }, 5000);
  } catch (error) {
    console.error('Error starting services:', error.message);
    cleanup();
  }
}

// Start everything
startAllServices();
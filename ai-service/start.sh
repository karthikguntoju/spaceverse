#!/bin/bash

# Space Traffic Simulator AI Service Startup Script

echo "Starting Space Traffic Simulator AI Service..."

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements.txt

# Start the service
echo "Starting AI service on port 8000..."
python ai_service.py
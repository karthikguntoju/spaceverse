"""
Space Traffic Simulator AI Service
---------------------------------

This service provides AI-powered predictions for space traffic simulations,
including collision risk assessment, congestion analysis, and debris probability.
"""

import os
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, r2_score
import joblib
import uvicorn
from dotenv import load_dotenv
import logging
from datetime import datetime

# Deep learning imports
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout
from tensorflow.keras.optimizers import Adam

# Reinforcement learning imports
try:
    from stable_baselines3 import PPO
    from stable_baselines3.common.env_util import make_vec_env
    RL_AVAILABLE = True
except ImportError:
    RL_AVAILABLE = False
    print("Stable-Baselines3 not available, RL features disabled")

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Space Traffic Simulator AI Service",
    description="AI-powered predictions for space traffic simulations",
    version="1.0.0"
)

# Pydantic models for request/response validation
class SimulationParameters(BaseModel):
    altitude: float  # km
    inclination: float  # degrees
    velocity: float  # km/s
    mass: float  # kg
    launchTime: str  # ISO format datetime

class SimulationState(BaseModel):
    objectsInLEO: int
    objectsInMEO: int
    objectsInGEO: int
    averageCongestion: float  # 0-1 scale
    collisionProbability: float  # 0-1 scale

class SimulationResults(BaseModel):
    beforeState: SimulationState
    afterState: SimulationState
    changes: dict

class AISimulateImpactRequest(BaseModel):
    simulationId: str
    beforeState: SimulationState
    afterState: SimulationState
    changes: dict

class AISimulateImpactResponse(BaseModel):
    predictionId: str
    collisionRiskPercentage: float  # 0-100
    orbitalCongestionIncrease: float  # Percentage increase
    secondaryDebrisProbability: float  # 0-100
    confidenceLevel: float  # 0-100
    explanation: str
    recommendations: List[str]

class AIRiskPredictionRequest(BaseModel):
    eventType: str  # "launch" | "adjustment" | "breakup"
    parameters: SimulationParameters

class AIRiskPredictionResponse(BaseModel):
    riskAssessmentId: str
    collisionRiskScore: float  # Scale of 1-10
    congestionRiskScore: float  # Scale of 1-10
    longTermImpactScore: float  # Scale of 1-10
    riskFactors: List[dict]
    mitigationStrategies: List[str]


class RetrainRequest(BaseModel):
    trainingData: List[dict]
    targetVariable: str  # Which target to train for: 'collision', 'congestion', or 'debris'


class RealTimePredictionRequest(BaseModel):
    parameters: SimulationParameters
    currentState: SimulationState
    userId: str
    userHistory: List[dict]  # Previous simulation data for personalization
    environmentalFactors: dict  # Real-time space weather, debris, etc.
    timeHorizon: int = 24  # Hours into the future to predict


class PersonalizedRecommendationRequest(BaseModel):
    userId: str
    currentScenario: dict
    userPreferences: dict
    simulationHistory: List[dict]
    skillLevel: str  # beginner, intermediate, expert
    riskTolerance: str  # conservative, moderate, aggressive

# Global variables for models
random_forest_model = None
linear_model = None
lstm_model = None
debris_prediction_model = None
rl_model = None

def initialize_models():
    """Initialize ML models with synthetic training data"""
    global random_forest_model, linear_model, lstm_model, debris_prediction_model, rl_model
    
    logger.info("Initializing AI models with synthetic training data...")
    
    # Try to load saved models first
    try:
        random_forest_model = joblib.load('models/random_forest_model.pkl')
        linear_model = joblib.load('models/linear_model.pkl')
        logger.info("Loaded saved models successfully")
        return
    except FileNotFoundError:
        logger.info("Saved models not found, training new models...")
    except Exception as e:
        logger.warning(f"Failed to load saved models: {str(e)}, training new models...")
    
    # Generate synthetic training data
    np.random.seed(42)  # For reproducible results
    
    # Create realistic synthetic data for space traffic
    n_samples = 1000
    
    # Features: altitude, inclination, velocity, mass, objects_in_orbit, congestion_level
    altitude = np.random.uniform(200, 2000, n_samples)  # km
    inclination = np.random.uniform(0, 180, n_samples)  # degrees
    velocity = np.random.uniform(6, 8, n_samples)  # km/s (typical orbital velocities)
    mass = np.random.uniform(100, 5000, n_samples)  # kg
    
    # Derived features
    objects_in_orbit = np.random.randint(1000, 5000, n_samples)
    congestion_level = np.random.uniform(0, 1, n_samples)
    
    # Combine features
    X = np.column_stack([
        altitude,
        inclination,
        velocity,
        mass,
        objects_in_orbit,
        congestion_level
    ])
    
    # Target variables (synthetic but realistic relationships)
    # Collision risk increases with congestion and mass, decreases with altitude
    collision_risk = (
        0.3 * congestion_level +
        0.2 * (mass / 5000) +
        0.1 * (1 - altitude / 2000) +
        0.1 * np.random.normal(0, 0.1, n_samples)
    )
    
    # Congestion increase depends on objects added and current congestion
    congestion_increase = (
        0.4 * (objects_in_orbit / 5000) +
        0.3 * congestion_level +
        0.2 * (mass / 5000) +
        0.1 * np.random.normal(0, 0.1, n_samples)
    )
    
    # Debris probability increases with mass and velocity (kinetic energy)
    debris_probability = (
        0.5 * (mass / 5000) +
        0.3 * ((velocity - 6) / 2) +
        0.2 * np.random.normal(0, 0.1, n_samples)
    )
    
    # Clip to valid ranges
    collision_risk = np.clip(collision_risk, 0, 1)
    congestion_increase = np.clip(congestion_increase, 0, 1)
    debris_probability = np.clip(debris_probability, 0, 1)
    
    # Train Random Forest model
    random_forest_model = RandomForestRegressor(
        n_estimators=100,
        max_depth=10,
        min_samples_split=5,
        min_samples_leaf=2,
        random_state=42,
        n_jobs=-1
    )
    
    # For simplicity, we'll train one model to predict all targets
    # In a real implementation, we'd have separate models for each target
    y_combined = np.column_stack([
        collision_risk,
        congestion_increase,
        debris_probability
    ])
    
    random_forest_model.fit(X, y_combined)
    
    # Train Linear Regression model as baseline
    linear_model = LinearRegression()
    linear_model.fit(X, y_combined)
    
    # Save models for future use
    try:
        import os
        os.makedirs('models', exist_ok=True)
        joblib.dump(random_forest_model, 'models/random_forest_model.pkl')
        joblib.dump(linear_model, 'models/linear_model.pkl')
        logger.info("Models saved successfully")
    except Exception as e:
        logger.warning(f"Failed to save models: {str(e)}")
    
    # Create LSTM model for trajectory prediction
    try:
        lstm_model = Sequential([
            LSTM(50, activation='relu', input_shape=(10, 6)),  # 10 time steps, 6 features
            Dropout(0.2),
            Dense(3)  # Predict 3 targets
        ])
        lstm_model.compile(optimizer=Adam(learning_rate=0.001), loss='mse')
        
        # Create synthetic sequential data for LSTM training
        # Reshape data for LSTM (samples, time_steps, features)
        X_lstm = np.zeros((n_samples-10, 10, 6))
        y_lstm = np.zeros((n_samples-10, 3))
        
        for i in range(n_samples-10):
            X_lstm[i] = X[i:i+10]
            y_lstm[i] = y_combined[i+10]
        
        # Train LSTM model (with dummy data since we don't have real sequential data)
        # In a real implementation, this would be trained on actual trajectory data
        lstm_model.fit(X_lstm, y_lstm, epochs=1, verbose=0)  # Just 1 epoch for demo
        
        logger.info("LSTM model initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize LSTM model: {str(e)}")
        lstm_model = None
    
    # Create debris prediction model
    try:
        debris_prediction_model = Sequential([
            Dense(64, activation='relu', input_shape=(6,)),
            Dropout(0.3),
            Dense(32, activation='relu'),
            Dropout(0.3),
            Dense(16, activation='relu'),
            Dense(1, activation='sigmoid')
        ])
        debris_prediction_model.compile(optimizer=Adam(learning_rate=0.001), loss='binary_crossentropy', metrics=['accuracy'])
        
        # Create synthetic binary target for debris (0 = no debris, 1 = debris)
        debris_target = (debris_probability > 0.5).astype(int)
        
        # Train debris prediction model
        debris_prediction_model.fit(X, debris_target, epochs=5, batch_size=32, verbose=0)
        
        logger.info("Debris prediction model initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize debris prediction model: {str(e)}")
        debris_prediction_model = None
    
    # Initialize reinforcement learning model for traffic control
    if RL_AVAILABLE:
        try:
            # Create a simple environment for demonstration
            # In a real implementation, this would be a complex space traffic environment
            from gym import Env
            from gym.spaces import Box, Discrete
            
            class SimpleTrafficEnv(Env):
                def __init__(self):
                    super(SimpleTrafficEnv, self).__init__()
                    self.action_space = Discrete(3)  # 0: do nothing, 1: increase altitude, 2: change inclination
                    self.observation_space = Box(low=0, high=1, shape=(6,), dtype=np.float32)
                    self.state = np.random.rand(6)
                    self.step_count = 0
                
                def step(self, action):
                    # Simplified reward function
                    reward = -np.sum(np.abs(self.state - 0.5))  # Reward for being close to optimal state
                    self.step_count += 1
                    done = self.step_count >= 100
                    
                    # Update state based on action
                    if action == 1:  # Increase altitude
                        self.state[0] = min(1.0, self.state[0] + 0.1)
                    elif action == 2:  # Change inclination
                        self.state[1] = np.abs(self.state[1] - 0.1)
                    
                    return self.state, reward, done, {}
                
                def reset(self):
                    self.state = np.random.rand(6)
                    self.step_count = 0
                    return self.state
            
            # Create and train RL model
            env = SimpleTrafficEnv()
            rl_model = PPO("MlpPolicy", env, verbose=0)
            # Train for a few steps (in reality, this would be much more)
            rl_model.learn(total_timesteps=100)
            
            logger.info("Reinforcement learning model initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize RL model: {str(e)}")
            rl_model = None
    else:
        rl_model = None
        logger.info("RL model not available due to missing dependencies")
    
    logger.info("All AI models initialized successfully")

def prepare_features(simulation_data):
    """Prepare features for model prediction"""
    # Extract features from simulation data
    features = np.array([
        simulation_data.get('altitude', 500),
        simulation_data.get('inclination', 45),
        simulation_data.get('velocity', 7.8),
        simulation_data.get('mass', 1000),
        simulation_data.get('objectsInLEO', 3000) + 
        simulation_data.get('objectsInMEO', 500) + 
        simulation_data.get('objectsInGEO', 2000),
        simulation_data.get('averageCongestion', 0.5)
    ]).reshape(1, -1)
    
    return features

def generate_explanation(collision_risk, congestion_increase, debris_probability, parameters):
    """Generate natural language explanation of results"""
    explanations = []
    
    if collision_risk > 0.7:
        explanations.append(f"High collision risk ({collision_risk*100:.1f}%) due to proximity to existing satellites.")
    elif collision_risk > 0.4:
        explanations.append(f"Moderate collision risk ({collision_risk*100:.1f}%) from orbital overlap.")
    else:
        explanations.append(f"Low collision risk ({collision_risk*100:.1f}%) - good orbital spacing.")
    
    if congestion_increase > 0.3:
        explanations.append(f"Significant congestion increase ({congestion_increase*100:.1f}%) in this orbital band.")
    elif congestion_increase > 0.1:
        explanations.append(f"Moderate congestion increase ({congestion_increase*100:.1f}%).")
    else:
        explanations.append(f"Minimal congestion impact ({congestion_increase*100:.1f}%).")
    
    if debris_probability > 0.5:
        explanations.append(f"High debris generation probability ({debris_probability*100:.1f}%) if fragmentation occurs.")
    elif debris_probability > 0.2:
        explanations.append(f"Moderate debris risk ({debris_probability*100:.1f}%) from this object.")
    else:
        explanations.append(f"Low debris generation risk ({debris_probability*100:.1f}%).")
    
    # Add parameter-specific insights
    if parameters.altitude < 300:
        explanations.append("Very low altitude increases atmospheric drag and reentry risk.")
    elif parameters.altitude > 1000:
        explanations.append("High altitude reduces drag but increases collision risk with other satellites.")
    
    if parameters.inclination > 70 and parameters.inclination < 110:
        explanations.append("Polar orbit inclination increases ground coverage but crosses many orbital planes.")
    
    if parameters.mass > 3000:
        explanations.append(f"Heavy satellite ({parameters.mass}kg) poses greater risk if fragmented.")
    
    return " ".join(explanations)

def generate_recommendations(collision_risk, congestion_increase, parameters):
    """Generate actionable recommendations"""
    recommendations = []
    
    if collision_risk > 0.6:
        recommendations.append("Consider adjusting altitude by 20-50km to reduce object density.")
        recommendations.append("Modify inclination by 3-5 degrees to avoid peak congestion zones.")
    
    if congestion_increase > 0.2:
        recommendations.append("Schedule launch during a less congested orbital slot.")
        recommendations.append("Consider coordinated maneuvers with nearby satellites.")
    
    if parameters.altitude < 400:
        recommendations.append("Plan for more frequent orbit maintenance due to atmospheric drag.")
    
    if parameters.mass > 2000:
        recommendations.append("Implement enhanced debris mitigation measures during end-of-life.")
    
    # Always provide some recommendations
    if len(recommendations) == 0:
        recommendations.append("Monitor orbital environment regularly for conjunctions.")
        recommendations.append("Maintain up-to-date orbital data for collision avoidance.")
        recommendations.append("Follow international space sustainability guidelines.")
    
    return recommendations

def analyze_user_preferences(user_history):
    """Analyze user's preferred strategies from simulation history"""
    preferences = {
        "preferred_altitudes": [],
        "risk_tolerance": "moderate",
        "favorite_scenarios": [],
        "success_patterns": []
    }
    
    # Extract altitude preferences
    for sim in user_history:
        if 'parameters' in sim and 'altitude' in sim['parameters']:
            preferences["preferred_altitudes"].append(sim['parameters']['altitude'])
    
    # Determine risk tolerance based on past simulations
    high_risk_count = sum(1 for sim in user_history if sim.get('aiAnalysis', {}).get('collisionRiskPercentage', 0) > 50)
    low_risk_count = sum(1 for sim in user_history if sim.get('aiAnalysis', {}).get('collisionRiskPercentage', 100) < 30)
    
    if high_risk_count > len(user_history) * 0.6:
        preferences["risk_tolerance"] = "aggressive"
    elif low_risk_count > len(user_history) * 0.6:
        preferences["risk_tolerance"] = "conservative"
    else:
        preferences["risk_tolerance"] = "moderate"
    
    return preferences

def personalize_recommendations(base_recommendations, user_preferences):
    """Personalize recommendations based on user preferences"""
    personalized = base_recommendations.copy()
    
    # Adjust recommendations based on user's risk tolerance
    if user_preferences["risk_tolerance"] == "conservative":
        # Add more cautious recommendations
        personalized.append("Conservative approach: Consider additional safety margins in your orbital parameters.")
        personalized.append("Conservative approach: Schedule extra monitoring passes for critical conjunctions.")
    elif user_preferences["risk_tolerance"] == "aggressive":
        # Add efficiency-focused recommendations
        personalized.append("Aggressive approach: Optimize for fuel efficiency while maintaining acceptable risk levels.")
        personalized.append("Aggressive approach: Consider consolidating maneuvers to reduce operational overhead.")
    
    return personalized

def assess_environmental_impact(environmental_factors):
    """Assess impact of environmental factors on space traffic"""
    impact = {
        "risk_multiplier": 1.0,
        "recommendations": []
    }
    
    # Check for geomagnetic storms
    if environmental_factors.get("geomagnetic_storm_severity", 0) > 5:
        impact["risk_multiplier"] = 1.3
        impact["recommendations"].append("Geomagnetic storm detected: Increased atmospheric drag may affect LEO satellites.")
        impact["recommendations"].append("Geomagnetic storm detected: Consider temporary altitude adjustments for LEO assets.")
    
    # Check for high solar radiation
    if environmental_factors.get("solar_radiation_level", 0) > 7:
        impact["risk_multiplier"] = 1.1
        impact["recommendations"].append("High solar radiation: Monitor satellite electronics for potential anomalies.")
    
    # Check for asteroid activity
    if environmental_factors.get("near_earth_objects", 0) > 3:
        impact["risk_multiplier"] = 1.2
        impact["recommendations"].append("Increased NEO activity: Enhanced conjunction monitoring recommended.")
    
    return impact

def analyze_user_behavior(simulation_history):
    """Analyze user behavior patterns from simulation history"""
    patterns = {
        "preferred_event_types": {},
        "common_parameters": {},
        "success_rate": 0,
        "learning_progression": []
    }
    
    # Count event type preferences
    for sim in simulation_history:
        event_type = sim.get('eventType', 'unknown')
        patterns["preferred_event_types"][event_type] = patterns["preferred_event_types"].get(event_type, 0) + 1
    
    # Calculate success rate (simplified)
    total_sims = len(simulation_history)
    if total_sims > 0:
        low_risk_sims = sum(1 for sim in simulation_history if sim.get('aiAnalysis', {}).get('collisionRiskPercentage', 100) < 40)
        patterns["success_rate"] = low_risk_sims / total_sims
    
    return patterns

def generate_personalized_recommendations(user_patterns, skill_level, risk_tolerance):
    """Generate personalized recommendations based on user patterns"""
    recommendations = []
    
    # Recommend based on preferred event types
    if user_patterns["preferred_event_types"]:
        most_common = max(user_patterns["preferred_event_types"].items(), key=lambda x: x[1])
        recommendations.append(f"You frequently simulate {most_common[0]} events. Try exploring other event types for a broader understanding.")
    
    # Skill-level specific recommendations
    if skill_level == "beginner":
        recommendations.extend([
            "Beginner tip: Focus on mastering LEO operations before moving to higher orbits.",
            "Beginner tip: Pay attention to the AI explanations to understand risk factors.",
            "Beginner tip: Start with low-mass satellites to minimize risk.",
            "Beginner tip: Use the recommendations panel to guide your parameter adjustments."
        ])
    elif skill_level == "intermediate":
        recommendations.extend([
            "Intermediate tip: Experiment with complex multi-satellite scenarios.",
            "Intermediate tip: Try optimizing for both safety and efficiency.",
            "Intermediate tip: Analyze the before/after comparisons to understand traffic impacts.",
            "Intermediate tip: Challenge yourself with high-inclination orbits."
        ])
    else:  # expert
        recommendations.extend([
            "Expert tip: Model complex constellation deployments.",
            "Expert tip: Investigate long-term sustainability scenarios.",
            "Expert tip: Explore advanced orbital mechanics concepts.",
            "Expert tip: Contribute your scenarios to the community gallery."
        ])
    
    # Risk tolerance specific recommendations
    if risk_tolerance == "conservative":
        recommendations.append("Conservative approach: Your simulations show preference for low-risk scenarios. Consider challenging yourself with moderate-risk scenarios to expand skills.")
    elif risk_tolerance == "aggressive":
        recommendations.append("Aggressive approach: Your simulations show willingness to accept higher risks. Ensure you're applying appropriate mitigation strategies.")
    
    return recommendations

def suggest_learning_path(user_patterns, skill_level):
    """Suggest a learning path based on user patterns and skill level"""
    if skill_level == "beginner":
        return ["LEO Fundamentals", "Collision Avoidance", "Basic Orbital Maneuvers", "Introduction to Debris Mitigation"]
    elif skill_level == "intermediate":
        return ["MEO and GEO Operations", "Constellation Design", "Advanced Risk Assessment", "Regulatory Compliance"]
    else:  # expert
        return ["Sustainability Engineering", "Traffic Optimization", "Advanced AI Applications", "Research and Development"]

def customize_for_scenario(current_scenario, user_preferences):
    """Customize recommendations for the current scenario"""
    recommendations = []
    
    # Scenario-specific advice
    event_type = current_scenario.get('eventType', 'launch')
    if event_type == 'launch':
        recommendations.append("Launch scenario: Ensure proper timing to avoid conjunctions with existing traffic.")
    elif event_type == 'adjustment':
        recommendations.append("Adjustment scenario: Consider fuel-efficient maneuvers to achieve objectives.")
    elif event_type == 'breakup':
        recommendations.append("Breakup scenario: Model worst-case fragmentation to understand cascading risks.")
    
    return recommendations

def get_skill_level_tips(skill_level):
    """Get tips appropriate for the user's skill level"""
    tips = []
    
    if skill_level == "beginner":
        tips = [
            "Tip: Use the slider controls to see how parameters affect risk in real-time.",
            "Tip: Review the leaderboard to see how your scores compare to others.",
            "Tip: Check the 3D visualization to understand spatial relationships."
        ]
    elif skill_level == "intermediate":
        tips = [
            "Tip: Compare your scenarios with historical data to benchmark performance.",
            "Tip: Experiment with different optimization strategies.",
            "Tip: Share interesting scenarios with the community."
        ]
    else:  # expert
        tips = [
            "Tip: Develop and test novel traffic management strategies.",
            "Tip: Contribute to the evolution of space sustainability practices.",
            "Tip: Mentor newcomers by sharing your expertise."
        ]
    
    return tips

@app.on_event("startup")
async def startup_event():
    """Initialize models when service starts"""
    initialize_models()

@app.post("/ai/simulate-impact", response_model=AISimulateImpactResponse)
async def simulate_impact(request: AISimulateImpactRequest):
    """
    Analyze simulation results and predict impacts on space traffic.
    
    This endpoint takes the results of a space traffic simulation and provides
    AI-powered analysis of collision risks, congestion impacts, and debris probabilities.
    """
    try:
        logger.info(f"Processing simulation impact for ID: {request.simulationId}")
        
        # Prepare features for prediction
        # Extract features from the request data
        # Since we don't have the original parameters, we'll use reasonable defaults
        # and derive some values from the state data
        features = prepare_features({
            'altitude': 500,  # Default altitude in km
            'inclination': 45,  # Default inclination in degrees
            'velocity': 7.8,  # Default velocity in km/s
            'mass': 1000,  # Default mass in kg
            'objectsInLEO': request.afterState.objectsInLEO,
            'objectsInMEO': request.afterState.objectsInMEO,
            'objectsInGEO': request.afterState.objectsInGEO,
            'averageCongestion': request.afterState.averageCongestion
        })
        
        # Make predictions using ensemble of models
        rf_pred_raw = random_forest_model.predict(features)
        rf_predictions = rf_pred_raw[0] if hasattr(rf_pred_raw, '__len__') and len(rf_pred_raw) > 0 else rf_pred_raw
        
        lr_pred_raw = linear_model.predict(features)
        lr_predictions = lr_pred_raw[0] if hasattr(lr_pred_raw, '__len__') and len(lr_pred_raw) > 0 else lr_pred_raw
        
        # Use LSTM model if available
        lstm_predictions = rf_predictions  # Default to RF if LSTM not available
        if lstm_model is not None:
            try:
                # Reshape for LSTM (1 sample, 10 time steps, 6 features)
                # For demo, we'll just repeat the features 10 times
                features_lstm = np.tile(features, (1, 1, 1))
                # Repeat to create 10 time steps
                features_lstm = np.repeat(features_lstm, 10, axis=1)
                lstm_pred = lstm_model.predict(features_lstm, verbose=0)
                # Handle different possible return shapes
                if len(lstm_pred.shape) > 1:
                    lstm_predictions = lstm_pred[0]
                else:
                    lstm_predictions = lstm_pred
            except Exception as e:
                logger.warning(f"LSTM prediction failed: {str(e)}")
        
        # Ensemble prediction (simple average)
        ensemble_predictions = (rf_predictions + lr_predictions + lstm_predictions) / 3
        
        # Handle case where predictions might be scalars or arrays
        if hasattr(ensemble_predictions, '__len__') and len(ensemble_predictions) > 1:
            pred_values = ensemble_predictions
        else:
            # If it's a scalar or single value, create array-like access
            pred_values = [ensemble_predictions] * 3
            
        # Extract predictions and ensure they are positive
        collision_risk_percentage = max(0.0, min(100.0, float(abs(pred_values[0]) * 100)))
        orbital_congestion_increase = max(0.0, min(100.0, float(abs(pred_values[1]) * 50)))
        secondary_debris_probability = max(0.0, min(100.0, float(abs(pred_values[2]) * 25)))
        
        # Use debris prediction model if available
        if debris_prediction_model is not None:
            try:
                debris_pred_raw = debris_prediction_model.predict(features, verbose=0)
                # Handle different possible return shapes
                if len(debris_pred_raw.shape) > 1 and debris_pred_raw.shape[1] > 0:
                    debris_prob = debris_pred_raw[0][0]
                elif len(debris_pred_raw.shape) > 0:
                    debris_prob = debris_pred_raw[0]
                else:
                    debris_prob = debris_pred_raw
                secondary_debris_probability = float(debris_prob * 100)
            except Exception as e:
                logger.warning(f"Debris prediction failed: {str(e)}")
        
        # Calculate confidence based on model agreement
        # Handle case where predictions might be scalars
        rf_val = rf_predictions if isinstance(rf_predictions, (int, float)) else rf_predictions[0] if hasattr(rf_predictions, '__len__') and len(rf_predictions) > 0 else 0
        lr_val = lr_predictions if isinstance(lr_predictions, (int, float)) else lr_predictions[0] if hasattr(lr_predictions, '__len__') and len(lr_predictions) > 0 else 0
        lstm_val = lstm_predictions if isinstance(lstm_predictions, (int, float)) else lstm_predictions[0] if hasattr(lstm_predictions, '__len__') and len(lstm_predictions) > 0 else 0
        
        model_std = np.std([rf_val, lr_val, lstm_val])
        confidence_level = max(70.0, 100.0 - model_std * 100)  # Higher agreement = higher confidence
        
        # Generate explanation and recommendations
        explanation = generate_explanation(
            ensemble_predictions, 
            ensemble_predictions, 
            ensemble_predictions, 
            SimulationParameters(
                altitude=500,  # Placeholder
                inclination=45,  # Placeholder
                velocity=7.8,  # Placeholder
                mass=1000,  # Placeholder
                launchTime="2025-01-01T00:00:00Z"  # Placeholder
            )
        )
        
        recommendations = generate_recommendations(
            ensemble_predictions, 
            ensemble_predictions, 
            SimulationParameters(
                altitude=500,  # Placeholder
                inclination=45,  # Placeholder
                velocity=7.8,  # Placeholder
                mass=1000,  # Placeholder
                launchTime="2025-01-01T00:00:00Z"  # Placeholder
            )
        )
        
        # Add RL-based recommendations if available
        if rl_model is not None:
            try:
                # Create observation from features (normalized)
                obs = np.clip(features.flatten() / np.array([2000, 180, 15, 10000, 10000, 1]), 0, 1)
                action, _ = rl_model.predict(obs)
                
                if action == 1:
                    recommendations.append("RL recommendation: Consider increasing altitude to reduce congestion.")
                elif action == 2:
                    recommendations.append("RL recommendation: Consider adjusting inclination to optimize traffic flow.")
            except Exception as e:
                logger.warning(f"RL recommendation failed: {str(e)}")
        
        response = AISimulateImpactResponse(
            predictionId=f"pred_{request.simulationId}",
            collisionRiskPercentage=collision_risk_percentage,
            orbitalCongestionIncrease=orbital_congestion_increase,
            secondaryDebrisProbability=secondary_debris_probability,
            confidenceLevel=confidence_level,
            explanation=explanation,
            recommendations=recommendations
        )
        
        logger.info(f"Successfully processed simulation impact for ID: {request.simulationId}")
        return response
        
    except Exception as e:
        logger.error(f"Error processing simulation impact: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/ai/predict-risk", response_model=AIRiskPredictionResponse)
async def predict_risk(request: AIRiskPredictionRequest):
    """
    Provide detailed risk assessment for a specific scenario.
    
    This endpoint analyzes the parameters of a proposed space activity
    and provides a detailed risk assessment with mitigation strategies.
    """
    try:
        logger.info(f"Processing risk prediction for event type: {request.eventType}")
        
        # Prepare features for prediction
        features = prepare_features({
            'altitude': request.parameters.altitude,
            'inclination': request.parameters.inclination,
            'velocity': request.parameters.velocity,
            'mass': request.parameters.mass,
            'objectsInLEO': 3000,  # Baseline
            'objectsInMEO': 500,   # Baseline
            'objectsInGEO': 2000,  # Baseline
            'averageCongestion': 0.5  # Baseline
        })
        
        # Make predictions using ensemble of models
        rf_predictions = random_forest_model.predict(features)[0]
        lr_predictions = linear_model.predict(features)[0]
        
        # Use LSTM model if available
        lstm_predictions = rf_predictions  # Default to RF if LSTM not available
        if lstm_model is not None:
            try:
                # Reshape for LSTM (1 sample, 10 time steps, 6 features)
                # For demo, we'll just repeat the features 10 times
                features_lstm = np.tile(features, (1, 1, 1))
                # Repeat to create 10 time steps
                features_lstm = np.repeat(features_lstm, 10, axis=1)
                lstm_pred = lstm_model.predict(features_lstm, verbose=0)[0]
                lstm_predictions = lstm_pred
            except Exception as e:
                logger.warning(f"LSTM prediction failed: {str(e)}")
        
        # Ensemble prediction (simple average)
        ensemble_predictions = (rf_predictions + lr_predictions + lstm_predictions) / 3
        
        # Convert to risk scores (1-10 scale) and ensure they are positive
        collision_risk_score = max(1.0, min(10.0, float(abs(ensemble_predictions[0]) * 10)))
        congestion_risk_score = max(1.0, min(10.0, float(abs(ensemble_predictions[1]) * 10)))
        long_term_impact_score = max(1.0, min(10.0, float(abs(ensemble_predictions[2]) * 10)))
        
        # Use debris prediction model if available for long-term impact
        if debris_prediction_model is not None:
            try:
                debris_prob = debris_prediction_model.predict(features, verbose=0)[0][0]
                long_term_impact_score = float(debris_prob * 10)
            except Exception as e:
                logger.warning(f"Debris prediction failed: {str(e)}")
        
        # Identify risk factors
        risk_factors = []
        
        if request.parameters.altitude < 400:
            risk_factors.append({
                "factor": "Low altitude",
                "severity": "high" if request.parameters.altitude < 300 else "medium",
                "description": f"{request.parameters.altitude}km altitude increases atmospheric drag"
            })
        
        if request.parameters.mass > 2000:
            risk_factors.append({
                "factor": "High mass",
                "severity": "high",
                "description": f"{request.parameters.mass}kg satellite poses greater fragmentation risk"
            })
        
        # Generate mitigation strategies
        mitigation_strategies = generate_recommendations(
            ensemble_predictions[0], 
            ensemble_predictions[1], 
            request.parameters
        )
        
        # Add RL-based mitigation strategies if available
        if rl_model is not None:
            try:
                # Create observation from features (normalized)
                obs = np.clip(features.flatten() / np.array([2000, 180, 15, 10000, 10000, 1]), 0, 1)
                action, _ = rl_model.predict(obs)
                
                if action == 1:
                    mitigation_strategies.append("RL suggestion: Increase altitude to reduce risk.")
                elif action == 2:
                    mitigation_strategies.append("RL suggestion: Adjust inclination to minimize congestion.")
            except Exception as e:
                logger.warning(f"RL mitigation strategy failed: {str(e)}")
        
        response = AIRiskPredictionResponse(
            riskAssessmentId=f"risk_{hash(str(request.parameters))}",
            collisionRiskScore=collision_risk_score,
            congestionRiskScore=congestion_risk_score,
            longTermImpactScore=long_term_impact_score,
            riskFactors=risk_factors,
            mitigationStrategies=mitigation_strategies
        )
        
        logger.info(f"Successfully processed risk prediction for event type: {request.eventType}")
        return response
        
    except Exception as e:
        logger.error(f"Error processing risk prediction: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "Space Traffic Simulator AI Service"}

@app.get("/")
async def root():
    """Root endpoint with service information"""
    return {
        "message": "Space Traffic Simulator AI Service",
        "version": "1.0.0",
        "endpoints": [
            "POST /ai/simulate-impact",
            "POST /ai/predict-risk",
            "POST /ai/retrain",
            "POST /ai/real-time-prediction",
            "POST /ai/personalized-recommendations",
            "GET /health"
        ]
    }


@app.post("/ai/retrain")
async def retrain_models(request: RetrainRequest):
    """Retrain models with new data"""
    global random_forest_model, linear_model
    
    try:
        logger.info(f"Retraining models with {len(request.trainingData)} samples for target: {request.targetVariable}")
        
        # Convert training data to numpy arrays
        X = np.array([[d['altitude'], d['inclination'], d['velocity'], d['mass'], 
                      d['objectsInLEO'], d['averageCongestion']] for d in request.trainingData])
        
        # Select target variable
        target_map = {
            'collision': 'collisionRisk',
            'congestion': 'congestionIncrease',
            'debris': 'debrisProbability'
        }
        
        if request.targetVariable not in target_map:
            raise ValueError(f"Invalid target variable: {request.targetVariable}")
        
        y = np.array([d[target_map[request.targetVariable]] for d in request.trainingData])
        
        # Retrain models
        random_forest_model.fit(X, y)
        linear_model.fit(X, y)
        
        # Save updated models
        try:
            import os
            os.makedirs('models', exist_ok=True)
            joblib.dump(random_forest_model, 'models/random_forest_model.pkl')
            joblib.dump(linear_model, 'models/linear_model.pkl')
            logger.info("Retrained models saved successfully")
        except Exception as e:
            logger.warning(f"Failed to save retrained models: {str(e)}")
        
        return {
            "success": True,
            "message": f"Models successfully retrained for {request.targetVariable} prediction",
            "samplesUsed": len(request.trainingData)
        }
        
    except Exception as e:
        logger.error(f"Error retraining models: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to retrain models: {str(e)}")

@app.post("/ai/real-time-prediction")
async def real_time_prediction(request: RealTimePredictionRequest):
    """
    Provide real-time predictive analytics based on current parameters and user history.
    
    This endpoint analyzes the current space traffic situation and provides immediate
    predictions for collision risks, congestion impacts, and debris probabilities.
    """
    try:
        logger.info(f"Processing real-time prediction for user: {request.userId}")
        
        # Prepare features for prediction
        try:
            features = prepare_features({
                'altitude': request.parameters.altitude,
                'inclination': request.parameters.inclination,
                'velocity': request.parameters.velocity,
                'mass': request.parameters.mass,
                'objectsInLEO': request.currentState.objectsInLEO,
                'objectsInMEO': request.currentState.objectsInMEO,
                'objectsInGEO': request.currentState.objectsInGEO,
                'averageCongestion': request.currentState.averageCongestion
            })
            logger.info(f"Features prepared successfully")
        except Exception as e:
            logger.error(f"Error preparing features: {str(e)}")
            raise
        
        logger.info(f"Features prepared: {features}")
        logger.info(f"Features shape: {features.shape}")
        
        # Make predictions using ensemble of models
        rf_pred_raw = random_forest_model.predict(features)
        rf_predictions = rf_pred_raw[0] if hasattr(rf_pred_raw, '__len__') and len(rf_pred_raw) > 0 else rf_pred_raw
        
        lr_pred_raw = linear_model.predict(features)
        lr_predictions = lr_pred_raw[0] if hasattr(lr_pred_raw, '__len__') and len(lr_pred_raw) > 0 else lr_pred_raw
        
        logger.info(f"RF predictions: {rf_predictions}")
        logger.info(f"LR predictions: {lr_predictions}")
        
        # Use LSTM model if available
        lstm_predictions = rf_predictions  # Default to RF if LSTM not available
        if lstm_model is not None:
            try:
                # Reshape for LSTM (1 sample, 10 time steps, 6 features)
                # For demo, we'll just repeat the features 10 times
                features_lstm = np.tile(features, (1, 1, 1))
                # Repeat to create 10 time steps
                features_lstm = np.repeat(features_lstm, 10, axis=1)
                lstm_pred = lstm_model.predict(features_lstm, verbose=0)[0]
                lstm_predictions = lstm_pred
            except Exception as e:
                logger.warning(f"LSTM prediction failed: {str(e)}")
        
        # Ensemble prediction (simple average)
        ensemble_predictions = (rf_predictions + lr_predictions + lstm_predictions) / 3
        
        # Extract predictions and ensure they are positive
        collision_risk_percentage = max(0.0, min(100.0, float(abs(ensemble_predictions[0]) * 100)))
        orbital_congestion_increase = max(0.0, min(100.0, float(abs(ensemble_predictions[1]) * 50)))
        secondary_debris_probability = max(0.0, min(100.0, float(abs(ensemble_predictions[2]) * 25)))
        
        # Use debris prediction model if available
        if debris_prediction_model is not None:
            try:
                debris_prob = debris_prediction_model.predict(features, verbose=0)[0][0]
                secondary_debris_probability = float(debris_prob * 100)
            except Exception as e:
                logger.warning(f"Debris prediction failed: {str(e)}")
        
        # Calculate confidence based on model agreement
        model_std = np.std([rf_predictions, lr_predictions, lstm_predictions])
        confidence_level = max(70.0, 100.0 - model_std * 100)  # Higher agreement = higher confidence
        
        # Generate explanation and recommendations
        explanation = generate_explanation(
            ensemble_predictions[0], 
            ensemble_predictions[1], 
            ensemble_predictions[2], 
            request.parameters
        )
        
        recommendations = generate_recommendations(
            ensemble_predictions[0], 
            ensemble_predictions[1], 
            request.parameters
        )
        
        # Add RL-based recommendations if available
        if rl_model is not None:
            try:
                # Create observation from features (normalized)
                obs = np.clip(features.flatten() / np.array([2000, 180, 15, 10000, 10000, 1]), 0, 1)
                action, _ = rl_model.predict(obs)
                
                if action == 1:
                    recommendations.append("RL recommendation: Consider increasing altitude to reduce congestion.")
                elif action == 2:
                    recommendations.append("RL recommendation: Consider adjusting inclination to optimize traffic flow.")
            except Exception as e:
                logger.warning(f"RL recommendation failed: {str(e)}")
        
        # Personalize recommendations based on user history
        if len(request.userHistory) > 0:
            # Extract user's preferred strategies from history
            user_preferences = analyze_user_preferences(request.userHistory)
            personalized_recommendations = personalize_recommendations(recommendations, user_preferences)
            recommendations = personalized_recommendations
        
        # Consider environmental factors if provided
        if request.environmentalFactors:
            environmental_impact = assess_environmental_impact(request.environmentalFactors)
            collision_risk_percentage *= environmental_impact.get('risk_multiplier', 1.0)
            recommendations.extend(environmental_impact.get('recommendations', []))
        
        # Ensure values stay within bounds
        collision_risk_percentage = max(0.0, min(100.0, collision_risk_percentage))
        
        return {
            "predictionId": f"realtime_{hash(str(request.parameters))}",
            "timestamp": datetime.utcnow().isoformat(),
            "collisionRiskPercentage": collision_risk_percentage,
            "orbitalCongestionIncrease": orbital_congestion_increase,
            "secondaryDebrisProbability": secondary_debris_probability,
            "confidenceLevel": confidence_level,
            "explanation": explanation,
            "recommendations": recommendations,
            "timeHorizonHours": request.timeHorizon
        }
        
    except Exception as e:
        logger.error(f"Error processing real-time prediction: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/ai/personalized-recommendations")
async def personalized_recommendations_endpoint(request: PersonalizedRecommendationRequest):
    """
    Provide personalized recommendations based on user history and preferences.
    
    This endpoint analyzes a user's simulation history, skill level, and risk tolerance
    to provide tailored recommendations for space traffic management.
    """
    try:
        logger.info(f"Generating personalized recommendations for user: {request.userId}")
        
        # Analyze user's simulation history
        if len(request.simulationHistory) == 0:
            # New user - provide beginner-friendly recommendations
            recommendations = [
                "Welcome to Space Traffic Simulator! Start with simple LEO missions.",
                "Focus on minimizing collision risks in your early simulations.",
                "Try different altitudes to see how they affect orbital congestion.",
                "Review the AI explanations to learn about space traffic dynamics."
            ]
            learning_path = ["LEO Basics", "Collision Avoidance", "Orbital Mechanics"]
        else:
            # Experienced user - analyze patterns
            user_patterns = analyze_user_behavior(request.simulationHistory)
            recommendations = generate_personalized_recommendations(
                user_patterns, 
                request.skillLevel, 
                request.riskTolerance
            )
            learning_path = suggest_learning_path(user_patterns, request.skillLevel)
        
        # Customize recommendations based on current scenario
        scenario_specific = customize_for_scenario(
            request.currentScenario, 
            request.userPreferences
        )
        recommendations.extend(scenario_specific)
        
        # Add skill-level appropriate tips
        skill_tips = get_skill_level_tips(request.skillLevel)
        recommendations.extend(skill_tips)
        
        return {
            "recommendationId": f"personalized_{request.userId}_{int(datetime.utcnow().timestamp())}",
            "userId": request.userId,
            "timestamp": datetime.utcnow().isoformat(),
            "recommendations": recommendations,
            "learningPath": learning_path,
            "skillLevel": request.skillLevel,
            "riskTolerance": request.riskTolerance
        }
        
    except Exception as e:
        logger.error(f"Error generating personalized recommendations: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

if __name__ == "__main__":
    # Run the service
    uvicorn.run(
        "ai_service:app",
        host=os.getenv("AI_SERVICE_HOST", "127.0.0.1"),
        port=int(os.getenv("AI_SERVICE_PORT", 8001)),
        reload=os.getenv("AI_SERVICE_DEBUG", "false").lower() == "true"
    )
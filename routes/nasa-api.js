/**
 * NASA API Integration Module
 * 
 * This module provides integration with NASA APIs for real-time satellite tracking
 * and space weather data to enhance the Space Traffic Simulator.
 */

const axios = require('axios');
require('dotenv').config();
const { getCelesTrakCounts } = require('./celestrak');

// NASA API configuration
const NASA_API_BASE_URL = 'https://api.nasa.gov';
const NASA_API_KEY = process.env.NASA_API_KEY;

/**
 * Get satellite positions from NASA API
 * @param {string} satId - Satellite NORAD ID
 * @returns {Promise<Object>} Satellite position data
 */
async function getSatellitePosition(satId) {
    try {
        if (!NASA_API_KEY) {
            throw new Error('NASA API key not configured');
        }

        // For demonstration purposes, we'll use a mock response since the actual API
        // for satellite tracking might require different endpoints or authentication
        const response = await axios.get(`${NASA_API_BASE_URL}/satellites/${satId}`, {
            params: {
                api_key: NASA_API_KEY
            }
        });

        return response.data;
    } catch (error) {
        console.error('Error fetching satellite position:', error.message);
        throw error;
    }
}

/**
 * Get space weather data from NASA API
 * @returns {Promise<Object>} Space weather data
 */
async function getSpaceWeatherData() {
    try {
        if (!NASA_API_KEY) {
            throw new Error('NASA API key not configured');
        }

        // NASA Space Weather API endpoint
        // First try with last 7 days
        let response = await axios.get(`${NASA_API_BASE_URL}/DONKI/GST`, {
            params: {
                api_key: NASA_API_KEY,
                startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Last 7 days
                endDate: new Date().toISOString().split('T')[0]
            }
        });

        // If no recent data, try with last 30 days
        if (Array.isArray(response.data) && response.data.length === 0) {
            response = await axios.get(`${NASA_API_BASE_URL}/DONKI/GST`, {
                params: {
                    api_key: NASA_API_KEY,
                    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Last 30 days
                    endDate: new Date().toISOString().split('T')[0]
                }
            });
        }

        // Return data as array if it's not already
        // Handle case where NASA API returns an empty array
        if (Array.isArray(response.data)) {
            return response.data;
        } else {
            // If it's an object, wrap it in an array
            return response.data ? [response.data] : [];
        }
    } catch (error) {
        console.error('Error fetching space weather data:', error.message);
        throw error;
    }
}

/**
 * Get near-Earth asteroid data from NASA API
 * @returns {Promise<Object>} Asteroid data
 */
async function getAsteroidData() {
    try {
        if (!NASA_API_KEY) {
            throw new Error('NASA API key not configured');
        }

        // NASA Asteroid API endpoint
        const response = await axios.get(`${NASA_API_BASE_URL}/neo/rest/v1/feed`, {
            params: {
                api_key: NASA_API_KEY,
                start_date: new Date().toISOString().split('T')[0],
                end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] // Next 7 days
            }
        });

        return response.data;
    } catch (error) {
        console.error('Error fetching asteroid data:', error.message);
        throw error;
    }
}

/**
 * Process satellite data for integration with our simulator
 * @param {Object} satelliteData - Raw satellite data from NASA API
 * @returns {Object} Processed satellite data compatible with our simulator
 */
function processSatelliteData(satelliteData) {
    // This is a simplified example - in reality, we'd need to convert
    // the satellite data format to match our simulator's expectations
    return {
        id: satelliteData.satelliteId || 'unknown',
        name: satelliteData.name || 'Unnamed Satellite',
        position: {
            x: satelliteData.position?.x || 0,
            y: satelliteData.position?.y || 0,
            z: satelliteData.position?.z || 0
        },
        velocity: {
            vx: satelliteData.velocity?.x || 0,
            vy: satelliteData.velocity?.y || 0,
            vz: satelliteData.velocity?.z || 0
        },
        altitude: satelliteData.altitude || 0,
        inclination: satelliteData.inclination || 0,
        timestamp: satelliteData.timestamp || new Date().toISOString()
    };
}

/**
 * Apply space weather effects to orbital mechanics
 * @param {Object} orbitalParameters - Current orbital parameters
 * @param {Object} spaceWeatherData - Space weather data from NASA
 * @returns {Object} Adjusted orbital parameters
 */
function applySpaceWeatherEffects(orbitalParameters, spaceWeatherData) {
    // This is a simplified example of how space weather might affect orbits
    // In reality, this would be much more complex
    
    // Extract relevant space weather parameters
    const geomagneticStorm = spaceWeatherData.geomagneticStorm || {};
    const solarWind = spaceWeatherData.solarWind || {};
    
    // Apply atmospheric drag effects based on space weather
    const stormIntensity = geomagneticStorm.intensity || 0;
    const solarWindSpeed = solarWind.speed || 400; // km/s default
    
    // Adjust orbital parameters based on space weather
    const adjustedParameters = { ...orbitalParameters };
    
    // Increase atmospheric drag during geomagnetic storms
    if (stormIntensity > 50) { // Strong storm
        adjustedParameters.dragCoefficient *= 1.5;
    } else if (stormIntensity > 30) { // Moderate storm
        adjustedParameters.dragCoefficient *= 1.2;
    }
    
    // Solar wind effects on satellite attitude (simplified)
    adjustedParameters.solarRadiationPressure = solarWindSpeed / 1000;
    
    return adjustedParameters;
}

module.exports = {
    getSatellitePosition,
    getSpaceWeatherData,
    getAsteroidData,
    processSatelliteData,
    applySpaceWeatherEffects,
    getCelesTrakCounts
};
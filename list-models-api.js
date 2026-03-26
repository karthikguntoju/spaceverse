// Test to list available models via direct API call
const axios = require('axios');
require('dotenv').config();

async function listModelsViaAPI() {
  try {
    console.log('Attempting to list models via direct API call...');
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('GEMINI_API_KEY is not set');
      return;
    }
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    
    try {
      const response = await axios.get(url);
      console.log('Available models:', JSON.stringify(response.data, null, 2));
    } catch (error) {
      console.error('Error listing models via API:', error.response?.data || error.message);
    }
  } catch (error) {
    console.error('General error:', error.message);
  }
}

listModelsViaAPI();
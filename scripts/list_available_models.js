import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/env.js';

async function listModels() {
  if (!config.geminiApiKey) {

    return;
  }

  try {

    const genAI = new GoogleGenerativeAI(config.geminiApiKey);

    // Note: listModels() is available on the client instance in newer versions, 
    // or we can use the API directly if the SDK is older/different. 
    // We'll try the SDK method first if it exists, otherwise HTTP.

    // Direct HTTP fallback for certainty
    const key = config.geminiApiKey;
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    const data = await resp.json();

    if (data.models) {

      data.models.forEach((m) => {
        if (m.supportedGenerationMethods?.includes('generateContent')) {

        }
      });
    } else {

    }

  } catch (error) {

  }
}

listModels();
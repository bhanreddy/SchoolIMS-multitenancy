import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/env.js';

async function listModels() {
    if (!config.geminiApiKey) {
        console.error('❌ Skipping: GEMINI_API_KEY not found in env');
        return;
    }

    try {
        console.log('--- LISTING GEMINI MODELS ---');
        const genAI = new GoogleGenerativeAI(config.geminiApiKey);

        // Note: listModels() is available on the client instance in newer versions, 
        // or we can use the API directly if the SDK is older/different. 
        // We'll try the SDK method first if it exists, otherwise HTTP.

        // Direct HTTP fallback for certainty
        const key = config.geminiApiKey;
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        const data = await resp.json();

        if (data.models) {
            console.log('✅ AVAILABLE MODELS:');
            data.models.forEach(m => {
                if (m.supportedGenerationMethods?.includes('generateContent')) {
                    console.log(`* ${m.name.replace('models/', '')}`);
                }
            });
        } else {
            console.error('❌ Failed to list models:', JSON.stringify(data));
        }

    } catch (error) {
        console.error('❌ Error:', error);
    }
}

listModels();

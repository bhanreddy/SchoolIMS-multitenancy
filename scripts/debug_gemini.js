import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/env.js';

async function debugGemini() {
    console.log('--- DEBUGGING GEMINI ---');
    console.log('API Key present:', !!config.geminiApiKey);

    if (!config.geminiApiKey) {
        console.error('❌ GEMINI_API_KEY is missing');
        return;
    }

    try {
        const genAI = new GoogleGenerativeAI(config.geminiApiKey);
        // Note: listModels is on the genAI instance or via the API directly. 
        // The SDK structure varies slightly by version, but let's try to just generate content with a fallback chain.

        const modelsToTry = [
            "gemini-1.5-flash",
            "gemini-1.5-flash-001",
            "gemini-1.5-pro",
            "gemini-pro",
            "gemini-1.0-pro"
        ];

        for (const modelName of modelsToTry) {
            console.log(`\nTesting model: ${modelName}...`);
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent("Hi");
                console.log(`✅ SUCCESS with ${modelName}!`);
                console.log('Response:', result.response.text());
                return; // Stop after first success
            } catch (error) {
                console.log(`❌ Failed ${modelName}: ${error.message.split('\n')[0]}`);
            }
        }

        console.log('\n❌ ALL MODELS FAILED.');

    } catch (error) {
        console.error('CRITICAL ERROR:', error);
    }
}

debugGemini();

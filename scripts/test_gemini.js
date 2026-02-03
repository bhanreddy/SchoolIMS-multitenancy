import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/env.js';

async function listModels() {
    if (!config.geminiApiKey) {
        console.error('❌ Skipping: GEMINI_API_KEY not found in env');
        return;
    }

    try {
        console.log('--- LISTING GEMINI MODELS ---');
        // Hack: The Node SDK doesn't expose listModels easily on the main class in some versions,
        // but let's try a direct fetch if the SDK fails, or just try a standard known model.
        // Actually, let's just test if gemini-1.5-flash-001" works.

        const genAI = new GoogleGenerativeAI(config.geminiApiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash-001"
        });

        console.log('Testing gemini-1.5-flash-001...');
        const result = await model.generateContent("Hello");
        console.log('✅ Success! Response:', result.response.text());

    } catch (error) {
        console.error('❌ Error:', error.message);

        console.log('\nTesting gemini-1.5-flash-001...');
        try {
            const genAI = new GoogleGenerativeAI(config.geminiApiKey);
            const model = genAI.getGenerativeModel({
                model: "gemini-1.5-flash-001"
            });
            const result = await model.generateContent("Hello");
            console.log('✅ Success with gemini-1.5-flash-001', result.response.text());
        } catch (e) {
            console.error('❌ Error with gemini-1.5-flash-001:', e.message);
        }
    }
}

listModels();

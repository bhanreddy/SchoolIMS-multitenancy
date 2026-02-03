import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/env.js';

async function findWorkingModel() {
    if (!config.geminiApiKey) {
        console.error('❌ Skipping: GEMINI_API_KEY not found in env');
        return;
    }

    const genAI = new GoogleGenerativeAI(config.geminiApiKey);

    const candidates = [
        "gemini-2.0-flash-exp",
        "gemini-1.5-flash",
        "gemini-1.5-flash-latest",
        "gemini-1.5-flash-001",
        "gemini-1.5-pro",
        "gemini-pro",
        "gemini-1.0-pro"
    ];

    console.log('--- TESTING MODELS FOR GENERATION ---');

    for (const modelName of candidates) {
        process.stdout.write(`Testing ${modelName.padEnd(25)} ... `);
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent("Hi");
            console.log('✅ WORKING!');
            console.log(`\n🎉 FOUND WORKING MODEL: "${modelName}"`);
            console.log('Response:', result.response.text());
            return; // Exit on first success
        } catch (error) {
            console.log('❌ FAILED');
            // console.log(`   Reason: ${error.message.split('\n')[0]}`);
        }
    }

    console.log('\n❌ ALL MODELS FAILED GENERATION.');
    console.log('Diagnosis: The API Key is valid for listing models, but NO model allows generation.');
    console.log('Possible causes:');
    console.log('1. Billing is not enabled (required for some models).');
    console.log('2. API Key restrictions (restricted to specific APIs?).');
    console.log('3. Region restrictions.');
}

findWorkingModel();

import 'dotenv/config';

async function verifyGemini() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        console.error('❌ GEMINI_API_KEY is missing from .env');
        return;
    }

    console.log(`Checking API Key: ${key.substring(0, 8)}...`);

    // 1. Valid Model Names
    const models = ['gemini-1.5-flash', 'gemini-pro'];

    console.log('\n--- DIAGNOSIS ---');
    console.log('1. Trying to list available models...');
    try {
        const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
        const resp = await fetch(listUrl);
        const data = await resp.json();

        if (resp.status === 200) {
            console.log('✅ List Models SUCCESS! Available models:');
            // Log only names, comma separated to save space
            console.log(data.models?.map(m => m.name).join('\n'));
        } else {
            console.error(`❌ List Models FAILED (Status: ${resp.status})`);
            console.error('Error:', JSON.stringify(data.error, null, 2));

            if (data.error?.message?.includes('API has not been used') || data.error?.status === 'PERMISSION_DENIED') {
                console.log('\n🚨 ACTION REQUIRED: ENABLE THE API 🚨');
                console.log('Your API Key is valid, but the "Generative Language API" is NOT enabled.');
                console.log('Please visit this URL to enable it:');
                console.log(`👉 https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com?project=${process.env.FIREBASE_PROJECT_ID || 'YOUR_PROJECT_ID'}`);
            }
        }
    } catch (e) {
        console.error('Network error checking models:', e.message);
    }
}

verifyGemini();

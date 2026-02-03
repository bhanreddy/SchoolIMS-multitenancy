import 'dotenv/config';

async function testGeminiHttp() {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        console.error('❌ GEMINI_API_KEY is missing from .env');
        return;
    }

    console.log(`Testing Gemini API with Key: ${key.substring(0, 5)}...`);

    const models = ['gemini-1.5-flash', 'gemini-pro'];

    for (const model of models) {
        console.log(`\n--- Testing ${model} ---`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

        try {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: "Hello" }] }]
                })
            });

            const data = await resp.json();
            console.log(`Status: ${resp.status}`);

            if (resp.ok) {
                console.log('✅ SUCCESS!');
                console.log('Response:', data.candidates?.[0]?.content?.parts?.[0]?.text);
                return;
            } else {
                console.log('❌ ERROR RESPONSE:');
                console.log(JSON.stringify(data, null, 2));
            }
        } catch (error) {
            console.error('❌ Network/Fetch Error:', error);
        }
    }
}

testGeminiHttp();

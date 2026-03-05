import 'dotenv/config';

async function testGeminiHttp() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {

    return;
  }

  const models = ['gemini-1.5-flash', 'gemini-pro'];

  for (const model of models) {

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

      if (resp.ok) {

        return;
      } else {

      }
    } catch (error) {

    }
  }
}

testGeminiHttp();
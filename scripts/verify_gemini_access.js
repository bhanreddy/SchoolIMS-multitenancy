import 'dotenv/config';

async function verifyGemini() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {

    return;
  }

  // 1. Valid Model Names
  const models = ['gemini-1.5-flash', 'gemini-pro'];

  try {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
    const resp = await fetch(listUrl);
    const data = await resp.json();

    if (resp.status === 200) {

    } else {

      if (data.error?.message?.includes('API has not been used') || data.error?.status === 'PERMISSION_DENIED') {

      }
    }
  } catch (e) {

  }
}

verifyGemini();
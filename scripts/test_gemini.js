import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/env.js';

async function listModels() {
  if (!config.geminiApiKey) {

    return;
  }

  try {

    // Hack: The Node SDK doesn't expose listModels easily on the main class in some versions,
    // but let's try a direct fetch if the SDK fails, or just try a standard known model.
    // Actually, let's just test if gemini-1.5-flash-001" works.

    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash-001"
    });

    const result = await model.generateContent("Hello");

  } catch (error) {

    try {
      const genAI = new GoogleGenerativeAI(config.geminiApiKey);
      const model = genAI.getGenerativeModel({
        model: "gemini-1.5-flash-001"
      });
      const result = await model.generateContent("Hello");

    } catch (e) {

    }
  }
}

listModels();
import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/env.js';

async function debugGemini() {

  if (!config.geminiApiKey) {

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
    "gemini-1.0-pro"];

    for (const modelName of modelsToTry) {

      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent("Hi");

        return; // Stop after first success
      } catch (error) {

      }
    }

  } catch (error) {

  }
}

debugGemini();
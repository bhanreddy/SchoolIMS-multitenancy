import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/env.js';

async function findWorkingModel() {
  if (!config.geminiApiKey) {

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
  "gemini-1.0-pro"];

  for (const modelName of candidates) {
    process.stdout.write(`Testing ${modelName.padEnd(25)} ... `);
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent("Hi");

      return; // Exit on first success
    } catch (error) {

    }
  }

}

findWorkingModel();
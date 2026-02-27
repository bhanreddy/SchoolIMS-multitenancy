import { GoogleGenerativeAI } from '@google/generative-ai';

const getAIModel = (apiKey) => {
    if (!apiKey) return null;
    const genAI = new GoogleGenerativeAI(apiKey);
    return genAI.getGenerativeModel({ model: "gemini-flash-latest" });
};

async function generateWithRetry(model, prompt, retries = 3, delay = 1000) {
    try {
        return await model.generateContent(prompt);
    } catch (error) {
        const isTransient = error.response?.status === 503 || error.response?.status === 429;
        if (isTransient && retries > 0) {
            console.log(`⚠️ AI Busy. Retrying in ${delay}ms... (${retries} left)`);
            await new Promise(res => setTimeout(res, delay));
            return generateWithRetry(model, prompt, retries - 1, delay * 2);
        }
        throw error;
    }
}

/**
 * Translates an array of English strings into Hybrid Telugu.
 * Protects academic words (e.g., Maths -> మ్యాథ్స్, Homework -> హోంవర్క్).
 * 
 * @param {string[]} texts - Array of primary English strings
 * @returns {Promise<string[]>} - Array of translated strings
 */
export async function translateToHybridTelugu(texts) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is missing');
    const model = getAIModel(apiKey);

    const prompt = `
You are an expert translator creating a "Hybrid Telugu" localization for an Indian school management app.

**RULES:**
1. You will receive a JSON array of English strings.
2. Translate the sentence structure and conversational words into simple spoken Telugu.
3. **CRITICAL**: Do NOT translate academic or technical words into pure/Sanskrit Telugu. Instead, transliterate them into Telugu script but keep the English pronunciation.
   - Example MUST follow:
     - Maths -> మ్యాథ్స్ (NOT గణితం)
     - Homework -> హోంవర్క్ (NOT ఇంటి పని)
     - Teacher -> టీచర్ (NOT ఉపాధ్యాయుడు)
     - Attendance -> అటెండెన్స్ (NOT హాజరు)
     - Student -> స్టూడెంట్ (NOT విద్యార్థి)
     - Exam / Test -> ఎగ్జామ్ / టెస్ట్ (NOT పరీక్ష)
     - Project -> ప్రాజెక్ట్
     - Assignment -> అసైన్మెంట్
     - Marks -> మార్క్స్
     - Class -> క్లాస్
     - Notice -> నోటీస్
     - Complaint -> కంప్లైంట్
4. Maintain the exact same array length and order.
5. Return ONLY a valid JSON array of strings containing the translations. Do not include markdown codeblocks or any other text.

**INPUT (JSON array):**
${JSON.stringify(texts, null, 2)}
    `;

    try {
        const result = await generateWithRetry(model, prompt);
        let responseText = result.response.text().trim();

        // Strip markdown backticks if any
        if (responseText.startsWith('\`\`\`json')) {
            responseText = responseText.replace(/^\`\`\`json/, '').replace(/\`\`\`$/, '').trim();
        } else if (responseText.startsWith('\`\`\`')) {
            responseText = responseText.replace(/^\`\`\`/, '').replace(/\`\`\`$/, '').trim();
        }

        const translatedArray = JSON.parse(responseText);

        if (!Array.isArray(translatedArray) || translatedArray.length !== texts.length) {
            throw new Error("Translation out of sync or invalid format");
        }
        return translatedArray;
    } catch (error) {
        console.error("Hybrid Translation failed:", error);
        throw error;
    }
}

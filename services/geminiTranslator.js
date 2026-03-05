import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

const TRANSLATION_PROMPT_PREFIX = `Translate the following English text to Telugu.

Rules:
- Use transliteration for educational/school terms, not pure Telugu words.
  Examples: Homework → హోంవర్క్, Fee → ఫీ, Attendance → అటెండెన్స్, Diary → డైరీ,
  Maths → మ్యాథ్స్, Teacher → టీచర్, Student → స్టూడెంట్, Exam → ఎగ్జామ్,
  Class → క్లాస్, Notice → నోటీస్, Complaint → కంప్లైంట్, Project → ప్రాజెక్ట్
- Semi-formal respectful tone suitable for parents of school students.
- Preserve all numbers, dates, symbols, and proper nouns exactly as-is.
- Return ONLY the Telugu translation. No explanations. No English. No quotes.

Text:`;

/**
 * Translate a single English string to Telugu.
 * Returns empty string on failure — never throws.
 */
export async function translateToTelugu(text) {
  if (!text || text.trim() === '') return '';
  try {
    const result = await model.generateContent(`${TRANSLATION_PROMPT_PREFIX}\n${text}`);
    return result.response.text().trim();
  } catch (err) {

    return '';
  }
}

/**
 * Translate multiple fields in ONE Gemini call (saves quota).
 * @param {Object} fields - { columnName: 'English text', ... }
 * @returns {Object} - { columnName: 'Telugu text', ... }
 * Never throws — returns {} on failure.
 */
export async function translateFields(fields) {
  const entries = Object.entries(fields).filter(([, v]) => v && v.trim() !== '');
  if (entries.length === 0) return {};

  const fieldList = entries.map(([k, v]) => `${k}: ${v}`).join('\n');

  const prompt = `Translate each field from English to Telugu.

Rules:
- Use transliteration for school terms (Homework → హోంవర్క్, Fee → ఫీ, Maths → మ్యాథ్స్,
  Teacher → టీచర్, Student → స్టూడెంట్, Exam → ఎగ్జామ్, Class → క్లాస్, etc.)
- Semi-formal respectful tone for school parents.
- Preserve numbers, dates, symbols, proper nouns exactly.
- Return ONLY a raw JSON object. No markdown. No backticks. No explanation.

Fields:
${fieldList}

Return format: {"fieldName": "Telugu translation", ...}`;

  try {
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim().replace(/```json|```/g, '');
    return JSON.parse(raw);
  } catch (err) {

    return {};
  }
}
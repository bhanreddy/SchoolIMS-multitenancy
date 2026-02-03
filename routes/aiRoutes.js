import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/env.js';
import sql from '../db.js';

const router = express.Router();
let genAI;
let model;

if (config.geminiApiKey) {
    genAI = new GoogleGenerativeAI(config.geminiApiKey);
    // Use gemini-2.0-flash for latest model compatibility
    model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
} else {
    console.warn("⚠️ GEMINI_API_KEY is missing. AI features will fail.");
}

router.post('/doubt-assist', requireAuth, async (req, res) => {
    try {
        const { question, class_level, subject } = req.body;

        if (!question) {
            return res.status(400).json({ error: 'Question is required' });
        }

        // Check if API key is configured
        if (!model) {
            // Try to re-init if key was hot-loaded (though env usually requires restart)
            if (process.env.GEMINI_API_KEY) {
                genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
            } else {
                return res.status(503).json({ error: 'AI Service Unavailable' });
            }
        }

        // Determine Class Level from User Context if not provided
        let studentClass = class_level || 'General';

        // Auto-fetch class if student
        if (req.user && req.user.internal_id) {
            const enrollment = await sql`
                SELECT c.name as class_name 
                FROM student_enrollments se
                JOIN class_sections cs ON se.class_section_id = cs.id
                JOIN classes c ON cs.class_id = c.id
                WHERE se.student_id = ${req.user.internal_id} 
                AND se.status = 'active'
                LIMIT 1
             `;
            if (enrollment.length > 0) {
                studentClass = enrollment[0].class_name;
            }
        }


        const systemPrompt = `You are NexSyrus IMS – AI Doubt Assist.
Answer ONLY using the provided class level information.
Avoid age restricted topics if the question is out of the student's age level.
Start answering with "Hello, greetings from Nexsyrus! 👋"
If the question is completely inappropriate for their age, respond exactly with:
"⚠️ This question is outside your current class scope."

Context:
- Class Level: ${studentClass}
- Subject: ${subject || 'General'}

Question: ${question}
`;

        const result = await model.generateContent(systemPrompt);
        const responseText = result.response.text();

        res.json({
            answer: responseText,
            id: Date.now().toString()
        });

    } catch (error) {
        console.error('Gemini AI Error (Full):', JSON.stringify(error, null, 2));

        // Handle Rate Limit (429)
        if (error.status === 429 || error.message?.includes('429') || error.message?.includes('RESOURCE_EXHAUSTED') || error.message?.includes('quota')) {
            return res.status(429).json({
                error: 'AI Rate Limited',
                details: 'Free tier quota exceeded. Please wait a minute and try again, or upgrade to a paid Gemini API plan.'
            });
        }

        if (error.message?.includes('404') || error.message?.includes('not found')) {
            // Log available models for debugging
            console.log('💡 TIP: Run "node scripts/list_available_models.js" to see supported models.');

            return res.status(503).json({
                error: 'AI Model Unavailable',
                details: 'The configured model (gemini-2.0-flash) was not found or is not supported by your API key. Check Billing/Region.'
            });
        }

        res.status(502).json({
            error: 'AI Request Failed',
            details: error.message || 'Unknown upstream error',
            model: model?.model || 'unknown'
        });
    }
});

export default router;

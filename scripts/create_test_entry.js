import sql from '../db.js';
import fs from 'fs';

async function createTestEntry() {
    try {
        const classId = fs.readFileSync('class_id.txt', 'utf8').trim();
        if (!classId) throw new Error('No class_id found');

        console.log(`Creating test entry for class: ${classId}`);

        const [entry] = await sql`
      INSERT INTO diary_entries (
        class_section_id, 
        entry_date, 
        title, 
        content, 
        created_by,
        created_at,
        updated_at
      ) VALUES (
        ${classId}, 
        CURRENT_DATE, 
        'Test Homework - Sync Check', 
        'This is a test entry created to verify sync functionality.', 
        (SELECT id FROM users LIMIT 1), -- fallback creator
        NOW(),
        NOW()
      )
      RETURNING *
    `;

        console.log('Created entry:', entry.id);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

createTestEntry();

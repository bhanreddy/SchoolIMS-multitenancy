import sql from '../db.js';
import fs from 'fs';

async function getValidClass() {
    try {
        // Get a class section that has diary entries
        const [entry] = await sql`
      SELECT class_section_id 
      FROM diary_entries 
      ORDER BY created_at DESC 
      LIMIT 1
    `;

        if (entry) {
            fs.writeFileSync('class_id.txt', entry.class_section_id);
            console.log('Written class_id.txt');
        } else {
            console.error('No diary entries found');
        }
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

getValidClass();

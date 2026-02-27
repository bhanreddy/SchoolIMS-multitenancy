import sql from '../db.js';
import fs from 'fs';

async function verifyQueryLogic() {
    try {
        const classId = fs.readFileSync('class_id.txt', 'utf8').trim();
        const sinceDate = new Date(0); // Epoch

        console.log(`Testing query for Class: ${classId}, Since: ${sinceDate.toISOString()}`);

        const entries = await sql`
      SELECT 
        d.id, d.entry_date, d.title, d.updated_at
      FROM diary_entries d
      LEFT JOIN subjects s ON d.subject_id = s.id
      JOIN users u ON d.created_by = u.id
      JOIN persons creator ON u.person_id = creator.id
      WHERE d.class_section_id = ${classId}
        AND (d.updated_at > ${sinceDate} OR d.created_at > ${sinceDate})
      ORDER BY d.updated_at DESC
    `;

        console.log(`Found ${entries.length} entries.`);
        if (entries.length > 0) {
            console.log('Sample:', JSON.stringify(entries[0], null, 2));
        }

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

verifyQueryLogic();

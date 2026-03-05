import sql from '../db.js';
import fs from 'fs';

async function debugClasses() {
  try {
    let output = '';
    const log = (msg) => {output += msg + '\n';};

    log('--- ACADEMIC YEARS ---');
    const years = await sql`SELECT * FROM academic_years`;
    log(JSON.stringify(years, null, 2));

    log('\n--- CLASS SECTIONS (RAW) ---');
    const classSections = await sql`
            SELECT cs.id, cs.class_id, cs.section_id, cs.academic_year_id 
            FROM class_sections cs
        `;
    log(JSON.stringify(classSections, null, 2));

    log('\n--- JOINED CHECK ---');
    const joined = await sql`
            SELECT cs.id, c.name as class_name, s.name as section_name
            FROM class_sections cs
            LEFT JOIN classes c ON cs.class_id = c.id
            LEFT JOIN sections s ON cs.section_id = s.id
            ORDER BY c.name
        `;
    log(JSON.stringify(joined, null, 2));

    fs.writeFileSync('debug_output_direct.txt', output);

  } catch (err) {

  } finally {
    process.exit();
  }
}

debugClasses();
import sql from '../db.js';

async function seedClassSections() {
    try {
        console.log('Fetching constraints...');

        // 1. Get Active Academic Year
        const [ay] = await sql`SELECT id FROM academic_years WHERE code = '2025-2026'`;
        if (!ay) throw new Error('Academic Year 2025-2026 not found');
        console.log('Target AY:', ay.id);

        // 2. Get All Classes and Sections
        const classes = await sql`SELECT id, name FROM classes`;
        const sections = await sql`SELECT id, name FROM sections`;

        console.log(`Found ${classes.length} classes and ${sections.length} sections.`);

        let inserted = 0;

        for (const cls of classes) {
            for (const sec of sections) {
                // Check if exists
                const [exists] = await sql`
                    SELECT id FROM class_sections 
                    WHERE class_id = ${cls.id} 
                    AND section_id = ${sec.id} 
                    AND academic_year_id = ${ay.id}
                `;

                if (!exists) {
                    await sql`
                        INSERT INTO class_sections (class_id, section_id, academic_year_id)
                        VALUES (${cls.id}, ${sec.id}, ${ay.id})
                    `;
                    process.stdout.write('+');
                    inserted++;
                } else {
                    process.stdout.write('.');
                }
            }
        }

        console.log(`\n\nSeeding Complete. Inserted ${inserted} new mappings.`);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        process.exit();
    }
}

seedClassSections();

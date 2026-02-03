import sql from './db.js';

const checkTables = async () => {
    try {
        const classSections = await sql`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'class_sections'
        `;
        console.log('class_sections exists:', classSections.length > 0);

        const subjects = await sql`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'subjects'
        `;
        console.log('subjects exists:', subjects.length > 0);

        process.exit(0);
    } catch (error) {
        console.error('Check failed:', error);
        process.exit(1);
    }
};

checkTables();

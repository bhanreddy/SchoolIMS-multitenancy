import sql from './db.js';

async function fetchDebug() {
    const audience = 'students';
    console.log(`Testing fetch with audience = '${audience}'...`);

    const notices = await sql`
        SELECT id, title, audience, target_class_id 
        FROM notices 
        WHERE (audience = ${audience} OR audience = 'all')
    `;

    console.log(`Found ${notices.length} notices:`);
    notices.forEach(n => console.log(`- [${n.audience}] ${n.title} (Class: ${n.target_class_id})`));
    process.exit(0);
}
fetchDebug();

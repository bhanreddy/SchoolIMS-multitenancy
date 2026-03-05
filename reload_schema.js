import sql from './db.js';

async function reload() {
    try {
        await sql`NOTIFY pgrst, 'reload schema'`;
        console.log('PostgREST schema cache reloaded.');
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

reload();

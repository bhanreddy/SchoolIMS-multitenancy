import sql from '../db.js';

async function test() {
    console.log('Testing DB connection...');
    try {
        const result = await sql`SELECT 1 as connected`;
        console.log('DB Connection SUCCESS:', result);
    } catch (err) {
        console.error('DB Connection FAILED:', err);
    } finally {
        process.exit(0);
    }
}

test();

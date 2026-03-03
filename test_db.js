import sql from './db.js';

async function main() {
    try {
        const res = await sql`SELECT * FROM notification_logs ORDER BY created_at DESC LIMIT 5`;
        console.log(res);
    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

main();
import sql from './db.js';

async function debug() {
    try {
        console.log("Attempting insert...");

        // 1. Get a valid user ID (admin) to use as creator
        const [user] = await sql`SELECT id FROM users LIMIT 1`;
        if (!user) throw new Error("No users found");
        console.log("Using user:", user.id);

        const [notice] = await sql`
            INSERT INTO notices (title, content, audience, priority, created_by)
            VALUES ('Test Title', 'Test Content', 'all', 'medium', ${user.id})
            RETURNING *
        `;
        console.log("Insert Success:", notice);
    } catch (e) {
        console.error("Insert Failed:", e);
    }
    process.exit(0);
}
debug();

import sql from '../db.js';

const STALE_DAYS = 60;

async function cleanupTokens() {
    console.log('🧹 Starting Token Cleanup Job...');

    try {
        // 1. Delete tokens not used in X days
        console.log(`Deleting tokens not seen for ${STALE_DAYS} days...`);
        const staleResult = await sql`
            DELETE FROM user_devices
            WHERE last_used_at < now() - ${STALE_DAYS} * interval '1 day'
            RETURNING fcm_token
        `;
        console.log(`✅ Deleted ${staleResult.length} stale tokens.`);

        // 2. (Optional) Delete tokens explicitly marked as invalid if we had a flag
        // For now, the service deletes them immediately on error, so this is just a backup for stale ones.

        console.log('🎉 Cleanup complete.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Token cleanup failed:', error);
        process.exit(1);
    }
}

cleanupTokens();

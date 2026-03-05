import sql from '../db.js';

const STALE_DAYS = 60;

async function cleanupTokens() {

  try {
    // 1. Delete tokens not used in X days

    const staleResult = await sql`
            DELETE FROM user_devices
            WHERE last_used_at < now() - ${STALE_DAYS} * interval '1 day'
            RETURNING fcm_token
        `;

    // 2. (Optional) Delete tokens explicitly marked as invalid if we had a flag
    // For now, the service deletes them immediately on error, so this is just a backup for stale ones.

    process.exit(0);
  } catch (error) {

    process.exit(1);
  }
}

cleanupTokens();
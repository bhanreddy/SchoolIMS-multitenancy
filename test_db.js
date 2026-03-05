import sql from './db.js';

async function main() {
  try {
    const res = await sql`
            SELECT ud.fcm_token, us.notification_sound 
            FROM user_devices ud 
            LEFT JOIN user_settings us ON ud.user_id = us.user_id 
            ORDER BY ud.last_used_at DESC LIMIT 5`;

    res.forEach((r) => {});
  } catch (err) {

  } finally {
    process.exit();
  }
}

main();

import 'dotenv/config';
import sql from '../db.js';

async function verifyConnection() {

  try {
    const [result] = await sql`SELECT 1 as connected, current_setting('port') as port, inet_server_addr() as ip`;

    // Note: This might show 5432 internally even if connected via 6543

    process.exit(0);
  } catch (error) {

    // Check for specific error
    if (error.message.includes('tenant allow_list')) {

    }
    process.exit(1);
  }
}

verifyConnection();
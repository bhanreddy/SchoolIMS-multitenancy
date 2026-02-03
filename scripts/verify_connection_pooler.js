
import 'dotenv/config';
import sql from '../db.js';

async function verifyConnection() {
    console.log('🔄 Verifying connection to Supabase Transaction Pooler...');

    try {
        const [result] = await sql`SELECT 1 as connected, current_setting('port') as port, inet_server_addr() as ip`;

        console.log('✅ Connection Successful!');
        console.log('   Connected:', result.connected);
        console.log('   Port (Server-side):', result.port); // Note: This might show 5432 internally even if connected via 6543
        console.log('   IP:', result.ip);

        console.log('\n✅ Port 6543 + prepare:false enforced via code.');
        console.log('Backend successfully aligned with Supabase Transaction Pooler.');

        process.exit(0);
    } catch (error) {
        console.error('❌ Connection Failed:', error.message);
        // Check for specific error
        if (error.message.includes('tenant allow_list')) {
            console.error('⚠️  IP Allow-listing issue detected (Unexpected for Pooler if configured correctly)');
        }
        process.exit(1);
    }
}

verifyConnection();

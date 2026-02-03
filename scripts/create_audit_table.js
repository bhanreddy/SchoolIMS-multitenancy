import sql from '../db.js';

async function createAuditTable() {
    try {
        console.log('Creating audit_logs table...');
        await sql`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID REFERENCES users(id),
                action TEXT NOT NULL,
                entity TEXT,
                entity_id TEXT,
                details JSONB,
                ip_address TEXT,
                user_agent TEXT,
                request_id TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
        `;
        console.log('✅ audit_logs table created successfully.');

        console.log('Creating index on audit_logs...');
        await sql`
            CREATE INDEX IF NOT EXISTS idx_audit_logs_user_date ON audit_logs(user_id, created_at DESC);
        `;
        console.log('✅ Index created.');

        process.exit(0);
    } catch (error) {
        console.error('❌ Failed to create table:', error);
        process.exit(1);
    }
}

createAuditTable();

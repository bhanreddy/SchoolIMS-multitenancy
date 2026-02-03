import sql from './db.js';

async function applyThemeSchema() {
    console.log('--- Applying Theme Schema ---');

    try {
        // 1. Add theme column to users table if it doesn't exist
        await sql`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'light'
            CHECK (theme IN ('light', 'dark'));
        `;
        console.log('✅ Added theme column to users table.');

        console.log('--- Theme Schema Applied Successfully ---');
    } catch (error) {
        console.error('❌ Error applying theme schema:', error);
    }
}

applyThemeSchema();

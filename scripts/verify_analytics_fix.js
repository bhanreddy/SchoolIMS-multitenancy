import sql from '../db.js';

const verifyFix = async () => {
    try {
        console.log('Verifying get_financial_analytics RPC...');

        // Call the function with some dummy dates
        const result = await sql`
            SELECT get_financial_analytics('2026-01-01', '2026-12-31', 'month') as analytics
        `;

        console.log('RPC Call Successful!');
        console.log('Result:', JSON.stringify(result[0].analytics, null, 2));
        process.exit(0);
    } catch (error) {
        console.error('Verification Failed:', error);
        process.exit(1);
    }
};

verifyFix();

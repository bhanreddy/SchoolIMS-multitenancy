import sql from '../db.js';

const verifyFix = async () => {
  try {

    // Call the function with some dummy dates
    const result = await sql`
            SELECT get_financial_analytics('2026-01-01', '2026-12-31', 'month') as analytics
        `;

    process.exit(0);
  } catch (error) {

    process.exit(1);
  }
};

verifyFix();
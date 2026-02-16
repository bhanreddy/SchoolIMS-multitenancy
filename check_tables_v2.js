
import sql from './db.js';

async function checkSchema() {
    try {
        const expensesCols = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'expenses'
    `;
        console.log('--- EXPENSES TABLE ---');
        console.log(JSON.stringify(expensesCols, null, 2));

        const payrollCols = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'staff_payroll'
    `;
        console.log('--- STAFF_PAYROLL TABLE ---');
        console.log(JSON.stringify(payrollCols, null, 2));

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkSchema();

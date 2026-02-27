import sql from '../db.js';
import fs from 'fs';

async function debug() {
    const output = [];

    // 1. Check school_settings
    const settings = await sql`SELECT key, value FROM school_settings`;
    output.push('=== SCHOOL SETTINGS ===');
    output.push(JSON.stringify(settings, null, 2));

    // 2. Check receipts
    const receipts = await sql`SELECT id, receipt_no, student_id, total_amount FROM receipts ORDER BY issued_at DESC LIMIT 3`;
    output.push('\n=== RECEIPTS ===');
    output.push(JSON.stringify(receipts, null, 2));

    if (receipts.length > 0) {
        const receiptId = receipts[0].id;

        // 3. Check receipt_items
        const items = await sql`SELECT * FROM receipt_items WHERE receipt_id = ${receiptId}`;
        output.push(`\n=== RECEIPT ITEMS for ${receiptId} ===`);
        output.push(JSON.stringify(items, null, 2));

        // 4. Full receipt detail
        const [receipt] = await sql`
            SELECT 
                r.*,
                s.admission_no, p.display_name as student_name,
                issuer.display_name as issued_by_name
            FROM receipts r
            JOIN students s ON r.student_id = s.id
            JOIN persons p ON s.person_id = p.id
            LEFT JOIN users u ON r.issued_by = u.id
            LEFT JOIN persons issuer ON u.person_id = issuer.id
            WHERE r.id = ${receiptId}
        `;
        output.push('\n=== FULL RECEIPT DETAIL ===');
        output.push(JSON.stringify(receipt, null, 2));
    }

    fs.writeFileSync('debug_receipt_output.json', output.join('\n'));
    console.log('Done. Output written to debug_receipt_output.json');
    process.exit(0);
}

debug().catch(err => {
    console.error('ERROR:', err);
    process.exit(1);
});


import sql from '../db.js';

const verifyFeePropagation = async () => {
    try {
        console.log('Verifying fee propagation...');

        // 1. Setup Data: Create Academic Year, Class, Fee Type
        // Use last 6 digits of timestamp for uniqueness
        const uniqueId = Date.now().toString().slice(-6);

        // Create non-overlapping dates: e.g., offset by seconds/minutes or use random future year
        // Let's use a year based on the current minute/second to avoid overlap if run quickly? 
        // Or just a random year between 3000 and 4000
        const randYear = 3000 + Math.floor(Math.random() * 1000);
        const startDate = `${randYear}-01-01`;
        const endDate = `${randYear}-12-31`;

        const yearCode = `AY_${uniqueId}`;
        const year = await sql`
      INSERT INTO academic_years (code, start_date, end_date) 
      VALUES (${yearCode}, ${startDate}, ${endDate}) 
      RETURNING id
    `;
        const yearId = year[0].id;
        console.log('Created Academic Year:', yearId);

        const className = `CLS_${uniqueId}`;
        const cls = await sql`
      INSERT INTO classes (name, code)
      VALUES (${className}, ${className})
      RETURNING id
    `;
        const classId = cls[0].id;

        const typeName = `FEE_${uniqueId}`;
        const ftype = await sql`
      INSERT INTO fee_types (name, code, is_recurring)
      VALUES (${typeName}, ${typeName}, true)
      RETURNING id
    `;
        const typeId = ftype[0].id;

        // 2. Create Fee Structure with Amount 1000
        const fs = await sql`
      INSERT INTO fee_structures (academic_year_id, class_id, fee_type_id, amount, due_date)
      VALUES (${yearId}, ${classId}, ${typeId}, 1000.00, ${endDate})
      RETURNING id
    `;
        const feeStructureId = fs[0].id;
        console.log('Created Fee Structure (1000):', feeStructureId);

        // 3. Create Dummy Student & Student Fee Rec
        // Need a person and student first
        const person = await sql`
      INSERT INTO persons (first_name, last_name, gender_id)
      VALUES ('Test', 'Student', 1)
      RETURNING id
    `;
        const personId = person[0].id;

        // Need status
        const status = await sql`SELECT id FROM student_statuses WHERE code='active'`;

        const admNo = `ADM_${uniqueId}`;

        const student = await sql`
        INSERT INTO students (person_id, admission_no, admission_date, status_id)
        VALUES (${personId}, ${admNo}, ${startDate}, ${status[0].id})
        RETURNING id
    `;
        const studentId = student[0].id;

        // Link fee
        await sql`
        INSERT INTO student_fees (student_id, fee_structure_id, amount_due, amount_paid, status)
        VALUES (${studentId}, ${feeStructureId}, 1000.00, 0, 'pending')
    `;
        console.log('Created Student Fee Record for 1000');

        // 4. Update Fee Structure to 2000
        console.log('Updating Fee Structure to 2000...');
        await sql`
        UPDATE fee_structures SET amount = 2000.00 WHERE id = ${feeStructureId}
    `;

        // 5. Check Student Fee
        const updatedFee = await sql`
        SELECT amount_due, status FROM student_fees 
        WHERE student_id = ${studentId} AND fee_structure_id = ${feeStructureId}
    `;

        console.log('Updated Student Fee:', updatedFee[0]);

        if (parseFloat(updatedFee[0].amount_due) === 2000.00) {
            console.log('SUCCESS: Fee propagated!');

            // Cleanup
            await sql`DELETE FROM student_fees WHERE student_id = ${studentId}`;
            await sql`DELETE FROM students WHERE id = ${studentId}`;
            await sql`DELETE FROM persons WHERE id = ${personId}`;
            await sql`DELETE FROM fee_structures WHERE id = ${feeStructureId}`;
            await sql`DELETE FROM fee_types WHERE id = ${typeId}`;
            await sql`DELETE FROM classes WHERE id = ${classId}`;
            await sql`DELETE FROM academic_years WHERE id = ${yearId}`;

            process.exit(0);
        } else {
            console.error('FAILURE: Amount due is ' + updatedFee[0].amount_due);
            process.exit(1);
        }

    } catch (err) {
        console.error(err);
        // Cleanup attempt even on error
        // (omitted for brevity, but good practice in real scenarios)
        process.exit(1);
    }
};

verifyFeePropagation();


import sql from './db.js';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

function logError(msg) {
    fs.appendFileSync('stress_errors.log', msg + '\n', 'utf8');
}


// Configuration
const CONCURRENT_REQUESTS = 10;
const TEST_CLASS_NAME = 'Stress Test Class ' + uuidv4().substring(0, 8);
const TEST_FEE_NAME = 'Stress Fee ' + uuidv4().substring(0, 8);

async function runStressTest() {
    console.log("🔥 Starting System Stress Test...");
    console.log(`   Concurrency Level: ${CONCURRENT_REQUESTS}`);

    let errors = 0;

    try {
        // ==========================================
        // SETUP: Create Data
        // ==========================================
        console.log("\n[SETUP] Creating test data...");

        // 1. Create Reference Data (Class, Year, Fee Type)
        const [year] = await sql`
        INSERT INTO academic_years (code, start_date, end_date)
        VALUES (${'SY-' + uuidv4().substring(0, 6)}, '2026-01-01', '2026-12-31')
        RETURNING id
    `;
        const [cls] = await sql`INSERT INTO classes (name, code) VALUES (${TEST_CLASS_NAME}, ${'C-' + uuidv4().substring(0, 4)}) RETURNING id`;
        const [sec] = await sql`INSERT INTO sections (name, code) VALUES (${'Sec-' + uuidv4().substring(0, 4)}, ${'S-' + uuidv4().substring(0, 4)}) RETURNING id`;
        const [cs] = await sql`INSERT INTO class_sections (class_id, section_id, academic_year_id) VALUES (${cls.id}, ${sec.id}, ${year.id}) RETURNING id`;
        const [ftype] = await sql`INSERT INTO fee_types (name, code) VALUES (${TEST_FEE_NAME}, ${'F-' + uuidv4().substring(0, 4)}) RETURNING id`;
        const [fstruct] = await sql`
        INSERT INTO fee_structures (academic_year_id, class_id, fee_type_id, amount, due_date)
        VALUES (${year.id}, ${cls.id}, ${ftype.id}, 10000, '2026-12-01')
        RETURNING id
    `;

        // 2. Create Student
        const [gender] = await sql`SELECT id FROM genders LIMIT 1`;
        const [status] = await sql`SELECT id FROM student_statuses WHERE code='active' LIMIT 1`;
        const [person] = await sql`
        INSERT INTO persons (first_name, last_name, gender_id)
        VALUES ('Stress', 'Tester', ${gender.id})
        RETURNING id
    `;
        const admissionNo = 'ADM-' + uuidv4().substring(0, 8);
        const [student] = await sql`
        INSERT INTO students (person_id, admission_no, admission_date, status_id)
        VALUES (${person.id}, ${admissionNo}, '2026-01-01', ${status.id})
        RETURNING id
    `;
        await sql`
        INSERT INTO student_enrollments (student_id, academic_year_id, class_section_id, start_date, roll_number)
        VALUES (${student.id}, ${year.id}, ${cs.id}, '2026-01-01', 1)
    `;

        // 3. Create Student Fee
        const [sfee] = await sql`
        INSERT INTO student_fees (student_id, fee_structure_id, amount_due)
        VALUES (${student.id}, ${fstruct.id}, 10000)
        RETURNING id
    `;

        console.log("   ✅ Data created successfully.");

        // ==========================================
        // SCENARIO 1: Concurrent Payments
        // ==========================================
        console.log("\n[SCENARIO 1] Concurrent Payments...");
        const baseAmount = 10;
        const promises = [];

        // Simulate 50 concurrent requests
        for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
            promises.push(
                sql`
                INSERT INTO fee_transactions (student_fee_id, amount, payment_method, remarks)
                VALUES (${sfee.id}, ${baseAmount}, 'cash', ${'Stress Test ' + i})
            `
            );
        }

        await Promise.all(promises);

        // Verify
        const [finalFee] = await sql`SELECT amount_paid FROM student_fees WHERE id = ${sfee.id}`;
        const expectedPaid = baseAmount * CONCURRENT_REQUESTS;

        if (Number(finalFee.amount_paid) === expectedPaid) {
            // console.log(`   ✅ PASS: Expected ${expectedPaid}, Got ${finalFee.amount_paid}`);
        } else {
            logError(`   ❌ FAIL: Expected ${expectedPaid}, Got ${finalFee.amount_paid}`);
            errors++;
        }


        // ==========================================
        // SCENARIO 2: Payment Race (Update vs Delete)
        // ==========================================
        console.log("\n[SCENARIO 2] Payment Race (Update vs Delete)...");

        // Create a transaction to race on
        const [raceTx] = await sql`
        INSERT INTO fee_transactions (student_fee_id, amount, payment_method)
        VALUES (${sfee.id}, 100, 'cash')
        RETURNING id
    `;

        // Concurrently Update (add 50) and Delete (remove all)
        // We expect sequential execution by Postgres row lock.
        // Case A: Update first -> (100+50) added to fee, then Delete -> (150) removed. Net change on fee: 0 (correct, since tx is gone).
        // Case B: Delete first -> (100) removed from fee. Update fails (0 rows). Net change on fee: -100 (from previous state).

        // We need to verify that `amount_paid` matches `SUM(transactions)` eventually.

        const racePromises = [
            sql`UPDATE fee_transactions SET amount = amount + 50 WHERE id = ${raceTx.id}`,
            sql`DELETE FROM fee_transactions WHERE id = ${raceTx.id}`
        ];

        await Promise.allSettled(racePromises);

        // Verification: sum of remaining transactions should equal amount_paid
        const [sumRes] = await sql`SELECT COALESCE(SUM(amount), 0) as total FROM fee_transactions WHERE student_fee_id = ${sfee.id}`;
        const [feeRes] = await sql`SELECT amount_paid FROM student_fees WHERE id = ${sfee.id}`;

        if (Number(sumRes.total) === Number(feeRes.amount_paid)) {
            // console.log(`   ✅ PASS: Integrity maintained. Fee: ${feeRes.amount_paid}, Trans Sum: ${sumRes.total}`);
        } else {
            logError(`   ❌ FAIL: Integrity Mismatch! Fee: ${feeRes.amount_paid}, Trans Sum: ${sumRes.total}`);
            errors++;
        }


        // ==========================================
        // SCENARIO 3: Roll Number Concurrency
        // ==========================================
        console.log("\n[SCENARIO 3] Roll Number Concurrency...");

        // Add 10 more students to the section
        for (let i = 0; i < 10; i++) {
            const [p] = await sql`INSERT INTO persons(first_name, last_name, gender_id) VALUES (${'Roll' + i}, 'Test', ${gender.id}) RETURNING id`;
            const [s] = await sql`INSERT INTO students(person_id, admission_no, admission_date, status_id) VALUES (${p.id}, ${'R-' + uuidv4()}, '2026-01-01', ${status.id}) RETURNING id`;
            await sql`INSERT INTO student_enrollments(student_id, academic_year_id, class_section_id, start_date) VALUES (${s.id}, ${year.id}, ${cs.id}, '2026-01-01')`;
        }

        // Hammer the recalculate function
        const rollPromises = [];
        for (let i = 0; i < 10; i++) {
            rollPromises.push(sql`SELECT recalculate_section_rolls(${cs.id}, ${year.id})`);
        }
        await Promise.all(rollPromises);

        // Check for duplicates
        const [dups] = await sql`
        SELECT roll_number, COUNT(*) 
        FROM student_enrollments 
        WHERE class_section_id = ${cs.id} AND roll_number IS NOT NULL
        GROUP BY roll_number 
        HAVING COUNT(*) > 1
    `;

        if (!dups) {
            // console.log("   ✅ PASS: No duplicate roll numbers found.");
        } else {
            logError("   ❌ FAIL: Duplicate roll numbers detected!");
            errors++;
        }


        // ==========================================
        // SCENARIO 4: Soft Delete Collision
        // ==========================================
        console.log("\n[SCENARIO 4] Soft Delete Collision...");
        const collisionAdm = 'ADM-COLLIDE-' + uuidv4().substring(0, 4);

        // 1. Create Student A
        const [pA] = await sql`INSERT INTO persons(first_name, last_name, gender_id) VALUES ('A', 'A', ${gender.id}) RETURNING id`;
        const [sA] = await sql`INSERT INTO students(person_id, admission_no, admission_date, status_id) VALUES (${pA.id}, ${collisionAdm}, '2026-01-01', ${status.id}) RETURNING id`;

        // 2. Soft Delete A
        await sql`UPDATE students SET deleted_at = NOW() WHERE id = ${sA.id}`;

        // 3. Create Student B with SAME Admission No
        try {
            const [pB] = await sql`INSERT INTO persons(first_name, last_name, gender_id) VALUES ('B', 'B', ${gender.id}) RETURNING id`;
            await sql`INSERT INTO students(person_id, admission_no, admission_date, status_id) VALUES (${pB.id}, ${collisionAdm}, '2026-01-01', ${status.id})`;
            // console.log("   ✅ PASS: Inserted second student with soft-deleted admission number.");
        } catch (err) {
            logError(`   ❌ FAIL: Collision error: ${err.message}`);
            errors++;
        }


        // ==========================================
        // SCENARIO 5: API Atomicity (Simulated)
        // ==========================================
        console.log("\n[SCENARIO 5] API Atomicity Simulation...");

        // Simulate: Insert Transaction -> Error -> Verify Rollback (Transaction Logic check)
        try {
            await sql.begin(async sql => {
                await sql`INSERT INTO fee_transactions (student_fee_id, amount, payment_method) VALUES (${sfee.id}, 500, 'cash')`;
                throw new Error("Simulated API Crash");
            });
        } catch (e) {
            // Expected
        }

        // Check if that 500 amount persisted
        const [phantomTx] = await sql`SELECT * FROM fee_transactions WHERE student_fee_id = ${sfee.id} AND amount = 500`;
        if (!phantomTx) {
            // console.log("   ✅ PASS: Failed transaction was rolled back.");
        } else {
            logError("   ❌ FAIL: Phantom transaction persistet!");
            errors++;
        }

        // Cleanup
        // (Optional, or leave for debug)

    } catch (err) {
        logError(`\n❌ CRITICAL HARNESS ERROR: ${err.message}`);
        // console.error(err);
        errors++;
    }

    console.log("\n==================================");
    if (errors === 0) {
        console.log("🎉 ALL STRESS TESTS PASSED");
        process.exit(0);
    } else {
        console.log(`💀 ${errors} FAILURES DETECTED`);
        process.exit(1);
    }
}

runStressTest();

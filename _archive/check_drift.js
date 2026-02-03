import sql from './db.js';

const EXPECTED_TRIGGERS = [
    'trg_update_paid_on_transaction',
    'trg_guard_fee_update',
    'trg_persons_updated',
    'trg_validate_attendance',
    'trg_auto_fee_status'
];

const EXPECTED_INDEXES = [
    'idx_persons_name_trgm',
    'idx_users_person_active',
    'idx_students_admission_active',
    'idx_student_fees_status'
];

const FORBIDDEN_OBJECTS = [
    // Example: logical constraints that were replaced
    { type: 'constraint', name: 'users_person_id_key' },
    { type: 'constraint', name: 'students_admission_no_key' }
];

async function checkDrift() {
    console.log("🔍 Starting Schema Drift Detection...");
    let driftCount = 0;

    // 1. Check Triggers
    for (const trg of EXPECTED_TRIGGERS) {
        const [found] = await sql`SELECT tgname FROM pg_trigger WHERE tgname = ${trg}`;
        if (!found) {
            console.error(`   ❌ DRIFT: Missing required trigger '${trg}'`);
            driftCount++;
        } else {
            console.log(`   ✅ Trigger found: ${trg}`);
        }
    }

    // 2. Check Indexes
    for (const idx of EXPECTED_INDEXES) {
        const [found] = await sql`SELECT indexname FROM pg_indexes WHERE indexname = ${idx}`;
        if (!found) {
            console.error(`   ❌ DRIFT: Missing required index '${idx}'`);
            driftCount++;
        } else {
            console.log(`   ✅ Index found: ${idx}`);
        }
    }

    // 3. Check Forbidden Constraints
    for (const obj of FORBIDDEN_OBJECTS) {
        const [found] = await sql`
        SELECT conname FROM pg_constraint WHERE conname = ${obj.name}
    `;
        if (found) {
            console.error(`   ❌ DRIFT: Forbidden constraint found '${obj.name}' (Should have been removed)`);
            driftCount++;
        } else {
            console.log(`   ✅ Forbidden constraint absent: ${obj.name}`);
        }
    }

    if (driftCount === 0) {
        console.log("\n✨ Schema is clean. No drift detected.");
        process.exit(0);
    } else {
        console.error(`\n⚠️  ${driftCount} Drift Issues Detected!`);
        process.exit(1);
    }
}

checkDrift();

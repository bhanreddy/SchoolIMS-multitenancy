
import sql from './db.js';

async function debugTimetable() {
    try {
        console.log('--- Timetable Debug ---');

        // 1. Check total slots
        const [count] = await sql`SELECT count(*) FROM timetable_slots`;
        console.log('Total Slots:', count.count);

        // 2. Check distinct days (to verify casing/enum values)
        const days = await sql`SELECT DISTINCT day_of_week FROM timetable_slots`;
        console.log('Distinct Days:', days.map(d => d.day_of_week));

        // 2.5 Check legacy table
        try {
            const [legacyCount] = await sql`SELECT count(*) FROM timetable_entries`;
            console.log('Legacy Entries:', legacyCount.count);
        } catch (e) {
            console.log('Legacy table not found: ' + e.message);
        }
    } catch (err) {
        console.error('Error:', err);
    } finally {
        process.exit();
    }
}

debugTimetable();

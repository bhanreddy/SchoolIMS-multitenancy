
import sql from '../db.js';

async function fixPeriods() {

  try {
    // 1. Deduplicate: Keep one period per name, delete others

    const duplicates = await sql`
            DELETE FROM periods
            WHERE id IN (
                SELECT id
                FROM (
                    SELECT id, ROW_NUMBER() OVER (PARTITION BY name ORDER BY sort_order ASC, id ASC) as rnum
                    FROM periods
                ) t
                WHERE t.rnum > 1
            )
            RETURNING id, name
        `;

    // 2. Add Unique Constraint

    try {
      await sql`ALTER TABLE periods ADD CONSTRAINT periods_name_key UNIQUE (name)`;

    } catch (err) {
      if (err.code === '42710') {

      } else {

      }
    }

    // 3. Remove non-standard periods (e.g. Period 9, 10)

    const extras = await sql`
            DELETE FROM periods 
            WHERE name NOT IN (
                'Period 1', 'Period 2', 'Period 3', 'Break', 'Period 4', 'Period 5', 'Lunch', 'Period 6', 'Period 7', 'Period 8'
            )
            RETURNING name
        `;

    // 4. Ensure standard periods exist with correct order

    const standardList = [
    { name: 'Period 1', start: '08:00', end: '08:45', order: 1 },
    { name: 'Period 2', start: '08:45', end: '09:30', order: 2 },
    { name: 'Period 3', start: '09:30', end: '10:15', order: 3 },
    { name: 'Break', start: '10:15', end: '10:30', order: 4 },
    { name: 'Period 4', start: '10:30', end: '11:15', order: 5 },
    { name: 'Period 5', start: '11:15', end: '12:00', order: 6 },
    { name: 'Lunch', start: '12:00', end: '12:45', order: 7 },
    { name: 'Period 6', start: '12:45', end: '13:30', order: 8 },
    { name: 'Period 7', start: '13:30', end: '14:15', order: 9 },
    { name: 'Period 8', start: '14:15', end: '15:00', order: 10 }];

    for (const p of standardList) {
      await sql`
                INSERT INTO periods (name, start_time, end_time, sort_order)
                VALUES (${p.name}, ${p.start}, ${p.end}, ${p.order})
                ON CONFLICT (name) DO UPDATE SET
                    start_time = EXCLUDED.start_time,
                    end_time = EXCLUDED.end_time,
                    sort_order = EXCLUDED.sort_order
             `;
    }

    process.exit(0);

  } catch (error) {

    process.exit(1);
  }
}

fixPeriods();
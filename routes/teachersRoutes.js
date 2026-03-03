import express from 'express';
import sql from '../db.js';

const router = express.Router();

// Get all teachers
router.get('/', async (req, res) => {
    try {
        const teachers = await sql`
      SELECT 
        t.id, t.employee_code, t.joining_date,
        p.first_name, p.middle_name, p.last_name, p.display_name, p.email, p.phone, p.gender_id
      FROM teachers t
      JOIN persons p ON t.person_id = p.id
    `;
        res.json(teachers);
    } catch (error) {
        console.error('Error fetching teachers:', error);
        res.status(500).json({ error: 'Failed to fetch teachers', details: error.message });
    }
});

// Get My Classes & Subjects
router.get('/me/classes', async (req, res) => {
    try {
        const userId = req.user.id;
        // 1. Get Staff ID from User ID
        const [staff] = await sql`
            SELECT s.id 
            FROM staff s 
            JOIN persons p ON s.person_id = p.id 
            JOIN users u ON u.person_id = p.id 
            WHERE u.id = ${userId}
        `;

        if (!staff) {
            return res.status(404).json({ error: 'Staff profile not found' });
        }

        // 2. Fetch Assignments
        const assignments = await sql`
            SELECT 
                cs.class_section_id,
                c.id as class_id,
                c.name as class_name,
                sec.id as section_id,
                sec.name as section_name,
                s.id as subject_id,
                s.name as subject_name,
                cs.id as assignment_id
            FROM class_subjects cs
            JOIN class_sections csec ON cs.class_section_id = csec.id
            JOIN classes c ON csec.class_id = c.id
            JOIN sections sec ON csec.section_id = sec.id
            JOIN subjects s ON cs.subject_id = s.id
            WHERE cs.teacher_id = ${staff.id}
        `;

        res.json(assignments);
    } catch (error) {
        console.error('Error fetching teacher classes:', error);
        res.status(500).json({ error: 'Failed to fetch classes' });
    }
});

// Create Teacher
router.post('/', async (req, res) => {
    try {
        const {
            first_name, middle_name, last_name, dob, gender_id,
            employee_code, joining_date, status_id,
            email, phone
        } = req.body;

        if (!first_name || !last_name || !employee_code || !joining_date) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const result = await sql.begin(async sql => {
            // 1. Create Person
            const [person] = await sql`
        INSERT INTO persons (first_name, middle_name, last_name, dob, gender_id)
        VALUES (${first_name}, ${middle_name}, ${last_name}, ${dob}, ${gender_id})
        RETURNING id
      `;

            // 2. Create Teacher
            const [teacher] = await sql`
        INSERT INTO teachers (
          person_id, employee_code, joining_date, status_id
        )
        VALUES (
          ${person.id}, ${employee_code}, ${joining_date}, ${status_id}
        )
        RETURNING *
      `;

            // 3. Contacts
            if (email) {
                await sql`INSERT INTO person_contacts (person_id, contact_type, contact_value, is_primary) VALUES (${person.id}, 'email', ${email}, true)`;
            }
            if (phone) {
                await sql`INSERT INTO person_contacts (person_id, contact_type, contact_value, is_primary) VALUES (${person.id}, 'phone', ${phone}, true)`;
            }

            return teacher;
        });

        res.status(201).json({
            message: 'Teacher created successfully',
            teacher: result
        });
    } catch (error) {
        console.error('Error creating teacher:', error);
        res.status(500).json({ error: 'Failed to create teacher', details: error.message });
    }
});

export default router;

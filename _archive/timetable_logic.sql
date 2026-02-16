-- DEPRECATED: This logic has been moved to schema.sql
-- DO NOT RUN THIS FILE
-- Running this file will cause errors because it uses the old 'timetable_entries' table.
-- Use schema.sql instead.

-- ============================================================
-- TIMETABLE & PROMOTION LOGIC (  Output)
-- ============================================================

-- 1. TIMETABLE VALIDATION
-- Requirement: Assigned teacher MUST belong to that class.
-- We verify against `class_subjects` or ensure teacher is staff.
-- Trigger to validate teacher assignment.

CREATE OR REPLACE FUNCTION validate_timetable_entry()
RETURNS TRIGGER AS $$
DECLARE
    v_is_valid BOOLEAN;
BEGIN
    -- Skip check if no teacher assigned (free period)
    IF NEW.teacher_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Check if teacher is assigned to this class (via class_subjects)
    -- This enforces: Teacher T teaches Subject S in Class C
    SELECT EXISTS (
        SELECT 1 FROM class_subjects cs
        WHERE cs.class_section_id = NEW.class_section_id
          AND cs.teacher_id = NEW.teacher_id
          AND (NEW.subject_id IS NULL OR cs.subject_id = NEW.subject_id)
    ) INTO v_is_valid;

    IF NOT v_is_valid THEN
        -- Fallback: If not strictly in class_subjects (e.g. substitute), 
        -- check if they are at least Active Staff.
        -- BUT Prompt says: "Assigned teacher MUST belong to that class".
        -- So strict check is better.
        RAISE EXCEPTION 'Teacher is not assigned to this class/subject in class_subjects mapping';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_timetable ON timetable_entries;
CREATE TRIGGER trg_validate_timetable
BEFORE INSERT OR UPDATE ON timetable_entries
FOR EACH ROW EXECUTE FUNCTION validate_timetable_entry();

-- 2. TIMETABLE RLS POLICIES
ALTER TABLE timetable_entries ENABLE ROW LEVEL SECURITY;

-- Helper to get current user's person_id (assuming linked via users table)
-- We already have auth_has_role.

-- Policy: Admin/Manage
CREATE POLICY "Timetable Manage" ON timetable_entries
FOR ALL
USING (
    auth_has_role(ARRAY['admin']) OR 
    EXISTS (
        SELECT 1 FROM user_roles ur 
        JOIN role_permissions rp ON ur.role_id = rp.role_id
        JOIN permissions p ON rp.permission_id = p.id
        WHERE ur.user_id = auth.uid() AND p.code = 'timetable.manage'
    )
);

-- Policy: View (Admin, Teacher, Student, Parent)
DROP POLICY IF EXISTS "Timetable View" ON timetable_entries;
CREATE POLICY "Timetable View" ON timetable_entries
FOR SELECT
USING (
    -- 1. Admin/Staff with View Perms
    auth_has_role(ARRAY['admin', 'accounts']) OR
    
    -- 2. Teacher (View OWN schedule)
    (
        auth_has_role(ARRAY['teacher', 'staff']) AND
        teacher_id IN (
            SELECT id FROM staff 
            WHERE person_id = (SELECT person_id FROM users WHERE id = auth.uid())
        )
    ) OR

    -- 3. Student (View CLASS schedule)
    (
        auth_has_role(ARRAY['student']) AND
        class_section_id IN (
            SELECT se.class_section_id 
            FROM student_enrollments se
            JOIN students s ON se.student_id = s.id
            WHERE s.person_id = (SELECT person_id FROM users WHERE id = auth.uid())
              AND se.status = 'active'
        )
    ) OR

    -- 4. Parent (View CHILD'S CLASS schedule)
    (
        auth_has_role(ARRAY['parent']) AND
        class_section_id IN (
            SELECT se.class_section_id
            FROM student_enrollments se
            JOIN students s ON se.student_id = s.id
            JOIN student_parents sp ON s.id = sp.student_id
            JOIN parents p ON sp.parent_id = p.id
            WHERE p.person_id = (SELECT person_id FROM users WHERE id = auth.uid())
              AND se.status = 'active'
        )
    )
);

-- 3. AUTOMATIC CLASS PROMOTION
-- Function: promote_students_academic_year
-- Logic: Move students from current AY to next AY, incrementing class.

CREATE OR REPLACE FUNCTION promote_students_academic_year(
    p_current_ay_id UUID,
    p_next_ay_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_promoted_count INT := 0;
    v_graduated_count INT := 0;
    r_enrollment RECORD;
    v_next_class_id UUID;
    v_next_section_id UUID; -- Keep same section? Usually yes.
    v_next_class_section_id UUID;
    v_class_name TEXT;
    v_next_class_name TEXT;
    v_class_number INT;
BEGIN
    -- Validate AYs
    IF p_current_ay_id = p_next_ay_id THEN
        RAISE EXCEPTION 'Source and Target Academic Years must be different';
    END IF;

    -- Loop through ACTIVE enrollments in current AY
    FOR r_enrollment IN
        SELECT se.*, c.id as class_id, c.name as class_name, cs.section_id
        FROM student_enrollments se
        JOIN class_sections cs ON se.class_section_id = cs.id
        JOIN classes c ON cs.class_id = c.id
        WHERE se.academic_year_id = p_current_ay_id
          AND se.status = 'active'
          AND se.deleted_at IS NULL
    LOOP
        -- 1. Determine Next Class
        -- Logic: Attempt to parse "Class 1" -> 1. Increment to 2. Find "Class 2".
        -- If fails (e.g. "Kindergarten"), this logic needs specific handling or a mapping table.
        -- Assuming "Class X" format for simplicity as per common IMS.
        
        -- Simple Regex to extract number
        v_class_number := substring(r_enrollment.class_name FROM '\d+')::INT;
        
        IF v_class_number IS NOT NULL THEN
            v_next_class_name := 'Class ' || (v_class_number + 1);
            
            -- Check if next class exists
            SELECT id INTO v_next_class_id FROM classes WHERE name = v_next_class_name;
            
            IF v_next_class_id IS NOT NULL THEN
                -- Find corresponding class_section in Next AY
                -- We assume Section maps 1:1 by name (via section_id)
                SELECT id INTO v_next_class_section_id
                FROM class_sections
                WHERE class_id = v_next_class_id
                  AND section_id = r_enrollment.section_id
                  AND academic_year_id = p_next_ay_id;
                  
                -- If section doesn't exist in next year, we cannot promote automatically
                -- Possible fallback: Default section or error. We'll skip/log.
                IF v_next_class_section_id IS NOT NULL THEN
                    -- PROMOTE
                    INSERT INTO student_enrollments (
                        student_id, academic_year_id, class_section_id, status, start_date, roll_number
                    ) VALUES (
                        r_enrollment.student_id,
                        p_next_ay_id,
                        v_next_class_section_id,
                        'active',
                        (SELECT start_date FROM academic_years WHERE id = p_next_ay_id),
                        NULL -- To be recalculated
                    );
                    
                    -- Mark old as completed
                    UPDATE student_enrollments 
                    SET status = 'completed', end_date = (SELECT end_date FROM academic_years WHERE id = p_current_ay_id)
                    WHERE id = r_enrollment.id;
                    
                    v_promoted_count := v_promoted_count + 1;
                ELSE
                    -- Log missing section?
                END IF;
            ELSE
                -- Next class not found -> GRADUATE
                -- Assume highest class means graduation
                UPDATE students SET status_id = (SELECT id FROM student_statuses WHERE is_terminal = true LIMIT 1) 
                WHERE id = r_enrollment.student_id;
                
                UPDATE student_enrollments 
                SET status = 'completed', end_date = (SELECT end_date FROM academic_years WHERE id = p_current_ay_id)
                WHERE id = r_enrollment.id;
                
                v_graduated_count := v_graduated_count + 1;
            END IF;
        ELSE
            -- Non-numeric class name? Skip for safety.
        END IF;
    END LOOP;

    -- Recalculate Roll Numbers for ALL sections in Next AY
    -- (We can optimize to only touch affected sections, but this is safer)
    PERFORM recalculate_section_rolls(cs.id, p_next_ay_id)
    FROM class_sections cs
    WHERE cs.academic_year_id = p_next_ay_id;

    RETURN jsonb_build_object(
        'status', 'success',
        'promoted', v_promoted_count,
        'graduated', v_graduated_count
    );
END;
$$ LANGUAGE plpgsql;

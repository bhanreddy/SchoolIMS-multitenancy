-- FIX ENROLLMENT RPC
CREATE OR REPLACE FUNCTION ensure_student_enrollment(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_person_id UUID;
    v_student_id UUID;
    v_academic_year_id UUID;
    v_class_section_id UUID;
    v_enrollment_id UUID;
    v_enrollment_exists BOOLEAN;
BEGIN
    -- 0. Resolve Student ID from User ID
    SELECT person_id INTO v_person_id FROM users WHERE id = p_user_id;
    
    IF v_person_id IS NULL THEN
         RAISE EXCEPTION 'User not found';
    END IF;

    SELECT id INTO v_student_id FROM students WHERE person_id = v_person_id;

    IF v_student_id IS NULL THEN
        RAISE EXCEPTION 'Student profile not found for this user';
    END IF;

    -- Check if enrollment exists for CURRENT academic year
    -- 1. Get Current Academic Year
    -- (Logic unchanged)
    SELECT id INTO v_academic_year_id
    FROM academic_years
    WHERE start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE
    LIMIT 1;

    IF v_academic_year_id IS NULL THEN
        SELECT id INTO v_academic_year_id
        FROM academic_years
        ORDER BY start_date DESC
        LIMIT 1;
    END IF;
    
    IF v_academic_year_id IS NULL THEN
        RAISE EXCEPTION 'No academic year configured.';
    END IF;

    -- 2. Check existing enrollment
    SELECT EXISTS (
        SELECT 1 FROM student_enrollments
        WHERE student_id = v_student_id
          AND academic_year_id = v_academic_year_id
          AND deleted_at IS NULL
    ) INTO v_enrollment_exists;

    IF v_enrollment_exists THEN
        RETURN jsonb_build_object('status', 'exists', 'message', 'Enrollment already exists');
    END IF;

    -- 3. Find Default Class/Section (First available)
    SELECT id INTO v_class_section_id
    FROM class_sections
    WHERE academic_year_id = v_academic_year_id
    LIMIT 1;

    IF v_class_section_id IS NULL THEN
         RAISE EXCEPTION 'No class sections defined for the current academic year.';
    END IF;

    -- 4. Calculate next roll number (basic max + 1)
    INSERT INTO student_enrollments (
        student_id, academic_year_id, class_section_id, status, start_date, roll_number
    )
    VALUES (
        v_student_id, 
        v_academic_year_id, 
        v_class_section_id, 
        'active', 
        CURRENT_DATE,
        (SELECT COALESCE(MAX(roll_number), 0) + 1 FROM student_enrollments WHERE class_section_id = v_class_section_id)
    )
    RETURNING id INTO v_enrollment_id;

    RETURN jsonb_build_object('status', 'created', 'enrollment_id', v_enrollment_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

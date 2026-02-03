-- ============================================================
-- NEXSYRUS TABS SCHEMA & AUTOMATION
-- ============================================================

-- 1. DISCIPLINE & CONDUCT
CREATE TABLE IF NOT EXISTS discipline_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id),
    incident_date DATE NOT NULL DEFAULT CURRENT_DATE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    severity VARCHAR(20) CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    action_taken TEXT,
    reported_by UUID REFERENCES users(id), -- Staff who reported
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_discipline_student ON discipline_records(student_id);

-- 2. MONEY SCIENCE
CREATE TABLE IF NOT EXISTS money_science_modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    age_group VARCHAR(50), -- e.g., '6-8', '9-12' OR can be mapped to class
    content_url TEXT,
    total_points INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_money_science_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    module_id UUID NOT NULL REFERENCES money_science_modules(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed')),
    progress_percentage INTEGER DEFAULT 0,
    completed_at TIMESTAMPTZ,
    last_accessed_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(student_id, module_id)
);

-- 3. SCIENCE PROJECTS
CREATE TABLE IF NOT EXISTS science_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    difficulty_level VARCHAR(20) CHECK (difficulty_level IN ('beginner', 'intermediate', 'advanced')),
    is_group_project BOOLEAN DEFAULT FALSE,
    min_participants INTEGER DEFAULT 1,
    max_participants INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_science_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES science_projects(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'submitted', 'evaluated', 'certified')),
    submission_url TEXT,
    teacher_remarks TEXT,
    grade VARCHAR(10),
    certified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(student_id, project_id)
);

-- 4. LIFE VALUES
CREATE TABLE IF NOT EXISTS life_values_modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    academic_year_id UUID REFERENCES academic_years(id), -- Optional: if content is specific to year
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_life_values_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    module_id UUID NOT NULL REFERENCES life_values_modules(id) ON DELETE CASCADE,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
    engagement_score INTEGER DEFAULT 0, -- Metric for "Engagement"
    completed_at TIMESTAMPTZ,
    last_accessed_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(student_id, module_id, academic_year_id)
);

-- 5. AUTOMATION: ENROLLMENT
CREATE OR REPLACE FUNCTION ensure_student_enrollment(p_student_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_academic_year_id UUID;
    v_class_section_id UUID;
    v_enrollment_id UUID;
    v_category_id SMALLINT;
    v_religion_id SMALLINT;
    v_blood_group_id SMALLINT;
    v_enrollment_exists BOOLEAN;
BEGIN
    -- Check if enrollment exists for CURRENT academic year
    -- 1. Get Current Academic Year
    SELECT id INTO v_academic_year_id
    FROM academic_years
    WHERE start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE
    LIMIT 1;

    IF v_academic_year_id IS NULL THEN
        -- Fallback: Get the latest one if no current one matches date
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
        WHERE student_id = p_student_id
          AND academic_year_id = v_academic_year_id
          AND deleted_at IS NULL
    ) INTO v_enrollment_exists;

    IF v_enrollment_exists THEN
        RETURN jsonb_build_object('status', 'exists', 'message', 'Enrollment already exists');
    END IF;

    -- 3. Find Default Class/Section (First available)
    -- Ideally this should be more smart, but per requirements "Default class & section "
    SELECT id INTO v_class_section_id
    FROM class_sections
    WHERE academic_year_id = v_academic_year_id
    LIMIT 1;

    IF v_class_section_id IS NULL THEN
         RAISE EXCEPTION 'No class sections defined for the current academic year.';
    END IF;

    -- 4. Calculate next roll number (basic max + 1)
    -- We can use the existing function if available, or just simple logic
    -- Reusing simple logic for robustness in this script
    
    INSERT INTO student_enrollments (
        student_id, academic_year_id, class_section_id, status, start_date, roll_number
    )
    VALUES (
        p_student_id, 
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

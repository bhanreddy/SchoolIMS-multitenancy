-- Timetable Schema Migration (Fixed RLS)

DROP TABLE IF EXISTS timetable_slots CASCADE;

-- Create Enum for Days
DO $$ BEGIN
    CREATE TYPE day_of_week_enum AS ENUM ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE timetable_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID,
    
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
    class_section_id UUID NOT NULL REFERENCES class_sections(id) ON DELETE CASCADE,
    
    day_of_week day_of_week_enum NOT NULL, -- Enum is back
    period_number SMALLINT NOT NULL,
    
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    teacher_id UUID REFERENCES staff(id) ON DELETE SET NULL,
    
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE (class_section_id, academic_year_id, day_of_week, period_number),
    CONSTRAINT chk_time_order CHECK (start_time < end_time)
);

CREATE INDEX IF NOT EXISTS idx_timetable_class ON timetable_slots(class_section_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_timetable_teacher ON timetable_slots(teacher_id, day_of_week);

ALTER TABLE timetable_slots ENABLE ROW LEVEL SECURITY;

-- RLS Policies (Fixed)

-- 1. Students: View OWN class timetable
DROP POLICY IF EXISTS "Students view own class timetable" ON timetable_slots;
CREATE POLICY "Students view own class timetable" ON timetable_slots
FOR SELECT
USING (
    class_section_id IN (
        SELECT class_section_id 
        FROM student_enrollments 
        WHERE student_id IN (
            SELECT id FROM students WHERE person_id = (
                SELECT person_id FROM users WHERE id = auth.uid()
            )
        )
        AND status = 'active'
    )
);

-- 2. Teachers: View OWN slots
DROP POLICY IF EXISTS "Teachers view own slots" ON timetable_slots;
CREATE POLICY "Teachers view own slots" ON timetable_slots
FOR SELECT
USING (
    teacher_id IN (
        SELECT id FROM staff 
        WHERE person_id = (
            SELECT person_id FROM users WHERE id = auth.uid()
        )
    )
);

-- 3. Admins: Full Access
DROP POLICY IF EXISTS "Admins full access" ON timetable_slots;
CREATE POLICY "Admins full access" ON timetable_slots
FOR ALL
USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND EXISTS (
        SELECT 1 FROM user_roles ur 
        JOIN roles r ON ur.role_id = r.id 
        WHERE ur.user_id = users.id AND r.code = 'admin'
    ))
);

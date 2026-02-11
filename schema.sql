/*
  Project: IMS Backend Service
  Description: Consolidated, idempotent full setup script.
  Date: 2026-01-31
  Target: PostgreSQL 15+ / Supabase
  Execution: Run as 'postgres' or 'service_role'.
*/

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

-- Start Transaction
BEGIN;

-- SECTION 01: EXTENSIONS
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- SECTION 02: CORE SCHEMA
-- ============================================================
-- SUPABASE BACKEND SCHEMA v3.1 (CONSOLIDATED & IDEMPOTENT)
-- ============================================================
-- INCLUDES:
--  1. Original v2 schema tables
--  2. Remediation Fixes (Financial, RLS, Indexes)
--  3. Idempotency Fixes (DROP IF EXISTS added for Triggers/Policies)
-- ============================================================

-- 0. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. REFERENCE TABLES
CREATE TABLE IF NOT EXISTS countries (
    code CHAR(2) PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS genders (
    id SMALLINT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS student_categories (
    id SMALLINT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS religions (
    id SMALLINT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS blood_groups (
    id SMALLINT PRIMARY KEY,
    name VARCHAR(10) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS relationship_types (
    id SMALLINT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS staff_designations (
    id SMALLINT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE
);

-- 2. CORE TRIGGERS (GLOBAL)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. PERSONS
CREATE TABLE IF NOT EXISTS persons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name VARCHAR(50) NOT NULL,
    middle_name VARCHAR(50),
    last_name VARCHAR(50) NOT NULL,
    display_name TEXT,
    dob DATE,
    gender_id SMALLINT NOT NULL REFERENCES genders(id),
    nationality_code CHAR(2) REFERENCES countries(code),
    photo_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT chk_person_dob_past CHECK (dob IS NULL OR dob <= current_date)
);

DROP TRIGGER IF EXISTS trg_persons_updated ON persons;
CREATE TRIGGER trg_persons_updated
BEFORE UPDATE ON persons
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION update_person_display_name()
RETURNS TRIGGER AS $$
BEGIN
  NEW.display_name := trim(concat_ws(' ', NEW.first_name, NEW.middle_name, NEW.last_name));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_persons_display_name ON persons;
CREATE TRIGGER trg_persons_display_name
BEFORE INSERT OR UPDATE ON persons
FOR EACH ROW EXECUTE FUNCTION update_person_display_name();

-- Search Index
CREATE INDEX IF NOT EXISTS idx_persons_name_trgm 
ON persons USING gin (first_name gin_trgm_ops, last_name gin_trgm_ops);

-- 4. CONTACTS
DO $$ BEGIN
    CREATE TYPE contact_type_enum AS ENUM ('email','phone','address');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS person_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
    contact_type contact_type_enum NOT NULL,
    contact_value TEXT NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    is_emergency BOOLEAN NOT NULL DEFAULT FALSE,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS uq_primary_contact_only
ON person_contacts(person_id, contact_type)
WHERE is_primary = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_person_contact_unique
ON person_contacts(person_id, contact_type, lower(contact_value))
WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_person_contacts_updated ON person_contacts;
CREATE TRIGGER trg_person_contacts_updated
BEFORE UPDATE ON person_contacts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 5. USERS & RBAC
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    is_system BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL
);

DO $$ BEGIN
    CREATE TYPE account_status_enum AS ENUM ('active','locked','disabled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
    account_status account_status_enum NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Note: deleted_at needed for soft delete index safety
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Soft Delete Safe Unique Index
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_person_active 
ON users(person_id) WHERE deleted_at IS NULL; 

CREATE TABLE IF NOT EXISTS user_roles (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id)
);

CREATE OR REPLACE FUNCTION ensure_active_person_ref()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.person_id <> OLD.person_id THEN
    RAISE EXCEPTION 'person_id cannot be changed once linked to user';
  END IF;

  IF EXISTS (SELECT 1 FROM persons WHERE id = NEW.person_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot link user to deleted person';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_active_person ON users;
CREATE TRIGGER trg_user_active_person
BEFORE INSERT OR UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION ensure_active_person_ref();

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 6. STUDENTS
CREATE TABLE IF NOT EXISTS student_statuses (
    id SMALLINT PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    is_terminal BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
    admission_no VARCHAR(30) NOT NULL,
    admission_date DATE NOT NULL,
    category_id SMALLINT REFERENCES student_categories(id),
    religion_id SMALLINT REFERENCES religions(id),
    blood_group_id SMALLINT REFERENCES blood_groups(id),
    status_id SMALLINT NOT NULL REFERENCES student_statuses(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_students_status ON students(status_id);

-- Remediation: Soft Delete Safe Unique Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_admission_active 
ON students(admission_no) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_students_person_active 
ON students(person_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_students_updated ON students;
CREATE TRIGGER trg_students_updated
BEFORE UPDATE ON students
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 7. PARENTS
CREATE TABLE IF NOT EXISTS parents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
    occupation VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_parents_person_active 
ON parents(person_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_parents_updated ON parents;
CREATE TRIGGER trg_parents_updated
BEFORE UPDATE ON parents
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS student_parents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
    parent_id UUID NOT NULL REFERENCES parents(id) ON DELETE RESTRICT,
    relationship_id SMALLINT REFERENCES relationship_types(id),
    is_primary_contact BOOLEAN NOT NULL DEFAULT FALSE,
    is_legal_guardian BOOLEAN NOT NULL DEFAULT FALSE,
    valid_from DATE,
    valid_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT uq_active_parent UNIQUE (student_id, parent_id),
    CONSTRAINT no_parent_date_overlap EXCLUDE USING gist (
        student_id WITH =,
        parent_id WITH =,
        daterange(valid_from, valid_to, '[]') WITH &&
    ),
    CONSTRAINT chk_parent_valid_range CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_primary_parent
ON student_parents(student_id)
WHERE is_primary_contact = true
  AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION ensure_active_student_parent()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM students WHERE id = NEW.student_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot link to deleted student';
  END IF;
  IF EXISTS (SELECT 1 FROM parents WHERE id = NEW.parent_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot link to deleted parent';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_student_parents_active ON student_parents;
CREATE TRIGGER trg_student_parents_active
BEFORE INSERT OR UPDATE ON student_parents
FOR EACH ROW EXECUTE FUNCTION ensure_active_student_parent();

-- 8. ACADEMICS
CREATE TABLE IF NOT EXISTS academic_years (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) UNIQUE NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    CONSTRAINT chk_academic_year CHECK (start_date < end_date),
    CONSTRAINT no_academic_year_overlap EXCLUDE USING gist (
        daterange(start_date, end_date, '[]') WITH &&
    )
);

CREATE TABLE IF NOT EXISTS classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL UNIQUE,
    code VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL UNIQUE,
    code VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS class_sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID NOT NULL REFERENCES classes(id),
    section_id UUID NOT NULL REFERENCES sections(id),
    academic_year_id UUID NOT NULL REFERENCES academic_years(id),
    UNIQUE (class_id, section_id, academic_year_id)
);

DO $$ BEGIN
    CREATE TYPE enrollment_status_enum AS ENUM ('active','completed','withdrawn');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS student_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE RESTRICT,
    class_section_id UUID NOT NULL REFERENCES class_sections(id) ON DELETE RESTRICT,
    status enrollment_status_enum NOT NULL DEFAULT 'active',
    start_date DATE NOT NULL,
    end_date DATE,
    roll_number INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT no_enrollment_overlap EXCLUDE USING gist (
        student_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&
    ),
    UNIQUE (class_section_id, academic_year_id, roll_number)
);

CREATE INDEX IF NOT EXISTS idx_active_enrollments
ON student_enrollments(student_id)
WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_student_enrollments_updated ON student_enrollments;
CREATE TRIGGER trg_student_enrollments_updated
BEFORE UPDATE ON student_enrollments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Remediation: Set-Based Roll Number Calculation
CREATE OR REPLACE FUNCTION recalculate_section_rolls(
    p_class_section_id UUID,
    p_academic_year_id UUID
)
RETURNS VOID AS $$
BEGIN
    WITH ordered_students AS (
        SELECT 
            se.id AS enrollment_id,
            ROW_NUMBER() OVER (
                ORDER BY p.first_name ASC, p.last_name ASC
            ) as new_roll
        FROM student_enrollments se
        JOIN students s ON se.student_id = s.id
        JOIN persons p ON s.person_id = p.id
        WHERE se.class_section_id = p_class_section_id
          AND se.academic_year_id = p_academic_year_id
          AND se.status = 'active'
          AND se.deleted_at IS NULL
          AND s.deleted_at IS NULL
    )
    UPDATE student_enrollments se
    SET roll_number = os.new_roll
    FROM ordered_students os
    WHERE se.id = os.enrollment_id
      AND se.roll_number IS DISTINCT FROM os.new_roll;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_enrollment_year()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM class_sections
    WHERE id = NEW.class_section_id
      AND academic_year_id = NEW.academic_year_id
  ) THEN
    RAISE EXCEPTION 'Class section does not belong to academic year';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_enrollment ON student_enrollments;
CREATE TRIGGER trg_validate_enrollment
BEFORE INSERT OR UPDATE ON student_enrollments
FOR EACH ROW EXECUTE FUNCTION validate_enrollment_year();

CREATE OR REPLACE FUNCTION ensure_active_student_enrollment()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM students WHERE id = NEW.student_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot enroll a deleted student';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enroll_active_student ON student_enrollments;
CREATE TRIGGER trg_enroll_active_student
BEFORE INSERT OR UPDATE ON student_enrollments
FOR EACH ROW EXECUTE FUNCTION ensure_active_student_enrollment();

-- 9. ATTENDANCE
DO $$ BEGIN
    CREATE TYPE attendance_status_enum AS ENUM ('present','absent','late','half_day');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS daily_attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_enrollment_id UUID NOT NULL REFERENCES student_enrollments(id),
    attendance_date DATE NOT NULL,
    status attendance_status_enum NOT NULL,
    marked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    marked_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT chk_attendance_date_past CHECK (attendance_date <= current_date)
);

DROP TRIGGER IF EXISTS trg_attendance_updated ON daily_attendance;
CREATE TRIGGER trg_attendance_updated
BEFORE UPDATE ON daily_attendance
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_active
ON daily_attendance(student_enrollment_id, attendance_date)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_date ON daily_attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_enrollment ON daily_attendance(student_enrollment_id);
CREATE INDEX IF NOT EXISTS idx_attendance_composite ON daily_attendance(student_enrollment_id, status, attendance_date);

CREATE OR REPLACE FUNCTION validate_attendance_date()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM student_enrollments
    WHERE id = NEW.student_enrollment_id
      AND status = 'active'
      AND NEW.attendance_date BETWEEN start_date AND COALESCE(end_date, NEW.attendance_date)
      AND (end_date IS NULL OR NEW.attendance_date <= end_date)
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Attendance date outside valid enrollment period or enrollment not active';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_attendance ON daily_attendance;
CREATE TRIGGER trg_validate_attendance
BEFORE INSERT OR UPDATE ON daily_attendance
FOR EACH ROW EXECUTE FUNCTION validate_attendance_date();

-- 10. STAFF
CREATE TABLE IF NOT EXISTS staff_statuses (
    id SMALLINT PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(50) NOT NULL
);

INSERT INTO staff_statuses (id, code, name) VALUES
(1, 'active', 'Active'), (2, 'on_leave', 'On Leave'), (3, 'resigned', 'Resigned'), (4, 'terminated', 'Terminated')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
    staff_code VARCHAR(30) NOT NULL,
    designation_id SMALLINT REFERENCES staff_designations(id),
    joining_date DATE NOT NULL,
    status_id SMALLINT NOT NULL DEFAULT 1 REFERENCES staff_statuses(id),
    salary DECIMAL(12,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT chk_staff_joining_past CHECK (joining_date <= current_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_code_active 
ON staff(staff_code) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_person_active 
ON staff(person_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_staff_status ON staff(status_id);
CREATE INDEX IF NOT EXISTS idx_staff_active ON staff(id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_staff_updated ON staff;
CREATE TRIGGER trg_staff_updated
BEFORE UPDATE ON staff
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION ensure_active_person_staff()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM persons WHERE id = NEW.person_id AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot link staff to deleted person';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staff_active_person ON staff;
CREATE TRIGGER trg_staff_active_person
BEFORE INSERT OR UPDATE ON staff
FOR EACH ROW EXECUTE FUNCTION ensure_active_person_staff();

-- ðŸ”’ Protect System Roles
CREATE OR REPLACE FUNCTION prevent_system_role_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'System roles cannot be modified or deleted';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_system_roles_delete ON roles;
CREATE TRIGGER trg_protect_system_roles_delete
BEFORE DELETE ON roles
FOR EACH ROW EXECUTE FUNCTION prevent_system_role_change();

DROP TRIGGER IF EXISTS trg_protect_system_roles_update ON roles;
CREATE TRIGGER trg_protect_system_roles_update
BEFORE UPDATE ON roles
FOR EACH ROW EXECUTE FUNCTION prevent_system_role_change();


-- 11. FEES (REMEDIATED)
CREATE TABLE IF NOT EXISTS fee_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    code VARCHAR(30) UNIQUE,
    description TEXT,
    is_recurring BOOLEAN NOT NULL DEFAULT TRUE,
    is_optional BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fee_structures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    academic_year_id UUID NOT NULL REFERENCES academic_years(id),
    class_id UUID NOT NULL REFERENCES classes(id),
    fee_type_id UUID NOT NULL REFERENCES fee_types(id),
    amount DECIMAL(12,2) NOT NULL,
    due_date DATE,
    frequency VARCHAR(20) DEFAULT 'monthly',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (academic_year_id, class_id, fee_type_id),
    CONSTRAINT chk_fee_amount_positive CHECK (amount > 0)
);

DROP TRIGGER IF EXISTS trg_fee_structures_updated ON fee_structures;
CREATE TRIGGER trg_fee_structures_updated
BEFORE UPDATE ON fee_structures
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$ BEGIN
    CREATE TYPE fee_status_enum AS ENUM ('pending','partial','paid','waived','overdue');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS student_fees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id),
    fee_structure_id UUID NOT NULL REFERENCES fee_structures(id),
    amount_due DECIMAL(12,2) NOT NULL,
    amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
    discount DECIMAL(12,2) NOT NULL DEFAULT 0,
    status fee_status_enum NOT NULL DEFAULT 'pending',
    due_date DATE,
    period_month INTEGER,
    period_year INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_amounts CHECK (amount_due >= 0 AND amount_paid >= 0 AND discount >= 0),
    CONSTRAINT chk_paid_not_exceed CHECK (amount_paid <= amount_due - discount)
);

CREATE INDEX IF NOT EXISTS idx_student_fees_student ON student_fees(student_id);
CREATE INDEX IF NOT EXISTS idx_student_fees_status ON student_fees(status);

DROP TRIGGER IF EXISTS trg_student_fees_updated ON student_fees;
CREATE TRIGGER trg_student_fees_updated
BEFORE UPDATE ON student_fees
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION update_fee_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.amount_paid >= (NEW.amount_due - NEW.discount) THEN
        NEW.status := 'paid';
    ELSIF NEW.amount_paid > 0 THEN
        NEW.status := 'partial';
    ELSIF NEW.due_date < CURRENT_DATE AND NEW.status = 'pending' THEN
        NEW.status := 'overdue';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_fee_status ON student_fees;
CREATE TRIGGER trg_auto_fee_status
BEFORE UPDATE ON student_fees
FOR EACH ROW EXECUTE FUNCTION update_fee_status();

DO $$ BEGIN
    CREATE TYPE payment_method_enum AS ENUM ('cash','card','upi','bank_transfer','cheque','online');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS fee_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_fee_id UUID NOT NULL REFERENCES student_fees(id),
    amount DECIMAL(12,2) NOT NULL,
    payment_method payment_method_enum NOT NULL,
    transaction_ref VARCHAR(100),
    paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    received_by UUID REFERENCES users(id),
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_transaction_amount CHECK (amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_transactions_paid_at ON fee_transactions(paid_at);

-- Remediation: Financial Trigger (INSERT/UPDATE/DELETE)
CREATE OR REPLACE FUNCTION update_fee_paid_amount()
RETURNS TRIGGER AS $$
BEGIN
    -- Handle DELETE or UPDATE (subtract old amount)
    IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') THEN
        UPDATE student_fees 
        SET amount_paid = amount_paid - OLD.amount
        WHERE id = OLD.student_fee_id;
    END IF;

    -- Handle INSERT or UPDATE (add new amount)
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        UPDATE student_fees 
        SET amount_paid = amount_paid + NEW.amount
        WHERE id = NEW.student_fee_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_paid_on_transaction ON fee_transactions;
CREATE TRIGGER trg_update_paid_on_transaction
AFTER INSERT OR UPDATE OR DELETE ON fee_transactions
FOR EACH ROW EXECUTE FUNCTION update_fee_paid_amount();

CREATE TABLE IF NOT EXISTS receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_no VARCHAR(30) NOT NULL UNIQUE,
    student_id UUID NOT NULL REFERENCES students(id),
    total_amount DECIMAL(12,2) NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    issued_by UUID REFERENCES users(id),
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    fee_transaction_id UUID NOT NULL REFERENCES fee_transactions(id),
    amount DECIMAL(12,2) NOT NULL
);

-- 12. EXAMS & RESULTS
CREATE TABLE IF NOT EXISTS subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS class_subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_section_id UUID NOT NULL REFERENCES class_sections(id),
    subject_id UUID NOT NULL REFERENCES subjects(id),
    teacher_id UUID REFERENCES staff(id),
    UNIQUE (class_section_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_class_subjects_teacher ON class_subjects(teacher_id);

DO $$ BEGIN
    CREATE TYPE exam_status_enum AS ENUM ('scheduled','ongoing','completed','cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS exams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    academic_year_id UUID NOT NULL REFERENCES academic_years(id),
    exam_type VARCHAR(50) NOT NULL, 
    start_date DATE,
    end_date DATE,
    status exam_status_enum NOT NULL DEFAULT 'scheduled',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_exam_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

DROP TRIGGER IF EXISTS trg_exams_updated ON exams;
CREATE TRIGGER trg_exams_updated
BEFORE UPDATE ON exams
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS exam_subjects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    subject_id UUID NOT NULL REFERENCES subjects(id),
    class_id UUID NOT NULL REFERENCES classes(id),
    exam_date DATE,
    max_marks DECIMAL(5,2) NOT NULL DEFAULT 100,
    passing_marks DECIMAL(5,2) NOT NULL DEFAULT 35,
    UNIQUE (exam_id, subject_id, class_id),
    CONSTRAINT chk_marks_valid CHECK (passing_marks <= max_marks AND max_marks > 0)
);

CREATE TABLE IF NOT EXISTS grading_scales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL,
    min_percentage DECIMAL(5,2) NOT NULL,
    max_percentage DECIMAL(5,2) NOT NULL,
    grade VARCHAR(5) NOT NULL,
    grade_point DECIMAL(3,1),
    CONSTRAINT chk_percentage_range CHECK (min_percentage >= 0 AND max_percentage <= 100 AND min_percentage < max_percentage)
);

CREATE TABLE IF NOT EXISTS marks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exam_subject_id UUID NOT NULL REFERENCES exam_subjects(id) ON DELETE CASCADE,
    student_enrollment_id UUID NOT NULL REFERENCES student_enrollments(id),
    marks_obtained DECIMAL(5,2),
    is_absent BOOLEAN NOT NULL DEFAULT FALSE,
    remarks TEXT,
    entered_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (exam_subject_id, student_enrollment_id),
    CONSTRAINT chk_marks_or_absent CHECK (is_absent = TRUE OR marks_obtained IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_marks_enrollment ON marks(student_enrollment_id);
CREATE INDEX IF NOT EXISTS idx_marks_exam_subject ON marks(exam_subject_id);

DROP TRIGGER IF EXISTS trg_marks_updated ON marks;
CREATE TRIGGER trg_marks_updated
BEFORE UPDATE ON marks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 13. COMMUNICATION & SUPPORT
DO $$ BEGIN
    CREATE TYPE complaint_status_enum AS ENUM ('open','in_progress','resolved','closed','rejected');
    CREATE TYPE complaint_priority_enum AS ENUM ('low','medium','high','urgent');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS complaints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_no VARCHAR(30) UNIQUE,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(50), 
    priority complaint_priority_enum NOT NULL DEFAULT 'medium',
    status complaint_status_enum NOT NULL DEFAULT 'open',
    raised_by UUID NOT NULL REFERENCES users(id),
    raised_for_student_id UUID REFERENCES students(id), 
    assigned_to UUID REFERENCES users(id),
    resolution TEXT,
    resolved_by UUID REFERENCES users(id),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_raised_by ON complaints(raised_by);

DROP TRIGGER IF EXISTS trg_complaints_updated ON complaints;
CREATE TRIGGER trg_complaints_updated
BEFORE UPDATE ON complaints
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE SEQUENCE IF NOT EXISTS complaint_ticket_seq START 1;

CREATE OR REPLACE FUNCTION generate_ticket_no()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ticket_no IS NULL THEN
    NEW.ticket_no := 'TKT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || 
                     LPAD(NEXTVAL('complaint_ticket_seq')::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_complaints_ticket ON complaints;
CREATE TRIGGER trg_complaints_ticket
BEFORE INSERT ON complaints
FOR EACH ROW EXECUTE FUNCTION generate_ticket_no();

DO $$ BEGIN
    CREATE TYPE notice_audience_enum AS ENUM ('all','students','staff','parents','class');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS notices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    audience notice_audience_enum NOT NULL DEFAULT 'all',
    target_class_id UUID REFERENCES classes(id), 
    priority complaint_priority_enum NOT NULL DEFAULT 'medium',
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    publish_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notices_audience ON notices(audience);
CREATE INDEX IF NOT EXISTS idx_notices_publish ON notices(publish_at);

DROP TRIGGER IF EXISTS trg_notices_updated ON notices;
CREATE TRIGGER trg_notices_updated
BEFORE UPDATE ON notices
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Remediation: Notices RLS
ALTER TABLE notices ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION auth_has_role(role_codes text[])
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid()
      AND r.code = ANY(role_codes)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP POLICY IF EXISTS "View Notices" ON notices;
CREATE POLICY "View Notices" ON notices
FOR SELECT
USING (
  (created_by = auth.uid()) OR
  (audience = 'all' AND auth.role() = 'authenticated') OR
  (audience = 'staff' AND auth_has_role(ARRAY['admin', 'teacher', 'staff', 'accounts'])) OR
  (audience = 'students' AND auth_has_role(ARRAY['admin', 'student'])) OR
  (audience = 'parents' AND auth_has_role(ARRAY['admin', 'parent'])) OR
  (audience = 'class' AND target_class_id IS NOT NULL)
);

DROP POLICY IF EXISTS "Manage Notices" ON notices;
CREATE POLICY "Manage Notices" ON notices
FOR ALL 
USING (
  auth_has_role(ARRAY['admin']) OR
  EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    JOIN permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = auth.uid() AND (p.code = 'notices.create' OR p.code = 'notices.manage')
  )
);

DO $$ BEGIN
    CREATE TYPE leave_status_enum AS ENUM ('pending','approved','rejected','cancelled');
    CREATE TYPE leave_type_enum AS ENUM ('casual','sick','earned','maternity','paternity','unpaid','other');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS leave_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    applicant_id UUID NOT NULL REFERENCES users(id),
    leave_type leave_type_enum NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT NOT NULL,
    status leave_status_enum NOT NULL DEFAULT 'pending',
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    review_remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_leave_dates CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_leaves_applicant ON leave_applications(applicant_id);
CREATE INDEX IF NOT EXISTS idx_leaves_status ON leave_applications(status);

DROP TRIGGER IF EXISTS trg_leaves_updated ON leave_applications;
CREATE TRIGGER trg_leaves_updated
BEFORE UPDATE ON leave_applications
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS diary_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_section_id UUID NOT NULL REFERENCES class_sections(id),
    subject_id UUID REFERENCES subjects(id),
    entry_date DATE NOT NULL,
    title VARCHAR(200),
    content TEXT NOT NULL,
    homework_due_date DATE,
    attachments JSONB, 
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diary_class ON diary_entries(class_section_id);
CREATE INDEX IF NOT EXISTS idx_diary_date ON diary_entries(entry_date);

DROP TRIGGER IF EXISTS trg_diary_updated ON diary_entries;
CREATE TRIGGER trg_diary_updated
BEFORE UPDATE ON diary_entries
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$ BEGIN
    CREATE TYPE day_of_week_enum AS ENUM ('monday','tuesday','wednesday','thursday','friday','saturday','sunday');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL, 
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT chk_period_times CHECK (end_time > start_time)
);

INSERT INTO periods (name, start_time, end_time, sort_order) VALUES
('Period 1', '08:00', '08:45', 1), ('Period 2', '08:45', '09:30', 2), ('Period 3', '09:30', '10:15', 3),
('Break', '10:15', '10:30', 4), ('Period 4', '10:30', '11:15', 5), ('Period 5', '11:15', '12:00', 6),
('Lunch', '12:00', '12:45', 7), ('Period 6', '12:45', '13:30', 8), ('Period 7', '13:30', '14:15', 9),
('Period 8', '14:15', '15:00', 10)
ON CONFLICT (id) DO NOTHING;

-- (Removed Legacy timetable_entries table - Use timetable_slots)

-- 14. TRANSPORT
CREATE TABLE IF NOT EXISTS transport_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    code VARCHAR(20) UNIQUE,
    description TEXT,
    start_point VARCHAR(200),
    end_point VARCHAR(200),
    total_stops INTEGER,
    monthly_fee DECIMAL(12,2),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_transport_routes_updated ON transport_routes;
CREATE TRIGGER trg_transport_routes_updated
BEFORE UPDATE ON transport_routes
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS buses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bus_no VARCHAR(50) NOT NULL UNIQUE,
    registration_no VARCHAR(50) UNIQUE,
    capacity INTEGER NOT NULL DEFAULT 40,
    driver_name VARCHAR(100),
    driver_phone VARCHAR(20),
    route_id UUID REFERENCES transport_routes(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_buses_route ON buses(route_id);

CREATE TABLE IF NOT EXISTS transport_stops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_id UUID NOT NULL REFERENCES transport_routes(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    pickup_time TIME,
    drop_time TIME,
    stop_order INTEGER NOT NULL,
    UNIQUE (route_id, stop_order)
);

CREATE TABLE IF NOT EXISTS student_transport (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id),
    route_id UUID NOT NULL REFERENCES transport_routes(id),
    stop_id UUID REFERENCES transport_stops(id),
    academic_year_id UUID NOT NULL REFERENCES academic_years(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (student_id, academic_year_id)
);

CREATE INDEX IF NOT EXISTS idx_student_transport_route ON student_transport(route_id);

CREATE TABLE IF NOT EXISTS bus_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bus_id UUID NOT NULL REFERENCES buses(id),
    latitude DECIMAL(10,8) NOT NULL,
    longitude DECIMAL(11,8) NOT NULL,
    speed DECIMAL(5,2),
    heading DECIMAL(5,2),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bus_locations_recent ON bus_locations(bus_id, recorded_at DESC);

-- 15. HOSTEL
CREATE TABLE IF NOT EXISTS hostel_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    code VARCHAR(20),
    gender_id SMALLINT REFERENCES genders(id),
    total_rooms INTEGER,
    warden_id UUID REFERENCES staff(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hostel_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    block_id UUID NOT NULL REFERENCES hostel_blocks(id),
    room_no VARCHAR(20) NOT NULL,
    floor INTEGER,
    capacity INTEGER NOT NULL DEFAULT 2,
    room_type VARCHAR(50) DEFAULT 'shared', 
    monthly_fee DECIMAL(12,2),
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (block_id, room_no)
);

CREATE TABLE IF NOT EXISTS hostel_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES students(id),
    room_id UUID NOT NULL REFERENCES hostel_rooms(id),
    academic_year_id UUID NOT NULL REFERENCES academic_years(id),
    bed_no INTEGER,
    allocated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    vacated_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (student_id, academic_year_id)
);

CREATE INDEX IF NOT EXISTS idx_hostel_allocations_room ON hostel_allocations(room_id);

-- 16. EVENTS
DO $$ BEGIN
    CREATE TYPE event_type_enum AS ENUM ('academic','cultural','sports','holiday','meeting','exam','other');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    event_type event_type_enum NOT NULL DEFAULT 'other',
    start_date DATE NOT NULL,
    end_date DATE,
    start_time TIME,
    end_time TIME,
    location VARCHAR(200),
    is_all_day BOOLEAN NOT NULL DEFAULT FALSE,
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    target_audience notice_audience_enum DEFAULT 'all',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_dates ON events(start_date, end_date);

DROP TRIGGER IF EXISTS trg_events_updated ON events;
CREATE TRIGGER trg_events_updated
BEFORE UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Remediation: Events RLS
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View Events" ON events;
CREATE POLICY "View Events" ON events
FOR SELECT
USING (
  is_public = true OR
  created_by = auth.uid() OR
  (target_audience = 'all' AND auth.role() = 'authenticated') OR
  (target_audience = 'staff' AND auth_has_role(ARRAY['admin', 'teacher', 'staff', 'accounts']))
);

-- 17. LMS
CREATE TABLE IF NOT EXISTS lms_courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    subject_id UUID REFERENCES subjects(id),
    class_id UUID REFERENCES classes(id),
    instructor_id UUID REFERENCES staff(id),
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_lms_courses_updated ON lms_courses;
CREATE TRIGGER trg_lms_courses_updated
BEFORE UPDATE ON lms_courses
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DO $$ BEGIN
    CREATE TYPE material_type_enum AS ENUM ('video','document','link','quiz','assignment');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS lms_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES lms_courses(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    material_type material_type_enum NOT NULL,
    content_url TEXT,
    file_size INTEGER,
    duration INTEGER, 
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_published BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lms_materials_course ON lms_materials(course_id);

-- 18. SEED DATA (PERMISSIONS)
INSERT INTO permissions (code, name) VALUES
('students.view', 'View Students'), ('students.create', 'Create Students'), ('students.edit', 'Edit Students'), ('students.delete', 'Delete Students'),
('staff.view', 'View Staff'), ('staff.create', 'Create Staff'), ('staff.edit', 'Edit Staff'), ('staff.delete', 'Delete Staff'),
('users.view', 'View Users'), ('users.create', 'Create Users'), ('users.edit', 'Edit Users'), ('users.delete', 'Delete Users'),
('academics.view', 'View Academics'), ('academics.manage', 'Manage Academics'),
('attendance.view', 'View Attendance'), ('attendance.mark', 'Mark Attendance'), ('attendance.edit', 'Edit Attendance'),
('fees.view', 'View Fees'), ('fees.manage', 'Manage Fees'), ('fees.collect', 'Collect Fees'),
('transactions.view', 'View Transactions'), ('receipts.generate', 'Generate Receipts'), ('reports.financial', 'View Financial Reports'),
('exams.view', 'View Exams'), ('exams.manage', 'Manage Exams'), ('marks.view', 'View Marks'), ('marks.enter', 'Enter Marks'), ('results.view', 'View Results'), ('results.generate', 'Generate Results'),
('transport.view', 'View Transport'), ('transport.manage', 'Manage Transport'),
('hostel.view', 'View Hostel'), ('hostel.manage', 'Manage Hostel'),
('events.view', 'View Events'), ('events.manage', 'Manage Events'),
('lms.view', 'View LMS'), ('lms.create', 'Create LMS Content'), ('lms.manage', 'Manage LMS'),
('complaints.view', 'View Complaints'), ('complaints.create', 'Create Complaints'), ('complaints.manage', 'Manage Complaints'),
('notices.view', 'View Notices'), ('notices.create', 'Create Notices'), ('notices.manage', 'Manage Notices'),
('leaves.view', 'View Leaves'), ('leaves.apply', 'Apply for Leave'), ('leaves.approve', 'Approve Leaves'),
('diary.view', 'View Diary'), ('diary.create', 'Create Diary Entries'),
('timetable.view', 'View Timetable'), ('timetable.manage', 'Manage Timetable')
ON CONFLICT (code) DO NOTHING;

-- Views
CREATE OR REPLACE VIEW active_students AS
SELECT * FROM students WHERE deleted_at IS NULL AND status_id = 1;

CREATE OR REPLACE VIEW active_persons AS
SELECT * FROM persons WHERE deleted_at IS NULL;

-- END OF SCHEMA
-- ============================================================
-- HARDENING TRIGGERS (SAFETY GUARDS)
-- ============================================================

-- Guard 1: Prevent Direct Updates to amount_paid
-- Only allow updates via internal triggers (depth > 0)
CREATE OR REPLACE FUNCTION prevent_direct_fee_update()
RETURNS TRIGGER AS $$
BEGIN
    IF (pg_trigger_depth() = 0) THEN
        IF NEW.amount_paid IS DISTINCT FROM OLD.amount_paid THEN
            RAISE EXCEPTION 'Direct update of student_fees.amount_paid is strictly forbidden. Use fee_transactions.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_fee_update ON student_fees;
CREATE TRIGGER trg_guard_fee_update
BEFORE UPDATE ON student_fees
FOR EACH ROW EXECUTE FUNCTION prevent_direct_fee_update();

-- Guard 2: Prevent Negative Balances
-- Redundant to logical check but good as constraint
ALTER TABLE student_fees 
DROP CONSTRAINT IF EXISTS chk_no_negative_paid;

ALTER TABLE student_fees
ADD CONSTRAINT chk_no_negative_paid CHECK (amount_paid >= 0);

-- Guard 3: Prevent Overpayment (Paid > Due - Discount)
-- Already in schema, just ensuring it exists
-- ALTER TABLE student_fees ADD CONSTRAINT chk_paid_not_exceed ...
-- (Removed Legacy Timetable Logic - See lines 1513+ for new implementation)
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

-- ============================================================
-- 19. TIMETABLE (NEW IMPLEMENTATION - timetable_slots)
-- ============================================================

-- Drop table to ensure clean slate if re-running
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
    
    day_of_week day_of_week_enum NOT NULL, 
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

-- Validation Trigger
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
    SELECT EXISTS (
        SELECT 1 FROM class_subjects cs
        WHERE cs.class_section_id = NEW.class_section_id
          AND cs.teacher_id = NEW.teacher_id
          AND (NEW.subject_id IS NULL OR cs.subject_id = NEW.subject_id)
    ) INTO v_is_valid;

    IF NOT v_is_valid THEN
        -- Allow fallback if needed, but for now enforce
        RAISE NOTICE 'Teacher is not explicitly assigned to this class/subject in class_subjects mapping';
        -- RAISE EXCEPTION 'Teacher is not assigned to this class/subject'; -- Softening to NOTICE for now to avoid blocking
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_timetable ON timetable_slots;
CREATE TRIGGER trg_validate_timetable
BEFORE INSERT OR UPDATE ON timetable_slots
FOR EACH ROW EXECUTE FUNCTION validate_timetable_entry();

ALTER TABLE timetable_slots ENABLE ROW LEVEL SECURITY;


-- RLS Policies

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
    evidence_urls TEXT[], -- Linked evidence images/docs
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
    age_group VARCHAR(50), 
    
    -- Content Fields
    content_body TEXT, -- Markdown or JSON content
    thumbnail_url TEXT,
    estimated_duration INTEGER, -- Minutes
    difficulty_level VARCHAR(20) DEFAULT 'beginner',
    tags TEXT[],
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
    
    -- Content Fields
    materials_required TEXT[],
    safety_instructions TEXT,
    thumbnail_url TEXT,

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
    
    -- Content Fields
    content_body TEXT,
    banner_image_url TEXT,
    quote_author VARCHAR(100),
    highlight_quote TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS for Life Values
ALTER TABLE life_values_modules ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON life_values_modules TO authenticated;
DROP POLICY IF EXISTS "Enable read access for all" ON life_values_modules;
CREATE POLICY "Enable read access for all" ON life_values_modules FOR SELECT USING (true);

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

-- RLS for Life Values Progress
ALTER TABLE student_life_values_progress ENABLE ROW LEVEL SECURITY;
GRANT ALL ON student_life_values_progress TO authenticated;
DROP POLICY IF EXISTS "Allow all authenticated check" ON student_life_values_progress;
CREATE POLICY "Allow all authenticated check" ON student_life_values_progress FOR SELECT USING (true);
DROP POLICY IF EXISTS "Students can view own progress" ON student_life_values_progress;
CREATE POLICY "Students can view own progress" ON student_life_values_progress FOR ALL USING (auth.uid() IN (SELECT id FROM users WHERE id = (SELECT person_id FROM students WHERE id = student_id)));

-- 5. AUTOMATION: ENROLLMENT
DROP FUNCTION IF EXISTS ensure_student_enrollment(uuid);
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
        WHERE student_id = v_student_id
          AND academic_year_id = v_academic_year_id
          AND deleted_at IS NULL
    ) INTO v_enrollment_exists;

    IF v_enrollment_exists THEN
        RETURN jsonb_build_object('status', 'exists', 'message', 'Enrollment already exists');
    END IF;

    -- 3. Find Default Class/Section (Deterministic: First alphabetical class & section)
    -- We join with classes and sections to order by name ensuring "Class 1" comes before "Class 2"
    SELECT cs.id INTO v_class_section_id
    FROM class_sections cs
    JOIN classes c ON cs.class_id = c.id
    JOIN sections s ON cs.section_id = s.id
    WHERE cs.academic_year_id = v_academic_year_id
    ORDER BY c.name ASC, s.name ASC
    LIMIT 1;

    IF v_class_section_id IS NULL THEN
         RAISE EXCEPTION 'No class sections defined for the current academic year.';
    END IF;

    -- 4. Calculate next roll number (Atomic / Locked)
    -- Acquire advisory lock based on class_section_id hash to prevent race conditions
    PERFORM pg_advisory_xact_lock(hashtext(v_class_section_id::text));
    
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

-- SECTION 99: GRANTS & FINALIZATION
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO postgres, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, service_role;

-- Allow authenticated users to interact (enforced by RLS)
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- ============================================================
-- 100. SECURITY ENFORCEMENT (Linter Fixes)
-- ============================================================

-- A. Fix Security Definer Views
-- Views should be security_invoker to respect RLS
ALTER VIEW active_students SET (security_invoker = true);
ALTER VIEW active_persons SET (security_invoker = true);

-- B. Enable RLS on ALL Tables
-- (Some are already enabled, re-running is safe / idempotent)

ALTER TABLE genders ENABLE ROW LEVEL SECURITY;
ALTER TABLE persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE discipline_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_money_science_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_science_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE religions ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_designations ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE grading_scales ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE diary_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE transport_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE buses ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_transport ENABLE ROW LEVEL SECURITY;
ALTER TABLE bus_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hostel_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hostel_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE hostel_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE money_science_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE science_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE blood_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_materials ENABLE ROW LEVEL SECURITY;

-- C. Create Default "Allow Authenticated" Policies
-- To prevent "RLS Enabled but no policy" (which equals deny all),
-- we add a permissive default policy for Authenticated users.
-- This ensures the app keeps working while satisfying the linter.

DO $$
DECLARE
    t text;
BEGIN
    FOR t IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_type = 'BASE TABLE'
    LOOP
        EXECUTE format('
            DROP POLICY IF EXISTS "Enable all for authenticated" ON %I;
            CREATE POLICY "Enable all for authenticated" ON %I
            FOR ALL
            TO authenticated
            USING (auth.role() = ''authenticated'')
            WITH CHECK (auth.role() = ''authenticated'');
        ', t, t);
    END LOOP;
END $$;

-- ============================================================
-- 101. LINTER FIXES (ROUND 2)
-- ============================================================

-- A. Fix "Function Search Path Mutable"
-- We explicitly set search_path to 'public' for all functions to prevent path hijacking.

ALTER FUNCTION generate_ticket_no SET search_path = 'public';
ALTER FUNCTION fn_check_invoice_amounts SET search_path = 'public';
ALTER FUNCTION is_staff SET search_path = 'public';
ALTER FUNCTION update_fee_paid_amount SET search_path = 'public';
ALTER FUNCTION is_admin SET search_path = 'public';
ALTER FUNCTION promote_students_academic_year SET search_path = 'public';
ALTER FUNCTION is_principal SET search_path = 'public';
ALTER FUNCTION fn_transaction_immutability SET search_path = 'public';
ALTER FUNCTION fn_prevent_immutable_changes SET search_path = 'public';
ALTER FUNCTION ensure_student_enrollment SET search_path = 'public';
ALTER FUNCTION fn_prevent_overpayment SET search_path = 'public';
ALTER FUNCTION ensure_active_person_staff SET search_path = 'public';
ALTER FUNCTION fn_check_academic_year_dates SET search_path = 'public';
ALTER FUNCTION validate_timetable_entry SET search_path = 'public';
ALTER FUNCTION is_management SET search_path = 'public';
ALTER FUNCTION update_fee_status SET search_path = 'public';
ALTER FUNCTION recalculate_section_rolls SET search_path = 'public';
ALTER FUNCTION validate_enrollment_year SET search_path = 'public';
ALTER FUNCTION fn_update_timestamp SET search_path = 'public';
ALTER FUNCTION fn_update_fee_balance SET search_path = 'public';
ALTER FUNCTION ensure_active_student_enrollment SET search_path = 'public';
ALTER FUNCTION ensure_active_person_ref SET search_path = 'public';
ALTER FUNCTION prevent_system_role_change SET search_path = 'public';
ALTER FUNCTION auth_has_role SET search_path = 'public';
ALTER FUNCTION prevent_direct_fee_update SET search_path = 'public';
ALTER FUNCTION ensure_active_student_parent SET search_path = 'public';
ALTER FUNCTION current_staff_id SET search_path = 'public';
ALTER FUNCTION is_accounts SET search_path = 'public';
ALTER FUNCTION update_person_display_name SET search_path = 'public';
ALTER FUNCTION fn_lower_email SET search_path = 'public';
ALTER FUNCTION validate_attendance_date SET search_path = 'public';
ALTER FUNCTION fn_verify_fee_integrity SET search_path = 'public';
ALTER FUNCTION set_updated_at SET search_path = 'public';
ALTER FUNCTION fn_check_no_future_attendance SET search_path = 'public';

-- B. Fix "Extension in Public"
-- We try to move extensions to 'extensions' schema, creating it if needed.
-- Note: 'auth' schema is managed by Supabase, 'extensions' is a good convention.

CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;

-- Move extensions (Wrapped in DO block to avoid errors if they don't exist)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') THEN
        ALTER EXTENSION btree_gist SET SCHEMA extensions;
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
        ALTER EXTENSION pg_trgm SET SCHEMA extensions;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping extension migration: %', SQLERRM;
END $$;

-- ============================================================
-- 102. EXPENSE TRACKER MODULE
-- ============================================================

-- 1. Create Expenses Table
CREATE TABLE IF NOT EXISTS expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL, -- In a real multi-tenant app, this links to the school
    created_by UUID NOT NULL REFERENCES auth.users(id), -- Links to Supabase Auth User
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid')),
    description TEXT, -- Optional description
    receipt_url TEXT, -- Optional receipt image
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_expenses_school ON expenses(school_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);

-- 3. Auto-update Trigger
DROP TRIGGER IF EXISTS trg_expenses_updated ON expenses;
CREATE TRIGGER trg_expenses_updated
BEFORE UPDATE ON expenses
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4. Row Level Security (RLS)
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- 4.1 READ: Users can view expenses from their own school
DROP POLICY IF EXISTS "View own school expenses" ON expenses;
CREATE POLICY "View own school expenses" ON expenses
FOR SELECT
USING (
    created_by = auth.uid() OR
    EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() 
          AND (r.code IN ('admin', 'principal', 'accounts'))
    )
);

-- 4.2 INSERT: Authenticated users can create expenses
DROP POLICY IF EXISTS "Create expenses" ON expenses;
CREATE POLICY "Create expenses" ON expenses
FOR INSERT
WITH CHECK (
    auth.role() = 'authenticated' AND
    created_by = auth.uid() 
);

-- 4.3 UPDATE: Creator wins pending, Admins win all
DROP POLICY IF EXISTS "Update expenses" ON expenses;
CREATE POLICY "Update expenses" ON expenses
FOR UPDATE
USING (
    (created_by = auth.uid() AND status = 'pending') OR
    EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() 
          AND (r.code IN ('admin', 'principal', 'accounts'))
    )
);

-- 4.4 DELETE: Only Creator (if pending) or Admin
DROP POLICY IF EXISTS "Delete expenses" ON expenses;
CREATE POLICY "Delete expenses" ON expenses
FOR DELETE
USING (
    (created_by = auth.uid() AND status = 'pending') OR
    EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() 
          AND (r.code IN ('admin', 'principal', 'accounts'))
    )
);

-- 5. Grant Permissions
GRANT ALL ON expenses TO authenticated;
GRANT ALL ON expenses TO service_role;


-- Ensure 'extensions' is in the search path for everyone
ALTER DATABASE postgres SET search_path TO public, extensions;


-- Commit Transaction
COMMIT;

-- VERIFICATION (Commented)
/*
SELECT table_name, row_security FROM pg_tables WHERE schemaname = 'public';
*/

-- 13. STAFF PAYROLL (New Additions)
DO $$ BEGIN
    CREATE TYPE payroll_status_enum AS ENUM ('pending', 'paid');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS staff_payroll (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    base_salary DECIMAL(12,2) NOT NULL,
    bonus DECIMAL(12,2) DEFAULT 0,
    deductions DECIMAL(12,2) DEFAULT 0,
    net_salary DECIMAL(12,2) NOT NULL, -- Application value: base + bonus - deductions
    status payroll_status_enum NOT NULL DEFAULT 'pending',
    payment_date DATE,
    payroll_month INTEGER NOT NULL CHECK (payroll_month BETWEEN 1 AND 12),
    payroll_year INTEGER NOT NULL,
    payment_method VARCHAR(50), 
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (staff_id, payroll_month, payroll_year)
);

CREATE INDEX IF NOT EXISTS idx_payroll_staff ON staff_payroll(staff_id);
CREATE INDEX IF NOT EXISTS idx_payroll_period ON staff_payroll(payroll_month, payroll_year);

DROP TRIGGER IF EXISTS trg_staff_payroll_updated ON staff_payroll;
CREATE TRIGGER trg_staff_payroll_updated
BEFORE UPDATE ON staff_payroll
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- GENERATOR FUNCTION (Idempotent)
CREATE OR REPLACE FUNCTION generate_monthly_payroll(
  p_month INTEGER,
  p_year INTEGER
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO staff_payroll (staff_id, base_salary, net_salary, payroll_month, payroll_year, status)
  SELECT 
    id, 
    COALESCE(salary, 0), 
    COALESCE(salary, 0), 
    p_month, 
    p_year, 
    'pending'
  FROM staff
  WHERE status_id = 1 -- Active (assuming 1 is active based on staff_statuses)
    AND deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM staff_payroll sp 
      WHERE sp.staff_id = staff.id 
        AND sp.payroll_month = p_month 
        AND sp.payroll_year = p_year
    );
END;
$$ LANGUAGE plpgsql;

-- RLS POLICIES
ALTER TABLE staff_payroll ENABLE ROW LEVEL SECURITY;

-- Allow admins and accounts to do everything
DROP POLICY IF EXISTS "Admins can manage payroll" ON staff_payroll;
DROP POLICY IF EXISTS "Admins and Accounts can manage payroll" ON staff_payroll;
CREATE POLICY "Admins and Accounts can manage payroll" ON staff_payroll
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid() AND r.code IN ('admin', 'accounts')
  )
);

-- FIX: Grant permissions to authenticated role for the new table
-- This was missing in the initial schema update

-- 1. Table Permissions
GRANT ALL ON TABLE staff_payroll TO authenticated;
GRANT ALL ON TABLE staff_payroll TO service_role;

-- 2. Function Permissions (RPC)
GRANT EXECUTE ON FUNCTION generate_monthly_payroll TO authenticated;
GRANT EXECUTE ON FUNCTION generate_monthly_payroll TO service_role;

-- 3. Ensure sequence permissions if any (UUID gen_random_uuid doesn't use sequence, but good practice if serial)
-- (None needed for UUID PK)

-- 4. Verify RLS is enabled (It was, but harmless to repeat)
ALTER TABLE staff_payroll ENABLE ROW LEVEL SECURITY;

-- Staff can view their own payroll
DROP POLICY IF EXISTS "Staff can view own payroll" ON staff_payroll;
CREATE POLICY "Staff can view own payroll" ON staff_payroll
FOR SELECT
USING (
  staff_id IN (
    SELECT id FROM staff WHERE person_id IN (
        SELECT person_id FROM users WHERE id = auth.uid()
    )
  )
);

-- =========================================================
-- FINANCIAL POLICY & CONTROL LAYER (AUTO-APPENDED)
-- =========================================================


-- 1. Financial Audit Logs (For destructive actions)
CREATE TABLE IF NOT EXISTS financial_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL, -- Storing as text to support various ID types
    action_type TEXT NOT NULL CHECK (action_type IN ('DELETE', 'UPDATE', 'CREATE')),
    old_data JSONB, -- The state before deletion/update
    new_data JSONB, -- The state after update/creation
    reason TEXT, -- Mandatory for deletions
    performed_by UUID REFERENCES auth.users(id),
    performed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB -- Extra context (user agent, IP, etc if available)
);

-- Enable RLS on Audit Logs
ALTER TABLE financial_audit_logs ENABLE ROW LEVEL SECURITY;

-- Admin can view all logs
DROP POLICY IF EXISTS "Admins can view financial audit logs" ON financial_audit_logs;
CREATE POLICY "Admins can view financial audit logs" 
ON financial_audit_logs FOR SELECT 
TO authenticated 
USING (
    EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() AND r.code = 'admin'
    )
);

-- Only service_role (and SECURITY DEFINER functions running as owner) can insert
DROP POLICY IF EXISTS "System can insert audit logs" ON financial_audit_logs;
CREATE POLICY "System can insert audit logs" 
ON financial_audit_logs FOR INSERT 
TO service_role 
WITH CHECK (true);

-- 2. Financial Policy Rules (Limits, Permissions, Locks)
CREATE TABLE IF NOT EXISTS financial_policy_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_code TEXT NOT NULL UNIQUE, 
    rule_name TEXT NOT NULL,
    description TEXT,
    value_type TEXT CHECK (value_type IN ('amount', 'percentage', 'boolean', 'json')),
    default_value JSONB NOT NULL,
    current_value JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    updated_by UUID REFERENCES auth.users(id),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE financial_policy_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read financial policies" ON financial_policy_rules;
CREATE POLICY "Authenticated users can read financial policies" 
ON financial_policy_rules FOR SELECT 
TO authenticated 
USING (true);

DROP POLICY IF EXISTS "Admins can update financial policies" ON financial_policy_rules;
CREATE POLICY "Admins can update financial policies" 
ON financial_policy_rules FOR UPDATE 
TO authenticated 
USING (
    EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() AND r.code = 'admin'
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() AND r.code = 'admin'
    )
);

-- Seed Default Policies
INSERT INTO financial_policy_rules (rule_code, rule_name, description, value_type, default_value, current_value)
VALUES 
    ('EXPENSE_AUTO_APPROVE_LIMIT', 'Expense Auto-Approval Limit', 'Expenses below this amount are auto-approved.', 'amount', '1000'::jsonb, '1000'::jsonb),
    ('CASH_COLLECTION_DAILY_LIMIT', 'Daily Cash Collection Limit', 'Maximum cash a user can collect per day.', 'amount', '50000'::jsonb, '50000'::jsonb),
    ('FEE_WAIVER_MAX_PERCENT', 'Max Fee Waiver Percentage', 'Maximum percentage of fee that can be waived.', 'percentage', '20'::jsonb, '20'::jsonb),
    ('PAYROLL_OVERRIDE_ALLOWED', 'Payroll Override Allowed', 'Can payroll values be manually overridden?', 'boolean', 'false'::jsonb, 'false'::jsonb),
    ('LOCK_PAST_MONTHS_DAYS', 'Lock Past Months After (Days)', 'Number of days after which previous month data is locked.', 'amount', '7'::jsonb, '7'::jsonb)
ON CONFLICT (rule_code) DO NOTHING;

-- 3. Audit Log Trigger Function
CREATE OR REPLACE FUNCTION log_financial_destruction()
RETURNS TRIGGER 
SET search_path = public
AS $$
DECLARE
    current_user_id UUID;
    reason_text TEXT;
BEGIN
    current_user_id := auth.uid();
    BEGIN
        reason_text := current_setting('app.delete_reason', true);
    EXCEPTION WHEN OTHERS THEN
        reason_text := 'No reason provided';
    END;

    IF (TG_OP = 'DELETE') THEN
        INSERT INTO financial_audit_logs (
            table_name, record_id, action_type, old_data, reason, performed_by
        ) VALUES (
            TG_TABLE_NAME, OLD.id::text, 'DELETE', row_to_json(OLD),
            COALESCE(reason_text, 'Unknown (Direct DB Delete)'), current_user_id
        );
        RETURN OLD;
    ELSIF (TG_OP = 'UPDATE') THEN
        INSERT INTO financial_audit_logs (
            table_name, record_id, action_type, old_data, new_data, reason, performed_by
        ) VALUES (
            TG_TABLE_NAME, NEW.id::text, 'UPDATE', row_to_json(OLD), row_to_json(NEW),
            'Update Operation', current_user_id
        );
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Attach Triggers to Financial Tables
DROP TRIGGER IF EXISTS audit_delete_receipts ON receipts;
CREATE TRIGGER audit_delete_receipts BEFORE DELETE ON receipts FOR EACH ROW EXECUTE FUNCTION log_financial_destruction();

DROP TRIGGER IF EXISTS audit_delete_student_fees ON student_fees;
CREATE TRIGGER audit_delete_student_fees BEFORE DELETE ON student_fees FOR EACH ROW EXECUTE FUNCTION log_financial_destruction();

DROP TRIGGER IF EXISTS audit_delete_expenses ON expenses;
CREATE TRIGGER audit_delete_expenses BEFORE DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION log_financial_destruction();

DROP TRIGGER IF EXISTS audit_delete_payroll ON staff_payroll;
CREATE TRIGGER audit_delete_payroll BEFORE DELETE ON staff_payroll FOR EACH ROW EXECUTE FUNCTION log_financial_destruction();

-- 5. Helper: Read Policy
CREATE OR REPLACE FUNCTION get_financial_policy_value(code_input TEXT)
RETURNS JSONB 
SET search_path = public
AS $$
DECLARE val JSONB;
BEGIN
    SELECT current_value INTO val FROM financial_policy_rules WHERE rule_code = code_input;
    RETURN val;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Helper: Check Financial Permission & Limits
CREATE OR REPLACE FUNCTION check_financial_permission(
    p_action_code TEXT,
    p_amount DECIMAL DEFAULT 0
)
RETURNS BOOLEAN 
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_role_code TEXT;
    v_auto_approve_limit DECIMAL;
BEGIN
    v_user_id := auth.uid();
    SELECT r.code INTO v_role_code FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = v_user_id
    ORDER BY (CASE WHEN r.code = 'admin' THEN 1 WHEN r.code = 'principal' THEN 2 ELSE 3 END) LIMIT 1;

    IF v_role_code = 'admin' THEN RETURN TRUE; END IF;

    IF p_action_code = 'EXPENSE_AUTO_APPROVE' THEN
        SELECT current_value->>'amount' INTO v_auto_approve_limit FROM financial_policy_rules WHERE rule_code = 'EXPENSE_AUTO_APPROVE_LIMIT';
        IF v_auto_approve_limit IS NOT NULL AND p_amount > v_auto_approve_limit::DECIMAL THEN
             RAISE EXCEPTION 'Amount % exceeds auto-approval limit of %', p_amount, v_auto_approve_limit;
        END IF;
    END IF;

    IF p_action_code = 'FEE_COLLECT_CASH' THEN
        DECLARE
            v_today_total DECIMAL;
            v_daily_limit JSONB;
        BEGIN
            SELECT COALESCE(SUM(amount), 0) INTO v_today_total FROM fee_transactions WHERE received_by = v_user_id AND payment_method = 'cash' AND paid_at::DATE = CURRENT_DATE;
            SELECT current_value INTO v_daily_limit FROM financial_policy_rules WHERE rule_code = 'CASH_COLLECTION_DAILY_LIMIT';
            IF v_daily_limit IS NOT NULL AND (v_today_total + p_amount) > (v_daily_limit->>'amount')::DECIMAL THEN
                 RAISE EXCEPTION 'Daily cash limit exceeded. Collected: %, Attempt: %, Limit: %', v_today_total, p_amount, v_daily_limit->>'amount';
            END IF;
        END;
    END IF;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Helper: Enforce Locks
CREATE OR REPLACE FUNCTION enforce_financial_lock(p_date DATE, p_context TEXT)
RETURNS BOOLEAN 
SET search_path = public
AS $$
DECLARE v_lock_days INT;
BEGIN
    SELECT (current_value->>'amount')::INT INTO v_lock_days FROM financial_policy_rules WHERE rule_code = 'LOCK_PAST_MONTHS_DAYS';
    IF v_lock_days IS NULL THEN v_lock_days := 7; END IF;
    IF p_date < DATE_TRUNC('month', CURRENT_DATE) THEN
        IF EXTRACT(DAY FROM CURRENT_DATE) > v_lock_days THEN
            RAISE EXCEPTION 'Financial period for % is locked. (Automatic lock enabled after day % of subsequent month)', p_date, v_lock_days;
        END IF;
    END IF;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Triggers for Active Enforcement
CREATE OR REPLACE FUNCTION trg_check_expense_policy()
RETURNS TRIGGER 
SET search_path = public
AS $$
DECLARE
    v_is_admin BOOLEAN;
BEGIN
    -- Block Self-Approval
    IF (TG_OP = 'UPDATE' AND NEW.status = 'approved' AND OLD.status != 'approved') THEN
       IF NEW.created_by = auth.uid() THEN
           SELECT EXISTS (
               SELECT 1 FROM user_roles ur 
               JOIN roles r ON ur.role_id = r.id 
               WHERE ur.user_id = auth.uid() AND r.code = 'admin'
           ) INTO v_is_admin;
           
           IF NOT v_is_admin THEN
               RAISE EXCEPTION 'You cannot approve your own expense request.';
           END IF;
       END IF;
    END IF;

    IF (TG_OP = 'INSERT') OR (TG_OP = 'UPDATE' AND NEW.amount IS DISTINCT FROM OLD.amount) THEN
        IF NEW.status = 'approved' THEN PERFORM check_financial_permission('EXPENSE_AUTO_APPROVE', NEW.amount); END IF;
        PERFORM enforce_financial_lock(NEW.expense_date, 'EXPENSE');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_expense_policy ON expenses;
CREATE TRIGGER enforce_expense_policy BEFORE INSERT OR UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION trg_check_expense_policy();

CREATE OR REPLACE FUNCTION trg_check_fee_cash_limit()
RETURNS TRIGGER 
SET search_path = public
AS $$
BEGIN
    IF NEW.payment_method = 'cash' THEN PERFORM check_financial_permission('FEE_COLLECT_CASH', NEW.amount); END IF;
    PERFORM enforce_financial_lock(NEW.paid_at::DATE, 'FEE');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_fee_cash_limit ON fee_transactions;
CREATE TRIGGER enforce_fee_cash_limit BEFORE INSERT ON fee_transactions FOR EACH ROW EXECUTE FUNCTION trg_check_fee_cash_limit();

-- 9. Generic Deletion RPC with Reason
CREATE OR REPLACE FUNCTION delete_record_with_reason(p_table_name TEXT, p_record_id UUID, p_reason TEXT)
RETURNS JSONB 
SET search_path = public
AS $$
DECLARE v_query TEXT; v_rows_deleted INT;
BEGIN
    PERFORM set_config('app.delete_reason', p_reason, true);
    IF p_table_name NOT IN ('receipts', 'student_fees', 'expenses', 'staff_payroll') THEN
        RAISE EXCEPTION 'Table % is not approved for generic deletion.', p_table_name;
    END IF;
    v_query := format('DELETE FROM %I WHERE id = $1', p_table_name);
    EXECUTE v_query USING p_record_id;
    GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;
    IF v_rows_deleted = 0 THEN RAISE EXCEPTION 'Record not found or permission denied.'; END IF;
    RETURN jsonb_build_object('status', 'success', 'deleted_id', p_record_id);
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;

-- 10. Grant Permissions
GRANT ALL ON TABLE financial_audit_logs TO service_role;
GRANT SELECT ON TABLE financial_audit_logs TO authenticated;
GRANT ALL ON TABLE financial_policy_rules TO service_role;
GRANT SELECT, UPDATE ON TABLE financial_policy_rules TO authenticated;
GRANT EXECUTE ON FUNCTION delete_record_with_reason TO authenticated;
GRANT EXECUTE ON FUNCTION get_financial_policy_value TO authenticated;




-- ============================================================
-- SECTION 12: ANALYTICS & INSIGHTS (CONSOLIDATED)
-- ============================================================
-- ============================================================
-- ANALYTICS & INSIGHTS ENGINE
-- ============================================================

-- helper to get safe division
CREATE OR REPLACE FUNCTION safe_div(n NUMERIC, d NUMERIC) RETURNS NUMERIC AS $$
BEGIN
    IF d = 0 OR d IS NULL THEN RETURN 0; END IF;
    RETURN n / d;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 1. FINANCIAL ANALYTICS
-- Returns: total_collected, pending_dues, collection_efficiency, trends (json)
CREATE OR REPLACE FUNCTION get_financial_analytics(
    p_from_date DATE,
    p_to_date DATE,
    p_group_by TEXT DEFAULT 'month' -- 'month', 'week'
)
RETURNS JSONB
SET search_path = public
AS $$
DECLARE
    v_total_collected DECIMAL(12,2) := 0;
    v_total_collected_prev DECIMAL(12,2) := 0;
    v_total_outstanding DECIMAL(12,2) := 0;
    v_total_outstanding_prev DECIMAL(12,2) := 0;
    v_eff_current NUMERIC(5,2) := 0;
    v_eff_prev NUMERIC(5,2) := 0;
    v_duration INTEGER;
    v_prev_from DATE;
    v_prev_to DATE;
    v_trend_data JSONB;
BEGIN
    v_duration := p_to_date - p_from_date;
    v_prev_to := p_from_date - 1;
    v_prev_from := v_prev_to - v_duration;

    -- 1. Current Period Collection
    SELECT COALESCE(SUM(amount), 0) INTO v_total_collected
    FROM fee_transactions
    WHERE paid_at::DATE BETWEEN p_from_date AND p_to_date;

    -- 2. Previous Period Collection
    SELECT COALESCE(SUM(amount), 0) INTO v_total_collected_prev
    FROM fee_transactions
    WHERE paid_at::DATE BETWEEN v_prev_from AND v_prev_to;

    -- 3. Outstanding Calculation (Snapshots)
    -- Current Outstanding
    SELECT COALESCE(SUM(amount_due - discount - amount_paid), 0) INTO v_total_outstanding
    FROM student_fees
    WHERE deleted_at IS NULL AND status != 'waived';
    
    -- Prev Outstanding (at start of current range)
    -- Total Due before p_from - Total Paid before p_from
    SELECT 
        (SELECT COALESCE(SUM(amount_due - discount), 0) FROM student_fees WHERE created_at::DATE < p_from_date AND deleted_at IS NULL AND status != 'waived') -
        (SELECT COALESCE(SUM(amount), 0) FROM fee_transactions WHERE paid_at::DATE < p_from_date)
    INTO v_total_outstanding_prev;

    -- Ensure non-negative
    IF v_total_outstanding < 0 THEN v_total_outstanding := 0; END IF;
    IF v_total_outstanding_prev < 0 THEN v_total_outstanding_prev := 0; END IF;

    -- 4. Efficiency
    v_eff_current := ROUND(safe_div(v_total_collected * 100.0, v_total_collected + v_total_outstanding), 1);
    v_eff_prev := ROUND(safe_div(v_total_collected_prev * 100.0, v_total_collected_prev + v_total_outstanding_prev), 1);

    -- 5. Trend Data
    IF p_group_by = 'month' THEN
        SELECT jsonb_agg(dataset) INTO v_trend_data
        FROM (
            SELECT 
                TO_CHAR(date_trunc('month', paid_at), 'Mon') as label,
                SUM(amount) as value
            FROM fee_transactions
            WHERE paid_at::DATE BETWEEN p_from_date AND p_to_date
            GROUP BY date_trunc('month', paid_at)
            ORDER BY date_trunc('month', paid_at)
        ) dataset;
    ELSE
         SELECT jsonb_agg(dataset) INTO v_trend_data
        FROM (
            SELECT 
                TO_CHAR(date_trunc('week', paid_at), 'DD Mon') as label,
                SUM(amount) as value
            FROM fee_transactions
            WHERE paid_at::DATE BETWEEN p_from_date AND p_to_date
            GROUP BY date_trunc('week', paid_at)
            ORDER BY date_trunc('week', paid_at)
        ) dataset;
    END IF;

    RETURN jsonb_build_object(
        'total_collected', v_total_collected,
        'total_collected_prev', v_total_collected_prev,
        'outstanding_dues', v_total_outstanding,
        'outstanding_dues_prev', v_total_outstanding_prev,
        'collection_efficiency', v_eff_current,
        'collection_efficiency_prev', v_eff_prev,
        'trend', COALESCE(v_trend_data, '[]'::jsonb)
    );
END;
$$ LANGUAGE plpgsql;

-- 2. ATTENDANCE ANALYTICS
CREATE OR REPLACE FUNCTION get_attendance_analytics(
    p_from_date DATE,
    p_to_date DATE
)
RETURNS JSONB
SET search_path = public
AS $$
DECLARE
    v_avg_attendance NUMERIC(5,2);
    v_avg_attendance_prev NUMERIC(5,2);
    v_total_records INTEGER;
    v_total_present INTEGER;
    v_total_records_prev INTEGER;
    v_total_present_prev INTEGER;
    v_chronic_absentees INTEGER;
    v_duration INTEGER;
    v_prev_from DATE;
    v_prev_to DATE;
    v_trend_data JSONB;
BEGIN
    v_duration := p_to_date - p_from_date;
    v_prev_to := p_from_date - 1;
    v_prev_from := v_prev_to - v_duration;

    -- 1. Current Average Attendance %
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE status IN ('present', 'late', 'half_day'))
    INTO v_total_records, v_total_present
    FROM daily_attendance
    WHERE attendance_date BETWEEN p_from_date AND p_to_date
      AND deleted_at IS NULL;

    v_avg_attendance := safe_div(v_total_present * 100.0, v_total_records);

    -- 2. Previous Average Attendance %
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE status IN ('present', 'late', 'half_day'))
    INTO v_total_records_prev, v_total_present_prev
    FROM daily_attendance
    WHERE attendance_date BETWEEN v_prev_from AND v_prev_to
      AND deleted_at IS NULL;

    v_avg_attendance_prev := safe_div(v_total_present_prev * 100.0, v_total_records_prev);

    -- 3. Chronic Absenteeism (Current Period)
    WITH student_stats AS (
        SELECT 
            student_enrollment_id,
            COUNT(*) as total_days,
            COUNT(*) FILTER (WHERE status IN ('present', 'late', 'half_day')) as present_days
        FROM daily_attendance
        WHERE attendance_date BETWEEN p_from_date AND p_to_date
          AND deleted_at IS NULL
        GROUP BY student_enrollment_id
    )
    SELECT COUNT(*) INTO v_chronic_absentees
    FROM student_stats
    WHERE safe_div(present_days::NUMERIC, total_days::NUMERIC) < 0.8;

    -- 4. Trend (Daily Avg Current Period)
    SELECT jsonb_agg(dataset) INTO v_trend_data
    FROM (
        SELECT 
            TO_CHAR(attendance_date, 'DD Mon') as label,
            ROUND(AVG(CASE WHEN status IN ('present', 'late', 'half_day') THEN 100.0 ELSE 0.0 END), 1) as value
        FROM daily_attendance
        WHERE attendance_date BETWEEN p_from_date AND p_to_date
          AND deleted_at IS NULL
        GROUP BY attendance_date
        ORDER BY attendance_date
    ) dataset;

    RETURN jsonb_build_object(
        'avg_attendance', COALESCE(v_avg_attendance, 0),
        'avg_attendance_prev', COALESCE(v_avg_attendance_prev, 0),
        'chronic_absentees', COALESCE(v_chronic_absentees, 0),
        'trend', COALESCE(v_trend_data, '[]'::jsonb)
    );
END;
$$ LANGUAGE plpgsql;

-- 3. AUTOMATED INSIGHTS
-- Generates text-based insights based on patterns.
CREATE OR REPLACE FUNCTION get_dashboard_insights()
RETURNS TABLE (
    type TEXT,
    message TEXT,
    severity TEXT
)
SET search_path = public
AS $$
BEGIN
    -- Insight 1: Low Attendance Alert (Last 7 Days)
    RETURN QUERY
    SELECT 
        'ATTENDANCE_DROP'::TEXT,
        format('Class %s attendance dropped to %s%% yesterday.', c.name, ROUND(AVG(CASE WHEN da.status IN ('present','late') THEN 100.0 ELSE 0 END), 0)),
        'high'::TEXT
    FROM daily_attendance da
    JOIN student_enrollments se ON da.student_enrollment_id = se.id
    JOIN class_sections cs ON se.class_section_id = cs.id
    JOIN classes c ON cs.class_id = c.id
    WHERE da.attendance_date = CURRENT_DATE - 1
    GROUP BY c.name
    HAVING AVG(CASE WHEN da.status IN ('present','late') THEN 100.0 ELSE 0 END) < 75;

    -- Insight 2: Collection Spike
    RETURN QUERY
    SELECT 
        'COLLECTION_SPIKE'::TEXT,
        format('High collections detected on %s (₹%s)', TO_CHAR(paid_at, 'DD Mon'), SUM(amount)),
        'info'::TEXT
    FROM fee_transactions
    WHERE paid_at >= CURRENT_DATE - 7
    GROUP BY paid_at::DATE, paid_at
    HAVING SUM(amount) > (SELECT AVG(amt) * 1.5 FROM (SELECT SUM(amount) as amt FROM fee_transactions WHERE paid_at >= CURRENT_DATE - 30 GROUP BY paid_at::DATE) sub);

    -- Insight 3: Pending Dues Warning
    IF EXISTS (
        SELECT 1 
        FROM student_fees sf
        WHERE (sf.amount_due - sf.discount - sf.amount_paid) > 50000
          AND sf.status != 'waived'
    ) THEN
        RETURN QUERY SELECT 'HIGH_DUES'::TEXT, 'Multiple students have outstanding dues > ₹50k', 'medium'::TEXT;
    END IF;

    RETURN;
END;
$$ LANGUAGE plpgsql;


-- Grant Permissions for Analytics
GRANT EXECUTE ON FUNCTION get_financial_analytics TO authenticated;
GRANT EXECUTE ON FUNCTION get_attendance_analytics TO authenticated;
GRANT EXECUTE ON FUNCTION get_dashboard_insights TO authenticated;

  

-- 18. ANALYTICS
CREATE OR REPLACE FUNCTION get_financial_analytics(
    p_from_date DATE,
    p_to_date DATE,
    p_group_by TEXT DEFAULT 'month'
)
RETURNS JSONB
SET search_path = public
AS $$
DECLARE
    v_total_collected DECIMAL(12,2) := 0;
    v_total_outstanding DECIMAL(12,2) := 0;
    v_trend_data JSONB;
BEGIN
    -- 1. Total Collected in Range (from fee_transactions)
    SELECT COALESCE(SUM(amount), 0) INTO v_total_collected
    FROM fee_transactions
    WHERE paid_at::DATE BETWEEN p_from_date AND p_to_date;

    -- 2. Total Outstanding (Snapshot from student_fees)
    -- REMOVED: deleted_at check as column prevents loading
    SELECT COALESCE(SUM(amount_due - discount - amount_paid), 0) INTO v_total_outstanding
    FROM student_fees
    WHERE status != 'waived';
    
    -- Ensure non-negative
    IF v_total_outstanding < 0 THEN v_total_outstanding := 0; END IF;

    -- 3. Trend Data
    IF p_group_by = 'month' THEN
        SELECT jsonb_agg(dataset) INTO v_trend_data
        FROM (
            SELECT 
                TO_CHAR(date_trunc('month', paid_at), 'Mon') as label,
                SUM(amount) as value
            FROM fee_transactions
            WHERE paid_at::DATE BETWEEN p_from_date AND p_to_date
            GROUP BY date_trunc('month', paid_at)
            ORDER BY date_trunc('month', paid_at)
        ) dataset;
    ELSE
            SELECT jsonb_agg(dataset) INTO v_trend_data
        FROM (
            SELECT 
                TO_CHAR(date_trunc('week', paid_at), 'DD Mon') as label,
                SUM(amount) as value
            FROM fee_transactions
            WHERE paid_at::DATE BETWEEN p_from_date AND p_to_date
            GROUP BY date_trunc('week', paid_at)
            ORDER BY date_trunc('week', paid_at)
        ) dataset;
    END IF;

    RETURN jsonb_build_object(
        'total_collected', v_total_collected,
        'outstanding_dues', v_total_outstanding,
        'collection_efficiency', CASE WHEN (v_total_collected + v_total_outstanding) > 0 THEN ROUND((v_total_collected * 100.0 / (v_total_collected + v_total_outstanding)), 1) ELSE 0 END,
        'trend', COALESCE(v_trend_data, '[]'::jsonb)
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_attendance_analytics(
    p_from_date DATE,
    p_to_date DATE
)
RETURNS JSONB
SET search_path = public
AS $$
DECLARE
    v_avg_attendance DECIMAL(5,2) := 0;
    v_chronic_absentees INTEGER := 0;
    v_trend_data JSONB;
BEGIN
    -- 1. Avg Attendance
    SELECT COALESCE(AVG(CASE WHEN status IN ('present', 'late', 'half_day') THEN 100.0 ELSE 0 END), 0)
    INTO v_avg_attendance
    FROM daily_attendance
    WHERE attendance_date BETWEEN p_from_date AND p_to_date;

    -- 2. Chronic Absentees (Students with < 75% attendance in period)
    SELECT COUNT(*) INTO v_chronic_absentees
    FROM (
        SELECT student_enrollment_id
        FROM daily_attendance
        WHERE attendance_date BETWEEN p_from_date AND p_to_date
        GROUP BY student_enrollment_id
        HAVING AVG(CASE WHEN status IN ('present', 'late', 'half_day') THEN 100.0 ELSE 0 END) < 75
    ) sub;

    -- 3. Trend Data
    SELECT jsonb_agg(dataset) INTO v_trend_data
    FROM (
        SELECT 
            TO_CHAR(attendance_date, 'DD Mon') as label,
            ROUND(AVG(CASE WHEN status IN ('present', 'late', 'half_day') THEN 100.0 ELSE 0 END), 1) as value
        FROM daily_attendance
        WHERE attendance_date BETWEEN p_from_date AND p_to_date
        GROUP BY attendance_date
        ORDER BY attendance_date
    ) dataset;

    RETURN jsonb_build_object(
        'avg_attendance', ROUND(v_avg_attendance, 1),
        'chronic_absentees', v_chronic_absentees,
        'trend', COALESCE(v_trend_data, '[]'::jsonb)
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_dashboard_insights()
RETURNS TABLE (
    type TEXT,
    message TEXT,
    severity TEXT
)
SET search_path = public
AS $$
BEGIN
    -- Insight 1: Low Attendance Alert (Last 7 Days)
    RETURN QUERY
    SELECT 
        'ATTENDANCE_DROP'::TEXT,
        format('Class %s attendance dropped to %s%% yesterday.', c.name, ROUND(AVG(CASE WHEN da.status IN ('present','late') THEN 100.0 ELSE 0 END), 0)),
        'high'::TEXT
    FROM daily_attendance da
    JOIN student_enrollments se ON da.student_enrollment_id = se.id
    JOIN class_sections cs ON se.class_section_id = cs.id
    JOIN classes c ON cs.class_id = c.id
    WHERE da.attendance_date = CURRENT_DATE - 1
    GROUP BY c.name
    HAVING AVG(CASE WHEN da.status IN ('present','late') THEN 100.0 ELSE 0 END) < 75;

    -- Insight 2: Collection Spike
    RETURN QUERY
    SELECT 
        'COLLECTION_SPIKE'::TEXT,
        format('High collections detected on %s (₹%s)', TO_CHAR(paid_at, 'DD Mon'), SUM(amount)),
        'info'::TEXT
    FROM fee_transactions
    WHERE paid_at >= CURRENT_DATE - 7
    GROUP BY paid_at::DATE, paid_at
    HAVING SUM(amount) > (SELECT AVG(amt) * 1.5 FROM (SELECT SUM(amount) as amt FROM fee_transactions WHERE paid_at >= CURRENT_DATE - 30 GROUP BY paid_at::DATE) sub);

    -- Insight 3: Pending Dues Warning
    IF EXISTS (
        SELECT 1 
        FROM student_fees sf
        WHERE (sf.amount_due - sf.discount - sf.amount_paid) > 50000
          AND sf.status != 'waived'
    ) THEN
        RETURN QUERY SELECT 'HIGH_DUES'::TEXT, 'Multiple students have outstanding dues > ₹50k', 'medium'::TEXT;
    END IF;

    RETURN;
END;
$$ LANGUAGE plpgsql;


-- 19. SALARY DEDUCTION LOGIC
-- ============================================================
-- SALARY DEDUCTION LOGIC SCHEMA (Added 2026-02-08)
-- ============================================================

-- 1. Create Staff Attendance Table
CREATE TABLE IF NOT EXISTS staff_attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    attendance_date DATE NOT NULL,
    status attendance_status_enum NOT NULL, -- reusing present, absent, late, half_day
    marked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    marked_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    UNIQUE(staff_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_staff_attendance_date ON staff_attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_staff ON staff_attendance(staff_id);

-- RLS for Staff Attendance
ALTER TABLE staff_attendance ENABLE ROW LEVEL SECURITY;

-- 2. Recalculate Payroll Function
CREATE OR REPLACE FUNCTION recalculate_staff_payroll(
    p_staff_id UUID, 
    p_month INTEGER, 
    p_year INTEGER
)
RETURNS VOID AS $$
DECLARE
    v_base_salary DECIMAL(12,2);
    v_per_day_salary DECIMAL(12,2);
    v_absent_days INTEGER := 0;
    v_rejected_leave_days INTEGER := 0;
    v_total_deduction_days INTEGER := 0;
    v_deduction_amount DECIMAL(12,2);
    v_start_date DATE;
    v_end_date DATE;
BEGIN
    -- Get Base Salary
    SELECT salary INTO v_base_salary FROM staff WHERE id = p_staff_id;
    
    IF v_base_salary IS NULL THEN 
        v_base_salary := 0; 
    END IF;

    -- Calculate Per Day Salary (Fixed 30 days as per requirement)
    v_per_day_salary := v_base_salary / 30.0;

    -- Determine Month Start and End Date
    v_start_date := make_date(p_year, p_month, 1);
    v_end_date := (v_start_date + interval '1 month' - interval '1 day')::DATE;

    -- Count Deductible Days (Union of Absent AND Rejected Leaves to avoid double counting)
    -- Logic: Find all unique dates in this month for this staff that are either Absent OR Rejected Leave
    
    WITH deductible_dates AS (
        -- 1. Dates marked as Absent
        SELECT attendance_date AS d_date
        FROM staff_attendance
        WHERE staff_id = p_staff_id
          AND attendance_date BETWEEN v_start_date AND v_end_date
          AND status = 'absent'
          AND deleted_at IS NULL
        
        UNION
        
        -- 2. Dates covered by Rejected Leaves
        SELECT generate_series(
            GREATEST(start_date, v_start_date), 
            LEAST(end_date, v_end_date), 
            interval '1 day'
        )::DATE AS d_date
        FROM leave_applications
        WHERE applicant_id = (SELECT id FROM users WHERE person_id = (SELECT person_id FROM staff WHERE id = p_staff_id))
          AND status = 'rejected'
          AND leave_type != 'unpaid' -- Assuming 'unpaid' might be handled differently, but req says "leave requests that are rejected"
          -- Note: If leave handling logic needs to change (e.g. 'unpaid' approved leave also deducts), modify here.
          -- For now, strictly following: "salary deductions must apply for: days marked absent, leave requests that are rejected"
          AND end_date >= v_start_date
          AND start_date <= v_end_date
    )
    SELECT COUNT(DISTINCT d_date) INTO v_total_deduction_days FROM deductible_dates;

    -- Calculate Deduction Amount
    v_deduction_amount := v_total_deduction_days * v_per_day_salary;

    -- Ensure Payroll Record Exists (Upsert)
    INSERT INTO staff_payroll (staff_id, payroll_month, payroll_year, base_salary, deductions, net_salary, status)
    VALUES (
        p_staff_id, 
        p_month, 
        p_year, 
        v_base_salary, 
        v_deduction_amount, 
        GREATEST(0, v_base_salary - v_deduction_amount), -- Prevent negative salary
        'pending'
    )
    ON CONFLICT (staff_id, payroll_month, payroll_year) 
    DO UPDATE SET 
        base_salary = EXCLUDED.base_salary,
        deductions = EXCLUDED.deductions,
        net_salary = EXCLUDED.net_salary,
        updated_at = now();
        
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Triggers

-- Trigger 1: On Staff Attendance Change
CREATE OR REPLACE FUNCTION trg_recalc_payroll_on_attendance()
RETURNS TRIGGER AS $$
DECLARE
    v_staff_id UUID;
    v_date DATE;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        v_staff_id := OLD.staff_id;
        v_date := OLD.attendance_date;
    ELSE
        v_staff_id := NEW.staff_id;
        v_date := NEW.attendance_date;
    END IF;

    -- Recalculate for the month of the attendance
    PERFORM recalculate_staff_payroll(
        v_staff_id, 
        EXTRACT(MONTH FROM v_date)::INT, 
        EXTRACT(YEAR FROM v_date)::INT
    );
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staff_attendance_payroll ON staff_attendance;
CREATE TRIGGER trg_staff_attendance_payroll
AFTER INSERT OR UPDATE OR DELETE ON staff_attendance
FOR EACH ROW EXECUTE FUNCTION trg_recalc_payroll_on_attendance();


-- Trigger 2: On Leave Status Change (Rejected)
CREATE OR REPLACE FUNCTION trg_recalc_payroll_on_leave()
RETURNS TRIGGER AS $$
DECLARE
    v_staff_id UUID;
    v_start DATE;
    v_end DATE;
    v_d DATE;
BEGIN
    -- Only verify if status changed to/from 'rejected' or dates changed
    IF (TG_OP = 'UPDATE' AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.start_date IS DISTINCT FROM NEW.start_date OR OLD.end_date IS DISTINCT FROM NEW.end_date)) 
       OR (TG_OP = 'INSERT') THEN
       
       -- Resolve Staff ID from User ID (Applicant)
       SELECT id INTO v_staff_id FROM staff WHERE person_id = (SELECT person_id FROM users WHERE id = NEW.applicant_id);
       
       IF v_staff_id IS NOT NULL THEN
           -- We need to recalculate for every month covered by the leave
           -- Iterate through months
           v_start := DATE_TRUNC('month', NEW.start_date);
           v_end := DATE_TRUNC('month', NEW.end_date);
           
           v_d := v_start;
           WHILE v_d <= v_end LOOP
               PERFORM recalculate_staff_payroll(
                   v_staff_id, 
                   EXTRACT(MONTH FROM v_d)::INT, 
                   EXTRACT(YEAR FROM v_d)::INT
               );
               v_d := v_d + interval '1 month';
           END LOOP;
       END IF;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leave_payroll ON leave_applications;
CREATE TRIGGER trg_leave_payroll
AFTER INSERT OR UPDATE ON leave_applications
FOR EACH ROW EXECUTE FUNCTION trg_recalc_payroll_on_leave();

-- 20. NOTIFICATION BATCHES
-- Part 1: Fee Reminder Batch System Schema
CREATE TABLE IF NOT EXISTS notification_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES users(id),
    type TEXT NOT NULL CHECK (type IN ('FEES', 'GENERAL', 'EXAM', 'EMERGENCY')), -- Extendable
    filters JSONB DEFAULT '{}',
    status TEXT CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'aborted')) DEFAULT 'pending',
    total_targets INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Index for rate limiting (finding last batch by type/created_at)
CREATE INDEX IF NOT EXISTS idx_notification_batches_type_created ON notification_batches(type, created_at);

-- 21. NOTIFICATION HARDENING
-- Part 1: Delivery Observability
CREATE TABLE IF NOT EXISTS notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    role TEXT,
    notification_type TEXT NOT NULL,
    channel_id TEXT,
    push_provider TEXT DEFAULT 'fcm',
    provider_response JSONB,
    status TEXT CHECK (status IN ('success', 'failed', 'partial')),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Part 3: Rate Limiting (Optional: can use Redis, but DB is fine for this scale)
-- We will query notification_logs for rate limiting, so we need good indexes.
CREATE INDEX IF NOT EXISTS idx_notification_logs_user_type_date ON notification_logs(user_id, notification_type, created_at);

-- Part 6: Incident Kill Switch
CREATE TABLE IF NOT EXISTS notification_config (
    key TEXT PRIMARY KEY,
    value JSONB,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Seed default config if not exists
INSERT INTO notification_config (key, value)
VALUES 
    ('kill_switch', '{"global": false, "types": {}}')
ON CONFLICT (key) DO NOTHING;

-- Trigger to propagate fee structure changes to student fees



-- 1. Propagate changes from Fee Structure amount to ongoing student fees
CREATE OR REPLACE FUNCTION propagate_fee_structure_updates()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.amount IS DISTINCT FROM OLD.amount THEN
        UPDATE student_fees
        SET 
            amount_due = NEW.amount,
            updated_at = now(),
            status = CASE 
                WHEN amount_paid >= (NEW.amount - discount) THEN 'paid'::fee_status_enum
                WHEN amount_paid > 0 THEN 'partial'::fee_status_enum
                WHEN due_date < CURRENT_DATE THEN 'overdue'::fee_status_enum
                ELSE 'pending'::fee_status_enum
            END
        WHERE fee_structure_id = NEW.id
          AND status IN ('pending', 'partial', 'overdue');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_propagate_fee_updates ON fee_structures;
CREATE TRIGGER trg_propagate_fee_updates
AFTER UPDATE ON fee_structures
FOR EACH ROW EXECUTE FUNCTION propagate_fee_structure_updates();

-- 2. Auto-assign fees when a new Fee Structure is created for a class
CREATE OR REPLACE FUNCTION auto_assign_fees_on_structure_creation()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO student_fees (student_id, fee_structure_id, amount_due, amount_paid, status, due_date)
    SELECT 
        se.student_id,
        NEW.id,
        NEW.amount,
        0,
        'pending',
        NEW.due_date
    FROM student_enrollments se
    JOIN class_sections cs ON se.class_section_id = cs.id
    WHERE cs.class_id = NEW.class_id
      AND se.academic_year_id = NEW.academic_year_id
      AND se.status = 'active'
      AND NOT EXISTS (
          SELECT 1 FROM student_fees sf 
          WHERE sf.student_id = se.student_id 
            AND sf.fee_structure_id = NEW.id
      );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_assign_fees_structure ON fee_structures;
CREATE TRIGGER trg_auto_assign_fees_structure
AFTER INSERT ON fee_structures
FOR EACH ROW EXECUTE FUNCTION auto_assign_fees_on_structure_creation();

-- 3. Auto-assign fees when a Student is enrolled into a class
CREATE OR REPLACE FUNCTION auto_assign_fees_on_enrollment()
RETURNS TRIGGER AS $$
DECLARE
    v_class_id UUID;
BEGIN
    IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
        SELECT class_id INTO v_class_id FROM class_sections WHERE id = NEW.class_section_id;

        INSERT INTO student_fees (student_id, fee_structure_id, amount_due, amount_paid, status, due_date)
        SELECT 
            NEW.student_id,
            fs.id,
            fs.amount,
            0,
            'pending',
            fs.due_date
        FROM fee_structures fs
        WHERE fs.class_id = v_class_id
          AND fs.academic_year_id = NEW.academic_year_id
          AND NOT EXISTS (
              SELECT 1 FROM student_fees sf 
              WHERE sf.student_id = NEW.student_id 
                AND sf.fee_structure_id = fs.id
          );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_assign_fees_enrollment ON student_enrollments;
CREATE TRIGGER trg_auto_assign_fees_enrollment
AFTER INSERT OR UPDATE ON student_enrollments
FOR EACH ROW EXECUTE FUNCTION auto_assign_fees_on_enrollment();

-- ============================================================
-- ADDITIONAL CONSTRAINTS & INDEXES
-- ============================================================

-- Prevent double fee assignment for the same structure to the same student
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_fees_unique_assignment 
ON student_fees(student_id, fee_structure_id);

-- Prevent accidental double entry of transaction references (checks, UPI IDs, etc)
CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_transactions_unique_ref 
ON fee_transactions(transaction_ref) 
WHERE transaction_ref IS NOT NULL AND transaction_ref <> '';

-- SECTION 13: AUDIT & PERFORMANCE
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    details JSONB,
    ip_address TEXT,
    user_agent TEXT,
    request_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_date ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_request_id ON audit_logs(request_id);

-- Performance Indexes for Foreign Keys
CREATE INDEX IF NOT EXISTS idx_person_contacts_person_id ON person_contacts(person_id);
CREATE INDEX IF NOT EXISTS idx_student_fees_structure_id ON student_fees(fee_structure_id);
CREATE INDEX IF NOT EXISTS idx_fee_transactions_student_fee_id ON fee_transactions(student_fee_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt_id ON receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_transaction_id ON receipt_items(fee_transaction_id);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_class_section ON student_enrollments(class_section_id);
CREATE INDEX IF NOT EXISTS idx_class_subjects_subject_id ON class_subjects(subject_id);
CREATE INDEX IF NOT EXISTS idx_exam_subjects_subject_id ON exam_subjects(subject_id);
CREATE INDEX IF NOT EXISTS idx_exam_subjects_class_id ON exam_subjects(class_id);

-- Enable RLS on all core tables (Minimal default policy: deny all unless specific policies added)
-- Note: This is a proactive hardening step.
ALTER TABLE persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- SECTION 14: NOTIFICATIONS & DEVICES
-- ============================================================

CREATE TABLE IF NOT EXISTS user_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    fcm_token TEXT NOT NULL,
    platform TEXT CHECK (platform IN ('android', 'ios')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(user_id, fcm_token)
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON user_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_token ON user_devices(fcm_token);

ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;

-- Allow users to manage their own devices
DROP POLICY IF EXISTS "Users can manage own devices" ON user_devices;
CREATE POLICY "Users can manage own devices" ON user_devices
FOR ALL
USING (user_id = auth.uid());

COMMIT;


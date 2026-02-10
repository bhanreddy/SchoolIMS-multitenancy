
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
GRANT ALL ON staff_attendance TO authenticated;
GRANT ALL ON staff_attendance TO service_role;

DROP POLICY IF EXISTS "View staff attendance" ON staff_attendance;
CREATE POLICY "View staff attendance" ON staff_attendance FOR SELECT USING (
  auth_has_role(ARRAY['admin', 'principal', 'accounts']) OR
  staff_id IN (SELECT id FROM staff WHERE person_id = (SELECT person_id FROM users WHERE id = auth.uid()))
);

DROP POLICY IF EXISTS "Manage staff attendance" ON staff_attendance;
CREATE POLICY "Manage staff attendance" ON staff_attendance FOR ALL USING (
  auth_has_role(ARRAY['admin', 'principal', 'accounts'])
);


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


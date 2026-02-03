-- ============================================================
-- DATABASE INVARIANT CHECKS (READ-ONLY)
-- ============================================================
-- Usage: SELECT * FROM verify_data_integrity();

CREATE OR REPLACE FUNCTION verify_data_integrity()
RETURNS TABLE (
    check_name TEXT,
    status TEXT, -- 'PASS' or 'FAIL'
    details TEXT
) AS $$
DECLARE
    fees_drift_count INTEGER;
    negative_bal_count INTEGER;
    orphaned_enrollment_count INTEGER;
    invalid_roll_count INTEGER;
BEGIN
    -- 1. Check Financial Integrity
    -- Ensure student_fees.amount_paid == SUM(fee_transactions)
    SELECT COUNT(*)
    INTO fees_drift_count
    FROM student_fees sf
    LEFT JOIN (
        SELECT student_fee_id, SUM(amount) as total_paid
        FROM fee_transactions
        GROUP BY student_fee_id
    ) ft ON sf.id = ft.student_fee_id
    WHERE sf.amount_paid <> COALESCE(ft.total_paid, 0);

    IF fees_drift_count > 0 THEN
        RETURN QUERY SELECT 'Financial Integrity', 'FAIL', fees_drift_count || ' fees have amount_paid mismatches';
    ELSE
        RETURN QUERY SELECT 'Financial Integrity', 'PASS', 'All fee balances match transaction sums';
    END IF;

    -- 2. Check Positive Balances
    -- Ensure amount_paid is not negative
    SELECT COUNT(*) INTO negative_bal_count
    FROM student_fees
    WHERE amount_paid < 0;

    IF negative_bal_count > 0 THEN
        RETURN QUERY SELECT 'Negative Balances', 'FAIL', negative_bal_count || ' fees have negative amount_paid';
    ELSE
        RETURN QUERY SELECT 'Negative Balances', 'PASS', 'No negative balances found';
    END IF;

    -- 3. Check Orphaned Data
    -- Enrollments pointing to deleted students (which shouldn't happen with our constraints, but checking anyway)
    SELECT COUNT(*) INTO orphaned_enrollment_count
    FROM student_enrollments se
    JOIN students s ON se.student_id = s.id
    WHERE s.deleted_at IS NOT NULL AND se.deleted_at IS NULL;

    IF orphaned_enrollment_count > 0 THEN
        RETURN QUERY SELECT 'Orphaned Enrollments', 'FAIL', orphaned_enrollment_count || ' active enrollments for deleted students';
    ELSE
        RETURN QUERY SELECT 'Orphaned Enrollments', 'PASS', 'No orphaned enrollments found';
    END IF;

    -- 4. Check for duplicate active roll numbers (Logical Check)
    SELECT COUNT(*) INTO invalid_roll_count
    FROM (
        SELECT class_section_id, academic_year_id, roll_number
        FROM student_enrollments
        WHERE status = 'active' AND roll_number IS NOT NULL AND deleted_at IS NULL
        GROUP BY class_section_id, academic_year_id, roll_number
        HAVING COUNT(*) > 1
    ) sub;

    IF invalid_roll_count > 0 THEN
        RETURN QUERY SELECT 'Roll Number Uniqueness', 'FAIL', invalid_roll_count || ' duplicate roll numbers found';
    ELSE
        RETURN QUERY SELECT 'Roll Number Uniqueness', 'PASS', 'Roll numbers are unique';
    END IF;

END;
$$ LANGUAGE plpgsql;

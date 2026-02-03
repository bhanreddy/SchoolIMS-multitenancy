-- FIX: Replace transaction_date with paid_at AND student_fee_allocations with student_fees

-- 1. FINANCIAL ANALYTICS
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
    -- FIXED: Using student_fees table instead of student_fee_allocations
    SELECT COALESCE(SUM(amount_due - discount - amount_paid), 0) INTO v_total_outstanding
    FROM student_fees
    WHERE deleted_at IS NULL 
      AND status != 'waived';
    
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

-- 2. DASHBOARD INSIGHTS
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
    -- FIXED: Using student_fees directly
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

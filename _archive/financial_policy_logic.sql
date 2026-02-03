-- Financial Policy Enforcement Logic

-- 1. Helper: Check Financial Permission & Limits
CREATE OR REPLACE FUNCTION check_financial_permission(
    p_action_code TEXT, -- e.g. 'EXPENSE_CREATE', 'FEE_COLLECT'
    p_amount DECIMAL DEFAULT 0
)
RETURNS BOOLEAN AS $$
DECLARE
    v_user_id UUID;
    v_role_code TEXT;
    v_limit_rule JSONB;
    v_limit_amount DECIMAL;
    v_auto_approve_limit DECIMAL;
BEGIN
    v_user_id := auth.uid();
    
    -- Get User Role (simplify to single role for now, priority to Admin/Principal)
    SELECT r.code INTO v_role_code
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = v_user_id
    ORDER BY (CASE WHEN r.code = 'admin' THEN 1 WHEN r.code = 'principal' THEN 2 ELSE 3 END)
    LIMIT 1;

    -- Admin bypass (optional, but good for safety)
    IF v_role_code = 'admin' THEN
        RETURN TRUE;
    END IF;

    -- CHECK 1: Global Permission Matrix should be checked via RLS/Grants basically, 
    -- but here we check specific limits if applicable.

    -- CHECK 2: Action Specific Limits
    
    -- Case: Expense Auto-Approval Limit
    IF p_action_code = 'EXPENSE_AUTO_APPROVE' THEN
        SELECT current_value->>'amount' INTO v_auto_approve_limit 
        FROM financial_policy_rules WHERE rule_code = 'EXPENSE_AUTO_APPROVE_LIMIT';
        
        IF v_auto_approve_limit IS NOT NULL AND p_amount > v_auto_approve_limit::DECIMAL THEN
             RAISE EXCEPTION 'Amount % exceeds auto-approval limit of %', p_amount, v_auto_approve_limit;
        END IF;
    END IF;

    -- Case: Daily Cash Collection Limit
    IF p_action_code = 'FEE_COLLECT_CASH' THEN
        -- Calculate total cash collected today by this user
        DECLARE
            v_today_total DECIMAL;
            v_daily_limit JSONB;
        BEGIN
            SELECT COALESCE(SUM(amount), 0) INTO v_today_total
            FROM fee_transactions
            WHERE received_by = v_user_id
              AND payment_method = 'cash'
              AND paid_at::DATE = CURRENT_DATE;

            SELECT current_value INTO v_daily_limit 
            FROM financial_policy_rules WHERE rule_code = 'CASH_COLLECTION_DAILY_LIMIT';

            IF v_daily_limit IS NOT NULL AND (v_today_total + p_amount) > (v_daily_limit->>'amount')::DECIMAL THEN
                 RAISE EXCEPTION 'Daily cash limit exceeded. Collected: %, Attempt: %, Limit: %', v_today_total, p_amount, v_daily_limit->>'amount';
            END IF;
        END;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. Helper: Enforce Locks (Time-based integrity)
CREATE OR REPLACE FUNCTION enforce_financial_lock(
    p_date DATE,
    p_context TEXT -- 'INVOICE', 'PAYROLL', 'EXPENSE'
)
RETURNS BOOLEAN AS $$
DECLARE
    v_lock_days INT;
    v_lock_date DATE;
BEGIN
    -- Get Lock Configuration
    SELECT (current_value->>'amount')::INT INTO v_lock_days
    FROM financial_policy_rules 
    WHERE rule_code = 'LOCK_PAST_MONTHS_DAYS';

    IF v_lock_days IS NULL THEN v_lock_days := 7; END IF; -- Default

    -- Logic: If date is in a previous month, and we are past the lock day of the current month
    -- Example: Date=Jan 15. Current=Feb 10. (Prev month is Jan). 
    -- If Current Day > Lock Day (7), then Jan is locked.
    
    -- Simpler Logic: "Data older than X days is locked" or "Previous months locked after X days of new month"
    -- Implementing: Strict Month Lock.
    
    IF p_date < DATE_TRUNC('month', CURRENT_DATE) THEN
        -- It's a past month. Check if we are past the lock buffer.
        IF EXTRACT(DAY FROM CURRENT_DATE) > v_lock_days THEN
            RAISE EXCEPTION 'Financial period for % is locked. (Automatic lock enabled after day % of subsequent month)', p_date, v_lock_days;
        END IF;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. Triggers for Active Enforcement
-- Trigger: Check Expense Limit
CREATE OR REPLACE FUNCTION trg_check_expense_policy()
RETURNS TRIGGER AS $$
BEGIN
    -- Only check on INSERT or if Amount changes
    IF (TG_OP = 'INSERT') OR (TG_OP = 'UPDATE' AND NEW.amount IS DISTINCT FROM OLD.amount) THEN
        IF NEW.status = 'approved' THEN
             PERFORM check_financial_permission('EXPENSE_AUTO_APPROVE', NEW.amount);
        END IF;
        
        PERFORM enforce_financial_lock(NEW.expense_date, 'EXPENSE');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_expense_policy ON expenses;
CREATE TRIGGER enforce_expense_policy
BEFORE INSERT OR UPDATE ON expenses
FOR EACH ROW EXECUTE FUNCTION trg_check_expense_policy();


-- Trigger: Check Fee Collection Limit (Cash)
CREATE OR REPLACE FUNCTION trg_check_fee_cash_limit()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.payment_method = 'cash' THEN
         PERFORM check_financial_permission('FEE_COLLECT_CASH', NEW.amount);
    END IF;
    PERFORM enforce_financial_lock(NEW.paid_at::DATE, 'FEE');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_fee_cash_limit ON fee_transactions;
CREATE TRIGGER enforce_fee_cash_limit
BEFORE INSERT ON fee_transactions
FOR EACH ROW EXECUTE FUNCTION trg_check_fee_cash_limit();


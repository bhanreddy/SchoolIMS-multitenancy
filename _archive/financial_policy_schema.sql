-- Financial Policy & Control Layer Schema

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

-- Accounts can INSERT logs (via triggers mostly, but allowing explicit insert for system actions)
CREATE POLICY "System can insert audit logs" 
ON financial_audit_logs FOR INSERT 
TO authenticated 
WITH CHECK (true); -- Triggers run with definer usually, but good to have.

-- 2. Financial Policy Rules (Limits, Permissions, Locks)
CREATE TABLE IF NOT EXISTS financial_policy_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_code TEXT NOT NULL UNIQUE, -- e.g., 'EXPENSE_LIMIT_AUTO_APPROVE', 'CASH_COLLECTION_LIMIT_DAILY'
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

-- Authenticated users (Accounts/Admin) can READ policies
CREATE POLICY "Authenticated users can read financial policies" 
ON financial_policy_rules FOR SELECT 
TO authenticated 
USING (true);

-- Only Admin can UPDATE policies
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

-- 3. Seed Default Policies
INSERT INTO financial_policy_rules (rule_code, rule_name, description, value_type, default_value, current_value)
VALUES 
    ('EXPENSE_AUTO_APPROVE_LIMIT', 'Expense Auto-Approval Limit', 'Expenses below this amount are auto-approved.', 'amount', '1000'::jsonb, '1000'::jsonb),
    ('CASH_COLLECTION_DAILY_LIMIT', 'Daily Cash Collection Limit', 'Maximum cash a user can collect per day.', 'amount', '50000'::jsonb, '50000'::jsonb),
    ('FEE_WAIVER_MAX_PERCENT', 'Max Fee Waiver Percentage', 'Maximum percentage of fee that can be waived.', 'percentage', '20'::jsonb, '20'::jsonb),
    ('PAYROLL_OVERRIDE_ALLOWED', 'Payroll Override Allowed', 'Can payroll values be manually overridden?', 'boolean', 'false'::jsonb, 'false'::jsonb),
    ('LOCK_PAST_MONTHS_DAYS', 'Lock Past Months After (Days)', 'Number of days after which previous month data is locked.', 'amount', '7'::jsonb, '7'::jsonb)
ON CONFLICT (rule_code) DO NOTHING;

-- 4. Audit Log Trigger Function
CREATE OR REPLACE FUNCTION log_financial_destruction()
RETURNS TRIGGER AS $$
DECLARE
    current_user_id UUID;
    reason_text TEXT;
BEGIN
    -- Try to get user ID from session, fallback to NULL or system
    current_user_id := auth.uid();
    
    -- Check if a reason was provided via local variable (set by client before delete)
    -- Clients must set local variable 'app.delete_reason' before deleting
    BEGIN
        reason_text := current_setting('app.delete_reason', true);
    EXCEPTION WHEN OTHERS THEN
        reason_text := 'No reason provided';
    END;

    IF (TG_OP = 'DELETE') THEN
        INSERT INTO financial_audit_logs (
            table_name,
            record_id,
            action_type,
            old_data,
            reason,
            performed_by
        ) VALUES (
            TG_TABLE_NAME,
            OLD.id::text,
            'DELETE',
            row_to_json(OLD),
            COALESCE(reason_text, 'Unknown (Direct DB Delete)'),
            current_user_id
        );
        RETURN OLD;
    ELSIF (TG_OP = 'UPDATE') THEN
        -- Only log if "critical" fields changed (can be customized)
        -- For now logging all updates on these sensitive tables
        INSERT INTO financial_audit_logs (
            table_name,
            record_id,
            action_type,
            old_data,
            new_data,
            reason,
            performed_by
        ) VALUES (
            TG_TABLE_NAME,
            NEW.id::text,
            'UPDATE',
            row_to_json(OLD),
            row_to_json(NEW),
            'Update Operation', -- Updates usually don't need forced reason like deletes
            current_user_id
        );
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Attach Triggers to Financial Tables
-- Dropping existing triggers if any to ensure idempotency
DROP TRIGGER IF EXISTS audit_delete_receipts ON receipts;
CREATE TRIGGER audit_delete_receipts
BEFORE DELETE ON receipts
FOR EACH ROW EXECUTE FUNCTION log_financial_destruction();

DROP TRIGGER IF EXISTS audit_delete_student_fees ON student_fees;
CREATE TRIGGER audit_delete_student_fees
BEFORE DELETE ON student_fees
FOR EACH ROW EXECUTE FUNCTION log_financial_destruction();

DROP TRIGGER IF EXISTS audit_delete_expenses ON expenses;
CREATE TRIGGER audit_delete_expenses
BEFORE DELETE ON expenses
FOR EACH ROW EXECUTE FUNCTION log_financial_destruction();

DROP TRIGGER IF EXISTS audit_delete_payroll ON staff_payroll;
CREATE TRIGGER audit_delete_payroll
BEFORE DELETE ON staff_payroll
FOR EACH ROW EXECUTE FUNCTION log_financial_destruction();

-- 6. Helper Function to Read Policy
CREATE OR REPLACE FUNCTION get_financial_policy_value(code_input TEXT)
RETURNS JSONB AS $$
DECLARE
    val JSONB;
BEGIN
    SELECT current_value INTO val FROM financial_policy_rules WHERE rule_code = code_input;
    RETURN val;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

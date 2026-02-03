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

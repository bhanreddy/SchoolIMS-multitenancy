-- Migration: Automated Receipt Generation
-- Description: Adds a trigger to fee_transactions to auto-generate receipts and backfills missing receipts.

-- 1. Create sequence for receipt numbers if not exists
CREATE SEQUENCE IF NOT EXISTS receipt_no_seq START 1001;

-- 2. Function to auto-generate receipt on transaction
CREATE OR REPLACE FUNCTION auto_generate_receipt()
RETURNS TRIGGER AS $$
DECLARE
    v_receipt_id UUID;
    v_student_id UUID;
    v_receipt_no TEXT;
BEGIN
    -- Get Student ID associated with the fee
    SELECT student_id INTO v_student_id 
    FROM student_fees 
    WHERE id = NEW.student_fee_id;

    -- Generate Receipt No (Format: RCT-YYYYMMDD-XXXX)
    v_receipt_no := 'RCT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(NEXTVAL('receipt_no_seq')::TEXT, 4, '0');

    -- Insert into receipts
    INSERT INTO receipts (
        receipt_no,
        student_id,
        total_amount,
        issued_at,
        issued_by,
        remarks
    ) VALUES (
        v_receipt_no,
        v_student_id,
        NEW.amount,
        NEW.paid_at,
        NEW.received_by,
        COALESCE(NEW.remarks, 'System Generated')
    ) RETURNING id INTO v_receipt_id;

    -- Insert into receipt_items
    INSERT INTO receipt_items (
        receipt_id,
        fee_transaction_id,
        amount
    ) VALUES (
        v_receipt_id,
        NEW.id,
        NEW.amount
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Attach Trigger
DROP TRIGGER IF EXISTS trg_auto_receipt ON fee_transactions;
CREATE TRIGGER trg_auto_receipt
AFTER INSERT ON fee_transactions
FOR EACH ROW EXECUTE FUNCTION auto_generate_receipt();

-- 4. Backfill existing transactions without receipts
DO $$
DECLARE
    r_trans RECORD;
    v_receipt_id UUID;
    v_student_id UUID;
    v_receipt_no TEXT;
BEGIN
    FOR r_trans IN 
        SELECT t.* 
        FROM fee_transactions t
        LEFT JOIN receipt_items ri ON t.id = ri.fee_transaction_id
        WHERE ri.id IS NULL
    LOOP
        -- Get Student ID
        SELECT student_id INTO v_student_id 
        FROM student_fees 
        WHERE id = r_trans.student_fee_id;

        -- Generate Receipt No
        v_receipt_no := 'RCT-' || TO_CHAR(r_trans.paid_at, 'YYYYMMDD') || '-' || LPAD(NEXTVAL('receipt_no_seq')::TEXT, 4, '0');

        -- Insert Receipt
        INSERT INTO receipts (
            receipt_no,
            student_id,
            total_amount,
            issued_at,
            issued_by,
            remarks
        ) VALUES (
            v_receipt_no,
            v_student_id,
            r_trans.amount,
            r_trans.paid_at,
            r_trans.received_by,
            COALESCE(r_trans.remarks, 'Backfilled')
        ) RETURNING id INTO v_receipt_id;

        -- Insert Receipt Item
        INSERT INTO receipt_items (
            receipt_id,
            fee_transaction_id,
            amount
        ) VALUES (
            v_receipt_id,
            r_trans.id,
            r_trans.amount
        );
    END LOOP;
END $$;

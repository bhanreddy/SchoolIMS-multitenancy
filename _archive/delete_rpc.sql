-- Generic Deletion RPC with Reason
-- This allows the frontend to call a single function to delete records while ensuring the reason is logged.

CREATE OR REPLACE FUNCTION delete_record_with_reason(
    p_table_name TEXT,
    p_record_id UUID,
    p_reason TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_query TEXT;
    v_rows_deleted INT;
BEGIN
    -- Set the reason in a session variable (or transaction local)
    PERFORM set_config('app.delete_reason', p_reason, true);

    -- Construct Dynamic SQL for deletion
    -- Note: This requires the function to be SECURITY DEFINER to work around ownership if needed,
    -- but usually RLS checks apply. However, dynamic SQL inside SECURITY DEFINER is risky.
    -- Better to rely on RLS and run as invoker? 
    -- If we run as invoker, we can't set_config for a trigger if the trigger is security definer? 
    -- Actually, trigger can read session variables set by invoker.
    
    -- Safety Check: Allow-list tables
    IF p_table_name NOT IN ('receipts', 'student_fees', 'expenses', 'staff_payroll') THEN
        RAISE EXCEPTION 'Table % is not approved for generic deletion.', p_table_name;
    END IF;

    -- Execute Delete
    v_query := format('DELETE FROM %I WHERE id = $1', p_table_name);
    EXECUTE v_query USING p_record_id;
    
    GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;

    IF v_rows_deleted = 0 THEN
        RAISE EXCEPTION 'Record not found or permission denied.';
    END IF;

    RETURN jsonb_build_object('status', 'success', 'deleted_id', p_record_id);
END;
$$ LANGUAGE plpgsql SECURITY INVOKER; -- Invoke as the user to respect RLS!

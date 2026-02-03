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

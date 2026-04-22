import { createClient } from '@supabase/supabase-js';
import sql from './db.js';

async function run() {
  const SUPABASE_URL = 'https://jztckbupiepiqfrxhszt.supabase.co';
  const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6dGNrYnVwaWVwaXFmcnhoc3p0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzEzODIxNiwiZXhwIjoyMDg4NzE0MjE2fQ.n4jBTzbbUTlMa8-ykQnlBBw_65UUD2h31-pMKmUfgEA';
  
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
    '813e8c06-b799-4039-916c-f51d541a1e33',
    { password: 'password123' }
  );
  
  if (error) {
    console.error('Update password failed:', error.message);
  } else {
    console.log('Password updated successfully for arun@nexsyrus.com!');
  }
  process.exit(0);
}
run();

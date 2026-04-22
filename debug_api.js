import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch'; // if available

// Or just use the native fetch in Node 22
async function run() {
  const SUPABASE_URL = 'https://jztckbupiepiqfrxhszt.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6dGNrYnVwaWVwaXFmcnhoc3p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMzgyMTYsImV4cCI6MjA4ODcxNDIxNn0.TC6mwwLezkwMmPxkIzRnR7NPyworRVzQ_vXCkRmnz4o';
  
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  
  // Login
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'arun@nexsyrus.com',
    password: 'password123' // hope this is the default seed password? Usually it's password123 or similar
  });
  
  if (error) {
    console.error('Login error:', error.message);
    process.exit(1);
  }
  
  console.log('Logged in successfully!');
  
  const token = data.session.access_token;
  
  // Call backend exactly like testapp
  const res = await fetch('http://localhost:3001/api/v1/auth/validate-school-user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ school_id: 1 })
  });
  
  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Response:', text);
  process.exit(0);
}
run();

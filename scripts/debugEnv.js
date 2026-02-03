
import config from '../config/env.js';

console.log('--- Environment Variables Debug ---');
console.log('Using centralized config module');

const { port, databaseUrl, supabase, firebase } = config;

function mask(str, visibleChars = 4) {
    if (!str) return 'UNDEFINED';
    if (str.length <= visibleChars) return str;
    return str.substring(0, visibleChars) + '...' + str.substring(str.length - visibleChars);
}

console.log(`PORT: ${port}`);
console.log(`DATABASE_URL: ${databaseUrl ? 'SET (' + databaseUrl.length + ' chars)' : 'MISSING'}`);
console.log(`SUPABASE_URL: ${supabase.url}`);
console.log(`SUPABASE_ANON_KEY: ${mask(supabase.anonKey)}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${mask(supabase.serviceRoleKey)}`);
console.log(`FIREBASE_PROJECT_ID: ${firebase.projectId}`);

console.log('--- End Debug ---');

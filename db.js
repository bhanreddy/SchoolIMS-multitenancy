import postgres from 'postgres'
import config from './config/env.js';
import { createClient } from '@supabase/supabase-js';

const connectionString = config.databaseUrl;

const sql = postgres(connectionString, {
    prepare: false,
    ssl: 'require',
    max: 5, // Keep a small pool of active connections
    idle_timeout: 0, // IMPORTANT: Never drop idle connections to avoid cold-start timeouts
    connect_timeout: 30, // 30s timeout for initial handshake
    max_lifetime: 60 * 30, // 30 minutes max lifetime
    onnotice: () => { },
});

// Initialize Supabase Client
// Initialize Supabase Client
const supabaseUrl = config.supabase.url;
const supabaseKey = config.supabase.anonKey;
const supabaseServiceKey = config.supabase.serviceRoleKey;

export const supabase = createClient(supabaseUrl, supabaseKey);

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const getTransaction = async (callback) => {
    return await sql.begin(callback);
}

export default sql;
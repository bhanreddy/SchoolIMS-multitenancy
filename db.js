import postgres from 'postgres'
import config from './config/env.js';
import { createClient } from '@supabase/supabase-js';

const connectionString = config.databaseUrl;

const sql = postgres(connectionString, {
    prepare: false,
    ssl: 'require',
    max: 10,
    idle_timeout: 20
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
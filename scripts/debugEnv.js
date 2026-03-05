
import config from '../config/env.js';

const { port, databaseUrl, supabase, firebase } = config;

function mask(str, visibleChars = 4) {
  if (!str) return 'UNDEFINED';
  if (str.length <= visibleChars) return str;
  return str.substring(0, visibleChars) + '...' + str.substring(str.length - visibleChars);
}

import 'dotenv/config';
import config from '../config/env.js';

const connectionString = config.databaseUrl;
console.log('Original Connection String length:', connectionString.length);

try {
    const url = new URL(connectionString);
    console.log('Protocol:', url.protocol);
    console.log('Hostname:', url.hostname);
    console.log('Port:', url.port);
    console.log('Pathname:', url.pathname);
    console.log('Username:', url.username);
    // Do not log password
    console.log('Password length:', url.password.length);
} catch (e) {
    console.error('Error parsing URL:', e.message);
}

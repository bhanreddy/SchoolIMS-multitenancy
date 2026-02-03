import config from '../config/env.js';

console.log('--- ENV CHECK ---');
console.log('DB URL defined?', !!config.databaseUrl);
if (config.databaseUrl) {
    const masked = config.databaseUrl.replace(/:[^:@]+@/, ':****@');
    console.log('DB URL:', masked);
} else {
    console.log('DB URL IS MISSING!');
}

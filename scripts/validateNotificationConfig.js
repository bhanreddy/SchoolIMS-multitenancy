
import { NotificationEventConfig } from '../services/notificationEventConfig.js';

console.log('Validating NotificationEventConfig...');

let errors = 0;
const requiredFields = ['channelId', 'sound', 'titleTemplate', 'bodyTemplate', 'requiredParams'];

Object.keys(NotificationEventConfig).forEach(key => {
    const config = NotificationEventConfig[key];
    const missing = requiredFields.filter(field => !config[field]);

    if (missing.length > 0) {
        console.error(`[ERROR] ${key} is missing fields: ${missing.join(', ')}`);
        errors++;
    }

    if (config.channelId && config.sound) {
        const soundName = config.sound.replace('.wav', '');
        if (config.channelId !== soundName) {
            console.warn(`[WARN] ${key}: channelId '${config.channelId}' does not match sound filename '${soundName}'. This might be intentional but check consistency.`);
        }
    }
});

if (errors === 0) {
    console.log('✅ Configuration is valid.');
    process.exit(0);
} else {
    console.error(`❌ Found ${errors} errors.`);
    process.exit(1);
}

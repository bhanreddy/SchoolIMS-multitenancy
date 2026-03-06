import config from './config/env.js';

async function test() {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Bypass TLS

    console.log('Fetching', config.supabase.url);
    try {
        const response = await fetch(`${config.supabase.url}/auth/v1/health`);
        const text = await response.text();
        console.log('Status:', response.status);
        console.log('Body snippet:', text.slice(0, 500));
        import('fs').then(fs => fs.writeFileSync('debug_html.txt', text));
    } catch (err) {
        console.error('Fetch error:', err.message);
    }
}

test();

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3000/api/v1';

async function debug() {
    // 1. Get tokens (need to login as admin)
    console.log('Logging in as admin...');
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@school.com', password: 'Admin@123' })
    });
    const { token } = await loginRes.json();

    if (!token) {
        console.error('Login failed');
        return;
    }

    const headers = { 'Authorization': `Bearer ${token}` };

    // 2. Check Transactions (used for Receipts view)
    console.log('\nFetching Transactions...');
    const transactionsRes = await fetch(`${BASE_URL}/fees/transactions`, { headers });
    const transactions = await transactionsRes.json();
    console.log('Transactions Count:', Array.isArray(transactions) ? transactions.length : 'Error');
    if (Array.isArray(transactions) && transactions.length > 0) {
        console.log('First Transaction Sample:', JSON.stringify(transactions[0], null, 2));
    } else {
        console.log('Transactions Response:', JSON.stringify(transactions, null, 2));
    }

    // 3. Check Invoices
    console.log('\nFetching Invoices...');
    const invoicesRes = await fetch(`${BASE_URL}/invoices`, { headers });
    console.log('Invoices Status:', invoicesRes.status);
    try {
        const invoices = await invoicesRes.json();
        console.log('Invoices Response:', JSON.stringify(invoices, null, 2));
    } catch (e) {
        console.log('Invoices Response is not JSON or failed');
    }
}

debug();

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3000/api/v1';

async function debug() {
  // 1. Get tokens (need to login as admin)

  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@school.com', password: 'Admin@123' })
  });
  const { token } = await loginRes.json();

  if (!token) {

    return;
  }

  const headers = { 'Authorization': `Bearer ${token}` };

  // 2. Check Transactions (used for Receipts view)

  const transactionsRes = await fetch(`${BASE_URL}/fees/transactions`, { headers });
  const transactions = await transactionsRes.json();

  if (Array.isArray(transactions) && transactions.length > 0) {

  } else {

  }

  // 3. Check Invoices

  const invoicesRes = await fetch(`${BASE_URL}/invoices`, { headers });

  try {
    const invoices = await invoicesRes.json();

  } catch (e) {

  }
}

debug();
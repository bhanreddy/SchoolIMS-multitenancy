
import fetch from 'node-fetch';

async function testUnenrolled() {
    try {
        console.log('Testing GET /students/unenrolled...');
        const response = await fetch('http://localhost:3000/api/v1/students/unenrolled', {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log('Status:', response.status);
        const data = await response.json();
        console.log('Response:', JSON.stringify(data, null, 2));

    } catch (error) {
        console.error('Fetch Error:', error);
    }
}

testUnenrolled();

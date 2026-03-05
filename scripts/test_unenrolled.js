
import fetch from 'node-fetch';

async function testUnenrolled() {
  try {

    const response = await fetch('http://localhost:3000/api/v1/students/unenrolled', {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

  } catch (error) {

  }
}

testUnenrolled();
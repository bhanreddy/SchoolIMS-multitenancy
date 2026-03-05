
import admin from 'firebase-admin';
import config from './env.js';

// Initialize only once
// Initialize only once
if (!admin.apps.length) {
  try {
    const { projectId, clientEmail, privateKey } = config.firebase;

    // Clean up the private key
    let formattedKey = privateKey.trim();
    if (formattedKey.startsWith('"') && formattedKey.endsWith('"')) {
      formattedKey = formattedKey.substring(1, formattedKey.length - 1);
    }
    formattedKey = formattedKey.replace(/\\n/g, '\n');

    // Add PEM headers if missing
    if (!formattedKey.startsWith('-----BEGIN PRIVATE KEY-----')) {
      formattedKey = `-----BEGIN PRIVATE KEY-----\n${formattedKey}\n-----END PRIVATE KEY-----`;
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: formattedKey
      })
    });

  } catch (error) {

  }
}

export default admin;
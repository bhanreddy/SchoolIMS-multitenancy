import admin from './config/firebase.js';

async function testPushDefault() {
  const token = await (await import('./db.js')).default`SELECT fcm_token FROM user_devices ORDER BY last_used_at DESC LIMIT 1`;
  const fcmToken = token[0].fcm_token;

  const message = {
    token: fcmToken,
    notification: {
      title: 'Test Delivery (System Sound)',
      body: 'If you receive this, your previous custom sound notification was silently dropped because your phone did not have the exact .wav file compiled into the Android APK!'
    },
    android: {
      notification: {
        sound: 'default',
        channelId: 'voice_alert_default'
      }
    },
    data: {
      type: 'DIAGNOSTIC'
    }
  };

  try {
    const res = await admin.messaging().send(message);

  } catch (err) {

  }
  process.exit(0);
}

testPushDefault();
require('dotenv').config();

// server.js - Simple Express server for sending FCM notifications
const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin with environment variables
admin.initializeApp({
  credential: admin.credential.cert({
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
    universal_domain: process.env.universe_domain
  })
});

// Simple endpoint to send FCM notification
app.post('/send-notification', async (req, res) => {
  try {
    const { token, title, body, data = {} } = req.body;

    if (!token || !title || !body) {
      return res.status(400).json({ 
        success: false, 
        error: 'Token, title, and body are required' 
      });
    }

    const message = {
      notification: {
        title: title,
        body: body,
      },
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK'
      },
      android: {
        notification: {
          sound: 'default',
          channelId: 'default'
        }
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: title,
              body: body
            },
            sound: 'default',
            badge: 1
          }
        }
      },
      token: token
    };

    const response = await admin.messaging().send(message);
    console.log('Successfully sent message:', response);

    res.json({ success: true, messageId: response });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/', (req, res) => {
  res.send('Server is reachable!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Notification server running on port ${PORT}`);
});
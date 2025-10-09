require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

console.log('🚀 Starting Notification Server...');
console.log('🕒 Server Time:', new Date().toISOString());
console.log('🔧 Environment:', process.env.NODE_ENV || 'development');

// Initialize Firebase Admin
const initializeFirebase = () => {
  try {
    // Method 1: Try environment variables first (for production)
    if (process.env.FIREBASE_PRIVATE_KEY) {
      console.log('📡 Initializing Firebase with environment variables...');
      
      const serviceAccount = {
        type: 'service_account',
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
        client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
        universe_domain: 'googleapis.com'
      };

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      
      console.log('✅ Firebase initialized with environment variables');
      console.log('📧 Project:', process.env.FIREBASE_PROJECT_ID);
      
    } 
    // Method 2: Fallback to service account file (for local development)
    else {
      console.log('📁 Initializing Firebase with service account file...');
      
      const serviceAccount = require('./firebase-service-account.json');
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      
      console.log('✅ Firebase initialized with service account file');
      console.log('📧 Project:', serviceAccount.project_id);
    }

    // Test Firebase connection
    setTimeout(async () => {
      try {
        await admin.app().options.credential.getAccessToken();
        console.log('✅ Firebase connection test passed');
      } catch (testError) {
        console.error('❌ Firebase connection test failed:', testError.message);
      }
    }, 1000);

  } catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
    console.log('💡 Please check your Firebase configuration');
    process.exit(1);
  }
};

initializeFirebase();

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await admin.app().options.credential.getAccessToken();
    
    res.json({
      status: 'healthy',
      service: 'Firebase Notification Server',
      timestamp: new Date().toISOString(),
      firebase: 'connected',
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      service: 'Firebase Notification Server',
      timestamp: new Date().toISOString(),
      firebase: 'disconnected',
      error: error.message
    });
  }
});

// Test Firebase endpoint
app.get('/test-firebase', async (req, res) => {
  try {
    await admin.app().options.credential.getAccessToken();
    
    res.json({ 
      success: true, 
      message: 'Firebase credentials are valid!',
      projectId: admin.app().options.projectId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Firebase test failed: ' + error.message 
    });
  }
});

// Send notification endpoint
app.post('/send-notification', async (req, res) => {
  try {
    const { token, title, body, data = {} } = req.body;

    console.log('📨 Received notification request:', { 
      token: token ? `${token.substring(0, 20)}...` : 'missing', 
      title, 
      body 
    });

    // Validation
    if (!token || !title || !body) {
      return res.status(400).json({ 
        success: false, 
        error: 'Token, title, and body are required' 
      });
    }

    // Create message payload
    const message = {
      notification: {
        title: title,
        body: body,
      },
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        timestamp: new Date().toISOString()
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

    console.log('🚀 Sending FCM message...');
    const response = await admin.messaging().send(message);
    console.log('✅ Successfully sent message:', response);

    res.json({ 
      success: true, 
      messageId: response,
      message: 'Notification sent successfully'
    });

  } catch (error) {
    console.error('❌ Error sending message:', error);
    
    // User-friendly error messages
    let userMessage = error.message;
    if (error.code === 'messaging/invalid-registration-token') {
      userMessage = 'Invalid device token. The token may be expired or malformed.';
    } else if (error.code === 'messaging/registration-token-not-registered') {
      userMessage = 'Device token is no longer registered.';
    } else if (error.code === 'messaging/quota-exceeded') {
      userMessage = 'Notification quota exceeded. Please try again later.';
    } else if (error.code === 'app/invalid-credential') {
      userMessage = 'Server authentication failed. Please check Firebase configuration.';
    }

    res.status(500).json({ 
      success: false, 
      error: userMessage,
      code: error.code
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Firebase Notification Server is running! 🚀',
    endpoints: {
      health: 'GET /health',
      testFirebase: 'GET /test-firebase',
      sendNotification: 'POST /send-notification'
    },
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('🛑 Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: error.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    availableEndpoints: {
      health: 'GET /health',
      testFirebase: 'GET /test-firebase', 
      sendNotification: 'POST /send-notification'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`📍 Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`📍 Firebase test: http://localhost:${PORT}/test-firebase`);
  console.log(`📍 API base: http://localhost:${PORT}/`);
  console.log('🚀 Ready to send notifications!');
});
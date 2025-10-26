require('dotenv').config();
const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

console.log('🚀 Starting Notification Server...');
console.log('🕒 Server Time:', new Date().toISOString());
console.log('🔧 Environment:', process.env.NODE_ENV || 'development');

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
      gemini: process.env.GEMINI_API_KEY ? 'configured' : 'not configured',
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

// ============================================
// RECOMMENDATIONS ENDPOINT (NEW)
// ============================================
app.post('/api/recommendations', async (req, res) => {
  try {
    const { userBehavior, availableItems, categories, currentItem } = req.body;

    console.log('🤖 Generating recommendations for user...');

    // Validate input
    if (!userBehavior || !availableItems || !categories) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userBehavior, availableItems, categories'
      });
    }

    // Check if user has enough behavior data
    const totalInteractions =
      (userBehavior.viewedItems?.length || 0) +
      (userBehavior.favoritedItems?.length || 0) +
      (userBehavior.searchTerms?.length || 0);

    if (totalInteractions < 2) {
      return res.json({
        success: true,
        recommendations: {
          recommendedItemIds: [],
          reasoning: "Not enough user behavior data yet",
          primaryInterests: [],
          confidence: 0
        }
      });
    }

    // Build prompt for Gemini
    const prompt = buildRecommendationPrompt(userBehavior, availableItems, categories, currentItem);

    // Call Gemini API directly via fetch to bypass SDK issues
    console.log('🔄 Calling Gemini API directly...');
    const apiKey = process.env.GEMINI_API_KEY;
    const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const fetchResponse = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!fetchResponse.ok) {
      const errorData = await fetchResponse.json();
      throw new Error(`Gemini API error (${fetchResponse.status}): ${JSON.stringify(errorData)}`);
    }

    const data = await fetchResponse.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!text) {
      throw new Error('No text response from Gemini API');
    }

    console.log('✅ Gemini response received');

    // Parse response
    const recommendations = parseGeminiResponse(text);

    res.json({
      success: true,
      recommendations,
      rawResponse: text
    });

  } catch (error) {
    console.error('❌ Error generating recommendations:', error);

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate recommendations'
    });
  }
});

// Helper function to build prompt
function buildRecommendationPrompt(behavior, availableItems, categories, currentItem) {
  // Get top categories
  const topCategories = Object.entries(behavior.categoryViews || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([catId]) => {
      const cat = categories.find(c => c.category_id?.toString() === catId);
      return cat ? cat.name : catId;
    });

  // Get recent viewed items
  const recentViews = (behavior.viewedItems || []).slice(0, 10);

  // Get favorited items
  const favorites = (behavior.favoritedItems || []).slice(0, 10);

  // Calculate average price
  const avgPrice = behavior.priceRangeHistory?.length > 0
    ? Math.round(behavior.priceRangeHistory.reduce((a, b) => a + b, 0) / behavior.priceRangeHistory.length)
    : 0;

  // Get top location
  const topLocation = Object.entries(behavior.locationPreferences || {})
    .sort(([, a], [, b]) => b - a)[0]?.[0] || '';

  const prompt = `You are a fast recommendation system for a rental marketplace.

USER INTERESTS:
- Top categories: ${topCategories.join(', ') || 'General'}
- Recently viewed: ${recentViews.slice(0, 5).map(v => v.title).join(', ') || 'None'}
- Favorited: ${favorites.slice(0, 3).map(f => f.title).join(', ') || 'None'}
- Avg price: ₱${avgPrice}
- Location: ${topLocation || 'Any'}

ITEMS:
${availableItems.slice(0, 20).map(item => {
    const itemId = item.item_id || item.raw?.item_id;
    const price = item.price || item.raw?.price_per_day;
    const location = item.location || item.raw?.location;
    const categoryId = item.category_id || item.raw?.category_id;
    return `ID:${itemId}|${item.title}|₱${price}|${location}|Cat:${categoryId}`;
  }).join('\n')}

TASK: Recommend 5 items matching user interests.

RULES:
1. Match user's categories and price range
2. Consider location preferences
3. Return valid IDs only

RESPONSE (JSON only):
{
  "recommendedItemIds": ["id1", "id2", "id3", "id4", "id5"],
  "reasoning": "Brief reason",
  "primaryInterests": ["category1"],
  "confidence": 0.8
}`;

  return prompt;
}

// Helper function to parse Gemini response
function parseGeminiResponse(text) {
  try {
    // Clean response
    let cleanText = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    // Extract JSON
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanText = jsonMatch[0];
    }

    const parsed = JSON.parse(cleanText);

    // Clean up recommendedItemIds - extract just the ID if it includes the full string
    let cleanedIds = (parsed.recommendedItemIds || []).map(id => {
      if (typeof id === 'string' && id.includes('ID:')) {
        // Extract just the ID part: "ID:123 - Title" -> "123"
        const match = id.match(/ID:(\S+)\s*-/);
        return match ? match[1] : id;
      }
      return id;
    });

    return {
      recommendedItemIds: cleanedIds,
      reasoning: parsed.reasoning || '',
      primaryInterests: parsed.primaryInterests || [],
      confidence: parsed.confidence || 0.5
    };
  } catch (error) {
    console.error('Failed to parse Gemini response:', error);
    return {
      recommendedItemIds: [],
      reasoning: "Unable to generate personalized recommendations",
      primaryInterests: [],
      confidence: 0.0
    };
  }
}

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
      sendNotification: 'POST /send-notification',
      recommendations: 'POST /api/recommendations'
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
      sendNotification: 'POST /send-notification',
      recommendations: 'POST /api/recommendations'
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`📍 Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`📍 Firebase test: http://localhost:${PORT}/test-firebase`);
  console.log(`📍 Recommendations: POST http://localhost:${PORT}/api/recommendations`);
  console.log(`📍 API base: http://localhost:${PORT}/`);
  console.log('🚀 Ready to send notifications and recommendations!');
});
require('dotenv').config();

async function listModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY not found in .env');
    return;
  }

  console.log('🔍 Fetching available models...\n');

  try {
    // Try v1 endpoint
    console.log('Trying v1 endpoint...');
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
    );

    const data = await response.json();

    if (data.models && data.models.length > 0) {
      console.log(`✅ Found ${data.models.length} models:\n`);
      
      data.models.forEach((model, i) => {
        console.log(`${i + 1}. ${model.name}`);
        console.log(`   Display: ${model.displayName}`);
        if (model.supportedGenerationMethods) {
          console.log(`   Methods: ${model.supportedGenerationMethods.join(', ')}`);
        }
        console.log('');
      });

      // Show which ones support generateContent
      const generateContentModels = data.models.filter(m => 
        m.supportedGenerationMethods?.includes('generateContent')
      );

      console.log('\n📌 Models that support generateContent:');
      generateContentModels.forEach(m => {
        const modelId = m.name.split('/')[1];
        console.log(`   - ${modelId}`);
      });

    } else if (data.error) {
      console.error('❌ API Error:', data.error.message);
    } else {
      console.log('Response:', JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

listModels();
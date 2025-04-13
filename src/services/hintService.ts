import { VertexAI } from '@google-cloud/vertexai';
import { TranslationServiceClient } from '@google-cloud/translate';

// Configuration
const PROJECT_ID = process.env.GOOGLE_PROJECT_ID || 'talkhint';
const LOCATION = 'us-central1'; // Or your preferred location
const MODEL_ID = 'gemini-1.5-flash-001'; // Or another suitable model
const TARGET_LANGUAGE = 'ru';

// Initialize clients with explicit types and error handling
let vertexAIInstance: VertexAI | null = null;
let translationClientInstance: TranslationServiceClient | null = null;
let initializationError: Error | null = null;

try {
  vertexAIInstance = new VertexAI({ project: PROJECT_ID, location: LOCATION });
  translationClientInstance = new TranslationServiceClient();
  console.log('[Hint Service Init] Google Cloud clients initialized successfully.');
} catch (error: any) {
  initializationError = error;
  console.error('[Hint Service Init Error] Failed to initialize Google Cloud clients:', error);
}

// Define the generative model (only if vertexAI initialized)
const generativeModel = vertexAIInstance 
    ? vertexAIInstance.getGenerativeModel({ model: MODEL_ID })
    : null;

// Simple prompt for generating conversational hints
function createPrompt(transcript: string): string {
  // Basic prompt, can be significantly improved
  return `Given the last thing the customer said: "${transcript}", generate 3 short, helpful, and relevant responses or questions a sales agent could say next. Provide only the responses, one per line.`;
}

async function translateText(text: string, targetLang: string): Promise<string> {
  if (!text) return '';
  if (!translationClientInstance) {
      console.error(`[Translate Error] Translation client not initialized (Initial error: ${initializationError?.message}). Cannot translate "${text}".`);
      return `[Translation N/A] ${text}`;
  }
  try {
    console.log(`[Translate Request] Translating "${text}" to ${targetLang}`);
    const [response] = await translationClientInstance.translateText({
      parent: `projects/${PROJECT_ID}/locations/global`,
      contents: [text],
      mimeType: 'text/plain',
      targetLanguageCode: targetLang,
    });
    const translated = response.translations?.[0]?.translatedText;
    if (translated) {
        console.log(`[Translate Success] "${text}" -> "${translated}"`);
        return translated;
    } else {
        console.warn(`[Translate Warn] No translation returned for "${text}"`);
        return text;
    }
  } catch (error) {
    console.error(`[Translate Error] Failed to translate "${text}":`, error);
    return text;
  }
}

export interface Hint {
  english: string;
  russian: string;
}

export async function generateHints(transcript: string): Promise<Hint[]> {
  if (!transcript) return [];
  if (!vertexAIInstance || !generativeModel) {
      console.error(`[Hint Gen Error] Vertex AI client or model not initialized (Initial error: ${initializationError?.message}). Cannot generate hints.`);
      return [];
  }

  try {
    const prompt = createPrompt(transcript);
    console.log('[Hint Gen Request] Generating hints for transcript:', transcript);

    const resp = await generativeModel.generateContent(prompt);
    console.log('[Hint Gen Raw Response] Full API Response:', JSON.stringify(resp.response, null, 2));

    const responseText = resp.response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) {
      console.warn('[Hint Gen Warn] No response text found in AI candidates.');
      return [];
    }
    console.log('[Hint Gen Raw Response Text]:', responseText);

    const englishHints = responseText
      .split('\n')
      .map((hint: string) => hint.trim().replace(/^- /,''))
      .filter((hint: string) => hint.length > 0);
    console.log('[Hint Gen Parsed Hints]:', englishHints);

    if (englishHints.length === 0) {
        console.warn('[Hint Gen Warn] No valid hints parsed from AI response text.');
        return [];
    }

    const hints: Hint[] = await Promise.all(
      englishHints.map(async (engHint: string) => {
        const rusHint = await translateText(engHint, TARGET_LANGUAGE);
        return { english: engHint, russian: rusHint };
      })
    );
    console.log('[Hint Gen Success] Final Hints with Translation:', hints);
    return hints;

  } catch (error) {
    console.error('[Hint Gen Error] Error during hint generation process:', error);
    return [];
  }
} 
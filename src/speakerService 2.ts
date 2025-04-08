import { promisify } from 'util';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

// Path to store the owner's voice embedding
const OWNER_VOICE_PATH = path.join(__dirname, '../data/owner_voice.json');

// Ensure the data directory exists
if (!fs.existsSync(path.dirname(OWNER_VOICE_PATH))) {
  fs.mkdirSync(path.dirname(OWNER_VOICE_PATH), { recursive: true });
}

// Threshold for cosine similarity to determine if a voice matches the owner
const SIMILARITY_THRESHOLD = 0.85;

/**
 * Saves the owner's voice embedding
 * @param audioChunk The audio data to save as the owner's voice
 * @returns Promise that resolves when the voice is saved
 */
export async function saveOwnerVoice(audioChunk: number[]): Promise<void> {
  try {
    console.log(`Saving owner voice, audio length: ${audioChunk.length}`);
    
    // Save the audio data to a temporary file
    const tempAudioPath = path.join(__dirname, '../data/temp_audio.raw');
    const audioBuffer = Buffer.from(new Int16Array(audioChunk).buffer);
    fs.writeFileSync(tempAudioPath, audioBuffer);
    
    // Use Python script to extract voice embedding
    const pythonScript = path.join(__dirname, '../scripts/extract_embedding.py');
    const { stdout } = await execAsync(`python3 ${pythonScript} ${tempAudioPath}`);
    
    // Parse the embedding from the Python script output
    const embedding = JSON.parse(stdout);
    console.log(`Extracted voice embedding, length: ${embedding.length}`);
    
    // Save the embedding to a file
    fs.writeFileSync(OWNER_VOICE_PATH, JSON.stringify(embedding));
    console.log(`Owner voice saved to ${OWNER_VOICE_PATH}`);
    
    // Clean up the temporary file
    fs.unlinkSync(tempAudioPath);
  } catch (error) {
    console.error('Error saving owner voice:', error);
    throw error;
  }
}

/**
 * Checks if the provided audio matches the owner's voice
 * @param audioChunk The audio data to check
 * @returns Promise that resolves to true if the voice matches the owner
 */
export async function isOwnerVoice(audioChunk: number[]): Promise<boolean> {
  try {
    // Check if owner voice exists
    if (!fs.existsSync(OWNER_VOICE_PATH)) {
      console.log('Owner voice not found, treating as guest');
      return false;
    }
    
    console.log(`Checking if voice matches owner, audio length: ${audioChunk.length}`);
    
    // Save the audio data to a temporary file
    const tempAudioPath = path.join(__dirname, '../data/temp_audio.raw');
    const audioBuffer = Buffer.from(new Int16Array(audioChunk).buffer);
    fs.writeFileSync(tempAudioPath, audioBuffer);
    
    // Use Python script to extract voice embedding
    const pythonScript = path.join(__dirname, '../scripts/extract_embedding.py');
    const { stdout } = await execAsync(`python3 ${pythonScript} ${tempAudioPath}`);
    
    // Parse the embedding from the Python script output
    const embedding = JSON.parse(stdout);
    console.log(`Extracted voice embedding, length: ${embedding.length}`);
    
    // Load the owner's voice embedding
    const ownerEmbedding = JSON.parse(fs.readFileSync(OWNER_VOICE_PATH, 'utf8'));
    
    // Calculate cosine similarity
    const similarity = cosineSimilarity(embedding, ownerEmbedding);
    console.log(`Voice similarity: ${similarity}`);
    
    // Clean up the temporary file
    fs.unlinkSync(tempAudioPath);
    
    // Return true if similarity is above threshold
    return similarity >= SIMILARITY_THRESHOLD;
  } catch (error) {
    console.error('Error checking owner voice:', error);
    return false;
  }
}

/**
 * Calculates cosine similarity between two vectors
 * @param vec1 First vector
 * @param vec2 Second vector
 * @returns Cosine similarity between the vectors
 */
function cosineSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length) {
    throw new Error('Vectors must have the same length');
  }
  
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }
  
  norm1 = Math.sqrt(norm1);
  norm2 = Math.sqrt(norm2);
  
  if (norm1 === 0 || norm2 === 0) {
    return 0;
  }
  
  return dotProduct / (norm1 * norm2);
} 
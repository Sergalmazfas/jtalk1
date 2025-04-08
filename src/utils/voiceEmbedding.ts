/**
 * Utility functions for voice embedding comparison
 */

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(vec1: number[], vec2: number[]): number {
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

/**
 * Compare voice embeddings and determine if they match
 * @param current Current voice embedding
 * @param owner Owner's voice embedding
 * @param threshold Similarity threshold (default: 0.85)
 * @returns true if the voices match, false otherwise
 */
export function compareVoiceEmbeddings(
    current: number[],
    owner: number[],
    threshold: number = 0.85
): boolean {
    const similarity = cosineSimilarity(current, owner);
    return similarity >= threshold;
}

/**
 * Extract voice features from audio data
 * This is a placeholder for actual voice feature extraction
 * In a real implementation, this would use a proper voice embedding model
 */
export function extractVoiceFeatures(audioData: Int16Array): number[] {
    // TODO: Implement actual voice feature extraction
    // For now, return a simple feature vector based on audio statistics
    const features: number[] = [];
    
    // Calculate basic audio statistics
    let sum = 0;
    let sumSquares = 0;
    let zeroCrossings = 0;
    
    for (let i = 0; i < audioData.length; i++) {
        sum += audioData[i];
        sumSquares += audioData[i] * audioData[i];
        if (i > 0 && (audioData[i] * audioData[i - 1] < 0)) {
            zeroCrossings++;
        }
    }
    
    const mean = sum / audioData.length;
    const variance = (sumSquares / audioData.length) - (mean * mean);
    const stdDev = Math.sqrt(variance);
    
    features.push(mean / 32768); // Normalize to [-1, 1]
    features.push(stdDev / 32768);
    features.push(zeroCrossings / audioData.length);
    
    return features;
} 
#!/usr/bin/env python3
import sys
import json
import numpy as np
from resemblyzer import preprocess_wav, VoiceEncoder

def extract_embedding(audio_path):
    """
    Extract voice embedding from an audio file using Resemblyzer
    
    Args:
        audio_path: Path to the audio file
        
    Returns:
        List of embedding values
    """
    try:
        # Initialize the voice encoder
        encoder = VoiceEncoder()
        
        # Preprocess the audio file
        wav = preprocess_wav(audio_path)
        
        # Extract the embedding
        embedding = encoder.embed_utterance(wav)
        
        # Convert numpy array to list for JSON serialization
        embedding_list = embedding.tolist()
        
        # Print the embedding as JSON
        print(json.dumps(embedding_list))
        
        return embedding_list
    except Exception as e:
        print(f"Error extracting embedding: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python extract_embedding.py <audio_file>", file=sys.stderr)
        sys.exit(1)
    
    audio_path = sys.argv[1]
    extract_embedding(audio_path) 
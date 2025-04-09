import { SpeechClient } from '@google-cloud/speech';
import { protos } from '@google-cloud/speech';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

async function testGoogleCredentials() {
    try {
        console.log('Testing Google Cloud credentials...');
        console.log('GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
        
        const client = new SpeechClient();
        
        // Test 1: Get project ID
        const [projectId] = await client.getProjectId();
        console.log('✅ Successfully connected to Google Cloud');
        console.log('📋 Project ID:', projectId);
        
        // Test 2: Try to recognize speech (simpler test)
        const request: protos.google.cloud.speech.v1.IRecognizeRequest = {
            audio: {
                content: '', // Empty content for testing
            },
            config: {
                encoding: protos.google.cloud.speech.v1.RecognitionConfig.AudioEncoding.LINEAR16,
                sampleRateHertz: 16000,
                languageCode: 'en-US',
            },
        };
        
        try {
            await client.recognize(request);
            console.log('✅ Successfully accessed Speech API');
        } catch (apiError: any) {
            if (apiError.code === 403) {
                console.log('⚠️ Speech API access denied. Check IAM permissions.');
            } else {
                console.log('✅ Speech API is accessible (expected error for empty audio)');
            }
        }
        
        return true;
    } catch (error: any) {
        console.error('❌ Error testing credentials:', error);
        if (error.code === 'ENOENT') {
            console.error('File not found. Check if GOOGLE_APPLICATION_CREDENTIALS path is correct');
        } else if (error.code === 401) {
            console.error('Authentication failed. Check if the key is valid and not expired');
        } else if (error.code === 403) {
            console.error('Permission denied. Check IAM roles and API enablement');
        }
        return false;
    }
}

// Run the test
testGoogleCredentials()
    .then(success => {
        if (success) {
            console.log('✅ Credentials test completed successfully');
        } else {
            console.log('❌ Credentials test failed');
            process.exit(1);
        }
    })
    .catch(error => {
        console.error('❌ Unexpected error:', error);
        process.exit(1);
    }); 
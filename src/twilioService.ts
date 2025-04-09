import twilio from 'twilio';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { SpeechClient } from '@google-cloud/speech';
import { IncomingPhoneNumberContextUpdateOptions } from 'twilio/lib/rest/api/v2010/account/incomingPhoneNumber';
import { Twilio } from 'twilio';

// Load environment variables
dotenv.config();

// Twilio credentials
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioNumber = process.env.TWILIO_PHONE_NUMBER;
const webhookUrl = process.env.WEBHOOK_URL;

// Validate credentials
if (!accountSid || !authToken || !twilioNumber || !webhookUrl) {
  throw new Error('Missing required Twilio credentials. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, and WEBHOOK_URL');
}

if (!accountSid.startsWith('AC')) {
  throw new Error('Invalid TWILIO_ACCOUNT_SID format. It should start with "AC"');
}

// Initialize Twilio client
const twilioClient = new Twilio(accountSid, authToken);

// Initialize Google Speech-to-Text client
const speechClient = new SpeechClient();

// Store active calls
const activeCalls = new Map<string, any>();

/**
 * Verify Twilio credentials
 */
export async function verifyTwilioCredentials(): Promise<boolean> {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      console.error('Missing Twilio credentials');
      return false;
    }

    const client = twilio(accountSid, authToken);
    const account = await client.api.accounts(accountSid).fetch();
    
    if (account.status !== 'active') {
      console.error('Twilio account is not active');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error verifying Twilio credentials:', error);
    return false;
  }
}

/**
 * Initialize Twilio service
 */
export async function initTwilioService() {
  try {
    console.log('Initializing Twilio service...');
    
    // Verify credentials first
    const isValid = await verifyTwilioCredentials();
    if (!isValid) {
      throw new Error('Invalid Twilio credentials');
    }
    
    // Configure phone number
    await configurePhoneNumber();
    
    console.log('Twilio service initialized successfully');
  } catch (error) {
    const twilioError = error as Error;
    console.error('Error initializing Twilio service:', {
      error: twilioError.message,
      stack: twilioError.stack,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * Configure phone number for voice webhooks
 */
async function configurePhoneNumber() {
  try {
    const phoneNumber = await twilioClient.incomingPhoneNumbers
      .list({ phoneNumber: twilioNumber })
      .then(numbers => numbers[0]);

    if (phoneNumber) {
      await twilioClient.incomingPhoneNumbers(phoneNumber.sid)
        .update({
          // Primary handler for incoming calls
          voiceUrl: `${webhookUrl}/voice`,
          voiceMethod: 'POST',
          
          // Fallback URL if primary handler fails
          voiceFallbackUrl: `${webhookUrl}/twilio-webhook-fallback`,
          voiceFallbackMethod: 'POST',
          
          // Call status changes
          statusCallback: `${webhookUrl}/call-status`,
          statusCallbackMethod: 'POST',
          statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed', 'failed', 'busy', 'no-answer'],
          
          // Caller Name Lookup
          callerIdLookup: true,
          
          // Recording configuration
          recordingStatusCallback: `${webhookUrl}/recording-status`,
          recordingStatusCallbackMethod: 'POST',
          recordingStatusCallbackEvent: ['completed', 'failed'],
          
          // Transcription configuration
          transcribe: true,
          transcribeCallback: `${webhookUrl}/transcription-complete`,
          transcribeCallbackMethod: 'POST'
        } as IncomingPhoneNumberContextUpdateOptions);
      console.log('✅ Phone number configured for voice webhooks');
    } else {
      console.error('❌ Phone number not found in your Twilio account');
    }
  } catch (error) {
    console.error('❌ Error configuring phone number:', error);
  }
}

/**
 * Make a call to a phone number
 * @param phoneNumber Phone number to call
 * @param webhookUrl Webhook URL for the call
 * @returns Call SID
 */
export async function makeCall(phoneNumber: string, webhookUrl: string): Promise<string> {
  console.log('Making call to:', phoneNumber);
  console.log('Using webhook URL:', webhookUrl);
  
  if (!accountSid || !authToken || !twilioNumber) {
    throw new Error('Twilio credentials not configured');
  }

  try {
    const call = await twilioClient.calls.create({
      to: phoneNumber,
      from: twilioNumber,
      url: webhookUrl,
      statusCallback: webhookUrl,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST'
    });

    console.log('Call created:', call.sid);
    return call.sid;
  } catch (error) {
    console.error('Error making call:', error);
    throw error;
  }
}

/**
 * Handle incoming call
 * @param callSid Call SID
 * @param from Phone number of the caller
 * @param to Phone number of the recipient
 * @param direction Call direction (inbound or outbound)
 * @param status Call status
 * @param recordingUrl URL of the recording (if available)
 * @param recordingSid Recording SID (if available)
 * @param recordingDuration Recording duration in seconds (if available)
 * @param recordingStatus Recording status (if available)
 * @param recordingChannels Recording channels (if available)
 * @param recordingSource Recording source (if available)
 * @param recordingErrorCode Recording error code (if available)
 * @param recordingErrorMsg Recording error message (if available)
 */
export async function handleCall(
  callSid: string,
  from: string,
  to: string,
  direction: string,
  status: string,
  recordingUrl?: string,
  recordingSid?: string,
  recordingDuration?: number,
  recordingStatus?: string,
  recordingChannels?: number,
  recordingSource?: string,
  recordingErrorCode?: string,
  recordingErrorMsg?: string
): Promise<void> {
  try {
    console.log(`Call ${callSid} from ${from} to ${to} (${direction}) - Status: ${status}`);
    
    // Store call information
    activeCalls.set(callSid, {
      from,
      to,
      direction,
      status,
      recordingUrl,
      recordingSid,
      recordingDuration,
      recordingStatus,
      recordingChannels,
      recordingSource,
      recordingErrorCode,
      recordingErrorMsg,
      startTime: new Date(),
    });
    
    // If call is completed and we have a recording, process it
    if (status === 'completed' && recordingUrl) {
      console.log(`Call ${callSid} completed with recording: ${recordingUrl}`);
      
      // Download the recording
      const recordingPath = path.join(__dirname, '../data/recordings', `${callSid}.wav`);
      
      // Ensure the recordings directory exists
      if (!fs.existsSync(path.dirname(recordingPath))) {
        fs.mkdirSync(path.dirname(recordingPath), { recursive: true });
      }
      
      // Download the recording
      const response = await fetch(recordingUrl);
      const buffer = await response.arrayBuffer();
      fs.writeFileSync(recordingPath, Buffer.from(buffer));
      
      console.log(`Recording saved to ${recordingPath}`);
      
      // Process the recording with Google Speech-to-Text
      await processRecording(recordingPath, callSid);
    }
  } catch (error) {
    console.error(`Error handling call ${callSid}:`, error);
  }
}

/**
 * Process a recording with Google Speech-to-Text
 * @param recordingPath Path to the recording file
 * @param callSid Call SID
 */
async function processRecording(recordingPath: string, callSid: string): Promise<void> {
  try {
    // Read the recording file
    const audioBytes = fs.readFileSync(recordingPath).toString('base64');
    
    // Configure the request
    const audio = {
      content: audioBytes,
    };
    
    const config = {
      encoding: 'LINEAR16' as const,
      sampleRateHertz: 8000,
      languageCode: 'en-US',
      model: 'phone_call',
      useEnhanced: true,
    };
    
    const request = {
      audio: audio,
      config: config,
    };
    
    // Detect speech in the audio file
    const [response] = await speechClient.recognize(request);
    const transcription = response.results
      ?.map((result: any) => result.alternatives?.[0]?.transcript)
      .join('\n');
    
    console.log(`Transcription for call ${callSid}: ${transcription}`);
    
    // Store the transcription
    const transcriptionPath = path.join(__dirname, '../data/transcriptions', `${callSid}.txt`);
    
    // Ensure the transcriptions directory exists
    if (!fs.existsSync(path.dirname(transcriptionPath))) {
      fs.mkdirSync(path.dirname(transcriptionPath), { recursive: true });
    }
    
    // Save the transcription
    fs.writeFileSync(transcriptionPath, transcription || '');
    
    console.log(`Transcription saved to ${transcriptionPath}`);
  } catch (error) {
    console.error(`Error processing recording for call ${callSid}:`, error);
  }
}

/**
 * Get all active calls
 * @returns Map of active calls
 */
export function getActiveCalls(): Map<string, any> {
  return activeCalls;
}

/**
 * Get a specific call by SID
 * @param callSid Call SID
 * @returns Call information
 */
export function getCall(callSid: string): any {
  return activeCalls.get(callSid);
}

/**
 * End a call
 * @param callSid Call SID to end
 * @returns Promise that resolves when the call is ended
 */
export async function endCall(callSid: string): Promise<void> {
  try {
    console.log(`Ending call ${callSid}`);
    await twilioClient.calls(callSid).update({ status: 'completed' });
    console.log(`Call ${callSid} ended successfully`);
  } catch (error) {
    console.error(`Error ending call ${callSid}:`, error);
    throw error;
  }
}
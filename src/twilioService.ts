import twilio from 'twilio';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { SpeechClient } from '@google-cloud/speech';

// Load environment variables
dotenv.config();

// Twilio credentials
const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
const authToken = process.env.TWILIO_AUTH_TOKEN || '';
const apiKey = process.env.TWILIO_API_KEY || '';
const apiSecret = process.env.TWILIO_API_SECRET || '';
const twilioNumber = process.env.TWILIO_PHONE_NUMBER || '';
const webhookUrl = process.env.WEBHOOK_URL || '';

// Initialize Twilio client
const client = twilio(accountSid, authToken);

// Initialize Google Speech-to-Text client
const speechClient = new SpeechClient();

// Store active calls
const activeCalls = new Map<string, any>();

/**
 * Initialize Twilio service and verify connection
 */
export async function initTwilioService() {
  if (!accountSid || !authToken || !twilioNumber) {
    console.error('Twilio credentials not found. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env file');
    return;
  }

  try {
    // Verify Twilio connection
    const account = await client.api.accounts(accountSid).fetch();
    console.log('✅ Twilio connected:', account.friendlyName);

    // Configure phone number for voice webhooks
    await configurePhoneNumber();
  } catch (error) {
    console.error('❌ Error connecting to Twilio:', error);
  }
}

/**
 * Configure phone number for voice webhooks
 */
async function configurePhoneNumber() {
  try {
    const phoneNumber = await client.incomingPhoneNumbers
      .list({ phoneNumber: twilioNumber })
      .then(numbers => numbers[0]);

    if (phoneNumber) {
      await client.incomingPhoneNumbers(phoneNumber.sid)
        .update({
          voiceUrl: `${webhookUrl}/voice`,
          voiceMethod: 'POST',
          statusCallback: `${webhookUrl}/call-status`,
          statusCallbackMethod: 'POST',
          statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        });
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
 * @param to Phone number to call
 * @param webhookUrl Webhook URL for call status updates
 * @returns Call SID
 */
export async function makeCall(to: string, webhookUrl: string): Promise<string> {
  try {
    const call = await client.calls.create({
      to,
      from: twilioNumber,
      url: `${webhookUrl}/voice`,
      statusCallback: `${webhookUrl}/call-status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
      record: true,
      recordingStatusCallback: `${webhookUrl}/recording-status`,
      recordingStatusCallbackEvent: ['completed'],
      recordingStatusCallbackMethod: 'POST',
    });
    
    console.log(`Call initiated to ${to}, SID: ${call.sid}`);
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
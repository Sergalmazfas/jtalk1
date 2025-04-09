import express, { Request, Response, Router, RequestHandler } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { SpeechClient } from '@google-cloud/speech';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { createServer } from 'http';
import { initTwilioService, makeCall, handleCall, getActiveCalls, getCall } from './twilioService';
import { createDialog, addMessage, addTranscription, endDialog, getDialog, getAllDialogs } from './services/dialogService';
import VoiceResponse = require('twilio/lib/twiml/VoiceResponse');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const router = Router();
const port = process.env.PORT || 8080;

// Create HTTP server
const server = createServer(app);

// Initialize WebSocket server
const wss = new WebSocketServer({ server });

// Initialize Google Speech-to-Text client
const speechClient = new SpeechClient();

// Store WebSocket connections
const connections = new Map<string, WebSocket>();

// Store recognition streams
const recognitionStreams = new Map<string, any>();

// Store audio buffers
const audioBuffers = new Map<string, Buffer[]>();

// Initialize Twilio service
initTwilioService();

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Parse JSON bodies
app.use(express.json());

// Parse URL-encoded bodies (required for Twilio webhooks)
app.use(express.urlencoded({ extended: false }));

// Mount the router
app.use('/api', router);

// Handle Twilio webhook
app.post('/twilio-webhook', (req, res) => {
  console.log('Received Twilio webhook request headers:', req.headers);
  console.log('Received Twilio webhook body:', req.body);
  
  if (!req.body.CallSid) {
    console.error('Missing CallSid in webhook request');
    return res.status(400).send('Missing CallSid');
  }
  
  const twiml = new VoiceResponse();
  
  // Create a new dialog for this call
  const callSid = req.body.CallSid;
  createDialog(callSid);
  
  // Add greeting message
  twiml.say({
    voice: 'alice',
    language: 'ru-RU'
  }, 'Здравствуйте, вы позвонили в TalkHint. Пожалуйста, говорите после сигнала.');
  
  // Add recording with transcription
  twiml.record({
    timeout: 5,
    maxLength: 30,
    transcribe: true,
    transcribeCallback: '/api/transcription-complete',
    action: '/api/recording-complete',
    method: 'POST'
  });
  
  const response = twiml.toString();
  console.log('Sending TwiML response:', response);
  
  res.type('text/xml');
  res.send(response);
});

// Handle recording completion
app.post('/api/recording-complete', async (req, res) => {
  console.log('Recording completed:', req.body);
  
  const twiml = new VoiceResponse();
  twiml.say({
    voice: 'alice',
    language: 'ru-RU'
  }, 'Спасибо за ваш звонок. До свидания!');
  
  // End the dialog
  const callSid = req.body.CallSid;
  endDialog(callSid);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// Handle transcription completion
app.post('/api/transcription-complete', async (req, res) => {
  try {
    const { RecordingSid, RecordingUrl, TranscriptionText, CallSid } = req.body;
    console.log('Transcription received:', { RecordingSid, RecordingUrl, TranscriptionText });
    
    // Add transcription to dialog
    const segment = addTranscription(CallSid, TranscriptionText, true);
    
    // Broadcast to all connected clients
    broadcastToClients({
      type: 'transcription',
      data: segment
    });
    
    // Process with Google Speech-to-Text for better accuracy
    if (RecordingUrl) {
      const [response] = await speechClient.recognize({
        audio: {
          uri: RecordingUrl
        },
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: 8000,
          languageCode: 'ru-RU',
          model: 'phone_call'
        }
      });
      
      const transcription = response.results
        ?.map(result => result.alternatives?.[0]?.transcript)
        .join('\n');
      
      if (transcription) {
        // Add message to dialog
        const message = await addMessage(CallSid, 'guest', transcription);
        
        // Broadcast to all connected clients
        broadcastToClients({
          type: 'message',
          data: message
        });
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Error processing transcription:', error);
    res.sendStatus(500);
  }
});

// WebSocket connection handler
wss.on('connection', (ws: WebSocket) => {
  const id = uuidv4();
  connections.set(id, ws);
  
  ws.on('message', (message: string) => {
    try {
      const data = JSON.parse(message);
      // Handle WebSocket messages
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
    }
  });
  
  ws.on('close', () => {
    connections.delete(id);
  });
});

// Broadcast to all connected clients
function broadcastToClients(message: any) {
  const data = JSON.stringify(message);
  connections.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// Handle incoming calls
const handleIncomingCall: RequestHandler = (req, res, next) => {
  try {
    console.log('Received call request:', req.body);
    
    const { to, webhookUrl } = req.body;
    
    if (!to || !webhookUrl) {
      console.error('Missing required parameters:', { to, webhookUrl });
      res.status(400).json({ 
        error: 'Missing required parameters',
        details: {
          to: to ? 'present' : 'missing',
          webhookUrl: webhookUrl ? 'present' : 'missing'
        }
      });
      return;
    }
    
    console.log('Initiating call with parameters:', { to, webhookUrl });
    
    makeCall(to, webhookUrl)
      .then(callSid => {
        console.log('Call initiated successfully:', { callSid });
        res.json({ callSid });
      })
      .catch(error => {
        console.error('Error handling call:', {
          error: error.message,
          stack: error.stack,
          to,
          webhookUrl
        });
        res.status(500).json({ 
          error: 'Internal server error',
          details: error.message
        });
      });
  } catch (error) {
    console.error('Error handling call request:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      body: req.body
    });
    res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Handle voice webhook
const handleVoiceWebhook: RequestHandler = (req, res, next) => {
  const twiml = new VoiceResponse();
  
  // Add a <Say> verb to provide instructions
  twiml.say('Welcome to JTalk1. Please start speaking after the tone.');
  
  // Add a <Record> verb to record the call
  twiml.record({
    action: '/recording-complete',
    method: 'POST',
    maxLength: 3600,
    timeout: 5,
    transcribe: true,
    transcribeCallback: '/transcription-complete',
  });
  
  res.type('text/xml');
  res.send(twiml.toString());
};

// Handle call status updates
const handleCallStatus: RequestHandler = (req, res, next) => {
  try {
    const {
      CallSid,
      From,
      To,
      Direction,
      CallStatus,
      RecordingUrl,
      RecordingSid,
      RecordingDuration,
      RecordingStatus,
      RecordingChannels,
      RecordingSource,
      RecordingErrorCode,
      RecordingErrorMsg,
    } = req.body;
    
    handleCall(
      CallSid,
      From,
      To,
      Direction,
      CallStatus,
      RecordingUrl,
      RecordingSid,
      RecordingDuration,
      RecordingStatus,
      RecordingChannels,
      RecordingSource,
      RecordingErrorCode,
      RecordingErrorMsg
    )
      .then(() => res.sendStatus(200))
      .catch(error => {
        console.error('Error handling call status:', error);
        res.status(500).json({ error: 'Internal server error' });
      });
  } catch (error) {
    console.error('Error handling call status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Handle recording status updates
const handleRecordingStatus: RequestHandler = async (req, res, next) => {
  try {
    const {
      RecordingSid,
      RecordingUrl,
      RecordingStatus,
      RecordingDuration,
      RecordingChannels,
      RecordingSource,
      RecordingErrorCode,
      RecordingErrorMsg,
    } = req.body;
    
    console.log(`Recording ${RecordingSid} status: ${RecordingStatus}`);
    
    if (RecordingStatus === 'completed') {
      // Download the recording
      const recordingPath = path.join(__dirname, '../data/recordings', `${RecordingSid}.wav`);
      
      // Ensure the recordings directory exists
      if (!fs.existsSync(path.dirname(recordingPath))) {
        fs.mkdirSync(path.dirname(recordingPath), { recursive: true });
      }
      
      // Download the recording
      const response = await fetch(RecordingUrl);
      const buffer = await response.arrayBuffer();
      fs.writeFileSync(recordingPath, Buffer.from(buffer));
      
      console.log(`Recording saved to ${recordingPath}`);
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Error handling recording status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get active calls
const handleGetActiveCalls: RequestHandler = (req, res, next) => {
  const calls = Array.from(getActiveCalls().entries()).map(([callSid, call]) => ({
    callSid,
    ...call,
  }));
  
  res.json(calls);
};

// Get a specific call
const handleGetCall: RequestHandler = (req, res, next) => {
  const { callSid } = req.params;
  const call = getCall(callSid);
  
  if (!call) {
    res.status(404).json({ error: 'Call not found' });
    return;
  }
  
  res.json({ callSid, ...call });
};

// Handle voice fallback webhook
const handleVoiceFallback: RequestHandler = (req, res, next) => {
  const twiml = new VoiceResponse();
  
  // Add a simple fallback message
  twiml.say('We are experiencing technical difficulties. Please try again later.');
  
  res.type('text/xml');
  res.send(twiml.toString());
};

// Handle transcription complete webhook
const handleTranscriptionComplete: RequestHandler = (req, res, next) => {
  try {
    const {
      CallSid,
      TranscriptionSid,
      TranscriptionText,
      TranscriptionStatus,
      TranscriptionUrl,
      RecordingSid,
      RecordingUrl
    } = req.body;
    
    console.log(`Transcription complete for call ${CallSid}:`, {
      status: TranscriptionStatus,
      text: TranscriptionText,
      url: TranscriptionUrl
    });
    
    // Add transcription to dialog
    if (TranscriptionText) {
      addTranscription(CallSid, TranscriptionText, true);
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Error handling transcription complete:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Handle Twilio call status updates
app.post('/call-status', (req, res) => {
  console.log('Twilio status callback:', req.body);
  res.status(200).send('OK');
});

// Handle incoming calls
router.post('/call', handleIncomingCall);
router.post('/voice', handleVoiceWebhook);
router.post('/voice-fallback', handleVoiceFallback);
router.post('/call-status', handleCallStatus);
router.post('/recording-status', handleRecordingStatus);
router.post('/transcription-complete', handleTranscriptionComplete);
router.get('/calls', handleGetActiveCalls);
router.get('/calls/:callSid', handleGetCall);

// Start the server
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log('Available routes:');
  console.log('POST /api/call - Make a call');
  console.log('POST /api/voice - Handle voice webhook');
  console.log('POST /api/voice-fallback - Handle voice fallback');
  console.log('POST /api/call-status - Handle call status');
  console.log('POST /api/recording-status - Handle recording status');
  console.log('POST /api/transcription-complete - Handle transcription complete');
  console.log('GET /api/calls - Get all calls');
  console.log('GET /api/calls/:callSid - Get specific call');
}); 
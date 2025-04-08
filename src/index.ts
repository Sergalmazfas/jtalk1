import express, { Request, Response, Router, RequestHandler } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { SpeechClient } from '@google-cloud/speech';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { initTwilioService, makeCall, handleCall, getActiveCalls, getCall } from './twilioService';
import VoiceResponse = require('twilio/lib/twiml/VoiceResponse');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const router = Router();
const port = process.env.PORT || 8085;

// Initialize WebSocket server
const wss = new WebSocketServer({ port: 8086 });

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
app.use(express.static('public'));

// Parse JSON bodies
app.use(express.json());

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

// Handle incoming calls
const handleIncomingCall: RequestHandler = (req, res, next) => {
  try {
    const { to, webhookUrl } = req.body;
    
    if (!to || !webhookUrl) {
      res.status(400).json({ error: 'Missing required parameters' });
      return;
    }
    
    makeCall(to, webhookUrl)
      .then(callSid => res.json({ callSid }))
      .catch(error => {
        console.error('Error handling call:', error);
        res.status(500).json({ error: 'Internal server error' });
      });
  } catch (error) {
    console.error('Error handling call:', error);
    res.status(500).json({ error: 'Internal server error' });
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

// Handle recording completion
const handleRecordingComplete: RequestHandler = (req, res, next) => {
  const twiml = new VoiceResponse();
  
  // Add a <Say> verb to acknowledge recording completion
  twiml.say('Thank you for your message. Goodbye!');
  
  res.type('text/xml');
  res.send(twiml.toString());
};

// Handle transcription completion
const handleTranscriptionComplete: RequestHandler = async (req, res, next) => {
  try {
    const { RecordingSid, RecordingUrl, TranscriptionText } = req.body;
    
    console.log(`Transcription received for recording ${RecordingSid}: ${TranscriptionText}`);
    
    // Store the transcription
    const transcriptionPath = path.join(__dirname, '../data/transcriptions', `${RecordingSid}.txt`);
    
    // Ensure the transcriptions directory exists
    if (!fs.existsSync(path.dirname(transcriptionPath))) {
      fs.mkdirSync(path.dirname(transcriptionPath), { recursive: true });
    }
    
    // Save the transcription
    fs.writeFileSync(transcriptionPath, TranscriptionText || '');
    
    console.log(`Transcription saved to ${transcriptionPath}`);
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Error handling transcription:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
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

// WebSocket connection handler
wss.on('connection', (ws: WebSocket) => {
  const connectionId = uuidv4();
  connections.set(connectionId, ws);
  
  console.log(`New WebSocket connection: ${connectionId}`);
  
  // Create recognition stream
  const recognitionStream = speechClient
    .streamingRecognize({
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: 'en-US',
        model: 'phone_call',
        useEnhanced: true,
      },
      interimResults: true,
    })
    .on('error', (error) => {
      console.error('Recognition stream error:', error);
      cleanupConnection(connectionId);
    })
    .on('data', (data) => {
      const transcript = data.results[0]?.alternatives[0]?.transcript || '';
      
      if (data.results[0]?.isFinal) {
        ws.send(JSON.stringify({
          type: 'transcript',
          text: transcript,
          isFinal: true,
        }));
      } else {
        ws.send(JSON.stringify({
          type: 'transcript',
          text: transcript,
          isFinal: false,
        }));
      }
    });
  
  recognitionStreams.set(connectionId, recognitionStream);
  audioBuffers.set(connectionId, []);
  
  // Handle incoming messages
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.type === 'audio') {
        const audioBuffer = Buffer.from(data.audio, 'base64');
        audioBuffers.get(connectionId)?.push(audioBuffer);
        
        try {
          recognitionStream.write(audioBuffer);
        } catch (error) {
          console.error('Error writing to recognition stream:', error);
          // Buffer the audio data for later
          audioBuffers.get(connectionId)?.push(audioBuffer);
        }
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
    }
  });
  
  // Handle connection close
  ws.on('close', () => {
    console.log(`WebSocket connection closed: ${connectionId}`);
    cleanupConnection(connectionId);
  });
});

// Cleanup function
function cleanupConnection(connectionId: string) {
  const ws = connections.get(connectionId);
  const recognitionStream = recognitionStreams.get(connectionId);
  
  if (ws) {
    ws.close();
    connections.delete(connectionId);
  }
  
  if (recognitionStream) {
    recognitionStream.destroy();
    recognitionStreams.delete(connectionId);
  }
  
  audioBuffers.delete(connectionId);
}

// Register routes
router.post('/call', handleIncomingCall);
router.post('/call-status', handleCallStatus);
router.post('/voice', handleVoiceWebhook);
router.post('/recording-complete', handleRecordingComplete);
router.post('/transcription-complete', handleTranscriptionComplete);
router.post('/recording-status', handleRecordingStatus);
router.get('/calls', handleGetActiveCalls);
router.get('/calls/:callSid', handleGetCall);

// Use the router
app.use('/', router);

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}); 
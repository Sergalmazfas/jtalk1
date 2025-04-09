import express, { Request, Response, Router, RequestHandler } from 'express';
import { WebSocket, Server as WebSocketServer } from 'ws';
import { SpeechClient } from '@google-cloud/speech';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { createServer } from 'http';
import { initTwilioService, makeCall, handleCall, getActiveCalls, getCall, endCall, verifyTwilioCredentials } from './twilioService';
import { createDialog, addMessage, addTranscription, endDialog, getDialog, getAllDialogs } from './services/dialogService';
import VoiceResponse = require('twilio/lib/twiml/VoiceResponse');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const router = Router();
const port = 8080; // Fixed port for Cloud Run
const host = '0.0.0.0'; // Fixed host for Cloud Run

// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Add security headers
app.use((req, res, next) => {
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  res.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Create HTTP server
const server = createServer(app);

// Initialize WebSocket server with proper upgrade handling
const wss = new WebSocketServer({ 
  server,
  path: '/ws',
  perMessageDeflate: {
    zlibDeflateOptions: {
      chunkSize: 1024,
      memLevel: 7,
      level: 3
    },
    zlibInflateOptions: {
      chunkSize: 10 * 1024
    },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    serverMaxWindowBits: 10,
    concurrencyLimit: 10,
    threshold: 1024
  }
});

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
  console.log('Received Twilio webhook request:', {
    headers: req.headers,
    body: req.body,
    timestamp: new Date().toISOString()
  });
  
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
    transcribeCallback: `${process.env.WEBHOOK_URL}/api/transcription-complete`,
    action: `${process.env.WEBHOOK_URL}/api/recording-complete`,
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
  
  const { CallSid, RecordingUrl, RecordingDuration } = req.body;
  
  if (!CallSid || !RecordingUrl) {
    console.error('Missing required parameters in recording webhook:', req.body);
    return res.status(400).send('Missing required parameters');
  }
  
  try {
    // Process recording with Google Speech-to-Text
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
      // Add transcription to dialog
      await addTranscription(CallSid, transcription);
      
      // Send transcription to connected clients
      const ws = connections.get(CallSid);
      if (ws) {
        ws.send(JSON.stringify({
          type: 'transcription',
          text: transcription,
          isFinal: true
        }));
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling recording:', error);
    res.status(500).send('Internal server error');
  }
});

// Handle transcription completion
app.post('/api/transcription-complete', async (req, res) => {
  console.log('Transcription completed:', req.body);
  
  const { CallSid, TranscriptionText, TranscriptionStatus } = req.body;
  
  if (!CallSid || !TranscriptionText) {
    console.error('Missing required parameters in transcription webhook:', req.body);
    return res.status(400).send('Missing required parameters');
  }
  
  try {
    // Add transcription to dialog
    await addTranscription(CallSid, TranscriptionText);
    
    // Send transcription to connected clients
    const ws = connections.get(CallSid);
    if (ws) {
      ws.send(JSON.stringify({
        type: 'transcription',
        text: TranscriptionText,
        isFinal: TranscriptionStatus === 'completed'
      }));
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling transcription:', error);
    res.status(500).send('Internal server error');
  }
});

// Handle WebSocket upgrade requests
server.on('upgrade', (request, socket, head) => {
  console.log('Received upgrade request:', {
    url: request.url,
    headers: request.headers,
    timestamp: new Date().toISOString()
  });

  // Handle the upgrade
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// WebSocket error handling
wss.on('error', (error) => {
  console.error('WebSocket server error:', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });
});

// WebSocket connection handler
wss.on('connection', (ws: WebSocket, req) => {
  const id = uuidv4();
  connections.set(id, ws);
  
  console.log(`New WebSocket connection established: ${id}`, {
    headers: req.headers,
    secure: req.socket instanceof require('tls').TLSSocket,
    remoteAddress: req.socket.remoteAddress,
    timestamp: new Date().toISOString(),
    totalConnections: connections.size
  });
  
  // Send initial test message
  ws.send(JSON.stringify({
    type: 'test',
    message: 'Server connection test',
    timestamp: new Date().toISOString()
  }));
  
  ws.on('message', (data) => {
    try {
      console.log(`Received message from ${id}:`, data.toString());
      const message = JSON.parse(data.toString());
      
      if (message.type === 'test') {
        console.log('Test message received:', message);
        ws.send(JSON.stringify({
          type: 'test_response',
          message: 'Server received test',
          timestamp: new Date().toISOString()
        }));
      }
    } catch (error) {
      console.error(`Error handling message from ${id}:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        data: data.toString(),
        timestamp: new Date().toISOString()
      });
    }
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for connection ${id}:`, {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  });
  
  ws.on('close', (code, reason) => {
    console.log(`WebSocket connection closed: ${id}`, {
      code,
      reason: reason.toString(),
      timestamp: new Date().toISOString(),
      remainingConnections: connections.size - 1
    });
    connections.delete(id);
  });
});

// Handle call-related WebSocket messages
function handleCallMessage(id: string, data: any) {
  const ws = connections.get(id);
  if (!ws) return;
  
  switch (data.action) {
    case 'start':
      // Handle call start
      makeCall(data.phoneNumber, data.webhookUrl)
        .then(callSid => {
          ws.send(JSON.stringify({
            type: 'call_status',
            status: 'started',
            callSid
          }));
        })
        .catch((error: Error) => {
          console.error(`Error starting call for ${id}:`, error);
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to start call'
          }));
        });
      break;
      
    case 'end':
      // Handle call end
      if (data.callSid) {
        endCall(data.callSid)
          .then(() => {
            ws.send(JSON.stringify({
              type: 'call_status',
              status: 'ended'
            }));
          })
          .catch((error: Error) => {
            console.error(`Error ending call for ${id}:`, error);
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Failed to end call'
            }));
          });
      }
      break;
  }
}

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
app.post('/voice', (req, res) => {
  console.log('Received voice webhook request:', {
    headers: req.headers,
    body: req.body,
    timestamp: new Date().toISOString()
  });

  const twiml = new VoiceResponse();
  
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
    transcribeCallback: `${process.env.WEBHOOK_URL}/api/transcription-complete`,
    action: `${process.env.WEBHOOK_URL}/api/recording-complete`,
    method: 'POST'
  });
  
  const response = twiml.toString();
  console.log('Sending TwiML response:', response);
  
  res.type('text/xml');
  res.status(200).send(response);
});

// Handle call status updates
const handleCallStatus: RequestHandler = (req, res, next) => {
  console.log('Received call status update:', {
    headers: req.headers,
    body: req.body,
    timestamp: new Date().toISOString()
  });
  
  const {
    CallSid,
    CallStatus,
    From,
    To,
    Direction,
    RecordingUrl,
    RecordingSid,
    RecordingDuration,
    RecordingStatus,
    RecordingChannels,
    RecordingSource,
    RecordingErrorCode,
    RecordingErrorMsg
  } = req.body;
  
  if (!CallSid || !CallStatus) {
    console.error('Missing required parameters in call status webhook:', req.body);
    return res.status(400).send('Missing required parameters');
  }
  
  try {
    // Update call status in active calls
    const call = getCall(CallSid);
    if (call) {
      call.status = CallStatus;
      call.recordingUrl = RecordingUrl;
      call.recordingSid = RecordingSid;
      call.recordingDuration = RecordingDuration;
      call.recordingStatus = RecordingStatus;
      call.recordingChannels = RecordingChannels;
      call.recordingSource = RecordingSource;
      call.recordingErrorCode = RecordingErrorCode;
      call.recordingErrorMsg = RecordingErrorMsg;
    }
    
    // Send status update to connected clients
    const ws = connections.get(CallSid);
    if (ws) {
      ws.send(JSON.stringify({
        type: 'call-status',
        status: CallStatus,
        recordingUrl: RecordingUrl,
        recordingsid: RecordingSid,
        recordingduration: RecordingDuration,
        recordingstatus: RecordingStatus
      }));
    }
    
    console.log('Call status updated:', {
      callSid: CallSid,
      status: CallStatus,
      timestamp: new Date().toISOString()
    });
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling call status:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      callSid: CallSid,
      timestamp: new Date().toISOString()
    });
    res.status(500).send('Internal server error');
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

// Handle incoming calls
router.post('/call', handleIncomingCall);
router.post('/voice', handleVoiceFallback);
router.post('/call-status', handleCallStatus);
router.post('/recording-status', handleRecordingStatus);
router.post('/transcription-complete', handleTranscriptionComplete);
router.get('/calls', handleGetActiveCalls);
router.get('/calls/:callSid', handleGetCall);

// Health check endpoint
app.get('/', async (req, res) => {
  const twilioStatus = await verifyTwilioCredentials();
  const wsStatus = wss?.clients?.size >= 0;
  
  res.json({
    status: 'ok',
    twilio: twilioStatus ? 'connected' : 'error',
    websocket: wsStatus ? 'ready' : 'not initialized',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', async (req, res) => {
  const twilioStatus = await verifyTwilioCredentials();
  const wsStatus = wss?.clients?.size >= 0;
  
  res.json({
    status: 'ok',
    twilio: twilioStatus ? 'connected' : 'error',
    websocket: wsStatus ? 'ready' : 'not initialized',
    timestamp: new Date().toISOString()
  });
});

// Handle Twilio webhook fallback
app.post('/twilio-webhook-fallback', (req, res) => {
  console.log('Received Twilio webhook fallback request:', req.body);
  
  const twiml = new VoiceResponse();
  twiml.say({
    voice: 'alice',
    language: 'ru-RU'
  }, 'Извините, произошла ошибка. Пожалуйста, попробуйте позвонить позже.');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// Add server error handling
server.on('error', (error) => {
  console.error('HTTP server error:', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });
});

// Start the server
server.listen(port, host, () => {
  console.log(`=== Server Ready ===`);
  console.log(`Environment: production`);
  console.log(`Host: ${host}`);
  console.log(`Port: ${port}`);
  console.log(`WebSocket path: /ws`);
  console.log(`Server URL: https://talkhint-backend-637190449180.us-central1.run.app`);
});

// Handle process termination
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

app.post('/api/call', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    const webhookUrl = `${process.env.WEBHOOK_URL}/twilio-webhook`;
    const callSid = await makeCall(phoneNumber, webhookUrl);
    res.json({ success: true, callSid });
  } catch (error) {
    console.error('Error making call:', error);
    res.status(500).json({ success: false, error: 'Failed to make call' });
  }
}); 
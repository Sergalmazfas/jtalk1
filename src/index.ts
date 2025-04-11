import express, { Request, Response, Router, RequestHandler } from 'express';
import { WebSocket, Server as WebSocketServer } from 'ws'; // Uncommented
import { SpeechClient } from '@google-cloud/speech';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { createServer, IncomingMessage } from 'http';
import { initTwilioService, makeCall, handleCall, getActiveCalls, getCall, endCall, verifyTwilioCredentials } from './twilioService';
import { createDialog, addMessage, addTranscription, endDialog, getDialog, getAllDialogs } from './services/dialogService';
import VoiceResponse = require('twilio/lib/twiml/VoiceResponse');
import { Duplex } from 'stream';
import { Socket } from 'net';
import { Twilio } from 'twilio';
import { parse } from 'url'; // Added import
import { Buffer } from 'buffer'; // Added import

// Флаг для временного отключения функций телефонии
const TELEPHONY_ENABLED = false; // временно отключено до восстановления Twilio

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const router = Router();
const port = parseInt(process.env.PORT || '8080', 10);
const host = process.env.HOST || '0.0.0.0';

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

// Initialize WebSocket server (define but don't attach handlers if disabled)
const wss = new WebSocketServer({ 
  noServer: true, // Important: we handle upgrade manually
  path: '/ws',
  perMessageDeflate: { // Restored full config for clarity
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
  },
  handleProtocols: (protocols: Set<string>, request: IncomingMessage) => {
     return protocols.size > 0 ? Array.from(protocols)[0] : false; 
  }
});

// Initialize Google Speech-to-Text client (keep initialized, might be needed for other things?)
const speechClient = new SpeechClient();

// Store WebSocket connections (keep maps defined, but they won't be populated)
const connections = new Map<string, WebSocket>();
const uiClients = new Map<string, WebSocket>();
const clientCallMap = new Map<string, string>();
const callClientMap = new Map<string, string>();

// Initialize Twilio service (conditionally)
let twilioClient: Twilio | null = null;
if (TELEPHONY_ENABLED) {
    initTwilioService(); // This function likely initializes the client
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
        console.error('CRITICAL: Twilio Account SID or Auth Token is missing in environment variables.');
    } else {
         twilioClient = new Twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!); 
    }
} else {
    console.warn('TELEPHONY DISABLED: Skipping Twilio initialization.');
}

// Serve static files (including admin page assets)
app.use(express.static(path.join(__dirname, '../public')));

// Route for the Admin Console page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// --- ADDED: Route for settings page ---
app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/settings.html'));
});
// --- END ADDED Route ---

// --- ADDED: Routes for static policy pages ---
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/privacy.html'));
});

app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/terms.html'));
});

app.get('/call-policy', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/call-policy.html'));
});
// --- END ADDED Routes ---

// Parse JSON bodies
app.use(express.json());

// Parse URL-encoded bodies (required for Twilio webhooks)
app.use(express.urlencoded({ extended: false }));

// Mount the router
app.use('/api', router);

// --- ADDED: Route for settings page ---
app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/settings.html'));
});
// --- END ADDED Route ---

// --- Add the new handleTwilioStream function ---
export function handleTwilioStream(ws: WebSocket, callSid: string, clientId: string) {
  // Use the global speechClient instance
  // const speechClient = new SpeechClient(); 

  const request = {
    config: {
      encoding: 'MULAW' as const, // Added 'as const' for stricter typing
      sampleRateHertz: 8000,
      languageCode: 'en-US',
    },
    interimResults: true,
  };

  const recognizeStream = speechClient
    .streamingRecognize(request)
    .on('error', (error) => {
      console.error(`[STT ERROR] CallSid: ${callSid}, ClientId: ${clientId}`, error);
      // Optionally inform the UI client about the STT error
      const clientSocket = uiClients.get(clientId);
      if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(JSON.stringify({ type: 'error', source: 'stt', message: 'Speech recognition error', callSid }));
      }
    })
    .on('data', (data) => {
      const transcript = data.results?.[0]?.alternatives?.[0]?.transcript;
      const isFinal = data.results?.[0]?.isFinal ?? false; // Ensure boolean

      if (transcript) {
        const message = {
          type: 'transcription', // Added type for client-side routing
          source: 'guest',
          text: transcript,
          isFinal,
          callSid,
        };

        // Use the global uiClients map
        const clientSocket = uiClients.get(clientId);
        if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
          clientSocket.send(JSON.stringify(message));
        } else {
            console.warn(`[forwardToClient] UI client ${clientId} not found or not open for call ${callSid}`);
        }
      }
    });

  console.log(`[audiostream] New stream handler started for callSid: ${callSid}, clientId: ${clientId}`);

  ws.on('message', (msg) => {
    try {
      // Message might not be JSON, but a raw buffer initially. Check type?
      // Twilio sends JSON messages for events like 'start', 'media', 'stop'.
      const parsed = JSON.parse(msg.toString());

      if (parsed.event === 'start') {
        console.log(`[audiostream] Stream started: ${parsed.streamSid} for call ${callSid}`);
        // Inform UI Client?
        const clientSocket = uiClients.get(clientId);
        if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
           clientSocket.send(JSON.stringify({ type: 'system_message', text: `Audio stream connected for call ${callSid}`, callSid }));
        }
      } else if (parsed.event === 'media' && parsed.media?.payload) {
        // Process audio payload
        const audioBuffer = Buffer.from(parsed.media.payload, 'base64');
        if (recognizeStream && !recognizeStream.destroyed) {
             recognizeStream.write(audioBuffer);
        } else {
             console.warn(`[audiostream] RecognizeStream not writable for call ${callSid}.`);
        }
      } else if (parsed.event === 'stop') {
        console.log(`[audiostream] Stream stop event received for call ${callSid}.`);
        if (recognizeStream && !recognizeStream.destroyed) {
             recognizeStream.end();
        }
        ws.close(); // Close the Twilio WebSocket connection
        // Inform UI Client?
         const clientSocket = uiClients.get(clientId);
         if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
            clientSocket.send(JSON.stringify({ type: 'system_message', text: `Audio stream stopped for call ${callSid}`, callSid }));
         }
      } else {
          console.log(`[audiostream] Received unhandled event type: ${parsed.event} for call ${callSid}`);
      }
    } catch (err) {
      console.error(`[audiostream] Message processing error for call ${callSid}:`, err);
      // Log the raw message for debugging if it wasn't parsable JSON
      if (err instanceof SyntaxError) {
           console.error("[audiostream] Raw message:", msg.toString());
      }
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[audiostream] WebSocket closed for callSid: ${callSid}, Code: ${code}, Reason: ${reason?.toString()}`);
    if (recognizeStream && !recognizeStream.destroyed) {
        recognizeStream.end();
        console.log(`[audiostream] RecognizeStream ended due to WebSocket close for call ${callSid}.`);
    }
  });

  ws.on('error', (error) => {
     console.error(`[audiostream] WebSocket error for callSid: ${callSid}:`, error);
     if (recognizeStream && !recognizeStream.destroyed) {
         recognizeStream.destroy(error); // Destroy stream on WS error
         console.log(`[audiostream] RecognizeStream destroyed due to WebSocket error for call ${callSid}.`);
     }
  });
}
// --- End of handleTwilioStream function ---

// Handle Twilio webhook (return simple OK if disabled)
app.post('/twilio-webhook', (req, res) => {
  if (!TELEPHONY_ENABLED) {
    console.log('[DISABLED] Received /twilio-webhook request, returning OK.');
    res.status(200).type('text/xml').send('<Response/>'); // Send minimal valid TwiML
    return;
  }

  console.log('Received Twilio webhook request (Stream setup):', {
    headers: req.headers,
    body: req.body,
    timestamp: new Date().toISOString()
  });

  const callSid = req.body.CallSid;
  if (!callSid) {
    console.error('Missing CallSid in webhook request for stream setup');
    return res.status(400).send('Missing CallSid');
  }

  // ** Important: Get the associated client ID for this call **
  // This needs to be passed somehow when the call is initiated, 
  // perhaps via custom parameters in the call API or looked up.
  // For now, let's assume we can retrieve it based on CallSid.
  // We will use the callClientMap we defined earlier.
  const clientId = callClientMap.get(callSid);
  if (!clientId) {
      console.error(`Could not find client ID for CallSid ${callSid} during stream setup.`);
      // Decide how to handle this - maybe hang up?
      const hangupTwiml = new VoiceResponse();
      hangupTwiml.hangup();
      res.type('text/xml');
      return res.send(hangupTwiml.toString());
  }
  
  // Construct the WebSocket URL for the audio stream
  // Make sure req.headers.host is correct behind proxy/load balancer
  // Consider using WEBHOOK_URL base instead if host is unreliable
  const serviceHost = process.env.WEBHOOK_URL ? new URL(process.env.WEBHOOK_URL).host : req.headers.host;
  const audioStreamUrl = `wss://${serviceHost}/audiostream?clientId=${encodeURIComponent(clientId)}&callSid=${encodeURIComponent(callSid)}`;

  console.log(`Setting up Twilio Media Stream to: ${audioStreamUrl} for call ${callSid}, client ${clientId}`);

  const twiml = new VoiceResponse();

  // Optional: Greeting message before connecting the stream
  twiml.say({
    voice: 'alice',
    language: 'ru-RU'
  }, 'Соединяю с системой анализа речи.'); // Shorter greeting?

  // Start the media stream
  const connect = twiml.connect();
  connect.stream({
      url: audioStreamUrl,
      // track: 'both_tracks' // Let's start with inbound only (guest audio)
      track: 'inbound_track' 
  }); // Send only guest audio to STT for now

  // Optional: Message after stream setup (might not be heard if stream connects quickly)
  // twiml.say('Stream connected.'); 

  const response = twiml.toString();
  console.log('Sending TwiML response for Stream:', response);
  
  res.type('text/xml');
  res.send(response);
});

// --- Remove or comment out old recording/transcription webhooks ---
/*
app.post('/api/recording-complete', async (req, res) => { ... });
app.post('/api/transcription-complete', async (req, res) => { ... });
*/

// --- WebSocket Server Event Handling (Conditionally attach handlers) ---

if (TELEPHONY_ENABLED) {
  wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
    // Use 'parse' from 'url' to handle potential undefined request.url
    const parsedUrl = parse(request.url || '', true);
    const pathname = parsedUrl.pathname;
    const query = parsedUrl.query; // query is already parsed into an object

    // Handle the regular client UI connection (/ws)
    if (pathname === '/ws') {
        // Use sec-websocket-key as the unique ID for UI clients
        const wsClientId = request.headers['sec-websocket-key'] as string;
        if (!wsClientId) {
            console.error('No sec-websocket-key provided for client UI connection');
            ws.close(1008, 'Client identifier required');
            return;
        }
        
        // Close existing connection if any for the same key
        if (connections.has(wsClientId)) {
            console.log(`Closing existing UI connection for client ${wsClientId}`);
            const oldWs = connections.get(wsClientId);
            oldWs?.close(1001, 'New UI connection replacing existing one');
            // Clean up maps for the old connection
            connections.delete(wsClientId);
            uiClients.delete(wsClientId); // Remove from uiClients too
            const oldCallSid = clientCallMap.get(wsClientId);
            if (oldCallSid) callClientMap.delete(oldCallSid);
            clientCallMap.delete(wsClientId);
        }

        // Store the new connection
        connections.set(wsClientId, ws);
        uiClients.set(wsClientId, ws); // Store in uiClients as well
        console.log(`New WebSocket connection established for client UI: ${wsClientId}`);

        // Send confirmation to client
        ws.send(JSON.stringify({ type: 'connected', clientId: wsClientId }));

        // Standard message/close/error handlers for UI client
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());
                console.log(`Received message from client UI ${wsClientId}:`, data);

                if (data.type === 'call_request' && data.phoneNumber) {
                   // Check if Twilio client is available before using it
                   if (twilioClient) { 
                      const webhookUrl = `${process.env.WEBHOOK_URL}/twilio-webhook`;
                      console.log(`Initiating call from UI ${wsClientId} to ${data.phoneNumber}`);
                      // Now it's safe to use twilioClient
                      twilioClient.calls.create({ 
                          to: data.phoneNumber,
                          from: process.env.TWILIO_PHONE_NUMBER!, // Ensure non-null if TELEPHONY_ENABLED
                          url: webhookUrl,
                       })
                         .then(call => {
                             console.log(`Call initiated via UI request, SID: ${call.sid}, Client: ${wsClientId}`);
                             // Associate CallSid with clientId (sec-websocket-key)
                             clientCallMap.set(wsClientId, call.sid);
                             callClientMap.set(call.sid, wsClientId); // Store reverse mapping

                             ws.send(JSON.stringify({ type: 'call_status', status: 'initiated', callSid: call.sid }));
                         })
                         .catch(error => {
                             console.error(`Error initiating call from UI ${wsClientId}:`, error);
                             ws.send(JSON.stringify({ type: 'error', message: `Failed to initiate call: ${error.message}` }));
                         });
                   } else {
                      console.error(`Cannot process call_request from ${wsClientId}: Telephony is disabled or Twilio client failed to initialize.`);
                      ws.send(JSON.stringify({ type: 'error', message: 'Telephony is currently disabled on the server.' }));
                   }
                }
                /* // временно отключено из-за ошибки компиляции TS18047 --- ПЕРЕМЕЩЕНО НАЧАЛО КОММЕНТАРИЯ
                else if (data.type === 'end_call' && data.callSid) {
                     // Check if Twilio client is available FIRST
                     if (twilioClient) { 
                         const currentTwilioClient = twilioClient; // Create non-null local copy
                         const mappedClientId = callClientMap.get(data.callSid);
                         // THEN check ownership
                         if (mappedClientId === wsClientId) { 
                             console.log(`Ending call ${data.callSid} requested by owner UI ${wsClientId}`);
                             // Use the non-null local copy
                             currentTwilioClient.calls(data.callSid).update({ status: 'completed' })
                                 .then(call => {
                                     console.log(`Call ${call.sid} ended via UI request.`);
                                     ws.send(JSON.stringify({ type: 'call_status', status: 'ended', callSid: call.sid }));
                                     // Clean up maps after ending
                                     callClientMap.delete(call.sid);
                                     clientCallMap.delete(wsClientId);
                                 })
                                 .catch(error => {
                                     console.error(`Error ending call ${data.callSid} from UI ${wsClientId}:`, error);
                                     ws.send(JSON.stringify({ type: 'error', message: `Failed to end call: ${error.message}` }));
                                 });
                         } else {
                             console.warn(`UI ${wsClientId} attempted to end call ${data.callSid} which it does not own or map is missing.`);
                             ws.send(JSON.stringify({ type: 'error', message: 'Cannot end call: Not owner.' }));
                         }
                     } else {
                          // Handle case where Twilio is disabled/unavailable
                          console.warn(`Cannot process end_call for ${data.callSid}: Telephony disabled.`);
                          ws.send(JSON.stringify({ type: 'error', message: 'Cannot end call: Telephony is disabled.' }));
                     }
                }
                */ // --- ДОБАВЛЕН КОНЕЦ КОММЕНТАРИЯ --- 
                else {
                    // Handle other messages like ping
                    switch (data.type) {
                        case 'ping':
                            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                            break;
                        // Handle other potential messages from UI
                        default:
                             console.log(`Unhandled message type from UI ${wsClientId}: ${data.type}`);
                    }
                }
            } catch (error) {
                console.error(`Error handling message from client UI ${wsClientId}:`, error);
                ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
            }
        });

        ws.on('close', (code, reason) => {
            console.log(`WebSocket connection closed for client UI: ${wsClientId}, Code: ${code}, Reason: ${reason?.toString()}`);
            const associatedCallSid = clientCallMap.get(wsClientId);
            if (associatedCallSid) {
                console.log(`UI client ${wsClientId} disconnected, cleaning up associated call ${associatedCallSid}`);
                callClientMap.delete(associatedCallSid);
                // Optionally end the call if the UI disconnects abruptly?
                // twilioClient.calls(associatedCallSid).update({ status: 'completed' }).catch(e => console.error("Error ending call on UI disconnect:", e));
            }
            clientCallMap.delete(wsClientId);
            connections.delete(wsClientId);
            uiClients.delete(wsClientId); // Remove from uiClients
        });

        ws.on('error', (error) => {
            console.error(`WebSocket error for client UI ${wsClientId}:`, error);
            const associatedCallSid = clientCallMap.get(wsClientId);
            if (associatedCallSid) {
                 console.log(`UI client ${wsClientId} errored, cleaning up associated call ${associatedCallSid}`);
                 callClientMap.delete(associatedCallSid);
            }
            clientCallMap.delete(wsClientId);
            connections.delete(wsClientId);
            uiClients.delete(wsClientId); // Remove from uiClients
            // Attempt to close the WebSocket cleanly on error, if not already closed
             if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                 ws.close(1011, "WebSocket error occurred");
             }
        });

    }
    // Handle the Twilio audio stream connection (/audiostream)
    else if (pathname === '/audiostream') {
        // Extract clientId and callSid from query parameters
        const clientIdFromQuery = query.clientId?.toString();
        const callSidFromQuery = query.callSid?.toString();

        if (!clientIdFromQuery || !callSidFromQuery) {
             console.error('Missing clientId or callSid in /audiostream connection URL');
             ws.close(1008, 'Missing clientId or callSid parameter');
             return;
        }
        
        // Verify the clientId corresponds to an active UI client connection
        const uiWs = uiClients.get(clientIdFromQuery); 
        if (!uiWs || uiWs.readyState !== WebSocket.OPEN) {
            console.error(`UI WebSocket not found or not open for clientId ${clientIdFromQuery} when audio stream connected for call ${callSidFromQuery}.`);
            ws.close(1011, 'Associated UI client not found or disconnected.');
            return;
        }

        // Now call the dedicated handler for the Twilio stream
        handleTwilioStream(ws, callSidFromQuery!, clientIdFromQuery!);

    } else {
        console.warn('Unknown WebSocket connection attempt:', { pathname, query });
        ws.close(1008, 'Invalid path or missing parameters');
    }
  });

  // Attach the upgrade handler
  server.on('upgrade', (request, socket: Duplex, head) => { 
    // Decide which path to handle (e.g., /ws or /audiostream)
    // For simplicity, let wss attempt to handle any upgrade if telephony is enabled
    // The connection handler above will sort out the paths.
     wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
     });
  });
  console.log('TELEPHONY ENABLED: WebSocket server upgrade handler attached.');

} else {
  // If telephony is disabled, explicitly reject WebSocket upgrade attempts
  server.on('upgrade', (request, socket: Duplex, head) => {
    const url = parse(request.url || '', true);
    console.warn(`[DISABLED] Rejecting WebSocket upgrade request for path: ${url.pathname}`);
    // Terminate the socket for the upgrade request
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); // Or 404 Not Found
    socket.destroy();
  });
  console.warn('TELEPHONY DISABLED: WebSocket server upgrade handler is not attached.');
}

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
const handleCallStatusLogic: RequestHandler = (req, res, next) => {
  if (!TELEPHONY_ENABLED) {
    console.log('[DISABLED] Received /call-status request, returning OK.');
    res.status(200).send('OK');
    return;
  }

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

app.post('/call-status', (req, res, next) => {
  if (!TELEPHONY_ENABLED) {
    console.log('[DISABLED] Received /call-status request, returning OK.');
    res.status(200).send('OK');
    return;
  }
  // Call the actual logic if enabled
  handleCallStatusLogic(req, res, next);
});

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

/* // Закомментирован старый HTTP обработчик инициации звонка (перенесено на WebSocket)
// Route to initiate a call
router.post('/call', async (req, res) => {
  // ... весь код обработчика ...
});
*/

// Handle incoming calls
router.post('/call', handleIncomingCall);
router.post('/voice', handleVoiceFallback);
router.post('/call-status', handleCallStatusLogic);
router.post('/recording-status', handleRecordingStatus);
router.post('/transcription-complete', handleTranscriptionComplete);
router.get('/calls', handleGetActiveCalls);
router.get('/calls/:callSid', handleGetCall);

// Health check endpoint
app.get('/', async (req, res) => {
  console.log('Received request to / with headers:', JSON.stringify(req.headers, null, 2)); // Log headers
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

// Start the server
if (process.env.NODE_ENV === 'production') {
  // In production (like Cloud Run), listen on the port provided by the environment
  server.listen(port, () => {
    console.log('=== Server Ready ===');
    console.log(`Environment: ${process.env.NODE_ENV}`);
    // console.log(`Host: ${host}`); // Host is implicitly 0.0.0.0 in Cloud Run
    console.log(`Port: ${port}`);
    console.log(`WebSocket path: ${process.env.WS_PATH || '/ws'}`);
    console.log(`Server URL: ${process.env.WEBHOOK_URL}`);
  });
} else {
  // In development, listen on the specified host and port
  server.listen(port, host, () => {
    console.log('=== Server Ready ===');
    console.log(`Environment: ${process.env.NODE_ENV}`);
    console.log(`Host: ${host}`);
    console.log(`Port: ${port}`);
    console.log(`WebSocket path: ${process.env.WS_PATH || '/ws'}`);
    console.log(`Server URL: ${process.env.WEBHOOK_URL}`);
  });
}

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

// Handle server errors
server.on('error', (error: Error) => {
  console.error('HTTP server error:', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });
}); 
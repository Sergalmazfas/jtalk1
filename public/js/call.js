class CallManager {
  constructor() {
    this.ws = null;
    this.clientId = 'client-' + Math.random().toString(36).substring(2, 15); // Generate a simple unique ID
    this.isConnected = false;
    this.currentCall = null;
    this.ownerMessages = document.getElementById('owner-messages');
    this.guestMessages = document.getElementById('guest-messages');
    this.transcription = document.getElementById('transcription');
    this.endCallButton = document.getElementById('end-call-button');
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000; // Start with 5 seconds
    this.maxReconnectDelay = 30000; // Max 30 seconds
    this.heartbeatInterval = null;
    
    // Production URL - fixed for Cloud Run
    this.baseUrl = 'https://talkhint-backend-637190449180.us-central1.run.app';
    
    // Initialize WebSocket connection
    this.connectWebSocket(); // RESTORED: Enable WebSocket connection on init
  }

  connectWebSocket() {
    // Convert https:// to wss:// for WebSocket connection
    const wsUrl = this.baseUrl.replace('https://', 'wss://') + '/ws';
    console.log('Connecting to WebSocket:', wsUrl);
    
    try {
      if (this.ws) {
        console.log('Closing existing WebSocket connection');
        this.ws.close();
      }

      console.log('Creating new WebSocket connection...');
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected successfully to:', wsUrl);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 5000;
        this.displayTranscript('Connected to server', true);
        
        // Start heartbeat
        this.startHeartbeat();
        
        // Send a test message
        this.sendMessage({
          type: 'test',
          message: 'Connection test',
          timestamp: new Date().toISOString()
        });
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket disconnected:', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
          url: wsUrl,
          timestamp: new Date().toISOString()
        });
        
        this.isConnected = false;
        this.stopHeartbeat();
        
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
          
          this.displayTranscript(`Disconnected from server. Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`, true);
          setTimeout(() => this.connectWebSocket(), this.reconnectDelay);
        } else {
          this.displayTranscript('Maximum reconnection attempts reached. Please refresh the page.', true);
        }
      };

      this.ws.onmessage = (event) => {
        try {
          console.log('Received WebSocket message:', event.data);
          const data = JSON.parse(event.data);
          
          // Handle test message response
          if (data.type === 'test_response') {
            console.log('Test message response received:', data);
            this.displayTranscript('Server connection verified', true);
          }
          
          // Handle pong message
          if (data.type === 'pong') {
            console.log('Pong received:', data);
            return;
          }
          
          this.handleMessage(data);
        } catch (error) {
          console.error('Error handling WebSocket message:', {
            error: error.message,
            data: event.data,
            url: wsUrl,
            timestamp: new Date().toISOString()
          });
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', {
          error: error,
          readyState: this.ws?.readyState,
          url: wsUrl,
          timestamp: new Date().toISOString()
        });
        this.displayTranscript('Connection error. Attempting to reconnect...', true);
      };
    } catch (error) {
      console.error('Failed to create WebSocket connection:', {
        error: error.message,
        url: wsUrl,
        timestamp: new Date().toISOString()
      });
      this.displayTranscript('Failed to connect to server. Please refresh the page.', true);
      setTimeout(() => this.connectWebSocket(), this.reconnectDelay);
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
        this.sendMessage({
          type: 'ping',
          timestamp: Date.now()
        });
      }
    }, 30000); // Send ping every 30 seconds
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  sendMessage(message) {
    if (!this.isConnected || this.ws?.readyState !== WebSocket.OPEN) {
      console.error('Cannot send message: WebSocket is not connected');
      return false;
    }

    try {
      const messageStr = JSON.stringify(message);
      this.ws.send(messageStr);
      return true;
    } catch (error) {
      console.error('Error sending message:', {
        error: error.message,
        message: message,
        timestamp: new Date().toISOString()
      });
      return false;
    }
  }

  handleMessage(data) {
    console.log('Handling message:', data);
    
    if (!data || typeof data !== 'object') {
      console.error('Invalid message format:', data);
      return;
    }

    switch (data.type) {
      case 'transcript':
        console.log('Processing transcript:', {
          text: data.text,
          isFinal: data.isFinal,
          source: data.source
        });
        this.displayTranscript(data.text, data.isFinal, data.source);
        break;
      case 'message':
        console.log('Processing message:', {
          text: data.text,
          source: data.source
        });
        this.displayMessage(data.text, data.source);
        break;
      case 'error':
        console.error('Server error:', {
          message: data.message,
          code: data.code
        });
        this.displayTranscript(`Error: ${data.message}`, true);
        break;
      case 'call_status':
        console.log('Call status update:', {
          callSid: data.callSid,
          status: data.status
        });
        // Store current call info if not already set
        if (!this.currentCall || this.currentCall.callSid !== data.callSid) {
            if (data.status === 'initiated' || data.status === 'ringing' || data.status === 'in-progress') {
                this.currentCall = { callSid: data.callSid, status: data.status };
            }
        }

        if (this.currentCall?.callSid === data.callSid) {
          this.currentCall.status = data.status;
          this.displayTranscript(`Call status: ${data.status}`, true);

          // --- Control End Call Button Visibility based on actual call state --- 
          if (this.endCallButton) { // Check if button exists
              if (data.status === 'initiated' || data.status === 'ringing' || data.status === 'in-progress') {
                  // Call is active, show the end button
                  this.endCallButton.style.display = 'flex'; 
              } else if (data.status === 'completed' || data.status === 'failed' || data.status === 'canceled' || data.status === 'no-answer' || data.status === 'busy') {
                  // Call ended or failed, hide the end button
                  this.endCallButton.style.display = 'none';
                  this.currentCall = null; // Reset current call state
              }
          } else {
               console.warn('#end-call-button not found');
          }
          // --- End Control --- 

        }
        break;
      default:
        console.warn('Unknown message type:', {
          type: data.type,
          data: data
        });
    }
  }

  displayTranscript(text, isFinal, source) {
    if (!text) return;

    const span = document.createElement('span');
    span.className = isFinal ? 'final' : 'interim';
    span.textContent = text + ' ';

    this.transcription.appendChild(span);

    if (isFinal) {
      this.transcription.appendChild(document.createElement('br'));
      
      // Also add to the appropriate message column
      this.displayMessage(text, source);
    }

    // Scroll to the bottom
    this.transcription.scrollTop = this.transcription.scrollHeight;
  }

  displayMessage(text, source) {
    if (!text) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${source}`;
    
    const original = document.createElement('div');
    original.className = 'original';
    original.textContent = text;
    
    messageDiv.appendChild(original);

    if (source === 'owner') {
      this.ownerMessages.appendChild(messageDiv);
      this.ownerMessages.scrollTop = this.ownerMessages.scrollHeight;
    } else {
      this.guestMessages.appendChild(messageDiv);
      this.guestMessages.scrollTop = this.guestMessages.scrollHeight;
    }
  }

  makeCall(phoneNumber) {
    // Basic E.164 validation (starts with +, followed by digits)
    const phoneRegex = /^\+[1-9]\d{1,14}$/;
    if (!phoneRegex.test(phoneNumber)) {
        alert('Invalid phone number format. Please use E.164 format (e.g., +1234567890).');
        return;
    }

    this.displayTranscript(`Initiating call to ${phoneNumber}...`, true);

    // Send call request via WebSocket instead of fetch
    const success = this.sendMessage({
        type: 'call_request',
        phoneNumber: phoneNumber
    });

    if (!success) {
        // sendMessage logs the error internally if WS is not open
        this.displayTranscript('Error: Could not send call request. WebSocket disconnected?', true);
        alert('Failed to send call request. Check connection.');
    } 
    // We no longer wait for an immediate response here.
    // Call status (initiated, ringing, error) will arrive via separate WS messages ('call_status' or 'error')
    // and will be handled by this.handleMessage()
  }

  async getCallStatus(callSid) {
    try {
      console.log('Fetching call status for:', callSid);
      
      const response = await fetch(`${this.baseUrl}/api/calls/${callSid}`);
      if (!response.ok) {
        throw new Error(`Failed to get call status: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('Call status response:', {
        callSid: data.callSid,
        status: data.status,
        timestamp: new Date().toISOString()
      });
      
      if (this.currentCall?.callSid === callSid) {
        this.currentCall.status = data.status;
        this.displayTranscript(`Call status: ${data.status}`, true);
      }
      
      return data;
    } catch (error) {
      console.error('Error getting call status:', {
        error: error.message,
        callSid,
        currentCall: this.currentCall,
        timestamp: new Date().toISOString()
      });
      
      this.displayTranscript(`Error getting call status: ${error.message}`, true);
      throw error;
    }
  }

  async getAllCalls() {
    try {
      const response = await fetch(`${this.baseUrl}/api/calls`);
      if (!response.ok) {
        throw new Error('Failed to get calls');
      }
      return await response.json();
    } catch (error) {
      console.error('Error getting calls:', error);
      throw error;
    }
  }
}

// Initialize the call manager when the page loads
window.addEventListener('load', () => {
  window.callManager = new CallManager();
});

// Get DOM elements
const phoneInput = document.getElementById('phoneNumber');
const callButton = document.getElementById('callButton');

// Handle phone number input
phoneInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        triggerCall();
    }
});

// Handle call button click
callButton.addEventListener('click', triggerCall);

// Updated Function to trigger a call from UI
async function triggerCall() { 
    const phoneNumber = phoneInput.value.trim();
    if (phoneNumber) {
        callButton.disabled = true;
        callButton.textContent = 'Calling...';
        try {
            await callManager.makeCall(phoneNumber);
            // phoneInput.value = ''; // Keep number for reference? Or clear?
        } catch (error) {
            // Error already logged and alerted by makeCall
        } finally {
            callButton.disabled = false;
            callButton.textContent = 'Call';
        }
    } else {
        alert('Please enter a phone number in E.164 format (e.g., +1234567890).');
    }
}
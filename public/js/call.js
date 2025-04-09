class CallManager {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.currentCall = null;
    this.ownerMessages = document.getElementById('owner-messages');
    this.guestMessages = document.getElementById('guest-messages');
    this.transcription = document.getElementById('transcription');
    
    // Production URL - fixed for Cloud Run
    this.baseUrl = 'https://talkhint-backend-637190449180.us-central1.run.app';
    
    // Initialize WebSocket connection
    this.connectWebSocket();
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
        this.displayTranscript('Connected to server', true);
        
        // Send a test message
        const testMessage = {
          type: 'test',
          message: 'Connection test',
          timestamp: new Date().toISOString()
        };
        console.log('Sending test message:', testMessage);
        this.ws.send(JSON.stringify(testMessage));
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
        this.displayTranscript('Disconnected from server. Attempting to reconnect...', true);
        setTimeout(() => this.connectWebSocket(), 5000);
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
      setTimeout(() => this.connectWebSocket(), 5000);
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
        if (this.currentCall?.callSid === data.callSid) {
          this.currentCall.status = data.status;
          this.displayTranscript(`Call status: ${data.status}`, true);
        }
        break;
      case 'call_ended':
        console.log('Call ended:', {
          callSid: data.callSid,
          duration: data.duration
        });
        if (this.currentCall?.callSid === data.callSid) {
          this.currentCall = null;
          this.displayTranscript('Call ended', true);
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

  async makeCall(phoneNumber) {
    try {
      console.log('Making call to:', phoneNumber);
      const response = await fetch(`${this.baseUrl}/api/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phoneNumber }),
      });

      if (!response.ok) {
        throw new Error('Failed to make call');
      }

      const data = await response.json();
      console.log('Call initiated:', data);
      
      this.currentCall = {
        callSid: data.callSid,
        status: 'initiated',
        direction: 'outbound'
      };
      
      this.displayTranscript('Call initiated', true);
      return data.callSid;
    } catch (error) {
      console.error('Error making call:', error);
      this.displayTranscript(`Error making call: ${error.message}`, true);
      throw error;
    }
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
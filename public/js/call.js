class CallManager {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.currentCall = null;
    this.ownerMessages = document.getElementById('owner-messages');
    this.guestMessages = document.getElementById('guest-messages');
    
    // Use production URL
    this.baseUrl = 'https://talkhint-backend-637190449180.us-central1.run.app';
    
    // Initialize WebSocket connection
    this.connectWebSocket();
  }

  connectWebSocket() {
    // Ensure we're using the correct WebSocket URL
    const wsUrl = this.baseUrl.replace('https://', 'wss://') + '/ws';
    console.log('Connecting to WebSocket:', wsUrl);
    
    try {
      // Close existing connection if any
      if (this.ws) {
        this.ws.close();
      }

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket connected successfully to:', wsUrl);
        this.isConnected = true;
        // Display connection status to user
        this.displayTranscript('Connected to server', true);
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket disconnected:', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
          url: wsUrl
        });
        this.isConnected = false;
        // Display disconnection status to user
        this.displayTranscript('Disconnected from server. Attempting to reconnect...', true);
        // Try to reconnect after 5 seconds
        setTimeout(() => this.connectWebSocket(), 5000);
      };

      this.ws.onmessage = (event) => {
        try {
          console.log('Received WebSocket message:', event.data);
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (error) {
          console.error('Error handling WebSocket message:', {
            error: error.message,
            data: event.data,
            url: wsUrl
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
        // Display error to user
        this.displayTranscript('Connection error. Attempting to reconnect...', true);
      };
    } catch (error) {
      console.error('Failed to create WebSocket connection:', {
        error: error.message,
        url: wsUrl,
        timestamp: new Date().toISOString()
      });
      // Display error to user
      this.displayTranscript('Failed to connect to server. Please refresh the page.', true);
      // Retry connection after 5 seconds
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
          isFinal: data.isFinal
        });
        this.displayTranscript(data.text, data.isFinal);
        break;
      case 'error':
        console.error('Server error:', {
          message: data.message,
          code: data.code
        });
        // Display error to user
        this.displayTranscript(`Error: ${data.message}`, true);
        break;
      case 'call_status':
        console.log('Call status update:', {
          callSid: data.callSid,
          status: data.status
        });
        if (this.currentCall?.callSid === data.callSid) {
          this.currentCall.status = data.status;
          // Display status update to user
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

  displayTranscript(text, isFinal) {
    if (!text) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';
    messageDiv.textContent = text;

    // If it's a final transcript, add it to the appropriate column
    if (isFinal) {
      if (this.currentCall?.direction === 'outbound') {
        this.ownerMessages.appendChild(messageDiv);
      } else {
        this.guestMessages.appendChild(messageDiv);
      }
    } else {
      // For interim results, update the last message or create a new one
      const lastMessage = document.querySelector('.message.interim');
      if (lastMessage) {
        lastMessage.textContent = text;
      } else {
        messageDiv.className = 'message interim';
        if (this.currentCall?.direction === 'outbound') {
          this.ownerMessages.appendChild(messageDiv);
        } else {
          this.guestMessages.appendChild(messageDiv);
        }
      }
    }

    // Scroll to the bottom
    this.ownerMessages.scrollTop = this.ownerMessages.scrollHeight;
    this.guestMessages.scrollTop = this.guestMessages.scrollHeight;
  }

  async makeCall(phoneNumber) {
    if (!this.isConnected) {
      console.error('Cannot make call: WebSocket not connected');
      this.displayTranscript('Cannot make call: Not connected to server', true);
      return;
    }

    try {
      console.log('Initiating call to:', phoneNumber);
      this.displayTranscript(`Initiating call to ${phoneNumber}...`, true);

      const response = await fetch(`${this.baseUrl}/api/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phoneNumber,
          webhookUrl: `${this.baseUrl}/api/call/status`
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Call initiation failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        });
        this.displayTranscript(`Call failed: ${errorData.message || response.statusText}`, true);
        return;
      }

      const data = await response.json();
      console.log('Call initiated successfully:', data);
      this.currentCall = data;
      this.displayTranscript('Call connected. Start speaking...', true);
    } catch (error) {
      console.error('Error making call:', error);
      this.displayTranscript(`Error making call: ${error.message}`, true);
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
        // Display status update to user
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
      
      // Display error to user
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
class CallManager {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.currentCall = null;
    this.ownerMessages = document.getElementById('owner-messages');
    this.guestMessages = document.getElementById('guest-messages');
    this.connectWebSocket();
  }

  connectWebSocket() {
    this.ws = new WebSocket('ws://localhost:8086');

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.isConnected = true;
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.isConnected = false;
      // Try to reconnect after 5 seconds
      setTimeout(() => this.connectWebSocket(), 5000);
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  handleMessage(data) {
    switch (data.type) {
      case 'transcript':
        this.displayTranscript(data.text, data.isFinal);
        break;
      case 'error':
        console.error('Server error:', data.message);
        break;
      default:
        console.log('Unknown message type:', data.type);
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
    try {
      const response = await fetch('/call', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: phoneNumber,
          webhookUrl: `${window.location.origin}/call-status`,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to initiate call');
      }

      const data = await response.json();
      this.currentCall = {
        callSid: data.callSid,
        direction: 'outbound',
        status: 'initiated',
      };

      console.log('Call initiated:', this.currentCall);
      return this.currentCall;
    } catch (error) {
      console.error('Error making call:', error);
      throw error;
    }
  }

  async getCallStatus(callSid) {
    try {
      const response = await fetch(`/calls/${callSid}`);
      if (!response.ok) {
        throw new Error('Failed to get call status');
      }
      const data = await response.json();
      this.currentCall = data;
      return data;
    } catch (error) {
      console.error('Error getting call status:', error);
      throw error;
    }
  }

  async getAllCalls() {
    try {
      const response = await fetch('/calls');
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
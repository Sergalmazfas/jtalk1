class JTalk1 {
    constructor() {
        this.ws = null;
        this.audioContext = null;
        this.audioSource = null;
        this.scriptProcessor = null;
        this.isCalibrated = false;
        this.currentSpeaker = null;
        this.calibrationTimeout = null;
        this.lastInterimText = '';
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.audioChunksSent = 0;
        this.transcriptsReceived = 0;
        this.isRecording = false;
        this.audioChunks = [];
        this.lastChunkTime = 0;
        this.chunkInterval = 500; // Increased from 300ms to 500ms to reduce server load
        this.keepAliveInterval = null;
        this.audioBufferSize = 8192; // Increased buffer size for more efficient processing
        this.setupWebSocket();
        this.setupUI();
    }

    setupWebSocket() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('WebSocket already connected');
            return;
        }
        
        console.log('Setting up WebSocket connection...');
        this.ws = new WebSocket(`ws://${window.location.host}`);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.reconnectAttempts = 0;
            this.showCalibrationModal();
            
            // Set up a keep-alive interval to prevent timeouts
            this.keepAliveInterval = setInterval(() => {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, 15000); // Send ping every 15 seconds
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            if (data.type === 'transcript') {
                this.transcriptsReceived++;
                if (data.isFinal) {
                    this.addMessage(data.text, this.currentSpeaker || 'guest');
                } else {
                    this.updateInterimText(data.text);
                }
            } else if (data.type === 'calibrated') {
                console.log('Calibration completed');
                this.isCalibrated = true;
                this.hideCalibrationModal();
                this.currentSpeaker = 'owner';
                this.startRecording();
            } else if (data.type === 'error') {
                console.error('Server error:', data.message);
                const interimText = document.getElementById('interim-text');
                interimText.textContent = `Error: ${data.message}`;
                interimText.classList.add('active', 'visible');
            }
        };

        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            
            // Clear the keep-alive interval
            if (this.keepAliveInterval) {
                clearInterval(this.keepAliveInterval);
                this.keepAliveInterval = null;
            }
            
            // Stop recording if it's active
            if (this.isRecording) {
                console.log('Stopping recording due to WebSocket disconnect');
                this.stopRecording();
            }
            
            // Attempt to reconnect with exponential backoff
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
                this.reconnectAttempts++;
                console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                setTimeout(() => this.setupWebSocket(), delay);
            } else {
                console.error('Max reconnection attempts reached. Please refresh the page.');
                const interimText = document.getElementById('interim-text');
                interimText.textContent = 'Connection lost. Please refresh the page.';
                interimText.classList.add('active', 'visible');
            }
        };
    }

    setupUI() {
        const startCalibrationBtn = document.getElementById('start-calibration');
        if (startCalibrationBtn) {
            startCalibrationBtn.addEventListener('click', () => this.startCalibration());
        }
        
        // Initialize speaker indicators
        this.updateSpeakerIndicator(null);
    }

    updateSpeakerIndicator(isOwner) {
        // Отключаем обновление индикатора говорящего
        // const ownerIndicator = document.getElementById('owner-indicator');
        // const guestIndicator = document.getElementById('guest-indicator');
        
        // if (isOwner) {
        //     ownerIndicator.classList.add('active');
        //     guestIndicator.classList.remove('active');
        // } else {
        //     ownerIndicator.classList.remove('active');
        //     guestIndicator.classList.add('active');
        // }
    }

    showCalibrationModal() {
        const modal = document.getElementById('calibration-modal');
        modal.style.display = 'flex';
    }

    hideCalibrationModal() {
        const modal = document.getElementById('calibration-modal');
        modal.style.display = 'none';
        
        // Show the interim text display after calibration
        const interimText = document.getElementById('interim-text');
        interimText.classList.add('active');
        
        // Add a small delay before showing the text to ensure smooth transition
        setTimeout(() => {
            interimText.classList.add('visible');
            // Add a placeholder text to indicate the system is ready
            interimText.textContent = 'Listening...';
        }, 50);
    }

    showRecordingIndicator() {
        const indicator = document.getElementById('recording-indicator');
        indicator.classList.add('active');
    }

    hideRecordingIndicator() {
        const indicator = document.getElementById('recording-indicator');
        indicator.classList.remove('active');
    }

    startCalibration() {
        if (this.isRecording) {
            this.stopRecording();
        }
        
        this.isCalibrating = true;
        this.showCalibrationModal();
        
        // Упрощаем калибровку - просто отправляем сообщение о завершении
        setTimeout(() => {
            this.isCalibrating = false;
            this.hideCalibrationModal();
            this.isCalibrated = true;
            this.currentSpeaker = 'owner';
            this.startRecording();
        }, 1000);
    }

    async startRecording() {
        try {
            if (this.isRecording) {
                console.log('Recording already in progress');
                return;
            }
            
            console.log('Starting recording...');
            
            // Request microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                } 
            });
            
            // Create AudioContext if it doesn't exist
            if (!this.audioContext) {
                this.audioContext = new AudioContext({
                    sampleRate: 16000,
                });
            }
            
            const source = this.audioContext.createMediaStreamSource(stream);
            const processor = this.audioContext.createScriptProcessor(this.audioBufferSize, 1, 1);
            
            source.connect(processor);
            processor.connect(this.audioContext.destination);
            
            this.audioSource = source;
            this.scriptProcessor = processor;
            this.isRecording = true;
            this.audioChunks = [];
            this.lastChunkTime = Date.now();
            
            this.showRecordingIndicator();
            
            // Process audio data
            processor.onaudioprocess = (e) => {
                if (!this.isRecording) return;
                
                const inputData = e.inputBuffer.getChannelData(0);
                
                // Convert float32 to int16
                const pcmData = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    pcmData[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
                }
                
                // Check if the PCM data contains only zeros (silence)
                const hasNonZeroValues = pcmData.some(value => value !== 0);
                if (!hasNonZeroValues) {
                    // Skip silent audio to reduce server load
                    return;
                }
                
                this.audioChunks.push(Array.from(pcmData));
                
                // Send audio chunks at regular intervals
                const now = Date.now();
                if (now - this.lastChunkTime >= this.chunkInterval) {
                    this.sendAudioChunk();
                    this.lastChunkTime = now;
                }
            };
            
            console.log('Recording started');
        } catch (error) {
            console.error('Error starting recording:', error);
            this.hideRecordingIndicator();
            // Show error to user
            const interimText = document.getElementById('interim-text');
            interimText.textContent = `Error: ${error.message}`;
            interimText.classList.add('active', 'visible');
        }
    }

    sendAudioChunk() {
        if (!this.isRecording || this.audioChunks.length === 0) return;
        
        if (this.ws.readyState !== WebSocket.OPEN) {
            console.error('WebSocket not open, cannot send audio chunk');
            return;
        }
        
        try {
            // Combine all collected audio chunks
            const audioData = this.audioChunks.flat();
            this.audioChunks = []; // Clear the chunks after sending
            
            // Send the audio data
            this.ws.send(JSON.stringify({
                type: 'audio',
                audio: audioData,
                timestamp: Date.now()
            }));
            
            this.audioChunksSent++;
        } catch (error) {
            console.error('Error sending audio chunk:', error);
        }
    }

    stopRecording() {
        if (!this.isRecording) return;
        
        console.log('Stopping recording...');
        
        // Send any remaining audio chunks
        if (this.audioChunks.length > 0) {
            this.sendAudioChunk();
        }
        
        // Disconnect audio nodes
        if (this.scriptProcessor) {
            this.scriptProcessor.disconnect();
            this.scriptProcessor = null;
        }
        
        if (this.audioSource) {
            this.audioSource.disconnect();
            this.audioSource = null;
        }
        
        this.isRecording = false;
        this.hideRecordingIndicator();
        
        console.log('Recording stopped');
    }

    addMessage(text, speaker) {
        if (!text || text.trim() === '') return;
        
        const messagesContainer = document.getElementById(`${speaker}-messages`);
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', `${speaker}-message`);
        messageElement.textContent = text;
        
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Clear the interim text
        this.updateInterimText('');
    }

    updateInterimText(text) {
        const interimText = document.getElementById('interim-text');
        
        if (!text || text.trim() === '') {
            interimText.textContent = 'Listening...';
            interimText.classList.remove('visible');
        } else {
            interimText.textContent = text;
            interimText.classList.add('visible');
        }
    }
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Ensure JTalk1 initialization happens if the class exists
    if (typeof JTalk1 !== 'undefined') {
        window.jtalk1 = new JTalk1();
    } else {
        console.warn('JTalk1 class not defined, skipping initialization.');
    }
});

// --- Simple Consent Banner Logic (New Version) ---

// ++ Add helper functions to disable/enable calling UI ++
function disableCallingUI() {
  let phoneInput = document.querySelector('input[type="tel"], input[type="text"]');
  let callButton = document.querySelector('button#call-button, button[type="submit"]');

  if (phoneInput) {
      phoneInput.disabled = true;
      // console.log('Calling UI disabled: Phone input disabled.');
  }
  if (callButton) {
      callButton.disabled = true;
      // console.log('Calling UI disabled: Call button disabled.');
  }
}

function enableCallingUI() {
  let phoneInput = document.querySelector('input[type="tel"], input[type="text"]');
  let callButton = document.querySelector('button#call-button, button[type="submit"]');

  if (phoneInput) {
      phoneInput.disabled = false;
      // console.log('Calling UI enabled: Phone input enabled.');
  }
  if (callButton) {
      callButton.disabled = false;
      // console.log('Calling UI enabled: Call button enabled.');
  }
}
// ++ End helper functions ++

function acceptConsent() {
  localStorage.setItem("cookieConsent", "true");
  const banner = document.getElementById("consent-banner");
  if (banner) banner.style.display = "none";
  enableCallingUI(); // ++ Enable calling UI after consent ++
}

window.addEventListener("DOMContentLoaded", () => {
  const banner = document.getElementById("consent-banner");

  if (localStorage.getItem("cookieConsent") !== "true") {
    if (banner) banner.style.display = "block";
    disableCallingUI(); // ++ Disable calling UI if no consent ++
  } else {
    // Ensure banner is hidden if consent was already given
    if (banner) banner.style.display = "none";
    enableCallingUI(); // ++ Enable calling UI if consent exists ++
  }
});

/* 
// --- Simple Consent Banner Logic (Old Version - REMOVED) ---
document.addEventListener('DOMContentLoaded', () => {
    const consentBanner = document.getElementById('consent-banner');
    if (!consentBanner) return; // Exit if banner HTML not found

    const acceptButton = document.getElementById('accept-consent');
    if (!acceptButton) {
        console.error('Accept button for consent banner not found.');
        return; 
    }

    // Check if consent already given
    if (localStorage.getItem('cookieConsent') !== 'true') {
        consentBanner.style.display = 'block';
    }

    // Handle accept button click
    acceptButton.addEventListener('click', () => {
        localStorage.setItem('cookieConsent', 'true');
        consentBanner.style.display = 'none';
    });
}); 
*/ 
document.addEventListener('DOMContentLoaded', () => {
    console.log('Admin script loaded.');

    // --- Configuration ---
    const ENABLE_SOCKET = false; // Временно отключено
    // Determine WebSocket URL based on page protocol
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`; // Connect to the same host

    // --- DOM Elements ---
    const wsStatusBadge = document.getElementById('ws-status-badge');
    const currentCallSidElement = document.getElementById('current-call-sid');
    const systemLogsList = document.getElementById('system-logs-list');

    // --- State ---
    let ws = null;
    let currentCallSid = 'N/A';
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    const reconnectDelay = 5000; // 5 seconds

    // --- Functions ---

    function updateWsStatus(isConnected) {
        if (!wsStatusBadge) return;
        if (isConnected) {
            wsStatusBadge.textContent = 'Connected';
            wsStatusBadge.classList.remove('disconnected');
            wsStatusBadge.classList.add('connected');
        } else {
            wsStatusBadge.textContent = 'Disconnected';
            wsStatusBadge.classList.remove('connected');
            wsStatusBadge.classList.add('disconnected');
        }
    }

    function updateCurrentCallSid(sid) {
        if (!currentCallSidElement) return;
        currentCallSid = sid || 'N/A';
        currentCallSidElement.textContent = currentCallSid;
    }

    function addLogMessage(message, type = 'system') {
        if (!systemLogsList) return;

        const li = document.createElement('li');
        const timeSpan = document.createElement('span');
        const messageSpan = document.createElement('span');

        timeSpan.className = 'log-time';
        messageSpan.className = 'log-message';

        const now = new Date();
        timeSpan.textContent = now.toLocaleTimeString(); 
        messageSpan.textContent = message;
        
        // Optional: Add class based on type for styling
        li.classList.add(`log-${type}`); 

        li.appendChild(timeSpan);
        li.appendChild(messageSpan);

        // Prepend new log message
        systemLogsList.prepend(li);

        // Optional: Limit number of logs shown?
        // while (systemLogsList.children.length > 100) {
        //     systemLogsList.removeChild(systemLogsList.lastChild);
        // }
    }

    function connectWebSocket() {
        if (!ENABLE_SOCKET) {
            addLogMessage('WebSocket connection is disabled in admin.js');
            updateWsStatus(false);
            return; 
        }

        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            console.log('WebSocket already open or connecting.');
            return;
        }

        console.log('Attempting to connect WebSocket to:', wsUrl);
        addLogMessage('Attempting to connect WebSocket...');
        updateWsStatus(false); // Show disconnected while attempting

        try {
            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                console.log('Admin WebSocket connected.');
                addLogMessage('WebSocket connection established.');
                updateWsStatus(true);
                reconnectAttempts = 0; // Reset attempts on successful connection
                // Maybe send a message to identify as admin?
                // ws.send(JSON.stringify({ type: 'admin_hello' }));
            };

            ws.onmessage = (event) => {
                try {
                    console.log('Admin received message:', event.data);
                    const data = JSON.parse(event.data);
                    
                    // Handle different message types from server
                    switch (data.type) {
                        case 'connected': // Server confirms connection
                            addLogMessage(`Connected with Client ID: ${data.clientId}`);
                            break;
                        case 'call_status': 
                            addLogMessage(`Call ${data.callSid} status: ${data.status}`);
                            if (data.status === 'initiated' || data.status === 'ringing' || data.status === 'in-progress') {
                                updateCurrentCallSid(data.callSid);
                            } else if (data.status === 'completed' || data.status === 'failed' || data.status === 'canceled') {
                                updateCurrentCallSid(null); // Clear SID when call ends
                            }
                            break;
                        case 'transcription':
                            addLogMessage(`[${data.source}] ${data.isFinal ? 'Final:' : 'Interim:'} ${data.text}`, 'transcription');
                            break;
                        case 'error':
                            addLogMessage(`Server Error: ${data.message}`, 'error');
                            break;
                        case 'system_message':
                             addLogMessage(`System: ${data.text}`, 'system');
                             break;
                         // Add other message types as needed
                        default:
                            addLogMessage(`Received unhandled message type: ${data.type}`);
                    }

                } catch (err) {
                    console.error('Error parsing admin message:', err);
                    addLogMessage('Received unparsable message from server.', 'error');
                }
            };

            ws.onclose = (event) => {
                console.log('Admin WebSocket disconnected:', event.code, event.reason);
                addLogMessage(`WebSocket disconnected (${event.code}).`);
                updateWsStatus(false);
                ws = null; // Clear the instance
                
                // Attempt to reconnect if not explicitly closed and within limits
                if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) { 
                    reconnectAttempts++;
                    addLogMessage(`Attempting to reconnect (${reconnectAttempts}/${maxReconnectAttempts})...`);
                    setTimeout(connectWebSocket, reconnectDelay);
                }
            };

            ws.onerror = (error) => {
                console.error('Admin WebSocket error:', error);
                addLogMessage('WebSocket connection error.', 'error');
                updateWsStatus(false);
                // onclose will likely be called next, triggering reconnect logic
            };

        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            addLogMessage('Failed to initiate WebSocket connection.', 'error');
            updateWsStatus(false);
            // Optionally try reconnecting on creation error too
             if (reconnectAttempts < maxReconnectAttempts) {
                 reconnectAttempts++;
                 addLogMessage(`Attempting to reconnect after creation error (${reconnectAttempts}/${maxReconnectAttempts})...`);
                 setTimeout(connectWebSocket, reconnectDelay);
             }
        }
    }

    // --- Initialization ---
    // Clear placeholder log
    if (systemLogsList) {
        systemLogsList.innerHTML = ''; 
    }
    addLogMessage('Admin panel initialized.');
    connectWebSocket(); // Attempt initial connection (will respect ENABLE_SOCKET flag)

}); 
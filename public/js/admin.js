// WebSocket logic specifically for the admin page

document.addEventListener('DOMContentLoaded', () => {
    if (window.location.pathname !== '/admin') {
        // Don't run admin logic on other pages
        return; 
    }

    console.log('Admin page loaded. Initializing WebSocket...');
    const adminLogArea = document.getElementById('admin-log-area');

    function logToAdmin(text) {
        if (adminLogArea) {
            const logEntry = document.createElement('div');
            logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
            adminLogArea.appendChild(logEntry);
            adminLogArea.scrollTop = adminLogArea.scrollHeight; // Scroll to bottom
        } else {
            console.log('[Admin Log]:', text);
        }
    }

    let ws;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    let reconnectDelay = 3000;
    const maxReconnectDelay = 30000;
    let heartbeatInterval = null;
    
    // Use the same base URL determination as CallManager if possible, or hardcode
    const baseUrl = 'https://talkhint-backend-637190449180.us-central1.run.app'; // Assuming production
    const wsUrl = baseUrl.replace('https://', 'wss://') + '/ws';

    function connectAdminWebSocket() {
        logToAdmin('Attempting to connect to WebSocket: ' + wsUrl);
        if (ws) {
            ws.close();
        }
        
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            logToAdmin('WebSocket connected successfully.');
            reconnectAttempts = 0;
            reconnectDelay = 3000;
            // Start heartbeat
            stopHeartbeat();
            heartbeatInterval = setInterval(() => {
                 if (ws?.readyState === WebSocket.OPEN) {
                     ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
                 }
            }, 30000);
        };

        ws.onclose = (event) => {
            logToAdmin(`WebSocket disconnected. Code: ${event.code}, Reason: ${event.reason}. Attempting reconnect...`);
            stopHeartbeat();
            if (reconnectAttempts < maxReconnectAttempts) {
                reconnectAttempts++;
                reconnectDelay = Math.min(reconnectDelay * 1.5, maxReconnectDelay);
                setTimeout(connectAdminWebSocket, reconnectDelay);
            } else {
                logToAdmin('Max WebSocket reconnection attempts reached.');
            }
        };

        ws.onmessage = (event) => {
            // Log ALL messages received on the admin page
            logToAdmin(`Received message: ${event.data}`);
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'pong') {
                    // Optionally hide pongs from log
                     // logToAdmin('Received pong.');
                } else {
                     // Already logged the raw data above
                }
            } catch (e) {
                // Message wasn't JSON, raw data already logged.
            }
        };

        ws.onerror = (error) => {
            logToAdmin(`WebSocket error occurred.`);
            console.error('Admin WebSocket error:', error);
            // The onclose event will likely trigger next for reconnection attempt
        };
    }
    
    function stopHeartbeat() {
         if (heartbeatInterval) {
             clearInterval(heartbeatInterval);
             heartbeatInterval = null;
         }
    }

    // Initial connection attempt
    connectAdminWebSocket();

}); 
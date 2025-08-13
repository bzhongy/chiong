/**
 * Odette Trollbox - Real-time Trading Chat
 * 
 * Features:
 * - Real-time messaging with Firebase Firestore
 * - Wallet-based authentication
 * - Rate limiting and spam protection
 * - Message moderation
 * - Mobile responsive design
 * - Persistent chat history
 */

// Centralized Content Filter Rules
// These rules should match the Firebase security rules
const TROLLBOX_CONTENT_RULES = {
    // Message length constraints
    minLength: 2,
    maxLength: 200,
    
    // Blocked patterns (case-insensitive)
    blockedPatterns: [
        // URLs and links
        {
            pattern: /https?:\/\//i,
            reason: 'No links allowed in chat'
        },
        {
            pattern: /www\./i,
            reason: 'No links allowed in chat'
        },
        {
            pattern: /\b\w+\.(com|org|net|io|fi|xyz|me|co)\b/i,
            reason: 'No links allowed in chat'
        },
        
        // Spam and promotional content
        {
            pattern: /\b(telegram|discord|join|group|channel)\b/i,
            reason: 'No promotional content allowed'
        },
        {
            pattern: /\b(airdrop|giveaway|free|claim|reward)\b/i,
            reason: 'No promotional content allowed'
        },
        {
            pattern: /\b(pump|dump|moon|scam|rug)\b/i,
            reason: 'No pump/dump discussion allowed'
        },
        {
            pattern: /\b(buy|sell)\s+(now|asap|quick|fast)\b/i,
            reason: 'No financial advice allowed'
        },
        
        // Contact information
        {
            pattern: /@\w+/,
            reason: 'No contact information allowed'
        },
        {
            pattern: /\b\d{10,}\b/,
            reason: 'No phone numbers allowed'
        }
    ],
    
    // Rate limiting
    rateLimitWindow: 60000, // 1 minute
    maxMessagesPerWindow: 5,
    
    // Required fields for messages
    requiredFields: ['text', 'author', 'authorAddress', 'timestamp'],
    
    // Address validation
    addressPattern: /^0x[a-fA-F0-9]{40}$/,
    
    // Admin settings
    adminRules: {
        // Admin messages are exempt from most content rules
        exemptFromPatterns: true,
        exemptFromRateLimit: true,
        // But still have length limits
        maxLength: 500, // Admins get longer messages
        minLength: 1
    }
};

// Export rules for Firebase rules generation (if needed)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TROLLBOX_CONTENT_RULES };
}

// Helper function to generate Firebase security rules from centralized config
function generateFirebaseRules() {
    const rules = TROLLBOX_CONTENT_RULES;
    
    // Generate regex patterns for Firebase rules
    const urlPatterns = rules.blockedPatterns
        .filter(rule => rule.reason.includes('links'))
        .map(rule => rule.pattern.source.replace(/\\b/g, '').replace(/\\/g, '\\\\'))
        .join('|');
    
    const spamPatterns = rules.blockedPatterns
        .filter(rule => rule.reason.includes('promotional') || rule.reason.includes('pump'))
        .map(rule => rule.pattern.source.replace(/\\b/g, '').replace(/\\/g, '\\\\'))
        .join('|');
    
    return `
// Auto-generated Firebase rules from TROLLBOX_CONTENT_RULES
function isValidMessage(text) {
  let lowerText = text.lower();
  return text.size() >= ${rules.minLength}
    && text.size() <= ${rules.maxLength}
    && !lowerText.matches('(${urlPatterns})')
    && !lowerText.matches('(${spamPatterns})');
}

// Required fields: ${rules.requiredFields.join(', ')}
// Address pattern: ${rules.addressPattern.source}
// Rate limit: ${rules.maxMessagesPerWindow} messages per ${rules.rateLimitWindow/1000} seconds
    `.trim();
}



class OdetteTrollbox {
    constructor() {
        this.isInitialized = false;
        this.db = null;
        this.currentUser = null;
        this.messagesRef = null;
        this.unsubscribe = null;
        this.lastMessageTime = 0;
        this.messageCount = 0;
        this.rateLimitWindow = TROLLBOX_CONTENT_RULES.rateLimitWindow;
        this.maxMessagesPerWindow = TROLLBOX_CONTENT_RULES.maxMessagesPerWindow;
        this.isMinimized = false;
        this.isHidden = true;
        this.unreadCount = 0;
        this.displayedMessages = new Set(); // Track displayed message IDs
        this.lastSeenTimestamp = this.getLastSeenTimestamp(); // Persistent timestamp tracking
        this.initialLoadComplete = false; // Track if initial messages are loaded
        
        // Pagination tracking
        this.oldestLoadedTimestamp = null;
        this.totalLoadedMessages = 0;
        this.currentEmojiPicker = null; // Track currently open emoji picker
        this.availableEmojis = [
            { emoji: '👍', name: 'thumbs_up', label: 'Thumbs up' },
            { emoji: '👎', name: 'thumbs_down', label: 'Thumbs down' },
            { emoji: '😂', name: 'laugh', label: 'Laugh' },
            { emoji: '🔥', name: 'fire', label: 'Fire' },
            { emoji: '😢', name: 'cry', label: 'Cry' },
            { emoji: '🤔', name: 'thinking', label: 'Thinking' }
        ];
        
        // Resize functionality
        this.isResizing = false;
        this.startY = 0;
        this.startHeight = 0;
        this.savedHeight = null; // Track saved height for minimize/restore
        this.minHeight = 300;
        this.maxHeight = window.innerHeight * 0.8;
        
        // Initialize when DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }
    
    async init() {
        try {
            // Initialize Firebase
            await this.initializeFirebase();
            
            // Setup event listeners
            this.setupEventListeners();
            
            // Wait a bit for UI state manager to be available, then initialize UI
            setTimeout(() => {
                this.initializeUI();
            }, 500);
            
            // Set up wallet integration
            this.setupWalletIntegration();
            
            // Load initial messages
            await this.loadRecentMessages();
            
            this.isInitialized = true;
            
        } catch (error) {
            console.error('Trollbox initialization failed:', error);
            this.showStatus('Failed to initialize chat. Please refresh the page.');
        }
    }
    
    initializeUI() {
        // Check if UI state manager has already handled initialization
        // If not, fall back to legacy behavior
        const hasStateManager = window.uiStateManager && window.uiStateManager.loadState;
        
        if (hasStateManager) {
            // UI state manager will handle initialization
            // Load states from UI state manager
            const isVisible = window.uiStateManager.loadState('trollbox_visible');
            const isMinimized = window.uiStateManager.loadState('trollbox_minimized');
            
            if (isVisible) {
                // Show the trollbox and apply saved states
                this.show();
            } else {
                // Keep hidden but still load height for when it's shown later
                this.loadSavedHeight();
            }
            
            return;
        }
        
        // Legacy behavior - check old trollbox_dismissed flag
        const wasDismissed = localStorage.getItem('trollbox_dismissed') === 'true';
        
        if (wasDismissed) {
            this.hide();
            // Still load height for when it's shown later
            this.loadSavedHeight();
        } else {
            // Auto-show after delay on first visit
            setTimeout(() => {
                if (this.isHidden) {
                    this.show();
                }
            }, 3000);
        }
    }
    
    async initializeFirebase() {
        // Check if Firebase is already initialized
        if (window.firebase && window.firebase.apps.length > 0) {
            this.db = window.firebase.firestore();
            this.setupPresenceSystem();
            return;
        }
        
        // Firebase configuration for Odette
        const firebaseConfig = {
            apiKey: "AIzaSyDOOngf29QH3KoRf8q_F9CcbyQCJkfSvD8",
            authDomain: "odette-trollbox.firebaseapp.com",
            projectId: "odette-trollbox",
            storageBucket: "odette-trollbox.firebasestorage.app",
            messagingSenderId: "927729508636",
            appId: "1:927729508636:web:8d120ebdaa7e6262b85ad9",
            measurementId: "G-LSK6HNP2V6"
          };          
        
        // Load Firebase SDK dynamically
        if (!window.firebase) {
            await this.loadFirebaseSDK();
        }
        
        // Initialize Firebase
        if (!window.firebase.apps.length) {
            window.firebase.initializeApp(firebaseConfig);
        }
        
        this.db = window.firebase.firestore();
        this.messagesRef = this.db.collection('trollbox_messages');
        this.setupPresenceSystem();
    }
    
    async loadFirebaseSDK() {
        return new Promise((resolve, reject) => {
            // Load Firebase SDK
            const script1 = document.createElement('script');
            script1.src = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js';
            script1.onload = () => {
                const script2 = document.createElement('script');
                script2.src = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js';
                script2.onload = resolve;
                script2.onerror = reject;
                document.head.appendChild(script2);
            };
            script1.onerror = reject;
            document.head.appendChild(script1);
        });
    }
    
    setupEventListeners() {
        // Trollbox controls
        const toggleBtn = document.getElementById('trollbox-toggle');
        const minimizeBtn = document.getElementById('trollbox-minimize');
        const closeBtn = document.getElementById('trollbox-close');
        const header = document.getElementById('trollbox-header');
        const input = document.getElementById('trollbox-input');
        const sendBtn = document.getElementById('trollbox-send');
        const resizeHandle = document.getElementById('trollbox-resize-handle');
        
        // Toggle visibility
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.show());
        }
        
        // Minimize/restore on header click
        if (header) {
            header.addEventListener('click', (e) => {
                // Don't toggle if clicking on control buttons
                if (!e.target.closest('.trollbox-controls')) {
                    this.toggleMinimize();
                }
            });
        }
        
        // Control buttons
        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.minimize();
            });
        }
        
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.hide();
            });
        }
        
        // Message input
        if (input) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
            
            input.addEventListener('input', () => {
                this.updateSendButton();
            });
        }
        
        // Send button
        if (sendBtn) {
            sendBtn.addEventListener('click', () => this.sendMessage());
        }
        
        // Resize handle
        if (resizeHandle) {
            resizeHandle.addEventListener('mousedown', (e) => this.startResize(e));
        }
        
        // Global mouse events for resizing
        document.addEventListener('mousemove', (e) => this.handleResize(e));
        document.addEventListener('mouseup', () => this.stopResize());
        
        // Close emoji picker when clicking outside
        document.addEventListener('click', (e) => {
            if (this.currentEmojiPicker && !e.target.closest('.emoji-picker') && !e.target.closest('.message-item')) {
                this.hideEmojiPicker();
            }
        });
        
        // Update max height on window resize
        window.addEventListener('resize', () => {
            this.maxHeight = window.innerHeight * 0.8;
            this.constrainHeight();
        });
    }
    
    setupWalletIntegration() {
        // Listen for wallet connection changes (these might not exist yet, so we'll set up polling too)
        document.addEventListener('walletConnected', (event) => {
            this.onWalletConnected(event.detail);
        });
        
        document.addEventListener('walletDisconnected', () => {
            this.onWalletDisconnected();
        });
        
        // Check if wallet is already connected using Odette's state
        this.checkWalletConnection();
        
        // Set up periodic checking for wallet connection changes
        this.walletCheckInterval = setInterval(() => {
            this.checkWalletConnection();
        }, 2000); // Check every 2 seconds
    }
    
    checkWalletConnection() {
        // Check Odette's global state for connected wallet
        const isConnected = window.state && window.state.connectedAddress;
        const currentAddress = isConnected ? window.state.connectedAddress : null;
        
        // Check if connection status changed
        if (isConnected && !this.currentUser) {
            // Wallet just connected
            this.onWalletConnected({
                address: currentAddress,
                isQuickWallet: this.isQuickWallet()
            });
        } else if (!isConnected && this.currentUser) {
            // Wallet just disconnected
            this.onWalletDisconnected();
        } else if (isConnected && this.currentUser && currentAddress !== this.currentUser.address) {
            // Wallet address changed
            this.onWalletConnected({
                address: currentAddress,
                isQuickWallet: this.isQuickWallet()
            });
        }
    }
    
    isQuickWallet() {
        // Check if using Odette's in-browser wallet
        return window.activeWalletType === 'in-browser' || 
               (window.ethereumClientInstance && 
                window.ethereumClientInstance.getAccount && 
                window.ethereumClientInstance.getAccount().connector && 
                window.ethereumClientInstance.getAccount().connector.id === 'in-browser');
    }
    
    onWalletConnected(walletInfo) {
        this.currentUser = {
            address: walletInfo.address,
            shortAddress: this.shortenAddress(walletInfo.address),
            isQuickWallet: walletInfo.isQuickWallet || false,
            joinedAt: new Date().toISOString()
        };
        
        this.updateUserInterface();
        this.enableChat();
        this.addToPresence(); // Add to online presence
        
        // Add system message for user joining
        this.addSystemMessage(`${this.currentUser.shortAddress} joined the chat`);
    }
    
    onWalletDisconnected() {
        if (this.currentUser) {
            this.addSystemMessage(`${this.currentUser.shortAddress} left the chat`);
            this.removeFromPresence(); // Remove from online presence
        }
        
        this.currentUser = null;
        this.updateUserInterface();
        this.disableChat();
    }
    
    updateUserInterface() {
        const userBadge = document.querySelector('.user-badge');
        const statusElement = document.getElementById('trollbox-status');
        
        if (this.currentUser) {
            if (userBadge) {
                userBadge.textContent = this.currentUser.shortAddress;
                userBadge.className = 'user-badge';
                if (this.currentUser.isQuickWallet) {
                    userBadge.classList.add('quick-wallet');
                }
            }
            
            if (statusElement) {
                statusElement.textContent = 'Ready to chat';
            }
        } else {
            if (userBadge) {
                userBadge.textContent = 'Anonymous';
                userBadge.className = 'user-badge anonymous';
            }
            
            if (statusElement) {
                statusElement.textContent = 'Connect wallet to chat';
            }
        }
    }
    
    enableChat() {
        const input = document.getElementById('trollbox-input');
        const sendBtn = document.getElementById('trollbox-send');
        
        if (input) {
            input.disabled = false;
            input.placeholder = 'Type your message... (Enter to send)';
        }
        
        this.updateSendButton();
    }
    
    disableChat() {
        const input = document.getElementById('trollbox-input');
        const sendBtn = document.getElementById('trollbox-send');
        
        if (input) {
            input.disabled = true;
            input.placeholder = 'Connect wallet to chat';
            input.value = '';
        }
        
        if (sendBtn) {
            sendBtn.disabled = true;
        }
    }
    
    updateSendButton() {
        const input = document.getElementById('trollbox-input');
        const sendBtn = document.getElementById('trollbox-send');
        
        if (sendBtn && input) {
            const hasText = input.value.trim().length > 0;
            const canSend = hasText && this.currentUser && !this.isRateLimited();
            sendBtn.disabled = !canSend;
        }
    }
    
    async sendMessage() {
        const input = document.getElementById('trollbox-input');
        if (!input || !this.currentUser) return;
        
        const message = input.value.trim();
        if (!message) return;
        
        // Check rate limiting
        if (this.isRateLimited()) {
            this.showRateLimitWarning();
            return;
        }
        
        // Check content filter before sending
        const contentCheck = this.checkMessageContent(message);
        if (!contentCheck.allowed) {
            this.showContentFilterWarning(contentCheck.reason);
            input.value = ''; // Clear the blocked message
            return;
        }
        
        try {
            // Create message object
            const messageData = {
                text: message,
                author: this.currentUser.shortAddress,
                authorAddress: this.currentUser.address,
                timestamp: window.firebase.firestore.FieldValue.serverTimestamp(),
                isQuickWallet: this.currentUser.isQuickWallet || false
            };
            
            // Send to Firestore
            await this.messagesRef.add(messageData);
            
            // Clear input
            input.value = '';
            this.updateSendButton();
            
            // Update rate limiting
            this.updateRateLimit();
            
        } catch (error) {
            console.error('Failed to send message:', error);
            
            // Show user-friendly error message
            let errorMessage = 'Failed to send message. ';
            if (error.code === 'permission-denied') {
                errorMessage += 'Message blocked by content filter.';
            } else if (error.code === 'unavailable') {
                errorMessage += 'Connection issue. Please try again.';
            } else {
                errorMessage += 'Please try again.';
            }
            
            this.addSystemMessage(errorMessage, 'error-message');
        }
    }
    
    // Content filter check (client-side preview)
    checkMessageContent(text) {
        // Admin messages bypass content filters (admin interface handles this)
        // This is only for user messages
        
        // Check minimum length
        if (text.length < TROLLBOX_CONTENT_RULES.minLength) {
            return {
                allowed: false,
                reason: `Message too short (min ${TROLLBOX_CONTENT_RULES.minLength} characters)`
            };
        }
        
        // Check maximum length
        if (text.length > TROLLBOX_CONTENT_RULES.maxLength) {
            return {
                allowed: false,
                reason: `Message too long (max ${TROLLBOX_CONTENT_RULES.maxLength} characters)`
            };
        }
        
        // Check against all blocked patterns
        for (const rule of TROLLBOX_CONTENT_RULES.blockedPatterns) {
            if (rule.pattern.test(text)) {
                return {
                    allowed: false,
                    reason: rule.reason
                };
            }
        }
        
        return { allowed: true };
    }
    
    showContentFilterWarning(reason) {
        this.addSystemMessage(`⚠️ Message blocked: ${reason}`, 'content-filter-warning');
    }
    
    isRateLimited() {
        const now = Date.now();
        
        // Reset counter if window has passed
        if (now - this.lastMessageTime > this.rateLimitWindow) {
            this.messageCount = 0;
        }
        
        return this.messageCount >= this.maxMessagesPerWindow;
    }
    
    updateRateLimit() {
        const now = Date.now();
        
        // Reset counter if window has passed
        if (now - this.lastMessageTime > this.rateLimitWindow) {
            this.messageCount = 0;
        }
        
        this.messageCount++;
        this.lastMessageTime = now;
    }
    
    showRateLimitWarning() {
        this.addSystemMessage('Slow down! Too many messages. Please wait before sending another.', 'rate-limit-warning');
    }
    
    async loadRecentMessages() {
        if (!this.messagesRef) return;
        
        try {
            // Load last 50 messages initially
            const snapshot = await this.messagesRef
                .orderBy('timestamp', 'desc')
                .limit(50)
                .get();
            
            const messages = [];
            let latestTimestamp = this.lastSeenTimestamp;
            let oldestTimestamp = null;
            
            // Process messages (they come in desc order, we need asc for display)
            snapshot.forEach(doc => {
                const message = {
                    id: doc.id,
                    ...doc.data()
                };
                
                // Get message timestamp
                const messageTime = message.timestamp ? 
                    (message.timestamp.toDate ? message.timestamp.toDate().getTime() : message.timestamp.seconds * 1000) :
                    Date.now();
                
                // Track oldest timestamp for pagination
                if (!oldestTimestamp || messageTime < oldestTimestamp) {
                    oldestTimestamp = messageTime;
                }
                
                // Track latest timestamp
                if (messageTime > latestTimestamp) {
                    latestTimestamp = messageTime;
                }
                
                messages.unshift(message); // Add to beginning to reverse order
                // Mark as displayed so real-time listener doesn't duplicate
                this.markMessageAsDisplayed(message.id);
            });
            
            // Store pagination info
            this.oldestLoadedTimestamp = oldestTimestamp;
            this.totalLoadedMessages = messages.length;
            
            // Display messages in chronological order
            messages.forEach(message => {
                this.displayMessage(message, false);
            });
            
            // Update last seen timestamp to latest message
            if (latestTimestamp > this.lastSeenTimestamp) {
                this.saveLastSeenTimestamp(latestTimestamp);
            }
            
            // Set up real-time listener AFTER loading initial messages
            this.setupRealtimeListener();
            
            // Set up reaction listener
            this.setupRealtimeReactionListener();
            
            // Set up scroll detection for pagination
            this.setupScrollPagination();
            
            this.initialLoadComplete = true;
            
        } catch (error) {
            console.error('Failed to load messages:', error);
            this.showStatus('Failed to load chat history.');
        }
    }
    
    setupRealtimeListener() {
        if (!this.messagesRef) return;
        
        // Listen for messages newer than the latest loaded message
        const cutoffTime = new Date(this.lastSeenTimestamp);
        
        // Listen for new messages in real-time
        this.unsubscribe = this.messagesRef
            .where('timestamp', '>', cutoffTime)
            .orderBy('timestamp', 'asc')
            .onSnapshot((snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    if (change.type === 'added') {
                        const message = {
                            id: change.doc.id,
                            ...change.doc.data()
                        };
                        
                        // Get message timestamp
                        const messageTime = message.timestamp ? 
                            (message.timestamp.toDate ? message.timestamp.toDate().getTime() : message.timestamp.seconds * 1000) :
                            Date.now();
                        
                        // Only display if we haven't seen this message before
                        if (!this.hasDisplayedMessage(message.id)) {
                            // Check if this is genuinely a new message (after initial load)
                            const isGenuinelyNew = this.initialLoadComplete && messageTime > this.lastSeenTimestamp;
                            
                            this.displayMessage(message, isGenuinelyNew);
                            
                            // Only handle as "new" if it's genuinely new (not from initial load)
                            if (isGenuinelyNew) {
                                this.handleNewMessage(message);
                                // Update last seen timestamp for genuinely new messages
                                if (messageTime > this.lastSeenTimestamp) {
                                    this.saveLastSeenTimestamp(messageTime);
                                }
                            }
                            
                            this.markMessageAsDisplayed(message.id);
                        }
                    }
                });
            }, (error) => {
                console.error('Real-time listener error:', error);
                this.showStatus('Connection lost. Refresh to reconnect.');
            });
    }
    
    setupScrollPagination() {
        const messagesContainer = document.getElementById('trollbox-messages');
        if (!messagesContainer) return;
        
        let isLoading = false;
        
        messagesContainer.addEventListener('scroll', async () => {
            // Check if scrolled to the top (within 50px)
            if (messagesContainer.scrollTop <= 50 && !isLoading && this.oldestLoadedTimestamp) {
                isLoading = true;
                
                // Show loading indicator
                const loadingMsg = document.createElement('div');
                loadingMsg.className = 'system-message loading-more';
                loadingMsg.innerHTML = '<i class="bi bi-hourglass-split"></i> Loading more messages...';
                messagesContainer.insertBefore(loadingMsg, messagesContainer.firstChild);
                
                try {
                    const oldScrollHeight = messagesContainer.scrollHeight;
                    await this.loadMoreMessages();
                    
                    // Maintain scroll position after adding messages
                    const newScrollHeight = messagesContainer.scrollHeight;
                    messagesContainer.scrollTop = newScrollHeight - oldScrollHeight + messagesContainer.scrollTop;
                    
                } catch (error) {
                    console.error('Failed to load more messages:', error);
                }
                
                // Remove loading indicator
                loadingMsg.remove();
                isLoading = false;
            }
        });
    }
    
    async loadMoreMessages() {
        if (!this.messagesRef || !this.oldestLoadedTimestamp) return;
        
        try {
            const snapshot = await this.messagesRef
                .where('timestamp', '<', new Date(this.oldestLoadedTimestamp))
                .orderBy('timestamp', 'desc')
                .limit(50)
                .get();
            
            if (snapshot.empty) {
                return;
            }
            
            const messages = [];
            let newOldestTimestamp = this.oldestLoadedTimestamp;
            
            snapshot.forEach(doc => {
                const message = {
                    id: doc.id,
                    ...doc.data()
                };
                
                const messageTime = message.timestamp ? 
                    (message.timestamp.toDate ? message.timestamp.toDate().getTime() : message.timestamp.seconds * 1000) :
                    Date.now();
                
                if (messageTime < newOldestTimestamp) {
                    newOldestTimestamp = messageTime;
                }
                
                messages.unshift(message); // Reverse order for display
                this.markMessageAsDisplayed(message.id);  
            });
            
            // Update oldest timestamp
            this.oldestLoadedTimestamp = newOldestTimestamp;
            this.totalLoadedMessages += messages.length;
            
            // Insert messages at the beginning of the container
            const messagesContainer = document.getElementById('trollbox-messages');
            if (messagesContainer) {
                messages.forEach(message => {
                    const messageElement = this.createMessageElement(message);
                    messagesContainer.insertBefore(messageElement, messagesContainer.firstChild);
                });
            }
            

            
        } catch (error) {
            console.error('Failed to load more messages:', error);
        }
    }
    
    createMessageElement(message) {
        const messageElement = document.createElement('div');
        messageElement.className = 'message';
        messageElement.setAttribute('data-message-id', message.id);
        
        // Check if this is an admin message
        if (message.isAdmin) {
            messageElement.classList.add('admin-message');
        }
        
        // Check if this is user's own message
        if (this.currentUser && message.authorAddress === this.currentUser.address) {
            messageElement.classList.add('own-message');
        }
        
        // Create message content with smart timestamp
        const timestamp = message.timestamp ? 
            (message.timestamp.toDate ? message.timestamp.toDate() : new Date(message.timestamp.seconds * 1000)) :
            new Date();
        
        const now = new Date();
        const isToday = timestamp.toDateString() === now.toDateString();
        const isYesterday = timestamp.toDateString() === new Date(now.getTime() - 24 * 60 * 60 * 1000).toDateString();
        
        let timeString;
        if (isToday) {
            timeString = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (isYesterday) {
            timeString = 'Yesterday ' + timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            timeString = timestamp.toLocaleDateString([], { day: '2-digit', month: '2-digit' }) + ' ' + 
                        timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        
        let authorDisplay = message.author;
        let adminBadge = '';
        
        if (message.isAdmin) {
            authorDisplay = 'Admin';
            adminBadge = '<span class="admin-badge"><i class="bi bi-shield-check-fill"></i></span>';
        }
        
        messageElement.innerHTML = `
            <div class="message-header">
                <span class="message-author ${message.isAdmin ? 'admin-author' : 'clickable-username'}" 
                      ${!message.isAdmin ? `data-address="${message.authorAddress}" title="Click to view ${message.author}'s trading profile"` : ''}>
                    ${authorDisplay}
                </span>
                ${adminBadge}
                <span class="message-time">${timeString}</span>
            </div>
            <div class="message-content">${this.sanitizeMessage(message.text)}</div>
            <div class="message-reactions" id="reactions-${message.id}">
                ${this.renderReactions(message.reactions || {})}
            </div>
        `;
        
        // Add click handlers
        if (!message.isAdmin) {
            const usernameElement = messageElement.querySelector('.clickable-username');
            if (usernameElement) {
                usernameElement.addEventListener('click', () => {
                    const address = usernameElement.getAttribute('data-address');
                    if (address) {
                        window.open(`userBrowser.html?address=${encodeURIComponent(address)}`, '_blank');
                    }
                });
            }
        }
        
        if (this.currentUser) {
            const messageContentDiv = messageElement.querySelector('.message-content');
            if (messageContentDiv) {
                messageContentDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showEmojiPicker(message.id, messageElement);
                });
                messageContentDiv.style.cursor = 'pointer';
                messageContentDiv.title = 'Click to react with emoji';
            }
        }
        
        return messageElement;
    }
    
    displayMessage(message, isNew = false) {
        const messagesContainer = document.getElementById('trollbox-messages');
        if (!messagesContainer) return;
        
        const messageElement = document.createElement('div');
        messageElement.className = 'message';
        messageElement.setAttribute('data-message-id', message.id);
        
        if (isNew) {
            messageElement.classList.add('new-message');
        }
        
        // Check if this is an admin message
        if (message.isAdmin) {
            messageElement.classList.add('admin-message');
        }
        
        // Check if this is user's own message
        if (this.currentUser && message.authorAddress === this.currentUser.address) {
            messageElement.classList.add('own-message');
        }
        
        // Create message content
        const timestamp = message.timestamp ? 
            (message.timestamp.toDate ? message.timestamp.toDate() : new Date(message.timestamp.seconds * 1000)) :
            new Date();
        
        // Smart timestamp formatting - show date for older messages
        const now = new Date();
        const isToday = timestamp.toDateString() === now.toDateString();
        const isYesterday = timestamp.toDateString() === new Date(now.getTime() - 24 * 60 * 60 * 1000).toDateString();
        
        let timeString;
        if (isToday) {
            // Today: just show time
            timeString = timestamp.toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
        } else if (isYesterday) {
            // Yesterday: show "Yesterday HH:MM"
            timeString = 'Yesterday ' + timestamp.toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
        } else {
            // Older: show date + time (DD/MM HH:MM)
            timeString = timestamp.toLocaleDateString([], { 
                day: '2-digit', 
                month: '2-digit' 
            }) + ' ' + timestamp.toLocaleTimeString([], { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
        }
        
        // Special handling for admin messages
        let authorDisplay = message.author;
        let adminBadge = '';
        
        if (message.isAdmin) {
            authorDisplay = 'Admin';
            adminBadge = '<span class="admin-badge"><i class="bi bi-shield-check-fill"></i></span>';
        }
        
        messageElement.innerHTML = `
            <div class="message-header">
                <span class="message-author ${message.isAdmin ? 'admin-author' : 'clickable-username'}" 
                      ${!message.isAdmin ? `data-address="${message.authorAddress}" title="Click to view ${message.author}'s trading profile"` : ''}>
                    ${authorDisplay}
                </span>
                ${adminBadge}
                <span class="message-time">${timeString}</span>
            </div>
            <div class="message-content">${this.sanitizeMessage(message.text)}</div>
            <div class="message-reactions" id="reactions-${message.id}">
                ${this.renderReactions(message.reactions || {})}
            </div>
        `;
        
        // Add click handler for username (only for non-admin messages)
        if (!message.isAdmin) {
            const usernameElement = messageElement.querySelector('.clickable-username');
            if (usernameElement) {
                usernameElement.addEventListener('click', () => {
                    const address = usernameElement.getAttribute('data-address');
                    if (address) {
                        // Open user browser with address pre-filled
                        const userBrowserUrl = `userBrowser.html?address=${encodeURIComponent(address)}`;
                        window.open(userBrowserUrl, '_blank');
                    }
                });
            }
        }
        
        // Add click handler for emoji reactions (only if user is connected)
        if (this.currentUser) {
            const messageContentDiv = messageElement.querySelector('.message-content');
            if (messageContentDiv) {
                messageContentDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showEmojiPicker(message.id, messageElement);
                });
                
                // Add visual indicator that message is clickable
                messageContentDiv.style.cursor = 'pointer';
                messageContentDiv.title = 'Click to react with emoji';
            }
        }
        
        // Add to container
        messagesContainer.appendChild(messageElement);
        
        // Auto-scroll to bottom (only for new messages, not pagination)
        if (isNew) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }
    
    addSystemMessage(text, className = '') {
        const messagesContainer = document.getElementById('trollbox-messages');
        if (!messagesContainer) return;
        
        const messageElement = document.createElement('div');
        messageElement.className = `system-message ${className}`;
        messageElement.innerHTML = `<i class="bi bi-info-circle"></i> ${text}`;
        
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    
    handleNewMessage(message) {
        // Don't notify for own messages
        if (this.currentUser && message.authorAddress === this.currentUser.address) {
            return;
        }
        
        // Update unread count if minimized/hidden
        if (this.isMinimized || this.isHidden) {
            this.unreadCount++;
            this.updateNotificationBadge();
        }
        
        // Desktop notifications removed - no more popup notifications
    }
    
    updateNotificationBadge() {
        const badge = document.getElementById('chat-notification');
        const toggleBtn = document.getElementById('trollbox-toggle');
        
        if (this.unreadCount > 0) {
            if (badge) {
                badge.textContent = Math.min(this.unreadCount, 99);
                badge.style.display = 'flex';
            }
            
            // Add pulsing effect to toggle button
            if (toggleBtn) {
                toggleBtn.style.animation = 'pulse 2s infinite';
            }
        } else {
            if (badge) {
                badge.style.display = 'none';
            }
            
            if (toggleBtn) {
                toggleBtn.style.animation = '';
            }
        }
    }
    
    sanitizeMessage(text) {
        // Basic XSS prevention
        const div = document.createElement('div');
        div.textContent = text;
        let sanitized = div.innerHTML;
        
        // Simple link detection (optional)
        sanitized = sanitized.replace(
            /(https?:\/\/[^\s]+)/g,
            '<a href="$1" target="_blank" rel="noopener">$1</a>'
        );
        
        return sanitized;
    }
    
    shortenAddress(address) {
        if (!address) return 'Anonymous';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }
    
    // UI Control Methods
    show() {
        const widget = document.getElementById('trollbox-widget');
        const toggle = document.getElementById('trollbox-toggle');
        
        if (widget) {
            widget.classList.remove('hidden');
            this.isHidden = false;
        }
        
        if (toggle) {
            toggle.style.display = 'none';
        }
        
        // Clear unread count and update last seen timestamp
        this.unreadCount = 0;
        this.updateNotificationBadge();
        this.saveLastSeenTimestamp(Date.now());
        
        // Save state
        if (window.uiStateManager) {
            window.uiStateManager.saveState('trollbox_visible', true);
        }
        
        // Load saved height and minimize state after showing
        setTimeout(() => {
            // Check if it should be minimized
            let shouldBeMinimized = false;
            if (window.uiStateManager) {
                shouldBeMinimized = window.uiStateManager.loadState('trollbox_minimized');
            }
            
            if (shouldBeMinimized) {
                this.minimize();
            } else {
                this.loadSavedHeight();
            }
            
            // Auto-scroll to bottom
            const messages = document.getElementById('trollbox-messages');
            if (messages) {
                messages.scrollTop = messages.scrollHeight;
            }
        }, 200);
    }
    
    hide() {
        const widget = document.getElementById('trollbox-widget');
        const toggle = document.getElementById('trollbox-toggle');
        
        if (widget) {
            widget.classList.add('hidden');
            this.isHidden = true;
        }
        
        if (toggle) {
            toggle.style.display = 'flex';
        }
        
        // Save state using both methods for backward compatibility
        localStorage.setItem('trollbox_dismissed', 'true');
        if (window.uiStateManager) {
            window.uiStateManager.saveState('trollbox_visible', false);
        }
    }
    
    minimize() {
        const widget = document.getElementById('trollbox-widget');
        const content = document.getElementById('trollbox-content');
        
        if (widget && content) {
            // Save current height before minimizing (if not already saved)
            if (!this.isMinimized) {
                this.savedHeight = widget.offsetHeight;
            }
            
            widget.classList.add('minimized');
            this.isMinimized = true;
            
            // Remove explicit height when minimized to let CSS take control
            widget.style.height = '';
        }
        
        // Save state
        if (window.uiStateManager) {
            window.uiStateManager.saveState('trollbox_minimized', true);
        }
    }
    
    restore() {
        const widget = document.getElementById('trollbox-widget');
        const content = document.getElementById('trollbox-content');
        
        if (widget && content) {
            widget.classList.remove('minimized');
            this.isMinimized = false;
            
            // Restore the saved height when unminimizing
            if (this.savedHeight) {
                const constrainedHeight = Math.max(this.minHeight, Math.min(this.savedHeight, this.maxHeight));
                widget.style.height = constrainedHeight + 'px';
            } else {
                // Load from state manager if no saved height in memory
                this.loadSavedHeight();
            }
            
            // Clear unread count and update last seen timestamp
            this.unreadCount = 0;
            this.updateNotificationBadge();
            this.saveLastSeenTimestamp(Date.now());
        }
        
        // Save state
        if (window.uiStateManager) {
            window.uiStateManager.saveState('trollbox_minimized', false);
        }
    }
    
    toggleMinimize() {
        if (this.isMinimized) {
            this.restore();
        } else {
            this.minimize();
        }
    }
    
    showStatus(message) {
        const statusElement = document.getElementById('trollbox-status');
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.style.color = '#ff4757';
            
            setTimeout(() => {
                this.updateUserInterface();
            }, 3000);
        }
    }
    
    // Cleanup
    destroy() {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        if (this.reactionUnsubscribe) {
            this.reactionUnsubscribe();
        }
        if (this.walletCheckInterval) {
            clearInterval(this.walletCheckInterval);
        }
        if (this.presenceUnsubscribe) {
            this.presenceUnsubscribe();
        }
        if (this.currentUser) {
            this.removeFromPresence();
        }
        this.hideEmojiPicker();
    }
    
    // Presence system for tracking online users
    setupPresenceSystem() {
        if (!this.db) {
            return;
        }
        
        this.presenceRef = this.db.collection('trollbox_presence');
        
        // Listen for online user changes
        this.presenceUnsubscribe = this.presenceRef
            .where('lastSeen', '>', Date.now() - 120000) // Active in last 2 minutes
            .onSnapshot((snapshot) => {
                const onlineCount = snapshot.size;
                this.updateOnlineCount(onlineCount);
            }, (error) => {
                console.error('Presence listener error:', error);
                // Try to reconnect after error
                setTimeout(() => {
                    this.setupPresenceSystem();
                }, 5000);
            });
        
        // Clean up old presence records periodically
        setInterval(() => {
            this.cleanupOldPresence();
        }, 30000); // Every 30 seconds
    }
    
    updateOnlineCount(count) {
        const onlineCountElement = document.getElementById('online-count');
        if (onlineCountElement) {
            onlineCountElement.textContent = `${count} online`;
        }
    }
    
    async addToPresence() {
        if (!this.presenceRef || !this.currentUser) {
            return;
        }
        
        try {
            const presenceData = {
                address: this.currentUser.address,
                shortAddress: this.currentUser.shortAddress,
                isQuickWallet: this.currentUser.isQuickWallet || false,
                lastSeen: Date.now(),
                joinedAt: Date.now()
            };
            
            // Use address as document ID to prevent duplicates
            await this.presenceRef.doc(this.currentUser.address).set(presenceData);
            
            // Update presence every 30 seconds
            if (this.presenceInterval) {
                clearInterval(this.presenceInterval);
            }
            
            this.presenceInterval = setInterval(async () => {
                if (this.currentUser && this.presenceRef) {
                    try {
                        await this.presenceRef.doc(this.currentUser.address).update({
                            lastSeen: Date.now()
                        });
                    } catch (error) {
                        console.error('Error updating presence:', error);
                    }
                }
            }, 30000);
            
        } catch (error) {
            console.error('Error adding to presence:', error);
        }
    }
    
    async removeFromPresence() {
        if (!this.presenceRef || !this.currentUser) {
            return;
        }
        
        try {
            await this.presenceRef.doc(this.currentUser.address).delete();
            
            if (this.presenceInterval) {
                clearInterval(this.presenceInterval);
                this.presenceInterval = null;
            }
        } catch (error) {
            console.error('Error removing from presence:', error);
        }
    }
    
    async cleanupOldPresence() {
        if (!this.presenceRef) return;
        
        try {
            const cutoffTime = Date.now() - 180000; // 3 minutes ago
            const oldPresence = await this.presenceRef
                .where('lastSeen', '<', cutoffTime)
                .get();
            
            if (!oldPresence.empty) {
                const batch = this.db.batch();
                oldPresence.forEach(doc => {
                    batch.delete(doc.ref);
                });
                await batch.commit();
            }
        } catch (error) {
            console.error('Error cleaning up old presence:', error);
        }
    }
    
    // Helper methods for tracking displayed messages
    hasDisplayedMessage(messageId) {
        return this.displayedMessages.has(messageId);
    }
    
    markMessageAsDisplayed(messageId) {
        this.displayedMessages.add(messageId);
        
        // Keep only last 200 message IDs to prevent memory bloat
        if (this.displayedMessages.size > 200) {
            const idsArray = Array.from(this.displayedMessages);
            this.displayedMessages.clear();
            // Keep last 100
            idsArray.slice(-100).forEach(id => this.displayedMessages.add(id));
        }
    }
    
    // Add these new methods for emoji reactions
    renderReactions(reactions) {
        if (!reactions || Object.keys(reactions).length === 0) {
            return '';
        }
        
        const reactionElements = [];
        
        this.availableEmojis.forEach(emojiData => {
            const reactionData = reactions[emojiData.name];
            if (reactionData && reactionData.count > 0) {
                const isUserReacted = this.currentUser && reactionData.users && reactionData.users.includes(this.currentUser.address);
                const userClass = isUserReacted ? 'user-reacted' : '';
                const usersList = reactionData.users ? reactionData.users.map(addr => this.shortenAddress(addr)).join(', ') : '';
                
                reactionElements.push(`
                    <span class="reaction-item ${userClass}" 
                          data-reaction="${emojiData.name}"
                          title="${emojiData.label}: ${usersList}">
                        ${emojiData.emoji} ${reactionData.count}
                    </span>
                `);
            }
        });
        
        return reactionElements.join('');
    }
    
    showEmojiPicker(messageId, messageElement) {
        // Hide any existing emoji picker
        this.hideEmojiPicker();
        
        // Create emoji picker
        const picker = document.createElement('div');
        picker.className = 'emoji-picker';
        picker.innerHTML = `
            <div class="emoji-picker-content">
                ${this.availableEmojis.map(emoji => `
                    <button class="emoji-button" data-emoji="${emoji.name}" title="${emoji.label}">
                        ${emoji.emoji}
                    </button>
                `).join('')}
            </div>
        `;
        
        // Position picker near the message
        const messageRect = messageElement.getBoundingClientRect();
        const container = document.getElementById('trollbox-messages');
        const containerRect = container.getBoundingClientRect();
        
        picker.style.position = 'absolute';
        picker.style.top = (messageRect.top - containerRect.top + container.scrollTop - 50) + 'px';
        picker.style.left = (messageRect.left - containerRect.left + 10) + 'px';
        picker.style.zIndex = '1000';
        
        // Add click handlers for emoji buttons
        picker.querySelectorAll('.emoji-button').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const emojiName = button.getAttribute('data-emoji');
                this.toggleReaction(messageId, emojiName);
                this.hideEmojiPicker();
            });
        });
        
        // Add picker to messages container
        container.appendChild(picker);
        this.currentEmojiPicker = picker;
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            this.hideEmojiPicker();
        }, 5000);
    }
    
    hideEmojiPicker() {
        if (this.currentEmojiPicker) {
            this.currentEmojiPicker.remove();
            this.currentEmojiPicker = null;
        }
    }
    
    async toggleReaction(messageId, emojiName) {
        if (!this.currentUser || !this.messagesRef) {
            console.warn('Cannot react: user not connected or Firebase not available');
            return;
        }
        
        try {
            const messageRef = this.messagesRef.doc(messageId);
            const messageDoc = await messageRef.get();
            
            if (!messageDoc.exists) {
                console.warn('Message not found');
                return;
            }
            
            const messageData = messageDoc.data();
            const reactions = messageData.reactions || {};
            const userAddress = this.currentUser.address;
            
            // Initialize reaction if it doesn't exist
            if (!reactions[emojiName]) {
                reactions[emojiName] = {
                    count: 0,
                    users: []
                };
            }
            
            // Toggle user's reaction
            const userIndex = reactions[emojiName].users.indexOf(userAddress);
            
            if (userIndex === -1) {
                // Add reaction
                reactions[emojiName].users.push(userAddress);
                reactions[emojiName].count++;
            } else {
                // Remove reaction
                reactions[emojiName].users.splice(userIndex, 1);
                reactions[emojiName].count--;
                
                // Clean up empty reactions
                if (reactions[emojiName].count === 0) {
                    delete reactions[emojiName];
                }
            }
            
            // Update message in Firebase
            await messageRef.update({ reactions });
            
            // Update UI immediately for better UX
            this.updateReactionDisplay(messageId, reactions);
            
        } catch (error) {
            console.error('Failed to toggle reaction:', error);
            
            if (error.code === 'permission-denied') {
                this.addSystemMessage('⚠️ Unable to react to messages. Please check your connection.', 'error-message');
            }
        }
    }
    
    updateReactionDisplay(messageId, reactions) {
        const reactionsContainer = document.getElementById(`reactions-${messageId}`);
        if (reactionsContainer) {
            const reactionsHtml = this.renderReactions(reactions);
            reactionsContainer.innerHTML = reactionsHtml;
            
            // Show/hide the container based on whether there are reactions
            if (reactionsHtml.trim() === '') {
                reactionsContainer.style.display = 'none';
            } else {
                reactionsContainer.style.display = 'flex';
                
                // Add click handlers to reaction items for toggling
                reactionsContainer.querySelectorAll('.reaction-item').forEach(item => {
                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const reactionName = item.getAttribute('data-reaction');
                        this.toggleReaction(messageId, reactionName);
                    });
                    
                    // Make reaction items clickable
                    item.style.cursor = 'pointer';
                });
            }
        }
    }
    
    setupRealtimeReactionListener() {
        if (!this.messagesRef) return;
        
        // Listen for reaction updates in real-time
        this.reactionUnsubscribe = this.messagesRef.onSnapshot((snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'modified') {
                    const message = {
                        id: change.doc.id,
                        ...change.doc.data()
                    };
                    
                    // Update reactions display if message is already displayed
                    if (this.hasDisplayedMessage(message.id)) {
                        this.updateReactionDisplay(message.id, message.reactions || {});
                    }
                }
            });
        }, (error) => {
            console.error('Reaction listener error:', error);
        });
    }

    // Add drag-to-resize functionality methods
    startResize(e) {
        // Only allow resize on desktop
        if (window.innerWidth <= 768) return;
        
        this.isResizing = true;
        this.startY = e.clientY;
        
        const widget = document.getElementById('trollbox-widget');
        if (widget) {
            this.startHeight = widget.offsetHeight;
            widget.classList.add('resizing');
        }
        
        e.preventDefault();
    }
    
    handleResize(e) {
        if (!this.isResizing) return;
        
        const widget = document.getElementById('trollbox-widget');
        if (!widget) return;
        
        const deltaY = this.startY - e.clientY; // Inverted because we want drag up to increase height
        const newHeight = this.startHeight + deltaY;
        
        // Constrain height within bounds
        const constrainedHeight = Math.max(this.minHeight, Math.min(newHeight, this.maxHeight));
        
        widget.style.height = constrainedHeight + 'px';
        
        e.preventDefault();
    }
    
    stopResize() {
        if (!this.isResizing) return;
        
        this.isResizing = false;
        
        const widget = document.getElementById('trollbox-widget');
        if (widget) {
            widget.classList.remove('resizing');
            
            // Save the height to both memory and state manager
            const currentHeight = widget.offsetHeight;
            this.savedHeight = currentHeight;
            
            // Try UI state manager first, fallback to localStorage
            if (window.uiStateManager) {
                window.uiStateManager.saveState('trollbox_height', currentHeight);
            } else {
                // Fallback to direct localStorage
                localStorage.setItem('trollbox_height', currentHeight.toString());
            }
        }
    }
    
    constrainHeight() {
        const widget = document.getElementById('trollbox-widget');
        if (!widget || this.isMinimized) return; // Don't constrain when minimized
        
        const currentHeight = widget.offsetHeight;
        const constrainedHeight = Math.max(this.minHeight, Math.min(currentHeight, this.maxHeight));
        
        if (constrainedHeight !== currentHeight) {
            widget.style.height = constrainedHeight + 'px';
            this.savedHeight = constrainedHeight;
        }
    }
    
    loadSavedHeight() {
        // Don't apply height when minimized, but still load it for later use
        if (this.isMinimized) {
            return;
        }
        
        let savedHeight = null;
        
        // Try UI state manager first
        if (window.uiStateManager) {
            savedHeight = window.uiStateManager.loadState('trollbox_height');
        }
        
        // Fallback to localStorage if no value from state manager
        if (!savedHeight) {
            const localStorageHeight = localStorage.getItem('trollbox_height');
            if (localStorageHeight) {
                savedHeight = parseInt(localStorageHeight, 10);
            }
        }
        
        if (savedHeight && typeof savedHeight === 'number' && savedHeight > 0) {
            // Store the height for later use
            this.savedHeight = savedHeight;
            
            const widget = document.getElementById('trollbox-widget');
            if (widget) {
                const constrainedHeight = Math.max(this.minHeight, Math.min(savedHeight, this.maxHeight));
                widget.style.height = constrainedHeight + 'px';
            }
        }
    }

    // Methods for persistent timestamp tracking
    getLastSeenTimestamp() {
        try {
            const stored = localStorage.getItem('trollbox_last_seen');
            return stored ? parseInt(stored) : Date.now() - (24 * 60 * 60 * 1000); // Default to 24h ago
        } catch (error) {
            console.warn('Failed to load last seen timestamp:', error);
            return Date.now() - (24 * 60 * 60 * 1000);
        }
    }
    
    saveLastSeenTimestamp(timestamp) {
        try {
            localStorage.setItem('trollbox_last_seen', timestamp.toString());
            this.lastSeenTimestamp = timestamp;
        } catch (error) {
            console.warn('Failed to save last seen timestamp:', error);
        }
    }

    // Reset message tracking state
    resetMessageTracking() {
        // Clear displayed messages cache
        this.displayedMessages.clear();
        
        // Reset last seen timestamp to now
        this.saveLastSeenTimestamp(Date.now());
        
        // Clear unread count
        this.unreadCount = 0;
        this.updateNotificationBadge();
        
        // Clear persistent storage items that might be causing issues
        try {
            localStorage.removeItem('trollbox_last_seen');
        } catch (error) {
            console.warn('Failed to clear localStorage:', error);
        }
    }
}

// Initialize trollbox when page loads
window.odetteTrollbox = new OdetteTrollbox();

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (window.odetteTrollbox) {
        window.odetteTrollbox.destroy();
    }
});

// Add pulse animation to CSS if not already present
if (!document.querySelector('#trollbox-pulse-style')) {
    const style = document.createElement('style');
    style.id = 'trollbox-pulse-style';
    style.textContent = `
        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
        }
    `;
    document.head.appendChild(style);
}

 
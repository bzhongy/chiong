/**
 * Chiong Trollbox Admin Interface
 * 
 * Features:
 * - Password-based authentication
 * - Admin message sending (appears as "Admin" in trollbox)
 * - Message deletion functionality
 * - Statistics dashboard
 * - Message filtering and search
 */

class TrollboxAdmin {
    constructor() {
        this.isAuthenticated = false;
        this.adminToken = null;
        this.db = null;
        this.messagesRef = null;
        this.presenceRef = null;
        this.currentPage = 1;
        this.messagesPerPage = 20;
        this.currentFilter = 'all';
        this.currentTimeFilter = '24h';
        this.currentSearchQuery = '';
        this.messageToDelete = null;
        
        // Admin password hash - in production, this should be more secure
        // For now, using a simple SHA-256 hash of "pecan@thetanuts"
        this.adminPasswordHash = '4960b1e73589f7c33383e1bba2ab9f41b072eb6c660faa5572d7edea0528e95f';
        
        this.init();
    }
    
    async init() {
        console.log('🔧 Initializing Trollbox Admin...');
        
        try {
            // Wait for Firebase to be initialized by the main trollbox
            await this.waitForFirebase();
            
            // Setup Firebase references
            this.setupFirebase();
            
            // Setup event listeners
            this.setupEventListeners();
            
            // Check if already authenticated
            this.checkAuthStatus();
            
            console.log('✅ Trollbox Admin initialized');
        } catch (error) {
            console.error('❌ Admin initialization failed:', error);
            this.showError('Failed to initialize admin interface. Please refresh the page.');
        }
    }
    
    async waitForFirebase() {
        // Wait for Firebase to be initialized by trollbox.js
        let attempts = 0;
        const maxAttempts = 20;
        
        while (attempts < maxAttempts) {
            if (window.firebase && window.firebase.apps.length > 0) {
                console.log('🔥 Firebase available from trollbox.js');
                return;
            }
            
            await new Promise(resolve => setTimeout(resolve, 500));
            attempts++;
        }
        
        throw new Error('Firebase not available - please ensure trollbox.js is loaded first');
    }
    
    setupFirebase() {
        this.db = window.firebase.firestore();
        this.messagesRef = this.db.collection('trollbox_messages');
        this.presenceRef = this.db.collection('trollbox_presence');
        
        console.log('🔥 Firebase references setup for admin');
    }
    
    setupEventListeners() {
        // Login form
        const loginForm = document.getElementById('admin-login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleLogin();
            });
        }
        
        // Logout button
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.logout());
        }
        
        // Admin message input
        const adminInput = document.getElementById('admin-message-input');
        const adminSendBtn = document.getElementById('admin-send-btn');
        
        if (adminInput) {
            adminInput.addEventListener('input', () => this.updateCharCount());
            adminInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendAdminMessage();
                }
            });
        }
        
        if (adminSendBtn) {
            adminSendBtn.addEventListener('click', () => this.sendAdminMessage());
        }
        
        // Message management controls
        const refreshBtn = document.getElementById('refresh-messages');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.loadMessages());
        }
        
        // Filters
        const messageFilter = document.getElementById('message-filter');
        const timeFilter = document.getElementById('time-filter');
        const searchInput = document.getElementById('search-messages');
        
        if (messageFilter) {
            messageFilter.addEventListener('change', () => {
                this.currentFilter = messageFilter.value;
                this.currentPage = 1;
                this.loadMessages();
            });
        }
        
        if (timeFilter) {
            timeFilter.addEventListener('change', () => {
                this.currentTimeFilter = timeFilter.value;
                this.currentPage = 1;
                this.loadMessages();
            });
        }
        
        if (searchInput) {
            // Debounce search input
            let searchTimeout;
            searchInput.addEventListener('input', () => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    this.currentSearchQuery = searchInput.value.trim();
                    this.currentPage = 1;
                    this.loadMessages();
                }, 500);
            });
        }
        
        // Pagination
        const prevBtn = document.getElementById('prev-page');
        const nextBtn = document.getElementById('next-page');
        
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                if (this.currentPage > 1) {
                    this.currentPage--;
                    this.loadMessages();
                }
            });
        }
        
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                this.currentPage++;
                this.loadMessages();
            });
        }
        
        // Delete confirmation modal
        const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
        if (confirmDeleteBtn) {
            confirmDeleteBtn.addEventListener('click', () => this.confirmDeleteMessage());
        }
    }
    
    checkAuthStatus() {
        const token = localStorage.getItem('trollbox_admin_token');
        const tokenExpiry = localStorage.getItem('trollbox_admin_token_expiry');
        
        if (token && tokenExpiry && Date.now() < parseInt(tokenExpiry)) {
            this.adminToken = token;
            this.isAuthenticated = true;
            this.showDashboard();
        } else {
            this.clearAuthData();
            this.showLogin();
        }
    }
    
    async handleLogin() {
        const passwordInput = document.getElementById('admin-password');
        const loginBtn = document.getElementById('login-btn');
        const loginSpinner = document.getElementById('login-spinner');
        const loginText = loginBtn.querySelector('.login-text');
        
        if (!passwordInput) return;
        
        const password = passwordInput.value.trim();
        if (!password) {
            this.showLoginError('Please enter a password');
            return;
        }
        
        // Show loading state
        loginBtn.disabled = true;
        loginSpinner.style.display = 'inline-block';
        loginText.textContent = 'Verifying...';
        
        try {
            // Hash the password client-side
            const hashedPassword = await this.hashPassword(password);
            
            // Verify password by attempting to create an admin session in Firebase
            const isValid = await this.verifyAdminPassword(hashedPassword);
            
            if (isValid) {
                // Create admin token and session
                this.adminToken = this.generateAdminToken();
                this.isAuthenticated = true;
                
                // Store token with expiry (1 hour)
                const expiryTime = Date.now() + (60 * 60 * 1000);
                localStorage.setItem('trollbox_admin_token', this.adminToken);
                localStorage.setItem('trollbox_admin_token_expiry', expiryTime.toString());
                
                this.showDashboard();
                this.clearLoginError();
                passwordInput.value = '';
            } else {
                this.showLoginError('Invalid admin password');
            }
        } catch (error) {
            console.error('❌ Login error:', error);
            this.showLoginError('Login failed. Please try again.');
        } finally {
            // Reset button state
            loginBtn.disabled = false;
            loginSpinner.style.display = 'none';
            loginText.textContent = 'Login';
        }
    }
    
    async hashPassword(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    
    async verifyAdminPassword(hashedPassword) {
        try {
            // Create a test admin session document to verify Firebase rules
            // The Firebase rules will validate the password hash
            const adminSessionData = {
                passwordHash: hashedPassword,
                timestamp: Date.now(),
                isAdminVerification: true
            };
            
            // Try to write to admin_sessions collection
            // Firebase rules will only allow this if password is correct
            const adminSessionRef = this.db.collection('admin_sessions').doc('verification_' + Date.now());
            await adminSessionRef.set(adminSessionData);
            
            // If we get here, password was correct
            // Clean up the verification document
            await adminSessionRef.delete();
            
            return true;
        } catch (error) {
            console.error('Admin verification failed:', error);
            // If permission denied, it means wrong password
            return error.code !== 'permission-denied';
        }
    }
    
    generateAdminToken() {
        return 'admin_' + Math.random().toString(36).substr(2, 20) + '_' + Date.now();
    }
    
    showLogin() {
        const loginContainer = document.getElementById('login-container');
        const dashboard = document.getElementById('admin-dashboard');
        
        if (loginContainer) loginContainer.style.display = 'block';
        if (dashboard) dashboard.style.display = 'none';
    }
    
    showDashboard() {
        const loginContainer = document.getElementById('login-container');
        const dashboard = document.getElementById('admin-dashboard');
        
        if (loginContainer) loginContainer.style.display = 'none';
        if (dashboard) dashboard.style.display = 'block';
        
        // Load dashboard data
        this.loadStatistics();
        this.loadMessages();
    }
    
    logout() {
        this.clearAuthData();
        this.isAuthenticated = false;
        this.adminToken = null;
        this.showLogin();
    }
    
    clearAuthData() {
        localStorage.removeItem('trollbox_admin_token');
        localStorage.removeItem('trollbox_admin_token_expiry');
    }
    
    showLoginError(message) {
        const errorDiv = document.getElementById('login-error');
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
        }
    }
    
    clearLoginError() {
        const errorDiv = document.getElementById('login-error');
        if (errorDiv) {
            errorDiv.style.display = 'none';
        }
    }
    
    showError(message) {
        const errorDiv = document.getElementById('admin-message-error');
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
            setTimeout(() => {
                errorDiv.style.display = 'none';
            }, 5000);
        }
    }
    
    showSuccess(message) {
        const successDiv = document.getElementById('admin-message-success');
        if (successDiv) {
            successDiv.textContent = message;
            successDiv.style.display = 'block';
            setTimeout(() => {
                successDiv.style.display = 'none';
            }, 3000);
        }
    }
    
    updateCharCount() {
        const input = document.getElementById('admin-message-input');
        const counter = document.getElementById('char-count');
        
        if (input && counter) {
            counter.textContent = input.value.length;
        }
    }
    
    async sendAdminMessage() {
        const input = document.getElementById('admin-message-input');
        const sendBtn = document.getElementById('admin-send-btn');
        
        if (!input || !this.isAuthenticated) return;
        
        const message = input.value.trim();
        if (!message) return;
        
        if (message.length > 500) {
            this.showError('Message too long (max 500 characters)');
            return;
        }
        
        sendBtn.disabled = true;
        
        try {
            // Create admin message object
            const adminMessage = {
                text: message,
                author: 'Admin',
                authorAddress: 'admin',
                timestamp: window.firebase.firestore.FieldValue.serverTimestamp(),
                isAdmin: true,
                adminToken: this.adminToken
            };
            
            // Send to Firestore
            await this.messagesRef.add(adminMessage);
            
            // Clear input and show success
            input.value = '';
            this.updateCharCount();
            this.showSuccess('Admin message sent successfully!');
            
            // Refresh messages list
            setTimeout(() => this.loadMessages(), 1000);
            
        } catch (error) {
            console.error('❌ Failed to send admin message:', error);
            
            if (error.code === 'permission-denied') {
                this.showError('Admin permission denied. Please log in again.');
                this.logout();
            } else {
                this.showError('Failed to send message. Please try again.');
            }
        } finally {
            sendBtn.disabled = false;
        }
    }
    
    async loadStatistics() {
        try {
            const now = Date.now();
            const todayStart = new Date().setHours(0, 0, 0, 0);
            
            // Get total messages count
            const totalSnapshot = await this.messagesRef.get();
            const totalMessages = totalSnapshot.size;
            
            // Get messages today
            const todaySnapshot = await this.messagesRef
                .where('timestamp', '>=', new Date(todayStart))
                .get();
            const messagesToday = todaySnapshot.size;
            
            // Get admin messages count
            const adminSnapshot = await this.messagesRef
                .where('isAdmin', '==', true)
                .get();
            const adminMessages = adminSnapshot.size;
            
            // Get online users from presence
            let onlineUsers = 0;
            if (this.presenceRef) {
                const presenceSnapshot = await this.presenceRef
                    .where('lastSeen', '>', now - 120000) // Active in last 2 minutes
                    .get();
                onlineUsers = presenceSnapshot.size;
            }
            
            // Update UI
            this.updateStatistics({
                totalMessages,
                onlineUsers,
                messagesToday,
                adminMessages
            });
            
        } catch (error) {
            console.error('❌ Failed to load statistics:', error);
        }
    }
    
    updateStatistics(stats) {
        const elements = {
            'total-messages': stats.totalMessages,
            'online-users': stats.onlineUsers,
            'messages-today': stats.messagesToday,
            'admin-messages': stats.adminMessages
        };
        
        Object.entries(elements).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value;
            }
        });
    }
    
    async loadMessages() {
        const loadingDiv = document.getElementById('messages-loading');
        const container = document.getElementById('messages-container');
        
        if (loadingDiv) loadingDiv.style.display = 'block';
        if (container) container.innerHTML = '';
        
        try {
            let query = this.messagesRef.orderBy('timestamp', 'desc');
            
            // Only apply time filter if we're not filtering by admin to avoid composite index requirement
            if (this.currentTimeFilter !== 'all' && this.currentFilter !== 'admin') {
                const timeMs = this.getTimeFilterMs(this.currentTimeFilter);
                const cutoffTime = new Date(Date.now() - timeMs);
                query = query.where('timestamp', '>=', cutoffTime);
            }
            
            // Apply message type filter
            if (this.currentFilter === 'admin') {
                query = query.where('isAdmin', '==', true);
            }
            // Note: For 'user' filter, we'll filter client-side since user messages 
            // might not have the isAdmin field at all
            
            // Get messages with pagination - increase limit if doing client-side time filtering
            const queryLimit = (this.currentFilter === 'admin' && this.currentTimeFilter !== 'all') 
                ? this.messagesPerPage * this.currentPage * 3  // Get more to account for time filtering
                : this.messagesPerPage * this.currentPage;
            
            const snapshot = await query.limit(queryLimit).get();
            
            let messages = [];
            snapshot.forEach(doc => {
                const message = {
                    id: doc.id,
                    ...doc.data()
                };
                messages.push(message);
            });
            
            // Apply client-side time filtering for admin messages if needed
            if (this.currentFilter === 'admin' && this.currentTimeFilter !== 'all') {
                const timeMs = this.getTimeFilterMs(this.currentTimeFilter);
                const cutoffTime = Date.now() - timeMs;
                messages = messages.filter(msg => {
                    const messageTime = msg.timestamp ? 
                        (msg.timestamp.toDate ? msg.timestamp.toDate().getTime() : msg.timestamp.seconds * 1000) :
                        Date.now();
                    return messageTime >= cutoffTime;
                });
            }
            
            // Apply client-side filtering for user messages
            if (this.currentFilter === 'user') {
                // Filter for messages that are NOT admin messages
                messages = messages.filter(msg => !msg.isAdmin);
            }
            
            // Apply text search filter (client-side for simplicity)
            if (this.currentSearchQuery) {
                messages = messages.filter(msg => 
                    msg.text.toLowerCase().includes(this.currentSearchQuery.toLowerCase()) ||
                    msg.author.toLowerCase().includes(this.currentSearchQuery.toLowerCase())
                );
            }
            
            // Get messages for current page
            const startIndex = (this.currentPage - 1) * this.messagesPerPage;
            const endIndex = startIndex + this.messagesPerPage;
            const pageMessages = messages.slice(startIndex, endIndex);
            
            this.displayMessages(pageMessages);
            this.updatePagination(messages.length);
            
        } catch (error) {
            console.error('❌ Failed to load messages:', error);
            if (container) {
                container.innerHTML = '<div class="alert alert-danger">Failed to load messages. Please try again.</div>';
            }
        } finally {
            if (loadingDiv) loadingDiv.style.display = 'none';
        }
    }
    
    getTimeFilterMs(filter) {
        switch (filter) {
            case '24h': return 24 * 60 * 60 * 1000;
            case '7d': return 7 * 24 * 60 * 60 * 1000;
            case '30d': return 30 * 24 * 60 * 60 * 1000;
            default: return 0;
        }
    }
    
    displayMessages(messages) {
        const container = document.getElementById('messages-container');
        if (!container) return;
        
        if (messages.length === 0) {
            container.innerHTML = '<div class="text-muted text-center py-4">No messages found.</div>';
            return;
        }
        
        container.innerHTML = '';
        
        messages.forEach(message => {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message-item ${message.isAdmin ? 'admin-message' : ''}`;
            
            const timestamp = message.timestamp ? 
                (message.timestamp.toDate ? message.timestamp.toDate() : new Date(message.timestamp.seconds * 1000)) :
                new Date();
            
            const timeString = timestamp.toLocaleString();
            
            // Prepare reactions display
            const reactionsHtml = this.renderReactionsForAdmin(message.reactions || {});
            
            messageDiv.innerHTML = `
                <div class="message-header">
                    <span class="message-author ${message.isAdmin ? 'admin' : ''}">
                        ${message.author}
                    </span>
                    <span class="message-time">${timeString}</span>
                    <div class="message-actions">
                        <button class="delete-btn" onclick="trollboxAdmin.showDeleteModal('${message.id}', '${message.text.replace(/'/g, "&apos;")}', '${message.author}')">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="message-content">${this.sanitizeMessage(message.text)}</div>
                ${reactionsHtml ? `<div class="admin-reactions">${reactionsHtml}</div>` : ''}
            `;
            
            container.appendChild(messageDiv);
        });
    }
    
    renderReactionsForAdmin(reactions) {
        if (!reactions || Object.keys(reactions).length === 0) {
            return '';
        }
        
        const emojiMap = {
            'thumbs_up': '👍',
            'thumbs_down': '👎',
            'laugh': '😂',
            'fire': '🔥',
            'cry': '😢',
            'thinking': '🤔'
        };
        
        const reactionElements = [];
        
        Object.entries(reactions).forEach(([emojiName, reactionData]) => {
            if (reactionData && reactionData.count > 0) {
                const emoji = emojiMap[emojiName] || '❓';
                const usersList = reactionData.users ? 
                    reactionData.users.map(addr => this.shortenAddress(addr)).join(', ') : 
                    '';
                
                reactionElements.push(`
                    <span class="admin-reaction-item" title="${emojiName}: ${usersList}">
                        ${emoji} ${reactionData.count}
                    </span>
                `);
            }
        });
        
        return reactionElements.join('');
    }
    
    shortenAddress(address) {
        if (!address || address === 'admin') return address;
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }
    
    updatePagination(totalMessages) {
        const totalPages = Math.ceil(totalMessages / this.messagesPerPage);
        const prevBtn = document.getElementById('prev-page');
        const nextBtn = document.getElementById('next-page');
        const pageInfo = document.getElementById('page-info');
        const paginationControls = document.getElementById('pagination-controls');
        
        if (totalPages > 1) {
            if (paginationControls) paginationControls.style.display = 'flex';
            
            if (prevBtn) {
                prevBtn.disabled = this.currentPage <= 1;
            }
            
            if (nextBtn) {
                nextBtn.disabled = this.currentPage >= totalPages;
            }
            
            if (pageInfo) {
                pageInfo.textContent = `Page ${this.currentPage} of ${totalPages}`;
            }
        } else {
            if (paginationControls) paginationControls.style.display = 'none';
        }
    }
    
    sanitizeMessage(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    showDeleteModal(messageId, messageText, author) {
        this.messageToDelete = messageId;
        
        const modal = new bootstrap.Modal(document.getElementById('delete-modal'));
        const preview = document.getElementById('delete-message-preview');
        
        if (preview) {
            preview.innerHTML = `
                <div class="message-item">
                    <div class="message-header">
                        <span class="message-author">${author}</span>
                    </div>
                    <div class="message-content">${this.sanitizeMessage(messageText)}</div>
                </div>
            `;
        }
        
        modal.show();
    }
    
    async confirmDeleteMessage() {
        if (!this.messageToDelete || !this.isAuthenticated) return;
        
        const confirmBtn = document.getElementById('confirm-delete-btn');
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Deleting...';
        
        try {
            // Create deletion record with admin token
            const deletionData = {
                messageId: this.messageToDelete,
                adminToken: this.adminToken,
                timestamp: window.firebase.firestore.FieldValue.serverTimestamp(),
                action: 'delete'
            };
            
            // Add to admin_actions collection (Firebase rules will validate and delete the message)
            await this.db.collection('admin_actions').add(deletionData);
            
            // Also directly delete the message
            await this.messagesRef.doc(this.messageToDelete).delete();
            
            this.showSuccess('Message deleted successfully!');
            
            // Close modal and refresh messages
            const modal = bootstrap.Modal.getInstance(document.getElementById('delete-modal'));
            modal.hide();
            
            setTimeout(() => this.loadMessages(), 1000);
            
        } catch (error) {
            console.error('❌ Failed to delete message:', error);
            
            if (error.code === 'permission-denied') {
                this.showError('Admin permission denied. Please log in again.');
                this.logout();
            } else {
                this.showError('Failed to delete message. Please try again.');
            }
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<i class="bi bi-trash"></i> Delete Message';
        }
        
        this.messageToDelete = null;
    }
}

// Initialize admin interface when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.trollboxAdmin = new TrollboxAdmin();
});

// Make sure functions are available globally for onclick handlers
window.trollboxAdmin = null; 
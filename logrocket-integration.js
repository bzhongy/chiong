/**
 * LogRocket Integration for Odette
 * 
 * Automatically associates wallet addresses with LogRocket sessions
 * and tracks wallet-related context for better debugging
 */

class LogRocketIntegration {
    constructor() {
        this.currentAddress = null;
        this.currentWalletType = null;
        this.sessionStartTime = Date.now();
        
        // Check if LogRocket is available
        if (!window.LogRocket) {
            console.warn('LogRocket not available - integration disabled');
            return;
        }
        
        this.init();
    }
    
    init() {
        // Listen for wallet connection events (same as trollbox)
        document.addEventListener('walletConnected', (event) => {
            this.onWalletConnected(event.detail);
        });
        
        document.addEventListener('walletDisconnected', () => {
            this.onWalletDisconnected();
        });
        
        // Check if wallet is already connected on page load
        this.checkInitialWalletConnection();
        
        // Set up periodic checking (same as trollbox)
        this.walletCheckInterval = setInterval(() => {
            this.checkWalletConnection();
        }, 5000); // Check every 5 seconds
        
        // Track basic session info
        this.trackSessionInfo();
    }
    
    checkInitialWalletConnection() {
        // Check if wallet is already connected using global state
        const isConnected = window.state && window.state.connectedAddress;
        if (isConnected) {
            this.onWalletConnected({
                address: window.state.connectedAddress,
                isQuickWallet: this.isQuickWallet()
            });
        }
    }
    
    checkWalletConnection() {
        // Check global state for connected wallet
        const isConnected = window.state && window.state.connectedAddress;
        const currentAddress = isConnected ? window.state.connectedAddress : null;
        
        // Check if connection status changed
        if (isConnected && !this.currentAddress) {
            // Wallet just connected
            this.onWalletConnected({
                address: currentAddress,
                isQuickWallet: this.isQuickWallet()
            });
        } else if (!isConnected && this.currentAddress) {
            // Wallet just disconnected
            this.onWalletDisconnected();
        } else if (isConnected && this.currentAddress && currentAddress !== this.currentAddress) {
            // Wallet address changed
            this.onWalletConnected({
                address: currentAddress,
                isQuickWallet: this.isQuickWallet()
            });
        }
    }
    
    isQuickWallet() {
        // Check if using in-browser wallet
        return window.activeWalletType === 'in-browser' || 
               (window.ethereumClientInstance && 
                window.ethereumClientInstance.getAccount && 
                window.ethereumClientInstance.getAccount().connector && 
                window.ethereumClientInstance.getAccount().connector.id === 'in-browser');
    }
    
    onWalletConnected(walletInfo) {
        this.currentAddress = walletInfo.address;
        this.currentWalletType = walletInfo.isQuickWallet ? 'quick_wallet' : 'external_wallet';
        
        // Identify user with LogRocket
        try {
            window.LogRocket.identify(walletInfo.address, {
                wallet_address: walletInfo.address,
                wallet_type: this.currentWalletType,
                short_address: this.shortenAddress(walletInfo.address),
                is_quick_wallet: walletInfo.isQuickWallet || false,
                connection_time: new Date().toISOString(),
                session_duration: Date.now() - this.sessionStartTime,
                network: 'base', // Since you're on Base network
                platform: 'odette_fi'
            });
            
            console.log('🔍 LogRocket: User identified -', this.shortenAddress(walletInfo.address));
            
            // Track wallet connection event
            window.LogRocket.track('Wallet Connected', {
                wallet_type: this.currentWalletType,
                is_quick_wallet: walletInfo.isQuickWallet || false,
                address: walletInfo.address
            });
            
        } catch (error) {
            console.error('LogRocket identify failed:', error);
        }
    }
    
    onWalletDisconnected() {
        if (this.currentAddress) {
            try {
                // Track disconnection event with previous wallet info
                window.LogRocket.track('Wallet Disconnected', {
                    previous_wallet_type: this.currentWalletType,
                    previous_address: this.currentAddress,
                    session_duration: Date.now() - this.sessionStartTime
                });
                
                console.log('🔍 LogRocket: Wallet disconnected -', this.shortenAddress(this.currentAddress));
                
            } catch (error) {
                console.error('LogRocket track disconnect failed:', error);
            }
        }
        
        // Reset to anonymous session
        this.currentAddress = null;
        this.currentWalletType = null;
        
        try {
            // Create anonymous session
            window.LogRocket.identify(null, {
                status: 'anonymous',
                disconnection_time: new Date().toISOString(),
                platform: 'odette_fi'
            });
        } catch (error) {
            console.error('LogRocket anonymous identify failed:', error);
        }
    }
    
    trackSessionInfo() {
        try {
            // Track basic session information
            window.LogRocket.track('Session Started', {
                url: window.location.href,
                user_agent: navigator.userAgent,
                viewport_width: window.innerWidth,
                viewport_height: window.innerHeight,
                timestamp: new Date().toISOString(),
                platform: 'odette_fi'
            });
        } catch (error) {
            console.error('LogRocket session tracking failed:', error);
        }
    }
    
    // Helper method to flatten objects for LogRocket (only supports primitives)
    flattenObject(obj, prefix = '') {
        const flattened = {};
        
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const value = obj[key];
                const newKey = prefix ? `${prefix}_${key}` : key;
                
                if (value === null || value === undefined) {
                    flattened[newKey] = String(value);
                } else if (typeof value === 'object' && !Array.isArray(value)) {
                    // Recursively flatten nested objects
                    Object.assign(flattened, this.flattenObject(value, newKey));
                } else if (Array.isArray(value)) {
                    // Handle arrays - LogRocket supports primitive arrays
                    if (value.length > 0 && typeof value[0] === 'object') {
                        // Convert object arrays to JSON strings
                        flattened[newKey] = JSON.stringify(value);
                    } else {
                        // Keep primitive arrays as-is
                        flattened[newKey] = value;
                    }
                } else {
                    // Keep primitive values
                    flattened[newKey] = value;
                }
            }
        }
        
        return flattened;
    }

    // Helper method to track trading actions
    trackTradingAction(action, data = {}) {
        if (!window.LogRocket || !this.currentAddress) return;
        
        try {
            const baseData = {
                wallet_address: this.currentAddress,
                wallet_type: this.currentWalletType,
                timestamp: new Date().toISOString()
            };
            
            // Flatten the data to avoid nested object issues
            const flattenedData = this.flattenObject({ ...baseData, ...data });
            
            window.LogRocket.track(`Trading: ${action}`, flattenedData);
        } catch (error) {
            console.error('LogRocket trading track failed:', error);
        }
    }
    
    // Helper method to track errors with wallet context
    trackError(error, context = {}) {
        if (!window.LogRocket) return;
        
        try {
            const baseData = {
                error_message: error.message,
                error_stack: error.stack,
                wallet_address: this.currentAddress,
                wallet_type: this.currentWalletType,
                wallet_connected: !!this.currentAddress,
                timestamp: new Date().toISOString()
            };
            
            // Flatten the context to avoid nested object issues
            const flattenedData = this.flattenObject({ ...baseData, ...context });
            
            window.LogRocket.track('JavaScript Error', flattenedData);
        } catch (logError) {
            console.error('LogRocket error tracking failed:', logError);
        }
    }
    
    shortenAddress(address) {
        if (!address) return 'Anonymous';
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }
    
    // Cleanup method
    destroy() {
        if (this.walletCheckInterval) {
            clearInterval(this.walletCheckInterval);
        }
    }
}

// Initialize LogRocket integration
let logRocketIntegration = null;

document.addEventListener('DOMContentLoaded', () => {
    // Wait a bit for other systems to initialize
    setTimeout(() => {
        logRocketIntegration = new LogRocketIntegration();
        
        // Make it globally available for other scripts to use
        window.logRocketIntegration = logRocketIntegration;
        
        console.log('🔍 LogRocket integration initialized');
    }, 1000);
});

// Global error handler to capture JavaScript errors with wallet context
window.addEventListener('error', (event) => {
    if (logRocketIntegration && event.error) {
        logRocketIntegration.trackError(event.error, {
            source: 'global_error_handler',
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno
        });
    }
});

// Promise rejection handler
window.addEventListener('unhandledrejection', (event) => {
    if (logRocketIntegration && event.reason) {
        const error = event.reason instanceof Error ? event.reason : new Error(event.reason);
        logRocketIntegration.trackError(error, {
            source: 'unhandled_promise_rejection'
        });
    }
});

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LogRocketIntegration;
} 
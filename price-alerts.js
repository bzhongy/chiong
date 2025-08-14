// Simple notification function for basic messages
function showNotification(message, type = 'info') {
    // Create notification container if it doesn't exist
    let container = document.getElementById('simple-notification-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'simple-notification-container';
        container.className = 'simple-notification-container';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            max-width: 400px;
        `;
        document.body.appendChild(container);
    }
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `alert alert-${type === 'error' ? 'danger' : type} alert-dismissible fade show mb-2`;
    notification.style.cssText = `
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        border: none;
        border-radius: 8px;
        margin-bottom: 10px;
        animation: slideInRight 0.3s ease-out;
    `;
    
    // Set icon based on type
    let icon = '';
    switch (type) {
        case 'success':
            icon = '<i class="bi bi-check-circle-fill me-2"></i>';
            break;
        case 'error':
            icon = '<i class="bi bi-x-circle-fill me-2"></i>';
            break;
        case 'warning':
            icon = '<i class="bi bi-exclamation-triangle-fill me-2"></i>';
            break;
        default:
            icon = '<i class="bi bi-info-circle-fill me-2"></i>';
    }
    
    notification.innerHTML = `
        ${icon}
        <span>${message}</span>
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    // Add to container
    container.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 5000);
    
    // Add close button functionality
    const closeBtn = notification.querySelector('.btn-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            notification.remove();
        });
    }
}

// Add CSS for slide-in animation
if (!document.getElementById('simple-notification-styles')) {
    const style = document.createElement('style');
    style.id = 'simple-notification-styles';
    style.textContent = `
        @keyframes slideInRight {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
    `;
    document.head.appendChild(style);
}

// Price Alerts Management System
class PriceAlertsManager {
    constructor() {
        this.alerts = [];
        this.notificationPermission = 'default';
        this.isMonitoring = false;
        this.monitoringInterval = null;
        this.currentPrices = { ETH: 0, BTC: 0 };
        
        this.init();
    }
    
    init() {
        this.loadAlertsFromStorage();
        this.checkNotificationPermission();
        this.bindEvents();
        this.updateUI();
        this.startPriceMonitoring();
    }
    
    // Load alerts from localStorage
    loadAlertsFromStorage() {
        try {
            const stored = localStorage.getItem('priceAlerts');
            if (stored) {
                this.alerts = JSON.parse(stored);
                // Clean up expired alerts (older than 30 days)
                const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
                this.alerts = this.alerts.filter(alert => alert.createdAt > thirtyDaysAgo);
                this.saveAlertsToStorage();
            }
        } catch (error) {
            console.error('Error loading alerts from storage:', error);
            this.alerts = [];
        }
    }
    
    // Save alerts to localStorage
    saveAlertsToStorage() {
        try {
            localStorage.setItem('priceAlerts', JSON.stringify(this.alerts));
        } catch (error) {
            console.error('Error saving alerts to storage:', error);
        }
    }
    
    // Check notification permission status
    async checkNotificationPermission() {
        if ('Notification' in window) {
            this.notificationPermission = Notification.permission;
        } else {
            this.notificationPermission = 'unsupported';
        }
        this.updateNotificationStatus();
    }
    
    // Request notification permission
    async requestNotificationPermission() {
        if ('Notification' in window) {
            try {
                const permission = await Notification.requestPermission();
                this.notificationPermission = permission;
                this.updateNotificationStatus();
                return permission === 'granted';
            } catch (error) {
                console.error('Error requesting notification permission:', error);
                return false;
            }
        }
        return false;
    }
    
    // Update notification status UI
    updateNotificationStatus() {
        const statusElement = document.getElementById('notification-status');
        const statusText = document.getElementById('notification-status-text');
        const enableBtn = document.getElementById('enable-notifications-btn');
        
        if (!statusElement || !statusText || !enableBtn) return;
        
        statusElement.className = 'alert mb-3';
        
        switch (this.notificationPermission) {
            case 'granted':
                statusElement.classList.add('alert-success');
                statusText.textContent = 'Notifications are enabled! You\'ll receive alerts when your price targets are hit.';
                enableBtn.style.display = 'none';
                break;
                
            case 'denied':
                statusElement.classList.add('alert-danger');
                statusText.textContent = 'Notifications are blocked. Please enable them in your browser settings to receive price alerts.';
                enableBtn.style.display = 'none';
                break;
                
            case 'default':
                statusElement.classList.add('alert-warning');
                statusText.textContent = 'Notifications need permission to work. Click to enable them.';
                enableBtn.style.display = 'inline-block';
                break;
                
            case 'unsupported':
                statusElement.classList.add('alert-secondary');
                statusText.textContent = 'Your browser doesn\'t support notifications.';
                enableBtn.style.display = 'none';
                break;
        }
    }
    
    // Bind event listeners
    bindEvents() {
        // Bell button to open modal
        const bellBtn = document.getElementById('price-alert-btn');
        if (bellBtn) {
            bellBtn.addEventListener('click', () => this.openAlertModal());
        }
        
        // Enable notifications button
        const enableBtn = document.getElementById('enable-notifications-btn');
        if (enableBtn) {
            enableBtn.addEventListener('click', () => this.requestNotificationPermission());
        }
        
        // Test notification button
        const testBtn = document.getElementById('test-notification-btn');
        if (testBtn) {
            testBtn.addEventListener('click', () => this.sendTestNotification());
        }
        
        // Create alert button
        const createBtn = document.getElementById('create-alert-btn');
        if (createBtn) {
            createBtn.addEventListener('click', () => this.createAlert());
        }
        
        // Asset selector change - update current price display
        const assetSelector = document.getElementById('alert-asset');
        if (assetSelector) {
            assetSelector.addEventListener('change', () => this.updateCurrentPriceDisplay());
        }
        
        // Listen for asset changes in main app
        document.addEventListener('assetChanged', (event) => {
            this.updateCurrentPriceDisplay();
        });
        
        // Listen for price updates from main app
        document.addEventListener('priceUpdated', (event) => {
            if (event.detail) {
                this.currentPrices[event.detail.asset] = event.detail.price;
                this.updateCurrentPriceDisplay();
                this.checkAlerts();
            }
        });
    }
    
    // Open the alert modal
    openAlertModal() {
        const modal = new bootstrap.Modal(document.getElementById('price-alert-modal'));
        modal.show();
        
        // Update current price when modal opens
        this.updateCurrentPriceDisplay();
        this.updateActiveAlertsList();
    }
    
    // Update current price display in modal
    updateCurrentPriceDisplay() {
        const assetSelector = document.getElementById('alert-asset');
        const priceDisplay = document.getElementById('current-price-in-modal');
        const assetDisplay = document.getElementById('current-asset-price-display');
        
        if (!assetSelector || !priceDisplay || !assetDisplay) return;
        
        const selectedAsset = assetSelector.value;
        const currentPrice = this.currentPrices[selectedAsset] || 0;
        
        assetDisplay.textContent = selectedAsset;
        priceDisplay.textContent = currentPrice.toLocaleString();
        
        // Update placeholder for alert price
        const alertPriceInput = document.getElementById('alert-price');
        if (alertPriceInput) {
            alertPriceInput.placeholder = currentPrice.toString();
        }
    }
    
    // Send test notification
    async sendTestNotification() {
        if (this.notificationPermission !== 'granted') {
            const granted = await this.requestNotificationPermission();
            if (!granted) {
                showNotification('Please enable notifications to receive price alerts.', 'warning');
                return;
            }
        }
        
        try {
            const notification = new Notification('Chiong.fi Price Alert Test', {
                body: 'This is how your price alerts will appear!',
                icon: 'img/chiong.png',
                badge: 'img/chiong.png',
                tag: 'test-alert',
                requireInteraction: false
            });
            
            notification.onclick = () => {
                window.focus();
                notification.close();
            };
            
            // Auto-close after 5 seconds
            setTimeout(() => notification.close(), 5000);
            
        } catch (error) {
            console.error('Error sending test notification:', error);
            showNotification('Error sending test notification. Please check your browser settings.', 'error');
        }
    }
    
    // Create new alert
    createAlert() {
        const asset = document.getElementById('alert-asset').value;
        const direction = document.getElementById('alert-direction').value;
        const priceInput = document.getElementById('alert-price');
        const messageInput = document.getElementById('alert-message');
        
        if (!priceInput.value || isNaN(priceInput.value) || parseFloat(priceInput.value) <= 0) {
            showNotification('Please enter a valid target price.', 'error');
            priceInput.focus();
            return;
        }
        
        const targetPrice = parseFloat(priceInput.value);
        const currentPrice = this.currentPrices[asset] || 0;
        
        // Validate alert makes sense
        if (direction === 'above' && targetPrice <= currentPrice) {
            if (!confirm(`Target price ($${targetPrice.toLocaleString()}) is not above current price ($${currentPrice.toLocaleString()}). Create anyway?`)) {
                return;
            }
        } else if (direction === 'below' && targetPrice >= currentPrice) {
            if (!confirm(`Target price ($${targetPrice.toLocaleString()}) is not below current price ($${currentPrice.toLocaleString()}). Create anyway?`)) {
                return;
            }
        }
        
        const alert = {
            id: Date.now() + Math.random(),
            asset: asset,
            direction: direction,
            targetPrice: targetPrice,
            currentPriceAtCreation: currentPrice,
            message: messageInput.value || `${asset} ${direction === 'above' ? 'rose above' : 'fell below'} $${targetPrice.toLocaleString()}!`,
            createdAt: Date.now(),
            triggered: false
        };
        
        this.alerts.push(alert);
        this.saveAlertsToStorage();
        this.updateUI();
        this.updateActiveAlertsList();
        
        // Clear form
        priceInput.value = '';
        messageInput.value = '';
        
        // Show success message
        this.showAlertCreatedFeedback(alert);
    }
    
    // Show feedback when alert is created
    showAlertCreatedFeedback(alert) {
        const feedback = document.createElement('div');
        feedback.className = 'alert alert-success alert-dismissible fade show mt-2';
        feedback.innerHTML = `
            <i class="bi bi-check-circle-fill me-2"></i>
            <strong>Alert Created!</strong> You'll be notified when ${alert.asset} goes ${alert.direction} $${alert.targetPrice.toLocaleString()}.
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;
        
        const createSection = document.querySelector('.create-alert-section');
        if (createSection) {
            createSection.appendChild(feedback);
            
            // Auto-remove after 5 seconds
            setTimeout(() => {
                if (feedback.parentNode) {
                    feedback.remove();
                }
            }, 5000);
        }
    }
    
    // Update active alerts list in modal
    updateActiveAlertsList() {
        const listContainer = document.getElementById('active-alerts-list');
        if (!listContainer) return;
        
        const activeAlerts = this.alerts.filter(alert => !alert.triggered);
        
        if (activeAlerts.length === 0) {
            listContainer.innerHTML = '<div class="text-muted">No active alerts</div>';
            return;
        }
        
        listContainer.innerHTML = activeAlerts.map(alert => `
            <div class="alert-item card mb-2">
                <div class="card-body py-2">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <strong>${alert.asset}</strong> 
                            ${alert.direction === 'above' ? '📈' : '📉'} 
                            ${alert.direction} $${alert.targetPrice.toLocaleString()}
                            <br>
                            <small class="text-muted">
                                Created ${new Date(alert.createdAt).toLocaleDateString()} at $${alert.currentPriceAtCreation.toLocaleString()}
                            </small>
                        </div>
                        <button class="btn btn-sm btn-outline-danger" onclick="priceAlertsManager.removeAlert('${alert.id}')">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `).join('');
    }
    
    // Remove alert
    removeAlert(alertId) {
        this.alerts = this.alerts.filter(alert => alert.id != alertId);
        this.saveAlertsToStorage();
        this.updateUI();
        this.updateActiveAlertsList();
    }
    
    // Update UI elements (bell button badge)
    updateUI() {
        const activeCount = this.alerts.filter(alert => !alert.triggered).length;
        const badge = document.getElementById('active-alerts-count');
        
        if (badge) {
            if (activeCount > 0) {
                badge.textContent = activeCount;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }
        
        // Update bell button appearance
        const bellBtn = document.getElementById('price-alert-btn');
        if (bellBtn) {
            if (activeCount > 0) {
                bellBtn.classList.remove('btn-outline-warning');
                bellBtn.classList.add('btn-warning');
            } else {
                bellBtn.classList.remove('btn-warning');
                bellBtn.classList.add('btn-outline-warning');
            }
        }
    }
    
    // Start monitoring prices
    startPriceMonitoring() {
        if (this.isMonitoring) return;
        
        this.isMonitoring = true;
        
        // Check alerts every 30 seconds
        this.monitoringInterval = setInterval(() => {
            this.checkAlerts();
        }, 30000);
        
        console.log('Price alert monitoring started');
    }
    
    // Stop monitoring prices
    stopPriceMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
            this.isMonitoring = false;
            console.log('Price alert monitoring stopped');
        }
    }
    
    // Check if any alerts should be triggered
    checkAlerts() {
        const activeAlerts = this.alerts.filter(alert => !alert.triggered);
        
        activeAlerts.forEach(alert => {
            const currentPrice = this.currentPrices[alert.asset];
            if (!currentPrice) return;
            
            let shouldTrigger = false;
            
            if (alert.direction === 'above' && currentPrice >= alert.targetPrice) {
                shouldTrigger = true;
            } else if (alert.direction === 'below' && currentPrice <= alert.targetPrice) {
                shouldTrigger = true;
            }
            
            if (shouldTrigger) {
                this.triggerAlert(alert, currentPrice);
            }
        });
    }
    
    // Trigger an alert
    async triggerAlert(alert, currentPrice) {
        console.log('Triggering alert:', alert);
        
        // Mark as triggered
        alert.triggered = true;
        alert.triggeredAt = Date.now();
        alert.triggeredPrice = currentPrice;
        
        // Save updated alerts
        this.saveAlertsToStorage();
        this.updateUI();
        
        // Send notification if permission granted
        if (this.notificationPermission === 'granted') {
            try {
                const notification = new Notification(`Chiong.fi - ${alert.asset} Price Alert!`, {
                    body: `${alert.message}\nCurrent price: $${currentPrice.toLocaleString()}`,
                    icon: 'img/chiong.png',
                    badge: 'img/chiong.png',
                    tag: `price-alert-${alert.id}`,
                    requireInteraction: true
                });
                
                notification.onclick = () => {
                    window.focus();
                    notification.close();
                };
                
                // Auto-close after 10 seconds for price alerts
                setTimeout(() => notification.close(), 10000);
                
            } catch (error) {
                console.error('Error sending price alert notification:', error);
            }
        }
        
        // Show visual alert if tab is active
        if (!document.hidden) {
            this.showVisualAlert(alert, currentPrice);
        }
        
        // Update active alerts list if modal is open
        const modal = document.getElementById('price-alert-modal');
        if (modal && modal.classList.contains('show')) {
            this.updateActiveAlertsList();
        }
    }
    
    // Show visual alert in the app
    showVisualAlert(alert, currentPrice) {
        // Create toast-like notification
        const toast = document.createElement('div');
        toast.className = 'alert alert-success alert-dismissible fade show position-fixed';
        toast.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);';
        toast.innerHTML = `
            <div class="d-flex align-items-center">
                <i class="bi bi-bell-fill me-2"></i>
                <div>
                    <strong>Price Alert Triggered!</strong><br>
                    <small>${alert.asset} ${alert.direction} $${alert.targetPrice.toLocaleString()} (now $${currentPrice.toLocaleString()})</small>
                </div>
                <button type="button" class="btn-close ms-auto" data-bs-dismiss="alert"></button>
            </div>
        `;
        
        document.body.appendChild(toast);
        
        // Auto-remove after 8 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 8000);
    }
    
    // Update current prices (called from main app)
    updatePrice(asset, price) {
        this.currentPrices[asset] = price;
        this.checkAlerts();
    }
    
    // Clean up
    destroy() {
        this.stopPriceMonitoring();
    }
}

// Initialize price alerts manager when DOM is ready
let priceAlertsManager;

document.addEventListener('DOMContentLoaded', function() {
    priceAlertsManager = new PriceAlertsManager();
    
    // Make it globally accessible for button click handlers
    window.priceAlertsManager = priceAlertsManager;
});

// Export for module use if needed
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PriceAlertsManager;
} 
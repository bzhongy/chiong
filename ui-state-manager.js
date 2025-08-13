/**
 * UI State Manager
 * Handles persistence of UI states across browser sessions
 */

class UIStateManager {
    constructor() {
        this.storagePrefix = 'chiong_ui_';
        this.defaultStates = {
            trollbox_visible: true,
            trollbox_minimized: false,
            analytics_collapsed: false,
            analytics_chart_expanded: false,
            eth_wrap_collapsed: false
        };
        
        // Bind methods to maintain context
        this.saveState = this.saveState.bind(this);
        this.loadState = this.loadState.bind(this);
        this.getState = this.getState.bind(this);
        this.setState = this.setState.bind(this);
        this.resetState = this.resetState.bind(this);
    }
    
    /**
     * Save a UI state to localStorage
     * @param {string} key - The state key
     * @param {any} value - The state value
     */
    saveState(key, value) {
        try {
            const storageKey = this.storagePrefix + key;
            localStorage.setItem(storageKey, JSON.stringify(value));
        } catch (error) {
            console.warn(`Failed to save UI state ${key}:`, error);
        }
    }
    
    /**
     * Load a UI state from localStorage
     * @param {string} key - The state key
     * @param {any} defaultValue - Default value if not found
     * @returns {any} The loaded state value
     */
    loadState(key, defaultValue = null) {
        try {
            const storageKey = this.storagePrefix + key;
            const stored = localStorage.getItem(storageKey);
            
            if (stored !== null) {
                return JSON.parse(stored);
            }
            
            // Return provided default or from defaultStates
            return defaultValue !== null ? defaultValue : this.defaultStates[key];
        } catch (error) {
            console.warn(`Failed to load UI state ${key}:`, error);
            return defaultValue !== null ? defaultValue : this.defaultStates[key];
        }
    }
    
    /**
     * Get current state value (alias for loadState)
     */
    getState(key, defaultValue = null) {
        return this.loadState(key, defaultValue);
    }
    
    /**
     * Set and save state value (alias for saveState)
     */
    setState(key, value) {
        this.saveState(key, value);
    }
    
    /**
     * Reset a specific state to default
     * @param {string} key - The state key to reset
     */
    resetState(key) {
        try {
            const storageKey = this.storagePrefix + key;
            localStorage.removeItem(storageKey);
        } catch (error) {
            console.warn(`Failed to reset UI state ${key}:`, error);
        }
    }
    
    /**
     * Reset all UI states
     */
    resetAllStates() {
        try {
            // Get all localStorage keys and remove our prefixed ones
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(this.storagePrefix)) {
                    keysToRemove.push(key);
                }
            }
            
            keysToRemove.forEach(key => localStorage.removeItem(key));
        } catch (error) {
            console.warn('Failed to reset UI states:', error);
        }
    }
    
    /**
     * Get all current UI states
     */
    getAllStates() {
        const states = {};
        
        Object.keys(this.defaultStates).forEach(key => {
            states[key] = this.loadState(key);
        });
        
        return states;
    }
    
    /**
     * Initialize UI elements based on saved states
     * This should be called after DOM is ready
     */
    initializeFromSavedStates() {
        // Initialize trollbox state
        this.initializeTrollboxState();
        
        // Initialize analytics state
        this.initializeAnalyticsState();
        
        // Initialize ETH wrap state
        this.initializeEthWrapState();
    }
    
    initializeTrollboxState() {
        const visible = this.loadState('trollbox_visible', true);
        const minimized = this.loadState('trollbox_minimized', false);
        
        const widget = document.getElementById('trollbox-widget');
        const toggle = document.getElementById('trollbox-toggle');
        
        if (!widget || !toggle) {
            setTimeout(() => this.initializeTrollboxState(), 1000);
            return;
        }
        
        // Apply visibility state
        if (visible) {
            widget.classList.remove('hidden');
            toggle.style.display = 'none';
            
            // Apply minimized state
            if (minimized) {
                widget.classList.add('minimized');
            } else {
                widget.classList.remove('minimized');
            }
        } else {
            widget.classList.add('hidden');
            toggle.style.display = 'flex';
        }
        
        // Update trollbox instance states if available
        const updateTrollboxInstance = (retryCount = 0) => {
                    if (window.chiongTrollbox) {
            window.chiongTrollbox.isHidden = !visible;
            window.chiongTrollbox.isMinimized = minimized;
        } else if (retryCount < 5) {
                setTimeout(() => updateTrollboxInstance(retryCount + 1), 500 * (retryCount + 1));
            }
        };
        
        updateTrollboxInstance();
    }
    
    initializeAnalyticsState() {
        const collapsed = this.loadState('analytics_collapsed', false);
        const chartExpanded = this.loadState('analytics_chart_expanded', false);
        
        // Initialize analytics section state
        if (collapsed) {
            this.applyAnalyticsCollapsedState(true);
        }
        
        // Initialize chart expansion state with proper initialization
        if (chartExpanded) {
            this.applyAnalyticsChartExpandedState(true);
            this.initializeChartWhenReady();
        }
        
        // Update analytics manager states if available
        if (window.analyticsManager) {
            window.analyticsManager.analyticsCollapsed = collapsed;
            window.analyticsManager.chartExpanded = chartExpanded;
        }
    }
    
    initializeChartWhenReady() {
        const attemptChartInit = (retryCount = 0) => {
            if (window.analyticsManager && window.analyticsManager.initializeTradingViewChart) {
                setTimeout(() => {
                    window.analyticsManager.initializeTradingViewChart();
                    window.analyticsManager.updateLevelsLegend();
                }, 200);
            } else if (retryCount < 10) {
                setTimeout(() => attemptChartInit(retryCount + 1), 500 * (retryCount + 1));
            }
        };
        
        attemptChartInit();
    }
    
    applyAnalyticsCollapsedState(collapsed) {
        // Find the analytics content section
        const analyticsContent = document.getElementById('analytics-content');
        const toggleBtn = document.getElementById('toggle-analytics-section');
        
        if (!toggleBtn) return;
        
        if (collapsed) {
            // Hide analytics content
            if (analyticsContent) {
                analyticsContent.style.display = 'none';
            } else {
                // Fallback to individual sections
                const sections = [
                    '.support-resistance-section',
                    '.pc-ratio-dials',
                    '#analytics-status',
                    '#analytics-chart-section'
                ];
                
                sections.forEach(selector => {
                    const element = document.querySelector(selector);
                    if (element) element.style.display = 'none';
                });
            }
            
            // Update button
            toggleBtn.innerHTML = '<i class="bi bi-chevron-down"></i>';
            toggleBtn.setAttribute('title', 'Show Market Analytics');
        } else {
            // Show analytics content
            if (analyticsContent) {
                analyticsContent.style.display = '';
            } else {
                // Fallback to individual sections
                const sections = [
                    '.support-resistance-section',
                    '.pc-ratio-dials',
                    '#analytics-status',
                    '#analytics-chart-section'
                ];
                
                sections.forEach(selector => {
                    const element = document.querySelector(selector);
                    if (element) element.style.display = '';
                });
            }
            
            // Update button
            toggleBtn.innerHTML = '<i class="bi bi-chevron-up"></i>';
            toggleBtn.setAttribute('title', 'Hide Market Analytics');
        }
    }
    
    applyAnalyticsChartExpandedState(expanded) {
        const chartSection = document.getElementById('analytics-chart-section');
        const toggleBtn = document.getElementById('toggle-analytics-view');
        
        if (!chartSection || !toggleBtn) return;
        
        if (expanded) {
            chartSection.style.display = 'block';
            toggleBtn.innerHTML = '<i class="bi bi-arrows-collapse"></i>';
            toggleBtn.setAttribute('title', 'Collapse Chart View');
        } else {
            chartSection.style.display = 'none';
            toggleBtn.innerHTML = '<i class="bi bi-arrows-fullscreen"></i>';
            toggleBtn.setAttribute('title', 'Expand Chart View');
        }
    }
    
    initializeEthWrapState() {
        const collapsed = this.loadState('eth_wrap_collapsed', false);
        
        // Initialize ETH wrap section state
        if (collapsed) {
            this.applyEthWrapCollapsedState(true);
        }
    }
    
    applyEthWrapCollapsedState(collapsed) {
        const ethWrapContent = document.getElementById('eth-wrap-content');
        const toggleBtn = document.getElementById('toggle-eth-wrap-section');
        
        if (!toggleBtn) return;
        
        if (collapsed) {
            // Hide ETH wrap content
            if (ethWrapContent) {
                ethWrapContent.style.display = 'none';
            }
            
            // Update button
            toggleBtn.innerHTML = '<i class="bi bi-chevron-down"></i>';
            toggleBtn.setAttribute('title', 'Show ETH Wrapping');
        } else {
            // Show ETH wrap content
            if (ethWrapContent) {
                ethWrapContent.style.display = '';
            }
            
            // Update button
            toggleBtn.innerHTML = '<i class="bi bi-chevron-up"></i>';
            toggleBtn.setAttribute('title', 'Hide ETH Wrapping');
        }
    }
}

// Create global instance
window.uiStateManager = new UIStateManager();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // Delay initialization to ensure all other components are loaded
        setTimeout(() => {
            window.uiStateManager.initializeFromSavedStates();
        }, 500);
    });
} else {
    // DOM already ready
    setTimeout(() => {
        window.uiStateManager.initializeFromSavedStates();
    }, 500);
} 
// Main entry point for bundling all JavaScript files
// This file imports all the individual JS modules to create a single bundle

// Import all the JavaScript modules in the correct order
// Note: These will be bundled and minified to hide source code

// Core configuration and utilities
import './config.js';
import './abis.js';
import './retry-helper.js';

// State management and UI utilities  
import './ui-state-manager.js';
import './tx-notifications.js';

// Wallet and blockchain interaction
import './wallet.js';
import './kyber.js';

// Analytics and data
import './analytics.js';
import './score.js';
import './analytics-integration.js';
import './custom-chart-manager.js';

// UI components and interactions
import './ui_interactions.js';
import './option-type-filter.js';
import './trollbox.js';

// Main application logic (should be last)
import './app.js';

console.log('CHIONG application bundle loaded');

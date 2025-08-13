/**
 * CHIONG TRANSACTION NOTIFICATION SYSTEM
 * 
 * Handles transaction notifications, decoding, and history management
 * Integrates with the custom wallet.js to show user-friendly transaction updates
 */

// --- Constants ---
const TRANSACTION_STORAGE_KEY = 'chiong_transaction_history';
const MAX_STORED_TRANSACTIONS = 100;
const NOTIFICATION_DURATION = 5000; // 5 seconds
const BASESCAN_URL = 'https://basescan.org/tx/';

// --- Transaction Status Enum ---
const TX_STATUS = {
    PENDING: 'pending',
    CONFIRMED: 'confirmed', 
    FAILED: 'failed'
};

// --- Function Signatures for Decoding ---
const FUNCTION_SIGNATURES = {
    'fillOrder': {
        abi: OPTION_BOOK_ABI,
        friendlyName: 'Fill Option Order',
        description: 'Execute option trade'
    },
    'swapAndFillOrder': {
        abi: OPTION_BOOK_ABI, 
        friendlyName: 'Swap & Fill Order',
        description: 'Swap tokens and execute option trade'
    },
    'approve': {
        abi: ERC20ABI,
        friendlyName: 'Token Approval',
        description: 'Approve token spending'
    },
    'deposit': {
        abi: [{"inputs": [], "name": "deposit", "outputs": [], "stateMutability": "payable", "type": "function"}],
        friendlyName: 'Wrap ETH',
        description: 'Convert ETH to WETH'
    }
};

// --- State ---
let transactionHistory = [];
let activeNotifications = new Map();

// --- Utility Functions ---
function shortenTxHash(hash) {
    return `${hash.substring(0, 8)}...${hash.substring(hash.length - 6)}`;
}

function formatTimestamp(timestamp) {
    return new Date(timestamp).toLocaleString();
}

function getTokenSymbol(address) {
    if (!address) return 'Unknown Token';
    
    // Normalize address to lowercase for comparison
    const normalizedAddress = address.toLowerCase();
    
    const tokens = {
        '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 'USDC', // Original USDC address
        '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC', // Base mainnet USDC address
        '0x4200000000000000000000000000000000000006': 'WETH', 
        '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': 'CBBTC'
    };
    
    return tokens[normalizedAddress] || 'Unknown Token';
}

// --- Robust Transaction Status Checker ---
function isTransactionSuccessful(receipt) {
    if (!receipt) return false;
    
    // Handle different RPC response formats
    const status = receipt.status;
    
    // Handle various success formats
    if (status === 1 || status === '0x1' || status === true || status === 'success') {
        return true;
    }
    
    // Handle various failure formats
    if (status === 0 || status === '0x0' || status === false || status === 'failed') {
        return false;
    }
    
    // Log unusual status formats for debugging
    console.warn('⚠️ Unusual transaction status format:', status, 'Type:', typeof status);
    
    // Default to success if receipt exists but status is unclear
    // This helps with RPCs that have non-standard status formats
    return true;
}

// --- Clear All Notifications Function ---
function clearAllNotifications() {
    // Close all active notification elements
    activeNotifications.forEach((notification, hash) => {
        closeNotificationElement(notification);
    });
    
    // Clear the active notifications map
    activeNotifications.clear();
    
    // Update clear all button visibility immediately
    updateClearAllButtonVisibility();
    
    // Update any pending transactions to remove stuck states
    const pendingTxs = transactionHistory.filter(tx => tx.status === TX_STATUS.PENDING);
    if (pendingTxs.length > 0) {
        // Try to refresh status for recent pending transactions (last 10 minutes)
        const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
        pendingTxs
            .filter(tx => tx.timestamp > tenMinutesAgo)
            .forEach(tx => {
                // Try to get fresh status from blockchain
                checkTransactionStatusFromBlockchain(tx.hash);
            });
    }
    
    // Update dropdown
    updateTransactionDropdown();
}

// --- Refresh Pending Transactions Function ---
async function refreshPendingTransactions() {
    const transactions = getStoredTransactions();
    const pendingTransactions = transactions.filter(tx => tx.status === TX_STATUS.PENDING);
    
    if (pendingTransactions.length === 0) {
        return;
    }
    
    for (const transaction of pendingTransactions) {
        try {
            await checkTransactionStatusFromBlockchain(transaction.hash);
        } catch (error) {
            console.error('❌ Error refreshing transaction', transaction.hash, ':', error);
        }
        
        // Add a small delay between checks to avoid overwhelming the RPC
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    updateTransactionDropdown();
    updateClearAllButtonVisibility();
}

// --- Clear Transaction History Function ---
function clearTransactionHistory() {
    if (confirm('Are you sure you want to clear all transaction history? This cannot be undone.')) {
        // Clear the history array
        transactionHistory = [];
        
        // Clear from localStorage
        localStorage.removeItem(TRANSACTION_STORAGE_KEY);
        
        // Update dropdown
        updateTransactionDropdown();
    }
}

// --- Blockchain Status Checker (Fallback) ---
async function checkTransactionStatusFromBlockchain(hash) {
    try {
        // Use standardized window.ethersProvider
        const provider = window.ethersProvider;
        
        if (!provider) {
            console.error('❌ No ethersProvider available on window');
            return false;
        }
        
        // Try to get the transaction receipt
        try {
            const receipt = await provider.getTransactionReceipt(hash);
            
            if (receipt) {
                const isSuccess = isTransactionSuccessful(receipt);
                const status = isSuccess ? TX_STATUS.CONFIRMED : TX_STATUS.FAILED;
                
                updateTransactionStatus(hash, status, receipt);
                return true;
            }
        } catch (receiptError) {
            console.error('❌ Error during getTransactionReceipt:', receiptError);
            
            // Try alternative approach - get transaction first
            try {
                const tx = await provider.getTransaction(hash);
                
                if (tx && tx.blockNumber) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    const delayedReceipt = await provider.getTransactionReceipt(hash);
                    if (delayedReceipt) {
                        const isSuccess = isTransactionSuccessful(delayedReceipt);
                        const status = isSuccess ? TX_STATUS.CONFIRMED : TX_STATUS.FAILED;
                        updateTransactionStatus(hash, status, delayedReceipt);
                        return true;
                    }
                }
            } catch (txError) {
                console.error('❌ Error during getTransaction fallback:', txError);
            }
        }
        
        return false;
        
    } catch (error) {
        console.error('❌ Error checking blockchain status for', hash, ':', error);
        return false;
    }
}

// --- Transaction Storage ---
function getStoredTransactions() {
    return transactionHistory;
}

function loadTransactionHistory() {
    try {
        const stored = localStorage.getItem(TRANSACTION_STORAGE_KEY);
        transactionHistory = stored ? JSON.parse(stored) : [];
    } catch (error) {
        console.error('Error loading transaction history:', error);
        transactionHistory = [];
    }
}

function saveTransactionHistory() {
    try {
        // Keep only the most recent transactions
        if (transactionHistory.length > MAX_STORED_TRANSACTIONS) {
            transactionHistory = transactionHistory.slice(-MAX_STORED_TRANSACTIONS);
        }
        localStorage.setItem(TRANSACTION_STORAGE_KEY, JSON.stringify(transactionHistory));
    } catch (error) {
        console.error('Error saving transaction history:', error);
    }
}

function addTransaction(txData) {
    transactionHistory.unshift(txData); // Add to beginning for most recent first
    saveTransactionHistory();
    updateTransactionDropdown();
}

function updateTransaction(hash, updates) {
    const txIndex = transactionHistory.findIndex(tx => tx.hash === hash);
    if (txIndex !== -1) {
        transactionHistory[txIndex] = { ...transactionHistory[txIndex], ...updates };
        saveTransactionHistory();
        updateTransactionDropdown();
    }
}

// --- Transaction Decoding ---
function decodeFunctionCall(functionName, args, contractAddress) {
    const signature = FUNCTION_SIGNATURES[functionName];
    if (!signature) {
        return {
            functionName: functionName,
            description: 'Unknown function call',
            details: []
        };
    }

    let details = [];
    
    try {
        switch (functionName) {
            case 'fillOrder':
                if (args && args.length >= 1) {
                    const order = args[0];
                    details = [
                        `Asset: ${order.isCall ? 'CALL' : 'PUT'}`,
                        `Strike: $${ethers.utils.formatUnits(order.strikes[0], 8)}`,
                        `Expiry: ${new Date(order.expiry * 1000).toLocaleDateString()}`,
                        `Collateral: ${getTokenSymbol(order.collateral)}`
                    ];
                }
                break;
                
            case 'swapAndFillOrder':
                if (args && args.length >= 4) {
                    const order = args[0];
                    const srcToken = args[3];
                    details = [
                        `Swap: ${getTokenSymbol(srcToken)} → ${getTokenSymbol(order.collateral)}`,
                        `Asset: ${order.isCall ? 'CALL' : 'PUT'}`,
                        `Strike: $${ethers.utils.formatUnits(order.strikes[0], 8)}`
                    ];
                }
                break;
                
            case 'approve':
                if (args && args.length >= 2) {
                    const spender = args[0];
                    const amount = args[1];
                    const tokenSymbol = getTokenSymbol(contractAddress);
                    const isUnlimited = amount.toString() === ethers.constants.MaxUint256.toString();
                    
                    details = [
                        `Token: ${tokenSymbol}`,
                        `Spender: ${spender.substring(0, 8)}...${spender.substring(spender.length - 4)}`,
                        `Amount: ${isUnlimited ? 'Unlimited' : 'Limited approval'}`
                    ];
                }
                break;
                
            case 'deposit':
                details = ['Converting ETH to WETH'];
                break;
        }
    } catch (error) {
        console.error('❌ Error decoding function call:', error);
        // Fallback to basic info if decoding fails
        if (functionName === 'approve') {
            details = [`Token: ${getTokenSymbol(contractAddress)}`, 'Approving token spending'];
        }
    }

    return {
        functionName: signature.friendlyName,
        description: signature.description,
        details
    };
}

// --- Notification UI ---
function createNotificationElement(txData) {
    const notification = document.createElement('div');
    notification.className = 'tx-notification';
    notification.setAttribute('data-tx-hash', txData.hash);
    
    const statusIcon = getStatusIcon(txData.status);
    const statusClass = `status-${txData.status}`;
    
    notification.innerHTML = `
        <div class="tx-notification-content ${statusClass}">
            <div class="tx-notification-header">
                <div class="tx-notification-icon">${statusIcon}</div>
                <div class="tx-notification-title">${txData.decodedData.functionName}</div>
                <button class="tx-notification-close" type="button">&times;</button>
            </div>
            <div class="tx-notification-body">
                <div class="tx-notification-description">${txData.decodedData.description}</div>
                ${txData.decodedData.details.length > 0 ? 
                    `<div class="tx-notification-details">
                        ${txData.decodedData.details.map(detail => `<div class="detail-item">${detail}</div>`).join('')}
                    </div>` : ''
                }
                <div class="tx-notification-hash">
                    <a href="${BASESCAN_URL}${txData.hash}" target="_blank" rel="noopener noreferrer">
                        View on BaseScan: ${shortenTxHash(txData.hash)}
                    </a>
                </div>
            </div>
        </div>
    `;
    
    // Add click handler to close button that directly references this notification element
    const closeBtn = notification.querySelector('.tx-notification-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // Close this specific notification element
            closeNotificationElement(notification);
            
            // Remove from activeNotifications map
            activeNotifications.delete(txData.hash);
            
            // Update clear all button visibility
            updateClearAllButtonVisibility();
        });
    }
    
    return notification;
}

function getStatusIcon(status) {
    switch (status) {
        case TX_STATUS.PENDING:
            return '<div class="spinner-border spinner-border-sm" role="status"></div>';
        case TX_STATUS.CONFIRMED:
            return '<i class="bi bi-check-circle-fill text-success"></i>';
        case TX_STATUS.FAILED:
            return '<i class="bi bi-x-circle-fill text-danger"></i>';
        default:
            return '<i class="bi bi-clock-fill text-warning"></i>';
    }
}

function showNotification(txData) {
    // Remove existing notification for this transaction if any
    const existingNotification = activeNotifications.get(txData.hash);
    if (existingNotification) {
        closeNotificationElement(existingNotification);
        activeNotifications.delete(txData.hash);
    }
    
    const container = getNotificationContainer();
    const notification = createNotificationElement(txData);
    
    container.appendChild(notification);
    activeNotifications.set(txData.hash, notification);
    
    // Update clear all button visibility
    updateClearAllButtonVisibility();
    
    // Animate in
    requestAnimationFrame(() => {
        notification.classList.add('show');
    });
    
    // Auto-close confirmed/failed transactions after delay
    if (txData.status === TX_STATUS.CONFIRMED || txData.status === TX_STATUS.FAILED) {
        // Set timeout and store reference on the notification element
        notification.autoCloseTimeout = setTimeout(() => {
            closeNotification(txData.hash);
        }, NOTIFICATION_DURATION);
    }
}

function closeNotificationElement(notification) {
    if (!notification) return;
    
    // Clear any auto-close timeout
    if (notification.autoCloseTimeout) {
        clearTimeout(notification.autoCloseTimeout);
        notification.autoCloseTimeout = null;
    }
    
    notification.classList.add('hide');
    setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 300);
}

function closeNotification(hash) {
    const notification = activeNotifications.get(hash);
    
    if (notification) {
        closeNotificationElement(notification);
        activeNotifications.delete(hash);
        
        // Update clear all button visibility
        updateClearAllButtonVisibility();
    }
}

function getNotificationContainer() {
    let container = document.getElementById('tx-notification-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'tx-notification-container';
        container.className = 'tx-notification-container';
        
        // Add clear all button
        const clearAllButton = document.createElement('button');
        clearAllButton.id = 'clear-all-notifications-btn';
        clearAllButton.className = 'clear-all-notifications-btn';
        clearAllButton.innerHTML = '<i class="bi bi-x-circle"></i> Clear All';
        clearAllButton.title = 'Clear all notifications and reset state';
        clearAllButton.style.display = 'none'; // Hidden by default
        
        clearAllButton.addEventListener('click', (e) => {
            e.stopPropagation();
            clearAllNotifications();
        });
        
        container.appendChild(clearAllButton);
        document.body.appendChild(container);
    }
    
    // Update clear all button visibility
    updateClearAllButtonVisibility();
    
    return container;
}

function updateClearAllButtonVisibility() {
    const clearAllButton = document.getElementById('clear-all-notifications-btn');
    if (clearAllButton) {
        // Show button if there are active notifications
        clearAllButton.style.display = activeNotifications.size > 0 ? 'block' : 'none';
    }
}

// --- Transaction Dropdown ---
function createTransactionDropdown() {    
    const walletSection = document.querySelector('.wallet-section');
    if (!walletSection) {
        return;
    }
    
    // Get the existing transaction history button and dropdown from HTML
    const txButton = document.getElementById('tx-history-btn');
    const dropdown = document.getElementById('tx-history-dropdown');
    
    if (!txButton || !dropdown) {
        return;
    }

    // Check if event listeners are already attached
    if (txButton.hasAttribute('data-listeners-attached')) {
        updateTransactionDropdown();
        return;
    }
    
    // Add click handler
    txButton.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleTransactionDropdown();
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && e.target !== txButton) {
            dropdown.style.display = 'none';
        }
    });
    
    // Mark that listeners are attached
    txButton.setAttribute('data-listeners-attached', 'true');
    
    updateTransactionDropdown();
}

function toggleTransactionDropdown() {
    const dropdown = document.getElementById('tx-history-dropdown');
    if (dropdown) {
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    }
}

function updateTransactionDropdown() {
    const dropdown = document.getElementById('tx-history-dropdown');
    const button = document.getElementById('tx-history-btn');
    
    if (!dropdown || !button) return;
    
    // Update button with pending count
    const pendingCount = transactionHistory.filter(tx => tx.status === TX_STATUS.PENDING).length;
    const buttonIcon = pendingCount > 0 ? 
        `<i class="bi bi-clock-history"></i><span class="badge bg-warning text-dark">${pendingCount}</span>` :
        '<i class="bi bi-clock-history"></i>';
    button.innerHTML = buttonIcon;
    
    // Update dropdown content
    if (transactionHistory.length === 0) {
        dropdown.innerHTML = '<div class="tx-history-empty">No transactions yet</div>';
    } else {
        const recentTxs = transactionHistory.slice(0, 10); // Show last 10
        const hasActiveNotifications = activeNotifications.size > 0;
        const hasPendingTxs = pendingCount > 0;
        
        dropdown.innerHTML = `
            <div class="tx-history-header">
                <span>Recent Transactions</span>
                <div class="tx-history-actions">
                    ${hasActiveNotifications ? `
                        <button class="btn btn-sm btn-outline-danger" onclick="clearAllNotifications()" title="Clear all active notifications">
                            <i class="bi bi-x-circle"></i> Clear Notifications
                        </button>
                    ` : ''}
                    ${hasPendingTxs ? `
                        <button class="btn btn-sm btn-outline-warning" onclick="refreshPendingTransactions()" title="Refresh status of pending transactions">
                            <i class="bi bi-arrow-clockwise"></i> Refresh Pending
                        </button>
                    ` : ''}
                    <button class="btn btn-sm btn-outline-secondary" onclick="clearTransactionHistory()" title="Clear transaction history">
                        <i class="bi bi-trash"></i> Clear History
                    </button>
                </div>
            </div>
            <div class="tx-history-list">
                ${recentTxs.map(tx => `
                    <div class="tx-history-item ${tx.status}">
                        <div class="tx-history-item-header">
                            <span class="tx-function">${tx.decodedData.functionName}</span>
                            <span class="tx-status-icon">${getStatusIcon(tx.status)}</span>
                        </div>
                        <div class="tx-history-item-details">
                            <small class="tx-time">${formatTimestamp(tx.timestamp)}</small>
                            <a href="${BASESCAN_URL}${tx.hash}" target="_blank" class="tx-link">
                                ${shortenTxHash(tx.hash)}
                            </a>
                        </div>
                    </div>
                `).join('')}
            </div>
            ${transactionHistory.length > 10 ? '<div class="tx-history-footer">Showing 10 most recent</div>' : ''}
        `;
    }
}

// --- Main Transaction Tracking Functions ---
function trackTransaction(hash, functionName, args, contractAddress) {
    const decodedData = decodeFunctionCall(functionName, args, contractAddress);
    
    const txData = {
        hash,
        status: TX_STATUS.PENDING,
        timestamp: Date.now(),
        functionName,
        contractAddress,
        decodedData
    };
    
    addTransaction(txData);
    showNotification(txData);
    
    return txData;
}

function updateTransactionStatus(hash, status, receipt = null) {
    const updates = { status };
    
    if (receipt) {
        updates.blockNumber = receipt.blockNumber;
        updates.gasUsed = receipt.gasUsed?.toString();
        updates.confirmationTime = Date.now();
    }
    
    updateTransaction(hash, updates);
    
    // Only show updated notification if there's currently an active notification for this hash
    // or if it's a confirmed/failed status (so user sees the final result)
    const hasActiveNotification = activeNotifications.has(hash);
    
    if (hasActiveNotification || status === TX_STATUS.CONFIRMED || status === TX_STATUS.FAILED) {
        const tx = transactionHistory.find(t => t.hash === hash);
        if (tx) {
            showNotification(tx);
        }
    }
}

// --- Integration with Wallet.js ---
function initializeTransactionNotifications() {
    loadTransactionHistory();
    createTransactionDropdown();
}

// --- Export Functions ---
window.txNotifications = {
    trackTransaction,
    updateTransactionStatus,
    initializeTransactionNotifications,
    createTransactionDropdown,
    closeNotification,
    clearAllNotifications,
    refreshPendingTransactions,
    clearTransactionHistory,
    checkTransactionStatusFromBlockchain,
    getStoredTransactions,
    isTransactionSuccessful,
    TX_STATUS
};

// Make functions globally available for HTML onclick handlers
window.closeNotification = closeNotification;
window.clearAllNotifications = clearAllNotifications;
window.refreshPendingTransactions = refreshPendingTransactions;
window.clearTransactionHistory = clearTransactionHistory;
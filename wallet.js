/**
 * CHIONG APPLICATION MODULE MAP
 * 
 * This map provides a quick reference to locate key functionality across files:
 * 
 * config.js:
 * - Global state object and constants
 * - optionCalculator - All mathematical calculations for options
 * - CONFIG - Asset mappings and token information
 * 
 * wallet.js:
 * - setupWeb3Onboard() - Initialize Web3Onboard bridge
 * - connectWallet() - Handle user wallet connection
 * - Web3Onboard bridge configuration and chain setup
 * 
 * ui_interactions.js:
 * - setupEventListeners() - Initialize all UI event handlers
 * - showSection(), switchView() - Navigation and view management
 * - selectAsset(), selectOption() - Asset and option selection
 * - updatePositionSize(), setupConvictionSlider() - Position sizing
 * - updateOptionPreview(), showTradeConfirmation() - Order preview
 * - executeTrade() - Submit transactions to blockchain
 * 
 * app.js:
 * - initialize() - Application startup sequence
 * - refreshData() - Fetch market data, orders, positions
 * - populateOptionsTable() - Render advanced view options
 * - createPositionCard(), refreshPositions() - Position management
 * - updateCountdowns() - Time management for option expiry
 * - loadTradeHistory() - Historical trade data
 * 
 * Loading order: config.js → wallet.js → ui_interactions.js → app.js
 * 
 * State management: 
 * The global 'state' object in config.js maintains application-wide state
 * and is accessed by all modules.
 */

// Web3Onboard bridge variables
let web3OnboardBridge;
let ethereumClient;
let WagmiCore;

// Dynamically load web3-onboard bridge bundle if not already present
function loadWeb3OnboardBridge() {
    return new Promise((resolve, reject) => {
        if (window.Web3OnboardBridge) {
            console.log('Web3OnboardBridge already available');
            return resolve();
        }
        
        console.log('Loading Web3OnboardBridge script...');
        const existing = document.querySelector('script[data-web3onboard-bridge]');
        if (existing) {
            console.log('Script already loading, waiting...');
            existing.addEventListener('load', () => {
                console.log('Existing script loaded');
                resolve();
            });
            existing.addEventListener('error', () => {
                console.error('Existing script failed to load');
                reject(new Error('Failed to load web3onboard bridge script'));
            });
            return;
        }
        
        const script = document.createElement('script');
        script.src = 'dist/web3onboard-bridge.js';
        script.async = true;
        script.setAttribute('data-web3onboard-bridge', 'true');
        script.onload = () => {
            console.log('Web3OnboardBridge script loaded successfully');
            resolve();
        };
        script.onerror = () => {
            console.error('Failed to load Web3OnboardBridge script');
            reject(new Error('Failed to load web3onboard bridge script'));
        };
        document.head.appendChild(script);
    });
}

// Lazy access helper
function __getBridge() {
    return window.Web3OnboardBridge || null;
}

// Define baseline compatibility shims early so callers don't crash
if (!window.ethereumClient) {
    window.ethereumClient = {
        getAccount: () => {
            const b = __getBridge();
            const addr = b && b.getAddress ? b.getAddress() : null;
            return { address: addr, isConnected: !!addr };
        },
        watchAccount: (callback) => {
            let last = null;
            const interval = setInterval(() => {
                const b = __getBridge();
                const curr = b && b.getAddress ? b.getAddress() : null;
                if (curr !== last) {
                    last = curr;
                    try { callback({ address: curr, isConnected: !!curr }); } catch (e) {}
                }
            }, 1000);
            return () => clearInterval(interval);
        }
    };
    
    try { ethereumClient = window.ethereumClient; } catch (e) {}
}

if (!window.WagmiCore) {
    window.WagmiCore = {
        readContract: async ({ address, abi, functionName, args = [], chainId }) => {
            const b = __getBridge();
            const provider = b && b.getProvider ? b.getProvider() : null;
            if (!provider) throw new Error('No provider available');
            const contract = new ethers.Contract(address, abi, provider);
            return await contract[functionName](...(args || []));
        },
        // Minimal multicall-compatible shim. Executes calls sequentially.
        readContracts: async ({ contracts = [] }) => {
            const b = __getBridge();
            const provider = b && b.getProvider ? b.getProvider() : null;
            if (!provider) throw new Error('No provider available');
            const results = [];
            for (const c of contracts) {
                const { address, abi, functionName, args = [] } = c;
                const contract = new ethers.Contract(address, abi, provider);
                // Match viem-style return shape: { result }
                const value = await contract[functionName](...(args || []));
                results.push({ result: value });
            }
            return results;
        },
        writeContract: async ({ address, abi, functionName, args = [], chainId, value }) => {
            const b = __getBridge();
            const signer = b && b.getSigner ? b.getSigner() : null;
            if (!signer) throw new Error('No signer available');
            const contract = new ethers.Contract(address, abi, signer);
            const overrides = value !== undefined ? { value } : {};
            const tx = await contract[functionName](...(args || []), overrides);
            return tx;
        },
        waitForTransaction: async ({ hash }) => {
            const b = __getBridge();
            const provider = b && b.getProvider ? b.getProvider() : null;
            if (!provider) throw new Error('No provider available');
            return await provider.waitForTransaction(hash);
        },
        getETHBalance: async (address) => {
            const b = __getBridge();
            const provider = b && b.getProvider ? b.getProvider() : null;
            if (!provider) throw new Error('No provider available');
            return await provider.getBalance(address);
        },
        wrapETH: async (amount) => {
            const b = __getBridge();
            const signer = b && b.getSigner ? b.getSigner() : null;
            if (!signer) throw new Error('No signer available');
            // No WETH address provided in context; if needed, inject WETH contract here.
            throw new Error('wrapETH not implemented in web3-onboard bridge');
        },
        getNetwork: async () => {
            const b = __getBridge();
            const provider = b && b.getProvider ? b.getProvider() : null;
            if (!provider) throw new Error('No provider available');
            const net = await provider.getNetwork();
            // Normalize to shape expected by callers: { chain: { id } }
            const chainId = net?.chainId ?? net?.id;
            return { chain: { id: Number(chainId) } };
        },
        switchNetwork: async ({ chainId }) => {
            const b = __getBridge();
            const provider = b && b.getProvider ? b.getProvider() : null;
            const request = provider && provider.provider && provider.provider.request
                ? provider.provider.request.bind(provider.provider)
                : (window.ethereum && window.ethereum.request ? window.ethereum.request.bind(window.ethereum) : null);
            if (!request) throw new Error('No provider request available');
            const hexChainId = typeof chainId === 'string' && chainId.toString().startsWith('0x')
                ? chainId
                : '0x' + Number(chainId).toString(16);
            await request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChainId }] });
        }
    };
    try { WagmiCore = window.WagmiCore; } catch (e) {}
}

// Provide compatibility layer so existing code using ethereumClient & WagmiCore keeps working
function setupOnboardCompatibility() {
    if (!window.Web3OnboardBridge) return;
    try {
        const getAddr = () => (window.Web3OnboardBridge.getAddress && window.Web3OnboardBridge.getAddress()) || null;
        // ethereumClient shim
        window.ethereumClient = {
            getAccount: () => ({
                address: getAddr(),
                isConnected: !!getAddr()
            }),
            watchAccount: (callback) => {
                let last = getAddr();
                const interval = setInterval(() => {
                    const curr = getAddr();
                    if (curr !== last) {
                        last = curr;
                        try { callback({ address: curr, isConnected: !!curr }); } catch (e) {}
                    }
                }, 1000);
                return () => clearInterval(interval);
            }
        };

        // WagmiCore shim
        window.WagmiCore = {
            readContract: async ({ address, abi, functionName, args = [], chainId }) => {
                const provider = window.Web3OnboardBridge.getProvider && window.Web3OnboardBridge.getProvider();
                if (!provider) throw new Error('No provider available');
                const contract = new ethers.Contract(address, abi, provider);
                return await contract[functionName](...(args || []));
            },
            // Minimal multicall-compatible shim. Executes calls sequentially.
            readContracts: async ({ contracts = [] }) => {
                const provider = window.Web3OnboardBridge.getProvider && window.Web3OnboardBridge.getProvider();
                if (!provider) throw new Error('No provider available');
                const results = [];
                for (const c of contracts) {
                    const { address, abi, functionName, args = [] } = c;
                    const contract = new ethers.Contract(address, abi, provider);
                    const value = await contract[functionName](...(args || []));
                    results.push({ result: value });
                }
                return results;
            },
            writeContract: async ({ address, abi, functionName, args = [], chainId, value }) => {
                const signer = window.Web3OnboardBridge.getSigner && window.Web3OnboardBridge.getSigner();
                if (!signer) throw new Error('No signer available');
                const contract = new ethers.Contract(address, abi, signer);
                const tx = await contract[functionName](...(args || []), value !== undefined ? { value } : {});
                return tx;
            },
            waitForTransaction: async ({ hash }) => {
                const provider = window.Web3OnboardBridge.getProvider && window.Web3OnboardBridge.getProvider();
                if (!provider) throw new Error('No provider available');
                return await provider.waitForTransaction(hash);
            },
            getETHBalance: async (address) => {
                const provider = window.Web3OnboardBridge.getProvider && window.Web3OnboardBridge.getProvider();
                if (!provider) throw new Error('No provider available');
                return await provider.getBalance(address);
            },
            getNetwork: async () => {
                const provider = window.Web3OnboardBridge.getProvider && window.Web3OnboardBridge.getProvider();
                if (!provider) throw new Error('No provider available');
                const net = await provider.getNetwork();
                const chainId = net?.chainId ?? net?.id;
                return { chain: { id: Number(chainId) } };
            },
            switchNetwork: async ({ chainId }) => {
                const provider = window.Web3OnboardBridge.getProvider && window.Web3OnboardBridge.getProvider();
                const request = provider && provider.provider && provider.provider.request
                    ? provider.provider.request.bind(provider.provider)
                    : (window.ethereum && window.ethereum.request ? window.ethereum.request.bind(window.ethereum) : null);
                if (!request) throw new Error('No provider request available');
                const hexChainId = typeof chainId === 'string' && chainId.toString().startsWith('0x')
                    ? chainId
                    : '0x' + Number(chainId).toString(16);
                await request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChainId }] });
            }
        };
    } catch (e) {
        console.warn('Failed setting up Web3Onboard compatibility layer', e);
    }
}

// Utility function to shorten wallet addresses
function shortenAddress(address) {
    return address ? `${address.substring(0, 6)}...${address.substring(address.length - 4)}` : "";
}

async function setupWeb3Onboard() {
    try {
        console.log('Setting up Web3Onboard...');
        await loadWeb3OnboardBridge();
        
        // Wait a bit for the script to fully initialize
        await new Promise(resolve => setTimeout(resolve, 100));
        
        if (window.Web3OnboardBridge && typeof window.Web3OnboardBridge.init === 'function') {
            console.log('Web3OnboardBridge found, initializing...');
            window.Web3OnboardBridge.init();
            setupOnboardCompatibility();
            
            // Set up global references
            try { 
                ethereumClient = window.ethereumClient; 
                WagmiCore = window.WagmiCore; 
            } catch (e) {}
            
            // Check if already connected
            const address = window.Web3OnboardBridge.getAddress && window.Web3OnboardBridge.getAddress();
            if (address) {
                updateUIForConnectedState(address);
                state.connectedAddress = address;
            }
            
            // Set up account change monitoring
            setupAccountMonitoring();
            
            console.log('Web3Onboard bridge initialized successfully');
            return true;
        } else {
            console.warn('Web3OnboardBridge not properly available after loading');
            return false;
        }
    } catch (error) {
        console.error('Failed to initialize Web3Onboard:', error);
        return false;
    }
}

function setupAccountMonitoring() {
    // Monitor for account changes via polling
    let lastAddress = null;
    const interval = setInterval(() => {
        const currentAddress = window.Web3OnboardBridge.getAddress && window.Web3OnboardBridge.getAddress();
        
        if (currentAddress !== lastAddress) {
            if (currentAddress) {
                // New connection
                updateUIForConnectedState(currentAddress);
                state.connectedAddress = currentAddress;
                refreshData();
                
                // Verify network
                verifyAndSwitchNetwork();
            } else {
                // Disconnection
                updateUIForDisconnectedState();
                state.connectedAddress = null;
            }
            lastAddress = currentAddress;
        }
    }, 1000);
    
    // Store interval reference for cleanup if needed
    window.accountMonitoringInterval = interval;
}

function updateUIForConnectedState(address) {
    document.getElementById('wallet-status').classList.remove('not-connected');
    document.getElementById('wallet-status').classList.add('connected');
    
    const shortAddress = shortenAddress(address);
    const addrEl = document.getElementById('address-display');
    if (addrEl) {
        addrEl.textContent = shortAddress;
        addrEl.style.display = 'inline-block';
    }
    
    const disconnectBtn = document.getElementById('disconnect-wallet-btn');
    if (disconnectBtn) disconnectBtn.style.display = 'inline-block';
    
    const connectBtn = document.getElementById('connect-web3modal-btn');
    if (connectBtn) connectBtn.style.display = 'none';
    
    const connectionAlert = document.getElementById('connection-alert');
    if (connectionAlert) connectionAlert.style.display = 'none';
}

function updateUIForDisconnectedState() {
    document.getElementById('wallet-status').classList.add('not-connected');
    document.getElementById('wallet-status').classList.remove('connected');
    
    const connectBtn = document.getElementById('connect-web3modal-btn');
    if (connectBtn) connectBtn.style.display = 'block';
    
    const disconnectBtn = document.getElementById('disconnect-wallet-btn');
    if (disconnectBtn) disconnectBtn.style.display = 'none';
    
    const addressDisplay = document.getElementById('address-display');
    if (addressDisplay) {
        addressDisplay.textContent = '';
        addressDisplay.style.display = 'none';
    }
    
    const connectionAlert = document.getElementById('connection-alert');
    if (connectionAlert) connectionAlert.style.display = 'none';
}

async function verifyAndSwitchNetwork() {
    try {
        const { getNetwork, switchNetwork } = WagmiCore;
        const net = await getNetwork();
        if (net?.chain?.id !== 8453) {
            console.log("Wrong network detected, switching to Base...");
            await switchNetwork({ chainId: 8453 });
        }
    } catch (error) {
        console.error("Failed to verify/switch network:", error);
        $('#connection-alert').text("Please switch to Base network in your wallet.").show();
    }
}

// Connect to the wallet
async function connectWallet() {
    try {
        // Try to initialize if not already done
        if (!window.Web3OnboardBridge) {
            console.log('Web3Onboard bridge not found, attempting to initialize...');
            const initialized = await setupWeb3Onboard();
            if (!initialized) {
                // Fallback to direct ethereum connection
                console.log('Falling back to direct ethereum connection...');
                return await connectWithDirectEthereum();
            }
        }
        
        if (!window.Web3OnboardBridge || typeof window.Web3OnboardBridge.connect !== 'function') {
            throw new Error('Web3Onboard bridge not properly initialized');
        }
        
        console.log('Connecting wallet via Web3Onboard...');
        const result = await window.Web3OnboardBridge.connect();
        if (result && result.address) {
            updateUIForConnectedState(result.address);
            state.connectedAddress = result.address;
            refreshData();
            console.log('Wallet connected successfully:', result.address);
        } else {
            throw new Error('Failed to connect wallet - no address returned');
        }
    } catch (error) {
        console.error("Error connecting wallet:", error);
        
        // Show user-friendly error message
        const alertEl = document.getElementById('connection-alert');
        if (alertEl) {
            alertEl.textContent = `Connection failed: ${error.message}`;
            alertEl.style.display = 'block';
        }
    }
}

// Fallback connection method using direct ethereum
async function connectWithDirectEthereum() {
    try {
        if (!window.ethereum) {
            throw new Error('No ethereum provider available');
        }
        
        console.log('Connecting via direct ethereum...');
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        
        if (accounts && accounts.length > 0) {
            const address = accounts[0];
            updateUIForConnectedState(address);
            state.connectedAddress = address;
            refreshData();
            console.log('Wallet connected via direct ethereum:', address);
            
            // Set up basic compatibility
            if (!window.ethereumClient) {
                window.ethereumClient = {
                    getAccount: () => ({ address, isConnected: true }),
                    watchAccount: (callback) => {
                        window.ethereum.on('accountsChanged', (accounts) => {
                            if (accounts.length > 0) {
                                callback({ address: accounts[0], isConnected: true });
                            } else {
                                callback({ address: null, isConnected: false });
                            }
                        });
                    }
                };
                ethereumClient = window.ethereumClient;
            }
            
            return true;
        } else {
            throw new Error('No accounts returned');
        }
    } catch (error) {
        console.error('Direct ethereum connection failed:', error);
        throw error;
    }
}

// Disconnect wallet function
async function disconnectWallet() {
    try {
        if (window.Web3OnboardBridge && window.Web3OnboardBridge.disconnect) {
            await window.Web3OnboardBridge.disconnect();
        }
        
        updateUIForDisconnectedState();
        state.connectedAddress = null;
        
        console.log('Wallet disconnected successfully');
    } catch (error) {
        console.error('Error disconnecting wallet:', error);
    }
}

// Initialize wallet system when page loads
$(document).ready(function() {
    console.log('Initializing wallet system...');
    
    // Show the connect button
    $('#connect-web3modal-btn').show();
    
    // Hook up click events
    $('#connect-web3modal-btn').on('click', connectWallet);
    
    // Hook up disconnect button if it exists
    $('#disconnect-wallet-btn').on('click', disconnectWallet);
    
    // Try to initialize Web3Onboard in background, but don't block UI
    setupWeb3Onboard().then(success => {
        if (success) {
            console.log('Web3Onboard initialized successfully on page load');
        } else {
            console.log('Web3Onboard initialization failed on page load, will retry on connect');
        }
    }).catch(error => {
        console.log('Web3Onboard initialization error on page load:', error);
    });
});

// Ensure functions are accessible globally for other scripts
try {
    window.connectWallet = connectWallet;
    window.disconnectWallet = disconnectWallet;
    window.setupWeb3Onboard = setupWeb3Onboard;
    window.connectWithDirectEthereum = connectWithDirectEthereum;
} catch (e) {}

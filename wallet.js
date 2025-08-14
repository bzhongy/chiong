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

// Store real Wagmi functions when available
function storeRealWagmiFunctions() {
    // Check if real Wagmi readContracts is available
    if (window.WagmiCore && typeof window.WagmiCore.readContracts === 'function') {
        window.__WAGMI_READ_CONTRACTS__ = window.WagmiCore.readContracts;
        console.log('Real Wagmi readContracts detected and stored');
    }
    
    // Check if real Wagmi readContract is available
    if (window.WagmiCore && typeof window.WagmiCore.readContract === 'function') {
        window.__WAGMI_READ_CONTRACT__ = window.WagmiCore.readContract;
        console.log('Real Wagmi readContract detected and stored');
    }
}

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
            // Force all calls through custom RPC endpoint
            const directProvider = new ethers.providers.JsonRpcProvider('https://base-rpc.thetanuts.finance');
            const contract = new ethers.Contract(address, abi, directProvider);
            return await contract[functionName](...(args || []));
        },
        // Use real Wagmi readContracts when available (which handles multicall automatically)
        // Only fall back to our implementation when necessary
        readContracts: async (params) => {
            // If we have the real Wagmi readContracts, use it (it handles multicall automatically)
            if (window.__WAGMI_READ_CONTRACTS__) {
                return await window.__WAGMI_READ_CONTRACTS__(params);
            }
            
            // Fallback to sequential calls if real Wagmi not available
            const { contracts = [] } = params;
            // Force all calls through custom RPC endpoint
            const directProvider = new ethers.providers.JsonRpcProvider('https://base-rpc.thetanuts.finance');
            
            console.warn('Using fallback sequential calls - real Wagmi multicall not available');
            const results = [];
            for (const c of contracts) {
                try {
                    const { address, abi, functionName, args = [] } = c;
                    const contract = new ethers.Contract(address, abi, directProvider);
                    const value = await contract[functionName](...(args || []));
                    results.push({ result: value });
                } catch (error) {
                    console.error(`Sequential call failed for ${c.functionName}:`, error);
                    results.push({ result: null, error: error.message });
                }
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
            // Force all calls through custom RPC endpoint
            const directProvider = new ethers.providers.JsonRpcProvider('https://base-rpc.thetanuts.finance');
            return await directProvider.waitForTransaction(hash);
        },
        getETHBalance: async (address) => {
            // Force all calls through custom RPC endpoint
            const directProvider = new ethers.providers.JsonRpcProvider('https://base-rpc.thetanuts.finance');
            return await directProvider.getBalance(address);
        },
        wrapETH: async (amount) => {
            const b = __getBridge();
            const signer = b && b.getSigner ? b.getSigner() : null;
            if (!signer) throw new Error('No signer available');
            
            // Get WETH contract address from config
            const WETH_ADDRESS = CONFIG.collateralMap.WETH;
            const WETH_ABI = [
                'function deposit() payable',
                'function withdraw(uint256 amount)',
                'function balanceOf(address owner) view returns (uint256)',
                'function transfer(address to, uint256 amount) returns (bool)'
            ];
            
            const wethContract = new ethers.Contract(WETH_ADDRESS, WETH_ABI, signer);
            const amountWei = ethers.utils.parseEther(amount.toString());
            
            // Call deposit() with ETH value
            const tx = await wethContract.deposit({ value: amountWei });
            return tx;
        },
        
        unwrapWETH: async (amount) => {
            const b = __getBridge();
            const signer = b && b.getSigner ? b.getSigner() : null;
            if (!signer) throw new Error('No signer available');
            
            // Get WETH contract address from config
            const WETH_ADDRESS = CONFIG.collateralMap.WETH;
            const WETH_ABI = [
                'function deposit() payable',
                'function withdraw(uint256 amount)',
                'function balanceOf(address owner) view returns (uint256)',
                'function transfer(address to, uint256 amount) returns (bool)'
            ];
            
            const wethContract = new ethers.Contract(WETH_ADDRESS, WETH_ABI, signer);
            const amountWei = ethers.utils.parseEther(amount.toString());
            
            // Call withdraw() to get ETH back
            const tx = await wethContract.withdraw(amountWei);
            return tx;
        },
        getNetwork: async () => {
            // Force all calls through custom RPC endpoint
            const directProvider = new ethers.providers.JsonRpcProvider('https://base-rpc.thetanuts.finance');
            const net = await directProvider.getNetwork();
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
                // Force all calls through custom RPC endpoint
                const directProvider = new ethers.providers.JsonRpcProvider('https://base-rpc.thetanuts.finance');
                const contract = new ethers.Contract(address, abi, directProvider);
                return await contract[functionName](...(args || []));
            },
            // Use real Wagmi readContracts when available (which handles multicall automatically)
            // Only fall back to our implementation when necessary
            readContracts: async (params) => {
                // If we have the real Wagmi readContracts, use it (it handles multicall automatically)
                // if (window.__WAGMI_READ_CONTRACTS__) {
                //     return await window.__WAGMI_READ_CONTRACTS__(params);
                // }
                
                // Fallback to sequential calls if real Wagmi not available
                const { contracts = [] } = params;
                // Force all calls through custom RPC endpoint
                const directProvider = new ethers.providers.JsonRpcProvider('https://base-rpc.thetanuts.finance');
                
                console.warn('Using fallback sequential calls - real Wagmi multicall not available');
                const results = [];
                for (const c of contracts) {
                    try {
                        const { address, abi, functionName, args = [] } = c;
                        const contract = new ethers.Contract(address, abi, directProvider);
                        const value = await contract[functionName](...(args || []));
                        results.push({ result: value });
                    } catch (error) {
                        console.error(`Sequential call failed for ${c.functionName}:`, error);
                        results.push({ result: null, error: error.message });
                    }
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
                // Force all calls through custom RPC endpoint
                const directProvider = new ethers.providers.JsonRpcProvider('https://base-rpc.thetanuts.finance');
                return await directProvider.waitForTransaction(hash);
            },
            getETHBalance: async (address) => {
                // Force all calls through custom RPC endpoint
                const directProvider = new ethers.providers.JsonRpcProvider('https://base-rpc.thetanuts.finance');
                return await directProvider.getBalance(address);
            },
            wrapETH: async (amount) => {
                const b = __getBridge();
                const signer = b && b.getSigner ? b.getSigner() : null;
                if (!signer) throw new Error('No signer available');
                
                // WETH contract address on Base
                const WETH_ADDRESS = '0x4200000000000000000000000000000000000006';
                const WETH_ABI = [
                    'function deposit() payable',
                    'function withdraw(uint256 amount)',
                    'function balanceOf(address owner) view returns (uint256)',
                    'function transfer(address to, uint256 amount) returns (bool)'
                ];
                
                const wethContract = new ethers.Contract(WETH_ADDRESS, WETH_ABI, signer);
                const amountWei = ethers.utils.parseEther(amount.toString());
                
                // Call deposit() with ETH value
                const tx = await wethContract.deposit({ value: amountWei });
                return tx;
            },
            
            unwrapWETH: async (amount) => {
                const b = __getBridge();
                const signer = b && b.getSigner ? b.getSigner() : null;
                if (!signer) throw new Error('No signer available');
                
                // WETH contract address on Base
                const WETH_ADDRESS = '0x4200000000000000000000000000000000000006';
                const WETH_ABI = [
                    'function deposit() payable',
                    'function withdraw(uint256 amount)',
                    'function balanceOf(address owner) view returns (uint256)',
                    'function transfer(address to, uint256 amount) returns (bool)'
                ];
                
                const wethContract = new ethers.Contract(WETH_ADDRESS, WETH_ABI, signer);
                const amountWei = ethers.utils.parseEther(amount.toString());
                
                // Call withdraw() to get ETH back
                const tx = await wethContract.withdraw(amountWei);
                return tx;
            },
            getNetwork: async () => {
                // Force all calls through custom RPC endpoint
                const directProvider = new ethers.providers.JsonRpcProvider('https://base-rpc.thetanuts.finance');
                const net = await directProvider.getNetwork();
                // Normalize to shape expected by callers: { chain: { id } }
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
        
        // Store real Wagmi functions if available
        storeRealWagmiFunctions();
            
            // Check if already connected
            const address = window.Web3OnboardBridge.getAddress && window.Web3OnboardBridge.getAddress();
            if (address) {
                updateUIForConnectedState(address);
                state.connectedAddress = address;
                console.log('Wallet already connected on initialization:', address);
            } else {
                // Try auto-connect if not already connected
                console.log('Attempting auto-connect...');
                try {
                    const autoConnectResult = await window.Web3OnboardBridge.autoConnect();
                    if (autoConnectResult && autoConnectResult.address) {
                        console.log('Auto-connect successful:', autoConnectResult.address);
                        updateUIForConnectedState(autoConnectResult.address);
                        state.connectedAddress = autoConnectResult.address;
                    } else {
                        console.log('Auto-connect failed - no previous connection found');
                    }
                } catch (error) {
                    console.log('Auto-connect error:', error);
                }
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
    
    // Allowances will be refreshed by refreshData() after wallet connection
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
        
        // Allowances will be refreshed by refreshData() after network verification
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
        
        
    } catch (error) {
        console.error('Error disconnecting wallet:', error);
    }
}

// Add this function for manual auto-connect attempts
async function attemptAutoConnect() {
    try {
        if (window.Web3OnboardBridge && window.Web3OnboardBridge.autoConnect) {
            const autoConnectResult = await window.Web3OnboardBridge.autoConnect();
            if (autoConnectResult && autoConnectResult.address) {
                updateUIForConnectedState(autoConnectResult.address);
                state.connectedAddress = autoConnectResult.address;
                
                // Trigger a data refresh to load allowances and balances
                if (typeof refreshData === 'function') {
                    setTimeout(() => refreshData(false), 1000);
                }
                
                return true;
            } else {
                return false;
            }
        }
        return false;
    } catch (error) {
        return false;
    }
}

// Make it available globally for testing
window.attemptAutoConnect = attemptAutoConnect;

// Add test function for debugging auto-connect
window.testAutoConnect = function() {
    if (window.Web3OnboardBridge && window.Web3OnboardBridge.testAutoConnect) {
        return window.Web3OnboardBridge.testAutoConnect();
    } else {
        return null;
    }
};

// Add test function for debugging multicall
window.testMulticall = async function() {
    if (window.__WAGMI_READ_CONTRACTS__) {
        return 'Real Wagmi readContracts available - multicall should work automatically';
    } else {
        return 'Real Wagmi readContracts not available - using fallback sequential calls';
    }
};

// Initialize wallet system when page loads
$(document).ready(function() {
    // Show the connect button
    $('#connect-web3modal-btn').show();
    
    // Hook up click events
    $('#connect-web3modal-btn').on('click', connectWallet);
    
    // Hook up disconnect button if it exists
    $('#disconnect-wallet-btn').on('click', disconnectWallet);
    
    // Try to initialize Web3Onboard in background, but don't block UI
    setupWeb3Onboard().then(success => {
        // Web3Onboard initialization completed
    }).catch(error => {
        // Web3Onboard initialization failed, will retry on connect
    });
});

// Ensure functions are accessible globally for other scripts
try {
    window.connectWallet = connectWallet;
    window.disconnectWallet = disconnectWallet;
    window.setupWeb3Onboard = setupWeb3Onboard;
    window.connectWithDirectEthereum = connectWithDirectEthereum;
} catch (e) {}

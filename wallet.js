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
 * - setupWeb3Modal() - Initialize wallet connection interface
 * - connectWallet() - Handle user wallet connection
 * - Web3 client configuration and chain setup
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

// Migrated: use Web3OnboardBridge if available
let web3modal;
let ethereumClient;
let wagmiConfig;
let WagmiCore;

// Dynamically load web3-onboard bridge bundle if not already present
function loadWeb3OnboardBridge() {
    return new Promise((resolve, reject) => {
        if (window.Web3OnboardBridge) {
            return resolve();
        }
        const existing = document.querySelector('script[data-web3onboard-bridge]');
        if (existing) {
            existing.addEventListener('load', () => resolve());
            existing.addEventListener('error', () => reject(new Error('Failed to load web3onboard bridge script')));
            return;
        }
        const script = document.createElement('script');
        script.src = 'dist/web3onboard-bridge.js';
        script.async = true;
        script.setAttribute('data-web3onboard-bridge', 'true');
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load web3onboard bridge script'));
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

async function setupWeb3Modal(force = false) {
    // If web3-onboard bridge is available, prefer it and skip web3modal setup
    try {
        await loadWeb3OnboardBridge();
    } catch (e) {
        console.warn('Could not load Web3OnboardBridge, will fall back to Web3Modal.', e);
    }
    if (window.Web3OnboardBridge && !force) {
        try {
            window.Web3OnboardBridge.init();
            setupOnboardCompatibility();
            try { ethereumClient = window.ethereumClient; WagmiCore = window.WagmiCore; } catch (e) {}
            // Hook account change via polling bridge address
            const address = window.Web3OnboardBridge.getAddress && window.Web3OnboardBridge.getAddress();
            if (address) {
                // Minimal UI sync when already connected
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
                state.connectedAddress = address;
            }
            return; // do not initialize web3modal
        } catch (e) {
            console.warn('Web3OnboardBridge init failed, falling back to Web3Modal', e);
        }
    }
    // Setup for Web3Modal with WalletConnect
    window.process = { env: { NODE_ENV: "development" } };
    
    // Import required libraries from CDN
    const { EthereumClient, w3mConnectors, w3mProvider, WagmiCore: wagmiCore, WagmiCoreChains } = await import('https://unpkg.com/@web3modal/ethereum@2.7.1');
        const { Web3Modal } = await import('https://unpkg.com/@web3modal/html@2.7.1');
        const { configureChains, createConfig, Chain } = wagmiCore;
        
    WagmiCore = wagmiCore;  
    // Polyfill missing helpers expected by the rest of the app
    if (!WagmiCore.readContracts) {
        WagmiCore.readContracts = async ({ contracts = [] }) => {
            // Use existing readContract if available
            if (WagmiCore.readContract) {
                const results = [];
                for (const c of contracts) {
                    const value = await WagmiCore.readContract(c);
                    results.push({ result: value });
                }
                return results;
            }
            // Fallback via ethers provider
            const provider = (window.ethereum && new ethers.providers.Web3Provider(window.ethereum)) || null;
            if (!provider) throw new Error('No provider available');
            const results = [];
            for (const c of contracts) {
                const { address, abi, functionName, args = [] } = c;
                const contract = new ethers.Contract(address, abi, provider);
                const value = await contract[functionName](...(args || []));
                results.push({ result: value });
            }
            return results;
        };
    }
    if (!WagmiCore.getETHBalance) {
        WagmiCore.getETHBalance = async (address) => {
            try {
                // Prefer injected provider
                if (window.ethereum) {
                    const provider = new ethers.providers.Web3Provider(window.ethereum);
                    return await provider.getBalance(address);
                }
                // Try Web3OnboardBridge provider if present
                const b = __getBridge();
                const provider = b && b.getProvider ? b.getProvider() : null;
                if (provider) return await provider.getBalance(address);
                throw new Error('No provider available');
            } catch (e) {
                throw e;
            }
        };
    }
    // Manually define Base chain if not available in WagmiCoreChains
        const base = {
      id: 8453,
            name: 'Base',
            network: 'base',
            nativeCurrency: {
                decimals: 18,
                name: 'Ether',
                symbol: 'ETH',
            },
            rpcUrls: {
                public: { http: ['https://mainnet.base.org'] },
        default: { http: ['https://base-rpc.thetanuts.finance'] },
            },
            blockExplorers: {
                etherscan: { name: 'BaseScan', url: 'https://basescan.org' },
                default: { name: 'BaseScan', url: 'https://basescan.org' },
            }
        };

    // Configure WalletConnect with Base chain
    const walletConnectProjectId = 'c0c838fac0cbe5b43ad76ea8652e3029';
    
    // Use only the Base chain in the chains array
        const chains = [base];
    
    const { publicClient } = configureChains(chains, [w3mProvider({ projectId: walletConnectProjectId })]);
        
    wagmiConfig = createConfig({
            autoConnect: true,
      connectors: w3mConnectors({ projectId: walletConnectProjectId, chains }),
            publicClient,
      // Add this defaultChain config
            defaultChain: base
        });
        
    ethereumClient = new EthereumClient(wagmiConfig, chains);
    
    // Set more explicit options for Web3Modal
    web3modal = new Web3Modal({ 
      projectId: walletConnectProjectId,
      defaultChain: base, // Specify default chain here
      explorerRecommendedWalletIds: 'NONE', // Optional: customize shown wallets
      themeMode: 'dark', // Optional: match your app's theme
            chainImages: {
        // Custom chain image
        [base.id]: 'https://raw.githubusercontent.com/base/brand-kit/refs/heads/main/logo/in-product/Base_Network_Logo.svg'
      }
    }, ethereumClient);
    
    // Setup account change listener
    ethereumClient.watchAccount((account) => {
      if (account.isConnected) {
        // Update UI for connected state
        document.getElementById('wallet-status').classList.remove('not-connected');
        document.getElementById('wallet-status').classList.add('connected');
        document.getElementById('connect-web3modal-btn').style.display = 'none';
        
        // Show disconnect button when connected
        const disconnectBtn = document.getElementById('disconnect-wallet-btn');
        if (disconnectBtn) disconnectBtn.style.display = 'inline-block';
        
        // Show address in UI
        const shortAddress = shortenAddress(account.address);
        document.getElementById('address-display').textContent = shortAddress;
        document.getElementById('address-display').style.display = 'inline-block';
  
         
        // Make address display clickable to open modal
        $('#address-display').on('click', function() {
          if (web3modal) {
            web3modal.openModal();
          }
        });
        
        state.connectedAddress = account.address;
        document.getElementById('connection-alert').style.display = 'none';
  
        refreshData();
        
        // Check if we're on the correct network
        (async () => {
            try {
                const { getNetwork, switchNetwork } = WagmiCore;
                const net = await getNetwork();
                if (net?.chain?.id !== 8453) {
                    console.log("Wrong network detected, switching to Base...");
                    await switchNetwork({ chainId: 8453 });
                }
            } catch (error) {
                console.error("Failed to verify/switch network:", error);
                // Show a friendly error message
                $('#connection-alert').text("Please switch to Base network in your wallet.").show();
            }
        })();
      } else {
        // Update UI for disconnected state
        document.getElementById('wallet-status').classList.add('not-connected');
        document.getElementById('wallet-status').classList.remove('connected');
        document.getElementById('connect-web3modal-btn').style.display = 'block';
        
        // Hide disconnect button when disconnected
        const disconnectBtn = document.getElementById('disconnect-wallet-btn');
        if (disconnectBtn) disconnectBtn.style.display = 'none';
        
        // Hide the address display
        const addressDisplay = document.getElementById('address-display');
        if (addressDisplay) {
            addressDisplay.textContent = '';
            addressDisplay.style.display = 'none';
        }
        
        // Reset state
        state.connectedAddress = null;
        
        // Hide any connection alerts
        const connectionAlert = document.getElementById('connection-alert');
        if (connectionAlert) connectionAlert.style.display = 'none';
      }
    });
  }

  // Connect to the wallet
async function connectWallet() {
  try {
    // If web3-onboard bridge exists, use it
    if (window.Web3OnboardBridge) {
      await setupWeb3Modal();
      const result = await window.Web3OnboardBridge.connect();
      if (result && result.address) {
        setupOnboardCompatibility();
        try { ethereumClient = window.ethereumClient; WagmiCore = window.WagmiCore; } catch (e) {}
        // Update UI for connected state
        document.getElementById('wallet-status').classList.remove('not-connected');
        document.getElementById('wallet-status').classList.add('connected');
        const shortAddress = shortenAddress(result.address);
        document.getElementById('address-display').textContent = shortAddress;
        document.getElementById('address-display').style.display = 'inline-block';
        const disconnectBtn = document.getElementById('disconnect-wallet-btn');
        if (disconnectBtn) disconnectBtn.style.display = 'inline-block';
        const connectBtn = document.getElementById('connect-web3modal-btn');
        if (connectBtn) connectBtn.style.display = 'none';
        state.connectedAddress = result.address;
        document.getElementById('connection-alert').style.display = 'none';
        refreshData();
        return;
      }
    }

    // Fallback to existing Web3Modal flow
    if (!web3modal) {
      await setupWeb3Modal(true);
    }
    const accountInfo = (ethereumClient && typeof ethereumClient.getAccount === 'function') ? ethereumClient.getAccount() : { isConnected: false };
    if (!accountInfo.isConnected && web3modal && typeof web3modal.openModal === 'function') {
      web3modal.openModal({ route: 'ConnectWallet', params: { chainId: 8453 } });
    }
  } catch (error) {
    console.error("Error connecting wallet:", error);
    document.getElementById('connection-alert').style.display = 'block';
  }
}

// Disconnect wallet function
async function disconnectWallet() {
  try {
    if (window.Web3OnboardBridge) {
      await window.Web3OnboardBridge.disconnect();
    }
    if (ethereumClient && ethereumClient.disconnect) {
      await ethereumClient.disconnect();
    }
    
    // Force UI update to disconnected state
    document.getElementById('wallet-status').classList.add('not-connected');
    document.getElementById('wallet-status').classList.remove('connected');
    document.getElementById('connect-web3modal-btn').style.display = 'block';
    
    // Hide address display
    const addressDisplay = document.getElementById('address-display');
    if (addressDisplay) {
        addressDisplay.textContent = '';
        addressDisplay.style.display = 'none';
    }
    
    // Reset state
    state.connectedAddress = null;
    
    // Hide connection alerts
    const connectionAlert = document.getElementById('connection-alert');
    if (connectionAlert) connectionAlert.style.display = 'none';
    
    console.log('Wallet disconnected successfully');
  } catch (error) {
    console.error('Error disconnecting wallet:', error);
  }
}

// Initialize wallet system when page loads
$(document).ready(function() {
  // Show the connect button
  $('#connect-web3modal-btn').show();
  
  // Hook up click events
  $('#connect-web3modal-btn').on('click', connectWallet);
  
  // Hook up disconnect button if it exists
  $('#disconnect-wallet-btn').on('click', disconnectWallet);
  
  // Try to auto-connect if previously connected
  setupWeb3Modal().catch(console.error);
});

// Ensure functions are accessible globally for other scripts
try {
  window.connectWallet = connectWallet;
  window.disconnectWallet = disconnectWallet;
} catch (e) {}

/**
 * CHIONG UNIFIED WALLET MODULE
 * 
 * Manages external wallets via Web3Modal.
 * Exposes an emulated WagmiCore interface for compatibility with app.js and ui_interactions.js.
 */

// --- Constants ---
const BASE_CHAIN_ID = 8453;
const BASE_RPC_URL = 'https://base-rpc.thetanuts.finance';
const WALLETCONNECT_PROJECT_ID = 'c0c838fac0cbe5b43ad76ea8652e3029';
const LOCALSTORAGE_KEYS = {
    IN_BROWSER_WALLET: 'chiong_browser_wallet',
    PREFERRED_WALLET_TYPE: 'chiong_preferred_wallet_type'
};

// --- State Variables ---
let activeWalletType = null;

let ethersProvider = null;
let ethersSigner = null;
let web3modalInstance = null;
let ethereumClientInstance = null;
let _WagmiCore = null;

// --- Emulated WagmiCore Object ---
window.WagmiCore = {};

// --- Helper Functions ---
function shortenAddress(address) {
    return address ? `${address.substring(0, 6)}...${address.substring(address.length - 4)}` : "";
}

function _generatePrivateKey() {
    const array = new Uint8Array(32);
    window.crypto.getRandomValues(array);
    return '0x' + Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function _updateWalletUI() {
    const walletStatusEl = document.getElementById('wallet-status');
    const connectWeb3ModalBtn = document.getElementById('connect-web3modal-btn');

    const connectedDetailsEl = document.querySelector('.connected-details');
    const addressDisplayEl = document.getElementById('address-display');
    const disconnectBtn = document.getElementById('disconnect-wallet-btn');
    const connectWalletBtn = document.getElementById('connect-wallet');
    const saveKeyBtn = document.getElementById('save-private-key');
    const helpIconBtn = document.getElementById('wallet-help-icon');
    
    $('#address-display').off('click');
    $('#save-private-key').off('click');
    $('#wallet-help-icon').off('click');

    if (activeWalletType) {
        walletStatusEl.classList.remove('not-connected');
        walletStatusEl.classList.add('connected');
        connectWeb3ModalBtn.style.display = 'none';
        useInBrowserWalletBtn.style.display = 'none';
        if (connectWalletBtn) connectWalletBtn.style.display = 'none';
        connectedDetailsEl.style.display = 'flex';
        disconnectBtn.style.display = 'block';
        
        let currentAddress;
        if (activeWalletType === 'external') {
            try {
                currentAddress = await ethersSigner.getAddress();
            } catch (error) {
                currentAddress = ethereumClientInstance?.getAccount()?.address || null;
            }
        }
        
        addressDisplayEl.textContent = shortenAddress(currentAddress);
        state.connectedAddress = currentAddress;
        document.getElementById('connection-alert').style.display = 'none';

        if (activeWalletType === 'in-browser' && inBrowserWalletDetails.isInitialized) {
            if (saveKeyBtn) saveKeyBtn.style.display = 'inline-block';
            if (helpIconBtn) helpIconBtn.style.display = 'inline-block';
            
            const txHistoryBtn = document.getElementById('tx-history-btn');
            if (txHistoryBtn) txHistoryBtn.style.display = 'inline-block';

            $('#save-private-key').on('click', function(e) {
                e.stopPropagation();
                if (confirm('This will copy your PRIVATE KEY to clipboard. Never share your private key with anyone! Are you sure you want to proceed?')) {
                    navigator.clipboard.writeText(inBrowserWalletDetails.privateKey)
                        .then(() => {
                            alert('⚠️ IMPORTANT: Private key copied to clipboard.\n\nStore this safely and never share it with anyone!\n\nPrivate Key: ' + inBrowserWalletDetails.privateKey);
                        })
                        .catch(() => alert('Could not copy private key'));
                }
            });
            
            $('#wallet-help-icon').on('click', function(e) {
                e.stopPropagation();
                showQuickWalletExplanation();
            });

            $('#address-display').on('click', function() {
                navigator.clipboard.writeText(currentAddress)
                    .then(() => alert(`Address copied to clipboard: ${currentAddress}`))
                    .catch(() => {});
            });

        } else if (activeWalletType === 'external') {
            if (saveKeyBtn) saveKeyBtn.style.display = 'none';
            if (helpIconBtn) helpIconBtn.style.display = 'none';
            
            const txHistoryBtn = document.getElementById('tx-history-btn');
            if (txHistoryBtn) txHistoryBtn.style.display = 'inline-block';
            
            $('#address-display').on('click', function() {
                if (web3modalInstance) {
                    web3modalInstance.openModal();
                }
            });
        }
        
        if (typeof refreshData === 'function') {
            refreshData();
        }
        
        if (window.txNotifications && window.txNotifications.createTransactionDropdown) {
            setTimeout(() => {
                window.txNotifications.createTransactionDropdown();
            }, 100);
        }
        
        const network = WagmiCore.getNetwork();
        if (network.chain?.id !== BASE_CHAIN_ID) {
            if (activeWalletType === 'external' && ethereumClientInstance) {
                 try {
                    await ethereumClientInstance.switchChain(BASE_CHAIN_ID);
                 } catch {
                    $('#connection-alert').text("Please switch to Base network in your wallet.").show();
                 }
            } else {
                 $('#connection-alert').text("Wrong network. Please connect to Base network.").show();
            }
        }

    } else {
        walletStatusEl.classList.add('not-connected');
        walletStatusEl.classList.remove('connected');
        connectWeb3ModalBtn.style.display = 'inline-block';

        if (connectWalletBtn) connectWalletBtn.style.display = 'block';
        
        connectedDetailsEl.style.setProperty('display', 'none', 'important');
        disconnectBtn.style.display = 'none';
        
        if (saveKeyBtn) saveKeyBtn.style.display = 'none';
        if (helpIconBtn) helpIconBtn.style.display = 'none';
        
        const txHistoryBtn = document.getElementById('tx-history-btn');
        if (txHistoryBtn) txHistoryBtn.style.display = 'none';
        
        addressDisplayEl.textContent = '';
        state.connectedAddress = null;
    }
}


function _initializeInBrowserWallet() {
    const savedWallet = localStorage.getItem(LOCALSTORAGE_KEYS.IN_BROWSER_WALLET);
    if (savedWallet) {
        try {
            inBrowserWalletDetails = JSON.parse(savedWallet);
            if (inBrowserWalletDetails.privateKey && inBrowserWalletDetails.address) {
                 inBrowserWalletDetails.isInitialized = true;
            } else {
                throw new Error("Invalid saved wallet structure");
            }
        } catch {
            localStorage.removeItem(LOCALSTORAGE_KEYS.IN_BROWSER_WALLET);
            inBrowserWalletDetails.isInitialized = false;
        }
    }

    if (!inBrowserWalletDetails.isInitialized) {
        try {
            const privateKey = _generatePrivateKey();
            const wallet = new ethers.Wallet(privateKey);
            inBrowserWalletDetails = {
                privateKey: privateKey,
                address: wallet.address,
                isInitialized: true
            };
            localStorage.setItem(LOCALSTORAGE_KEYS.IN_BROWSER_WALLET, JSON.stringify(inBrowserWalletDetails));
        } catch {
            inBrowserWalletDetails.isInitialized = false;
            return false;
        }
    }
    
    ethersProvider = new ethers.providers.JsonRpcProvider(BASE_RPC_URL);
    window.ethersProvider = ethersProvider;
    ethersSigner = new ethers.Wallet(inBrowserWalletDetails.privateKey, ethersProvider);
    
    ethereumClientInstance = {
        getAccount: () => ({
            isConnected: inBrowserWalletDetails.isInitialized,
            address: inBrowserWalletDetails.address,
            isConnecting: false,
            isDisconnected: !inBrowserWalletDetails.isInitialized,
            connector: { id: 'in-browser' }
        }),
        getNetwork: () => ({ chain: { id: BASE_CHAIN_ID } }),
        watchAccount: (callback) => {
            if (!ethereumClientInstance._callbacks) {
                ethereumClientInstance._callbacks = [];
            }
            ethereumClientInstance._callbacks.push(callback);
            
            if (inBrowserWalletDetails.isInitialized) {
                callback({
                    isConnected: true,
                    address: inBrowserWalletDetails.address,
                    isConnecting: false,
                    isDisconnected: false,
                    connector: { id: 'in-browser' }
                });
            }
        },
        getSigner: () => ethersSigner,
        switchChain: async () => ({ id: BASE_CHAIN_ID }),
        disconnect: async () => {
            // Will be implemented in disconnectInBrowserWallet
            return true;
        }
    };
    
    return true;
}








// --- External Wallet (Web3Modal) Logic ---
async function _setupWeb3Modal() {
    if (web3modalInstance) return true; // Already setup

    try {
        // Setup necessary process env for web3modal imports
        window.process = window.process || { env: { NODE_ENV: "development" } };

        // Import required libraries from CDN (using the exact code from wallet.js)
        const { EthereumClient, w3mConnectors, w3mProvider, WagmiCore: wagmiCore, WagmiCoreChains } = 
            await import('https://unpkg.com/@web3modal/ethereum@2.7.1');
        const { Web3Modal } = await import('https://unpkg.com/@web3modal/html@2.7.1');
        const { configureChains, createConfig, Chain } = wagmiCore;
        
        // Store the original WagmiCore for later use
        _WagmiCore = wagmiCore;
        
        // Define Base chain
        const base = {
            id: BASE_CHAIN_ID,
            name: 'Base',
            network: 'base',
            nativeCurrency: {
                decimals: 18,
                name: 'Ether',
                symbol: 'ETH',
            },
            rpcUrls: {
                public: { http: ['https://mainnet.base.org'] },
                default: { http: [BASE_RPC_URL] },
            },
            blockExplorers: {
                etherscan: { name: 'BaseScan', url: 'https://basescan.org' },
                default: { name: 'BaseScan', url: 'https://basescan.org' },
            }
        };

        // Configure chains
        const chains = [base];
        const { publicClient } = configureChains(chains, [w3mProvider({ projectId: WALLETCONNECT_PROJECT_ID })]);
        
        // Create wagmi config
        const wagmiConfig = createConfig({
            autoConnect: true,
            connectors: w3mConnectors({ projectId: WALLETCONNECT_PROJECT_ID, chains }),
            publicClient,
            defaultChain: base
        });
        
        // Create ethereum client
        ethereumClientInstance = new EthereumClient(wagmiConfig, chains);
        
        // Make it globally available
        window.ethereumClient = ethereumClientInstance;
        
        // Create Web3Modal instance
        web3modalInstance = new Web3Modal({
            projectId: WALLETCONNECT_PROJECT_ID,
            defaultChain: base,
            themeMode: 'dark',
            chainImages: {
                [BASE_CHAIN_ID]: 'https://raw.githubusercontent.com/base/brand-kit/refs/heads/main/logo/in-product/Base_Network_Logo.svg'
            }
        }, ethereumClientInstance);
        
        // Watch for account changes
        ethereumClientInstance.watchAccount(async (account) => {
            if (account.address && account.isConnected) {
                if (activeWalletType !== 'external' || (ethersSigner && await ethersSigner.getAddress() !== account.address)) {
                    // Switched to external or account changed
                    activeWalletType = 'external';
                    window.activeWalletType = activeWalletType; // Export to global for trollbox
                    localStorage.setItem(LOCALSTORAGE_KEYS.PREFERRED_WALLET_TYPE, 'external');
                    
                    // Set up providers 
                    try {
                        ethersProvider = new ethers.providers.JsonRpcProvider(BASE_RPC_URL);
                        window.ethersProvider = ethersProvider;
                        
                        ethersSigner = null; // Clear this to indicate we should use wagmi
                        
                        localStorage.setItem(LOCALSTORAGE_KEYS.PREFERRED_WALLET_TYPE, 'external');
                        await _updateWalletUI();
                    } catch (error) {
                        console.error("Error setting up providers during connect:", error);
                        if (!isAutoConnectAttempt) alert("Error connecting to wallet: " + error.message);
                    }
                }
            } else if (!account.isConnected && activeWalletType === 'external') {
                // Disconnected via external wallet's UI
                await disconnectExternalWallet();
            }
            await _updateWalletUI();
        });
        
        // Watch for network changes  
        ethereumClientInstance.watchNetwork(async (network) => {
            if (network && network.chain && activeWalletType === 'external') {
                if (network.chain.id !== BASE_CHAIN_ID) {
                    $('#connection-alert').text("Please switch to Base network in your wallet.").show();
                } else {
                    $('#connection-alert').hide();
                    // Keep read provider as Infura, refresh signing provider if needed
                    try {
                        ethersProvider = new ethers.providers.JsonRpcProvider(BASE_RPC_URL);
                        window.ethersProvider = ethersProvider; // Make available to other modules
                        
                        if (window.ethereum && ethersSigner) {
                            // Refresh the signer with the current ethereum provider
                            const signingProvider = new ethers.providers.Web3Provider(window.ethereum);
                            ethersSigner = signingProvider.getSigner();
                        }
                    } catch (error) {
                        console.error("Error refreshing provider after network change:", error);
                    }
                }
            }
            await _updateWalletUI();
        });
        
        return true;
    } catch (error) {
        console.error("Error setting up Web3Modal:", error);
        alert("Could not initialize WalletConnect: " + error.message);
        return false;
    }
}

async function connectExternalWallet(isAutoConnectAttempt = false) {
    
    // Always ensure Web3Modal is set up before attempting connection
    if (web3modalInstance == null) {

        const setupResult = await _setupWeb3Modal();
        if (!setupResult) {
            if (!isAutoConnectAttempt) alert("Failed to setup Web3Modal.");
            return;
        }
    }

    try {
        // If auto-connecting and already connected, EthereumClient might handle it.
        // For manual connection, always open modal.
        if (!isAutoConnectAttempt || !ethereumClientInstance.getAccount().isConnected) {
            web3modalInstance.openModal();
        }
    } catch (error) {
        console.error("Error opening Web3Modal or connecting:", error);
        if (!isAutoConnectAttempt) alert("Could not connect wallet: " + error.message);
        await _updateWalletUI(); // Ensure UI reflects disconnected state
    }
}

async function disconnectExternalWallet() {
    if (ethereumClientInstance && ethereumClientInstance.disconnect) {
        try {
            await ethereumClientInstance.disconnect();
        } catch (e) {
            console.error("Error during Web3Modal disconnect:", e);
        }
    }
    activeWalletType = null;
    window.activeWalletType = activeWalletType; // Export to global for trollbox
    localStorage.removeItem(LOCALSTORAGE_KEYS.PREFERRED_WALLET_TYPE);
    ethersProvider = null;
    window.ethersProvider = null; // Clear from window as well
    ethersSigner = null;
    await _updateWalletUI();
}

// --- Emulated WagmiCore Functions ---
WagmiCore.getAccount = () => {
    if (activeWalletType === 'in-browser' && inBrowserWalletDetails.isInitialized) {
        return { address: inBrowserWalletDetails.address, isConnected: true, connector: { id: 'in-browser' } };
    } else if (activeWalletType === 'external' && ethereumClientInstance) {
        const acc = ethereumClientInstance.getAccount();
        return { address: acc.address, isConnected: acc.isConnected, connector: { id: 'external' } };
    }
    return { address: null, isConnected: false };
};

WagmiCore.getNetwork = () => {
    // Always Base for this app
    return { chain: { id: BASE_CHAIN_ID, name: 'Base', unsupported: false } };
};

WagmiCore.switchNetwork = async (config) => {
    if (config.chainId !== BASE_CHAIN_ID) {
        throw new Error("Only Base network (8453) is supported.");
    }
    if (activeWalletType === 'external' && ethereumClientInstance) {
        try {
            await ethereumClientInstance.switchChain(BASE_CHAIN_ID);
            return WagmiCore.getNetwork().chain;
        } catch (error) {
            console.error("Failed to switch network via Web3Modal:", error);
            throw error;
        }
    } else if (activeWalletType === 'in-browser') {
        return WagmiCore.getNetwork().chain;
    }
    throw new Error("Cannot switch network. No active wallet or not an external wallet.");
};

WagmiCore.readContract = async (config) => {
    const { retryWithExponentialBackoff } = window.retryHelper;
    
    return retryWithExponentialBackoff(async () => {
        if (!ethersProvider) throw new Error("Wallet not connected or provider not available.");
        try {
            const contract = new ethers.Contract(config.address, config.abi, ethersProvider);
            const result = await contract[config.functionName](...(config.args || []));
            return result;
        } catch (error) {
            console.error("Error reading contract:", config, error);
            throw error;
        }
    }, {
        maxRetries: 3,
        baseDelayMs: 1000,
        maxDelayMs: 8000
    });
};

WagmiCore.readContracts = async (config) => {
    const { retryWithExponentialBackoff } = window.retryHelper;
    
    return retryWithExponentialBackoff(async () => {
        if (!ethersProvider) throw new Error("Wallet not connected or provider not available.");
        // Using the multicall implementation from wallet_inbrowser.js
        try {
            if (config.multicallAddress) {
                const multicallAbi = ["function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)"];
                const multicall = new ethers.Contract(config.multicallAddress, multicallAbi, ethersProvider);
                const calls = config.contracts.map(call => {
                    const contractInterface = new ethers.utils.Interface(call.abi); // Use Interface for encoding
                    const callData = contractInterface.encodeFunctionData(call.functionName, call.args || []);
                    return { target: call.address, callData };
                });
                const [, returnData] = await multicall.aggregate(calls);
                return config.contracts.map((call, i) => {
                    const contractInterface = new ethers.utils.Interface(call.abi);
                    try {
                        const result = contractInterface.decodeFunctionResult(call.functionName, returnData[i]);
                        return { result: result.length === 1 ? result[0] : result, status: 'success' };
                    } catch (error) {
                        console.error("Error decoding result for multicall contract", call.address, error);
                        return { status: 'failure', error };
                    }
                });
            } else { // Fallback to individual calls if no multicallAddress
                return Promise.all(
                    config.contracts.map(async (call) => {
                        try {
                            const contract = new ethers.Contract(call.address, call.abi, ethersProvider);
                            const result = await contract[call.functionName](...(call.args || []));
                            return { result, status: 'success' };
                        } catch (error) {
                            console.error("Error calling contract individually", call.address, error);
                            return { status: 'failure', error };
                        }
                    })
                );
            }
        } catch (error) {
            console.error("Error in readContracts:", error);
            throw error;
        }
    }, {
        maxRetries: 3,
        baseDelayMs: 1000,
        maxDelayMs: 8000
    });
};

WagmiCore.writeContract = async (config) => {
    if (activeWalletType === 'in-browser') {
        // Use ethers for in-browser wallet
        if (!ethersSigner) throw new Error("In-browser wallet not connected or signer not available.");
        
        try {
            const contract = new ethers.Contract(config.address, config.abi, ethersSigner);
            const currentNonce = await ethersProvider.getTransactionCount(inBrowserWalletDetails.address, "latest");
            const feeData = await ethersProvider.getFeeData();
            const overrides = {
                gasLimit: config.gas || 1000000,
                nonce: currentNonce,
                maxPriorityFeePerGas: ethers.utils.parseUnits("50", "wei"),
                maxFeePerGas: feeData.gasPrice ? feeData.gasPrice.mul(12).div(10) : ethers.utils.parseUnits("100", "gwei"),
                type: 2,
                ...(config.overrides || {})
            };
            const tx = await contract[config.functionName](...(config.args || []), overrides);
            
            // Track transaction with notification system
            if (window.txNotifications) {
                window.txNotifications.trackTransaction(
                    tx.hash, 
                    config.functionName, 
                    config.args, 
                    config.address
                );
            }
            
            return { hash: tx.hash, wait: (confirmations) => ethersProvider.waitForTransaction(tx.hash, confirmations || 1) };
        } catch (error) {
            console.error("Error in in-browser writeContract:", error);
            throw error;
        }
        
    } else if (activeWalletType === 'external') {
        // Use wagmi's native writeContract for external wallets
        try {
            
            if (!_WagmiCore) throw new Error("WagmiCore not available");
            
            // Use the original wagmi writeContract function
            const result = await _WagmiCore.writeContract({
                address: config.address,
                abi: config.abi,
                functionName: config.functionName,
                args: config.args || [],
                gas: config.gas,
                ...config.overrides
            });
            
            
            // Track transaction with notification system
            if (window.txNotifications) {
                window.txNotifications.trackTransaction(
                    result.hash, 
                    config.functionName, 
                    config.args, 
                    config.address
                );
            }
            
            return result;
        } catch (error) {
            console.error("Error in external wallet writeContract:", error);
            throw error;
        }
    }
    
    throw new Error("No wallet connected");
};

WagmiCore.waitForTransaction = async (config) => {
    if (activeWalletType === 'in-browser') {
        // Use ethers for in-browser wallet
        if (!ethersProvider) throw new Error("Wallet not connected or provider not available.");
        try {
            const receipt = await ethersProvider.waitForTransaction(config.hash, config.confirmations || 1);
            
            // Update transaction status using robust status checker
            if (window.txNotifications) {
                const isSuccess = window.txNotifications.isTransactionSuccessful(receipt);
                const status = isSuccess ? window.txNotifications.TX_STATUS.CONFIRMED : window.txNotifications.TX_STATUS.FAILED;
                window.txNotifications.updateTransactionStatus(config.hash, status, receipt);
            }
            
            return receipt;
        } catch (error) {
            console.error("❌ Error waiting for transaction:", error);
            
            // Try to get receipt directly as fallback for RPC issues
            if (window.txNotifications) {
                const fallbackSuccess = await window.txNotifications.checkTransactionStatusFromBlockchain(config.hash);
                if (!fallbackSuccess) {
                    // Only mark as failed if we couldn't get blockchain status
                    window.txNotifications.updateTransactionStatus(config.hash, window.txNotifications.TX_STATUS.FAILED);
                }
            }
            
            throw error;
        }
    } else if (activeWalletType === 'external') {
        // Use wagmi's native waitForTransaction for external wallets
        try {
            if (!_WagmiCore) throw new Error("WagmiCore not available");
            
            const receipt = await _WagmiCore.waitForTransaction({
                hash: config.hash,
                confirmations: config.confirmations || 1
            });
            
            // Update transaction status using robust status checker
            if (window.txNotifications) {
                const isSuccess = window.txNotifications.isTransactionSuccessful(receipt);
                const status = isSuccess ? window.txNotifications.TX_STATUS.CONFIRMED : window.txNotifications.TX_STATUS.FAILED;
                window.txNotifications.updateTransactionStatus(config.hash, status, receipt);
            }
            
            return receipt;
        } catch (error) {
            console.error("❌ Error waiting for transaction with wagmi:", error);
            
            // Try to get receipt directly as fallback for RPC issues
            if (window.txNotifications) {
                const fallbackSuccess = await window.txNotifications.checkTransactionStatusFromBlockchain(config.hash);
                if (!fallbackSuccess) {
                    // Only mark as failed if we couldn't get blockchain status
                    window.txNotifications.updateTransactionStatus(config.hash, window.txNotifications.TX_STATUS.FAILED);
                }
            }
            
            throw error;
        }
    }
    
    throw new Error("No wallet connected");
};

// prepareSendTransaction is more complex if it needs to align with Wagmi's exact return structure.
// The existing wallet_inbrowser.js has a version. Let's adapt that.
// This is mainly used if app.js calls prepareSendTransaction then sendTransaction.
// If app.js directly calls writeContract, this might be less critical.
WagmiCore.prepareSendTransaction = async (txData) => {
    if (!ethersSigner) throw new Error("Wallet not connected or signer not available.");
    // txData usually includes { to, value, data }
    // This function in Wagmi typically returns a config that can be passed to a sendTransaction action.
    // Here, we'll return an object with a sendTransaction method.
    return {
        request: txData, // The original request
        mode: 'prepared',
        sendTransaction: async () => {
            if (activeWalletType === 'in-browser') {
                const wallet = new ethers.Wallet(inBrowserWalletDetails.privateKey, ethersProvider);
                const tx = await wallet.sendTransaction({
                    to: txData.to,
                    value: txData.value || 0,
                    data: txData.data || '0x',
                    // Add nonce and gas for in-browser as in writeContract
                    nonce: await ethersProvider.getTransactionCount(inBrowserWalletDetails.address, "latest"),
                    maxPriorityFeePerGas: ethers.utils.parseUnits("50", "wei"),
                    maxFeePerGas: (await ethersProvider.getFeeData()).gasPrice.mul(12).div(10),
                    type: 2,
                });
                return { hash: tx.hash };
            } else { // External wallet
                const tx = await ethersSigner.sendTransaction({
                    to: txData.to,
                    value: txData.value || 0,
                    data: txData.data || '0x',
                });
                return { hash: tx.hash };
            }
        }
    };
};

// Add ETH to WETH wrapping function
WagmiCore.wrapETH = async (ethAmount) => {
    const WETH_ADDRESS = '0x4200000000000000000000000000000000000006'; // Base WETH address
    const WETH_ABI = [
        {
            "inputs": [],
            "name": "deposit",
            "outputs": [],
            "stateMutability": "payable",
            "type": "function"
        },
        {
            "inputs": [
                {
                    "internalType": "uint256",
                    "name": "wad",
                    "type": "uint256"
                }
            ],
            "name": "withdraw",
            "outputs": [],
            "stateMutability": "nonpayable",
            "type": "function"
        },
        {
            "inputs": [
                {
                    "internalType": "address",
                    "name": "",
                    "type": "address"
                }
            ],
            "name": "balanceOf",
            "outputs": [
                {
                    "internalType": "uint256",
                    "name": "",
                    "type": "uint256"
                }
            ],
            "stateMutability": "view",
            "type": "function"
        }
    ];
    
    if (!ethAmount || parseFloat(ethAmount) <= 0) {
        throw new Error("Invalid ETH amount");
    }

    const ethAmountWei = ethers.utils.parseEther(ethAmount.toString());

    if (activeWalletType === 'in-browser') {
        if (!ethersSigner) throw new Error("In-browser wallet not connected");
        
        try {
            const wethContract = new ethers.Contract(WETH_ADDRESS, WETH_ABI, ethersSigner);
            const currentNonce = await ethersProvider.getTransactionCount(inBrowserWalletDetails.address, "latest");
            const feeData = await ethersProvider.getFeeData();
            
            const tx = await wethContract.deposit({
                value: ethAmountWei,
                gasLimit: 50000, // WETH deposit uses ~27k gas
                nonce: currentNonce,
                maxPriorityFeePerGas: ethers.utils.parseUnits("50", "wei"),
                maxFeePerGas: feeData.gasPrice ? feeData.gasPrice.mul(12).div(10) : ethers.utils.parseUnits("100", "gwei"),
                type: 2
            });
            
            // Track transaction with notification system
            if (window.txNotifications) {
                window.txNotifications.trackTransaction(
                    tx.hash, 
                    'deposit', 
                    [], 
                    WETH_ADDRESS
                );
            }
            
            return { hash: tx.hash, wait: (confirmations) => ethersProvider.waitForTransaction(tx.hash, confirmations || 1) };
        } catch (error) {
            console.error("Error wrapping ETH with in-browser wallet:", error);
            throw error;
        }
        
    } else if (activeWalletType === 'external') {
        try {
            
            if (!_WagmiCore) throw new Error("WagmiCore not available");
            
            // Use wagmi's writeContract for external wallets
            const result = await _WagmiCore.writeContract({
                address: WETH_ADDRESS,
                abi: WETH_ABI,
                functionName: 'deposit',
                value: ethAmountWei,
                gas: 50000
            });
                    
            // Track transaction with notification system
            if (window.txNotifications) {
                window.txNotifications.trackTransaction(
                    result.hash, 
                    'deposit', 
                    [], 
                    WETH_ADDRESS
                );
            }
            
            return result;
        } catch (error) {
            console.error("Error wrapping ETH with external wallet:", error);
            throw error;
        }
    }
    
    throw new Error("No wallet connected");
};

// Add helper function to get ETH balance
WagmiCore.getETHBalance = async (address) => {
    if (!ethersProvider) throw new Error("Provider not available");
    
    try {
        const balance = await ethersProvider.getBalance(address || state.connectedAddress);
        return balance;
    } catch (error) {
        console.error("Error getting ETH balance:", error);
        throw error;
    }
};

// --- Main Initialization ---
async function initializeWalletSystem() {
    // Add explicit global assignment to ensure it's available
    window.ethereumClient = null;
    
    // Attach event listeners to the new connect buttons
    $('#connect-web3modal-btn').on('click', () => connectExternalWallet(false));
    $('#disconnect-wallet-btn').on('click', async () => {
        if (activeWalletType === 'external') {
            await disconnectExternalWallet();
        }
    });

    // Show the buttons immediately instead of keeping them hidden
    $('#connect-web3modal-btn').show();

    const preferredType = localStorage.getItem(LOCALSTORAGE_KEYS.PREFERRED_WALLET_TYPE);
    
    if (preferredType === 'external') {
        await _setupWeb3Modal(); // Ensure Web3Modal is set up before auto-connecting
        await connectExternalWallet(true);
    }

    if (!activeWalletType) { // If no auto-connection happened
      await _updateWalletUI(); // Show initial connect buttons
    }
    
    // Initialize transaction notification system
    if (window.txNotifications) {
        window.txNotifications.initializeTransactionNotifications();
    }
}

// Add a connectWallet function to maintain compatibility with ui_interactions.js
async function connectWallet() {
    // Check if we already have an active wallet connection
    if (activeWalletType) {
        return;
    }
    
    // If no active wallet, check for preferred type or default to external
    const preferredType = localStorage.getItem(LOCALSTORAGE_KEYS.PREFERRED_WALLET_TYPE);
    
    if (preferredType === 'in-browser') {
        await activateInBrowserWallet(false);
    } else {
        // Default to external wallet for backward compatibility
        await connectExternalWallet(false);
    }
}

// Initialize when the script loads
$(document).ready(async () => {
    // Ensure ethers is loaded
    if (typeof ethers === 'undefined') {
        console.error("Ethers.js not loaded. Wallet functionality will be impaired.");
        $('#connection-alert').text("Critical error: Ethers.js library not found.").show();
        return;
    }
    
    // Initialize WagmiCore immediately to ensure it's available
    window.WagmiCore = WagmiCore;
    
    // Export wallet state variables to global window for trollbox integration
    window.activeWalletType = activeWalletType;
    window.inBrowserWalletDetails = inBrowserWalletDetails;
    window.ethereumClientInstance = ethereumClientInstance;
    
    await initializeWalletSystem();

    // Add this to your document.ready function
    $('#connect-wallet').on('click', () => connectWallet());
});
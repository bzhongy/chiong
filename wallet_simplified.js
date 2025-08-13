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
    PREFERRED_WALLET_TYPE: 'chiong_preferred_wallet_type'
};

// --- State Variables ---
let activeWalletType = null;
let ethersProvider = null;
let ethersSigner = null;
let web3modalInstance = null;
let ethereumClientInstance = null;
let _WagmiCore = null;

// --- Globals for compatibility ---
window.WagmiCore = {};
let WagmiCore = window.WagmiCore;

// --- Utility Functions ---
function shortenAddress(address) {
    return address ? `${address.substring(0, 6)}...${address.substring(address.length - 4)}` : "";
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
    
    if (activeWalletType && ethereumClientInstance && ethereumClientInstance.getAccount().isConnected) {
        walletStatusEl.classList.remove('not-connected');
        walletStatusEl.classList.add('connected');
        connectWeb3ModalBtn.style.display = 'none';
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
        
        if (currentAddress) {
            addressDisplayEl.textContent = shortenAddress(currentAddress);
            state.connectedAddress = currentAddress;
        }
        document.getElementById('connection-alert').style.display = 'none';

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

// --- External Wallet (Web3Modal) Logic ---
async function _setupWeb3Modal() {
    if (web3modalInstance) return true; // Already setup

    try {
        const { EthereumClient, w3mConnectors, w3mProvider } = window.Web3ModalEthereum;
        const { Web3Modal } = window.Web3Modal;
        const { configureChains, createConfig } = window.Wagmi;
        const { mainnet, polygon, avalanche, arbitrum, base } = window.WagmiChains;

        const chains = [base];
        const projectId = WALLETCONNECT_PROJECT_ID;

        const { publicClient } = configureChains(chains, [w3mProvider({ projectId })]);
        const wagmiConfig = createConfig({
            autoConnect: false,
            connectors: w3mConnectors({ projectId, chains }),
            publicClient
        });
        
        ethereumClientInstance = new EthereumClient(wagmiConfig, chains);
        web3modalInstance = new Web3Modal({ projectId }, ethereumClientInstance);
        
        _WagmiCore = window.WagmiCore; // Save reference to actual WagmiCore
        
        // Set up account watching
        ethereumClientInstance.watchAccount((account) => {
            if (account.isConnected && account.address) {
                _onExternalWalletConnected(account);
            } else {
                _onWalletDisconnected();
            }
        });
        
        window.ethereumClient = ethereumClientInstance;
        window.wagmiConfig = wagmiConfig;
        
        return true;
    } catch (error) {
        console.error("Failed to set up Web3Modal:", error);
        return false;
    }
}

async function _onExternalWalletConnected(account) {
    activeWalletType = 'external';
    window.activeWalletType = activeWalletType;
    localStorage.setItem(LOCALSTORAGE_KEYS.PREFERRED_WALLET_TYPE, 'external');
    
    try {
        const provider = await ethereumClientInstance.getWalletClient();
        if (provider) {
            ethersProvider = new ethers.providers.Web3Provider(provider);
            window.ethersProvider = ethersProvider;
            ethersSigner = ethersProvider.getSigner();
        }
    } catch (error) {
        console.error("Failed to get provider/signer:", error);
        ethersProvider = new ethers.providers.JsonRpcProvider(BASE_RPC_URL);
        window.ethersProvider = ethersProvider;
        ethersSigner = null;
    }
    
    await _updateWalletUI();
}

async function _onWalletDisconnected() {
    activeWalletType = null;
    window.activeWalletType = activeWalletType;
    ethersProvider = null;
    window.ethersProvider = null;
    ethersSigner = null;
    
    await _updateWalletUI();
}

async function connectExternalWallet(isAutoConnectAttempt = false) {
    if (!await _setupWeb3Modal()) {
        if (!isAutoConnectAttempt) {
            alert("Failed to initialize Web3Modal");
        }
        return false;
    }
    
    try {
        if (!isAutoConnectAttempt) {
            web3modalInstance.openModal();
        } else {
            // For auto-connect, check if already connected
            const account = ethereumClientInstance.getAccount();
            if (account.isConnected) {
                await _onExternalWalletConnected(account);
                return true;
            }
        }
        return true;
    } catch (error) {
        console.error("Error connecting external wallet:", error);
        if (!isAutoConnectAttempt) {
            document.getElementById('connection-alert').textContent = "Error connecting wallet: " + error.message;
            document.getElementById('connection-alert').style.display = 'block';
        }
        return false;
    }
}

async function disconnectExternalWallet() {
    if (ethereumClientInstance) {
        try {
            await ethereumClientInstance.disconnect();
        } catch (e) {
            console.error("Error during Web3Modal disconnect:", e);
        }
    }
    activeWalletType = null;
    window.activeWalletType = activeWalletType;
    localStorage.removeItem(LOCALSTORAGE_KEYS.PREFERRED_WALLET_TYPE);
    ethersProvider = null;
    window.ethersProvider = null;
    ethersSigner = null;
    await _updateWalletUI();
}

// --- Emulated WagmiCore Functions ---
WagmiCore.getAccount = () => {
    if (activeWalletType === 'external' && ethereumClientInstance) {
        const acc = ethereumClientInstance.getAccount();
        return { address: acc.address, isConnected: acc.isConnected, connector: { id: 'external' } };
    }
    return { address: null, isConnected: false };
};

WagmiCore.getNetwork = () => {
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
    }
    return WagmiCore.getNetwork().chain;
};

WagmiCore.readContract = async (config) => {
    if (_WagmiCore && _WagmiCore.readContract) {
        return await _WagmiCore.readContract(config);
    } else {
        // Fallback using ethers
        try {
            const provider = ethersProvider || new ethers.providers.JsonRpcProvider(BASE_RPC_URL);
            const contract = new ethers.Contract(config.address, config.abi, provider);
            return await contract[config.functionName](...(config.args || []));
        } catch (error) {
            console.error("Error reading contract:", error);
            throw error;
        }
    }
};

WagmiCore.readContracts = async (config) => {
    if (_WagmiCore && _WagmiCore.readContracts) {
        return await _WagmiCore.readContracts(config);
    } else {
        // Fallback implementation
        const provider = ethersProvider || new ethers.providers.JsonRpcProvider(BASE_RPC_URL);
        const results = await Promise.all(
            config.contracts.map(async (call) => {
                try {
                    const contract = new ethers.Contract(call.address, call.abi, provider);
                    const result = await contract[call.functionName](...(call.args || []));
                    return { result, status: 'success' };
                } catch (error) {
                    return { status: 'failure', error };
                }
            })
        );
        return results;
    }
};

WagmiCore.writeContract = async (config) => {
    if (activeWalletType === 'external' && _WagmiCore && _WagmiCore.writeContract) {
        return await _WagmiCore.writeContract(config);
    } else {
        throw new Error("No wallet connected or write capability not available.");
    }
};

WagmiCore.waitForTransaction = async (config) => {
    if (_WagmiCore && _WagmiCore.waitForTransaction) {
        return await _WagmiCore.waitForTransaction(config);
    } else {
        const provider = ethersProvider || new ethers.providers.JsonRpcProvider(BASE_RPC_URL);
        try {
            const receipt = await provider.waitForTransaction(
                config.hash, 
                config.confirmations || 1
            );
            return receipt;
        } catch (error) {
            console.error("Error waiting for transaction:", error);
            throw error;
        }
    }
};

WagmiCore.prepareSendTransaction = async (txData) => {
    return {
        mode: 'prepared',
        sendTransaction: async () => {
            if (activeWalletType === 'external' && _WagmiCore && _WagmiCore.sendTransaction) {
                return await _WagmiCore.sendTransaction(txData);
            } else {
                throw new Error("No external wallet connected for transaction sending.");
            }
        }
    };
};

WagmiCore.sendTransaction = async (txData) => {
    if (activeWalletType === 'external' && _WagmiCore && _WagmiCore.sendTransaction) {
        return await _WagmiCore.sendTransaction(txData);
    } else {
        throw new Error("No external wallet connected for transaction sending.");
    }
};

async function wrapETH(ethAmount) {
    const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
    const WETH_ABI = [
        "function deposit() payable",
        "function withdraw(uint256) external",
        "function balanceOf(address) view returns (uint256)"
    ];
    
    const ethAmountWei = ethers.utils.parseEther(ethAmount.toString());

    if (activeWalletType === 'external' && _WagmiCore && _WagmiCore.writeContract) {
        return await _WagmiCore.writeContract({
            address: WETH_ADDRESS,
            abi: WETH_ABI,
            functionName: 'deposit',
            value: ethAmountWei
        });
    } else {
        throw new Error("No external wallet connected for wrapping ETH");
    }
}

// --- Main Initialization ---
async function initializeWalletSystem() {
    window.ethereumClient = null;
    
    // Attach event listeners to the connect button
    $('#connect-web3modal-btn').on('click', () => connectExternalWallet(false));
    $('#disconnect-wallet-btn').on('click', async () => {
        if (activeWalletType === 'external') {
            await disconnectExternalWallet();
        }
    });

    // Show the button immediately instead of keeping it hidden
    $('#connect-web3modal-btn').show();

    const preferredType = localStorage.getItem(LOCALSTORAGE_KEYS.PREFERRED_WALLET_TYPE);
    
    if (preferredType === 'external') {
        await _setupWeb3Modal();
        await connectExternalWallet(true);
    }

    if (!activeWalletType) {
      await _updateWalletUI();
    }
    
    if (window.txNotifications) {
        window.txNotifications.initializeTransactionNotifications();
    }
}

// Add a connectWallet function to maintain compatibility with ui_interactions.js
async function connectWallet() {
    return await connectExternalWallet(false);
}

// Global assignments for compatibility
window.activeWalletType = activeWalletType;
window.ethereumClientInstance = ethereumClientInstance;
window.connectWallet = connectWallet;
window.initializeWalletSystem = initializeWalletSystem;
window.shortenAddress = shortenAddress;
window.wrapETH = wrapETH;

// Auto-initialize on load
$(document).ready(function() {
    initializeWalletSystem().catch(console.error);
});

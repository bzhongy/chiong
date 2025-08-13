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

let web3modal;
let ethereumClient;
let wagmiConfig;
let WagmiCore;

// Utility function to shorten wallet addresses
function shortenAddress(address) {
    return address ? `${address.substring(0, 6)}...${address.substring(address.length - 4)}` : "";
}

async function setupWeb3Modal() {
    // Setup for Web3Modal with WalletConnect
    window.process = { env: { NODE_ENV: "development" } };
    
    // Import required libraries from CDN
    const { EthereumClient, w3mConnectors, w3mProvider, WagmiCore: wagmiCore, WagmiCoreChains } = await import('https://unpkg.com/@web3modal/ethereum@2.7.1');
        const { Web3Modal } = await import('https://unpkg.com/@web3modal/html@2.7.1');
        const { configureChains, createConfig, Chain } = wagmiCore;
        
    WagmiCore = wagmiCore;  
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
        default: { http: ['https://base-mainnet.infura.io/v3/31b32a8cde404894ab67544e011510b9'] },
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
        const { getNetwork, switchNetwork } = WagmiCore;      
        network = getNetwork();

        if (network.chain?.id !== 8453) {
            console.log("Wrong network detected, switching to Base...");
            switchNetwork({ chainId: 8453 }).catch(error => {
                console.error("Failed to switch network:", error);
                // Show a friendly error message
                $('#connection-alert').text("Please switch to Base network in your wallet.").show();
            });
        }
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
    if (!web3modal) {
      await setupWeb3Modal();
    }
    
    if (ethereumClient && !ethereumClient.getAccount().isConnected) {
      // Open modal with Base chain pre-selected
      web3modal.openModal({
        route: 'ConnectWallet',
        params: {
          chainId: 8453
        }
      });
    }
  } catch (error) {
    console.error("Error connecting wallet:", error);
    document.getElementById('connection-alert').style.display = 'block';
  }
}

// Disconnect wallet function
async function disconnectWallet() {
  try {
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

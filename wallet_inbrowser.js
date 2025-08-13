/**
 * CHIONG IN-BROWSER WALLET MODULE
 * 
 * In-browser wallet implementation compatible with your app.
 */

let web3modal;
let ethereumClient;
let wagmiConfig;
let WagmiCore;
let inBrowserWallet = {
  privateKey: null,
  address: null,
  isInitialized: false
};

// Initialize our wallet
function initializeInBrowserWallet() {
  // Check if we already have a wallet stored
          const savedWallet = localStorage.getItem('chiong_browser_wallet');
  
  if (savedWallet) {
    try {
      inBrowserWallet = JSON.parse(savedWallet);
      console.log("In-browser wallet loaded from storage");
      return true;
    } catch (e) {
      console.error("Error loading saved wallet:", e);
    }
  }
  
  // If no wallet exists, create a new one
  try {
    // Generate random private key
    const privateKey = generatePrivateKey();
    
    // Use ethers which is already loaded in your HTML
    const wallet = new ethers.Wallet(privateKey);
    
    inBrowserWallet = {
      privateKey: privateKey,
      address: wallet.address,
      isInitialized: true
    };
    
    // Save to localStorage
            localStorage.setItem('chiong_browser_wallet', JSON.stringify(inBrowserWallet));
    
    console.log("Created new in-browser wallet:", wallet.address);
    return true;
  } catch (e) {
    console.error("Error creating wallet:", e);
    return false;
  }
}

// Generate a private key using the Web Crypto API
function generatePrivateKey() {
  const array = new Uint8Array(32);
  window.crypto.getRandomValues(array);
  return '0x' + Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function setupWeb3Modal() {
  // Get window.ethers from your app's script load
  if (!window.ethers) {
    console.error("Ethers.js library not found. Make sure it's loaded.");
    return false;
  }

  // Initialize wallet first
  initializeInBrowserWallet();
  
  // Setup necessary process env for web3modal imports
  window.process = { env: { NODE_ENV: "development" } };

  // Use the core WagmiCore object first
  WagmiCore = {
    getNetwork: () => ({ chain: { id: 8453 } }),
    switchNetwork: async () => true,
    prepareSendTransaction: async (txData) => {
      return {
        sendTransaction: async () => signAndSendTransaction(txData)
      };
    },
    // Add standard getAccount method
    getAccount: () => {
      return {
        address: inBrowserWallet.address,
        isConnected: inBrowserWallet.isInitialized
      };
    },
    // Create a minimal readContract implementation
    readContract: async (config) => {
      try {
        const provider = new ethers.providers.JsonRpcProvider('https://base-mainnet.infura.io/v3/31b32a8cde404894ab67544e011510b9');
        const contract = new ethers.Contract(config.address, config.abi, provider);
        return await contract[config.functionName](...(config.args || []));
      } catch (error) {
        console.error("Error reading contract:", error);
        throw error;
      }
    },
    // Add readContracts for multicall support with retry logic
    readContracts: async (config) => {
      const { retryWithExponentialBackoff } = window.retryHelper;
      
      return retryWithExponentialBackoff(async () => {
        try {
          // Create provider
          const provider = new ethers.providers.JsonRpcProvider('https://base-mainnet.infura.io/v3/31b32a8cde404894ab67544e011510b9');
          
          // Handle multicalls
          if (config.multicallAddress) {
            // Create a multicall contract interface
            const multicallAbi = [
              "function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)"
            ];
            const multicall = new ethers.Contract(config.multicallAddress, multicallAbi, provider);
            
            // Prepare calls for multicall format
            const calls = config.contracts.map(call => {
              const contract = new ethers.Contract(call.address, call.abi, provider);
              const callData = contract.interface.encodeFunctionData(call.functionName, call.args || []);
              return {
                target: call.address,
                callData
              };
            });
            
            // Execute multicall
            const [blockNumber, returnData] = await multicall.aggregate(calls);
            
            // Decode results
            return config.contracts.map((call, i) => {
              const contract = new ethers.Contract(call.address, call.abi, provider);
              try {
                const result = contract.interface.decodeFunctionResult(call.functionName, returnData[i]);
                return { 
                  result: result.length === 1 ? result[0] : result,
                  status: 'success'
                };
              } catch (error) {
                console.error("Error decoding result for contract", call.address, error);
                return { status: 'failure', error };
              }
            });
          } else {
            // If no multicall, execute contracts individually
            const results = await Promise.all(
              config.contracts.map(async (call) => {
                try {
                  const contract = new ethers.Contract(call.address, call.abi, provider);
                  const result = await contract[call.functionName](...(call.args || []));
                  return { result, status: 'success' };
                } catch (error) {
                  console.error("Error calling contract", call.address, error);
                  return { status: 'failure', error };
                }
              })
            );
            return results;
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
    },
    // Add writeContract implementation for contract transactions
    writeContract: async (config) => {
      try {
        console.log("Writing to contract with config:", config);
        
        const provider = new ethers.providers.JsonRpcProvider('https://base-mainnet.infura.io/v3/31b32a8cde404894ab67544e011510b9');
        
        // Create wallet with private key
        const wallet = new ethers.Wallet(inBrowserWallet.privateKey, provider);
        
        // Get the current nonce for this wallet
        const currentNonce = await provider.getTransactionCount(wallet.address, "latest");
        console.log("Current nonce for wallet:", currentNonce);
        
        // Create contract instance connected to wallet
        const contract = new ethers.Contract(config.address, config.abi, wallet);
        
        // Get gas price estimate from the network
        const feeData = await provider.getFeeData();
        
        // Prepare transaction overrides with correct nonce and Base-specific gas parameters
        const overrides = {
          gasLimit: config.gas || 1000000, // Set reasonable gas limit if not provided
          nonce: currentNonce, // Use current nonce from network
          maxPriorityFeePerGas: ethers.utils.parseUnits("50", "wei"), // 50 wei as requested
          maxFeePerGas: parseInt(feeData.gasPrice * 1.2), // Use network estimated max fee
          type: 2, // Ensure we're using EIP-1559 transaction type
          ...(config.overrides || {})
        };
        console.log("Sending transaction with overrides:", overrides);
        
        // Execute transaction with overrides
        const tx = await contract[config.functionName](...(config.args || []), overrides);
        
        console.log("Transaction sent:", tx);
        console.log("Transaction hash:", tx.hash);
        
        return {
          hash: tx.hash,
          wait: () => tx.wait() // Return the wait function from ethers
        };
      } catch (error) {
        console.error("Error in writeContract:", error);
        throw error;
      }
    },
    // Add waitForTransaction implementation with retry logic
    waitForTransaction: async (config) => {
      const { retryWithExponentialBackoff } = window.retryHelper;
      
      return retryWithExponentialBackoff(async () => {
        try {
          const provider = new ethers.providers.JsonRpcProvider('https://base-mainnet.infura.io/v3/31b32a8cde404894ab67544e011510b9');
          
          // Wait for transaction receipt
          const receipt = await provider.waitForTransaction(
            config.hash, 
            config.confirmations || 1
          );
          
          return receipt;
        } catch (error) {
          console.error("Error waiting for transaction:", error);
          throw error;
        }
      }, {
        maxRetries: 3,
        baseDelayMs: 1000,
        maxDelayMs: 8000
      });
    }
  };
  
  // Create a minimal ethereumClient 
  ethereumClient = {
    getAccount: () => ({
      isConnected: inBrowserWallet.isInitialized,
      address: inBrowserWallet.address
    }),
    watchAccount: (callback) => {
      ethereumClient._onAccountChange = callback;
      
      // Setup the watchAccount handler similar to the original
      // This is where the UI gets updated based on connection state
      callback({
        isConnected: inBrowserWallet.isInitialized,
        address: inBrowserWallet.address
      });
    }
  };
  
  // Create minimal web3modal
  web3modal = {
    openModal: function() {
      console.log("Using in-browser wallet");
      // Trigger connection immediately
      if (ethereumClient && typeof ethereumClient._onAccountChange === 'function') {
        ethereumClient._onAccountChange({
          isConnected: true,
          address: inBrowserWallet.address
        });
      }
    }
  };
  
  // Set up account change listener
  ethereumClient.watchAccount((account) => {
    if (account.isConnected) {
      // Update UI for connected state
      document.getElementById('wallet-status').classList.remove('not-connected');
      document.getElementById('wallet-status').classList.add('connected');
      document.getElementById('connect-wallet').style.display = 'none';
      document.querySelector('.connected-details').style.display = 'flex';
      
      // Show address in UI
      const shortAddress = shortenAddress(account.address);
      document.getElementById('address-display').textContent = shortAddress;

      // Add a save button if it doesn't exist yet
      if (!document.getElementById('save-private-key')) {
        const saveButton = document.createElement('button');
        saveButton.id = 'save-private-key';
        saveButton.className = 'btn btn-sm btn-outline-secondary ms-2';
        saveButton.innerHTML = '<i class="bi bi-save"></i> Save Key';
        saveButton.title = 'Copy private key to clipboard';
        saveButton.style.fontSize = '0.7rem';
        saveButton.style.padding = '0.15rem 0.4rem';
        
        // Insert after address display
        const addressDisplay = document.getElementById('address-display');
        addressDisplay.parentNode.insertBefore(saveButton, addressDisplay.nextSibling);
        
        // Add click handler for the save button
        $('#save-private-key').on('click', function(e) {
          e.stopPropagation(); // Prevent event bubbling
          
          // Show confirmation dialog
          if (confirm('This will copy your PRIVATE KEY to clipboard. Never share your private key with anyone! Are you sure you want to proceed?')) {
            // Copy the private key to clipboard
            navigator.clipboard.writeText(inBrowserWallet.privateKey)
              .then(() => {
                alert('⚠️ IMPORTANT: Private key copied to clipboard.\n\nStore this safely and never share it with anyone!\n\nPrivate Key: ' + inBrowserWallet.privateKey);
              })
              .catch(err => {
                console.error('Failed to copy private key: ', err);
                alert('Could not copy private key: ' + err);
              });
          }
          
          // Add visual feedback
          const element = $(this);
          const originalBackground = element.css('background-color');
          element.css('background-color', '#FFC107'); // Yellow warning flash
          
          setTimeout(() => {
            element.css('background-color', originalBackground); // Revert back
          }, 300);
        });
      }

      // Make address display clickable to copy to clipboard
      $('#address-display').off('click').on('click', function() {
        // Copy the full address to clipboard
        navigator.clipboard.writeText(account.address)
          .then(() => {
            // Show a success alert
            alert(`Address copied to clipboard: ${account.address}`);
          })
          .catch(err => {
            console.error('Failed to copy address: ', err);
            alert('Could not copy address: ' + err);
          });
        
        // Add a visual feedback by briefly changing the style
        const element = $(this);
        const originalBackground = element.css('background-color');
        element.css('background-color', '#4CAF50'); // Green flash
        
        setTimeout(() => {
          element.css('background-color', originalBackground); // Revert back
        }, 300);
      });
      
      // Update the global state with the connected address
      state.connectedAddress = account.address;
      document.getElementById('connection-alert').style.display = 'none';

      // Call refreshData function if it exists
      if (typeof refreshData === 'function') {
        refreshData();
      }
      
      // Check if we're on the correct network
      const network = WagmiCore.getNetwork();
      if (network.chain?.id !== 8453) {
        console.log("Wrong network detected, switching to Base...");
        WagmiCore.switchNetwork({ chainId: 8453 }).catch(error => {
          console.error("Failed to switch network:", error);
          // Show a friendly error message
          $('#connection-alert').text("Please switch to Base network in your wallet.").show();
        });
      }
    } else {
      // Update UI for disconnected state
      document.getElementById('wallet-status').classList.add('not-connected');
      document.getElementById('wallet-status').classList.remove('connected');
      document.getElementById('connect-wallet').style.display = 'block';
      document.querySelector('.connected-details').style.display = 'none';
      
      // Update the global state
      state.connectedAddress = null;
      
      // Remove save button if it exists
      const saveButton = document.getElementById('save-private-key');
      if (saveButton) {
        saveButton.parentNode.removeChild(saveButton);
      }
    }
  });
  
  return true;
}

// Sign and send a transaction with ethers
async function signAndSendTransaction(txData) {
  try {
    const provider = new ethers.providers.JsonRpcProvider('https://base-mainnet.infura.io/v3/31b32a8cde404894ab67544e011510b9');
    const wallet = new ethers.Wallet(inBrowserWallet.privateKey, provider);
    
    // Send transaction
    const tx = await wallet.sendTransaction({
      to: txData.to,
      value: txData.value || 0,
      data: txData.data || '0x',
    });
    
    return tx.hash;
  } catch (e) {
    console.error("Error sending transaction:", e);
    throw e;
  }
}

// Connect wallet function (maintains same interface as original)
async function connectWallet() {
  try {
    if (!web3modal) {
      await setupWeb3Modal();
    }
    
    if (ethereumClient && !ethereumClient.getAccount().isConnected) {
      initializeInBrowserWallet();
      web3modal.openModal();
    }
    
    // Ensure global WagmiCore is always available
    window.WagmiCore = WagmiCore;
  } catch (error) {
    console.error("Error connecting wallet:", error);
    document.getElementById('connection-alert').textContent = "Error connecting wallet: " + error.message;
    document.getElementById('connection-alert').style.display = 'block';
  }
}

// Utility function to shorten address (same as in original)
function shortenAddress(address) {
  return address ? `${address.substring(0, 6)}...${address.substring(address.length - 4)}` : "";
} 
/**
 * KYBER SWAP INTEGRATION
 * 
 * This module handles asset swaps through Kyber's API.
 * It provides utility functions to:
 * - Check if a swap is needed
 * - Calculate swap amounts
 * - Display swap information
 * - Prepare swap transactions
 */

const KYBER_API_BASE = "https://web.thetanuts.finance/kyber/";
const CHAIN_ID = 8453; // Base chain
const DEFAULT_SLIPPAGE = 10; // 0.1%
const DEFAULT_GAS_PRICE = 1000000000; // 1 gwei

// Debounce function to limit API calls
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

const kyberSwap = {
    /**
     * Check if a swap is needed based on selected collateral and required asset
     * @param {string} selectedCollateral - User selected collateral token symbol
     * @param {object} order - The selected order object
     * @returns {boolean} - True if swap is needed
     */
    isSwapNeeded: function(selectedCollateral, order) {
        const orderCollateral = CONFIG.getCollateralDetails(order.collateral).name;
        return selectedCollateral !== orderCollateral;
    },
    
    /**
     * Get token address from symbol
     * @param {string} symbol - Token symbol
     * @returns {string} - Token address
     */
    getTokenAddress: function(symbol) {
        return CONFIG.collateralMap[symbol];
    },
    
    /**
     * Fetch user's balance of a specific token
     * @param {string} tokenSymbol - Token symbol
     * @returns {Promise<string>} - Formatted token balance
     */
    getUserBalance: async function(tokenSymbol) {
        if (!state.connectedAddress) return "0";
        
        try {
            if (tokenSymbol == "init") {
                // This is the loading state, return 0
                return "0";
            }
            
            const tokenAddress = this.getTokenAddress(tokenSymbol);
            // Validate token address
            try { ethers.utils.getAddress(tokenAddress); } catch (_) { return "0"; }
            
            // Ensure we're on Base before calling
            try {
                const net = await WagmiCore.getNetwork();
                if (net?.chain?.id !== 8453) return "0";
            } catch (_) { /* ignore and attempt anyway */ }
            
            const { readContract } = WagmiCore;

            // Use wagmi to get the token balance and decimals
            const balanceResult = await readContract({
                address: tokenAddress,
                abi: [{
                    name: 'balanceOf',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [{ name: 'account', type: 'address' }],
                    outputs: [{ name: '', type: 'uint256' }]
                }],
                functionName: 'balanceOf',
                args: [state.connectedAddress]
            });
            
            const decimalsResult = await readContract({
                address: tokenAddress,
                abi: [{
                    name: 'decimals',
                    type: 'function',
                    stateMutability: 'view',
                    inputs: [],
                    outputs: [{ name: '', type: 'uint8' }]
                }],
                functionName: 'decimals'
            });
            
            // Format the balance with the correct number of decimals
            return formatUnits(balanceResult.toString(), decimalsResult);
        } catch (error) {
            console.warn(`Error fetching token balance for ${tokenSymbol}:`, error?.message || error);
            return "0";
        }
    },
    
    /**
     * Get quote from Kyber for a swap
     * @param {string} tokenInSymbol - Input token symbol
     * @param {string} tokenOutSymbol - Output token symbol
     * @param {string} amountIn - Input amount in token's smallest unit
     * @returns {Promise<object>} - Swap quote data
     */
    getQuote: async function(tokenInSymbol, tokenOutSymbol, amountIn) {
        try {
            const tokenIn = this.getTokenAddress(tokenInSymbol);
            const tokenOut = this.getTokenAddress(tokenOutSymbol);
            
            // Validate token addresses
            if (!tokenIn || !tokenOut) {
                throw new Error(`Invalid token addresses: ${tokenInSymbol}(${tokenIn}), ${tokenOutSymbol}(${tokenOut})`);
            }
            
            // Validate amount
            if (!amountIn || BigInt(amountIn) <= 0n) {
                throw new Error(`Invalid amount: ${amountIn}`);
            }
            
            // Set the recipient to the connected wallet
            const to = state.connectedAddress;
            
            // Build the API URL with all required parameters
            const url = new URL(KYBER_API_BASE);
            url.searchParams.append("chainId", CHAIN_ID);
            url.searchParams.append("tokenIn", tokenIn);
            url.searchParams.append("tokenOut", tokenOut);
            url.searchParams.append("amountIn", amountIn);
            url.searchParams.append("saveGas", "0");
            url.searchParams.append("slippageTolerance", DEFAULT_SLIPPAGE);
            url.searchParams.append("gasInclude", "1");
            url.searchParams.append("gasPrice", DEFAULT_GAS_PRICE);
            
            // Add recipient address if available
            if (to) url.searchParams.append("to", to);
            
            console.log(`Kyber API call:`, {
                url: url.toString(),
                tokenIn,
                tokenOut,
                amountIn,
                chainId: CHAIN_ID
            });
            
            const response = await fetch(url.toString());
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Kyber API response error:', {
                    status: response.status,
                    statusText: response.statusText,
                    body: errorText
                });
                throw new Error(`Kyber API error: ${response.status} ${response.statusText} - ${errorText}`);
            }
            
            const data = await response.json();
            console.log('Kyber API response:', data);
            
            return data;
        } catch (error) {
            console.error("Error getting Kyber quote:", error);
            throw error; // Re-throw to let caller handle it
        }
    },
    /**
     * Parse a human-readable amount into raw token units based on decimals
     * @param {string|number|BigNumber} amount - The amount to convert
     * @param {number} decimals - Number of token decimals
     * @returns {string} - Raw unit amount as string
     */
    parseUnits: function(amount, decimals) {
        const str = amount.toString();
        const [intPart, fracPart = ''] = str.split('.');
        const truncatedFrac = fracPart.slice(0, decimals);
        const normalized = truncatedFrac ? `${intPart}.${truncatedFrac}` : intPart;
        return ethers.utils.parseUnits(normalized, decimals).toString();
    },

    /**
     * Calculate input amount needed to get a target output amount (iterative approach)
     * @param {string} tokenInSymbol - Input token symbol
     * @param {string} tokenOutSymbol - Output token symbol
     * @param {string|number|BigNumber} targetAmount - Target output amount
     * @param {number} bpsLimit - Precision limit in basis points (0.0001 = 1 bps)
     * @param {number} iterationLimit - Maximum number of iterations
     * @returns {Promise<object>} - Calculated swap data
     */
    calculateSwapForTargetAmount: async function(tokenInSymbol, tokenOutSymbol, targetAmount, bpsLimit = 0.0001, iterationLimit = 5) {
        try {
            const tokenOutAddress = this.getTokenAddress(tokenOutSymbol);
            const tokenInAddress = this.getTokenAddress(tokenInSymbol);
            const {readContract} = WagmiCore;

            // Get token decimals using wagmi
            const tokenOutDecimals = await readContract({
                address: tokenOutAddress,
                abi: [{ name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }],
                functionName: 'decimals'
            });
            
            const tokenInDecimals = await readContract({
                address: tokenInAddress,
                abi: [{ name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }],
                functionName: 'decimals'
            });
            
            // Parse target amount to raw value with correct decimals
            const targetAmountRaw = this.parseUnits(targetAmount, tokenOutDecimals);

            // Start with an estimated input amount based on market prices
            let inputEstimate;
            if (tokenInSymbol === "USDC" && (tokenOutSymbol === "WETH" || tokenOutSymbol === "CBBTC")) {
                // If swapping from USDC to a crypto, divide by the market price
                const assetSymbol = tokenOutSymbol === "WETH" ? "ETH" : "BTC";
                inputEstimate = parseFloat(targetAmount) * state.market_prices[assetSymbol];
            } else if ((tokenInSymbol === "WETH" || tokenInSymbol === "CBBTC") && tokenOutSymbol === "USDC") {
                // If swapping from crypto to USDC, multiply by the market price
                const assetSymbol = tokenInSymbol === "WETH" ? "ETH" : "BTC";
                inputEstimate = parseFloat(targetAmount) / state.market_prices[assetSymbol];
            } else {
                // For other token pairs, use a simple 1:1 ratio for initial guess
                inputEstimate = parseFloat(targetAmount);
            }
            
            let iterations = 0;
            let bestQuote = null;
            let currentInputAmount = this.parseUnits(inputEstimate.toString(), tokenInDecimals).toString();
            
            while (iterations < iterationLimit) {
                iterations++;
                
                // Get quote for current input amount
                const quote = await this.getQuote(tokenInSymbol, tokenOutSymbol, currentInputAmount);
                if (!quote) break;
                
                // Store the best quote so far
                bestQuote = quote;
                
                // Check if we're within our precision limit
                const outputAmount = quote.outputAmount;
                const outputAmountFloat = parseFloat(formatUnits(outputAmount, tokenOutDecimals));
                const targetAmountFloat = parseFloat(targetAmount);
                
                const ratio = outputAmountFloat / targetAmountFloat;
                
                if (ratio >= (1 - bpsLimit) && ratio < 1) {
                    break;
                }
                
                // Adjust the input amount for next iteration
                const adjustmentFactor = targetAmountFloat / Math.max(outputAmountFloat, 0.0000001);
                const newInputAmountFloat = parseFloat(formatUnits(currentInputAmount, tokenInDecimals)) * adjustmentFactor;
                currentInputAmount = this.parseUnits(newInputAmountFloat.toString(), tokenInDecimals).toString();
                
                // Safety check to avoid infinite loops with very small amounts
                if (BigInt(currentInputAmount) === 0n) break;
            }
            
            return {
                success: bestQuote !== null,
                quote: bestQuote,
                inputAmount: bestQuote ? bestQuote.inputAmount : "0",
                outputAmount: bestQuote ? bestQuote.outputAmount : "0",
                inputTokenSymbol: tokenInSymbol,
                outputTokenSymbol: tokenOutSymbol,
                inputTokenDecimals: tokenInDecimals,
                outputTokenDecimals: tokenOutDecimals
            };
        } catch (error) {
            console.error("Error calculating swap for target amount:", error);
            return {
                success: false,
                error: error.message
            };
        }
    },
    
    /**
     * Format swap information for display
     * @param {object} swapData - Swap calculation result
     * @returns {object} - Formatted data for UI display
     */
    formatSwapInfo: function(swapData) {
        if (!swapData || !swapData.success) {
            return {
                displayText: "Swap calculation failed",
                isValid: false
            };
        }
        
        const inputAmount = formatUnits(swapData.inputAmount, swapData.inputTokenDecimals);
        const outputAmount = formatUnits(swapData.outputAmount, swapData.outputTokenDecimals);
        
        return {
            displayText: `Swap ${inputAmount} ${swapData.inputTokenSymbol} → ${outputAmount} ${swapData.outputTokenSymbol}`,
            inputAmount,
            outputAmount,
            inputSymbol: swapData.inputTokenSymbol,
            outputSymbol: swapData.outputTokenSymbol,
            rate: parseFloat(outputAmount) / parseFloat(inputAmount),
            isValid: true,
            swapData: swapData.quote
        };
    },
    
    /**
     * Update UI to show swap information
     * @param {object} swapInfo - Formatted swap information
     */
    updateSwapDisplay: function(swapInfo) {
        // Create or update the swap info element
        let swapInfoEl = document.getElementById('swap-info-container');
        
        if (!swapInfoEl) {
            swapInfoEl = document.createElement('div');
            swapInfoEl.id = 'swap-info-container';
            swapInfoEl.className = 'swap-info mt-3 p-2 rounded';
            
            // Insert after payment selection
            const paymentSelection = document.querySelector('.payment-selection');
            paymentSelection.after(swapInfoEl);
        }
        
        if (!swapInfo || !swapInfo.isValid) {
            swapInfoEl.innerHTML = `
                <div class="alert alert-warning mb-0">
                    <i class="bi bi-exclamation-triangle-fill me-2"></i>
                    <small>Swap calculation unavailable. Please try a different asset.</small>
                </div>
            `;
            // Disable button for error case
            if (typeof toggleButtonReadiness === 'function') {
                toggleButtonReadiness(false, 'SWAP ERROR');
            }
            return;
        }
        
        // Format the rate with appropriate precision
        const rate = swapInfo.rate;
        let formattedRate;
        if (rate < 0.01) formattedRate = rate.toFixed(6);
        else if (rate < 1) formattedRate = rate.toFixed(4);
        else formattedRate = rate.toFixed(2);
        
        swapInfoEl.innerHTML = `
            <div class="swap-info-content">
                <div class="swap-header d-flex justify-content-between align-items-center">
                    <span class="swap-title">
                        <i class="bi bi-arrow-repeat me-2"></i>Token Swap Required
                    </span>
                    <small class="swap-rate text-muted">Rate: 1 ${swapInfo.inputSymbol} = ${formattedRate} ${swapInfo.outputSymbol}</small>
                </div>
                <div class="swap-details mt-2">
                    <div class="swap-direction d-flex justify-content-between align-items-center">
                        <span class="swap-amount">${parseFloat(swapInfo.inputAmount).toFixed(6)} ${swapInfo.inputSymbol}</span>
                        <i class="bi bi-arrow-right mx-2"></i>
                        <span class="swap-amount">${parseFloat(swapInfo.outputAmount).toFixed(6)} ${swapInfo.outputSymbol}</span>
                    </div>
                    <small class="text-muted mt-1 d-block">
                        <i class="bi bi-info-circle me-1"></i>
                        Swap will be executed when you confirm the trade
                    </small>
                </div>
            </div>
        `;
        
        // Enable button and hide warning since swap is ready
        if (typeof toggleButtonReadiness === 'function') {
            toggleButtonReadiness(true, 'TRADE NOW');
        }
        if (typeof hideSwapLoadingWarning === 'function') {
            hideSwapLoadingWarning();
        }
    },
    
    /**
     * Hide swap display when not needed
     */
    hideSwapDisplay: function() {
        const swapInfoEl = document.getElementById('swap-info-container');
        if (swapInfoEl) {
            swapInfoEl.style.display = 'none';
        }
        // Enable button and hide warning since no swap is needed
        if (typeof toggleButtonReadiness === 'function') {
            toggleButtonReadiness(true, 'TRADE NOW');
        }
        if (typeof hideSwapLoadingWarning === 'function') {
            hideSwapLoadingWarning();
        }
    },
    
    /**
     * Update swap information based on selected assets and position size
     * Called when position size or asset selection changes
     */
    updateSwapInfo: debounce(async function(order, positionSize) {
        // Hide any existing swap info first
        const swapInfoEl = document.getElementById('swap-info-container');
        if (swapInfoEl) {
            swapInfoEl.style.display = 'block';
        }
        
        // Check if swap is needed
        const orderCollateral = CONFIG.getCollateralDetails(order.collateral);
        const selectedCollateral = getSelectedPaymentAsset();
        const needsSwap = selectedCollateral !== orderCollateral.name;
        
        if (!needsSwap) {
            this.hideSwapDisplay();
            // Clear swap info since no swap is needed
            state.currentSwapInfo = null;
            return;
        }
        
        // Show loading state and disable button
        if (swapInfoEl) {
            swapInfoEl.innerHTML = `
                <div class="d-flex align-items-center">
                    <div class="spinner-border spinner-border-sm me-2" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                    <span>Calculating swap rates...</span>
                </div>
            `;
        }
        
        // Immediately disable button and show warning
        if (typeof toggleButtonReadiness === 'function') {
            toggleButtonReadiness(false, 'LOADING SWAP...');
        }
        if (typeof showSwapLoadingWarning === 'function') {
            showSwapLoadingWarning();
        }
        
        try {
            // We need to convert from selected collateral to order collateral
            const swapResult = await this.calculateSwapForTargetAmount(
                selectedCollateral,
                orderCollateral.name,
                positionSize,
                0.0001,  // 1 bps precision
                2        // Limit to 2 iterations for responsiveness
            );
            
            // Format and display the swap information
            const swapInfo = this.formatSwapInfo(swapResult);
            this.updateSwapDisplay(swapInfo); // This will enable button and hide warning
            
            // Store the swap info in the state for later use with timestamp
            state.currentSwapInfo = {
                ...swapInfo,
                timestamp: Date.now()
            };
            
        } catch (error) {
            console.error("Error updating swap info:", error);
            if (swapInfoEl) {
                swapInfoEl.innerHTML = `
                    <div class="alert alert-warning mb-0">
                        <i class="bi bi-exclamation-triangle-fill me-2"></i>
                        <small>Error calculating swap: ${error.message}</small>
                    </div>
                `;
            }
            // Disable button for error state
            if (typeof toggleButtonReadiness === 'function') {
                toggleButtonReadiness(false, 'SWAP ERROR');
            }
        }
    }, 1000) // Debounce for 1 second
};
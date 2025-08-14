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
 * - setupWeb3Onboard() - Initialize wallet connection interface
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

// State management
const state = {
    connectedAddress: null,
    optionBook: null,
    orders: [],
    selectedAsset: 'ETH',
    market_prices: {}, // Object to store prices for all assets
    refreshTimer: null,
    expiryTime: null,
    selectedOrderIndex: null,
    selectedPositionSize: 100,
    viewMode: 'advanced', // 'advanced' is now the only view
    countDownInterval: 0,
    selectedPositionPercentage: 50,
};

// Constants
const MARKET_DATA_API = 'https://round-snowflake-9c31.devops-118.workers.dev/';
const REFRESH_INTERVAL = 30000; // 30 seconds
const OPTION_BOOK_ADDRESS = "0xA63D2717538834E553cbe811B04a17eC748D71FB";
const MAKER_ADDRESS = "0xf1711BA7E74435032AA103Ef20a4cBeCE40B6df5";
const PRICE_DECIMALS = 8;
const TWO_HOURS_IN_SECONDS = 7200; // 2 hours in seconds
const UTC_EXPIRY_HOUR = 8;
const MULTICALL_ADDRESS = "0xfEE958Fa595B4478cea7560C91400A98b83d6C91";

// Store the last selected strike to maintain slider position
let lastSelectedStrike = null;
let lastSelectedSliderPosition = null;

// Centralized option calculations
const optionCalculator = {
    
    // Calculate leverage/payout ratio
    calculateLeverage: function(premium, order, collateral) {
        const MAX_LEVERAGE = 10000;
        try {
            // Different calculation methods based on option type
            if (order.isCall) {
                // For ETH CALLs, the correct leverage is:
                // 1 / premium (WETH denomination)
                const ratio = 1 / parseFloat(premium);                
                return ratio > MAX_LEVERAGE ? `> ${MAX_LEVERAGE}` : ratio.toFixed(2);
            } 
            else if (!order.isCall) {
                // For USDC PUTs, the leverage is:
                // Current spot price / premium in USDC
                const asset = CONFIG.getUnderlyingAsset(order.priceFeed);
                const assetPrice = state.market_prices[asset];
                const ratio = assetPrice / parseFloat(premium);
                
                // Cap at reasonable value for display purposes
                const cappedRatio = Math.min(ratio, MAX_LEVERAGE);
                return cappedRatio.toFixed(2);
            }
            else if (parseFloat(premium) === 0 || premium === "0") {
                return "--";
            } 
            else {
                // Default calculation for other combinations
                const ratio = 1 / parseFloat(premium);
                const cappedRatio = Math.min(ratio, MAX_LEVERAGE);
                console.log(`Default leverage calculation: 1 / ${premium} = ${cappedRatio}`);
                return cappedRatio.toFixed(2);
            }
        } catch (e) {
            console.error("Error calculating payout ratio:", e);
            return "--";
        }
    },

    // Calculate profit scenarios
    calculateProfitScenarios: function(order, strike, positionSize, numContracts) {
        // Get if this is a call option
        console.log("Order:", order);
        const isCall = order.isCall;
        
        // Calculate cost in dollar terms for accurate percentage calculation
        const assetPrice = state.market_prices[CONFIG.getCollateralDetails(order.collateral).asset];

        const positionSizeInDollars = isCall ? positionSize * assetPrice : positionSize;
        
        // Loss scenario at or below strike for calls, at or above for puts
        const lossScenario = {
            price: parseFloat(strike),
            direction: isCall ? 'Below' : 'Above',
            profit: -positionSize,
            profitInDollars: -positionSizeInDollars,
            profitPercent: -100
        };
        
        // Calculate breakeven - Price is always multiplied by 10 ** PRICE_DECIMALS
        const premium = parseFloat(formatUnits(order.price, PRICE_DECIMALS)); 
        const breakeven = this.calculateBreakeven(isCall, parseFloat(strike), positionSizeInDollars / parseFloat(numContracts));
            
        // Profit scenarios - calculate 2 profit points at different price levels
        const priceDelta1 = strike * (isCall ? 0.01 : -0.01); 
        const priceDelta2 = strike * (isCall ? 0.02 : -0.02); 
        
        const price1 = parseFloat(strike) + priceDelta1;
        const price2 = parseFloat(strike) + priceDelta2;
        
        // Calculate profit based on number of contracts
        let profit1 = Math.abs(priceDelta1) * parseFloat(numContracts);
        let profit2 = Math.abs(priceDelta2) * parseFloat(numContracts);
        
        const profit1Percent = ((profit1 / positionSizeInDollars) * 100).toFixed(0);
        const profit2Percent = ((profit2 / positionSizeInDollars) * 100).toFixed(0);
        
        return {
            loss: lossScenario,
            breakeven: breakeven,
            profit1: {
                price: price1,
                profit: profit1.toFixed(2),
                profitPercent: profit1Percent
            },
            profit2: {
                price: price2,
                profit: profit2.toFixed(2),
                profitPercent: profit2Percent
            }
        };
    },
    
    // Calculate approval amount
    calculateApprovalAmount: function(order, collateral, positionSize) {
        return ethers.utils.parseUnits(positionSize.toFixed(collateral.decimals), collateral.decimals);
    },
    
    // New method: Calculate approval amount with $1000 limit option
    calculateApprovalAmountWithLimit: function(order, collateral, positionSize, useExactApproval) {
        const requiredAmount = ethers.utils.parseUnits(positionSize.toFixed(collateral.decimals), collateral.decimals);
        
        if (useExactApproval) {
            // Use exact amount if checkbox is checked
            return requiredAmount;
        }
        
        // Calculate $1000 worth of tokens
        const thousandDollarLimit = this.calculateThousandDollarEquivalent(collateral);
        
        // Return the larger of: required amount or $1000 limit
        return requiredAmount.gt(thousandDollarLimit) ? requiredAmount : thousandDollarLimit;
    },
    
    // Helper method: Calculate $1000 equivalent for each token
    calculateThousandDollarEquivalent: function(collateral) {
        const THOUSAND_DOLLARS = 1000;
        
        switch (collateral.name) {
            case 'USDC':
                // For USDC: $1000 = 1000 USDC (6 decimals)
                return ethers.utils.parseUnits('1000', 6);
                
            case 'WETH':
                // For WETH: $1000 / ETH price
                const ethPrice = state.market_prices['ETH'] || 2500; // fallback price
                const wethAmount = THOUSAND_DOLLARS / ethPrice;
                return ethers.utils.parseUnits(wethAmount.toFixed(18), 18);
                
            case 'CBBTC':
                // For CBBTC: $1000 / BTC price  
                const btcPrice = state.market_prices['BTC'] || 100000; // fallback price
                const cbbtcAmount = THOUSAND_DOLLARS / btcPrice;
                return ethers.utils.parseUnits(cbbtcAmount.toFixed(8), 8);
                
            default:
                // Fallback: assume 18 decimals and $1 price
                return ethers.utils.parseUnits('1000', 18);
        }
    },
    
    // New method: Calculate breakeven point
    calculateBreakeven: function(isCall, strike, premium) {
        return isCall 
            ? (parseFloat(strike) + parseFloat(premium))
            : (parseFloat(strike) - parseFloat(premium));
    },

    // New method: Calculate maximum number of contracts
    calculateMaxContracts: function(order, collateral) {
        const makerCollateral = parseFloat(formatUnits(order.maxCollateralUsable, collateral.decimals));
        const strikePrice = parseFloat(formatUnits(order.strikes[0], PRICE_DECIMALS));
        
        // Determine max contracts based on option type
        let maxContracts;
        if (order.isCall) {
            maxContracts = makerCollateral;
        } else { // PUT
            // For puts, max contracts = maker collateral / strike
            maxContracts = makerCollateral / strikePrice;
        }
        // Apply safety factor
        return maxContracts * 0.9999;
    },
    
    // Rename calculatePosition for clarity
    calculatePositionDetails: function(order, collateral, percentage) {
        const maxContracts = this.calculateMaxContracts(order, collateral);
        const optionPrice = parseFloat(formatUnits(order.price, PRICE_DECIMALS));
        
        // Calculate selected contracts and cost based on percentage
        const selectedContracts = (percentage / 100) * maxContracts;
        const positionCost = selectedContracts * optionPrice;
        
        return { 
            positionCost, 
            selectedContracts, 
            maxContracts,
            optionPrice
        };
    },

    
    // New method: Calculate settlement scenarios
    calculateSettlementScenarios: function(position) {
        try {
            // Check if position has required fields
            if (!position || typeof position.strikePrice === 'undefined') {
                throw new Error("Invalid position data for settlement calculations");
            }
            
            // Use fallbacks for all values
            const strikePrice = position.strikePrice;

            // Calculate breakeven with safeguards
            const isCall = position.optionType === 'CALL';

            // If is USDC, use position.cost, else use position.cost * current price
            const cost = isCall ? position.cost * state.market_prices[CONFIG.getCollateralDetails(position.collateralToken).asset] : position.cost;
            const payoutRatio = parseFloat(position.payoutRatio);
            
            const breakeven = this.calculateBreakeven(isCall, strikePrice, cost / payoutRatio);
            
            // Set scenarios based on option type
            if (isCall) {
                // Loss scenario
                const lossScenario = {
                    price: strikePrice,
                    description: `$${strikePrice.toFixed(2)} or below: Option expires worthless, lose $${cost.toFixed(2)}`
                };
                
                // Breakeven scenario
                const breakevenScenario = {
                    price: breakeven,
                    description: `$${breakeven.toFixed(2)}: Break even`
                };
                
                // Profit scenarios
                const profit1Price = strikePrice * 1.05; // 5% above strike
                const profit1Amount = payoutRatio * (profit1Price - strikePrice) - cost;
                const profit1Percent = (profit1Amount / Math.max(0.01, cost)) * 100;
                
                const profit1Scenario = {
                    price: profit1Price,
                    description: `$${profit1Price.toFixed(2)}: Profit $${profit1Amount.toFixed(2)} (${profit1Percent.toFixed(1)}% return)`
                };
                
                const profit2Price = strikePrice * 1.1; // 10% above strike
                const profit2Amount = payoutRatio * (profit2Price - strikePrice) - cost;
                const profit2Percent = (profit2Amount / Math.max(0.01, cost)) * 100;
                
                const profit2Scenario = {
                    price: profit2Price,
                    description: `$${profit2Price.toFixed(2)}: Profit $${profit2Amount.toFixed(2)} (${profit2Percent.toFixed(1)}% return)`
                };
                
                return {
                    loss: lossScenario,
                    breakeven: breakevenScenario,
                    profit1: profit1Scenario,
                    profit2: profit2Scenario
                };
            } else {
                // Loss scenario
                const lossScenario = {
                    price: strikePrice,
                    description: `$${strikePrice.toFixed(2)} or above: Option expires worthless, lose $${cost.toFixed(2)}`
                };
                
                // Breakeven scenario
                const breakevenScenario = {
                    price: breakeven,
                    description: `$${breakeven.toFixed(2)}: Break even`
                };
                
                // Profit scenarios
                const profit1Price = strikePrice * 0.95; // 5% below strike
                const profit1Amount = payoutRatio * (strikePrice - profit1Price) - cost;
                const profit1Percent = (profit1Amount / Math.max(0.01, cost)) * 100;
                
                const profit1Scenario = {
                    price: profit1Price,
                    description: `$${profit1Price.toFixed(2)}: Profit $${profit1Amount.toFixed(2)} (${profit1Percent.toFixed(1)}% return)`
                };
                
                const profit2Price = strikePrice * 0.9; // 10% below strike
                const profit2Amount = payoutRatio * (strikePrice - profit2Price) - cost;
                const profit2Percent = (profit2Amount / Math.max(0.01, cost)) * 100;
                
                const profit2Scenario = {
                    price: profit2Price,
                    description: `$${profit2Price.toFixed(2)}: Profit $${profit2Amount.toFixed(2)} (${profit2Percent.toFixed(1)}% return)`
                };
                
                return {
                    loss: lossScenario,
                    breakeven: breakevenScenario,
                    profit1: profit1Scenario,
                    profit2: profit2Scenario
                };
            }
        } catch (error) {
            console.error("Error calculating settlement scenarios:", error);
            // Provide fallback scenario
            return {
                loss: { description: "Below strike: Option expires worthless" },
                breakeven: { description: "At breakeven: Recover cost" },
                profit1: { description: "Above strike: Profit increases" },
                profit2: { description: "Further increase: Higher profit" }
            };
        }
    }
};

// Global configuration object
const CONFIG = {
    // Kyber contract address
    KYBER_CONTRACT_ADDRESS: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
    
    // Price feed mappings
    priceFeedsMap: {
        'ETH': '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
        'BTC': '0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F'
    },
    
    // Asset mappings
    collateralMap: {
        'ETH': '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        'USDC': '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        'WETH': '0x4200000000000000000000000000000000000006',
        'CBBTC': '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'
    },
    implementationMap: {
        "0xb2Bd24F67bFBe083D6380244e770bF51dE3F0051": { name: "INVERSE_CALL", type: "VANILLA", num_strikes: 1 },
        "0x1418b528954cecAA1920eE61982F4DEB0F5ffE8a": { name: "PUT", type: "VANILLA", num_strikes: 1 },
        "0x391F2dCF9F9Dab4149B0BFd0e05fbf10ddFE526A": { name: "CALL_SPREAD", type: "SPREAD", num_strikes: 2 },
        "0x1111111111111111111111111111111111111111": { name: "INVERSE_CALL_SPREAD", type: "SPREAD", num_strikes: 2 },
        "0x2222222222222222222222222222222222222222": { name: "PUT_SPREAD", type: "SPREAD", num_strikes: 2 },    
        "0xD2cF183474494F413D31b245C037212838904761": { name: "CALL_FLYS", type: "BUTTERFLY", num_strikes: 3 },
        "0x806D5AaE70f1fA595CaDed5d3181e818b16F3389": { name: "PUT_FLYS", type: "BUTTERFLY", num_strikes: 3 },
        "0x68D20cE348326f7fBF85101dF3319E870911fdFD": { name: "IRON_CONDOR", type: "IRON_CONDOR", num_strikes: 4 },
        "0xb36b6361849E87C369F8d6Ea072c3dFaa16A3557": { name: "CALL_CONDOR", type: "CONDOR", num_strikes: 4 },
        "0x421E7cC6EECC9ab8466E627d2FaAec951523AC9a": { name: "PUT_CONDOR", type: "CONDOR", num_strikes: 4 }
    },
    // Replace getCollateralDetails, getOptionDetails, getUnderlyingAsset with this
    getCollateralDetails: function(tokenAddress) {
        const tokens = {
            "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee": { name: "ETH", decimals: 18, asset: "ETH" },
            "0x4200000000000000000000000000000000000006": { name: "WETH", decimals: 18, asset: "ETH" },
            "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913": { name: "USDC", decimals: 6, asset: "USD" },
            "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf": { name: "CBBTC", decimals: 8, asset: "BTC" }
        };
        return tokens[ethers.utils.getAddress(tokenAddress)] || { name: "UNKNOWN", decimals: 18, asset: "UNKNOWN" };
    },
    getOptionDetails: function(implementation) {
        return CONFIG.implementationMap[implementation] || { name: "UNKNOWN", type: "UNKNOWN", num_strikes: 1 };
    },
    getUnderlyingAsset: function(priceFeed) {
        // Reverse lookup from priceFeedsMap
        for (const [asset, feed] of Object.entries(this.priceFeedsMap)) {
            if (feed === priceFeed) {
                return asset;
            }
        }
        return "UNKNOWN";
    }
};

// Export state to global window object for cross-module access
// This is required for wallet integration and other modules
window.state = state;
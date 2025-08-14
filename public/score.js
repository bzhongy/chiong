/**
 * CHIONG SCOREBOARD
 * 
 * This module handles the scoreboard functionality, including:
 * - Fetching trader statistics from the indexer
 * - Displaying the scoreboard table
 */

const scoreboard = {
    data: [],
    weeklyData: [],
    openPositions: [],
    currentView: 'past_week',
    profitableTrades: [], // Add storage for all-time profitable trades
    weeklyProfitableTrades: [], // Add storage for weekly profitable trades
    settlementPriceCache: new Map(),
    
    // Initialize the scoreboard
    init: function() {
        // Load saved preference from localStorage
        const savedView = localStorage.getItem('scoreboard_view');
        if (savedView && (savedView === 'all' || savedView === 'past_week')) {
            this.currentView = savedView;
        }
        
        this.loadData();
        this.setupEventListeners();
        this.updatePeriodButtonsInitial();
    },

    // Set up event listeners for sort buttons
    setupEventListeners: function() {
        // Add event listener for navigation
        const navScoreboard = document.getElementById('nav-scoreboard-bottom');
        if (navScoreboard) {
            navScoreboard.addEventListener('click', (e) => {
                e.preventDefault();
                showSection('scoreboard-section');
                this.loadScoreboardData();
                this.loadOpenPositionsData();
            });
        }
        
        const sortButtons = ['sort-by-pnl', 'sort-by-size', 'sort-by-time'];
        const periodButtons = ['scoreboard-period-all', 'scoreboard-period-week'];
        
        sortButtons.forEach(buttonId => {
            const button = document.getElementById(buttonId);
            if (button) {
                button.addEventListener('click', () => {
                    this.updateSortButtons(buttonId);
                    const criterion = buttonId.replace('sort-by-', '');
                    this.sortOpenPositionsBy(criterion);
                });
            }
        });

        periodButtons.forEach(buttonId => {
            const button = document.getElementById(buttonId);
            if (button) {
                button.addEventListener('click', () => {
                    this.updatePeriodButtons(buttonId);
                    
                    const newView = buttonId === 'scoreboard-period-all' ? 'all' : 'past_week';
                    
                    // Save preference to localStorage
                    localStorage.setItem('scoreboard_view', newView);
                    
                    this.currentView = newView;
                    this.renderScoreboard();
                    this.renderProfitableTrades();
                });
            }
        });
    },

    // Load data from the API
    loadData: function() {
        this.loadScoreboardData();
        this.loadOpenPositionsData();
    },

    // Load scoreboard data from the indexer
    loadScoreboardData: async function() {
        try {
            document.getElementById('loading-scoreboard').style.display = 'block';
            document.getElementById('no-scoreboard-data').style.display = 'none';
            
            const response = await fetch('https://odette.fi/api/scoreboard');
            
            if (!response.ok) {
                throw new Error(`Error fetching scoreboard data: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data || !data.all) {
                throw new Error('Invalid scoreboard data structure');
            }
            
            this.data = data.all.traders || [];
            this.weeklyData = data.past_week?.traders || [];
            
            // Store profitable trades data
            this.profitableTrades = data.all.topProfitableTrades || [];
            this.weeklyProfitableTrades = data.past_week?.topProfitableTrades || [];
            
            this.renderScoreboard();
            this.renderProfitableTrades();
            document.getElementById('loading-scoreboard').style.display = 'none';
        } catch (error) {
            console.error("Error loading scoreboard data:", error);
            document.getElementById('loading-scoreboard').style.display = 'none';
            document.getElementById('no-scoreboard-data').style.display = 'block';
            document.getElementById('no-scoreboard-data').innerHTML = `<p>Error loading scoreboard: ${error.message}</p>`;
        }
    },
    
    // Load open positions data from the indexer
    loadOpenPositionsData: async function() {
        try {
            document.getElementById('loading-open-positions').style.display = 'block';
            document.getElementById('no-open-positions-data').style.display = 'none';
            document.getElementById('open-positions-table-body').innerHTML = '';
            
            const response = await fetch('https://odette.fi/api/open-positions');
            
            if (!response.ok) {
                throw new Error(`Error fetching open positions data: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data || !data.positions || data.positions.length === 0) {
                document.getElementById('loading-open-positions').style.display = 'none';
                document.getElementById('no-open-positions-data').style.display = 'block';
                return;
            }
            
            // Store open positions data
            this.openPositions = data.positions;
            
            // Calculate PnL for each position (with async settlement price fetching)
            const pnlPromises = this.openPositions.map(async (position) => {
                try {
                    position.pnl = await this.calculatePositionPnL(position);
                } catch (pnlError) {
                    console.error(`Error calculating PnL for position ${position.address}:`, pnlError);
                    // Provide default PnL if calculation fails
                    position.pnl = { value: 0, percentage: 0, displayValue: 'Error', usd_value: 0, num_contracts: 0 };
                }
            });
            
            // Wait for all PnL calculations to complete
            await Promise.all(pnlPromises);
            

            const sortBySizeButton = document.getElementById('sort-by-size');
            const sortByTimeButton = document.getElementById('sort-by-time');
            
            let activeSortMethod = 'pnl'; // Default sort method            
            if (sortBySizeButton && sortBySizeButton.classList.contains('active')) {
                activeSortMethod = 'size';
            } else if (sortByTimeButton && sortByTimeButton.classList.contains('active')) {
                activeSortMethod = 'time';
            }
            
            // Apply the active sort method to the open positions
            this.sortOpenPositionsBy(activeSortMethod);

            // Render the open positions
            this.renderOpenPositions();
            
            document.getElementById('loading-open-positions').style.display = 'none';
            
            // Add refresh button functionality if not already added
            this.addRefreshButton();
            
        } catch (error) {
            console.error("Error loading open positions data:", error);
            document.getElementById('loading-open-positions').style.display = 'none';
            document.getElementById('no-open-positions-data').style.display = 'block';
            document.getElementById('no-open-positions-data').innerHTML = `<p>Error loading open positions: ${error.message}</p>`;
        }
    },
    


    // Get the last settlement timestamp for caching purposes
    getLastSettlementTimestamp: function(asset) {
        // For options that expire at 08:00 UTC, find the most recent past 08:00 UTC
        const now = new Date();
        const today8UTC = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 0, 0, 0);
        
        if (now < today8UTC) {
            // If current time is before today's 08:00 UTC, use yesterday's 08:00 UTC
            return new Date(today8UTC.getTime() - 24 * 60 * 60 * 1000).getTime();
        } else {
            // Use today's 08:00 UTC
            return today8UTC.getTime();
        }
    },

    // Check if current time is past settlement time (08:00 UTC)
    isSettlementTimeReached: function() {
        const now = new Date();
        const today8UTC = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 0, 0, 0);
        return now >= today8UTC;
    },

    // Fetch settlement price for a specific option address
    fetchSettlementPrice: async function(optionAddress, asset, cacheKey) {
        try {
            // First try using WagmiCore if available
            if (typeof WagmiCore !== 'undefined' && WagmiCore.readContract) {
                try {
                    const { readContract } = WagmiCore;
                    const twapResult = await readContract({
                        address: optionAddress,
                        abi: OPTION_ABI,
                        functionName: 'getTWAP',
                        chainId: 8453 // Base mainnet
                    });
                    
                    // Convert from 8 decimal places to regular number
                    const settlementPrice = parseFloat(twapResult.toString()) / 1e8;
                    
                    // Cache the result
                    this.settlementPriceCache.set(cacheKey, settlementPrice);
                    
                    return settlementPrice;
                } catch (wagmiError) {
                    console.warn(`WagmiCore call failed for ${asset}, trying fallback:`, wagmiError);
                    throw wagmiError; // Re-throw to trigger fallback
                }
            }
            
            // Fallback: Try using direct RPC call if WagmiCore fails or isn't available
            try {
                const rpcResult = await this.fallbackGetTWAP(optionAddress);
                if (rpcResult) {
                    const settlementPrice = parseFloat(rpcResult) / 1e8;
                    this.settlementPriceCache.set(cacheKey, settlementPrice);
                    return settlementPrice;
                }
            } catch (rpcError) {
                console.warn(`RPC fallback failed for ${asset}:`, rpcError);
            }
            
            // If both methods fail, return null
            console.error(`All methods failed to fetch settlement price for ${asset}`);
            return null;
            
        } catch (error) {
            console.error(`Error fetching settlement price for ${asset}:`, error);
            return null;
        }
    },

    // Fallback method for getting TWAP using direct RPC call
    fallbackGetTWAP: async function(optionAddress) {
        try {
            // Use the same RPC call pattern as in worker.js
            const response = await fetch('https://mainnet.base.org', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'eth_call',
                    params: [
                        {
                            to: optionAddress,
                            data: '0x05ecd003' // getTWAP() function selector
                        },
                        'latest'
                    ]
                })
            });

            const result = await response.json();
            
            if (result.error) {
                throw new Error(`RPC error: ${result.error.message}`);
            }
            
            if (result.result && result.result !== '0x') {
                // Decode the hex result as uint256
                return parseInt(result.result, 16).toString();
            }
            
            return null;
        } catch (error) {
            console.error('Fallback getTWAP failed:', error);
            return null;
        }
    },

    // Get settlement price for an asset (from cache or fetch on miss)
    getSettlementPrice: async function(asset, optionAddress = null) {
        const cacheKey = `${asset}_settlement_${this.getLastSettlementTimestamp(asset)}`;
        const cachedPrice = this.settlementPriceCache.get(cacheKey);
        
        // If we have it cached, return it
        if (cachedPrice !== undefined) {
            return cachedPrice;
        }
        
        // If no option address provided, try to find one from open positions
        if (!optionAddress) {
            const samplePosition = this.openPositions.find(p => p.underlyingAsset === asset);
            if (samplePosition) {
                optionAddress = samplePosition.address;
            } else {
                console.warn(`No option address found for ${asset}, cannot fetch settlement price`);
                return null;
            }
        }
        
        // Fetch and cache the settlement price
        try {
            const settlementPrice = await this.fetchSettlementPrice(optionAddress, asset, cacheKey);
            return settlementPrice;
        } catch (error) {
            console.error(`Failed to fetch settlement price for ${asset}:`, error);
            return null;
        }
    },
    
    // Render the scoreboard table
    renderScoreboard: function() {
        const tableBody = document.getElementById('scoreboard-table-body');
        tableBody.innerHTML = '';
        
        // Use the appropriate data array based on current view
        const activeData = this.currentView === 'all' ? this.data : this.weeklyData;
        
        // Add a title indicator for weekly view
        const scoreboardTitle = document.querySelector('#scoreboard-section h2');
        if (scoreboardTitle) {
            scoreboardTitle.textContent = this.currentView === 'all' ? 
                'Trader Scoreboard' : 'Weekly Trader Scoreboard';
        }
        
        // Render data rows
        activeData.forEach((trader, index) => {
            const row = document.createElement('tr');
            
            // Highlight top 3 with special classes
            if (index < 3) {
                row.classList.add(`rank-${index + 1}`);
            }
            
            // Format address for display
            const displayAddress = `${trader.address.substring(0, 6)}...${trader.address.substring(38)}`;
            
            // Format monetary values with proper dollar formatting
            const formatUSD = (value) => {
                if (value === null || value === undefined || isNaN(value)) {
                    return '$0.00';
                }
                return '$' + value.toFixed(2);
            };
            
            // Add medal emojis for top 3 ranks
            let rankDisplay = (index + 1).toString();
            if (index === 0) rankDisplay = '🥇 ' + rankDisplay;
            else if (index === 1) rankDisplay = '🥈 ' + rankDisplay;
            else if (index === 2) rankDisplay = '🥉 ' + rankDisplay;
            
            // Get streak data - the API returns streaks directly in trader.streaks
            const streakData = trader.streaks || {};
            
            const daysWithTrades = streakData.daysWithTrades || 0;
            const longestTradingStreak = streakData.longestTradingStreak || 0;
            const longestWinStreak = streakData.longestWinStreak || 0;
            const daysWithWins = streakData.daysWithWins || 0;
            
            // Add special classes for impressive streaks
            const tradingStreakClass = longestTradingStreak >= 7 ? 'streak-impressive' : '';
            const winStreakClass = longestWinStreak >= 7 ? 'streak-impressive' : '';
            
            // Format consolidated streak data
            const streakDisplay = `${daysWithTrades} / ${daysWithWins} / ${longestTradingStreak} / ${longestWinStreak}`;
            
            // Format streak tooltip
            const streakTooltip = `Days with Trades: ${daysWithTrades} | Days with Wins: ${daysWithWins} | Longest Trading Streak: ${longestTradingStreak} days | Longest Win Streak: ${longestWinStreak} days`;
            
            row.innerHTML = `
                <td><strong>${rankDisplay}</strong></td>
                <td title="${trader.address}" class="trader-address">${displayAddress}</td>
                <td>${formatUSD(trader.volume || 0)}</td>
                <td>${formatUSD(trader.premiumPaid || 0)}</td>
                <td class="${(trader.profit || 0) >= 0 ? 'text-success' : 'text-danger'}">${(trader.profit || 0) >= 0 ? '+' : ''}${formatUSD(trader.profit || 0)}</td>
                <td>${trader.numTrades || 0}</td>
                <td title="${streakTooltip}" class="streak-cell ${tradingStreakClass} ${winStreakClass}">${streakDisplay}</td>
                <td><strong>${(trader.score || 0).toFixed(1)}</strong></td>
            `;
            
            tableBody.appendChild(row);
        });
        
        // Initialize tooltips
        if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
            const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
            tooltipTriggerList.map(function (tooltipTriggerEl) {
                return new bootstrap.Tooltip(tooltipTriggerEl);
            });
        }
    },
    
    // Helper method to update period buttons
    updatePeriodButtons: function(activeButtonId) {
        const allButton = document.getElementById('scoreboard-period-all');
        const weekButton = document.getElementById('scoreboard-period-week');
        
        if (allButton) allButton.classList.remove('active');
        if (weekButton) weekButton.classList.remove('active');
        
        const activeButton = document.getElementById(activeButtonId);
        if (activeButton) activeButton.classList.add('active');
    },

    // Helper method to set initial button states based on current view
    updatePeriodButtonsInitial: function() {
        const allButton = document.getElementById('scoreboard-period-all');
        const weekButton = document.getElementById('scoreboard-period-week');
        
        if (allButton) allButton.classList.remove('active');
        if (weekButton) weekButton.classList.remove('active');
        
        // Set active button based on current view
        if (this.currentView === 'all') {
            if (allButton) allButton.classList.add('active');
        } else {
            if (weekButton) weekButton.classList.add('active');
        }
    },

    // Helper method to update sort buttons
    updateSortButtons: function(activeButtonId) {
        const sortButtons = ['sort-by-pnl', 'sort-by-size', 'sort-by-time'];
        
        sortButtons.forEach(buttonId => {
            const button = document.getElementById(buttonId);
            if (button) {
                button.classList.remove('active');
            }
        });
        
        const activeButton = document.getElementById(activeButtonId);
        if (activeButton) {
            activeButton.classList.add('active');
        }
    },

    // Helper method to convert PnL to USD for tooltip display
    convertPnLToUSD: function(pnlValue, collateralSymbol) {
        if (!pnlValue || isNaN(pnlValue)) {
            return 0;
        }

        // For USDC, the value is already in USD
        if (collateralSymbol === 'USDC') {
            return pnlValue;
        }

        // For WETH, multiply by ETH price
        if (collateralSymbol === 'WETH') {
            const ethPrice = state?.market_prices?.ETH || 0;
            return pnlValue * ethPrice;
        }

        // For CBBTC, multiply by BTC price  
        if (collateralSymbol === 'CBBTC') {
            const btcPrice = state?.market_prices?.BTC || 0;
            return pnlValue * btcPrice;
        }

        // Default: return original value
        return pnlValue;
    },

    // Helper method to format USD tooltip
    formatUSDTooltip: function(usdValue) {
        if (!usdValue || isNaN(usdValue)) {
            return 'USD value unavailable';
        }
        
        const formattedValue = Math.abs(usdValue) >= 1000 ? 
            (usdValue / 1000).toFixed(1) + 'K' : 
            usdValue.toFixed(2);
            
        return `≈ $${formattedValue} USD`;
    },

    // Render the open positions table
    renderOpenPositions: function() {
        const tableBody = document.getElementById('open-positions-table-body');
        tableBody.innerHTML = '';
        
        this.openPositions.forEach((position) => {
            const row = document.createElement('tr');
            
            // Format address for display
            const displayAddress = `${position.buyer.substring(0, 6)}...${position.buyer.substring(38)}`;
            
            // Format strike price
            const strike = parseFloat(position.strikes[0]) / 10**8;
            
            // Format collateral amount
            const collateral = (parseFloat(position.numContracts) / 10**position.collateralDecimals).toFixed(4);
            
            // Format premium
            const premium = (parseFloat(position.entryPremium) / 10**position.collateralDecimals).toFixed(4);
            
            // Calculate time remaining
            const currentTime = Math.floor(Date.now() / 1000);
            const timeRemaining = Math.max(0, position.expiryTimestamp - currentTime);
            
            let timeRemainingText;
            if (timeRemaining <= 0) {
                timeRemainingText = 'Expired';
            } else {
                const hours = Math.floor(timeRemaining / 3600);
                const minutes = Math.floor((timeRemaining % 3600) / 60);
                const seconds = timeRemaining % 60;
                timeRemainingText = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
            
            // Determine option type display text
            let optionTypeText;
            if (position.optionType === 0) {
                optionTypeText = 'INVERSE CALL';
            } else if (position.optionType === 257) {
                optionTypeText = 'PUT';
            } else {
                optionTypeText = `Type ${position.optionType}`;
            }
            
            // PnL display with USD tooltip and settlement price info
            const pnlClass = position.pnl.value >= 0 ? 'text-success' : 'text-danger';
            const pnlPrefix = position.pnl.value >= 0 ? '+' : '';
            const pnlPercentage = position.pnl.percentage.toFixed(2);
            
            // Calculate USD value for tooltip
            const pnlUSD = this.convertPnLToUSD(position.pnl.value, position.collateralSymbol);
            
            // Create enhanced tooltip with settlement price info
            let usdTooltip = this.formatUSDTooltip(pnlUSD);
            
            // Only show expiry price information when the position is expired AND settlement time has passed
            const isExpired = position.expiryTimestamp <= currentTime;
            const isSettlementTimeReached = this.isSettlementTimeReached();
            
            if (isExpired && isSettlementTimeReached) {
                // Check cache synchronously for tooltip (don't fetch to avoid blocking UI)
                const cacheKey = `${position.underlyingAsset}_settlement_${this.getLastSettlementTimestamp(position.underlyingAsset)}`;
                const cachedSettlementPrice = this.settlementPriceCache.get(cacheKey);
                
                if (cachedSettlementPrice !== undefined) {
                    usdTooltip += `\nExpiry Price: $${cachedSettlementPrice.toFixed(2)}`;
                    usdTooltip += `\nUsing TWAP settlement pricing`;
                } else {
                    usdTooltip += `\nExpired - Settlement price loading...`;
                }
            } else if (isExpired && !isSettlementTimeReached) {
                usdTooltip += `\nExpired - Settlement at 08:00 UTC`;
            }
            
            // Add visual indicator for expired positions
            const expiryClass = isExpired ? 'expired-position' : '';
            
            row.innerHTML = `
                <td class="${expiryClass}">${displayAddress}</td>
                <td>${position.underlyingAsset}</td>
                <td>${optionTypeText}</td>
                <td>${strike.toLocaleString()}</td>
                <td>${collateral} ${position.collateralSymbol}</td>
                <td>${premium} ${position.collateralSymbol}</td>
                <td class="${pnlClass} ${expiryClass}" title="${usdTooltip}" style="cursor: help;"><strong>${pnlPrefix}${position.pnl.displayValue} (${pnlPrefix}${pnlPercentage}%)</strong></td>
                <td class="${timeRemaining < 3600 ? 'text-danger' : ''} ${expiryClass}">${timeRemainingText}</td>
                <td>
                    <a href="https://basescan.org/tx/${position.entryTxHash}" target="_blank" class="btn btn-sm btn-outline-primary">
                        View
                    </a>
                </td>
            `;
            
            tableBody.appendChild(row);
        });
    },
    
    // Calculate PnL for a position using current market prices or settlement prices
    calculatePositionPnL: async function(position) {
        // Get current market price for the underlying asset
        let currentPrice = state?.market_prices?.[position.underlyingAsset] || 0;
        
        // Check if position is expired (simple check based on timestamp)
        const currentTime = Math.floor(Date.now() / 1000);
        const isExpired = position.expiryTimestamp < currentTime;
        
        // If position is expired AND settlement time has been reached, use settlement price if available
        if (isExpired && this.isSettlementTimeReached()) {
            const settlementPrice = await this.getSettlementPrice(position.underlyingAsset, position.address);
            if (settlementPrice) {
                currentPrice = settlementPrice;
            }
        }
        
        if (!currentPrice) {
            return { value: 0, percentage: 0, displayValue: 'N/A' };
        }
        
        // Get strike price
        const strike = parseFloat(position.strikes[0]) / 10**8;
        
        // Get premium paid (initial cost)
        const premium = parseFloat(position.entryPremium) / 10**position.collateralDecimals;
        
        // Calculate contracts size (for normalization)
        let contractSize = parseFloat(position.numContracts) / 10**position.collateralDecimals;
        
        let currentValue = 0;
        
        // Calculate intrinsic value based on option type
        if (position.optionType === 0) { // INVERSE CALL
            // Inverse call pays out if price is ABOVE strike
            if (currentPrice > strike) {
                // Payout formula: contracts * (1 - strike/currentPrice)
                const priceDifference = 1 - (strike / currentPrice);
                currentValue = contractSize * priceDifference;
            } else {
                // Out of the money - worth zero
                currentValue = 0;
            }
        } else if (position.optionType === 257) { // PUT
            // Put pays out if price is BELOW strike
            if (currentPrice < strike) {
                // Payout formula: contracts * (strike - currentPrice)
                const priceDifference = strike - currentPrice;
                currentValue = contractSize * priceDifference;
            } else {
                // Out of the money - worth zero
                currentValue = 0;
            }
        }
        
        // PnL = current value - premium paid
        const pnlValue = currentValue - premium;
        
        // Calculate percentage return relative to premium paid
        const pnlPercentage = (pnlValue / premium) * 100;
        
        // Format display value based on collateral token
        let displayValue;
        if (position.collateralDecimals === 6) { // USDC
            displayValue = `$${Math.abs(pnlValue).toFixed(2)}`;
        } else if (position.collateralDecimals === 8) { // CBBTC
            displayValue = `${Math.abs(pnlValue).toFixed(8)} ${position.collateralSymbol}`;
        } else if (position.collateralDecimals === 18) { // WETH
            displayValue = `${Math.abs(pnlValue).toFixed(6)} ${position.collateralSymbol}`;
        } else {
            displayValue = Math.abs(pnlValue).toFixed(4);
        }
        
        return {
            value: pnlValue,
            percentage: pnlPercentage,
            displayValue: displayValue,
            usd_value: pnlValue * (position.optionType == 0 ? currentPrice : 1),
            num_contracts: contractSize
        };
    },
    
    // Sort open positions by the selected criterion
    sortOpenPositionsBy: function(criterion) {
        if (!this.openPositions || this.openPositions.length === 0) return;
        
        switch (criterion) {
            case 'pnl':
                // Sort by PnL (descending)
                this.openPositions.sort((a, b) => b.pnl.usd_value - a.pnl.usd_value);
                break;
            case 'size':
                // Sort by position size (descending)
                this.openPositions.sort((a, b) => b.pnl.num_contracts - a.pnl.num_contracts);
                break;
            case 'time':
                // Sort by time remaining (ascending)
                const now = Math.floor(Date.now() / 1000);
                this.openPositions.sort((a, b) => {
                    const aTimeLeft = a.expiryTimestamp - now;
                    const bTimeLeft = b.expiryTimestamp - now;
                    return aTimeLeft - bTimeLeft;
                });
                break;
        }
        // Re-render the table with the sorted positions
        this.renderOpenPositions();
    },
    
    // Render the profitable trades table
    renderProfitableTrades: function() {
        const tableBody = document.getElementById('profitable-trades-table-body');
        if (!tableBody) {
            return; // Table might not exist in all versions
        }
        
        tableBody.innerHTML = '';
        
        // Show loading state initially
        const loadingElement = document.getElementById('loading-profitable-trades');
        const noDataElement = document.getElementById('no-profitable-trades-data');
        
        if (loadingElement) loadingElement.style.display = 'block';
        if (noDataElement) noDataElement.style.display = 'none';
        
        // Use the appropriate data array based on current view
        const activeTrades = this.currentView === 'all' ? this.profitableTrades : this.weeklyProfitableTrades;
        
        // Update table title based on current view
        const profitableTradesTitle = document.querySelector('#scoreboard-section h2:nth-of-type(3)');
        if (profitableTradesTitle) {
            profitableTradesTitle.textContent = this.currentView === 'all' ? 
                'Top Profitable Trades' : 'Top Weekly Profitable Trades';
        }
        
        if (!activeTrades || activeTrades.length === 0) {
            if (loadingElement) loadingElement.style.display = 'none';
            if (noDataElement) {
                noDataElement.style.display = 'block';
                noDataElement.innerHTML = '<p>No profitable trades data available yet.</p>';
            }
            return;
        }
        
        // Render data rows
        activeTrades.forEach((trade, index) => {
            const row = document.createElement('tr');
            
            // Highlight top 3 with special classes
            if (index < 3) {
                row.classList.add(`rank-${index + 1}`);
            }
            
            // Format address for display with null check
            let displayAddress = 'Unknown';
            if (trade.userAddress) {
                displayAddress = `${trade.userAddress.substring(0, 6)}...${trade.userAddress.substring(38)}`;
            }
            
            // Format monetary values with proper dollar formatting
            const formatUSD = (value) => {
                if (value === null || value === undefined || isNaN(value)) {
                    return '$0.00';
                }
                return '$' + value.toFixed(2);
            };
            
            // Add medal emojis for top 3 ranks
            let rankDisplay = (index + 1).toString();
            if (index === 0) rankDisplay = '🥇 ' + rankDisplay;
            else if (index === 1) rankDisplay = '🥈 ' + rankDisplay;
            else if (index === 2) rankDisplay = '🥉 ' + rankDisplay;
            
            // Format return percentage with null check
            const returnPercentage = (trade.percentageReturn || 0).toFixed(2);
            
            // Get trade description or create one from available data
            let tradeDescription = trade.tradeDescription || 'Trade details unavailable';
            
            // Format values with null checks
            const profit = formatUSD(trade.absoluteReturn || 0);
            const premiumPaid = formatUSD(trade.premiumPaid || 0);
            const asset = trade.asset || 'Unknown';
            const userAddress = trade.userAddress || '';
            
            row.innerHTML = `
                <td><strong>${rankDisplay}</strong></td>
                <td title="${userAddress}" class="trader-address">${displayAddress}</td>
                <td>${tradeDescription}</td>
                <td class="text-success"><strong>${profit}</strong></td>
                <td class="text-success"><strong>+${returnPercentage}%</strong></td>
                <td>${premiumPaid}</td>
                <td>${asset}</td>
            `;
            
            tableBody.appendChild(row);
        });
        
        if (loadingElement) loadingElement.style.display = 'none';
        
        // Initialize tooltips
        if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
            const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
            tooltipTriggerList.map(function (tooltipTriggerEl) {
                return new bootstrap.Tooltip(tooltipTriggerEl);
            });
        }
    },

    // Method to refresh settlement prices (useful for manual refresh)
    refreshSettlementPrices: async function() {
        // Clear expired cache entries
        this.clearExpiredCache();
        
        // Clear all cached settlement prices to force refetch
        this.settlementPriceCache.clear();
        
        // Recalculate PnL for all positions (will fetch settlement prices on demand)
        const pnlPromises = this.openPositions.map(async (position) => {
            try {
                position.pnl = await this.calculatePositionPnL(position);
            } catch (pnlError) {
                console.error(`Error calculating PnL for position ${position.address}:`, pnlError);
                position.pnl = { value: 0, percentage: 0, displayValue: 'Error', usd_value: 0, num_contracts: 0 };
            }
        });
        
        await Promise.all(pnlPromises);
        
        // Re-render the table
        this.renderOpenPositions();
    },

    // Clear expired cache entries to prevent memory bloat
    clearExpiredCache: function() {
        const currentTime = Date.now();
        const maxCacheAge = 24 * 60 * 60 * 1000; // 24 hours
        
        for (const [key, value] of this.settlementPriceCache.entries()) {
            // Extract timestamp from cache key
            const timestampMatch = key.match(/_settlement_(\d+)$/);
            if (timestampMatch) {
                const cacheTimestamp = parseInt(timestampMatch[1]);
                if (currentTime - cacheTimestamp > maxCacheAge) {
                    this.settlementPriceCache.delete(key);
                }
            }
        }
    },

    // Method to add refresh button functionality
    addRefreshButton: function() {
        const sortControls = document.querySelector('.sort-controls .btn-group');
        if (sortControls && !document.getElementById('refresh-positions-btn')) {
            const refreshButton = document.createElement('button');
            refreshButton.id = 'refresh-positions-btn';
            refreshButton.className = 'btn btn-outline-primary';
            refreshButton.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Refresh';
            refreshButton.title = 'Refresh positions data';
            
            refreshButton.addEventListener('click', () => {
                this.loadOpenPositionsData();
            });
            
            sortControls.appendChild(refreshButton);
        }
    }
};

// Make scoreboard available globally
window.scoreboard = scoreboard;
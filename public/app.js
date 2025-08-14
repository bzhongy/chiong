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

// Simple notification function for basic messages
function showNotification(message, type = 'info') {
    // Create notification container if it doesn't exist
    let container = document.getElementById('simple-notification-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'simple-notification-container';
        container.className = 'simple-notification-container';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            max-width: 400px;
        `;
        document.body.appendChild(container);
    }
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `alert alert-${type === 'error' ? 'danger' : type} alert-dismissible fade show mb-2`;
    notification.style.cssText = `
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        border: none;
        border-radius: 8px;
        margin-bottom: 10px;
        animation: slideInRight 0.3s ease-out;
    `;
    
    // Set icon based on type
    let icon = '';
    switch (type) {
        case 'success':
            icon = '<i class="bi bi-check-circle-fill me-2"></i>';
            break;
        case 'error':
            icon = '<i class="bi bi-x-circle-fill me-2"></i>';
            break;
        case 'warning':
            icon = '<i class="bi bi-exclamation-triangle-fill me-2"></i>';
            break;
        default:
            icon = '<i class="bi bi-info-circle-fill me-2"></i>';
    }
    
    notification.innerHTML = `
        ${icon}
        <span>${message}</span>
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    // Add to container
    container.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 5000);
    
    // Add close button functionality
    const closeBtn = notification.querySelector('.btn-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            notification.remove();
        });
    }
}

// Add CSS for slide-in animation
if (!document.getElementById('simple-notification-styles')) {
    const style = document.createElement('style');
    style.id = 'simple-notification-styles';
    style.textContent = `
        @keyframes slideInRight {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
    `;
    document.head.appendChild(style);
}

async function refreshData() {
    try {
        // Store current slider position before refresh
        if ($('#advanced-view-container').is(':visible')) {
            lastSelectedSliderPosition = parseInt($('#adv-conviction-slider').val());
        } else {
            lastSelectedSliderPosition = parseInt($('#conviction-slider').val());
        }
        
        // Fetch orders from API
        const response = await fetch(MARKET_DATA_API);
        const data = await response.json();
        
        // Set expiry time from API data
        const apiExpiry = getExpiryFromAPI(data.data.orders);
        if (apiExpiry) {
            state.expiryTime = apiExpiry;
        }

        if (state.expiryTime) {
            const expiryTimestampSeconds = Math.floor(state.expiryTime / 1000);
            $('#option-expiry')
                .attr('data-countdown-expiry', expiryTimestampSeconds)
                .data('expiry', expiryTimestampSeconds); // Optional: also store in jQuery data

            // Update the static display text as well (e.g., "08:00 UTC EXPIRY")
            const expiryDate = new Date(state.expiryTime);
            const hours = expiryDate.getUTCHours().toString().padStart(2, '0');
            const minutes = expiryDate.getUTCMinutes().toString().padStart(2, '0');
             $('#expiry-time').text(`${hours}:${minutes} UTC EXPIRY`); // Update the static display if needed

        } else {
            // Handle case where expiry is unknown
            $('#option-expiry').text('--:--:--').removeAttr('data-countdown-expiry');
            $('#expiry-time').text(`UNKNOWN EXPIRY`); // Update static display
        }

        // Extract and store market prices for all assets
        if (data.data.market_data) {            
            // Store all market prices in state
            state.market_prices = data.data.market_data;
            
            // Update price displays with current asset's price
            const currentAssetPrice = state.market_prices[state.selectedAsset];
            if (currentAssetPrice) {
                updateDualUI('current-price', currentAssetPrice, 'text', formatNumber);
            }
            
            // Update ETH balance display with new market prices
            if (typeof updateETHBalance === 'function') {
                updateETHBalance();
            }
        }
        
        // Rest of the function remains the same
        state.orders = data.data.orders;
        
        // Filter orders for the selected asset
        const filteredOrders = state.orders.filter(order => {
            return CONFIG.getUnderlyingAsset(order.order.priceFeed) === state.selectedAsset;
        });
        state.orders = filteredOrders;
        
        // Sort orders by strike price
        state.orders.sort((a, b) => {
            return parseInt(a.order.strikes[0]) - parseInt(b.order.strikes[0]);
        });

        // Update expiry time display
        updateCountdowns();

        // Setup the conviction slider with discrete tick marks for specific strikes
        setupConvictionSlider();
        
        // Select the option based on slider position
        await selectOptionBasedOnConviction();
        
        // Populate advanced view options table (always show since advanced is now default)
        console.log('Refreshing data, populating options table...');
        if (typeof populateOptionsTable === 'function') {
            populateOptionsTable();
        } else {
            console.warn('populateOptionsTable function not available');
        }
        
        // Update positions if on positions tab
        if ($('#positions-section').is(':visible')) {
            refreshPositions();
        }
        
        // Update the Beta flag liquidity information
        await updateLiquidityInfo();
        
        // Update the user wallet balance
        updateWalletBalance();

        // Update ETH balance for wrapping functionality
        if (typeof updateETHBalance === 'function') {
            updateETHBalance();
        }

        // Show warning if near expiry
        if (isNearExpiry()) {
            $('.expiry-warning').show();
        } else {
            $('.expiry-warning').hide();
        }
    } catch (error) {
        console.error('Error refreshing data:', error);
    }
}

// Populate the options table in advanced view
function populateOptionsTable() {
    const tableBody = $('#options-table-body');
    
    if (!tableBody.length) {
        console.error('Options table body not found');
        return;
    }
    
    tableBody.empty();
    
    if (!state.orders || state.orders.length === 0) {
        console.warn('No orders available to populate table');
        tableBody.html('<tr><td colspan="9" class="text-center text-muted">No options available</td></tr>');
        return;
    }
    
    // Sort orders by expiry time (earliest first)
    const sortedOrders = [...state.orders].sort((a, b) => {
        const expiryA = parseInt(a.order.expiry) || 0;
        const expiryB = parseInt(b.order.expiry) || 0;
        return expiryA - expiryB; // Ascending order (earliest first)
    });
    
    for (let i = 0; i < sortedOrders.length; i++) {
        const order = sortedOrders[i].order;

        
        const optionType = order.isCall ? "CALL" : "PUT";
        const collateral = CONFIG.getCollateralDetails(order.collateral);
        const strike = formatUnits(order.strikes[0], PRICE_DECIMALS);
        
        // Format premium using our centralized calculator
        const premium = parseFloat(formatUnits(order.price, PRICE_DECIMALS));
        
        // Calculate payout ratio with our centralized calculator
        const payoutRatio = optionCalculator.calculateLeverage(premium, order, collateral);
        
        // Calculate breakeven using centralized calculator
        const breakeven = optionCalculator.calculateBreakeven(order.isCall, parseFloat(strike), premium).toFixed(2);
        
        // Calculate Greeks using centralized calculator
        const { theta, delta, iv } = state.orders[i].greeks;
        
        // Format expiry date from individual order
        let expiryDisplay = 'N/A';
        if (order.expiry) {
            try {
                const orderExpiryTimestamp = parseInt(order.expiry) * 1000; // Convert to milliseconds
                if (!isNaN(orderExpiryTimestamp) && orderExpiryTimestamp > 0) {
                    const expiryDate = new Date(orderExpiryTimestamp);
                    const expiryTimeString = expiryDate.toLocaleTimeString('en-US', { 
                        hour12: false, 
                        hour: '2-digit', 
                        minute: '2-digit',
                        timeZone: 'UTC'
                    });
                    const expiryDateString = expiryDate.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        timeZone: 'UTC'
                    });
                    expiryDisplay = `${expiryDateString} ${expiryTimeString} UTC`;

                }
            } catch (error) {
                console.warn('Error formatting expiry date for order:', order, error);
                expiryDisplay = 'Invalid';
            }
        } else {
            
        }
        
        // Use the loop index directly for reliable row selection
        const row = `
            <tr class="option-row ${i === state.selectedOrderIndex ? 'selected' : ''}" data-index="${i}">
                <td>$${formatNumber(strike)}</td>
                <td>${optionType}</td>
                <td title="Expires at ${expiryDisplay}">${expiryDisplay}</td>
                <td>$${formatNumber(premium)}</td>
                <td>${payoutRatio}x</td>
                <td>$${breakeven}</td>
                <td>${delta.toFixed(2)}</td>
                <td>${parseInt(iv*100)}%</td>
                <td><button class="btn btn-sm btn-outline-primary select-option-btn">Select</button></td>
            </tr>
        `;
        tableBody.append(row);
    }
}

// Set the expiry time for the current day
function setExpiryTime() {
    const now = new Date();
    const expiryDate = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        UTC_EXPIRY_HOUR, // 8:00 UTC
        0, 0, 0
    ));
    
    // If current time is after expiry, set for next day
    if (now >= expiryDate) {
        expiryDate.setUTCDate(expiryDate.getUTCDate() + 1);
    }
    
    state.expiryTime = expiryDate;
    $('#expiry-time').text(`${UTC_EXPIRY_HOUR}:00 UTC EXPIRY`);
}

// Get time remaining until expiry in seconds
function getTimeToExpiry() {
    if (!state.expiryTime) return 0;
    
    const now = Date.now();
    const timeLeftMs = state.expiryTime - now;
    return Math.max(0, Math.floor(timeLeftMs / 1000));
}

// Check if we're within 2 hours of expiry
function isNearExpiry() {
    const timeLeftSeconds = getTimeToExpiry();
    return timeLeftSeconds < TWO_HOURS_IN_SECONDS;
}

// Update all countdown timers using data attributes
function updateCountdowns() {
    const now = Math.floor(Date.now() / 1000); // Current time in seconds

    // Find all elements with the 'data-countdown-expiry' attribute
    $('[data-countdown-expiry]').each(function() {
        const element = $(this);
        const expiryTime = parseInt(element.attr('data-countdown-expiry'), 10); // Get expiry from attribute

        if (isNaN(expiryTime)) {
            console.warn("Invalid expiry time found for element:", element);
            return; // Skip this element
        }

        const timeLeft = expiryTime - now;

        if (timeLeft <= 0) {
            // Position has expired
            element.html('<span class="status-expired">Expired</span>');
            element.removeClass('expiring-soon'); // Remove expiring class if present
            // Optionally add a class to indicate expired state if needed beyond the text
            element.addClass('is-expired');
        } else {
            // Position is still active, update the countdown
            element.text(formatTimeDisplay(timeLeft));
            element.removeClass('is-expired'); // Ensure not marked as expired

            // Highlight countdown if it's close to expiry (e.g., less than 5 minutes)
            if (timeLeft < 300) {
                element.addClass('expiring-soon');
            } else {
                element.removeClass('expiring-soon');
            }
        }
    });

    // Continue updating every second using setTimeout for a continuous loop
    if (state.countDownInterval > 0) {
        clearInterval(state.countDownInterval);
    }
    state.countDownInterval = setTimeout(updateCountdowns, 1000);
}

// Refresh positions data
async function refreshPositions() {
    try {
        if (!state.connectedAddress) {
            console.log("Not connected, can't fetch positions");
            return;
        }
        
        // Create a document fragment to build the new content
        const fragment = document.createDocumentFragment();
        const tempContainer = document.createElement('div');
        fragment.appendChild(tempContainer);
        
        // Fetch user positions from worker API
        const userAddress = state.connectedAddress.toLowerCase();
        const response = await fetch(`https://odette.fi/api/user/${userAddress}/positions`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to fetch positions: ${response.status}`);
        }
        
        const data = await response.json();
        console.log("Received positions data:", data);
        
        // Store the positions data in the state for future reference
        state.userPositions = {
            openPositions: data,
            historyPositions: []
        };
        
        // Process and display positions - check if data is empty or falsy
        if (!data || data.length === 0) {
            tempContainer.innerHTML = `
                <div class="no-positions-message">
                    <p>You have no active positions. <a href="#" id="go-to-trade">Start trading now</a>.</p>
                </div>
            `;
        } else {
            // Build the positions container structure
            tempContainer.innerHTML = `
                <h3 class="mb-4">Open Positions</h3>
                <div id="open-positions" class="mb-5"></div>
            `;
            
            const openPositionsDiv = tempContainer.querySelector('#open-positions');
            const processedPositionsPromises = data.map(async (position, index) => {
                try {
                    const uiPosition = transformPositionForUI(position);
                    return createPositionCard(uiPosition, index, 'open');
                } catch (err) {
                    console.error("Error processing position:", err, position);
                    return `
                        <div class="alert alert-warning">
                            Error displaying position ${index}: ${err.message}
                        </div>
                    `;
                }
            });
            const processedPositions = await Promise.all(processedPositionsPromises);
            
            // Add all processed positions to the container
            openPositionsDiv.innerHTML = processedPositions.join('');
            
            // If no position cards were added, show a message
            if (openPositionsDiv.children.length === 0) {
                openPositionsDiv.innerHTML = `
                    <div class="alert alert-info">
                        No positions found for the selected asset. Try selecting "ALL" from the dropdown.
                    </div>
                `;
            }
        }
        
        // Only update the DOM once with all changes
        const positionsContainer = document.getElementById('positions-container');
        positionsContainer.innerHTML = ''; // Clear existing content
        positionsContainer.appendChild(fragment);
        
        // Reattach event listeners after DOM update
        $('#go-to-trade').on('click', function(e) {
            e.preventDefault();
            showSection('trade');
        });
        
        $('.position-card').on('click', function() {
            const index = $(this).data('index');
            const type = $(this).data('type');
            showPositionDetails(index, type);
        });
        
    } catch (error) {
        console.error("Error refreshing positions:", error);
        $('#positions-container').html(`
            <div class="alert alert-danger">
                Failed to load positions: ${error.message}
            </div>
        `);
    }
}

// Helper function to transform API position data to UI-compatible format
function transformPositionForUI(apiPosition) {
    try {
        let asset;

        if (apiPosition.priceFeed) {
            for (const [key, value] of Object.entries(CONFIG.priceFeedsMap)) {
                if (value.toLowerCase() === apiPosition.priceFeed.toLowerCase()) {
                    asset = key;
                    break;
                }
            }
        }
        // Get collateral details - use the address directly if available
        const collateral = CONFIG.getCollateralDetails(apiPosition.collateralToken);
        
        // Determine option type (CALL or PUT)
        // optionTypeRaw: 0x0000 is an inverse vanilla call, 0x0101 is a vanilla put
        const isCall = apiPosition.optionTypeRaw === 0x0000;
        const optionTypeDisplay = isCall ? 'CALL' : 'PUT';
        
        // Format strike price (from smallest unit to display format)
        const strikePrice = parseFloat(formatUnits(apiPosition.strikes[0], PRICE_DECIMALS));
        
        // Format cost (premium paid) - ensure proper decimals
        const entryPremium = apiPosition.entryPremium;
        const premiumDecimals = apiPosition.collateralDecimals;
        const cost = parseFloat(formatUnits(entryPremium, premiumDecimals));
        
        // Calculate contracts (from smallest unit to display format)
        const numContracts = apiPosition.numContracts;
    
        // Calculate payout ratio properly based on numContracts and decimals
        const payoutRatio = ethers.utils.formatUnits(numContracts, premiumDecimals);
        
        // Use the actual market price from our stored market_prices if available
        const currentPrice = state.market_prices[asset];
        
        return {
            optionAddress: apiPosition.address,
            id: apiPosition.entryTxHash,
            asset: asset,
            optionType: optionTypeDisplay,
            optionTypeRaw: apiPosition.optionTypeRaw, // Keep the raw value for reference
            strikePrice: strikePrice,
            cost: cost,
            collateralSymbol: apiPosition.collateralSymbol,
            collateralToken: apiPosition.collateralToken,
            payoutToken: apiPosition.collateralToken,
            payoutRatio: payoutRatio,
            currentPrice: currentPrice,
            timestamp: apiPosition.entryTimestamp * 1000, // Convert to milliseconds 
            expiryTime: apiPosition.expiryTimestamp * 1000, // Convert to milliseconds
            status: apiPosition.status || 'open',
            numContracts: numContracts,
            estimatedPnl: 0, // Placeholder for estimated PnL,
            settlementPrice: apiPosition.settlement.settlementPrice / 1e8
        };
    } catch (err) {
        console.error("Error in transformPositionForUI:", err, apiPosition);
        throw err;
    }
}

// Add a function to fetch TWAP settlement price for expired options
async function fetchSettlementTWAP(optionAddress) {
    try {
        const { readContract } = WagmiCore;
        const twapResult = await readContract({
            address: optionAddress,
            abi: OPTION_ABI,
            functionName: 'getTWAP',
            chainId: 8453 // adjust to your network's chain ID
        });
        return formatUnits(twapResult, PRICE_DECIMALS);
    } catch (error) {
        console.error(`Error fetching TWAP for option ${optionAddress}:`, error);
        return null;
    }
}


// Helper function to create a position card
async function createPositionCard(position, index, type) {
    // Calculate PnL and status
    
    const strikePrice = parseFloat(position.strikePrice);
    const settlementPrice = parseFloat(position.settlementPrice || 0);
    const currentPrice = settlementPrice > 0 ? settlementPrice : parseFloat(position.currentPrice || 0);

    const isPut = position.optionType === 'PUT';
    const isCall = position.optionType === 'CALL';
    const isInverseCall = position.optionType === 'INVERSE_CALL';

    let statusClass = 'status-negative';
    let statusText = '';
    let pnlClass = 'pnl-negative';
    let pnlText = '';

    console.log("Settlement test: ", position.optionAddress, Date.now(), position.expiryTime, position.optionAddress, position.settlementPrice);

    if (type === 'open') {
        // For open positions, calculate current status
        if (isCall || isInverseCall) {
            if (currentPrice > strikePrice) {
                statusClass = 'status-positive';
                statusText = 'IN THE MONEY';
            } else {
                statusText = `Needs -$${(strikePrice - currentPrice).toFixed(2)} to reach strike`;
            }
        } else if (isPut) {
            if (currentPrice < strikePrice) {
                statusClass = 'status-positive';
                statusText = 'IN THE MONEY';
            } else {
                statusText = `Needs -$${(currentPrice - strikePrice).toFixed(2)} to reach strike`;
            }
        }

        if (settlementPrice > 0) {
            if (statusClass == 'status-positive')
                statusText = "EXPIRED ITM";
            else
                statusText = "EXPIRED OTM";
        }

        // Calculate PnL if possible
        if (position.estimatedPnl) {
            const pnlAmount = parseFloat(position.estimatedPnl);
            const pnlPercent = (pnlAmount / position.cost) * 100;
            
            if (pnlAmount > 0) {
                pnlClass = 'pnl-positive';
                pnlText = `+$${pnlAmount.toFixed(2)} (${pnlPercent.toFixed(1)}%)`;
            } else {
                pnlText = `-$${Math.abs(pnlAmount).toFixed(2)} (${Math.abs(pnlPercent).toFixed(1)}%)`;
            }
        }
    } else {
        // For history positions, show final result
        if (position.status === 'settled' && position.payout > 0) {
            statusClass = 'status-positive';
            statusText = 'PROFIT';
            pnlClass = 'pnl-positive';
            const pnlAmount = position.payout - position.cost;
            const pnlPercent = (pnlAmount / position.cost) * 100;
            pnlText = `+$${pnlAmount.toFixed(2)} (${pnlPercent.toFixed(1)}%)`;
        } else {
            statusText = 'EXPIRED';
            pnlText = `-$${position.cost.toFixed(2)} (100%)`;
        }
    }
    
    // Format option type for display
    let optionTypeDisplay = '';
    if (isCall) optionTypeDisplay = 'CALL';
    else if (isPut) optionTypeDisplay = 'PUT';
    else if (isInverseCall) optionTypeDisplay = 'INVERSE CALL';
    
    // Format countdown or expiry time
    let timeDisplay = '';
    if (type === 'open') {
        timeDisplay = `<div class="position-detail-item">
            <div class="position-detail-label">Time Left:</div>
            <div class="position-detail-value countdown" data-expiry="${position.expiryTime}">
                ${formatTimeDisplay(Math.max(0, (position.expiryTime - Date.now()) / 1000))}
            </div>
        </div>`;
    } else {
        timeDisplay = `<div class="position-detail-item">
            <div class="position-detail-label">Expired:</div>
            <div class="position-detail-value">
                ${new Date(position.expiryTime).toLocaleString()}
            </div>
        </div>`;
    }
    
    // Create the option address display - use the option address instead of collateral
    // For most options, this will be in apiPosition.optionAddress or position.optionAddress
    const optionAddress = position.optionAddress;
    console.log(position);
    const optionAddressDisplay = optionAddress ? `
        <div class="collateral-address">
            Fully collateralised with ${parseFloat(position.payoutRatio * (isCall || isInverseCall ? 1 : position.strikePrice)).toFixed(6)} ${position.collateralSymbol} held at option contract <a href="https://basescan.org/address/${optionAddress}" target="_blank">${shortenAddress(optionAddress)}</a>
        </div>
    ` : '';
    
    // Check if the position is expired
    const expiryTimestampSeconds = Math.floor(position.expiryTime / 1000);
    const now = Math.floor(Date.now() / 1000);
    const isExpired = now > expiryTimestampSeconds && !position.settled;
    
    // Create time remaining HTML and set up countdown if needed
    let timeRemainingHTML = `
        <div class="position-detail-item">
            <div class="position-detail-label">Time Left:</div>
            <div class="position-detail-value">
                <span class="countdown"
                      id="position-${type}-${index}-time"
                      data-countdown-expiry="${expiryTimestampSeconds}">
                    ${isExpired ? '<span class="status-expired">Expired</span>' : formatTimeDisplay(expiryTimestampSeconds - now)}
                </span>
            </div>
        </div>
    `;
    
    return `
        <div class="position-card" data-index="${index}" data-type="${type}">
            <div class="position-header">
                <h4 class="position-title">
                    ${position.asset} ${optionTypeDisplay} @ $${strikePrice.toFixed(2)}

                    <p>
                        ${optionAddressDisplay}
                    </p>
                </h4>
                
                <div>
                    <span class="position-status ${statusClass}">${statusText}</span>
                    <span class="position-pnl ${pnlClass}">${pnlText}</span>
                </div>
            </div>
            <div class="position-details">
                <div class="position-detail-item">
                    <div class="position-detail-label">Cost:</div>
                    <div class="position-detail-value">${position.cost.toFixed(6)} ${position.collateralSymbol}</div>
                </div>
                <div class="position-detail-item">
                    <div class="position-detail-label">Payout:</div>
                    <div class="position-detail-value">${parseFloat(position.payoutRatio).toFixed(6)} for each $1 ${isCall || isInverseCall ? 'above' : 'below'} $${strikePrice.toFixed(2)}</div>
                </div>
                <div class="position-detail-item">
                    <div class="position-detail-label">${position.settlementPrice ? 'TWAP Settlement Price:' : 'Current Price:'}</div>
                    <div class="position-detail-value">$${position.settlementPrice ? position.settlementPrice : currentPrice.toFixed(2)}</div>
                </div>
                ${timeRemainingHTML}
            </div>
            <div class="position-actions">
                <button class="btn btn-sm btn-outline-primary position-details-btn" data-position-index="${index}" data-position-type="${type}">View Details</button>
            </div>
        </div>
    `;
}

// Update the position details view functionality
function showPositionDetails(index, type = 'open') {
    try {
        // Determine which array to use based on type
        let positions;
        if (type === 'open') {
            positions = state.userPositions?.openPositions || [];
        } else {
            positions = state.userPositions?.historyPositions || [];
        }

        if (!positions || index < 0 || index >= positions.length) {
            console.error("Position index out of bounds or positions array empty:", index, type, positions);
            showNotification("Could not load position details. Position not found.", "error");
            return;
       }
        // Get the position from the array - make sure it's transformed
        const apiPosition = positions[index];
        // Check if this is already a transformed position or needs transformation
        const position = apiPosition.asset ? apiPosition : transformPositionForUI(apiPosition);
        
        console.log("Showing position details for:", position);
        
        // Set modal title with fallbacks
        const optionType = position.optionType || 'CALL';
        const strikePrice = position.strikePrice || 0;
        $('#position-modal-title').text(`${position.asset || 'ETH'} ${optionType} @ $${strikePrice.toFixed(2)}`);
        
        // Set trade details with fallbacks
        const cost = position.cost || 0;
        $('#position-modal-cost').text(`${cost.toFixed(6)} ${position.collateralSymbol || 'USDC'}`);
        
        const isCall = apiPosition.optionTypeRaw === 0x0000;
        const directionText = isCall ? 'above' : 'below';
        $('#position-modal-payout').text(`${position.payoutRatio || '1.0'} for every $1 ${directionText} $${strikePrice.toFixed(2)} in ${apiPosition.collateralSymbol}`);
        
        const timestamp = position.timestamp || Date.now();
        $('#position-modal-time').text(new Date(timestamp).toLocaleString());
        
        // Set current status with fallbacks
        console.log("position", position, apiPosition);
        const currentPrice = position.settlementPrice || position.currentPrice;
        $('#position-modal-current-price').text(`$${currentPrice.toFixed(2)}`);
        
        // Check if the option has expired but not been settled
        const now = Math.floor(Date.now() / 1000);
        const expiredButNotSettled = type === 'open' && now > position.expiryTime / 1000 && !position.settled;
        
        // Calculate status text
        let statusText = '';
        if (type === 'open') {
            if (expiredButNotSettled) {
                statusText = 'Expired - Ready to settle';
                $('#position-modal-status').html('<span class="status-expired">Expired</span> - Ready to settle');
                $('#settle-option-btn').show().data('positionId', apiPosition.entryTxHash || position.id);
                $('#settle-option-btn').data('positionType', type);
            } else {
                const diff = isCall 
                    ? strikePrice - currentPrice
                    : currentPrice - strikePrice;
                    
                if (diff > 0) {
                    statusText = `Needs ${isCall ? '+' : '-'}$${Math.abs(diff).toFixed(2)} to reach strike`;
                } else {
                    statusText = 'IN THE MONEY';
                }
                $('#position-modal-status').text(statusText);
                
                // Hide the settle button for non-expired options
                $('#settle-option-btn').hide();
            }
        } else {
            statusText = position.status === 'settled' && position.payout > 0 ? 'SETTLED WITH PROFIT' : 'EXPIRED WORTHLESS';
            $('#position-modal-status').text(statusText);
            
            // Hide the settle button for history positions
            $('#settle-option-btn').hide();
        }
        
        // Calculate and set P/L with fallbacks
        let pnlText = '';
        let pnlClass = '';
        
        if (type === 'open') {
            // For open positions, show estimated P/L based on current price vs strike
            const inTheMoney = isCall ? Math.max(0, currentPrice - strikePrice) : Math.max(0, strikePrice - currentPrice);
            const costInDollarTerms = cost * (isCall ? state.market_prices[position.asset] : 1);
            const numContracts = position.numContracts;
            const pnlAmount = (inTheMoney * numContracts / (10 ** apiPosition.collateralDecimals)) - costInDollarTerms;
            const pnlPercent = (pnlAmount / costInDollarTerms) * 100;

            console.log(isCall, inTheMoney, numContracts, apiPosition.collateralDecimals, pnlAmount, cost, costInDollarTerms);

            if (pnlAmount > 0) {
                pnlText = `+$${pnlAmount.toFixed(6)} (${pnlPercent.toFixed(1)}%)`;
                pnlClass = 'text-success';
            } else {
                pnlText = `-$${Math.abs(pnlAmount).toFixed(6)} (${Math.abs(pnlPercent).toFixed(1)}%)`;
                pnlClass = 'text-danger';
            }
        } else {
            // For history positions, show final result (default to loss)
            pnlText = `-$${cost.toFixed(2)} (100%)`;
            pnlClass = 'text-danger';
        }
        $('#position-modal-pnl').text(pnlText).removeClass('text-success text-danger').addClass(pnlClass);
        
        const expiryTimestampSeconds = Math.floor((position.expiryTime || Date.now()) / 1000);
        const isHistory = type === 'history';

        const timeLeftElement = $('#position-modal-time-left');
        const timeLeftContainer = timeLeftElement.closest('.detail-item'); // Find the container div

        if (isHistory) {
            // For history, show the expiry date/time statically
            timeLeftContainer.find('.detail-label').text('Expired:');
            timeLeftElement
                .text(new Date(position.expiryTime || Date.now()).toLocaleString())
                .removeAttr('data-countdown-expiry') // Remove countdown attribute
                .removeClass('countdown'); // Remove countdown class
        } else {
             // For open positions (active or expired-pending-settle)
            timeLeftContainer.find('.detail-label').text('Time Left:'); // Ensure label is correct
            timeLeftElement.addClass('countdown'); // Ensure class is present

            if (expiredButNotSettled) {
                timeLeftElement.html('<span class="status-expired">Expired</span> - Ready to settle');
                timeLeftElement.removeAttr('data-countdown-expiry'); // No countdown needed
                $('#settle-option-btn').show().data('positionId', apiPosition.entryTxHash || position.id).data('positionType', type); // Use ID from apiPosition if possible
            } else {
                 // Active position, set countdown attribute
                timeLeftElement.attr('data-countdown-expiry', expiryTimestampSeconds);
                // The text will be updated by the main updateCountdowns loop
                $('#settle-option-btn').hide();
            }
        }
        
        // Set up settlement scenarios with the transformed position
        updateSettlementScenarios(position);
        
        // Update settlement information dynamically based on position data
        updateSettlementInfo(position);
        
        // Show the modal
        const positionDetailModal = new bootstrap.Modal(document.getElementById('position-detail-modal'));
        positionDetailModal.show();
    } catch (error) {
        console.error("Error showing position details:", error);
        showNotification("There was an error displaying position details. Please try again.", "error");
    }
}

// Add a new function to update settlement information dynamically
function updateSettlementInfo(position) {
    // Extract position details with fallbacks
    const strikePrice = position.strikePrice || 0;
    const asset = position.asset || 'Unknown';
    const isCall = position.optionType === 'CALL';
    const expiryTime = new Date(position.expiryTime || Date.now());
    const expiryFormatted = `${UTC_EXPIRY_HOUR}:00 UTC`;
    
    // Format the strike price
    const formattedStrike = formatNumber(strikePrice);
    
    // Create dynamic settlement information text
    let aboveStrikeText, belowStrikeText;
    
    if (isCall) {
        // For CALL options
        aboveStrikeText = `If above $${formattedStrike}: Automatically settled to your wallet`;
        belowStrikeText = `If at/below $${formattedStrike}: Option expires worthless`;
    } else {
        // For PUT options
        aboveStrikeText = `If above $${formattedStrike}: Option expires worthless`;
        belowStrikeText = `If at/below $${formattedStrike}: Automatically settled to your wallet`;
    }
    
    // Update the settlement information section
    $('.settlement-info').html(`
        <h6>Settlement Information:</h6>
        <ul>
            <li>Settlement Price: Chainlink Oracle for ${asset} at ${expiryFormatted}, 30 minute TWAP </li>
            <li>${aboveStrikeText}</li>
            <li>${belowStrikeText}</li>
        </ul>
    `);
}

// Helper function to update settlement scenarios
function updateSettlementScenarios(position) {
    try {
        // Use the centralized calculator to get scenarios
        const scenarios = optionCalculator.calculateSettleentScenarios(position);
        
        // Update UI with scenario descriptions
        $('#position-scenario-loss').text(scenarios.loss.description);
        $('#position-scenario-breakeven').text(scenarios.breakeven.description);
        $('#position-scenario-profit1').text(scenarios.profit1.description);
        $('#position-scenario-profit2').text(scenarios.profit2.description);
    } catch (error) {
        console.error("Error updating settlement scenarios:", error);
        // Provide fallback scenario text to prevent UI errors
        $('#position-scenario-loss').text("Below strike: Option expires worthless");
        $('#position-scenario-breakeven').text("At breakeven: Recover cost");
        $('#position-scenario-profit1').text("Above strike: Profit increases");
        $('#position-scenario-profit2').text("Further increase: Higher profit");
    }
}

// Load trade history
async function loadTradeHistory() {
    try {
        const userAddress = state.connectedAddress.toLowerCase()
        // Check if wallet is connected first
        if (!userAddress) {
            document.getElementById('no-history-message').style.display = 'block';
            document.querySelector('.history-table-container table').style.display = 'none';
            return;
        }

        // Show loading state
        document.getElementById('history-table-body').innerHTML = '<tr><td colspan="9" class="text-center">Loading history...</td></tr>';
        
        // Fetch history from API
        const response = await fetch(`https://odette.fi/api/user/${userAddress}/history`);
        if (!response.ok) {
            throw new Error('Failed to fetch history data');
        }
        
        const history = await response.json();
        
        // Check if there's any history
        if (!history || history.length === 0) {
            document.getElementById('no-history-message').style.display = 'block';
            document.querySelector('.history-table-container table').style.display = 'none';
            return;
        }
        
        // Hide no history message and show table
        document.getElementById('no-history-message').style.display = 'none';
        document.querySelector('.history-table-container table').style.display = 'table';
        
        // Get filter values
        const assetFilter = document.getElementById('history-asset').value;
        const typeFilter = document.getElementById('history-type').value;
        const statusFilter = document.getElementById('history-status').value;
        const dateRangeFilter = document.getElementById('history-date-range').value;
        
        // Apply filters
        let filteredHistory = history;
        
        if (assetFilter !== 'all') {
            filteredHistory = filteredHistory.filter(item => item.underlyingAsset === assetFilter);
        }
        
        if (typeFilter !== 'all') {
            filteredHistory = filteredHistory.filter(item => getOptionTypeDisplay(item.optionType).includes(typeFilter));
        }
        
        if (statusFilter !== 'all') {
            filteredHistory = filteredHistory.filter(item => item.status === statusFilter);
        }
        
        if (dateRangeFilter !== 'all') {
            const now = Math.floor(Date.now() / 1000);
            let cutoffTime = now;
            
            if (dateRangeFilter === 'week') {
                cutoffTime = now - (7 * 24 * 60 * 60); // 7 days
            } else if (dateRangeFilter === 'month') {
                cutoffTime = now - (30 * 24 * 60 * 60); // 30 days
            }
            
            filteredHistory = filteredHistory.filter(item => item.entryTimestamp >= cutoffTime);
        }
        
        // Sort history in reverse chronological order (newest first)
        filteredHistory.sort((a, b) => b.entryTimestamp - a.entryTimestamp);
        
        // Render the filtered history
        renderHistoryTable(filteredHistory);
    } catch (error) {
        console.error('Error loading trade history:', error);
        document.getElementById('history-table-body').innerHTML = 
            '<tr><td colspan="9" class="text-center text-danger">Error loading history. Please try again later.</td></tr>';
    }
}

// Helper function to convert PnL values to USD
function convertPnLToUSD(pnlValue, collateralSymbol) {
    if (!pnlValue || isNaN(pnlValue)) return 0;
    
    switch (collateralSymbol) {
        case 'USDC':
            return pnlValue; // 1:1 conversion for USDC
        case 'WETH':
            return pnlValue * (state.market_prices['ETH'] || 0);
        case 'CBBTC':
            return pnlValue * (state.market_prices['BTC'] || 0);
        default:
            return 0;
    }
}

// Helper function to format USD value for tooltip
function formatUSDTooltip(usdValue) {
    if (usdValue === 0) return 'N/A';
    const prefix = usdValue >= 0 ? '+' : '';
    return `${prefix}$${Math.abs(usdValue).toFixed(2)} USD`;
}

function renderHistoryTable(history) {
    const tableBody = document.getElementById('history-table-body');
    tableBody.innerHTML = '';
    
    const userAddress = state.connectedAddress.toLowerCase();

    history.forEach(trade => {
        const row = document.createElement('tr');
        
        // Calculate PnL
        let pnl = 0;
        let pnlPercentage = 0;
        
        if (trade.status === 'settled') {
            if (trade.buyer.toLowerCase() === userAddress) {
                // User was the buyer
                pnl = trade.settlement?.payoutBuyer 
                    ? parseFloat(formatUnits(trade.settlement.payoutBuyer, trade.collateralDecimals)) - parseFloat(formatUnits(trade.entryPremium, trade.collateralDecimals))
                    : -parseFloat(formatUnits(trade.entryPremium, trade.collateralDecimals));
            } else if (trade.seller.toLowerCase() === userAddress) {
                // User was the seller
                pnl = trade.settlement?.collateralReturnedSeller
                    ? parseFloat(formatUnits(trade.settlement.collateralReturnedSeller, trade.collateralDecimals)) - 
                      parseFloat(formatUnits(trade.collateralAmount, trade.collateralDecimals)) + 
                      parseFloat(formatUnits(trade.entryPremium, trade.collateralDecimals))
                    : parseFloat(formatUnits(trade.entryPremium, trade.collateralDecimals)) - 
                      parseFloat(formatUnits(trade.collateralAmount, trade.collateralDecimals));
            }
            
            // Calculate percentage based on initial investment
            const initialInvestment = trade.buyer.toLowerCase() === userAddress
                ? parseFloat(formatUnits(trade.entryPremium, trade.collateralDecimals))
                : parseFloat(formatUnits(trade.collateralAmount, trade.collateralDecimals)) - parseFloat(formatUnits(trade.entryPremium, trade.collateralDecimals));
                
            pnlPercentage = (pnl / initialInvestment) * 100;
        }
        
        // Format the trade date
        const tradeDate = new Date(trade.entryTimestamp * 1000);
        const dateString = tradeDate.toLocaleDateString() + ' ' + tradeDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        // Format settlement price
        const settlementPrice = trade.settlement?.settlementPrice
            ? `$${formatNumberWithPrecision(formatUnits(trade.settlement.settlementPrice, 8), 2)}`
            : '-';
        
        // Determine if user was buyer or seller
        const userRole = trade.buyer.toLowerCase() === userAddress ? 'buyer' : 'seller';
        
        // Properly convert option type to CALL/PUT instead of raw hex values
        const optionType = getOptionTypeDisplayFromRaw(trade.optionType);
        
        // Format number of contracts by dividing by collateralDecimals
        const contractAmount = trade.numContracts && trade.collateralDecimals ? 
            parseFloat(formatUnits(trade.numContracts, trade.collateralDecimals)) : 
            formatNumber(formatUnits(trade.numContracts, 0));
        
        // Format premium with precision based on collateral token
        const precision = trade.collateralSymbol === 'CBBTC' ? 8 : 4; // default is 4, use 8 for CBBTC
        const premiumValue = formatNumberWithPrecision(formatUnits(trade.entryPremium, trade.collateralDecimals), precision);
        const premiumFormatted = `${premiumValue} ${trade.collateralSymbol}`;
        
        // Format PnL with color, higher precision, and include collateral symbol
        const pnlClass = pnl >= 0 ? 'text-success' : 'text-danger';
        const pnlFormatted = `${pnl >= 0 ? '+' : '-'}${formatNumberWithPrecision(Math.abs(pnl), precision)} ${trade.collateralSymbol} (${pnl >= 0 ? '+' : ''}${pnlPercentage.toFixed(2)}%)`;
        
        // Calculate USD value for tooltip
        const pnlUSD = convertPnLToUSD(pnl, trade.collateralSymbol);
        const usdTooltip = formatUSDTooltip(pnlUSD);
        
        row.innerHTML = `
            <td>${dateString}</td>
            <td>${trade.underlyingAsset}</td>
            <td>${optionType} (${userRole})</td>
            <td>$${formatNumber(formatUnits(trade.strikes[0], 8))}</td>
            <td>${contractAmount}</td>
            <td>${premiumFormatted}</td>
            <td>${settlementPrice}</td>
            <td class="${pnlClass}" title="${usdTooltip}" style="cursor: help;">${pnlFormatted}</td>
            <td><span class="status-badge status-${trade.status}">${trade.status.charAt(0).toUpperCase() + trade.status.slice(1)}</span></td>
        `;
        
        tableBody.appendChild(row);
    });
}

// New function to format numbers with specified precision
function formatNumberWithPrecision(value, decimals = 4) {
    return parseFloat(value).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: decimals
    });
}

// New function to properly convert raw option type to display string
function getOptionTypeDisplayFromRaw(optionType) {
    if (optionType === 0 || optionType === '0' || optionType === '0x0') {
        return 'CALL';
    } else if (optionType === 257 || optionType === '257' || optionType === '0x101') {
        return 'PUT';
    } else if (typeof optionType === 'string') {
        // If it's already a string like "CALL" or "PUT", just return it
        return getOptionTypeDisplay(optionType);
    } else {
        // Fallback for any other values
        return `UNKNOWN (${optionType})`;
    }
}

function setupHistoryFilters() {
    const filterElements = [
        'history-asset',
        'history-type',
        'history-status',
        'history-date-range'
    ];
    
    filterElements.forEach(id => {
        document.getElementById(id).addEventListener('change', loadTradeHistory);
    });
    
    // Add event listener for "go to trade" link
    const goToTradeFromHistory = document.getElementById('go-to-trade-from-history');
    if (goToTradeFromHistory) {
        goToTradeFromHistory.addEventListener('click', function(e) {
            e.preventDefault();
            showSection('trade');
            document.getElementById('nav-trade-bottom').classList.add('active');
            document.getElementById('nav-history-bottom').classList.remove('active');
        });
    }
}

function getOptionTypeDisplay(optionType) {
    switch(optionType) {
        case 'CALL': return 'CALL';
        case 'PUT': return 'PUT';
        case 'INVERSE_CALL': return 'INVERSE CALL';
        case 'INVERSE_PUT': return 'INVERSE PUT';
        default: return optionType;
    }
}

function shortenAddress(address) {
    return address.slice(0, 6) + '...' + address.slice(-4);
}

function formatUnits(value, decimals) {
    return ethers.utils.formatUnits(value.toString(), decimals);
}

function formatNumber(value) {
    return parseFloat(value).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// Format time left for display
function formatTimeDisplay(seconds) {
    seconds = parseInt(seconds);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Extract expiry time from API response
function getExpiryFromAPI(orders) {
    if (!orders || orders.length === 0) return null;
    
    // Get expiry timestamp from first order (should be consistent across all orders)
    const expiryTimestamp = orders[0].order.expiry;
    return expiryTimestamp ? parseInt(expiryTimestamp) * 1000 : null; // Convert to milliseconds
}

// Create a centralized UI update function
function updateUI(elementSelector, value, formatFn = null) {
    const formattedValue = formatFn ? formatFn(value) : value;
    $(elementSelector).text(formattedValue);
}

/**
 * Updates corresponding elements in both Basic and Advanced views.
 * Assumes Advanced view elements have an 'adv-' prefix on their ID.
 * @param {string} baseId - The base ID (without 'adv-') of the element.
 * @param {string|number} value - The value to set.
 * @param {'text'|'val'|'html'} method - How to update ('text', 'val' for inputs, 'html'). Defaults to 'text'.
 * @param {function} [formatFn=null] - Optional function to format the value before setting.
 */
function updateDualUI(baseId, value, method = 'text', formatFn = null) {
    const formattedValue = formatFn ? formatFn(value) : value;
    const selector = `#${baseId}, #adv-${baseId}`; // Target both elements

    switch (method) {
        case 'val':
            $(selector).val(formattedValue);
            break;
        case 'html':
            $(selector).html(formattedValue);
            break;
        case 'text':
        default:
            $(selector).text(formattedValue);
            break;
    }
}

// Function to get maker approval amounts and update the UI
async function updateLiquidityInfo() {
    try {
        if (!state.connectedAddress) {
            console.log("Not connected, can't fetch liquidity information");
            return;
        }
                
        // Set up token addresses and update elements using CONFIG.collateralMap
        // Exclude ETH since it's a native token and doesn't need allowance
        const tokens = Object.entries(CONFIG.collateralMap)
            .filter(([symbol, address]) => symbol !== 'ETH') // Exclude ETH
            .map(([symbol, address]) => {
                const details = CONFIG.getCollateralDetails(address);
                return {
                    symbol,
                    address,
                    decimals: details.decimals,
                    element: `#${symbol.toLowerCase()}-liquidity`
                };
            });
        
        // Prepare multicall data for both OptionBook and Kyber allowances
        const optionBookCalls = tokens.map(tokenInfo => ({
            address: tokenInfo.address,
            abi: ERC20ABI,
            functionName: 'allowance',
            args: [MAKER_ADDRESS, OPTION_BOOK_ADDRESS]
        }));
        
        // Add user's OptionBook allowances (for the payment asset display)
        const userOptionBookCalls = tokens.map(tokenInfo => ({
            address: tokenInfo.address,
            abi: ERC20ABI,
            functionName: 'allowance',
            args: [state.connectedAddress, OPTION_BOOK_ADDRESS]
        }));
        
        const kyberCalls = tokens.map(tokenInfo => ({
            address: tokenInfo.address,
            abi: ERC20ABI,
            functionName: 'allowance',
            args: [state.connectedAddress, CONFIG.KYBER_CONTRACT_ADDRESS]
        }));
        
        // Combine all calls: MAKER_ADDRESS allowances, USER allowances, then Kyber allowances
        const allCalls = [...optionBookCalls, ...userOptionBookCalls, ...kyberCalls];

        try {
            // Execute multicall
            const { readContracts } = WagmiCore;
            console.log('Executing multicall with', allCalls.length, 'contracts');
            console.log('Using multicall address:', MULTICALL_ADDRESS);
            console.log('All calls:', allCalls);
            
            const approvalAmounts = await readContracts({
                contracts: allCalls,
                multicallAddress: MULTICALL_ADDRESS,
                chainId: 8453 // Base chain ID
            });
            
            console.log('Multicall execution completed. Results type:', typeof approvalAmounts);
            console.log('Is using real Wagmi multicall:', !!window.__WAGMI_READ_CONTRACTS__);

            // Process results and update UI
            console.log('Multicall results:', approvalAmounts);
            approvalAmounts.forEach((approvalAmountResult, index) => {
                if (index < tokens.length) {
                    // OptionBook allowances
                    const tokenInfo = tokens[index];
                    const approvalAmount = approvalAmountResult.result;
                    try {
                        // Format the amount with full decimal precision for UI display
                        const formattedAmount = ethers.utils.formatUnits(approvalAmount, tokenInfo.decimals);
                        
                        // Log OptionBook allowance for debugging
                        console.log(`OptionBook Allowance - ${tokenInfo.symbol}:`, {
                            symbol: tokenInfo.symbol,
                            address: tokenInfo.address,
                            rawAmount: approvalAmount.toString(),
                            formattedAmount: formattedAmount,
                            decimals: tokenInfo.decimals,
                            uiElement: tokenInfo.element
                        });
                        
                        // Update the UI element
                        $(tokenInfo.element).text(formattedAmount);
                    } catch (error) {
                        console.error(`Error processing approval for ${tokenInfo.symbol}:`, error);
                        $(tokenInfo.element).text('--');
                    }
                } else if (index < tokens.length * 2) {
                    // User's OptionBook allowances (for the payment asset display)
                    const tokenInfo = tokens[index - tokens.length];
                    const userApprovalAmount = approvalAmountResult.result;
                    try {
                        // Format the amount with full decimal precision for UI display
                        const formattedAmount = ethers.utils.formatUnits(userApprovalAmount, tokenInfo.decimals);
                        
                        // Log user's OptionBook allowance for debugging
                        console.log(`User OptionBook Allowance - ${tokenInfo.symbol}:`, {
                            symbol: tokenInfo.symbol,
                            address: tokenInfo.address,
                            rawAmount: userApprovalAmount.toString(),
                            formattedAmount: formattedAmount,
                            decimals: tokenInfo.decimals,
                            userAddress: state.connectedAddress
                        });
                        
                        // Store user's OptionBook allowance for the payment asset display
                        if (!state.userOptionBookAllowances) {
                            state.userOptionBookAllowances = {};
                        }
                        state.userOptionBookAllowances[tokenInfo.symbol] = formattedAmount;
                        
                    } catch (error) {
                        console.error(`Error processing user OptionBook approval for ${tokenInfo.symbol}:`, error);
                        if (!state.userOptionBookAllowances) {
                            state.userOptionBookAllowances = {};
                        }
                        state.userOptionBookAllowances[tokenInfo.symbol] = '--';
                    }
                } else {
                    // Kyber allowances
                    const tokenInfo = tokens[index - tokens.length * 2];
                    const kyberApprovalAmount = approvalAmountResult.result;
                    
                    // Debug logging to see what's happening
                    console.log(`Processing Kyber allowance at index ${index}:`, {
                        index,
                        tokensLength: tokens.length,
                        calculatedIndex: index - tokens.length * 2,
                        tokenInfo,
                        rawAmount: kyberApprovalAmount?.toString() || 'null'
                    });
                    try {
                        // Check if we have a valid result
                        if (!kyberApprovalAmount || kyberApprovalAmount.toString() === '0') {
                            console.log(`Kyber allowance is 0 or null for ${tokenInfo.symbol}`);
                            const formattedAmount = '0';
                            
                            // Store user's Kyber allowance for the swap modal
                            if (!state.userKyberAllowances) {
                                state.userKyberAllowances = {};
                            }
                            state.userKyberAllowances[tokenInfo.symbol] = formattedAmount;
                            
                            // Update Kyber allowance display
                            const kyberElement = `#${tokenInfo.symbol.toLowerCase()}-kyber-liquidity`;
                            if ($(kyberElement).length === 0) {
                                // Create Kyber allowance display if it doesn't exist
                                const optionBookElement = $(tokenInfo.element);
                                const kyberDisplay = optionBookElement.clone();
                                kyberDisplay.attr('id', tokenInfo.symbol.toLowerCase() + '-kyber-liquidity');
                                kyberDisplay.text(formattedAmount);
                                optionBookElement.after(kyberDisplay);
                            } else {
                                $(kyberElement).text(formattedAmount);
                            }
                            return;
                        }
                        
                        // Format the amount with full decimal precision for UI display
                        const formattedAmount = ethers.utils.formatUnits(kyberApprovalAmount, tokenInfo.decimals);
                        
                        // Log Kyber allowance for debugging
                        console.log(`Kyber Allowance - ${tokenInfo.symbol}:`, {
                            symbol: tokenInfo.symbol,
                            address: tokenInfo.address,
                            rawAmount: kyberApprovalAmount.toString(),
                            formattedAmount: formattedAmount,
                            decimals: tokenInfo.decimals,
                            uiElement: `#${tokenInfo.symbol.toLowerCase()}-kyber-liquidity`
                        });
                        
                        // Store user's Kyber allowance for the swap modal
                        if (!state.userKyberAllowances) {
                            state.userKyberAllowances = {};
                        }
                        state.userKyberAllowances[tokenInfo.symbol] = formattedAmount;
                        
                        console.log(`Stored Kyber allowance for ${tokenInfo.symbol}:`, formattedAmount);
                        console.log(`Full state.userKyberAllowances:`, state.userKyberAllowances);
                        
                        // Update Kyber allowance display (create if doesn't exist)
                        const kyberElement = `#${tokenInfo.symbol.toLowerCase()}-kyber-liquidity`;
                        if ($(kyberElement).length === 0) {
                            // Create Kyber allowance display if it doesn't exist
                            const optionBookElement = $(tokenInfo.element);
                            const kyberDisplay = optionBookElement.clone();
                            kyberDisplay.attr('id', tokenInfo.symbol.toLowerCase() + '-kyber-liquidity');
                            kyberDisplay.text(formattedAmount);
                            optionBookElement.after(kyberDisplay);
                        } else {
                            $(kyberElement).text(formattedAmount);
                        }
                    } catch (error) {
                        console.error(`Error processing Kyber approval for ${tokenInfo.symbol}:`, error);
                        const kyberElement = `#${tokenInfo.symbol.toLowerCase()}-kyber-liquidity`;
                        if ($(kyberElement).length > 0) {
                            $(kyberElement).text('--');
                        }
                    }
                }
            });
            
            // Log summary of all allowances
            console.log('=== ALLOWANCE SUMMARY ===');
            console.log('OptionBook Allowances:', tokens.map(tokenInfo => ({
                symbol: tokenInfo.symbol,
                element: tokenInfo.element,
                displayValue: $(tokenInfo.element).text()
            })));
            console.log('User OptionBook Allowances:', tokens.map(tokenInfo => ({
                symbol: tokenInfo.symbol,
                element: tokenInfo.element,
                displayValue: $(tokenInfo.element).text()
            })));
            console.log('Kyber Allowances:', tokens.map(tokenInfo => {
                const kyberElement = `#${tokenInfo.symbol.toLowerCase()}-kyber-liquidity`;
                return {
                    symbol: tokenInfo.symbol,
                    element: kyberElement,
                    displayValue: $(kyberElement).length > 0 ? $(kyberElement).text() : 'Element not found'
                };
            }));
            console.log('========================');
        } catch (error) {
            console.error('Error in multicall:', error);
            // Set all to '--' if multicall fails
            tokens.forEach(tokenInfo => {
                $(tokenInfo.element).text('--');
                const kyberElement = `#${tokenInfo.symbol.toLowerCase()}-kyber-liquidity`;
                if ($(kyberElement).length > 0) {
                    $(kyberElement).text('--');
                }
            });
        }
    } catch (error) {
        console.error('Error updating liquidity information:', error);
    }
}

// Add this new function to calculate the next liquidity renewal time (09:00 UTC)
function updateLiquidityRenewalCountdown() {
    const now = new Date();
    const renewalDate = new Date(Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        9, // 09:00 UTC
        0, 0, 0
    ));
    
    // If current time is after today's renewal time, set for next day
    if (now >= renewalDate) {
        renewalDate.setUTCDate(renewalDate.getUTCDate() + 1);
    }
    
    // Set the countdown expiry attribute (convert to seconds)
    const renewalTimestampSeconds = Math.floor(renewalDate.getTime() / 1000);
    $('.renewal-info').siblings('.countdown').attr('data-countdown-expiry', renewalTimestampSeconds);
}

async function updateWalletBalance() {
    try {
        if (!state.connectedAddress) return;
        
        // Separate ETH (native) from ERC20 tokens
        const erc20Tokens = ['USDC', 'CBBTC', 'WETH'];
        const nativeTokens = ['ETH'];
        
        // Store current selection to preserve user preference
        const currentSelection = getSelectedPaymentAsset();
        
        // Get ERC20 token balances
        const { readContracts } = WagmiCore;
        const contracts = erc20Tokens.map(token => ({
            address: CONFIG.collateralMap[token],
            abi: ERC20ABI,
            functionName: 'balanceOf',
            args: [state.connectedAddress],
            chainId: 8453
        }));
        const balances = await readContracts({ contracts });
        
        // Store balances for display
        state.paymentAssetBalances = {};
        
        // Process ERC20 token balances
        erc20Tokens.forEach((token, i) => {
            const balance = formatUnits(balances[i].result, CONFIG.getCollateralDetails(CONFIG.collateralMap[token]).decimals);
            state.paymentAssetBalances[token] = balance;
            
            // Update button tooltips with balance information
            const button = document.querySelector(`input[name="payment-asset-selection"][value="${token}"]`);
            if (button) {
                const label = button.nextElementSibling;
                if (label) {
                    // Get USD value if we have market prices
                    let usdValue = '';
                    if (state.market_prices && state.market_prices[token]) {
                        const price = state.market_prices[token];
                        const usdAmount = (parseFloat(balance) * price).toFixed(2);
                        usdValue = ` ($${usdAmount})`;
                    }
                    label.setAttribute('data-balance', `${balance} ${token}${usdValue}`);
                }
            }
        });
        
        // Handle ETH balance separately (native token)
        // ETH balance is already handled by updateETHBalance() function
        // We'll set a placeholder here and let the existing ETH balance display handle it
        state.paymentAssetBalances['ETH'] = '0'; // Placeholder, actual balance shown elsewhere
        
        // Update balance display for currently selected asset
        updatePaymentAssetBalanceDisplay(currentSelection);
        
        // Check fund status after balance update (debounced)
        if (typeof refreshFundStatus === 'function') {
            refreshFundStatus();
        }
        
        // Update ETH balance display after wallet balance update
        if (typeof updateETHBalance === 'function') {
            updateETHBalance();
        }
    } catch (error) {
        console.error('Error updating payment asset balances:', error);
    }
}

// Get the currently selected payment asset from the button group
window.getSelectedPaymentAsset = function() {
    const selectedButton = document.querySelector('input[name="payment-asset-selection"]:checked');
    return selectedButton ? selectedButton.value : 'USDC';
}

// Update the balance display for the selected payment asset
window.updatePaymentAssetBalanceDisplay = function(selectedAsset) {
    const balanceDisplay = document.getElementById('payment-balance-display');
    const allowanceDisplay = document.getElementById('payment-allowance-amount');
    
    if (!state.paymentAssetBalances || !selectedAsset) {
        balanceDisplay.innerHTML = '<span class="balance-text no-balance">No balance data available</span>';
        if (allowanceDisplay) allowanceDisplay.textContent = '--';
        return;
    }
    
    // Handle ETH differently since it's a native token
    if (selectedAsset === 'ETH') {
        // For ETH, we don't have a balance in state.paymentAssetBalances
        // The ETH balance is displayed separately by the existing ETH balance display
        balanceDisplay.innerHTML = '<span class="balance-text">Native ETH balance shown above</span>';
        if (allowanceDisplay) allowanceDisplay.textContent = 'N/A (Native)';
        return;
    }
    
    const balance = state.paymentAssetBalances[selectedAsset];
    
    if (!balance || balance === '0') {
        balanceDisplay.innerHTML = '<span class="balance-text no-balance">0.00 ${selectedAsset}</span>';
        if (allowanceDisplay) allowanceDisplay.textContent = '--';
        return;
    }
    
    // Get USD value if we have market prices
    let usdValue = '';
    if (state.market_prices && state.market_prices[selectedAsset]) {
        const price = state.market_prices[selectedAsset];
        const usdAmount = (parseFloat(balance) * price).toFixed(2);
        usdValue = `($${usdAmount})`;
    }
    
    balanceDisplay.innerHTML = `
        <span class="balance-amount">${balance} ${selectedAsset}</span>
        <span class="balance-usd">${usdValue}</span>
    `;
    
    // Update allowance display
    if (allowanceDisplay) {
        // Get the user's OptionBook allowance from state if available
        if (state.userOptionBookAllowances && state.userOptionBookAllowances[selectedAsset]) {
            allowanceDisplay.textContent = state.userOptionBookAllowances[selectedAsset];
        } else {
            // Fallback to the liquidity info if user allowances not available yet
            const liquidityElement = document.getElementById(`${selectedAsset.toLowerCase()}-liquidity`);
            if (liquidityElement && liquidityElement.textContent !== '--') {
                allowanceDisplay.textContent = liquidityElement.textContent;
            } else {
                allowanceDisplay.textContent = '--';
            }
        }
    }
    
    // Update swap button text to be more contextual
    const swapBtn = document.getElementById('swap-assets-btn');
    if (swapBtn) {
        if (selectedAsset === 'USDC') {
            swapBtn.innerHTML = '<i class="bi bi-arrow-repeat me-1"></i>Swap Assets';
        } else if (selectedAsset === 'ETH') {
            swapBtn.innerHTML = `<i class="bi bi-arrow-repeat me-1"></i>Swap ETH to USDC`;
        } else {
            swapBtn.innerHTML = `<i class="bi bi-arrow-repeat me-1"></i>Swap to USDC`;
        }
    }
}

// Add debug function for checking stored allowances
window.debugAllowances = function() {
    console.log('=== DEBUG ALLOWANCES ===');
    console.log('state.userKyberAllowances:', state.userKyberAllowances);
    console.log('state.userOptionBookAllowances:', state.userOptionBookAllowances);
    
    // Check if the allowances are being stored correctly
    if (state.userKyberAllowances) {
        Object.entries(state.userKyberAllowances).forEach(([symbol, amount]) => {
            console.log(`Kyber ${symbol}:`, amount, 'Type:', typeof amount);
        });
    }
    
    // Check the DOM elements
    ['usdc', 'weth', 'cbbtc'].forEach(symbol => {
        const kyberElement = document.getElementById(`${symbol}-kyber-liquidity`);
        if (kyberElement) {
            console.log(`${symbol} Kyber element:`, kyberElement.textContent);
        } else {
            console.log(`${symbol} Kyber element: not found`);
        }
    });
    
    console.log('========================');
};

// Initialize the application
async function initialize() {
    setupEventListeners(); // Assign event listeners to the UI elements
    setExpiryTime(); // Set the initial expiry time
    updateLiquidityRenewalCountdown(); // Set the liquidity renewal countdown
    
    // Restore exact approval preference from localStorage
    const exactApprovalEnabled = localStorage.getItem('exactApprovalEnabled') === 'true';
    $('#exact-approval-checkbox').prop('checked', exactApprovalEnabled);
    
    // Initialize payment asset balance display with loading state
    const balanceDisplay = document.getElementById('payment-balance-display');
    if (balanceDisplay) {
        balanceDisplay.innerHTML = '<span class="balance-text loading">Loading balances...</span>';
    }
    
    // Update help text based on saved preference
    const helpText = $('#exact-approval-checkbox').siblings('.form-text').find('small');
    if (exactApprovalEnabled) {
        helpText.text('Only the exact amount needed for this trade will be approved. You may need to approve again for future trades.');
    } else {
        helpText.text('Up to $1000 worth of tokens will be approved to reduce future approval transactions. When checked, approves only the exact amount needed for this trade.');
    }
    
    // Wait for wallet system to be ready and attempt auto-connect
    console.log('Waiting for wallet system to initialize...');
    let walletReady = false;
    let attempts = 0;
    const maxAttempts = 10;
    
    while (!walletReady && attempts < maxAttempts) {
        if (window.Web3OnboardBridge && typeof window.Web3OnboardBridge.init === 'function') {
            console.log('Wallet system ready, attempting auto-connect...');
            walletReady = true;
            // Give the wallet system a moment to complete auto-connect
            await new Promise(resolve => setTimeout(resolve, 1500));
        } else {
            console.log(`Waiting for wallet system... (attempt ${attempts + 1}/${maxAttempts})`);
            await new Promise(resolve => setTimeout(resolve, 500));
            attempts++;
        }
    }
    
    if (!walletReady) {
        console.warn('Wallet system not ready after maximum attempts');
    }
    
    await refreshData(); // Start data refresh
    state.refreshTimer = setInterval(refreshData, REFRESH_INTERVAL); // Set a timer to refresh data periodically
    updateCountdowns(); // Start the countdown loop *once* after initial setup
    
    // Ensure advanced view is properly initialized
    state.viewMode = 'advanced';
    $('.options-table-container').show();
    console.log('Advanced view initialized, options table container shown');
    
    // Ensure trade section is shown by default
    showSection('trade');
    
    // Populate the options table after data is loaded
    if (state.orders && state.orders.length > 0 && typeof populateOptionsTable === 'function') {
        console.log('Orders available, populating table...');
        populateOptionsTable();
    } else {
        console.log('No orders available yet or populateOptionsTable not defined');
        // Retry populating the table after a short delay
        setTimeout(() => {
            if (state.orders && state.orders.length > 0 && typeof populateOptionsTable === 'function') {
                console.log('Retrying to populate table...');
                populateOptionsTable();
            }
        }, 1000);
    }
    
    // Enable the trade button now that app is fully loaded
    // (but still respect fund/swap checks via the normal updateTradeButtonState flow)
    if (typeof updateTradeButtonState === 'function') {
        updateTradeButtonState();
    } else {
        // Fallback in case updateTradeButtonState isn't available yet
        $('#trade-now-btn').prop('disabled', false).removeClass('btn-secondary').addClass('btn-primary').text('TRADE NOW');
    }
    
    // Assign event listeners to the history filters
    $('#history-asset, #history-type, #history-status, #history-date-range').on('change', function() {
        loadTradeHistory();
    });

    // Position asset filter handler
    const positionAssetDropdown = $('#positionAssetDropdown');
    if (positionAssetDropdown.length > 0) {
        positionAssetDropdown.on('click', '.dropdown-item', function(e) {
            e.preventDefault();
            const asset = $(this).data('asset');
            const positionsSelectedAsset = $('#positions-selected-asset');
            if (positionsSelectedAsset.length > 0) {
                positionsSelectedAsset.text(asset);
            }
            refreshPositions();
        });
    }

}

$(document).ready(() => {
    console.log('Document ready, initializing...');
    initialize();
    
    // Additional initialization to ensure advanced view is properly set up
    setTimeout(() => {
        console.log('Additional initialization check...');
        if (state.viewMode === 'advanced') {
            $('.options-table-container').show();
            if (state.orders && state.orders.length > 0 && typeof populateOptionsTable === 'function') {
                console.log('Populating table in additional initialization...');
                populateOptionsTable();
            }
        }
    }, 2000);
});

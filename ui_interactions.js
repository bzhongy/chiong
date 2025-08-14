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

// Set up event listeners for UI interaction
function setupEventListeners() {
    // Wallet connection
    const connectWalletBtn = $('#connect-wallet');
    if (connectWalletBtn.length > 0) {
        connectWalletBtn.on('click', connectWallet);
    }
    
    // Navigation
    $('#go-to-trade').on('click', () => showSection('trade'));
    $('#go-to-trade-from-history').on('click', () => showSection('trade'));
    
    // Bottom navigation event handlers
    $('#nav-trade-bottom').on('click', () => showSection('trade'));
    $('#nav-positions-bottom').on('click', () => showSection('positions'));
    $('#nav-history-bottom').on('click', () => showSection('history'));
    $('#nav-scoreboard-bottom').on('click', () => showSection('scoreboard'));
    
    // Asset selection
    $('input[name="asset-selection"]').on('change', function() {
        const asset = $(this).val();
        selectAsset(asset);
    });
    
    // Payment asset selection
    $('input[name="payment-asset-selection"]').on('change', function() {
        const asset = $(this).val();
        updatePaymentAssetBalanceDisplay(asset);
        
        // Update ETH wrapping interface visibility if WETH is selected
        if (asset === 'WETH') {
            updateETHBalance();
            $('#eth-wrap-section').show();
        } else {
            $('#eth-wrap-section').hide();
        }
    });
    
    // Advanced view is now the default and only view
    // Note: View toggle buttons don't exist in the main app.html, so we skip those event listeners
    
    // Position size sliders - use one handler for both sliders
    $(document).on('input', '#position-size-slider', updatePositionSize);
    
    // Conviction sliders - use one handler for both sliders
    $(document).on('input', '#conviction-slider', updateConviction);
    
    // Trade buttons
    $('#trade-now-btn').on('click', showTradeConfirmation);
    $('#confirm-trade-btn').on('click', executeTrade);
    
    // Exact Approval checkbox event listener
    $('#exact-approval-checkbox').on('change', function() {
        const isChecked = $(this).is(':checked');
        
        // Save preference to localStorage
        localStorage.setItem('exactApprovalEnabled', isChecked);
        
        // Update UI feedback if needed
        const helpText = $(this).siblings('.form-text').find('small');
        if (isChecked) {
            helpText.text('Only the exact amount needed for this trade will be approved. You may need to approve again for future trades.');
        } else {
            helpText.text('Up to $1000 worth of tokens will be approved to reduce future approval transactions. When checked, approves only the exact amount needed for this trade.');
        }
    });
    
    // Auto refresh toggle
    const autoRefresh = $('#auto-refresh');
    if (autoRefresh.length > 0) {
        autoRefresh.on('change', function() {
            const isChecked = $(this).is(':checked');
            $(this).next().text(`Auto-refresh: ${isChecked ? 'ON' : 'OFF'}`);
            
            if (isChecked) {
                if (!state.refreshTimer) {
                    state.refreshTimer = setInterval(refreshData, REFRESH_INTERVAL);
                }
            } else {
                if (state.refreshTimer) {
                    clearInterval(state.refreshTimer);
                    state.refreshTimer = null;
                }
            }
        });
    }
    
    // Advanced view option selection
    $(document).on('click', '.option-row', function() {
        const index = $(this).data('index');
        selectOption(index);
    });
    
    // Specific handler for Select button clicks
    $(document).on('click', '.select-option-btn', function(e) {
        e.stopPropagation(); // Prevent row click from also firing
        const index = $(this).closest('.option-row').data('index');
        selectOption(index);
    });
    
    // Position detail view
    $(document).on('click', '.view-position-btn', function() {
        const index = $(this).data('position-index');
        showPositionDetails(index);
    });

    // History navigation
    const navHistory = document.getElementById('nav-history-bottom');
    if (navHistory) {
        navHistory.addEventListener('click', function(e) {
            e.preventDefault();
            showSection('history');
            document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
            this.classList.add('active');
            loadTradeHistory(); // Load history when tab is selected
        });
    }
    
    // Setup history filters
    setupHistoryFilters();
    
    // Add event listener for the settle option button
    const settleOptionBtn = document.getElementById('settle-option-btn');
    if (settleOptionBtn) {
        settleOptionBtn.addEventListener('click', settleOption);
    }

    // Payment asset selection is now handled by button group event listeners in setupEventListeners

    // Add scoreboard navigation
    window.scoreboard.init();

    // ETH to WETH Wrapping Functions
    setupWrapETHListeners();
    
    // ETH wrap section toggle
    $('#toggle-eth-wrap-section').on('click', toggleEthWrapSection);
}

// Show a specific section (trade, positions, history)
function showSection(section) {
    // Hide all sections
    $('.content-section').hide();
    
    // Remove active class from all nav links (both top and bottom)
    $('.nav-link').removeClass('active');
    $('#nav-trade-bottom, #nav-positions-bottom, #nav-history-bottom, #nav-scoreboard-bottom').removeClass('active');
    
    // Show the selected section and mark its nav link as active
    if (section === 'trade') {
        $('#asset-selector-section').show();
        $('#quote-status-section').show();
        // Explicitly show the options table container
        $('.options-table-container').show();
        $('#nav-trade-bottom').addClass('active');
        // Ensure advanced view is shown by default
        // Add a small delay to ensure sections are visible before populating
        setTimeout(() => {
            switchView('advanced');
            // Also refresh the data to ensure everything is up to date
            if (typeof refreshData === 'function') {
                refreshData();
            }
        }, 100);
    } else if (section === 'positions') {
        $('#positions-section').show();
        $('#nav-positions-bottom').addClass('active');
        
        // Refresh positions data
        refreshPositions();
    } else if (section === 'history') {
        $('#history-section').show();
        $('#nav-history-bottom').addClass('active');
        
        // Load history data
        loadTradeHistory();
    } else if (section === 'scoreboard-section') {
        $('#scoreboard-section').show();
        $('#nav-scoreboard-bottom').addClass('active');
    }
}

// Advanced view is now the default and only view
function switchView(view) {
    state.viewMode = 'advanced';
    $('.options-table-container').show();
    // Make sure the advanced view is populated
    populateOptionsTable();
}

// Select an asset (ETH, BTC), update state, UI then refresh data
function selectAsset(asset) {
    state.selectedAsset = asset;
    updateUI('#selected-asset, #positions-selected-asset', asset);
    updateUI('#asset-symbol', asset);
    
    // Update radio button state
    $(`input[name="asset-selection"][value="${asset}"]`).prop('checked', true);
    

    
    refreshData();
}

// Calculate max contracts, selected contracts, position cost, update state and UI
function calculateAndUpdatePositionCost(order, collateral, percentage) {
    // Use the centralized calculator to compute all position values
    const { positionCost, selectedContracts, maxContracts, optionPrice } = optionCalculator.calculatePositionDetails(order, collateral, percentage);
    
    // Update display and state
    const formattedCost = positionCost.toFixed(collateral.decimals === 6 ? 2 : 6);
    updateDualUI('current-size', `${formattedCost} ${collateral.asset}`);

    state.selectedPositionSize = positionCost;
    state.selectedContracts = selectedContracts;

    // Return calculated values for potential use elsewhere
    return { positionCost, selectedContracts };
}

// Update the updatePositionSize function to also update swap info
function updatePositionSize() {
    const percentage = document.getElementById('position-size-slider').value;
    const orderIndex = state.selectedOrderIndex;
    
    if (orderIndex === null) return;
    
    // Get the order and related information
    const order = state.orders[orderIndex].order;
    const collateral = CONFIG.getCollateralDetails(order.collateral);
    
    // Calculate position details
    const { positionCost, selectedContracts } = optionCalculator.calculatePositionDetails(
        order, collateral, percentage
    );
    
    // Update UI with new position size
    state.selectedPositionPercentage = percentage;
    const selectedPositionSize = positionCost;
    state.selectedPositionSize = selectedPositionSize;
    
    // Format and display the position size
    const sizeDisplay = document.getElementById('current-size');
    sizeDisplay.innerText = selectedPositionSize.toFixed(collateral.decimals === 6 ? 2 : 4);
    
    // Update option preview with new position size
    updateOptionPreview();
    
    // Update swap information if needed
    kyberSwap.updateSwapInfo(order, selectedPositionSize);
    
    // Check fund status after position size change
    refreshFundStatus();
    
    // Trade button state will be updated automatically by kyberSwap.updateSwapInfo
}

// Flag to track when we're in the middle of selecting an option to prevent redundant updates
let isSelectingOption = false;

// Update the payment asset selection to check swap requirements
function updatePaymentAsset(skipPreviewUpdate = false) {
    const selectedCollateral = getSelectedPaymentAsset();
    const orderIndex = state.selectedOrderIndex;
    
    if (orderIndex === null) return;
    
    const order = state.orders[orderIndex];
    const needsSwap = kyberSwap.isSwapNeeded(selectedCollateral, order.order);
    
    if (!needsSwap) {
        kyberSwap.hideSwapDisplay();
    } else {        
        // Update swap information
        kyberSwap.updateSwapInfo(order.order, state.selectedPositionSize);
    }
    
    // Only update option preview if not part of a larger update flow and not in the middle of option selection
    if (!skipPreviewUpdate && !isSelectingOption) {
        updateOptionPreview();
    }
    
    // Check fund status after payment asset change (debounced)
    refreshFundStatus();
    
    // Trade button state will be updated automatically by kyberSwap functions
}

// Setup the conviction slider with discrete tick marks based on API strikes
function setupConvictionSlider() {
    // Get all available strike prices for current asset
    if (!state.orders || state.orders.length === 0) return;
    
    // Extract all strikes for the current asset and sort them
    const strikes = state.orders.map(order => {
        return parseFloat(formatUnits(order.order.strikes[0], PRICE_DECIMALS));
    }).sort((a, b) => a - b);
    
    // Remove duplicates if any
    const uniqueStrikes = [...new Set(strikes)];
    
    // Need at least one strike
    if (uniqueStrikes.length === 0) return;
    
    // Generate equidistant slider tick positions based on number of strikes
    state.sliderTicks = [];
    state.priceTicks = [];
    
    // Use all available strikes instead of just 3 for better precision
    state.priceTicks = uniqueStrikes;
    
    // Create evenly spaced slider ticks based on number of strikes
    const numStrikes = uniqueStrikes.length;
    for (let i = 0; i < numStrikes; i++) {
        const tickPosition = Math.round((i / (numStrikes - 1)) * 100);
        state.sliderTicks.push(tickPosition);
    }
    
    // Create datalist element for slider if it doesn't exist
    if ($('#conviction-datalist').length === 0) {
        $('<datalist id="conviction-datalist"></datalist>').insertAfter('#conviction-slider');
        $('#conviction-slider').attr('list', 'conviction-datalist');
    }
    
    if ($('#adv-conviction-datalist').length === 0) {
        $('<datalist id="adv-conviction-datalist"></datalist>').insertAfter('#adv-conviction-slider');
        $('#adv-conviction-slider').attr('list', 'adv-conviction-datalist');
    }
    
    // Clear existing options
    $('#conviction-datalist, #adv-conviction-datalist').empty();
    
    // Add tick marks at our calculated positions
    state.sliderTicks.forEach(tick => {
        $('#conviction-datalist, #adv-conviction-datalist').append(`<option value="${tick}"></option>`);
    });
    
    // Update the price target labels with all strikes
    updateDualUI('low-price', `$${formatNumber(uniqueStrikes[0])}`);
    updateDualUI('high-price', `$${formatNumber(uniqueStrikes[uniqueStrikes.length - 1])}`);
    
    // Determine initial slider index
    let initialSliderIndex = Math.floor(uniqueStrikes.length / 2); // Default to middle
    let initialSliderTickValue = state.sliderTicks[initialSliderIndex] || 50;
        
    // If we have a previously selected strike, try to maintain it
    if (lastSelectedStrike !== null) {
        // Find the closest strike to our last selected one
        let closestIndex = 0;
        let minDiff = Math.abs(uniqueStrikes[0] - lastSelectedStrike);
        
        for (let i = 1; i < uniqueStrikes.length; i++) {
            const diff = Math.abs(uniqueStrikes[i] - lastSelectedStrike);
            if (diff < minDiff) {
                minDiff = diff;
                closestIndex = i;
            }
        }
        
        initialSliderIndex = closestIndex;
        initialSliderTickValue = state.sliderTicks[closestIndex];
    }
    
    // Update the middle label to show selected strike
    updateDualUI('current-target', `$${formatNumber(uniqueStrikes[initialSliderIndex])}`);
    
    // Set slider to appropriate position
    updateDualUI('conviction-slider', initialSliderTickValue, 'val');
    
    // If we had a previous slider position, use that
    if (lastSelectedSliderPosition !== null) {
        // Find the closest tick to our last position
        let closestTick = state.sliderTicks[0];
        let minDistance = Math.abs(lastSelectedSliderPosition - closestTick);
        
        for (let i = 1; i < state.sliderTicks.length; i++) {
            const distance = Math.abs(lastSelectedSliderPosition - state.sliderTicks[i]);
            if (distance < minDistance) {
                minDistance = distance;
                closestTick = state.sliderTicks[i];
            }
        }
        
        updateDualUI('conviction-slider', closestTick, 'val');
    }
}

// Update conviction (price target) based on slider value with discrete snapping
function updateConviction(e) {
    const sliderValue = parseInt($(this).val());
    
    // Find the nearest tick mark to snap to
    if (state.sliderTicks && state.sliderTicks.length > 0) {
        // Find closest tick mark
        let closestTick = state.sliderTicks[0];
        let minDistance = Math.abs(sliderValue - closestTick);
        
        for (let i = 1; i < state.sliderTicks.length; i++) {
            const distance = Math.abs(sliderValue - state.sliderTicks[i]);
            if (distance < minDistance) {
                minDistance = distance;
                closestTick = state.sliderTicks[i];
            }
        }
        
        // Set slider to closest tick IMMEDIATELY (synchronous)
        $(this).val(closestTick);
        
        // Update the current target price display IMMEDIATELY (synchronous)
        const priceIndex = state.sliderTicks.indexOf(closestTick);
        if (priceIndex >= 0) {
            updateDualUI('current-target', `$${formatNumber(state.priceTicks[priceIndex])}`);
        }
    }
    
    // Run option selection asynchronously in the background (non-blocking)
    selectOptionBasedOnConviction().catch(error => {
        console.error("Error in selectOptionBasedOnConviction:", error);
    });
}

// Select the best option for the current slider position
async function selectOptionBasedOnConviction(updatePaymentAsset = false) {
    // Get slider value from the visible slider
    let sliderValue;
    if ($('#advanced-view-container').is(':visible')) {
        sliderValue = parseInt($('#adv-conviction-slider').val());
    } else {
        sliderValue = parseInt($('#conviction-slider').val());
    }
    
    if (!state.orders || state.orders.length === 0 || !state.sliderTicks || state.sliderTicks.length === 0) return;
    
    // Find which tick position this corresponds to
    const tickIndex = state.sliderTicks.indexOf(sliderValue);
    if (tickIndex === -1) return;
    
    // Get the target price from the price ticks
    const targetPrice = state.priceTicks[tickIndex];
    if (!targetPrice) return;
    
    // Find the nearest option to the target price regardless of type
    if (!state.orders || state.orders.length === 0) {
        console.warn("No orders available for selection");
        return;
    }
    
    const extractStrike = order => parseFloat(formatUnits(order.order.strikes[0], PRICE_DECIMALS));
    const bestOrderIndex = findNearestOption(targetPrice, state.orders, extractStrike);
    await selectOption(bestOrderIndex);

    // Handle initialization case - remove the init option after first selection
    // Remove init check since we're using buttons now
    
    // Note: Smart asset selection in selectOption() now handles payment asset selection automatically
    // The old manual reset logic is no longer needed
}

// Create a reusable function for finding the nearest option
function findNearestOption(targetValue, optionArray, valueExtractor) {
    if (!optionArray || optionArray.length === 0) return null;
    
    let bestIndex = 0;
    let bestDiff = Infinity;
    
    for (let i = 0; i < optionArray.length; i++) {
        const value = valueExtractor(optionArray[i]);
        const diff = Math.abs(value - targetValue);
        
        if (diff < bestDiff) {
            bestDiff = diff;
            bestIndex = i;
        }
    }
    
    return bestIndex;
}

// Select an option from the table
async function selectOption(index) {
    // Set flag to prevent redundant updates during option selection
    isSelectingOption = true;
    
    try {
        state.selectedOrderIndex = index;
    
    // Update UI to reflect selected option
    $('.option-row').removeClass('selected');
    $(`.option-row[data-index="${index}"]`).addClass('selected');

    // Get the required amount for smart asset selection
    const orderData = state.orders[index];
    const order = orderData.order;
    const collateral = CONFIG.getCollateralDetails(order.collateral);
    
    // Calculate required amount in USD for this trade
    // Use current position size or default to $100
    const currentPositionSize = state.selectedPositionSize || 100;
    const requiredAmountUSD = collateral.name === 'USDC' ? currentPositionSize : 
                             currentPositionSize * (state.market_prices[collateral.asset] || 1);
    
    // Smart asset selection - automatically choose the best payment asset
    await selectBestPaymentAsset(order, requiredAmountUSD);
    
    // Update payment asset after smart selection (skip preview update since we'll do it once at the end)
    updatePaymentAsset(true);
    
    // Update advanced trade button state
    const button = $('#adv-trade-btn');
    if (index !== null) {
        button.prop('disabled', false).text('TRADE NOW');
    } else {
        button.prop('disabled', true).text('SELECT OPTION TO TRADE');
    }

    // Now update option preview once with all changes applied
    updateOptionPreview();
    
    // Trade button state will be updated automatically by kyberSwap functions

    // Check capacity after updating button
    getOrderFillInfo(state.orders[index]).then(fillInfo => {
        if (fillInfo && fillInfo.isFull) {
            // Show a notification that this order is full
            alert("This order batch is already filled to capacity. Please try another option or wait for a new batch.");
            
            // Deselect the option
            state.selectedOrderIndex = null;
            updateOptionPreview();
            return;
        }
        
        // Fund status is already refreshed by updateOptionPreview, no need to call again here
    });
    } finally {
        // Always clear the flag, even if there's an error
        isSelectingOption = false;
    }
}

// Update the option preview with selected option details
function updateOptionPreview() {
    if (state.selectedOrderIndex === null || !state.orders || state.orders.length === 0) {
        // Clear preview if no option selected? Or just return?
        // For now, just return to avoid errors. Consider clearing UI elements if needed.
        console.warn("updateOptionPreview called with no selected order.");
        return;
    }

    const orderData = state.orders[state.selectedOrderIndex];
    const order = orderData.order;
    const optionTypeDetails = CONFIG.getOptionDetails(order.implementation);
    const asset = CONFIG.getUnderlyingAsset(order.priceFeed);
    const strike = formatUnits(order.strikes[0], PRICE_DECIMALS);
    const collateral = CONFIG.getCollateralDetails(order.collateral);

    // Save currently selected strike for maintaining position on refresh
    lastSelectedStrike = parseFloat(strike);



    // Set position size slider attributes and labels (should only need to happen once ideally, but safe here)
    $('#position-size-slider, #adv-position-size-slider').attr('min', 1).attr('max', 100).attr('step', 1);
    $('.size-label.min').text('1%');
    $('.size-label.max').text('100%');

    // Ensure a default percentage is set if needed
    if (!state.selectedPositionPercentage) {
        state.selectedPositionPercentage = 50; // Default to 50%
        updateDualUI('position-size-slider', state.selectedPositionPercentage, 'val');
        updateDualUI('current-percentage', `${state.selectedPositionPercentage}%`);
    } else {
        // Ensure slider and percentage display match the state
        updateDualUI('position-size-slider', state.selectedPositionPercentage, 'val');
        updateDualUI('current-percentage', `${state.selectedPositionPercentage}%`);
    }

    // Calculate cost, update state and UI using the helper function
    // This uses the current state.selectedPositionPercentage
    const { positionCost, selectedContracts } = calculateAndUpdatePositionCost(order, collateral, state.selectedPositionPercentage);

    // Calculate premium using our centralized calculator
    const premium = parseFloat(formatUnits(order.price, PRICE_DECIMALS));

    // Get the raw leverage value
    const rawPayoutRatio = optionCalculator.calculateLeverage(premium, order, collateral);

    // Update UI elements with calculated values
    $('.leverage-indicator').each(function() {
        $(this).html(`<span class="leverage-value">${rawPayoutRatio}x</span> LEVERAGE`);
    });

    // Determine if it's a call or put
    const optionTypeDisplay = order.isCall ? "CALL" : "PUT";
    const direction = order.isCall ? "above" : "below";
    
    // Update option action text with correct number of contracts (using state.selectedContracts from helper)
    const formattedContracts = selectedContracts.toFixed(4);
    updateDualUI('option-action-text', `BUY ${formattedContracts} ${optionTypeDisplay}`);

    // Store values for later use (leverage-value is used in confirmation modal)
    $('#leverage-value').text(rawPayoutRatio); // Raw leverage for display/modal
    $('#adjusted-leverage-value').text(rawPayoutRatio); // Adjusted leverage (currently same as raw)
    $('#num-contracts').text(formattedContracts); // Display contracts

    // Update other UI elements
    updateDualUI('strike-price', strike, 'text', formatNumber);
    updateDualUI('option-cost', `${positionCost.toFixed(collateral.decimals === 6 ? 2 : 4)} ${collateral.name}`); 
    updateDualUI('payout-ratio', formattedContracts); 
    updateDualUI('payout-threshold', strike, 'text', formatNumber);
    updateDualUI('payout-asset', collateral.name);

    // Update the new option preview fields with Greeks and breakeven data
    const { delta, iv } = orderData.greeks;
    
    // Get the breakeven directly from the table data instead of recalculating
    // The breakeven is already calculated and displayed in the table
    const tableRow = $(`.option-row[data-index="${state.selectedOrderIndex}"]`);
    const tableBreakeven = tableRow.find('td:nth-child(6)').text().replace('$', '');
    
    updateDualUI('option-breakeven', tableBreakeven, 'text', formatNumber);
    updateDualUI('option-delta', delta.toFixed(2));
    updateDualUI('option-iv', `${parseInt(iv * 100)}%`);

    // Set the payout direction text
    $('#payout-direction').text(direction);

    // Update position details in the trade panel (if this function exists and is needed)
    updateTradeDetails(orderData, strike, rawPayoutRatio); // Assuming this updates other non-cost related things

    const mainExpirySeconds = state.expiryTime ? Math.floor(state.expiryTime / 1000) : 0;
    // Target both basic and advanced view countdowns if they exist
    $('#time-left, #adv-time-left') // Assuming #adv-time-left exists for advanced view
        .attr('data-countdown-expiry', mainExpirySeconds)
        .data('expiry', mainExpirySeconds); // Also store in jQuery data if needed elsewhere

    // Warn if near expiry
    if (isNearExpiry()) {
        $('.expiry-warning').show();
    } else {
        $('.expiry-warning').hide();
    }
    
    // Check fund status after option preview update (debounced)
    refreshFundStatus();
}

// Show trade confirmation modal
function showTradeConfirmation() {
    // Safety check: ensure app is fully loaded
    if (!state || state.selectedOrderIndex === null || !state.orders || state.orders.length === 0 || 
        !state.selectedPositionSize || !state.selectedContracts) {
        alert("App is still loading. Please wait a moment and try again.");
        return;
    }
    
    const baseOrder = state.orders[state.selectedOrderIndex];
    const order = baseOrder.order;
    const asset = CONFIG.getUnderlyingAsset(order.priceFeed);
    const strike = formatUnits(order.strikes[0], PRICE_DECIMALS);
    const collateral = CONFIG.getCollateralDetails(order.collateral);
    const optionType = order.isCall ? "CALL" : "PUT";
    
    // Additional validation: check if swap is loading before showing modal
    const tradeButton = $('#trade-now-btn');
    if (tradeButton.text().includes('LOADING SWAP')) {
        alert("Please wait for swap data to load before confirming the trade.");
        return;
    }
    
    // Check if order is about to expire
    if (isOrderExpired(order.orderExpiryTimestamp)) {
        // Show message that MM is not responding
        alert("Quotes are stale, please try again later.");
        // Close Trade Modal
        $('#trade-confirm-modal').modal('hide');
        return;
    } else if (isOrderExpiringSoon(order.orderExpiryTimestamp)) {
        // Show message that we need to refresh the quote
        alert("This order is about to expire. Refreshing quote...");
        
        // Refresh data and try again
        refreshData().then(async () => {
            // After refresh, select a new option and try again
            await selectOptionBasedOnConviction();
            showTradeConfirmation();
        });
        return;
    }
    
    // Get values from stored values
    const positionSize = state.selectedPositionSize;
    const leverageValue = $('#leverage-value').text();
    
    // Make sure we have the latest contract calculation using the centralized calculator
    const selectedContracts = state.selectedContracts; // Already calculated in updateOptionPreview
    const displayContracts = selectedContracts.toFixed(4);
    
    // Update modal to show contracts
    $('#modal-contracts').text(displayContracts);

    // Update modal title with option display
    $('#tradeConfirmModalLabel').text('Confirm Trade');
    
    // Show correct number of contracts
    $('#modal-option-type').text(`BUY ${displayContracts} ${optionType} @ $${formatNumber(strike)}`);
    
    // Update modal details
    $('#modal-position-size').text(`${positionSize.toFixed(collateral.decimals === 6 ? 2 : 4)} ${collateral.name}`);
    $('#modal-leverage').text(`${leverageValue}x`);
    $('#modal-expiry').text('08:00 UTC');
    
    // Update "what this means" section
    $('#modal-direction').text(order.isCall ? 'ABOVE' : 'BELOW');
    $('#modal-strike').text(formatNumber(strike));
    $('#modal-max-loss').text(`${positionSize.toFixed(collateral.decimals === 6 ? 2 : 6)} ${collateral.asset}`);
    
    // Update modal countdown for option expiry
    const timeLeft = getTimeToExpiry();
    const formattedTime = formatTimeDisplay(timeLeft);
    
    // Add order expiry countdown
    const orderTimeLeft = getOrderTimeRemaining(order.orderExpiryTimestamp);
    const formattedOrderTime = formatTimeDisplay(orderTimeLeft);
    
    // Display both countdowns
    $('#modal-countdown').html(`
        <div>Order valid for: <span class="order-countdown">${formattedOrderTime}</span></div>
        <div>Option expires in: <span class="option-countdown" data-countdown-expiry="${order.expiry}">${formattedTime}</span></div>
    `);
    
    // Start countdown timer for order expiry
    if (state.orderExpiryTimer) {
        clearInterval(state.orderExpiryTimer);
    }
    
    state.orderExpiryTimer = setInterval(() => {
        const newOrderTimeLeft = getOrderTimeRemaining(order.orderExpiryTimestamp);
        
        // If less than 30 seconds remaining, refresh the quote
        if (newOrderTimeLeft < 30) {
            clearInterval(state.orderExpiryTimer);
            
            // Close the modal
            $('#trade-confirm-modal').modal('hide');
            
            // Show message that we need to refresh the quote
            setTimeout(() => {
                alert("Order quote expired. Refreshing data...");
                
                // Refresh data and try again
                refreshData().then(async () => {
                    // After refresh, select a new option and try again
                    await selectOptionBasedOnConviction();
                    showTradeConfirmation();
                });
            }, 500);
            
            return;
        }
        
        // Update the countdown
        $('.order-countdown').text(formatTimeDisplay(newOrderTimeLeft));
    }, 1000);
    
    // Use our centralized calculator for profit scenarios
    const scenarios = optionCalculator.calculateProfitScenarios(
        order, 
        strike, 
        positionSize, 
        selectedContracts
    );
    
    console.log("Scenarios:", scenarios);
    // Update scenario displays
    $('#scenario-loss').text(`${order.isCall ? 'Below' : 'Above'} $${formatNumber(strike)}: Lose ${positionSize.toFixed(collateral.decimals === 6 ? 2 : 4)} ${collateral.name} (100% loss)`);
    $('#scenario-breakeven').text(`$${formatNumber(scenarios.breakeven)}: Break even`);
    $('#scenario-profit1').text(`$${formatNumber(scenarios.profit1.price)}: Profit $${scenarios.profit1.profit} in ${collateral.name} (${scenarios.profit1.profitPercent}% return)`);
    $('#scenario-profit2').text(`$${formatNumber(scenarios.profit2.price)}: Profit $${scenarios.profit2.profit} in ${collateral.name} (${scenarios.profit2.profitPercent}% return)`);
    
    // Show the modal
    $('#trade-confirm-modal').modal('show');
    
    // Set up event handler to clear timer when modal is closed
    $('#trade-confirm-modal').on('hidden.bs.modal', function() {
        if (state.orderExpiryTimer) {
            clearInterval(state.orderExpiryTimer);
            state.orderExpiryTimer = null;
        }
    });
    
    // Update the modal with capacity information
    getOrderFillInfo(baseOrder).then(fillInfo => {
        if (fillInfo) {
            // Add batch information to the modal
            $('#modal-batch-info').show();
            $('#modal-batch-capacity').text(
                `${fillInfo.fillPercentage}% of this order batch has been filled`);
            $('#modal-remaining-capacity').text(
                `${fillInfo.remainingCapacity} ${fillInfo.collateralSymbol} available`);
        } else {
            $('#modal-batch-info').hide();
        }
    });
}

// Function to check if an order is about to expire (less than 30 seconds)
function isOrderExpiringSoon(orderExpiryTimestamp) {
    const timeLeft = getOrderTimeRemaining(orderExpiryTimestamp);
    return timeLeft < 30; // Return true if less than 30 seconds left
}

function isOrderExpired(orderExpiryTimestamp) {
    return getOrderTimeRemaining(orderExpiryTimestamp) == 0    
}

// Function to get the time remaining for an order in seconds
function getOrderTimeRemaining(orderExpiryTimestamp) {
    const now = Math.floor(Date.now() / 1000); // Current time in seconds
    const expiryTime = parseInt(orderExpiryTimestamp); // Convert to integer if it's not already
    
    return Math.max(0, expiryTime - now); // Don't return negative time
}

/**
 * Handle price slippage by showing user-friendly message and retrying with fresh data
 */
async function handlePriceSlippageRetry() {
    console.log("Handling price slippage - price moved during trade execution");
    
    // Show user-friendly message about price movement
    $('#trade-error-message').html(`
        <div class="d-flex align-items-center">
            <div class="spinner-border spinner-border-sm me-2" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <span>Price moved during trade execution. Recalculating with current market price...</span>
        </div>
    `);
    $('#trade-error-alert').removeClass('alert-danger').addClass('alert-info').show();
    
    // Disable the confirm button temporarily
    $('#confirm-trade-btn').text('Recalculating...').prop('disabled', true);
    
    try {
        // Clear stale swap data
        state.currentSwapInfo = null;
        
        // Force refresh of market data and orders
        await refreshData();
        
        // Reselect the current option (this will trigger new swap calculations)
        if (state.selectedOrderIndex !== null) {
            await selectOptionBasedOnConviction();
            
            // Give swap calculation a moment to complete
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Check if we now have fresh swap data
            const swapCheck = checkSwapReadiness();
            if (swapCheck.ready) {
                // Hide the error message and re-enable the button
                $('#trade-error-alert').hide();
                $('#confirm-trade-btn').text('Confirm Trade').prop('disabled', false);
                
                // Show a brief success message
                $('#trade-error-message').text('Quote updated successfully! You can now proceed with the trade.');
                $('#trade-error-alert').removeClass('alert-info').addClass('alert-success').show();
                
                // Hide success message after 3 seconds
                setTimeout(() => {
                    $('#trade-error-alert').hide();
                }, 3000);
            } else {
                // Still waiting for swap data
                $('#trade-error-message').text('Still calculating swap data. Please wait a moment and try again.');
                $('#trade-error-alert').removeClass('alert-info').addClass('alert-warning').show();
                $('#confirm-trade-btn').text('Try Again').prop('disabled', false);
            }
        }
    } catch (error) {
        console.error("Error during price slippage retry:", error);
        $('#trade-error-message').text('Failed to recalculate quote. Please close this dialog and try again.');
        $('#trade-error-alert').removeClass('alert-info').addClass('alert-danger').show();
        $('#confirm-trade-btn').text('Close & Retry').prop('disabled', false);
    }
}

// Track logged expired orders to prevent spam
const loggedExpiredOrders = new Set();

// Execute the trade
async function executeTrade() {
    // Hide any previous error messages
    $('#trade-error-alert').hide();
    
    try {
        // Check if wallet is connected
        if (!ethereumClient.getAccount().isConnected) {
            throw new Error("Wallet not connected. Please connect your wallet first.");
        }

        // Set the button to "Processing..." state
        $('#confirm-trade-btn').text('  ...').prop('disabled', true);
        
        // Get current selected option details
        if (state.selectedOrderIndex === null) return;
        
        const orderData = state.orders[state.selectedOrderIndex];
        const order = orderData.order; // The core order object
        const signature = orderData.signature; // The order signature
        const requiredCollateralDetails = CONFIG.getCollateralDetails(order.collateral); // Details of the token the order requires

        // First ensure the order isn't about to expire
        if (isOrderExpiringSoon(order.orderExpiryTimestamp)) {
            // Close modal and refresh
            $('#trade-confirm-modal').modal('hide');
            alert("Order expired during confirmation. Refreshing quote...");
            await refreshData();
            await selectOptionBasedOnConviction();
            showTradeConfirmation();
            return;
        }
        
        // Show loading state (redundant, already set above, but safe)
        $('#confirm-trade-btn').text('Processing...').prop('disabled', true);

        // Determine if a swap is needed
        const selectedPaymentAssetName = getSelectedPaymentAsset();
        const isSwapRequired = selectedPaymentAssetName !== CONFIG.getCollateralDetails(order.collateral).name;
        
        let swapInfo = null;
        let inputTokenDetails = null;

        if (isSwapRequired) {
            if (!state.currentSwapInfo || !state.currentSwapInfo.swapData) {
                 throw new Error("Swap is required, but swap information is missing. Please select the payment asset again or wait for swap data to load.");
            }
            swapInfo = state.currentSwapInfo.swapData; // Get the pre-calculated swap data
            // Find the input token details from the swap data
            const inputTokenAddress = swapInfo.swaps[0][0].tokenIn;
             if (!swapInfo.tokens[inputTokenAddress]) {
                 throw new Error("Input token details not found in swap data.");
             }
            inputTokenDetails = swapInfo.tokens[inputTokenAddress];
        }
        
        // Import Wagmi functions
        const { readContract, writeContract, waitForTransaction } = WagmiCore;

        // --- Approvals ---

        // 1. Approve INPUT token to OPTION BOOK to be swapped via SWAP ROUTER.call(callData) (only if swap is required)
        if (isSwapRequired && swapInfo && inputTokenDetails) {
            const swapRouterAddress = swapInfo.routerAddress;
            const inputTokenAddress = inputTokenDetails.address;
            const inputAmount = swapInfo.inputAmount; // Amount of input token needed for swap
            const inputTokenDecimals = inputTokenDetails.decimals;

            const inputAllowance = await readContract({
                address: inputTokenAddress,
                abi: ERC20ABI,
                functionName: 'allowance',
                args: [state.connectedAddress, OPTION_BOOK_ADDRESS],
                chainId: 8453
            });

            const inputAllowanceBN = ethers.BigNumber.from(inputAllowance.toString());
            const inputAmountBN = ethers.BigNumber.from(inputAmount);

            if (inputAllowanceBN.lt(inputAmountBN)) {
                // Check if exact approval is enabled
                const useExactApproval = $('#exact-approval-checkbox').is(':checked');
                
                // Calculate approval amount using new method
                const inputCollateralDetails = CONFIG.getCollateralDetails(inputTokenAddress);
                const inputPositionSize = parseFloat(ethers.utils.formatUnits(inputAmountBN, inputTokenDecimals));
                const approvalAmountBN = optionCalculator.calculateApprovalAmountWithLimit(
                    order, 
                    inputCollateralDetails, 
                    inputPositionSize, 
                    useExactApproval
                );
                
                const approveInputTx = await writeContract({
                    address: inputTokenAddress,
                    abi: ERC20ABI,
                    functionName: 'approve',
                    args: [OPTION_BOOK_ADDRESS, approvalAmountBN.toString()],
                    chainId: 8453
                });
                await waitForTransaction({ hash: approveInputTx.hash });
            }
        }

        // 2. Approve OUTPUT token (required collateral) for OPTION BOOK CONTRACT (always required, as fillOrder needs it)
        // Use our centralized calculator for the required collateral amount (output of swap, input of fillOrder)
        // Calculate the actual amount needed for this trade
        const actualRequiredAmountBN = optionCalculator.calculateApprovalAmount(
            order,
            requiredCollateralDetails,
            state.selectedPositionSize
        );

        const collateralAllowance = await readContract({
            address: order.collateral, // The required collateral address
            abi: ERC20ABI,
            functionName: 'allowance',
            args: [state.connectedAddress, OPTION_BOOK_ADDRESS],
            chainId: 8453
        });

        const collateralAllowanceBN = ethers.BigNumber.from(collateralAllowance.toString());

        // Check if existing allowance is sufficient for this trade
        if (collateralAllowanceBN.lt(actualRequiredAmountBN)) {
            // Check if exact approval is enabled
            const useExactApproval = $('#exact-approval-checkbox').is(':checked');
            
            // Calculate the approval amount (exact trade amount or $1000 limit)
            const approvalAmountBN = optionCalculator.calculateApprovalAmountWithLimit(
                order,
                requiredCollateralDetails,
                state.selectedPositionSize,
                useExactApproval
            );
            
            const approveCollateralTx = await writeContract({
                address: order.collateral,
                abi: ERC20ABI,
                functionName: 'approve',
                args: [OPTION_BOOK_ADDRESS, approvalAmountBN.toString()],
                chainId: 8453
            });
            await waitForTransaction({ hash: approveCollateralTx.hash });
        }

        // --- Prepare Order Parameters ---
        // Convert selectedContracts to BigNumber for blockchain transaction
        const numContracts = ethers.utils.parseUnits(
            state.selectedContracts.toFixed(requiredCollateralDetails.decimals), // Use collateral decimals
            requiredCollateralDetails.decimals
        );

        // Create the order object for the contract call
        const orderParams = {
            maker: order.maker,
            orderExpiryTimestamp: order.orderExpiryTimestamp,
            collateral: order.collateral,
            isCall: order.isCall,
            priceFeed: order.priceFeed,
            implementation: order.implementation,
            isLong: order.isLong,
            maxCollateralUsable: order.maxCollateralUsable.toString(),
            strikes: order.strikes.map(s => s.toString()), // Ensure strikes are strings
            expiry: order.expiry,
            price: order.price.toString(),
            numContracts: numContracts.toString() // Pass numContracts as string
        };

        // --- Execute Trade (Swap and Fill or Just Fill) ---
        let tx;
        if (isSwapRequired && swapInfo) {
            const swapRouterAddress = swapInfo.routerAddress;
            const encodedSwapData = swapInfo.encodedSwapData;
            // Get the source token address and amount from the swap info
            const swapSrcTokenAddress = inputTokenDetails.address; // Already have this from earlier
            const swapSrcAmount = swapInfo.inputAmount; // Already have this from earlier

             tx = await writeContract({
                 address: OPTION_BOOK_ADDRESS,
                 abi: OPTION_BOOK_ABI, // Ensure this ABI includes the updated swapAndFillOrder
                 functionName: 'swapAndFillOrder',
                 // Update the args array to match the new signature
                 args: [
                     orderParams,
                     signature,
                     swapRouterAddress,
                     swapSrcTokenAddress, // New arg: Source token address
                     swapSrcAmount,       // New arg: Source token amount (ensure it's a string if it's a BigNumber)
                     encodedSwapData
                 ],
                 chainId: 8453
             });

        } else {
            tx = await writeContract({
                address: OPTION_BOOK_ADDRESS,
                abi: OPTION_BOOK_ABI,
                functionName: 'fillOrder',
                args: [orderParams, signature],
                chainId: 8453
            });
        }

        // Wait for transaction confirmation
        const receipt = await waitForTransaction({ hash: tx.hash });

        // Close modal
        $('#trade-confirm-modal').modal('hide');

        // Create a position object to add to our local state (optional, if needed immediately)
        const asset = CONFIG.getUnderlyingAsset(order.priceFeed);
        const strike = formatUnits(order.strikes[0], PRICE_DECIMALS);
        const optionType = order.isCall ? "CALL" : "PUT";
        const leverageValue = $('#leverage-value').text(); // Get displayed leverage

        const position = {
            id: `pos-${Date.now()}`,
            txHash: tx.hash,
            asset: asset,
            type: optionType,
            strike: strike,
            size: state.selectedPositionSize, // The cost in collateral value
            leverage: leverageValue,
            timestamp: Date.now(),
            status: 'open', // Assume open until confirmed otherwise
            pnl: 0 // Initial PnL
        };
        // You might want to push this to a local 'pending positions' array or similar

        // Show success message
        $('#trade-success-alert').fadeIn().delay(3000).fadeOut();

        // Send background refresh for API
        refreshBackend();

        // If on positions tab, refresh positions
        if ($('#positions-section').is(':visible')) {
            refreshPositions();
        }

        // Reset UI
        $('#confirm-trade-btn').text('Confirm Trade').prop('disabled', false);

    } catch (error) {
        console.error('Error executing trade:', error);

        // Reset the button state
        $('#confirm-trade-btn').text('Confirm Trade').prop('disabled', false);

        // Extract the error message
        let errorMessage = "Unknown error occurred";
        if (error.code === 4001) {
            errorMessage = "Transaction rejected by user";
        } else if (error.error && error.error.message) { // Handle errors from providers like Metamask
            errorMessage = error.error.message;
        } else if (error.message) {
            // Try to extract reason from contract revert
            const reasonMatch = error.message.match(/reason="([^"]+)"/);
            if (reasonMatch && reasonMatch[1]) {
                errorMessage = reasonMatch[1];
            } else {
                 // Check for common Wagmi/Viem error patterns
                 if (error.shortMessage) {
                     errorMessage = error.shortMessage;
                 } else {
                    errorMessage = error.message;
                 }
            }
        }
         // Specific handling for common issues
         if (errorMessage.includes("Swap failed")) {
             errorMessage = "The token swap failed. This could be due to price changes or insufficient liquidity. Please try again.";
         } else if (errorMessage.includes("Router not authorized")) {
             errorMessage = "Internal configuration error: The swap router is not authorized.";
         } else if (errorMessage.includes("Exceeds max collateral")) {
             errorMessage = "This order batch is now full. Please try another option.";
            // Force a refresh of order data after a short delay
            setTimeout(() => {
                refreshData();
                // Close the modal after refresh
                $('#trade-confirm-modal').modal('hide');
            }, 3000);
        } else if (errorMessage.includes("insufficient allowance")) {
             // This shouldn't happen with the checks, but catch it just in case
             errorMessage = "Insufficient token allowance. Please try the transaction again to grant permission.";
        } else if (errorMessage.includes("transfer amount exceeds balance") || 
                   errorMessage.includes("ERC20 amount transfer exceeds balance") ||
                   errorMessage.includes("amount exceeds balance")) {
            // Handle price slippage - automatically retry with fresh quote
            handlePriceSlippageRetry();
            return; // Exit early to prevent showing error, handlePriceSlippageRetry will manage the UI
        }

        // Set the error message and show the alert
        $('#trade-error-message').text(errorMessage);
        $('#trade-error-alert').show();

        // Log detailed info for debugging
        console.log("Error details:", {
            message: errorMessage, // The processed message shown to the user
            originalError: error, // The raw error object
        });
    }
}

function refreshBackend() {
    $.get("https://odette.fi/api/update", function(x) { 
        if (x.status == "skipped") {
            console.log("Update skipped, retrying in 10 seconds...");
            setTimeout(refreshBackend, 10000);
        } else {
            console.log("Update successful.");
        }
    });
}

function updateTradeDetails(orderData, strike, rawLeverage) {
    // Update current target price using the helper
    updateDualUI('current-target', `$${formatNumber(strike)}`);

    const order = orderData.order;

    // Count the number of PUT and CALL options to calculate the correct gradient
    let putCount = 0;
    let callCount = 0;
    let minStrike = Infinity;
    let maxStrike = 0;
    
    if (state.orders && state.orders.length > 0) {
        state.orders.forEach(orderData => {
            if (orderData.order.isCall) {
                callCount++;
            } else {
                putCount++;
            }
            
            // Track min and max strikes to establish our range
            const strikePrice = parseFloat(formatUnits(orderData.order.strikes[0], PRICE_DECIMALS));
            minStrike = Math.min(minStrike, strikePrice);
            maxStrike = Math.max(maxStrike, strikePrice);
        });
    }
    
    // Get the current price for the selected asset
    const currentPrice = state.market_prices[state.selectedAsset] || 0;
    
    // Calculate where the current price falls in the range of strikes (as a percentage)
    const totalRange = maxStrike - minStrike;
    let currentPricePercent = 50; // Default to middle if we can't calculate
    
    if (totalRange > 0 && currentPrice > 0) {
        currentPricePercent = Math.min(100, Math.max(0, ((currentPrice - minStrike) / totalRange) * 100));
    }
    
    // Set the width of the yellow zone
    const YELLOW_ZONE_WIDTH = 10; // 10% width for the yellow zone
    
    // Calculate the gradient with yellow centered on current price
    const leftYellow = Math.max(0, currentPricePercent - YELLOW_ZONE_WIDTH/2);
    const rightYellow = Math.min(100, currentPricePercent + YELLOW_ZONE_WIDTH/2);
    
    const backgroundStyle = `linear-gradient(to right, 
        var(--negative) 0%, 
        var(--negative) ${leftYellow}%, 
        yellow ${currentPricePercent}%, 
        var(--positive) ${rightYellow}%, 
        var(--positive) 100%)`;
    
    // Apply to both sliders
    $('#conviction-slider, #adv-conviction-slider').css('background', backgroundStyle);

    // Make sure modals show the adjusted leverage
    if (rawLeverage) {
        // Store the adjusted leverage for use in trade confirmation
        $('#adjusted-leverage-value').text(rawLeverage);
    }

    // Get and update fill information
    if (orderData) {
        // Make sure we have the order object itself
        const order = orderData.order;
        if (!order) {
            console.error("Order object missing in orderData for updateTradeDetails");
            // Disable buttons if order data is incomplete
            $('#trade-now-btn, #adv-trade-btn').prop('disabled', true).text('Error Loading Order');
            return; // Exit early
        }

        // Check if MM quote is expired FIRST, before checking capacity
        if (isOrderExpired(order.orderExpiryTimestamp)) {
            // Only log each expired order once to prevent console spam
            const orderKey = `${orderData.nonce}-expired`;
            if (!loggedExpiredOrders.has(orderKey)) {
                console.log(`Order ${orderData.nonce} quote expired. Disabling trade button.`);
                loggedExpiredOrders.add(orderKey);
            }
            
            $('#trade-now-btn, #adv-trade-btn').prop('disabled', true).text('MM Quote Expired');
            // Clear capacity info as it's irrelevant if quote is expired
            updateUI('#fill-capacity', 'Quote expired');
            updateUI('#available-capacity', '-');
            $('#fill-progress').css('width', '0%');
            $('#capacity-warning').hide();
        } else {
            // If quote is not expired, proceed to check fill capacity
            getOrderFillInfo(orderData).then(fillInfo => {
                if (fillInfo) {
                    // Update UI with fill information
                    updateUI('#fill-capacity',
                        `${fillInfo.fillPercentage}% filled (${parseFloat(fillInfo.amountFilled).toFixed(6)}/${parseFloat(fillInfo.maxCollateralUsable).toFixed(6)} ${fillInfo.collateralSymbol})`);

                    updateUI('#available-capacity',
                        `${parseFloat(fillInfo.remainingCapacity).toFixed(6)} ${fillInfo.collateralSymbol} available`);

                    $('#fill-progress').css('width', `${fillInfo.fillPercentage}%`);

                    // Show warning if capacity is low
                    if (parseFloat(fillInfo.fillPercentage) > 80) {
                        $('#capacity-warning').show();
                    } else {
                        $('#capacity-warning').hide();
                    }

                    // Disable the trade button if capacity is full (and quote wasn't expired)
                    if (fillInfo.isFull) {
                        $('#trade-now-btn, #adv-trade-btn').prop('disabled', true).text('ORDER CAPACITY FULL');
                    } else {
                        $('#trade-now-btn, #adv-trade-btn').prop('disabled', false).text('TRADE NOW');
                    }
                } else {
                    // Handle case where fill info couldn't be retrieved
                    updateUI('#fill-capacity', 'Unable to fetch capacity data');
                    updateUI('#available-capacity', 'Try refreshing the page');
                    $('#fill-progress').css('width', '0%');
                    $('#capacity-warning').hide();
                    // Disable button if capacity check fails
                    $('#trade-now-btn, #adv-trade-btn').prop('disabled', true).text('Error Checking Capacity');
                }
            }).catch(error => {
                console.error("Error in fill info promise:", error);
                updateUI('#fill-capacity', 'Error fetching capacity data');
                updateUI('#available-capacity', 'Try refreshing the page');
                $('#fill-progress').css('width', '0%');
                $('#capacity-warning').hide();
                 // Disable button on error
                $('#trade-now-btn, #adv-trade-btn').prop('disabled', true).text('Error Checking Capacity');
            });
        }
    }
}

async function getOrderFillInfo(order) {
    try {
        if (!order || !order.order || !order.nonce) {
            console.warn("Missing order or nonce in getOrderFillInfo");
            return null;
        }
        
        // Check if connected
        if (!ethereumClient.getAccount().isConnected) {
            console.warn("Wallet not connected in getOrderFillInfo");
            return null;
        }
        
        // Get collateral details from the address
        const collateralAddress = order.order.collateral;
        const collateralDetails = CONFIG.getCollateralDetails(collateralAddress);
        const collateralSymbol = collateralDetails ? collateralDetails.name : 'UNKNOWN';
        const collateralDecimals = collateralDetails ? collateralDetails.decimals : 18;
        
        // Import readContract from WagmiCore
        const { readContract } = WagmiCore;
        
        // Ensure nonce is a BigNumber for display purposes
        const nonce = ethers.BigNumber.from(order.nonce);
        
        // Use Wagmi to read contract
        const amountFilled = await readContract({
            address: OPTION_BOOK_ADDRESS,
            abi: OPTION_BOOK_ABI,
            functionName: 'amountFilled',
            args: [nonce.toString()],
            chainId: 8453 // Add this line
        });
        
        // Convert amountFilled to ethers BigNumber for consistency with existing code
        const amountFilledBN = ethers.BigNumber.from(amountFilled.toString());
        
        // Ensure maxCollateralUsable is a BigNumber
        const maxCollateralUsable = ethers.BigNumber.from(order.order.maxCollateralUsable);
        
        // Calculate remaining capacity
        const remainingCapacity = maxCollateralUsable.sub(amountFilledBN);
        
        // Calculate fill percentage
        const fillPercentage = maxCollateralUsable.gt(0) 
            ? (parseFloat(amountFilledBN.mul(10000).div(maxCollateralUsable).toString()) / 100).toFixed(2)
            : "0";
            
        return {
            amountFilled: formatUnits(amountFilledBN, collateralDecimals),
            maxCollateralUsable: formatUnits(maxCollateralUsable, collateralDecimals),
            remainingCapacity: formatUnits(remainingCapacity, collateralDecimals),
            fillPercentage: fillPercentage,
            isFull: remainingCapacity.lte(0),
            collateralSymbol: collateralSymbol
        };
    } catch (error) {
        console.error("Error fetching order fill info:", error);
        console.error("Error details:", {
            orderCollateral: order?.order?.collateral,
            isConnected: ethereumClient.getAccount().isConnected,
            contractAddress: OPTION_BOOK_ADDRESS
        });
        return null;
    }
}


/**
 * Settles an expired option by calling the payout function on the contract
 */
async function settleOption(event) {
    const button = event.target;
    const positionId = $(button).data("positionId");
    const positionType = $(button).data("positionType");

    // Disable the button and show loading state
    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Settling...';
    
    try {
        // Get the position data
        const position = state.userPositions.openPositions.find(p => p.entryTxHash === positionId);
            
        if (!position) {
            throw new Error('Position not found');
        }
        
        console.log(position);
        
        // Import Wagmi functions
        const { writeContract, waitForTransaction } = WagmiCore;
        
        // Call the payout function using Wagmi
        const tx = await writeContract({
            address: position.address,
            abi: OPTION_ABI,
            functionName: 'payout',
            args: [],
            chainId: 8453 // Add this line
        });
        
        // Update button to show transaction pending
        button.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Transaction pending...';
        
        // Wait for the transaction to be mined
        await waitForTransaction({ hash: tx.hash });
        
        // Update UI to show success
        button.className = 'btn btn-success';
        button.innerHTML = '<i class="bi bi-check-circle"></i> Option Settled';
        
        // Update local state first for immediate UI feedback
        const localPositionIndex = state.userPositions.openPositions.findIndex(p => p.entryTxHash === positionId);
        if (localPositionIndex > -1) {
            state.userPositions.openPositions[localPositionIndex].settled = true;
            state.userPositions.openPositions[localPositionIndex].status = 'settled';
            
            // Update UI immediately if the position details modal is still open
            if ($('#position-details-modal').is(':visible')) {
                updateSettlementInfo(state.userPositions.openPositions[localPositionIndex]);
            }
        }
        
        // Then refresh from API to get confirmed state
        await refreshPositions();
        
        // Show success message using Bootstrap alert
        $('#positions-container').prepend(`
            <div class="alert alert-success alert-dismissible fade show" role="alert">
                Option settled successfully!
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `);

        // Call api/update-position to update the position
        await fetch('https://odette.fi/api/update');
        
    } catch (error) {
        console.error('Error settling option:', error);
        
        // Reset button state
        button.disabled = false;
        button.innerHTML = 'Settle Option';
        
        // Show error message using Bootstrap alert
        $('#positions-container').prepend(`
            <div class="alert alert-danger alert-dismissible fade show" role="alert">
                Failed to settle option: ${error.message}
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `);
    }
}

// ETH to WETH Wrapping Functions
async function updateETHBalance() {
    try {
        if (!state.connectedAddress) {
            $('#eth-balance-display').text('--');
            return;
        }
        
        const balance = await WagmiCore.getETHBalance(state.connectedAddress);
        const ethBalance = parseFloat(ethers.utils.formatEther(balance));
        $('#eth-balance-display').text(ethBalance.toFixed(4));
        
        // Show/hide wrap section based on whether WETH is selected and user has ETH
        const selectedPayment = getSelectedPaymentAsset();
        if (selectedPayment === 'WETH' && ethBalance > 0.00001) {
            $('#eth-wrap-section').slideDown();
        } else if (selectedPayment !== 'WETH') {
            $('#eth-wrap-section').slideUp();
        }
        
    } catch (error) {
        console.error('Error updating ETH balance:', error);
        $('#eth-balance-display').text('Error');
    }
}

async function wrapETH() {
    const wrapButton = $('#wrap-eth-btn');
    const statusDiv = $('#wrap-status');
    const amountInput = $('#eth-wrap-amount');
    
    try {
        const ethAmount = parseFloat(amountInput.val());
        
        // Validation
        if (!ethAmount || ethAmount <= 0) {
            throw new Error('Please enter a valid ETH amount');
        }
        
        // Check ETH balance
        const ethBalance = await WagmiCore.getETHBalance(state.connectedAddress);
        const ethBalanceFormatted = parseFloat(ethers.utils.formatEther(ethBalance));
        
        if (ethAmount > ethBalanceFormatted - 0.001) { // Leave some ETH for gas
            throw new Error(`Insufficient ETH balance. You have ${ethBalanceFormatted.toFixed(4)} ETH, but need to keep some for gas fees.`);
        }
        
        // Update UI to show wrapping in progress
        wrapButton.prop('disabled', true);
        wrapButton.html('<span class="spinner-border spinner-border-sm"></span> Wrapping...');
        statusDiv.removeClass('alert-danger alert-success').addClass('alert-info');
        statusDiv.text('Wrapping ETH to WETH...').show();
        
        // Execute the wrap
        const tx = await WagmiCore.wrapETH(ethAmount);
        
        // Update UI to show transaction pending
        statusDiv.text(`Transaction sent! Hash: ${tx.hash.substring(0, 10)}...`);
        
        // Wait for confirmation
        await tx.wait(1);
        
        // Success!
        statusDiv.removeClass('alert-info').addClass('alert-success');
        statusDiv.text(`Successfully wrapped ${ethAmount} ETH to WETH!`);
        wrapButton.html('<i class="bi bi-check-circle"></i> Wrapped!');
        
        // Clear the input
        amountInput.val('');
        
        // Update balances
        await updateETHBalance();
        await updateWalletBalance(); // This will update WETH balance in the dropdown
        
        // Reset button after 3 seconds
        setTimeout(() => {
            wrapButton.prop('disabled', false);
            wrapButton.html('<i class="bi bi-arrow-repeat"></i> Wrap ETH');
            statusDiv.hide();
        }, 3000);
        
    } catch (error) {
        console.error('Error wrapping ETH:', error);
        
        // Show error
        statusDiv.removeClass('alert-info alert-success').addClass('alert-danger');
        statusDiv.text(`Error: ${error.message}`).show();
        
        // Reset button
        wrapButton.prop('disabled', false);
        wrapButton.html('<i class="bi bi-arrow-repeat"></i> Wrap ETH');
        
        // Hide error after 5 seconds
        setTimeout(() => {
            statusDiv.hide();
        }, 5000);
    }
}

// Add event listener setup for wrap functionality
function setupWrapETHListeners() {
    // ETH wrapping
    $('#wrap-eth-btn').on('click', wrapETH);
    
    // Update ETH balance when payment asset changes - now handled by button group event listeners
    
    // Add quick amount buttons
    $(document).on('click', '[data-eth-amount]', function() {
        const amount = $(this).data('eth-amount');
        $('#eth-wrap-amount').val(amount);
    });
}

// New function: Smart asset selection based on balance and requirements
async function selectBestPaymentAsset(order, requiredAmountUSD) {
    if (!state.connectedAddress) {
        return null;
    }
    
    try {
        // Get required collateral details
        const requiredCollateral = CONFIG.getCollateralDetails(order.collateral);
        const preferredAsset = requiredCollateral.name;
        
        // Get all available assets and their balances
        const availableAssets = ['USDC', 'CBBTC', 'WETH'];
        
        // Use Promise.allSettled to handle individual balance fetch failures gracefully
        const balanceResults = await Promise.allSettled(
            availableAssets.map(async (asset) => {
                try {
                    const balance = await kyberSwap.getUserBalance(asset);
                    const dollarValue = convertToDollarValue(balance, asset);
                    return {
                        symbol: asset,
                        balance: parseFloat(balance) || 0,
                        dollarValue: dollarValue || 0,
                        isSufficient: (dollarValue || 0) >= requiredAmountUSD
                    };
                } catch (error) {
                    console.warn(`Failed to get balance for ${asset}:`, error);
                    return {
                        symbol: asset,
                        balance: 0,
                        dollarValue: 0,
                        isSufficient: false
                    };
                }
            })
        );
        
        // Extract successful results, handle failed ones gracefully
        const assetBalances = balanceResults.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                console.warn(`Failed to get balance for ${availableAssets[index]}:`, result.reason);
                return {
                    symbol: availableAssets[index],
                    balance: 0,
                    dollarValue: 0,
                    isSufficient: false
                                };
            }
        });
        
        // Special handling for WETH - also check ETH balance since it can be wrapped
        let wethData = assetBalances.find(a => a.symbol === 'WETH');
        if (wethData && preferredAsset === 'WETH') {
            try {
                // Get ETH balance
                const ethBalance = await getETHBalance();
                const ethDollarValue = convertToDollarValue(ethBalance, 'ETH');
                
                // Combined WETH + ETH value for decision making
                const combinedValue = wethData.dollarValue + ethDollarValue;
                wethData.combinedValue = combinedValue;
                wethData.ethBalance = ethBalance;
                wethData.isSufficientWithETH = combinedValue >= requiredAmountUSD;
            } catch (error) {
                console.error("Error getting ETH balance:", error);
            }
        }
        
        // Selection logic
        let selectedAsset = null;
        
        // Step 1: If preferred asset is WETH, check WETH first (including ETH wrapping possibility)
        if (preferredAsset === 'WETH' && wethData) {
            if (wethData.isSufficient) {
                selectedAsset = 'WETH';
            } else if (wethData.isSufficientWithETH) {
                selectedAsset = 'WETH';
                // Show ETH wrapping interface if needed
                if (wethData.balance * (state.market_prices['ETH'] || 2500) < requiredAmountUSD) {
                    showETHWrappingInterface();
                }
            }
        }
        
        // Step 2: For other preferred assets, check if balance is sufficient
        if (!selectedAsset && preferredAsset !== 'WETH') {
            const preferredAssetData = assetBalances.find(a => a.symbol === preferredAsset);
            if (preferredAssetData && preferredAssetData.isSufficient) {
                selectedAsset = preferredAsset;
            }
        }
        
        // Step 3: If preferred asset is insufficient, find the asset with highest dollar value that can cover the payment
        if (!selectedAsset) {
            
            // Filter to only sufficient assets, then sort by dollar value (descending)
            const sufficientAssets = assetBalances
                .filter(asset => asset.isSufficient)
                .sort((a, b) => b.dollarValue - a.dollarValue);
            
            if (sufficientAssets.length > 0) {
                selectedAsset = sufficientAssets[0].symbol;
            } else {
                // No single asset is sufficient
                // Find the asset with the highest dollar value regardless of sufficiency
                const highestValueAsset = assetBalances
                    .filter(asset => asset.dollarValue > 0) // Exclude empty balances
                    .sort((a, b) => b.dollarValue - a.dollarValue)[0];
                
                if (highestValueAsset) {
                    selectedAsset = highestValueAsset.symbol;
                } else {
                    // All balances are zero, default to preferred asset
                    selectedAsset = preferredAsset;
                }
            }
        }
        
        // Step 4: Update the UI to reflect the selected asset
        if (selectedAsset) {
            // Update button selection instead of dropdown
        $(`input[name="payment-asset-selection"][value="${selectedAsset}"]`).prop('checked', true);
        updatePaymentAssetBalanceDisplay(selectedAsset);
            
            // Trigger update to show swap information if needed (preview update will be skipped due to isSelectingOption flag)
            updatePaymentAsset();
        }
        
        return selectedAsset;
        
    } catch (error) {
        console.error("Error in smart asset selection:", error);
        // Fallback to preferred asset
        try {
            const requiredCollateral = CONFIG.getCollateralDetails(order.collateral);
            // Update button selection instead of dropdown
        $(`input[name="payment-asset-selection"][value="${requiredCollateral.name}"]`).prop('checked', true);
        updatePaymentAssetBalanceDisplay(requiredCollateral.name);
            return requiredCollateral.name;
        } catch (fallbackError) {
            console.error("Error in fallback asset selection:", fallbackError);
            return null;
        }
    }
}

// Helper function to convert token balance to dollar value
function convertToDollarValue(balance, assetSymbol) {
    if (!balance || balance === 0) return 0;
    
    const numericBalance = parseFloat(balance);
    if (isNaN(numericBalance)) return 0;
    
    switch (assetSymbol) {
        case 'USDC':
        case 'USD': // Handle both token name and asset symbol for USD
            return numericBalance; // USDC/USD is already in dollars
        case 'WETH':
        case 'ETH': // Handle both token name and asset symbol for ETH
            return numericBalance * (state.market_prices['ETH'] || 2500);
        case 'CBBTC':
        case 'BTC': // Handle both token name and asset symbol for BTC
            return numericBalance * (state.market_prices['BTC'] || 50000);
        default:
            console.warn(`Unknown asset symbol: ${assetSymbol}`);
            return 0;
    }
}

// Helper function to get ETH balance
async function getETHBalance() {
    if (!state.connectedAddress) return 0;
    
    try {
        const balance = await WagmiCore.getETHBalance(state.connectedAddress);
        return parseFloat(ethers.utils.formatEther(balance));
    } catch (error) {
        console.error("Error getting ETH balance:", error);
        return 0;
    }
}

// Helper function to show ETH wrapping interface when needed
function showETHWrappingInterface() {
    const ethWrapSection = document.getElementById('eth-wrap-section');
    if (ethWrapSection) {
        ethWrapSection.style.display = 'block';
    }
}

// Toggle ETH wrap section visibility
function toggleEthWrapSection() {
    const ethWrapContent = document.getElementById('eth-wrap-content');
    const toggleBtn = document.getElementById('toggle-eth-wrap-section');
    
    if (!ethWrapContent || !toggleBtn) return;
    
    // Toggle visibility state
    const isCurrentlyVisible = ethWrapContent.style.display !== 'none';
    const newCollapsedState = isCurrentlyVisible;
    
    if (newCollapsedState) {
        // Hide ETH wrap content
        ethWrapContent.style.display = 'none';
        
        // Update button
        toggleBtn.innerHTML = '<i class="bi bi-chevron-down"></i>';
        toggleBtn.setAttribute('title', 'Show ETH Wrapping');
    } else {
        // Show ETH wrap content
        ethWrapContent.style.display = '';
        
        // Update button
        toggleBtn.innerHTML = '<i class="bi bi-chevron-up"></i>';
        toggleBtn.setAttribute('title', 'Hide ETH Wrapping');
    }
    
    // Save state using uiStateManager
    if (window.uiStateManager) {
        window.uiStateManager.saveState('eth_wrap_collapsed', newCollapsedState);
    }
}

/**
 * Check if user has sufficient funds for the current trade
 * Handles both direct payment and swap scenarios
 */
async function checkSufficientFunds() {
    // Return true if no option selected (don't disable button)
    if (state.selectedOrderIndex === null || !state.selectedPositionSize) {
        return { sufficient: true, reason: null };
    }

    // Get current trade details
    const orderData = state.orders[state.selectedOrderIndex];
    const order = orderData.order;
    const requiredCollateral = CONFIG.getCollateralDetails(order.collateral);
    const selectedPaymentAsset = getSelectedPaymentAsset();
    const tradeCostInCollateral = state.selectedPositionSize;
    
    // If payment asset is not yet loaded/selected, don't disable
    if (!selectedPaymentAsset || selectedPaymentAsset === 'init') {
        return { sufficient: true, reason: null };
    }

    try {
        // Check if this is a direct payment or requires swap
        const needsSwap = selectedPaymentAsset !== requiredCollateral.name;
        
        if (!needsSwap) {
            // CASE 1: Direct payment - check if user has enough of the required collateral
            const balance = await kyberSwap.getUserBalance(selectedPaymentAsset);
            const balanceNum = parseFloat(balance) || 0;
            
            if (balanceNum >= tradeCostInCollateral) {
                return { sufficient: true, reason: null };
            } else {
                const deficit = tradeCostInCollateral - balanceNum;
                return { 
                    sufficient: false, 
                    reason: `Insufficient ${selectedPaymentAsset}. Need ${deficit.toFixed(requiredCollateral.decimals === 6 ? 2 : 4)} more ${selectedPaymentAsset}`,
                    balanceInfo: { balance: balanceNum, required: tradeCostInCollateral, asset: selectedPaymentAsset }
                };
            }
        } else {
            // CASE 2: Swap required - check if user has enough of the selected payment asset
            // Get the user's balance in the selected payment asset
            const paymentBalance = await kyberSwap.getUserBalance(selectedPaymentAsset);
            const paymentBalanceNum = parseFloat(paymentBalance) || 0;
            
            if (paymentBalanceNum === 0) {
                return {
                    sufficient: false,
                    reason: `No ${selectedPaymentAsset} balance available for swap`,
                    balanceInfo: { balance: 0, required: 'N/A', asset: selectedPaymentAsset }
                };
            }
            
            // For swap scenarios, we need to estimate how much input token is needed
            // Convert the required collateral amount to USD, then estimate input needed
            const requiredUSD = convertToDollarValue(tradeCostInCollateral, requiredCollateral.asset);
            const paymentUSDValue = convertToDollarValue(paymentBalanceNum, selectedPaymentAsset);
            
            // Add a 5% buffer for swap slippage and fees
            const requiredUSDWithBuffer = requiredUSD * 1.05;
            
            if (paymentUSDValue >= requiredUSDWithBuffer) {
                // Sufficient for swap (estimated)
                return { sufficient: true, reason: null };
            } else {
                // Insufficient - calculate deficit in USD and convert to payment asset
                const deficitUSD = requiredUSDWithBuffer - paymentUSDValue;
                const deficitInPaymentAsset = deficitUSD / convertToDollarValue(1, selectedPaymentAsset);
                
                return {
                    sufficient: false,
                    reason: `Insufficient ${selectedPaymentAsset} for swap. Need ~${deficitInPaymentAsset.toFixed(selectedPaymentAsset === 'USDC' ? 2 : 4)} more ${selectedPaymentAsset}`,
                    balanceInfo: { 
                        balance: paymentBalanceNum, 
                        required: `~${(requiredUSDWithBuffer / convertToDollarValue(1, selectedPaymentAsset)).toFixed(selectedPaymentAsset === 'USDC' ? 2 : 4)}`, 
                        asset: selectedPaymentAsset 
                    }
                };
            }
        }
    } catch (error) {
        console.error("Error checking sufficient funds:", error);
        // On error, don't disable the trade button - let the wallet handle the rejection
        return { sufficient: true, reason: "Error checking balance - will verify on transaction" };
    }
}

/**
 * Simple function to toggle button readiness
 */
function toggleButtonReadiness(ready, message = 'TRADE NOW') {
    const tradeButton = $('#trade-now-btn');
    const tradeButtonAdv = $('#adv-trade-btn');
    
    if (ready) {
        tradeButton.prop('disabled', false)
                  .removeClass('btn-secondary btn-warning')
                  .addClass('btn-primary')
                  .text(message);
                  
        tradeButtonAdv.prop('disabled', false)
                     .removeClass('btn-secondary btn-warning') 
                     .addClass('btn-primary')
                     .text(message);
    } else {
        tradeButton.prop('disabled', true)
                  .removeClass('btn-primary')
                  .addClass('btn-secondary')
                  .text(message);
                  
        tradeButtonAdv.prop('disabled', true)
                     .removeClass('btn-primary')
                     .addClass('btn-secondary')
                     .text(message);
    }
}

/**
 * Show swap loading warning message
 */
function showSwapLoadingWarning(reason = 'Calculating optimal swap route and pricing. This usually takes a few seconds.') {
    let warningDiv = $('#swap-loading-warning');
    if (warningDiv.length === 0) {
        warningDiv = $(`
            <div id="swap-loading-warning" class="alert alert-info mt-3" role="alert">
                <i class="bi bi-clock-fill me-2"></i>
                <span id="swap-loading-message">Preparing swap data...</span>
                <div class="mt-2 small" id="swap-loading-details"></div>
            </div>
        `);
        // Insert after the trade button
        $('#trade-now-btn').parent().after(warningDiv);
    }
    
    $('#swap-loading-message').text('Preparing swap data...');
    $('#swap-loading-details').text(reason);
    warningDiv.show();
}

/**
 * Hide swap loading warning message
 */
function hideSwapLoadingWarning() {
    $('#swap-loading-warning').hide();
}

/**
 * Update the trade button state based on fund availability only
 * (Swap readiness is handled directly by kyber functions)
 */
async function updateTradeButtonState() {
    // Safety check: don't run if app isn't loaded yet
    if (!state || state.selectedOrderIndex === null || !state.orders || state.orders.length === 0) {
        // App not ready yet, keep button in loading state
        return;
    }
    
    const fundCheck = await checkSufficientFunds();
    
    if (fundCheck.sufficient) {
        // Enable button and restore normal text (if not disabled by swap loading)
        // Only update if buttons are not in swap loading state
        if (!$('#trade-now-btn').text().includes('LOADING')) {
            toggleButtonReadiness(true, 'TRADE NOW');
        }
        
        // Hide insufficient funds warning
        $('#insufficient-funds-warning').hide();
    } else {
        // Disable button and show insufficient funds message
        toggleButtonReadiness(false, 'INSUFFICIENT FUNDS');
        
        // Show warning message if it doesn't exist, create it
        let warningDiv = $('#insufficient-funds-warning');
        if (warningDiv.length === 0) {
            warningDiv = $(`
                <div id="insufficient-funds-warning" class="alert alert-warning mt-3" role="alert">
                    <i class="bi bi-exclamation-triangle-fill me-2"></i>
                    <span id="insufficient-funds-message">Insufficient funds</span>
                    <div class="mt-2 small" id="balance-details"></div>
                </div>
            `);
            // Insert after the trade button
            $('#trade-now-btn').parent().after(warningDiv);
        }
        
        // Update the warning message
        $('#insufficient-funds-message').text(fundCheck.reason);
        
        // Add balance details if available
        if (fundCheck.balanceInfo) {
            const balanceDetails = `
                Your balance: ${fundCheck.balanceInfo.balance.toFixed(fundCheck.balanceInfo.asset === 'USDC' ? 2 : 4)} ${fundCheck.balanceInfo.asset}<br>
                Required: ${fundCheck.balanceInfo.required} ${fundCheck.balanceInfo.asset}
            `;
            $('#balance-details').html(balanceDetails);
        }
        
        warningDiv.show();
    }
}

/**
 * Refresh fund status - called whenever balances or trade parameters might have changed
 * Debounced to prevent multiple simultaneous RPC calls
 */
let refreshFundStatusTimer = null;

async function refreshFundStatus() {
    // Clear any existing timer to debounce rapid calls
    if (refreshFundStatusTimer) {
        clearTimeout(refreshFundStatusTimer);
    }
    
    // Set a new timer to execute after a short delay
    refreshFundStatusTimer = setTimeout(async () => {
        try {
            // Only check if wallet is connected
            if (!state.connectedAddress) {
                return;
            }
            
            // Only check if an option is selected
            if (state.selectedOrderIndex === null) {
                return;
            }
            
            await updateTradeButtonState();
        } catch (error) {
            console.error("Error in debounced refreshFundStatus:", error);
        } finally {
            refreshFundStatusTimer = null;
        }
    }, 100); // 100ms debounce delay
}

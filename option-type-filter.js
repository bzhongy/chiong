// Option Type Filter Module
// Handles filtering of options by type (ALL, PUTS, CALLS)

// Store the current filter state
let optionTypeFilter = 'all'; // 'all', 'puts', 'calls'

// Initialize the option type filter functionality
function initializeOptionTypeFilter() {
    console.log('Initializing option type filter...');
    
    // Add event listeners to filter buttons
    $('input[name="option-type-filter"]').on('change', function() {
        const selectedFilter = $(this).val();
        handleOptionTypeFilterChange(selectedFilter);
    });
    
    // Initialize with default filter
    updateFilterDescription('all');
    
    // Set up mutation observer to watch for style changes on conviction slider
    setupConvictionSliderStyleWatcher();
}

// Watch for when the conviction slider styles might be overridden
function setupConvictionSliderStyleWatcher() {
    const sliderContainer = document.querySelector('.conviction-slider-container');
    if (!sliderContainer) return;
    
    // Set up a MutationObserver to watch for changes
    const observer = new MutationObserver((mutations) => {
        let shouldReapplyStyles = false;
        
        mutations.forEach((mutation) => {
            // If the slider itself is modified or replaced
            if (mutation.type === 'childList') {
                const addedNodes = Array.from(mutation.addedNodes);
                if (addedNodes.some(node => node.classList && node.classList.contains('form-range'))) {
                    shouldReapplyStyles = true;
                }
            }
            // If attributes (like class) are modified
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                shouldReapplyStyles = true;
            }
        });
        
        if (shouldReapplyStyles) {
            console.log('Detected slider style changes, reapplying filter styles...');
            setTimeout(() => {
                updateFilterDescription(optionTypeFilter);
            }, 50);
        }
    });
    
    // Watch the container and its children
    observer.observe(sliderContainer, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style']
    });
    
    // Also set up periodic reapplication as backup
    setInterval(() => {
        const container = $('.conviction-slider-container');
        if (optionTypeFilter !== 'all' && !container.hasClass(optionTypeFilter + '-mode')) {
            console.log('Periodic check: reapplying filter styles...');
            updateFilterDescription(optionTypeFilter);
        }
    }, 2000);
}

// Handle option type filter changes
function handleOptionTypeFilterChange(filterType) {
    console.log(`Option filter changed to: ${filterType}`);
    optionTypeFilter = filterType;
    
    // Update the description text
    updateFilterDescription(filterType);
    
    // Update the conviction slider based on filtered options
    setupConvictionSliderWithFilter();
    
    // Update the options table if in advanced view
    if (state.viewMode === 'advanced') {
        populateOptionsTableWithFilter();
    }
    
    // Refresh analytics levels to match filtered strikes
    if (window.analyticsManager) {
        window.analyticsManager.updateLevelOverlays();
    }
    
    // Update the current selection based on filter
    selectOptionBasedOnConviction();
}

// Update the description text based on selected filter
function updateFilterDescription(filterType) {
    const descriptions = {
        'all': 'Showing all options',
        'puts': 'PUT options only',
        'calls': 'CALL options only'
    };
    
    $('#filter-description').text(descriptions[filterType]);
    
    // Update conviction slider colors and behavior
    const sliderContainer = $('.conviction-slider-container');
    sliderContainer.removeClass('filter-mode puts-mode calls-mode');
    
    console.log(`Updating filter to: ${filterType}`); // Debug log
    
    if (filterType === 'puts') {
        sliderContainer.addClass('puts-mode');
        console.log('Added puts-mode class'); // Debug log
    } else if (filterType === 'calls') {
        sliderContainer.addClass('calls-mode');
        console.log('Added calls-mode class'); // Debug log
    }
    
    // Force a repaint to ensure styles are applied
    setTimeout(() => {
        const slider = $('#conviction-slider, #adv-conviction-slider');
        if (slider.length) {
            slider.hide().show(0);
            console.log(`Classes on container: ${sliderContainer.attr('class')}`); // Debug log
        }
    }, 50);
    
    // Show/hide appropriate labels
    $('.conviction-labels .bearish-label, .conviction-labels .bullish-label').show();
}

// Get filtered orders based on current filter
function getFilteredOrders() {
    if (!state.orders || state.orders.length === 0) return [];
    
    switch (optionTypeFilter) {
        case 'puts':
            return state.orders.filter(orderWrapper => !orderWrapper.order.isCall);
        case 'calls':
            return state.orders.filter(orderWrapper => orderWrapper.order.isCall);
        case 'all':
        default:
            return state.orders;
    }
}

// Modified setupConvictionSlider that respects the filter
function setupConvictionSliderWithFilter() {
    // Get filtered orders instead of all orders
    const filteredOrders = getFilteredOrders();
    
    if (!filteredOrders || filteredOrders.length === 0) {
        console.warn('No orders available for current filter');
        // Show empty state message
        updateDualUI('current-target', 'No options available');
        return;
    }
    
    // Extract all strikes for the filtered orders and sort them
    const strikes = filteredOrders.map(orderWrapper => {
        return parseFloat(formatUnits(orderWrapper.order.strikes[0], PRICE_DECIMALS));
    }).sort((a, b) => a - b);
    
    // Remove duplicates if any
    const uniqueStrikes = [...new Set(strikes)];
    
    // Need at least one strike
    if (uniqueStrikes.length === 0) return;
    
    // Generate equidistant slider tick positions based on number of strikes
    state.sliderTicks = [];
    state.priceTicks = [];
    
    // Use filtered strikes
    state.priceTicks = uniqueStrikes;
    
    // Create evenly spaced slider ticks based on number of strikes
    const numStrikes = uniqueStrikes.length;
    for (let i = 0; i < numStrikes; i++) {
        const tickPosition = Math.round((i / (numStrikes - 1)) * 100);
        state.sliderTicks.push(tickPosition);
    }
    
    // Update datalist for slider
    $('#conviction-datalist, #adv-conviction-datalist').empty();
    state.sliderTicks.forEach(tick => {
        $('#conviction-datalist, #adv-conviction-datalist').append(`<option value="${tick}"></option>`);
    });
    
    // Update the price target labels with filtered strikes
    updateDualUI('low-price', `$${formatNumber(uniqueStrikes[0])}`);
    updateDualUI('high-price', `$${formatNumber(uniqueStrikes[uniqueStrikes.length - 1])}`);
    
    // Determine initial slider index
    let initialSliderIndex = Math.floor(uniqueStrikes.length / 2); // Default to middle
    let initialSliderTickValue = state.sliderTicks[initialSliderIndex] || 50;
    
    // If we have a previously selected strike, try to maintain it (if it exists in filtered results)
    if (lastSelectedStrike !== null) {
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
    
    // Maintain slider position if previously set
    if (lastSelectedSliderPosition !== null) {
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

// Modified populateOptionsTable that respects the filter
function populateOptionsTableWithFilter() {
    const tableBody = $('#options-table-body');
    tableBody.empty();
    
    const filteredOrders = getFilteredOrders();
    
    if (filteredOrders.length === 0) {
        const filterName = optionTypeFilter.toUpperCase();
        tableBody.append(`
            <tr>
                <td colspan="9" class="text-center text-muted">
                    No ${filterName === 'ALL' ? '' : filterName} options available for ${state.selectedAsset}
                </td>
            </tr>
        `);
        return;
    }
    
    // Sort filtered orders by expiry time (earliest first)
    const sortedFilteredOrders = [...filteredOrders].sort((a, b) => {
        const expiryA = parseInt(a.order.expiry) || 0;
        const expiryB = parseInt(b.order.expiry) || 0;
        return expiryA - expiryB; // Ascending order (earliest first)
    });
    
    for (let i = 0; i < sortedFilteredOrders.length; i++) {
        const orderWrapper = sortedFilteredOrders[i];
        const order = orderWrapper.order;
        const optionType = order.isCall ? "CALL" : "PUT";
        const collateral = CONFIG.getCollateralDetails(order.collateral);
        const strike = formatUnits(order.strikes[0], PRICE_DECIMALS);
        
        // Format premium using centralized calculator
        const premium = parseFloat(formatUnits(order.price, PRICE_DECIMALS));
        
        // Calculate payout ratio with centralized calculator
        const payoutRatio = optionCalculator.calculateLeverage(premium, order, collateral);
        
        // Calculate breakeven using centralized calculator
        const breakeven = optionCalculator.calculateBreakeven(order.isCall, parseFloat(strike), premium).toFixed(2);
        
        // Calculate Greeks
        const { theta, delta, iv } = orderWrapper.greeks;
        
        // Find the original index in state.orders for selection
        const originalIndex = state.orders.findIndex(originalOrderWrapper => 
            originalOrderWrapper.order.strikes[0] === order.strikes[0] && 
            originalOrderWrapper.order.isCall === order.isCall
        );
        
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
        }
        
        const row = `
            <tr class="option-row ${originalIndex === state.selectedOrderIndex ? 'selected' : ''}" data-index="${originalIndex}">
                <td>$${formatNumber(strike)}</td>
                <td><span class="badge ${order.isCall ? 'bg-success' : 'bg-danger'}">${optionType}</span></td>
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

// Modified selectOptionBasedOnConviction that respects the filter
async function selectOptionBasedOnConvictionWithFilter(updatePaymentAsset = false) {
    // Get slider value from the visible slider
    let sliderValue;
    if ($('#advanced-view-container').is(':visible')) {
        sliderValue = parseInt($('#adv-conviction-slider').val());
    } else {
        sliderValue = parseInt($('#conviction-slider').val());
    }
    
    const filteredOrders = getFilteredOrders();
    
    if (!filteredOrders || filteredOrders.length === 0 || !state.sliderTicks || state.sliderTicks.length === 0) {
        console.warn('No filtered orders available for selection');
        return;
    }
    
    // Find which tick position this corresponds to
    const tickIndex = state.sliderTicks.indexOf(sliderValue);
    if (tickIndex === -1) return;
    
    // Get the target price from the price ticks
    const targetPrice = state.priceTicks[tickIndex];
    if (!targetPrice) return;
    
    // Find the nearest option to the target price within filtered orders
    const extractStrike = orderWrapper => parseFloat(formatUnits(orderWrapper.order.strikes[0], PRICE_DECIMALS));
    const bestFilteredOrderIndex = findNearestOption(targetPrice, filteredOrders, extractStrike);
    
    if (bestFilteredOrderIndex !== null) {
        // Find the corresponding original index in state.orders
        const selectedFilteredOrder = filteredOrders[bestFilteredOrderIndex];
        const originalIndex = state.orders.findIndex(orderWrapper => 
            orderWrapper.order.strikes[0] === selectedFilteredOrder.order.strikes[0] && 
            orderWrapper.order.isCall === selectedFilteredOrder.order.isCall
        );
        
        if (originalIndex !== -1) {
            await selectOption(originalIndex);
        }
    }
    
    // Handle initialization case - no longer needed with button-based selection
    
    // Update position size display with contracts
    setTimeout(updatePositionSizeWithContracts, 200);
}

// Override the original functions when filter is active
function integrateWithExistingCode() {
    // Store original functions
    const originalSetupConvictionSlider = window.setupConvictionSlider;
    const originalPopulateOptionsTable = window.populateOptionsTable;
    const originalSelectOptionBasedOnConviction = window.selectOptionBasedOnConviction;
    
    // Override with filter-aware versions
    window.setupConvictionSlider = function() {
        const result = optionTypeFilter === 'all' ? 
            originalSetupConvictionSlider.call(this) : 
            setupConvictionSliderWithFilter();
        
        // Always reapply filter classes after setup
        setTimeout(() => {
            updateFilterDescription(optionTypeFilter);
        }, 100);
        
        return result;
    };
    
    window.populateOptionsTable = function() {
        if (optionTypeFilter === 'all') {
            return originalPopulateOptionsTable.call(this);
        } else {
            return populateOptionsTableWithFilter();
        }
    };
    
    window.selectOptionBasedOnConviction = function(updatePaymentAsset = false) {
        const result = optionTypeFilter === 'all' ? 
            originalSelectOptionBasedOnConviction.call(this, updatePaymentAsset) : 
            selectOptionBasedOnConvictionWithFilter(updatePaymentAsset);
        
        // Reapply filter classes after selection
        setTimeout(() => {
            updateFilterDescription(optionTypeFilter);
        }, 50);
        
        return result;
    };
}

// Enhanced position size display with contract information and USD value
function updatePositionSizeWithContracts() {
    const orderIndex = state.selectedOrderIndex;
    if (orderIndex === null || !state.orders || state.orders.length === 0) return;
    
    const order = state.orders[orderIndex].order;
    const collateral = CONFIG.getCollateralDetails(order.collateral);
    const percentage = state.selectedPositionPercentage || 50;
    
    // Calculate position details
    const { positionCost, selectedContracts } = optionCalculator.calculatePositionDetails(
        order, collateral, percentage
    );
    
    // Determine option type
    const optionType = order.isCall ? "CALL" : "PUT";
    
    // Format the native amount
    const formattedCost = positionCost.toFixed(collateral.decimals === 6 ? 2 : 4);
    const contractsFormatted = selectedContracts.toFixed(4);
    
    // Calculate USD equivalent using existing conversion function
    let usdValue = 0;
    if (typeof convertToDollarValue === 'function') {
        usdValue = convertToDollarValue(positionCost, collateral.asset);
    } else {
        // Fallback USD conversion if function not available
        switch (collateral.asset) {
            case 'USDC':
                usdValue = positionCost;
                break;
            case 'WETH':
                usdValue = positionCost * (state.market_prices?.['ETH'] || 2500);
                break;
            case 'CBBTC':
                usdValue = positionCost * (state.market_prices?.['BTC'] || 50000);
                break;
            default:
                usdValue = 0;
        }
    }
    
    // Format USD value
    const formattedUsdValue = usdValue > 0 ? `$${usdValue.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}` : '';
    
    // Update the display to show native amount with combined USD and contract info
    const sizeDisplay = document.getElementById('current-size');
    if (sizeDisplay) {
        let displayText = `${formattedCost} ${collateral.asset}`;
        
        // Combine USD equivalent and contract info in one set of parentheses
        let combinedInfo = '';
        
        // Add USD value if available and different from native (i.e., not USDC)
        if (formattedUsdValue && collateral.asset !== 'USDC') {
            combinedInfo = `${formattedUsdValue}, ${contractsFormatted}x ${optionType}`;
        } else {
            // For USDC, just show contracts since USD value is redundant
            combinedInfo = `${contractsFormatted}x ${optionType}`;
        }
        
        displayText += ` <span class="combined-info">(${combinedInfo})</span>`;
        
        sizeDisplay.innerHTML = displayText;
    }
}

// Override the original position size functions to include contracts
function integratePositionSizeDisplay() {
    // Store original functions
    const originalUpdatePositionSize = window.updatePositionSize;
    const originalCalculateAndUpdatePositionCost = window.calculateAndUpdatePositionCost;
    
    // Override updatePositionSize
    if (originalUpdatePositionSize) {
        window.updatePositionSize = function() {
            // Call original function first
            originalUpdatePositionSize.call(this);
            // Then add our contract display
            updatePositionSizeWithContracts();
        };
    }
    
    // Override calculateAndUpdatePositionCost
    if (originalCalculateAndUpdatePositionCost) {
        window.calculateAndUpdatePositionCost = function(order, collateral, percentage) {
            // Call original function first
            const result = originalCalculateAndUpdatePositionCost.call(this, order, collateral, percentage);
            // Then add our contract display
            updatePositionSizeWithContracts();
            return result;
        };
    }
    
    // Also listen for position size slider changes
    $(document).on('input', '#position-size-slider, #adv-position-size-slider', function() {
        setTimeout(updatePositionSizeWithContracts, 100);
    });
}

// Initialize when DOM is ready
$(document).ready(function() {
    // Wait a bit for other modules to load
    setTimeout(() => {
        initializeOptionTypeFilter();
        integrateWithExistingCode();
        integratePositionSizeDisplay();
        console.log('Option type filter initialized successfully');
    }, 1000);
});

// Expose functions for external use
window.optionTypeFilter = {
    getCurrentFilter: () => optionTypeFilter,
    setFilter: handleOptionTypeFilterChange,
    getFilteredOrders: getFilteredOrders,
    updatePositionSizeWithContracts: updatePositionSizeWithContracts
}; 
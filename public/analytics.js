/**
 * Analytics Integration for Chiong.fi
 * Handles market analytics data fetching, visualization, and UI updates
 */

class AnalyticsManager {
    constructor() {
        this.analyticsApiUrl = 'https://orange-band-e454.devops-118.workers.dev/analytics';
        this.currentAsset = 'ETH';
        this.analyticsData = null;
        this.chartExpanded = false;
        this.analyticsCollapsed = false;
        this.tradingViewWidget = null;
        this.refreshInterval = null;
        this.shouldInitializeChartOnDataLoad = false;
        
        // Level type mappings for styling
        this.levelTypes = {
            'Put Support': 'support',
            'Put Support 0DTE': 'support',
            'Put Support 1W': 'support', 
            'Put Support 1M': 'support',
            'Put Flow Support': 'support',
            'Call Resistance': 'resistance',
            'Call Resistance 0DTE': 'resistance',
            'Call Resistance 1W': 'resistance',
            'Call Resistance 1M': 'resistance',
            'Call Flow Resistance': 'resistance',
            'Gamma Wall (Short Gamma)': 'gamma-wall',
            'Gamma Wall (Long Gamma)': 'gamma-wall',
            'HVL': 'gamma-wall',
            'HVS': 'gamma-wall',
            'Max Pain Flow': 'gamma-wall',
            'VWAS': 'gamma-wall'
        };
        
        // Level descriptions for tooltips
        this.levelDescriptions = {
            'Put Support 0DTE': 'High open interest put strikes for today\'s expiration - often act as support levels',
            'Call Resistance 0DTE': 'High open interest call strikes for today\'s expiration - often act as resistance levels',
            'Put Support': 'Current weekly/monthly put support based on open interest',
            'Call Resistance': 'Current weekly/monthly call resistance based on open interest',
            'Gamma Wall (Short Gamma)': 'Strike where dealers are short gamma - amplifies price volatility as dealers chase the move',
            'Gamma Wall (Long Gamma)': 'Strike where dealers are long gamma - can create volatility dampening',
            'HVL': 'High Volume Level from recent futures trading activity',
            'HVS': 'Highest Volume Strike from recent options flow',
            'Max Pain Flow': 'Strike with balanced call/put flow - potential equilibrium level',
            'Put Flow Support': 'Support level based on recent put buying activity',
            'Call Flow Resistance': 'Resistance level based on recent call buying activity',
            'VWAS': 'Volume Weighted Average Strike from recent options activity',
            '1D Max': '24-hour high price level',
            '1D Min': '24-hour low price level'
        };
        
        this.initialize();
    }
    
    initialize() {
        this.setupEventListeners();
        this.startPeriodicRefresh();
        
        // Check if chart should be expanded from saved state
        this.checkInitialChartState();
    }
    
    checkInitialChartState() {
        // Delay to allow UI state manager to finish initialization
        setTimeout(() => {
            const chartSection = document.getElementById('analytics-chart-section');
            const toggleBtn = document.getElementById('toggle-analytics-view');
            
            if (chartSection && toggleBtn && chartSection.style.display === 'block') {
                this.chartExpanded = true;
                
                // Initialize chart if we have analytics data, otherwise wait for first data load
                if (this.analyticsData) {
                    this.initializeTradingViewChart();
                    this.updateLevelsLegend();
                } else {
                    // Set flag to initialize chart when data arrives
                    this.shouldInitializeChartOnDataLoad = true;
                }
            }
        }, 1000);
    }
    
    setupEventListeners() {
        // Refresh button
        const refreshBtn = document.getElementById('refresh-analytics');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshAnalytics(true));
        }
        
        // Toggle chart view button
        const toggleBtn = document.getElementById('toggle-analytics-view');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggleChartView());
        }
        
        // Toggle analytics section button
        const toggleSectionBtn = document.getElementById('toggle-analytics-section');
        if (toggleSectionBtn) {
            toggleSectionBtn.addEventListener('click', () => this.toggleAnalyticsSection());
        }
        
        // Initialize tooltips for ratio dials
        this.initializeDialTooltips();
        
        // Listen for asset dropdown changes - improved integration
        const assetDropdown = document.getElementById('assetDropdown');
        if (assetDropdown) {
            // Listen to the parent dropdown container
            assetDropdown.parentElement.addEventListener('click', (event) => {
                if (event.target.hasAttribute('data-asset')) {
                    const newAsset = event.target.getAttribute('data-asset');
                    if (newAsset !== this.currentAsset) {
                        console.log(`Asset changed: ${this.currentAsset} → ${newAsset}`);
                        this.currentAsset = newAsset;
                        // Delay to allow UI to update first
                        setTimeout(() => this.refreshAnalytics(), 100);
                    }
                }
            });
        }
        
        // Also listen for direct changes to the selected asset text (fallback)
        const selectedAssetElement = document.getElementById('selected-asset');
        if (selectedAssetElement) {
            const observer = new MutationObserver(() => {
                const newAsset = selectedAssetElement.textContent.trim();
                if (newAsset && newAsset !== this.currentAsset) {
                    this.currentAsset = newAsset;
                    setTimeout(() => this.refreshAnalytics(), 100);
                }
            });
            
            observer.observe(selectedAssetElement, { 
                childList: true, 
                subtree: true, 
                characterData: true 
            });
            
            this.assetObserver = observer;
        }
        
        // Listen for price target changes to update level overlays
        const convictionSlider = document.getElementById('conviction-slider');
        if (convictionSlider) {
            convictionSlider.addEventListener('input', () => {
                // Debounce the overlay updates
                clearTimeout(this.overlayUpdateTimeout);
                this.overlayUpdateTimeout = setTimeout(() => {
                    this.updateLevelOverlays();
                }, 100);
            });
        }
        
        // Monitor for changes in price target displays (low/high price)
        this.observePriceTargetChanges();
        
        // Sync price range labels with conviction slider
        this.syncPriceRangeLabels();
    }
    
    initializeDialTooltips() {
        // Initialize Bootstrap tooltips if available
        if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
            const dialElements = document.querySelectorAll('.ratio-dial[title]');
            dialElements.forEach(element => {
                new bootstrap.Tooltip(element, {
                    placement: 'bottom',
                    trigger: 'hover',
                    delay: { show: 300, hide: 100 }
                });
            });
        }
    }
    
    observePriceTargetChanges() {
        // Use MutationObserver to watch for price target changes
        const lowPriceElement = document.getElementById('low-price');
        const highPriceElement = document.getElementById('high-price');
        
        if (lowPriceElement && highPriceElement) {
            const observer = new MutationObserver(() => {
                clearTimeout(this.overlayUpdateTimeout);
                this.overlayUpdateTimeout = setTimeout(() => {
                    this.updateLevelOverlays();
                }, 200);
            });
            
            observer.observe(lowPriceElement, { 
                childList: true, 
                subtree: true, 
                characterData: true 
            });
            
            observer.observe(highPriceElement, { 
                childList: true, 
                subtree: true, 
                characterData: true 
            });
            
            this.priceObserver = observer;
        }
    }
    
    syncPriceRangeLabels() {
        // Update the Support/Resistance section price labels to match conviction slider
        const updateLabels = () => {
            const lowPriceElement = document.getElementById('low-price');
            const highPriceElement = document.getElementById('high-price');
            const rangeLowDisplay = document.getElementById('range-low-display');
            const rangeHighDisplay = document.getElementById('range-high-display');
            
            if (lowPriceElement && highPriceElement && rangeLowDisplay && rangeHighDisplay) {
                rangeLowDisplay.textContent = lowPriceElement.textContent;
                rangeHighDisplay.textContent = highPriceElement.textContent;
            }
        };
        
        // Initial sync
        updateLabels();
        
        // Listen for conviction slider changes to update labels
        const convictionSlider = document.getElementById('conviction-slider');
        if (convictionSlider) {
            convictionSlider.addEventListener('input', updateLabels);
        }
        
        // Also observe price target changes
        const lowPriceElement = document.getElementById('low-price');
        const highPriceElement = document.getElementById('high-price');
        
        if (lowPriceElement && highPriceElement) {
            const observer = new MutationObserver(updateLabels);
            
            observer.observe(lowPriceElement, { 
                childList: true, 
                subtree: true, 
                characterData: true 
            });
            
            observer.observe(highPriceElement, { 
                childList: true, 
                subtree: true, 
                characterData: true 
            });
            
            this.priceRangeLabelObserver = observer;
        }
    }
    
    startPeriodicRefresh() {
        // Refresh analytics every 5 minutes
        this.refreshInterval = setInterval(() => {
            this.refreshAnalytics();
        }, 5 * 60 * 1000);
        
        // Initial load
        this.refreshAnalytics();
    }
    
    async refreshAnalytics(force = false) {
        const statusElement = document.getElementById('analytics-status');
        if (statusElement) {
            statusElement.innerHTML = '<small class="text-muted"><i class="bi bi-arrow-clockwise"></i> Refreshing analytics...</small>';
        }
        
        try {
            const url = `${this.analyticsApiUrl}?currency=${this.currentAsset}${force ? '&refresh=true' : ''}`;
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`Analytics API error: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                this.analyticsData = data.data;
                this.updateAnalyticsUI();
                
                if (statusElement) {
                    const cacheInfo = data.data.metadata.cache_info || {};
                    const timestamp = data.timestamp || new Date().toISOString();
                    const lastUpdate = new Date(timestamp).toLocaleTimeString();
                    statusElement.innerHTML = `<small class="text-muted">Last updated: ${lastUpdate} | Cache: ${cacheInfo.local_cache_size || 0} items</small>`;
                }
            } else {
                throw new Error(data.error || 'Unknown API error');
            }
            
        } catch (error) {
            console.error('Failed to fetch analytics:', error);
            
            if (statusElement) {
                statusElement.innerHTML = `<div class="analytics-error">Failed to load analytics: ${error.message}</div>`;
            }
        }
    }
    
    updateAnalyticsUI() {
        if (!this.analyticsData) return;
        
        // Update put/call ratio dials
        this.updatePutCallRatioDials();
        
        // Update level overlays on the price slider
        this.updateLevelOverlays();
        
        // Update levels legend (if chart is expanded)
        if (this.chartExpanded) {
            this.updateLevelsLegend();
        }
        
        // Initialize chart if flagged from saved state restoration
        if (this.shouldInitializeChartOnDataLoad) {
            this.initializeTradingViewChart();
            this.updateLevelsLegend();
            this.shouldInitializeChartOnDataLoad = false; // Clear the flag
        }
        
        // Update TradingView chart if active
        if (this.tradingViewWidget) {
            this.updateTradingViewChart();
        }
    }
    
    updatePutCallRatioDials() {
        const ratios = this.analyticsData.metadata.put_call_ratios || {};
        
        // Map API keys to UI keys
        const dialMappings = {
            'overall': ratios.Current || 0,
            '0dte': ratios['0DTE'] || 0,
            '1w': ratios['1W'] || 0,
            '1m': ratios['1M'] || 0
        };
        
        Object.entries(dialMappings).forEach(([key, ratio]) => {
            this.updateDial(key, ratio);
        });
    }
    
    updateDial(dialId, ratio) {
        const dialNeedle = document.getElementById(`dial-${dialId}`);
        const dialValue = document.getElementById(`ratio-${dialId}-inline`);
        
        if (!dialNeedle || !dialValue) return;
        
        // Calculate rotation angle for semicircle from 9 to 3 o'clock
        // -90 degrees = 9 o'clock (very bearish, high P/C)
        // -30 degrees = 11 o'clock (bearish to neutral)
        // 0 degrees = 12 o'clock (center neutral)
        // +30 degrees = 1 o'clock (neutral to bullish) 
        // +90 degrees = 3 o'clock (very bullish, low P/C)
        
        let angle = 0; // Default to 12 o'clock (center neutral)
        
        if (ratio > 0) {
            if (ratio > 1.2) {
                // Bearish zone: 9 to 11 o'clock (-90 to -30 degrees)
                // Map high ratios (1.2+ to 3.0+) to -30 to -90 degrees
                const bearishBase = Math.min(3.0, ratio); // Cap normal mapping at 3.0
                const bearishProgress = (bearishBase - 1.2) / 1.8; // 1.8 is the range (3.0 - 1.2)
                angle = -30 - (bearishProgress * 60); // 60 degree range (-30 to -90)
                
                // For extremely high ratios (>3.0), max out at 9 o'clock
                if (ratio > 3.0) {
                    angle = -90; // 9 o'clock
                }
            } else if (ratio >= 0.8) {
                // Neutral zone: 11 to 1 o'clock (-30 to +30 degrees)  
                // Map 0.8-1.2 to -30 to +30 degrees
                const neutralProgress = (ratio - 0.8) / 0.4; // 0.4 is the range (1.2 - 0.8)
                angle = -30 + (neutralProgress * 60); // 60 degree range (-30 to +30)
            } else {
                // Bullish zone: 1 to 3 o'clock (+30 to +90 degrees)
                // Map low ratios (0.0-0.8) to +30 to +90 degrees
                const bullishRange = Math.max(0.0, Math.min(0.8, ratio));
                const bullishProgress = 1 - (bullishRange / 0.8); // Invert: lower ratio = more bullish
                angle = 30 + (bullishProgress * 60); // 60 degree range (+30 to +90)
            }
        }
        
        // Apply rotation
        dialNeedle.style.transform = `translate(-50%, -100%) rotate(${angle}deg)`;
        
        // Update value display with parentheses
        dialValue.textContent = ratio > 0 ? `(${ratio.toFixed(2)})` : '(--)';
        
        // Update color based on sentiment with corrected thresholds
        if (ratio > 0) {
            if (ratio > 1.2) {
                dialValue.style.color = 'var(--negative)'; // Bearish
            } else if (ratio >= 0.8) {
                dialValue.style.color = 'var(--accent)'; // Neutral
            } else {
                dialValue.style.color = 'var(--positive)'; // Bullish
            }
        } else {
            dialValue.style.color = 'var(--text-secondary)';
        }
    }
    
    updateLevelOverlays() {
        if (!this.analyticsData) return;
        
        const overlay = document.getElementById('analytics-levels-overlay');
        const lowPriceElement = document.getElementById('low-price');
        const highPriceElement = document.getElementById('high-price');
        
        if (!overlay || !lowPriceElement || !highPriceElement) return;
        
        // Get current price range from the slider
        const lowPriceText = lowPriceElement.textContent.replace('$', '').replace(',', '');
        const highPriceText = highPriceElement.textContent.replace('$', '').replace(',', '');
        const lowPrice = parseFloat(lowPriceText);
        const highPrice = parseFloat(highPriceText);
        
        if (!lowPrice || !highPrice || lowPrice >= highPrice) {
            return;
        }
        
        // Clear existing overlays
        overlay.innerHTML = '';
        
        // Filter levels that fall within the current price range
        const relevantLevels = this.analyticsData.key_levels.filter(level => {
            const withinRange = level.value >= lowPrice && level.value <= highPrice;
            return withinRange;
        });
        
        // If no levels in range, show the closest ones for context
        if (relevantLevels.length === 0) {
            // Find levels close to the range (within 20% of range width)
            const rangeWidth = highPrice - lowPrice;
            const extendedLow = lowPrice - (rangeWidth * 0.5);
            const extendedHigh = highPrice + (rangeWidth * 0.5);
            
            const nearbyLevels = this.analyticsData.key_levels.filter(level => {
                return level.value >= extendedLow && level.value <= extendedHigh;
            });
            
            if (nearbyLevels.length > 0) {
                // Sort by distance from price range and take top 3
                nearbyLevels.sort((a, b) => {
                    const distA = Math.min(Math.abs(a.value - lowPrice), Math.abs(a.value - highPrice));
                    const distB = Math.min(Math.abs(b.value - lowPrice), Math.abs(b.value - highPrice));
                    return distA - distB;
                });
                
                const topNearby = nearbyLevels.slice(0, 3);
                
                // Create indicators for nearby levels (positioned at edges)
                topNearby.forEach(level => {
                    const indicator = this.createNearbyLevelIndicator(level, lowPrice, highPrice);
                    overlay.appendChild(indicator);
                });
                
                return;
            }
        }
        
        // Consolidate levels at the same price
        const consolidatedLevels = new Map();
        
        relevantLevels.forEach(level => {
            const priceKey = Math.round(level.value);
            if (consolidatedLevels.has(priceKey)) {
                const existing = consolidatedLevels.get(priceKey);
                // Combine names and use highest confidence
                existing.names.push(level.name);
                existing.confidence = Math.max(existing.confidence, level.confidence);
                existing.combinedLevel = true;
            } else {
                consolidatedLevels.set(priceKey, {
                    value: level.value,
                    names: [level.name],
                    distance_to_spot: level.distance_to_spot,
                    confidence: level.confidence,
                    combinedLevel: false
                });
            }
        });
        
        // Sort consolidated levels by confidence and show all
        const finalLevels = Array.from(consolidatedLevels.values())
            .sort((a, b) => b.confidence - a.confidence);
        
        // Create level markers
        finalLevels.forEach(level => {
            const marker = this.createConsolidatedLevelMarker(level, lowPrice, highPrice);
            overlay.appendChild(marker);
        });
    }
    
    createLevelMarker(level, lowPrice, highPrice) {
        const marker = document.createElement('div');
        marker.className = `level-marker ${this.getLevelType(level.name)}`;
        marker.setAttribute('data-level-name', level.name);
        marker.setAttribute('data-level-price', `$${level.value.toLocaleString()}`);
        marker.setAttribute('data-level-description', this.levelDescriptions[level.name] || 'Market level');
        
        // Calculate horizontal position (0% = lowPrice, 100% = highPrice)
        const position = ((level.value - lowPrice) / (highPrice - lowPrice)) * 100;
        marker.style.left = `${position}%`;
        marker.style.top = '0';
        
        // Add hover tooltip functionality
        marker.addEventListener('mouseenter', (e) => {
            this.showLevelTooltip(e, level);
        });
        
        marker.addEventListener('mouseleave', () => {
            this.hideLevelTooltip();
        });
        
        return marker;
    }
    
    createConsolidatedLevelMarker(level, lowPrice, highPrice) {
        const marker = document.createElement('div');
        
        // Use the type of the first level name for styling
        const firstLevelType = this.getLevelType(level.names[0]);
        marker.className = `level-marker ${firstLevelType}`;
        
        // Set attributes for consolidated level
        const displayName = level.combinedLevel ? 
            `${level.names.length} Levels` : 
            level.names[0];
        
        marker.setAttribute('data-level-name', displayName);
        marker.setAttribute('data-level-price', `$${level.value.toLocaleString()}`);
        marker.setAttribute('data-level-names', level.names.join(', '));
        marker.setAttribute('data-combined', level.combinedLevel.toString());
        
        // Calculate horizontal position (0% = lowPrice, 100% = highPrice)
        const position = ((level.value - lowPrice) / (highPrice - lowPrice)) * 100;
        marker.style.left = `${position}%`;
        marker.style.top = '0';
        
        // Make consolidated levels slightly thicker
        if (level.combinedLevel) {
            marker.style.width = '3px';
            marker.style.height = '25px';
        }
        
        // Add hover tooltip functionality
        marker.addEventListener('mouseenter', (e) => {
            this.showConsolidatedLevelTooltip(e, level);
        });
        
        marker.addEventListener('mouseleave', () => {
            this.hideLevelTooltip();
        });
        
        return marker;
    }
    
    createNearbyLevelIndicator(level, lowPrice, highPrice) {
        const indicator = document.createElement('div');
        indicator.className = `level-marker ${this.getLevelType(level.name)} nearby-level`;
        indicator.setAttribute('data-level-name', `${level.name} (nearby)`);
        indicator.setAttribute('data-level-price', `$${level.value.toLocaleString()}`);
        indicator.setAttribute('data-level-description', this.levelDescriptions[level.name] || 'Market level');
        
        // Position at appropriate edge based on price
        if (level.value < lowPrice) {
            indicator.style.left = '2%'; // Near left edge (lower prices)
        } else {
            indicator.style.left = '98%'; // Near right edge (higher prices)
        }
        
        indicator.style.top = '0';
        
        // Add hover tooltip functionality
        indicator.addEventListener('mouseenter', (e) => {
            this.showLevelTooltip(e, level);
        });
        
        indicator.addEventListener('mouseleave', () => {
            this.hideLevelTooltip();
        });
        
        return indicator;
    }
    
    getLevelType(levelName) {
        return this.levelTypes[levelName] || 'gamma-wall';
    }
    
    showLevelTooltip(event, level) {
        // Remove existing tooltip
        this.hideLevelTooltip();
        
        const tooltip = document.createElement('div');
        tooltip.className = 'level-tooltip show';
        tooltip.innerHTML = `
            <div class="tooltip-title">${level.name}</div>
            <div class="tooltip-price">$${level.value.toLocaleString()}</div>
            <div class="tooltip-description">${this.levelDescriptions[level.name] || 'Market level'}</div>
        `;
        
        document.body.appendChild(tooltip);
        
        // Position tooltip above the level marker, accounting for scroll position
        const rect = event.target.getBoundingClientRect();
        const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
        const scrollY = window.pageYOffset || document.documentElement.scrollTop;
        
        tooltip.style.left = `${rect.left + scrollX - 50}px`;
        tooltip.style.top = `${rect.top + scrollY - tooltip.offsetHeight - 10}px`;
        
        // Ensure tooltip stays within viewport
        const tooltipRect = tooltip.getBoundingClientRect();
        if (tooltipRect.left < 0) {
            tooltip.style.left = `${scrollX + 10}px`;
        }
        if (tooltipRect.right > window.innerWidth) {
            tooltip.style.left = `${scrollX + window.innerWidth - tooltipRect.width - 10}px`;
        }
        
        // Store reference for cleanup
        this.currentTooltip = tooltip;
    }
    
    showConsolidatedLevelTooltip(event, level) {
        // Remove existing tooltip
        this.hideLevelTooltip();
        
        const tooltip = document.createElement('div');
        tooltip.className = 'level-tooltip show';
        
        let tooltipContent = `
            <div class="tooltip-price">$${level.value.toLocaleString()}</div>
        `;
        
        if (level.combinedLevel) {
            tooltipContent += `<div class="tooltip-title">${level.names.length} Consolidated Levels</div>`;
            tooltipContent += `<div class="tooltip-description">`;
            level.names.forEach(name => {
                const description = this.levelDescriptions[name];
                tooltipContent += `<strong>${name}</strong>`;
                if (description) {
                    tooltipContent += `<br><small>${description}</small>`;
                }
                tooltipContent += `<br>`;
            });
            tooltipContent += `</div>`;
        } else {
            const levelName = level.names[0];
            tooltipContent += `<div class="tooltip-title">${levelName}</div>`;
            tooltipContent += `<div class="tooltip-description">${this.levelDescriptions[levelName] || 'Market level'}</div>`;
        }
        
        tooltip.innerHTML = tooltipContent;
        document.body.appendChild(tooltip);
        
        // Position tooltip above the level marker, accounting for scroll position
        const rect = event.target.getBoundingClientRect();
        const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
        const scrollY = window.pageYOffset || document.documentElement.scrollTop;
        
        tooltip.style.left = `${rect.left + scrollX - 50}px`;
        tooltip.style.top = `${rect.top + scrollY - tooltip.offsetHeight - 10}px`;
        
        // Ensure tooltip stays within viewport
        const tooltipRect = tooltip.getBoundingClientRect();
        if (tooltipRect.left < 0) {
            tooltip.style.left = `${scrollX + 10}px`;
        }
        if (tooltipRect.right > window.innerWidth) {
            tooltip.style.left = `${scrollX + window.innerWidth - tooltipRect.width - 10}px`;
        }
        
        // Store reference for cleanup
        this.currentTooltip = tooltip;
    }
    
    hideLevelTooltip() {
        if (this.currentTooltip) {
            this.currentTooltip.remove();
            this.currentTooltip = null;
        }
    }
    
    toggleChartView() {
        const chartSection = document.getElementById('analytics-chart-section');
        const toggleBtn = document.getElementById('toggle-analytics-view');
        
        if (!chartSection || !toggleBtn) return;
        
        this.chartExpanded = !this.chartExpanded;
        
        if (this.chartExpanded) {
            chartSection.style.display = 'block';
            toggleBtn.innerHTML = '<i class="bi bi-arrows-collapse"></i>';
            toggleBtn.setAttribute('title', 'Collapse Chart View');
            this.initializeTradingViewChart();
            this.updateLevelsLegend();
        } else {
            chartSection.style.display = 'none';
            toggleBtn.innerHTML = '<i class="bi bi-arrows-fullscreen"></i>';
            toggleBtn.setAttribute('title', 'Expand Chart View');
            this.destroyTradingViewChart();
        }
        
        // Save state
        if (window.uiStateManager) {
            window.uiStateManager.saveState('analytics_chart_expanded', this.chartExpanded);
        }
    }
    
    toggleAnalyticsSection() {
        // Find the analytics content section (or fallback to common analytics elements)
        let analyticsContent = document.getElementById('analytics-content');
        
        // If analytics-content wrapper doesn't exist, target the individual sections
        if (!analyticsContent) {
            const supportSection = document.querySelector('.support-resistance-section');
            const dialSection = document.querySelector('.pc-ratio-dials');
            const statusSection = document.getElementById('analytics-status');
            const chartSection = document.getElementById('analytics-chart-section');
            
            analyticsContent = {
                elements: [supportSection, dialSection, statusSection, chartSection].filter(Boolean),
                style: {
                    display: ''
                }
            };
        }
        
        const toggleBtn = document.getElementById('toggle-analytics-section');
        if (!toggleBtn) return;
        
        // Toggle visibility state
        this.analyticsCollapsed = !this.analyticsCollapsed;
        
        if (this.analyticsCollapsed) {
            // Hide analytics content
            if (analyticsContent.elements) {
                analyticsContent.elements.forEach(element => {
                    element.style.display = 'none';
                });
            } else {
                analyticsContent.style.display = 'none';
            }
            
            // Update button
            toggleBtn.innerHTML = '<i class="bi bi-chevron-down"></i>';
            toggleBtn.setAttribute('title', 'Show Market Analytics');
        } else {
            // Show analytics content
            if (analyticsContent.elements) {
                analyticsContent.elements.forEach(element => {
                    element.style.display = '';
                });
            } else {
                analyticsContent.style.display = '';
            }
            
            // Update button
            toggleBtn.innerHTML = '<i class="bi bi-chevron-up"></i>';
            toggleBtn.setAttribute('title', 'Hide Market Analytics');
        }
        
        // Save state
        if (window.uiStateManager) {
            window.uiStateManager.saveState('analytics_collapsed', this.analyticsCollapsed);
        }
    }
    
    initializeTradingViewChart() {
        if (this.tradingViewWidget) {
            this.destroyTradingViewChart();
        }
        
        // Map asset symbols for TradingView
        const symbolMap = {
            'ETH': 'COINBASE:ETHUSD',
            'BTC': 'COINBASE:BTCUSD'
        };
        
        const symbol = symbolMap[this.currentAsset] || 'COINBASE:ETHUSD';
        
        try {
            this.tradingViewWidget = new TradingView.widget({
                width: '100%',
                height: 400,
                symbol: symbol,
                interval: '15',
                timezone: 'Etc/UTC',
                theme: 'dark',
                style: '1',
                locale: 'en',
                toolbar_bg: '#192734',
                enable_publishing: false,
                hide_top_toolbar: false,
                hide_legend: false,
                save_image: false,
                container_id: 'tradingview_chart',
                studies: [
                    'Volume@tv-basicstudies'
                ]
            });
            
            // Add custom levels after chart loads
            setTimeout(() => {
                this.updateTradingViewChart();
            }, 2000);
            
        } catch (error) {
            console.error('Failed to initialize TradingView chart:', error);
        }
    }
    
    updateTradingViewChart() {
        // TradingView chart updates would go here
        // This is complex and requires the full TradingView API
    }
    
    destroyTradingViewChart() {
        if (this.tradingViewWidget) {
            try {
                this.tradingViewWidget.remove();
            } catch (error) {
                console.error('Error destroying TradingView widget:', error);
            }
            this.tradingViewWidget = null;
        }
        
        // Clear the chart container
        const chartContainer = document.getElementById('tradingview_chart');
        if (chartContainer) {
            chartContainer.innerHTML = '';
        }
    }
    
    updateLevelsLegend() {
        if (!this.analyticsData) return;
        
        const legendContainer = document.getElementById('levels-list');
        if (!legendContainer) return;
        
        legendContainer.innerHTML = '';
        
        // Sort levels by confidence and distance
        const sortedLevels = [...this.analyticsData.key_levels]
            .sort((a, b) => {
                // First by confidence, then by distance from spot
                if (b.confidence !== a.confidence) {
                    return b.confidence - a.confidence;
                }
                return Math.abs(a.distance_to_spot) - Math.abs(b.distance_to_spot);
            })
            .slice(0, 12); // Limit to top 12 levels
        
        sortedLevels.forEach(level => {
            const levelItem = document.createElement('div');
            levelItem.className = `level-item ${this.getLevelType(level.name)}`;
            
            levelItem.innerHTML = `
                <div>
                    <div class="level-name">${level.name}</div>
                </div>
                <div class="level-price">$${level.value.toLocaleString()}</div>
            `;
            
            // Add hover tooltip functionality
            levelItem.addEventListener('mouseenter', (e) => {
                this.showLevelTooltip(e, level);
            });
            
            levelItem.addEventListener('mouseleave', () => {
                this.hideLevelTooltip();
            });
            
            // Add cursor pointer to indicate interactivity
            levelItem.style.cursor = 'pointer';
            
            legendContainer.appendChild(levelItem);
        });
    }
    
    // Cleanup method
    destroy() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        
        if (this.overlayUpdateTimeout) {
            clearTimeout(this.overlayUpdateTimeout);
        }
        
        if (this.priceObserver) {
            this.priceObserver.disconnect();
        }
        
        if (this.assetObserver) {
            this.assetObserver.disconnect();
        }
        
        if (this.priceRangeLabelObserver) {
            this.priceRangeLabelObserver.disconnect();
        }
        
        this.destroyTradingViewChart();
        this.hideLevelTooltip();
    }
}

// Initialize analytics when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Only initialize if we're on a page with the analytics dashboard
    if (document.getElementById('analytics-dashboard')) {        
        window.analyticsManager = new AnalyticsManager();
    }
});

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AnalyticsManager;
}
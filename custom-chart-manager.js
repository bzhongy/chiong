// Custom Chart Manager for App Environment
class CustomChartManager {
    constructor() {
        this.chart = null;
        this.priceData = [];
        this.currentPrice = 2500; // Default ETH price
        this.currentAsset = 'ETH'; // Track current asset
        this.lastHoveredPrice = null; // Track last hovered price to reduce console spam
    }
    
    async generateMockPriceData(asset) {
        // Use real current price from app state if available, otherwise fallback to realistic defaults
        let currentRealPrice = null;
        
        // Try to get real price from app state
        if (window.state && window.state.market_prices && window.state.market_prices[asset]) {
            currentRealPrice = window.state.market_prices[asset];
        } else {
            // Fallback to reasonable current prices
            currentRealPrice = asset === 'BTC' ? 100000 : 2500;
            console.warn(`Using fallback ${asset} price: $${currentRealPrice}`);
        }
        
        // Generate realistic price history around the current price
        const data = [];
        const now = new Date();
        
        // Generate 48 data points (24 hours of 30-minute intervals)
        for (let i = 48; i >= 0; i--) {
            const timestamp = new Date(now.getTime() - i * 30 * 60 * 1000); // 30-minute intervals
            
            // Create realistic price movement around current price
            // Further back in time = more deviation allowed
            const timeBasedVariation = (i / 48) * 0.02; // Max 2% variation for oldest data
            const randomVariation = (Math.random() - 0.5) * 0.01; // ±0.5% random walk
            const totalVariation = timeBasedVariation + randomVariation;
            
            // For the most recent point, use the actual current price
            let price;
            if (i === 0) {
                price = currentRealPrice;
            } else {
                price = currentRealPrice * (1 + totalVariation);
            }
            
            data.push({
                x: timestamp,
                y: price
            });
        }
        
        this.currentPrice = currentRealPrice;
        this.priceData = data;
        this.currentAsset = asset;
        
        // Start auto-refresh timer to keep data current
        this.startAutoRefresh();
        
        return data;
    }
    
    startAutoRefresh() {
        // Clear existing timer
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
        }
        
        // Update chart data every 30 seconds to keep timestamps fresh
        this.refreshTimer = setInterval(() => {
            this.refreshPriceData();
        }, 30000);
    }
    
    refreshPriceData() {
        if (!this.chart || !this.priceData) return;
        
        const now = new Date();
        
        // Get updated real price
        let newPrice = this.currentPrice;
        if (window.state && window.state.market_prices && window.state.market_prices[this.currentAsset]) {
            newPrice = window.state.market_prices[this.currentAsset];
        }
        
        // Shift all timestamps forward and add new current data point
        this.priceData.forEach(point => {
            point.x = new Date(point.x.getTime() + 30000); // Shift 30 seconds forward
        });
        
        // Add small random variation to the latest price for realistic movement
        const variation = (Math.random() - 0.5) * 0.001; // ±0.1% micro movement
        const latestPrice = newPrice * (1 + variation);
        
        // Remove oldest point and add new current point
        this.priceData.shift();
        this.priceData.push({
            x: now,
            y: latestPrice
        });
        
        this.currentPrice = latestPrice;
        
        // Update chart if it exists
        if (this.chart) {
            this.chart.data.datasets[0].data = this.priceData.map((point, index) => ({
                x: index,
                y: point.y
            }));
            this.chart.update('none');
        }
    }
    
    initializeChart() {
        const ctx = document.getElementById('priceChart');
        if (!ctx) {
            console.warn('Chart canvas not found');
            return;
        }
        
        if (this.chart) {
            this.chart.destroy();
        }
        
        // Store reference to this instance for use in callbacks
        const chartManager = this;
        
        // Create chart without time scale initially to avoid date-fns issues
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: 'Price',
                    data: this.priceData.map((point, index) => ({
                        x: index, // Use index instead of timestamp
                        y: point.y
                    })),
                    borderColor: '#00d4aa',
                    backgroundColor: 'rgba(0, 212, 170, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.1,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    isLevel: false // Mark as price data
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'nearest',
                    axis: 'xy'
                },
                onHover: (event, activeElements, chart) => {
                    // Change cursor to pointer when hovering over level lines
                    event.native.target.style.cursor = activeElements.length > 0 ? 'pointer' : 'default';
                    
                    // Highlight hovered level line(s)
                    if (activeElements.length > 0) {
                        const activeElement = activeElements[0];
                        const dataset = chart.data.datasets[activeElement.datasetIndex];
                        
                        if (dataset.isLevel) {
                            const hoveredPrice = dataset.levelData.value;
                            
                            // Only log if price changed significantly to reduce spam
                            if (!chartManager.lastHoveredPrice || Math.abs(hoveredPrice - chartManager.lastHoveredPrice) > hoveredPrice * 0.001) {
                                chartManager.lastHoveredPrice = hoveredPrice;
                            }
                            
                            const priceThreshold = hoveredPrice * 0.002; // 0.2% threshold for grouping levels
                            
                            // Find all levels within the price threshold
                            const clusteredLevels = [];
                            const seenLevels = new Set(); // Prevent duplicates
                            
                            chart.data.datasets.forEach((ds, index) => {
                                if (ds.isLevel && ds.levelData) {
                                    const priceDiff = Math.abs(ds.levelData.value - hoveredPrice);
                                    const levelKey = `${ds.levelData.name}_${ds.levelData.value}`;
                                    
                                    if (priceDiff <= priceThreshold && !seenLevels.has(levelKey)) {
                                        seenLevels.add(levelKey);
                                        clusteredLevels.push({
                                            dataset: ds,
                                            index: index,
                                            levelData: ds.levelData
                                        });
                                    }
                                }
                            });
                            
                            // Only log if the number of levels changed or it's a new price
                            if (!chart._lastClusterSize || chart._lastClusterSize !== clusteredLevels.length || 
                                !chart._lastClusterPrice || Math.abs(chart._lastClusterPrice - hoveredPrice) > hoveredPrice * 0.001) {
                                console.log(`Found ${clusteredLevels.length} unique levels around $${hoveredPrice.toLocaleString()}: ${clusteredLevels.map(l => l.levelData.name).join(', ')}`);
                                chart._lastClusterSize = clusteredLevels.length;
                                chart._lastClusterPrice = hoveredPrice;
                            }
                            
                            // Reset all level line widths first
                            chart.data.datasets.forEach((ds) => {
                                if (ds.isLevel) {
                                    ds.borderWidth = ds.levelData.confidence > 0.8 ? 3 : 2;
                                    ds.borderColor = chartManager.getLevelColor(chartManager.getLevelType(ds.levelData.name));
                                }
                            });
                            
                            // Highlight all clustered levels
                            clusteredLevels.forEach(({dataset}) => {
                                dataset.borderWidth = 4;
                                dataset.borderColor = chartManager.getBrightLevelColor(chartManager.getLevelType(dataset.levelData.name));
                            });
                            
                            // Store unique clustered levels for tooltip use
                            chart._clusteredLevels = clusteredLevels.map(({levelData}) => levelData);
                            
                            chart.update('none');
                        }
                    } else {
                        // Reset all levels when not hovering
                        let needsUpdate = false;
                        chart.data.datasets.forEach((ds) => {
                            if (ds.isLevel) {
                                const normalWidth = ds.levelData.confidence > 0.8 ? 3 : 2;
                                if (ds.borderWidth !== normalWidth) {
                                    ds.borderWidth = normalWidth;
                                    ds.borderColor = chartManager.getLevelColor(chartManager.getLevelType(ds.levelData.name));
                                    needsUpdate = true;
                                }
                            }
                        });
                        
                        // Clear clustered levels and tracking
                        chart._clusteredLevels = null;
                        chart._lastClusterSize = null;
                        chart._lastClusterPrice = null;
                        chartManager.lastHoveredPrice = null;
                        
                        if (needsUpdate) {
                            chart.update('none');
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.9)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        borderColor: '#00d4aa',
                        borderWidth: 1,
                        callbacks: {
                            title: function(context) {
                                const activeElement = context[0];
                                const dataset = activeElement.dataset;
                                const chart = activeElement.chart;
                                
                                if (dataset.isLevel) {
                                    // Check if we have clustered levels
                                    if (chart._clusteredLevels && chart._clusteredLevels.length > 1) {
                                        const levelNames = chart._clusteredLevels.map(level => level.name);
                                        return `${levelNames.length} Levels at $${dataset.levelData.value.toLocaleString()}`;
                                    } else {
                                        // Show single level name as title when hovering over level
                                        return dataset.levelData.name;
                                    }
                                } else {
                                    // Show time for price data
                                    const index = activeElement.dataIndex;
                                    const timeAgo = Math.floor((48 - index) / 2);
                                    return timeAgo > 0 ? `${timeAgo}h ago` : 'Now';
                                }
                            },
                            label: function(context) {
                                const dataset = context.dataset;
                                const chart = context.chart;
                                
                                if (dataset.isLevel) {
                                    // Check if we have clustered levels
                                    if (chart._clusteredLevels && chart._clusteredLevels.length > 1) {
                                        // Only show clustered details for the first dataset to avoid duplication
                                        // Use the first clustered level's name as the trigger
                                        const firstClusteredLevel = chart._clusteredLevels[0];
                                        if (dataset.levelData.name === firstClusteredLevel.name) {
                                            // Show all clustered levels with deduplication
                                            const labels = [];
                                            const uniqueLevels = new Map();
                                            
                                            // Deduplicate by name + price combination
                                            chart._clusteredLevels.forEach(levelData => {
                                                const key = `${levelData.name}_${levelData.value}`;
                                                if (!uniqueLevels.has(key)) {
                                                    uniqueLevels.set(key, levelData);
                                                }
                                            });
                                            
                                            // Convert back to array and sort by confidence
                                            const sortedLevels = Array.from(uniqueLevels.values())
                                                .sort((a, b) => b.confidence - a.confidence);
                                            
                                            sortedLevels.forEach((levelData, index) => {
                                                const levelType = chartManager.getLevelType(levelData.name);
                                                const typeSymbol = levelType === 'support' ? '🟢' : 
                                                                 levelType === 'resistance' ? '🔴' : '🟠';
                                                
                                                labels.push(`${typeSymbol} ${levelData.name}`);
                                                labels.push(`   Price: $${levelData.value.toLocaleString()}`);
                                                labels.push(`   Confidence: ${(levelData.confidence * 100).toFixed(0)}%`);
                                                labels.push(`   Distance: ${levelData.distance_to_spot > 0 ? '+' : ''}${levelData.distance_to_spot?.toLocaleString() || 'N/A'}`);
                                                
                                                if (index < sortedLevels.length - 1) {
                                                    labels.push(''); // Add spacing between levels
                                                }
                                            });
                                            
                                            return labels;
                                        } else {
                                            return []; // Return empty for subsequent datasets to avoid duplication
                                        }
                                    } else {
                                        // For single level datasets, show level details
                                        const levelData = dataset.levelData;
                                        return [
                                            `Price: $${levelData.value.toLocaleString()}`,
                                            `Confidence: ${(levelData.confidence * 100).toFixed(0)}%`,
                                            `Distance: ${levelData.distance_to_spot > 0 ? '+' : ''}${levelData.distance_to_spot?.toLocaleString() || 'N/A'}`
                                        ];
                                    }
                                } else {
                                    // For price dataset, show current price
                                    return `Price: $${context.parsed.y.toLocaleString()}`;
                                }
                            },
                            afterBody: function(context) {
                                const activeElement = context[0];
                                const dataset = activeElement.dataset;
                                
                                if (!dataset.isLevel) {
                                    // Only show all levels when hovering over price, not when hovering over a specific level
                                    const chart = activeElement.chart;
                                    const levels = [];
                                    
                                    chart.data.datasets.forEach((ds, index) => {
                                        if (ds.isLevel && index > 0) {
                                            const levelData = ds.levelData;
                                            levels.push(`${levelData.name}: $${levelData.value.toLocaleString()}`);
                                        }
                                    });
                                    
                                    return levels.length > 0 ? ['', 'All Key Levels:', ...levels.slice(0, 8)] : [];
                                }
                                
                                return [];
                            },
                            afterLabel: function(context) {
                                const dataset = context.dataset;
                                const chart = context.chart;
                                
                                if (dataset.isLevel) {
                                    // Check if we have clustered levels
                                    if (chart._clusteredLevels && chart._clusteredLevels.length > 1) {
                                        // Only show descriptions for the first dataset to avoid duplication
                                        const firstClusteredLevel = chart._clusteredLevels[0];
                                        if (dataset.levelData.name === firstClusteredLevel.name) {
                                            // Show combined description for clustered levels
                                            const levelTypes = chart._clusteredLevels.map(level => 
                                                chartManager.getLevelType(level.name)
                                            );
                                            const uniqueTypes = [...new Set(levelTypes)];
                                            
                                            const typeDescriptions = {
                                                'support': 'Support zones where price may bounce up',
                                                'resistance': 'Resistance zones where price may face selling pressure',  
                                                'gamma-wall': 'High options activity zones'
                                            };
                                            
                                            const descriptions = uniqueTypes.map(type => typeDescriptions[type]).filter(Boolean);
                                            return ['', ...descriptions];
                                        } else {
                                            return ''; // Return empty for subsequent datasets
                                        }
                                    } else {
                                        // Add single level type description
                                        const levelType = chartManager.getLevelType(dataset.levelData.name);
                                        const descriptions = {
                                            'support': 'Support Level - Price may bounce up from here',
                                            'resistance': 'Resistance Level - Price may face selling pressure',
                                            'gamma-wall': 'Gamma Wall - High options activity zone'
                                        };
                                        
                                        return descriptions[levelType] || 'Key market level';
                                    }
                                }
                                
                                return '';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: '#888',
                            callback: function(value, index) {
                                const hoursAgo = Math.floor((48 - index) / 2);
                                return hoursAgo > 0 ? `-${hoursAgo}h` : 'Now';
                            }
                        }
                    },
                    y: {
                        position: 'right',
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)'
                        },
                        ticks: {
                            color: '#888',
                            callback: function(value) {
                                return '$' + value.toLocaleString();
                            }
                        }
                    }
                }
            }
        });
        
        console.log('Chart initialized successfully');
    }
    
    addAnalyticsLevels(analyticsData, forceAsset = null) {
        if (!this.chart) {
            console.warn('Chart not initialized, cannot add levels');
            return;
        }
        
        if (!analyticsData || !analyticsData.key_levels) {
            console.warn('No analytics data or key_levels found');
            return;
        }
        
        // Check asset alignment if forceAsset is provided
        const expectedAsset = forceAsset || this.currentAsset;
        console.log(`Adding levels for asset: ${expectedAsset}, Chart asset: ${this.currentAsset}`);
        
        if (forceAsset && forceAsset !== this.currentAsset) {
            console.warn(`Asset mismatch: Expected ${forceAsset}, Chart has ${this.currentAsset}. Skipping level update.`);
            return;
        }
        
        console.log('Analytics data received:', analyticsData);
        console.log('Available levels:', analyticsData.key_levels.map(l => `${l.name}: $${l.value}`));
        
        // Remove existing level annotations (keep only price dataset)
        this.chart.data.datasets = this.chart.data.datasets.filter(ds => !ds.isLevel);
        
        // Get all level values to determine the full range needed
        const levelValues = analyticsData.key_levels.map(level => level.value);
        const currentPrices = this.priceData.map(d => d.y);
        const allValues = [...levelValues, ...currentPrices];
        
        const minValue = Math.min(...allValues);
        const maxValue = Math.max(...allValues);
        const valueRange = maxValue - minValue;
        
        // Add padding to make the chart more readable
        const padding = valueRange * 0.05; // 5% padding
        const chartMin = minValue - padding;
        const chartMax = maxValue + padding;
        
        console.log(`Full range: $${minValue.toLocaleString()} - $${maxValue.toLocaleString()}`);
        console.log(`Chart range with padding: $${chartMin.toLocaleString()} - $${chartMax.toLocaleString()}`);
        
        // Update Y-axis scale to show all levels
        this.chart.options.scales.y.min = chartMin;
        this.chart.options.scales.y.max = chartMax;
        
        // Sort levels by confidence for better visual hierarchy
        const sortedLevels = [...analyticsData.key_levels]
            .sort((a, b) => b.confidence - a.confidence);
        
        console.log(`Adding all ${sortedLevels.length} levels to chart:`, sortedLevels.map(l => `${l.name}: $${l.value.toLocaleString()}`));
        
        // Add all levels as horizontal line datasets
        sortedLevels.forEach((level, index) => {
            const levelType = this.getLevelType(level.name);
            const color = this.getLevelColor(levelType);
            const alpha = Math.max(0.4, level.confidence); // Use confidence for opacity
            
            // Create horizontal line data using index-based x values
            const lineData = this.priceData.map((point, idx) => ({
                x: idx,
                y: level.value
            }));
            
            this.chart.data.datasets.push({
                label: level.name,
                data: lineData,
                borderColor: color,
                backgroundColor: color,
                borderWidth: level.confidence > 0.8 ? 3 : 2, // Thicker lines for high confidence
                borderDash: this.getLevelDash(levelType),
                fill: false,
                tension: 0,
                pointRadius: 0,
                pointHoverRadius: 0,
                isLevel: true,
                levelData: level,
                order: index + 1 // Ensure levels are rendered after price
            });
        });
        
        console.log(`Chart now has ${this.chart.data.datasets.length} datasets (1 price + ${sortedLevels.length} levels)`);
        console.log(`Y-axis range set to: $${chartMin.toLocaleString()} - $${chartMax.toLocaleString()}`);
        
        this.chart.update('none'); // Update without animation for performance
    }
    
    clearLevels() {
        if (this.chart) {
            console.log('Clearing existing levels from chart');
            this.chart.data.datasets = this.chart.data.datasets.filter(ds => !ds.isLevel);
            this.chart.update('none');
        }
    }
    
    getLevelType(levelName) {
        const levelTypes = {
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
        return levelTypes[levelName] || 'gamma-wall';
    }
    
    getLevelColor(levelType) {
        const colors = {
            'support': '#00d4aa',     // Green for support
            'resistance': '#ff4757', // Red for resistance  
            'gamma-wall': '#ffa726'  // Orange for gamma walls
        };
        return colors[levelType] || '#ffa726';
    }
    
    getBrightLevelColor(levelType) {
        const brightColors = {
            'support': '#00ff88',     // Bright green for support
            'resistance': '#ff6b6b', // Bright red for resistance  
            'gamma-wall': '#ffb347'  // Bright orange for gamma walls
        };
        return brightColors[levelType] || '#ffb347';
    }
    
    getLevelDash(levelType) {
        const dashes = {
            'support': [5, 5],       // Dashed line for support
            'resistance': [5, 5],    // Dashed line for resistance
            'gamma-wall': [10, 5]    // Different dash for gamma walls
        };
        return dashes[levelType] || [5, 5];
    }
    
    async updateChart(asset) {
        console.log(`Updating chart for ${asset}`);
        
        // Clear existing levels first to prevent misalignment
        this.clearLevels();
        
        await this.generateMockPriceData(asset);
        
        if (this.chart) {
            // Update the main price dataset
            this.chart.data.datasets[0].data = this.priceData.map((point, index) => ({
                x: index,
                y: point.y
            }));
            this.chart.update();
            console.log(`Chart updated for ${asset}, levels cleared`);
        }
    }
    
    destroy() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
        
        // Clean up refresh timer
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }
}

// Initialize custom chart manager
window.customChartManager = new CustomChartManager();

// Wait for DOM and analytics.js to be fully loaded, then override TradingView methods
document.addEventListener('DOMContentLoaded', function() {
    console.log('App loaded, setting up custom chart integration...');
    
    // Wait for analytics manager to initialize and override TradingView methods
    setTimeout(() => {
        if (window.analyticsManager && window.analyticsManager.constructor) {                    
            // Store original updateAnalyticsUI method
            const originalUpdateAnalyticsUI = window.analyticsManager.updateAnalyticsUI;
            
            // Override the TradingView methods in the instance
            window.analyticsManager.initializeTradingViewChart = function() {
                console.log('Initializing Chart.js instead of TradingView...');
                window.customChartManager.generateMockPriceData(this.currentAsset).then(() => {
                    window.customChartManager.initializeChart();
                    // Add levels if data is already available
                    if (this.analyticsData) {
                        setTimeout(() => {
                            window.customChartManager.addAnalyticsLevels(this.analyticsData, this.currentAsset);
                        }, 100);
                    }
                });
            };
            
            window.analyticsManager.updateTradingViewChart = function() {
                console.log('Updating Chart.js with analytics levels...');
                if (this.analyticsData && window.customChartManager && window.customChartManager.chart) {
                    window.customChartManager.addAnalyticsLevels(this.analyticsData, this.currentAsset);
                }
            };
            
            window.analyticsManager.destroyTradingViewChart = function() {
                console.log('Destroying Chart.js...');
                window.customChartManager.destroy();
            };
            
            // Override updateAnalyticsUI to also update chart levels
            window.analyticsManager.updateAnalyticsUI = function() {
                // Call original method
                originalUpdateAnalyticsUI.call(this);
                
                // Also update chart levels if chart is open, ensuring asset alignment
                if (window.customChartManager && window.customChartManager.chart && this.analyticsData) {
                    setTimeout(() => {
                        window.customChartManager.addAnalyticsLevels(this.analyticsData, this.currentAsset);
                    }, 100);
                }
                
                // Initialize chart if flagged from saved state restoration
                if (this.shouldInitializeChartOnDataLoad) {
                    console.log('🔄 Initializing custom chart after data load (from saved state)...');
                    setTimeout(() => {
                        if (window.customChartManager && !window.customChartManager.chart) {
                            window.customChartManager.generateMockPriceData(this.currentAsset).then(() => {
                                window.customChartManager.initializeChart();
                                if (this.analyticsData) {
                                    window.customChartManager.addAnalyticsLevels(this.analyticsData, this.currentAsset);
                                }
                            });
                        }
                    }, 200);
                    this.shouldInitializeChartOnDataLoad = false;
                }
            };
            
            // Initialize chart with current asset data
            if (window.customChartManager) {
                const initialAsset = window.analyticsManager.currentAsset || 'ETH';
                window.customChartManager.generateMockPriceData(initialAsset).then(() => {
                    // Chart will be initialized when analytics view is expanded
                });
            }
        } else {
            console.warn('AnalyticsManager not found, TradingView overrides not applied');
        }
    }, 1000); // Timeout to ensure analytics.js is fully loaded
}); 
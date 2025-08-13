/**
 * Deribit Analytics - Local JavaScript Version
 * No external dependencies - ready for Cloudflare Workers adaptation
 */

class DeribitAnalytics {
    constructor(baseUrl = "https://deribit.com/api/v2") {
        this.baseUrl = baseUrl;
    }

    // ===== UTILITY FUNCTIONS =====

    /**
     * Fetch with retry logic
     */
    async fetchWithRetry(url, params = {}, maxRetries = 3) {
        const queryString = new URLSearchParams(params).toString();
        const fullUrl = `${url}${queryString ? '?' + queryString : ''}`;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch(fullUrl);
                
                if (response.status === 429) {
                    const waitTime = Math.pow(2, attempt) * 1000;
                    console.log(`Rate limited, waiting ${waitTime/1000}s before retry ${attempt + 1}`);
                    await this.sleep(waitTime);
                    continue;
                }

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();
                return data.result || data;
            } catch (error) {
                if (attempt === maxRetries - 1) {
                    console.error(`Failed to fetch ${url} after ${maxRetries} attempts:`, error);
                    return null;
                }
                await this.sleep(1000);
            }
        }
        return null;
    }

    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ===== MATHEMATICAL FUNCTIONS =====

    /**
     * Standard normal cumulative distribution function (CDF)
     * Approximation using Abramowitz and Stegun method
     */
    normalCDF(x) {
        const a1 = 0.254829592;
        const a2 = -0.284496736;
        const a3 = 1.421413741;
        const a4 = -1.453152027;
        const a5 = 1.061405429;
        const p = 0.3275911;

        const sign = x < 0 ? -1 : 1;
        x = Math.abs(x) / Math.sqrt(2);

        const t = 1 / (1 + p * x);
        const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

        return 0.5 * (1 + sign * y);
    }

    /**
     * Black-Scholes Delta calculation
     */
    calculateDelta(spot, strike, timeToExpiry, riskFreeRate = 0.05, volatility = 0.8, optionType = 'call') {
        if (timeToExpiry <= 0) {
            // For expired options, delta is 0 or 1
            if (optionType === 'call') {
                return spot > strike ? 1 : 0;
            } else {
                return spot < strike ? -1 : 0;
            }
        }

        const d1 = (Math.log(spot / strike) + (riskFreeRate + 0.5 * volatility * volatility) * timeToExpiry) / 
                   (volatility * Math.sqrt(timeToExpiry));

        if (optionType === 'call') {
            return this.normalCDF(d1);
        } else {
            return this.normalCDF(d1) - 1;
        }
    }

    /**
     * Simplified gamma calculation for dealer exposure
     */
    calculateGamma(spot, strike, timeToExpiry, riskFreeRate = 0.05, volatility = 0.8) {
        if (timeToExpiry <= 0) return 0;

        const d1 = (Math.log(spot / strike) + (riskFreeRate + 0.5 * volatility * volatility) * timeToExpiry) / 
                   (volatility * Math.sqrt(timeToExpiry));

        // Standard normal probability density function
        const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
        
        return pdf / (spot * volatility * Math.sqrt(timeToExpiry));
    }

    /**
     * Parse instrument name to extract details
     */
    parseInstrument(instrumentName) {
        const parts = instrumentName.split('-');
        if (parts.length < 4) return null;

        const currency = parts[0];
        const expiryStr = parts[1];
        const strike = parseFloat(parts[2]);
        const optionType = parts[3]; // 'C' or 'P'

        // Parse expiry date
        const today = new Date();
        const expiryDate = this.parseExpiryDate(expiryStr);
        const timeToExpiry = expiryDate ? (expiryDate - today) / (1000 * 60 * 60 * 24 * 365) : 0;

        return {
            currency,
            expiryStr,
            strike,
            optionType,
            timeToExpiry,
            isToday: this.isToday(expiryDate)
        };
    }

    /**
     * Parse expiry date string (e.g., "25SEP20")
     */
    parseExpiryDate(expiryStr) {
        try {
            const months = {
                'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
                'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11
            };

            const day = parseInt(expiryStr.slice(0, 2));
            const monthStr = expiryStr.slice(2, 5);
            const yearStr = expiryStr.slice(5);

            const month = months[monthStr];
            const year = 2000 + parseInt(yearStr);

            return new Date(year, month, day);
        } catch (error) {
            return null;
        }
    }

    /**
     * Check if date is today
     */
    isToday(date) {
        if (!date) return false;
        const today = new Date();
        return date.toDateString() === today.toDateString();
    }

    // ===== DATA FETCHING =====

    /**
     * Fetch current index price
     */
    async fetchIndexPrice(currency = "BTC") {
        const url = `${this.baseUrl}/public/get_index_price`;
        const params = { index_name: `${currency.toLowerCase()}_usd` };
        
        const result = await this.fetchWithRetry(url, params);
        return result?.index_price || 0;
    }

    /**
     * Fetch all options book summary (open interest data)
     */
    async fetchBookSummary(currency = "BTC") {
        const url = `${this.baseUrl}/public/get_book_summary_by_currency`;
        const params = { currency, kind: "option" };
        
        const result = await this.fetchWithRetry(url, params);
        return Array.isArray(result) ? result : [];
    }

    /**
     * Fetch futures trades for volume analysis
     */
    async fetchFuturesTrades(currency = "BTC", hoursBack = 24) {
        const url = `${this.baseUrl}/public/get_last_trades_by_currency`;
        const params = {
            currency,
            kind: "future",
            count: 1000,
            include_old: "true"
        };
        
        const result = await this.fetchWithRetry(url, params);
        const trades = Array.isArray(result) ? result : (result?.trades || []);
        
        // Filter to last N hours
        const cutoffTime = Date.now() - (hoursBack * 60 * 60 * 1000);
        return trades.filter(trade => trade.timestamp >= cutoffTime);
    }

    /**
     * Fetch complete options trades with pagination
     */
    async fetchCompleteOptionsTrades(currency = "BTC", hoursBack = 24, chunkHours = 4) {
        console.log(`\n=== Fetching Complete ${currency} Options Flow (${hoursBack}h) ===`);
        
        const endTime = new Date();
        const uniqueTrades = new Map();
        const totalChunks = Math.ceil(hoursBack / chunkHours);
        
        console.log(`Using ${chunkHours}h chunks, ${totalChunks} total chunks needed`);
        
        for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
            const chunkStartHours = chunkIdx * chunkHours;
            const chunkEndHours = Math.min((chunkIdx + 1) * chunkHours, hoursBack);
            
            const chunkEnd = new Date(endTime.getTime() - (chunkStartHours * 60 * 60 * 1000));
            const chunkStart = new Date(endTime.getTime() - (chunkEndHours * 60 * 60 * 1000));
            
            console.log(`Chunk ${chunkIdx + 1}/${totalChunks}: ${chunkStart.toLocaleString()} to ${chunkEnd.toLocaleString()}`);
            
            const params = {
                currency,
                kind: "option",
                start_timestamp: chunkStart.getTime(),
                end_timestamp: chunkEnd.getTime(),
                count: 1000,
                sorting: "desc"
            };
            
            const url = `${this.baseUrl}/public/get_last_trades_by_currency_and_time`;
            const result = await this.fetchWithRetry(url, params);
            
            let chunkTrades = [];
            if (Array.isArray(result)) {
                chunkTrades = result;
            } else if (result?.trades) {
                chunkTrades = result.trades;
            }
            
            console.log(`  Fetched ${chunkTrades.length} trades`);
            
            // Deduplicate by trade_id
            let chunkUnique = 0;
            for (const trade of chunkTrades) {
                if (trade.trade_id && !uniqueTrades.has(trade.trade_id)) {
                    uniqueTrades.set(trade.trade_id, trade);
                    chunkUnique++;
                }
            }
            
            console.log(`  Added ${chunkUnique} unique trades`);
            await this.sleep(300); // Rate limiting
        }
        
        const allTrades = Array.from(uniqueTrades.values());
        console.log(`\nTotal unique trades collected: ${allTrades.length}`);
        
        return allTrades;
    }

    // ===== ANALYTICS CALCULATIONS =====

    /**
     * Calculate 1D Max/Min from futures trades
     */
    calculate1DMaxMin(futuresTrades) {
        if (!futuresTrades || futuresTrades.length === 0) {
            return {};
        }

        const prices = futuresTrades
            .map(trade => trade.price)
            .filter(price => price > 0);

        if (prices.length === 0) {
            return {};
        }

        return {
            "1D Max": Math.max(...prices),
            "1D Min": Math.min(...prices)
        };
    }

    /**
     * Calculate High Volume Level from futures trades
     */
    calculateHVL(futuresTrades) {
        if (!futuresTrades || futuresTrades.length === 0) {
            return {};
        }

        const priceLevels = new Map();
        
        for (const trade of futuresTrades) {
            const price = trade.price;
            const amount = trade.amount || 0;
            
            if (price <= 0 || amount <= 0) continue;
            
            // Round price to create levels
            const level = price > 1000 ? Math.round(price / 10) * 10 : Math.round(price);
            
            priceLevels.set(level, (priceLevels.get(level) || 0) + amount);
        }
        
        if (priceLevels.size === 0) {
            return {};
        }
        
        // Find highest volume level
        let maxVolume = 0;
        let hvlPrice = 0;
        
        for (const [price, volume] of priceLevels) {
            if (volume > maxVolume) {
                maxVolume = volume;
                hvlPrice = price;
            }
        }
        
        return {
            "HVL": hvlPrice,
            "HVL_Volume": maxVolume
        };
    }

    /**
     * Calculate Call/Put Resistance/Support from open interest
     */
    calculateOpenInterestLevels(bookData, spotPrice) {
        if (!bookData || bookData.length === 0) {
            return {};
        }

        const strikeData = new Map();
        const today = new Date();
        const todayStr = this.formatDateForExpiry(today);

        for (const instrument of bookData) {
            const parsed = this.parseInstrument(instrument.instrument_name);
            if (!parsed) continue;

            const openInterest = instrument.open_interest || 0;
            if (openInterest <= 0) continue;

            const key = parsed.strike;
            if (!strikeData.has(key)) {
                strikeData.set(key, {
                    totalOI: 0,
                    callOI: 0,
                    putOI: 0,
                    odteOI: 0,
                    callOdteOI: 0,
                    putOdteOI: 0
                });
            }

            const data = strikeData.get(key);
            const delta = this.calculateDelta(spotPrice, parsed.strike, parsed.timeToExpiry, 0.05, 0.8, 
                                           parsed.optionType === 'C' ? 'call' : 'put');
            
            // Delta-adjusted notional exposure
            const deltaAdjustedOI = openInterest * Math.abs(delta) * spotPrice;
            
            data.totalOI += deltaAdjustedOI;
            
            if (parsed.optionType === 'C') {
                data.callOI += deltaAdjustedOI;
                if (parsed.isToday) {
                    data.callOdteOI += deltaAdjustedOI;
                }
            } else {
                data.putOI += deltaAdjustedOI;
                if (parsed.isToday) {
                    data.putOdteOI += deltaAdjustedOI;
                }
            }
            
            if (parsed.isToday) {
                data.odteOI += deltaAdjustedOI;
            }
        }

        const levels = {};

        // Call Resistance - highest call OI above spot
        let maxCallOI = 0;
        let callResistance = 0;
        for (const [strike, data] of strikeData) {
            if (strike > spotPrice && data.callOI > maxCallOI) {
                maxCallOI = data.callOI;
                callResistance = strike;
            }
        }
        if (callResistance > 0) {
            levels["Call Resistance"] = callResistance;
        }

        // Put Support - highest put OI below spot
        let maxPutOI = 0;
        let putSupport = 0;
        for (const [strike, data] of strikeData) {
            if (strike < spotPrice && data.putOI > maxPutOI) {
                maxPutOI = data.putOI;
                putSupport = strike;
            }
        }
        if (putSupport > 0) {
            levels["Put Support"] = putSupport;
        }

        // Gamma Wall 0DTE - highest 0DTE OI (any strike)
        let maxOdteOI = 0;
        let gammaWall = 0;
        for (const [strike, data] of strikeData) {
            if (data.odteOI > maxOdteOI) {
                maxOdteOI = data.odteOI;
                gammaWall = strike;
            }
        }
        if (gammaWall > 0) {
            levels["Gamma Wall 0DTE"] = gammaWall;
        }

        return levels;
    }

    /**
     * Format date for expiry string matching
     */
    formatDateForExpiry(date) {
        const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                       'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        
        const day = date.getDate().toString().padStart(2, '0');
        const month = months[date.getMonth()];
        const year = date.getFullYear().toString().slice(-2);
        
        return `${day}${month}${year}`;
    }

    /**
     * Analyze complete options flow
     */
    analyzeOptionsFlow(optionsTrades, spotPrice) {
        if (!optionsTrades || optionsTrades.length === 0) {
            return {};
        }

        console.log(`Analyzing ${optionsTrades.length} options trades for flow patterns...`);

        const strikeFlow = new Map();
        let totalVolume = 0;

        for (const trade of optionsTrades) {
            const parsed = this.parseInstrument(trade.instrument_name);
            if (!parsed) continue;

            const amount = trade.amount || 0;
            const price = trade.price || 0;
            const direction = trade.direction || "";

            if (amount <= 0 || price <= 0) continue;

            // Calculate notional value
            const notional = amount * price * spotPrice;
            totalVolume += notional;

            // Time weighting
            const hoursAgo = (Date.now() - trade.timestamp) / (1000 * 60 * 60);
            const timeWeight = Math.exp(-hoursAgo / 8); // 8-hour half-life

            // Calculate delta-adjusted exposure
            const delta = this.calculateDelta(spotPrice, parsed.strike, parsed.timeToExpiry, 0.05, 0.8,
                                            parsed.optionType === 'C' ? 'call' : 'put');
            const deltaExposure = notional * Math.abs(delta);

            // Flow direction
            const flowDirection = direction === "buy" ? 1 : -1;

            const key = parsed.strike;
            if (!strikeFlow.has(key)) {
                strikeFlow.set(key, {
                    totalVolume: 0,
                    netFlow: 0,
                    callVolume: 0,
                    putVolume: 0,
                    weightedFlow: 0,
                    callFlow: 0,
                    putFlow: 0,
                    odteVolume: 0,
                    odteCallVolume: 0,
                    odtePutVolume: 0,
                    tradeCount: 0
                });
            }

            const data = strikeFlow.get(key);
            data.totalVolume += notional;
            data.netFlow += deltaExposure * flowDirection;
            data.weightedFlow += deltaExposure * flowDirection * timeWeight;
            data.tradeCount += 1;

            if (parsed.optionType === 'C') {
                data.callVolume += notional;
                data.callFlow += deltaExposure * flowDirection;
                if (parsed.isToday) {
                    data.odteCallVolume += notional;
                }
            } else {
                data.putVolume += notional;
                data.putFlow += deltaExposure * flowDirection;
                if (parsed.isToday) {
                    data.odtePutVolume += notional;
                }
            }

            if (parsed.isToday) {
                data.odteVolume += notional;
            }
        }

        if (strikeFlow.size === 0) {
            return {};
        }

        console.log(`Processed $${totalVolume.toLocaleString()} in total options volume across ${strikeFlow.size} strikes`);

        const levels = {};

        // Find various flow-based levels
        let maxVolumeStrike = 0;
        let maxVolume = 0;
        
        for (const [strike, data] of strikeFlow) {
            if (data.totalVolume > maxVolume) {
                maxVolume = data.totalVolume;
                maxVolumeStrike = strike;
            }
        }
        
        if (maxVolumeStrike > 0) {
            levels["Flow Volume Leader"] = maxVolumeStrike;
        }

        // Call flow resistance above spot
        let maxCallFlow = 0;
        let callFlowResistance = 0;
        for (const [strike, data] of strikeFlow) {
            if (strike > spotPrice && data.callFlow > maxCallFlow) {
                maxCallFlow = data.callFlow;
                callFlowResistance = strike;
            }
        }
        if (callFlowResistance > 0) {
            levels["Call Flow Resistance"] = callFlowResistance;
        }

        // Put flow support below spot
        let maxPutFlow = 0;
        let putFlowSupport = 0;
        for (const [strike, data] of strikeFlow) {
            if (strike < spotPrice && Math.abs(data.putFlow) > maxPutFlow) {
                maxPutFlow = Math.abs(data.putFlow);
                putFlowSupport = strike;
            }
        }
        if (putFlowSupport > 0) {
            levels["Put Flow Support"] = putFlowSupport;
        }

        return levels;
    }

    // ===== MAIN ANALYSIS =====

    /**
     * Get complete analysis for a currency
     */
    async getCompleteAnalysis(currency = "BTC") {
        console.log(`\n=== Complete ${currency} Analysis ===`);

        // Fetch spot price
        const spotPrice = await this.fetchIndexPrice(currency);
        console.log(`Current ${currency} price: $${spotPrice.toLocaleString()}`);

        if (spotPrice <= 0) {
            throw new Error(`Failed to fetch spot price for ${currency}`);
        }

        // Fetch all data
        console.log("Fetching market data...");
        const [bookData, futuresTrades, optionsTrades] = await Promise.all([
            this.fetchBookSummary(currency),
            this.fetchFuturesTrades(currency),
            this.fetchCompleteOptionsTrades(currency, 24, 4)
        ]);

        console.log(`Data summary: ${optionsTrades.length} options trades, ${bookData.length} instruments, ${futuresTrades.length} futures trades`);

        // Calculate all levels
        const maxMinLevels = this.calculate1DMaxMin(futuresTrades);
        const hvlLevels = this.calculateHVL(futuresTrades);
        const oiLevels = this.calculateOpenInterestLevels(bookData, spotPrice);
        const flowLevels = this.analyzeOptionsFlow(optionsTrades, spotPrice);

        // Combine all levels
        const allLevels = {
            ...maxMinLevels,
            ...hvlLevels,
            ...oiLevels,
            ...flowLevels
        };

        // Format result
        const result = {
            currency,
            spotPrice,
            timestamp: new Date().toISOString(),
            levels: {},
            metadata: {
                optionsTradesAnalyzed: optionsTrades.length,
                instrumentsTracked: bookData.length,
                futuresTradesAnalyzed: futuresTrades.length
            }
        };

        // Calculate confidence scores and percentage distances
        for (const [levelName, levelPrice] of Object.entries(allLevels)) {
            if (typeof levelPrice === 'number' && levelPrice > 0) {
                const pctChange = ((levelPrice - spotPrice) / spotPrice) * 100;
                const confidence = this.calculateConfidence(levelName, levelPrice, spotPrice);
                
                result.levels[levelName] = {
                    price: levelPrice,
                    percentage: pctChange,
                    confidence
                };
            }
        }

        return result;
    }

    /**
     * Calculate confidence score for a level
     */
    calculateConfidence(levelName, levelPrice, spotPrice) {
        const distanceFromSpot = Math.abs(levelPrice - spotPrice) / spotPrice;
        
        // Base confidence decreases with distance from spot
        let confidence = Math.max(0.3, 1 - distanceFromSpot * 2);
        
        // Adjust based on level type
        if (levelName.includes('0DTE') || levelName.includes('Gamma')) {
            confidence *= 1.2; // Higher confidence for gamma-related levels
        }
        
        if (levelName.includes('Flow')) {
            confidence *= 1.1; // Slightly higher for flow-based levels
        }
        
        return Math.min(1, confidence);
    }

    /**
     * Format results for display
     */
    formatResults(result) {
        console.log(`\n=== ${result.currency} Analysis Results ===`);
        console.log(`Spot Price: $${result.spotPrice.toLocaleString()}`);
        console.log(`Analysis Time: ${new Date(result.timestamp).toLocaleString()}`);
        console.log(`Data Coverage: ${result.metadata.optionsTradesAnalyzed} options trades analyzed\n`);

        // Sort levels by confidence
        const sortedLevels = Object.entries(result.levels)
            .sort((a, b) => b[1].confidence - a[1].confidence);

        for (const [levelName, levelData] of sortedLevels) {
            const price = levelData.price;
            const pct = levelData.percentage;
            const conf = levelData.confidence;
            console.log(`${levelName}: $${price.toLocaleString()} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%) [${(conf * 100).toFixed(0)}%]`);
        }
    }
}

// ===== MAIN EXECUTION =====

async function main() {
    const analytics = new DeribitAnalytics();
    
    try {
        // Analyze BTC
        const btcResult = await analytics.getCompleteAnalysis("BTC");
        analytics.formatResults(btcResult);
        
        // Analyze ETH
        const ethResult = await analytics.getCompleteAnalysis("ETH");
        analytics.formatResults(ethResult);
        
        return { btc: btcResult, eth: ethResult };
    } catch (error) {
        console.error("Analysis failed:", error);
        throw error;
    }
}

// Export for use in other modules or run directly
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DeribitAnalytics, main };
}

// Run if called directly
if (typeof require !== 'undefined' && require.main === module) {
    main().catch(console.error);
} 
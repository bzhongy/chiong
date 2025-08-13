/**
 * Deribit Analytics - Enhanced Cloudflare Worker Version
 * Feature-complete implementation matching Python v3_with_flow
 * Zero dependencies, optimized for serverless deployment
 */

class DeribitAnalytics {
    constructor(baseUrl = "https://deribit.com/api/v2") {
        this.baseUrl = baseUrl;
    }

    // ===== UTILITY FUNCTIONS =====

    /**
     * Fetch with retry logic using Cloudflare Worker fetch API
     */
    async fetchWithRetry(url, params = {}, maxRetries = 3) {
        const queryString = new URLSearchParams(params).toString();
        const fullUrl = `${url}${queryString ? '?' + queryString : ''}`;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await fetch(fullUrl, {
                    method: 'GET',
                    headers: {
                        'User-Agent': 'Cloudflare Worker Analytics Client',
                        'Accept': 'application/json'
                    }
                });

                if (response.status === 429) {
                    const waitTime = Math.pow(2, attempt) * 1000;
                    console.log(`Rate limited, waiting ${waitTime/1000}s before retry ${attempt + 1}`);
                    await this.sleep(waitTime);
                    continue;
                }

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json();
                return data.result || data;
            } catch (error) {
                if (attempt === maxRetries - 1) {
                    console.error(`Failed to fetch ${url} after ${maxRetries} attempts:`, error.message);
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
     * Improved Abramowitz and Stegun approximation
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
     * Enhanced Black-Scholes Delta calculation matching Python implementation
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
     * Simplified delta calculation matching Python's moneyness approach
     */
    calculateSimplifiedDelta(spot, strike, optionType) {
        const moneyness = spot / strike;
        
        if (optionType === 'C') {  // Call
            return Math.max(0.05, Math.min(0.95, 0.5 + 0.4 * (moneyness - 1)));
        } else {  // Put
            return Math.max(0.05, Math.min(0.95, 0.5 - 0.4 * (moneyness - 1)));
        }
    }

    /**
     * Black-Scholes gamma calculation
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
     * Fetch options trades with time range (matching Python implementation)
     */
    async fetchOptionsTrades(currency = "BTC", hoursBack = 24) {
        const url = `${this.baseUrl}/public/get_last_trades_by_currency_and_time`;
        
        // Calculate time range
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - (hoursBack * 60 * 60 * 1000));
        
        const params = {
            currency,
            kind: "option",
            start_timestamp: startTime.getTime(),
            end_timestamp: endTime.getTime(),
            count: 1000,
            sorting: "desc"
        };
        
        const result = await this.fetchWithRetry(url, params);
        
        // Handle response structure
        let trades = [];
        if (Array.isArray(result)) {
            trades = result;
        } else if (result?.trades) {
            trades = result.trades;
        }
        
        console.log(`Fetched ${trades.length} options trades for ${currency}`);
        return trades;
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
            
            // Round price to create levels (matching Python logic)
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
     * Enhanced options flow analysis matching Python v3_with_flow
     */
    analyzeOptionsFlow(optionsTrades, spotPrice) {
        if (!optionsTrades || optionsTrades.length === 0) {
            return {};
        }

        console.log(`Analyzing ${optionsTrades.length} options trades for flow patterns...`);

        const strikeFlow = new Map();
        let totalVolume = 0;

        for (const trade of optionsTrades) {
            try {
                const parsed = this.parseInstrument(trade.instrument_name);
                if (!parsed) continue;

                const amount = trade.amount || 0;
                const price = trade.price || 0;
                const direction = trade.direction || "";
                const timestamp = trade.timestamp || 0;

                if (amount <= 0 || price <= 0) continue;

                // Calculate notional value (premium paid)
                const notional = amount * price * spotPrice; // Convert to USD
                totalVolume += notional;

                // Time weighting - exponential decay with 12-hour half-life (matching Python)
                const hoursAgo = (Date.now() - timestamp) / (1000 * 60 * 60);
                const timeWeight = Math.exp(-hoursAgo / 12); // 12-hour half-life

                // Calculate delta-adjusted exposure using simplified delta (matching Python)
                const approxDelta = this.calculateSimplifiedDelta(spotPrice, parsed.strike, parsed.optionType);
                const deltaExposure = notional * approxDelta;

                // Flow direction (positive = buying pressure, negative = selling pressure)
                const flowDirection = direction === "buy" ? 1 : -1;

                const key = parsed.strike;
                if (!strikeFlow.has(key)) {
                    strikeFlow.set(key, {
                        totalVolume: 0,
                        netFlow: 0,
                        callVolume: 0,
                        putVolume: 0,
                        weightedFlow: 0
                    });
                }

                const data = strikeFlow.get(key);
                data.totalVolume += notional;
                data.netFlow += deltaExposure * flowDirection;
                data.weightedFlow += deltaExposure * flowDirection * timeWeight;

                if (parsed.optionType === 'C') {
                    data.callVolume += notional;
                } else {
                    data.putVolume += notional;
                }

            } catch (error) {
                continue;
            }
        }

        if (strikeFlow.size === 0) {
            return {};
        }

        console.log(`Processed $${totalVolume.toLocaleString()} in total options volume across ${strikeFlow.size} strikes`);

        const levels = {};

        // 1. Highest Volume Strike (HVS) - strike with most trading activity
        let maxVolumeStrike = 0;
        let maxVolume = 0;
        
        for (const [strike, data] of strikeFlow) {
            if (data.totalVolume > maxVolume) {
                maxVolume = data.totalVolume;
                maxVolumeStrike = strike;
            }
        }
        
        if (maxVolumeStrike > 0) {
            levels["HVS"] = maxVolumeStrike;
        }

        // 2. Max Pain Flow - strike with most balanced call/put activity
        const balancedStrikes = [];
        for (const [strike, data] of strikeFlow) {
            if (data.callVolume > 0 && data.putVolume > 0) {
                const balanceRatio = Math.min(data.callVolume, data.putVolume) / Math.max(data.callVolume, data.putVolume);
                balancedStrikes.push([strike, balanceRatio, data.totalVolume]);
            }
        }

        if (balancedStrikes.length > 0) {
            // Sort by balance ratio, then by volume
            balancedStrikes.sort((a, b) => {
                if (b[1] !== a[1]) return b[1] - a[1]; // Balance ratio descending
                return b[2] - a[2]; // Volume descending
            });
            levels["Max Pain Flow"] = balancedStrikes[0][0];
        }

        // 3. Call Flow Resistance - strike above spot with highest weighted call flow
        const callResistanceStrikes = [];
        for (const [strike, data] of strikeFlow) {
            if (strike > spotPrice && data.callVolume > data.putVolume) {
                callResistanceStrikes.push([strike, data.weightedFlow]);
            }
        }

        if (callResistanceStrikes.length > 0) {
            callResistanceStrikes.sort((a, b) => b[1] - a[1]);
            levels["Call Flow Resistance"] = callResistanceStrikes[0][0];
        }

        // 4. Put Flow Support - strike below spot with highest weighted put flow
        const putSupportStrikes = [];
        for (const [strike, data] of strikeFlow) {
            if (strike < spotPrice && data.putVolume > data.callVolume) {
                putSupportStrikes.push([strike, Math.abs(data.weightedFlow)]);
            }
        }

        if (putSupportStrikes.length > 0) {
            putSupportStrikes.sort((a, b) => b[1] - a[1]);
            levels["Put Flow Support"] = putSupportStrikes[0][0];
        }

        // 5. Volume-Weighted Average Strike (VWAS)
        if (totalVolume > 0) {
            let vwas = 0;
            for (const [strike, data] of strikeFlow) {
                vwas += strike * data.totalVolume;
            }
            levels["VWAS"] = vwas / totalVolume;
        }

        return levels;
    }

    /**
     * Enhanced open interest levels calculation matching Python implementation
     */
    calculateOpenInterestLevels(bookData, spotPrice) {
        if (!bookData || bookData.length === 0) {
            return {};
        }

        const strikeData = new Map();
        const today = this.formatDateForExpiry(new Date());

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
                    deltaExposure: 0,
                    dte0OI: 0
                });
            }

            // Calculate delta-adjusted exposure using simplified delta (matching Python)
            const delta = this.calculateSimplifiedDelta(spotPrice, parsed.strike, parsed.optionType);
            const deltaExposure = openInterest * Math.abs(delta) * spotPrice;

            const data = strikeData.get(key);
            data.totalOI += openInterest;
            data.deltaExposure += deltaExposure;

            if (parsed.optionType === 'C') {
                data.callOI += openInterest;
            } else {
                data.putOI += openInterest;
            }

            // Check if it's 0DTE
            if (parsed.expiryStr === today) {
                data.dte0OI += openInterest;
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

        // 0DTE versions
        let maxCallOI0DTE = 0;
        let callResistance0DTE = 0;
        for (const [strike, data] of strikeData) {
            if (strike > spotPrice && data.dte0OI > 0 && data.callOI > maxCallOI0DTE) {
                maxCallOI0DTE = data.callOI;
                callResistance0DTE = strike;
            }
        }
        if (callResistance0DTE > 0) {
            levels["Call Resistance 0DTE"] = callResistance0DTE;
        }

        let maxPutOI0DTE = 0;
        let putSupport0DTE = 0;
        for (const [strike, data] of strikeData) {
            if (strike < spotPrice && data.dte0OI > 0 && data.putOI > maxPutOI0DTE) {
                maxPutOI0DTE = data.putOI;
                putSupport0DTE = strike;
            }
        }
        if (putSupport0DTE > 0) {
            levels["Put Support 0DTE"] = putSupport0DTE;
        }

        // Gamma Wall 0DTE - highest 0DTE OI
        let maxOdteOI = 0;
        let gammaWall = 0;
        for (const [strike, data] of strikeData) {
            if (data.dte0OI > maxOdteOI) {
                maxOdteOI = data.dte0OI;
                gammaWall = strike;
            }
        }
        if (gammaWall > 0) {
            levels["Gamma Wall 0DTE"] = gammaWall;
        }

        return levels;
    }

    // ===== MAIN ANALYSIS =====

    /**
     * Get complete analysis for a currency (matching Python get_all_levels)
     */
    async getCompleteAnalysis(currency = "BTC") {
        console.log(`\n=== Analyzing ${currency} ===`);

        // Fetch spot price
        const spotPrice = await this.fetchIndexPrice(currency);
        console.log(`Current ${currency} price: $${spotPrice.toLocaleString()}`);

        if (spotPrice <= 0) {
            throw new Error(`Failed to fetch spot price for ${currency}`);
        }

        // Fetch all data in parallel for efficiency
        const [bookData, futuresTrades, optionsTrades] = await Promise.all([
            this.fetchBookSummary(currency),
            this.fetchFuturesTrades(currency),
            this.fetchOptionsTrades(currency)
        ]);

        console.log(`Fetched ${bookData.length} instruments, ${futuresTrades.length} futures trades, ${optionsTrades.length} options trades`);

        // Calculate all levels
        const oiLevels = this.calculateOpenInterestLevels(bookData, spotPrice);
        const volumeLevels = this.calculateHVL(futuresTrades);
        const maxMinLevels = this.calculate1DMaxMin(futuresTrades);
        const flowLevels = this.analyzeOptionsFlow(optionsTrades, spotPrice);

        // Combine all levels
        const allLevels = {
            ...oiLevels,
            ...volumeLevels,
            ...maxMinLevels,
            ...flowLevels
        };

        // Calculate percentage distances from spot (matching Python format)
        const result = {
            currency,
            spot_price: spotPrice,
            levels: {},
            timestamp: new Date().toISOString(),
            metadata: {
                instruments_analyzed: bookData.length,
                futures_trades: futuresTrades.length,
                options_trades: optionsTrades.length
            }
        };

        for (const [levelName, levelPrice] of Object.entries(allLevels)) {
            if (levelPrice && levelPrice > 0) {
                const pctChange = ((levelPrice - spotPrice) / spotPrice) * 100;
                result.levels[levelName] = {
                    price: levelPrice,
                    percentage: pctChange
                };
            }
        }

        return result;
    }
}

// ===== CLOUDFLARE WORKER EVENT HANDLER =====

addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Max-Age': '86400',
            }
        });
    }

    try {
        const url = new URL(request.url);
        const currency = url.searchParams.get('currency') || 'BTC';
        
        // Validate currency parameter
        if (!['BTC', 'ETH'].includes(currency.toUpperCase())) {
            return new Response(JSON.stringify({
                error: 'Invalid currency. Supported: BTC, ETH'
            }), {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }

        const analytics = new DeribitAnalytics();
        const result = await analytics.getCompleteAnalysis(currency.toUpperCase());

        return new Response(JSON.stringify(result, null, 2), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=60' // Cache for 1 minute
            }
        });

    } catch (error) {
        console.error('Worker error:', error);
        
        return new Response(JSON.stringify({
            error: 'Analysis failed',
            message: error.message,
            timestamp: new Date().toISOString()
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}

// ===== EXAMPLE USAGE ENDPOINTS =====

/**
 * Example API endpoints:
 * 
 * GET /                    - BTC analysis (default)
 * GET /?currency=BTC       - BTC analysis
 * GET /?currency=ETH       - ETH analysis
 * 
 * Response format:
 * {
 *   "currency": "BTC",
 *   "spot_price": 104850.31,
 *   "levels": {
 *     "Call Resistance": { "price": 140000, "percentage": 33.52 },
 *     "Put Support": { "price": 100000, "percentage": -4.63 },
 *     "HVL": { "price": 104910, "percentage": 0.06 },
 *     "1D Max": { "price": 110687.5, "percentage": 5.57 },
 *     "1D Min": { "price": 104801, "percentage": -0.05 },
 *     "HVS": { "price": 100000, "percentage": -4.63 },
 *     "Max Pain Flow": { "price": 106000, "percentage": 1.10 },
 *     "Call Flow Resistance": { "price": 112000, "percentage": 6.82 },
 *     "Put Flow Support": { "price": 100000, "percentage": -4.63 },
 *     "VWAS": { "price": 107098.09, "percentage": 2.14 },
 *     "Gamma Wall 0DTE": { "price": 105000, "percentage": 0.14 }
 *   },
 *   "timestamp": "2024-12-XX...",
 *   "metadata": {
 *     "instruments_analyzed": 756,
 *     "futures_trades": 999,
 *     "options_trades": 999
 *   }
 * }
 */ 
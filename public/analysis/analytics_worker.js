/**
 * Deribit Analytics v4 Comprehensive - Cloudflare Worker Version
 * Features:
 * - Tiered caching: Local cache -> KV cache -> API
 * - Background refresh when data is stale
 * - 5-minute TTL with immediate response on stale data
 * - Professional-grade analytics with 17+ indicators
 */

// Local cache (per-worker instance)
const localCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
const BACKGROUND_REFRESH_THRESHOLD = 4 * 60 * 1000; // 4 minutes - start refresh early

class DeribitAnalyticsV4Worker {
    constructor(kv, baseUrl = "https://www.deribit.com/api/v2") {
        this.baseUrl = baseUrl;
        this.kv = kv;
        this.rateLimitDelay = 100; // Reduced from 200ms to 100ms for better performance
    }

    // ===== CACHING SYSTEM =====

    getCacheKey(method, params = {}) {
        const paramString = Object.keys(params)
            .sort()
            .map(key => `${key}=${params[key]}`)
            .join('&');
        return `${method}:${paramString}`;
    }

    async getFromLocalCache(cacheKey) {
        const cached = localCache.get(cacheKey);
        if (!cached) return null;
        
        const now = Date.now();
        const age = now - cached.timestamp;
        
        if (age > CACHE_TTL) {
            localCache.delete(cacheKey);
            return null;
        }
        
        return {
            data: cached.data,
            age,
            source: 'local'
        };
    }

    async getFromKVCache(cacheKey) {
        try {
            const cached = await this.kv.get(cacheKey, 'json');
            if (!cached) return null;
            
            const now = Date.now();
            const age = now - cached.timestamp;
            
            if (age > CACHE_TTL) {
                // Delete expired KV entry
                await this.kv.delete(cacheKey);
                return null;
            }
            
            // Store in local cache for faster access
            localCache.set(cacheKey, cached);
            
            return {
                data: cached.data,
                age,
                source: 'kv'
            };
        } catch (error) {
            console.error('KV cache error:', error);
            return null;
        }
    }

    async setCache(cacheKey, data) {
        const cacheEntry = {
            data,
            timestamp: Date.now()
        };
        
        // Set local cache
        localCache.set(cacheKey, cacheEntry);
        
        // Set KV cache (fire and forget)
        try {
            await this.kv.put(cacheKey, JSON.stringify(cacheEntry), {
                expirationTtl: Math.ceil(CACHE_TTL / 1000) + 60 // KV TTL slightly longer
            });
        } catch (error) {
            console.error('KV cache write error:', error);
        }
    }

    async fetchWithCache(url, params = {}, cacheKey = null) {
        if (!cacheKey) {
            cacheKey = this.getCacheKey(url, params);
        }
        
        console.log(`fetchWithCache called - URL: ${url}, params:`, params, `cacheKey: ${cacheKey}`);
        
        // Check local cache first
        let cached = await this.getFromLocalCache(cacheKey);
        
        // Check KV cache if local miss
        if (!cached) {
            cached = await this.getFromKVCache(cacheKey);
        }
        
        // If we have cached data, check if we need background refresh
        if (cached) {
            const needsRefresh = cached.age > BACKGROUND_REFRESH_THRESHOLD;
            
            console.log(`Cache hit from ${cached.source}, age: ${Math.round(cached.age/1000)}s, needsRefresh: ${needsRefresh}`);
            
            if (needsRefresh) {
                // Start background refresh (no await)
                this.backgroundRefresh(url, params, cacheKey);
            }
            
            return {
                ...cached.data,
                _cache: {
                    hit: true,
                    source: cached.source,
                    age: Math.round(cached.age / 1000)
                }
            };
        }
        
        console.log(`Cache miss for ${cacheKey}, fetching fresh data`);
        // No cache hit, fetch fresh data
        return await this.fetchFresh(url, params, cacheKey);
    }

    async backgroundRefresh(url, params, cacheKey) {
        try {
            console.log(`Background refresh started for ${cacheKey}`);
            const freshData = await this.fetchFresh(url, params, cacheKey, false);
            console.log(`Background refresh completed for ${cacheKey}`);
        } catch (error) {
            console.error(`Background refresh failed for ${cacheKey}:`, error);
        }
    }

    async fetchFresh(url, params = {}, cacheKey = null, logFetch = true) {
        if (logFetch) {
            console.log(`Fetching fresh data for ${cacheKey || url}`);
        }
        
        const data = await this.fetchWithRetry(url, params);
        
        if (cacheKey && data) {
            await this.setCache(cacheKey, data);
        }
        
        return {
            ...data,
            _cache: {
                hit: false,
                source: 'api',
                age: 0
            }
        };
    }

    // ===== NETWORK FUNCTIONS =====

    async fetchWithRetry(url, params = {}, maxRetries = 3) {
        const queryString = new URLSearchParams(params).toString();
        const fullUrl = `${url}${queryString ? '?' + queryString : ''}`;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                await this.sleep(this.rateLimitDelay);
                
                const response = await fetch(fullUrl, {
                    headers: {
                        'User-Agent': 'Analytics Client v4 Comprehensive Worker',
                        'Accept': 'application/json'
                    }
                });

                if (!response.ok) {
                    if (response.status === 429) {
                        const waitTime = Math.pow(2, attempt) * 1000;
                        console.log(`Rate limited, waiting ${waitTime/1000}s...`);
                        await this.sleep(waitTime);
                        continue;
                    }
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json();
                
                // Simple logic matching the working version
                return data.result || data;
            } catch (error) {
                if (attempt === maxRetries - 1) {
                    console.error(`Failed after ${maxRetries} attempts:`, error.message);
                    throw error;
                }
                await this.sleep(1000);
            }
        }
        return null;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ===== DATA FETCHING METHODS =====

    async fetchIndexPrice(currency = "BTC") {
        const url = `${this.baseUrl}/public/get_index_price`;
        const params = { index_name: `${currency.toLowerCase()}_usd` };
        const cacheKey = `index_price:${currency}`;
        
        const result = await this.fetchWithCache(url, params, cacheKey);
        return result?.index_price || 0;
    }

    async fetch24hStats(currency = "BTC") {
        const url = `${this.baseUrl}/public/get_book_summary_by_currency`;
        const params = { currency, kind: "future" };
        
        const data = await this.fetchWithRetry(url, params);
        
        if (Array.isArray(data)) {
            for (const instrument of data) {
                if (instrument.instrument_name?.endsWith("-PERPETUAL")) {
                    return {
                        high_24h: instrument.high || 0,
                        low_24h: instrument.low || 0,
                        last_price: instrument.last || 0
                    };
                }
            }
        }
        
        return { high_24h: 0, low_24h: 0, last_price: 0 };
    }

    async fetchCompleteOptionsTrades(currency = "BTC", hoursBack = 24, chunkHours = 4) {
        const cacheKey = `options_trades:${currency}:${hoursBack}h`;
        
        // Check cache first
        let cached = await this.getFromLocalCache(cacheKey);
        if (!cached) {
            cached = await this.getFromKVCache(cacheKey);
        }
        
        if (cached) {
            const needsRefresh = cached.age > BACKGROUND_REFRESH_THRESHOLD;
            if (needsRefresh) {
                // Background refresh
                this.fetchOptionsTradesBackground(currency, hoursBack, chunkHours, cacheKey);
            }
            return cached.data;
        }
        
        // Fetch fresh with smaller chunks for better parallelism
        return await this.fetchOptionsTradesFresh(currency, hoursBack, 3, cacheKey); // Reduced from 4 to 3 hours
    }

    async fetchOptionsTradesBackground(currency, hoursBack, chunkHours, cacheKey) {
        try {
            const freshData = await this.fetchOptionsTradesFresh(currency, hoursBack, 3, cacheKey, false); // Reduced chunk size
        } catch (error) {
            console.error(`Background options trades refresh failed:`, error);
        }
    }

    // ===== ENHANCED PARALLEL CHUNK FETCHING =====

    async fetchChunksInParallel(baseUrl, baseParams, totalChunks, chunkHours, hoursBack, maxConcurrency = 3) {
        const endTime = new Date();
        const uniqueTrades = new Map();
        
        // Create chunk parameters
        const chunkParams = [];
        for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
            const chunkStartHours = chunkIdx * chunkHours;
            const chunkEndHours = Math.min((chunkIdx + 1) * chunkHours, hoursBack);
            
            const chunkEnd = new Date(endTime.getTime() - chunkStartHours * 60 * 60 * 1000);
            const chunkStart = new Date(endTime.getTime() - chunkEndHours * 60 * 60 * 1000);
            
            chunkParams.push({
                ...baseParams,
                start_timestamp: chunkStart.getTime(),
                end_timestamp: chunkEnd.getTime(),
                count: 1000,
                sorting: "desc",
                chunkIdx
            });
        }
        
        // Fetch chunks in parallel with controlled concurrency
        const fetchChunk = async (params, index) => {
            // Optimized stagger - reduced delay for better performance
            await this.sleep(index * 25); // Reduced from 50ms to 25ms stagger
            
            const result = await this.fetchWithRetry(baseUrl, params);
            
            let chunkTrades = [];
            if (result && typeof result === 'object') {
                chunkTrades = result.trades || [];
                if (result.has_more) {
                    console.log(`  ⚠️  Chunk ${params.chunkIdx + 1} has more data (may need smaller chunks)`);
                }
            } else if (Array.isArray(result)) {
                chunkTrades = result;
            }
            
            return { trades: chunkTrades, chunkIdx: params.chunkIdx };
        };
        
        // Process chunks in batches to control concurrency
        const results = [];
        for (let i = 0; i < chunkParams.length; i += maxConcurrency) {
            const batch = chunkParams.slice(i, i + maxConcurrency);
            const batchPromises = batch.map((params, index) => fetchChunk(params, index));
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);
            
            // Reduced delay between batches for better performance
            if (i + maxConcurrency < chunkParams.length) {
                await this.sleep(50); // Reduced from 100ms to 50ms
            }
        }
        
        // Deduplicate trades
        for (const chunkResult of results) {
            for (const trade of chunkResult.trades) {
                const tradeId = trade.trade_id;
                if (tradeId && !uniqueTrades.has(tradeId)) {
                    uniqueTrades.set(tradeId, trade);
                }
            }
        }
        
        return Array.from(uniqueTrades.values());
    }

    async fetchOptionsTradesFresh(currency, hoursBack, chunkHours, cacheKey, logFetch = true) {
        if (logFetch) {
            console.log(`Fetching fresh options trades for ${currency} (${hoursBack}h) - PARALLEL MODE`);
        }
        
        const totalChunks = Math.ceil(hoursBack / chunkHours);
        const baseParams = {
            currency,
            kind: "option"
        };
        
        console.log(`Using ${totalChunks} chunks in parallel for options trades`);
        
        const url = `${this.baseUrl}/public/get_last_trades_by_currency_and_time`;
        const finalTrades = await this.fetchChunksInParallel(url, baseParams, totalChunks, chunkHours, hoursBack);
        
        if (cacheKey) {
            await this.setCache(cacheKey, finalTrades);
        }
        
        console.log(`Collected ${finalTrades.length} unique options trades`);
        return finalTrades;
    }

    async fetchInstrumentsSummary(currency = "BTC") {
        const url = `${this.baseUrl}/public/get_book_summary_by_currency`;
        const params = { currency, kind: "option" };
        
        console.log(`Fetching instruments summary for ${currency}...`);
        const data = await this.fetchWithRetry(url, params);
        
        if (!Array.isArray(data)) {
            console.log(`Expected list of instruments, got: ${typeof data}`);
            return [];
        }
        
        console.log(`Found ${data.length} option instruments`);
        
        const enhancedInstruments = [];
        for (const instrument of data) {
            const parsed = this.parseInstrumentName(instrument.instrument_name || "");
            if (parsed) {
                enhancedInstruments.push({
                    ...instrument,
                    ...parsed,
                    open_interest: instrument.open_interest || 0,
                    volume: instrument.volume || 0
                });
            }
        }
        
        console.log(`Enhanced ${enhancedInstruments.length} instruments with summary data`);
        return enhancedInstruments;
    }

    async fetchCompleteFuturesTrades(currency = "BTC", hoursBack = 24, chunkHours = 4) {
        const cacheKey = `futures_trades:${currency}:${hoursBack}h`;
        
        // Check cache first
        let cached = await this.getFromLocalCache(cacheKey);
        if (!cached) {
            cached = await this.getFromKVCache(cacheKey);
        }
        
        if (cached) {
            const needsRefresh = cached.age > BACKGROUND_REFRESH_THRESHOLD;
            if (needsRefresh) {
                // Background refresh
                this.fetchFuturesTradesBackground(currency, hoursBack, chunkHours, cacheKey);
            }
            return cached.data;
        }
        
        // Fetch fresh with smaller chunks for better parallelism
        return await this.fetchFuturesTradesFresh(currency, hoursBack, 3, cacheKey); // Reduced from 4 to 3 hours
    }

    async fetchFuturesTradesBackground(currency, hoursBack, chunkHours, cacheKey) {
        try {
            await this.fetchFuturesTradesFresh(currency, hoursBack, 3, cacheKey, false); // Reduced chunk size
        } catch (error) {
            console.error(`Background futures trades refresh failed:`, error);
        }
    }

    async fetchFuturesTradesFresh(currency, hoursBack, chunkHours, cacheKey, logFetch = true) {
        if (logFetch) {
            console.log(`Fetching fresh futures trades for ${currency} (${hoursBack}h) - PARALLEL MODE`);
        }
        
        const totalChunks = Math.ceil(hoursBack / chunkHours);
        const baseParams = {
            currency,
            kind: "future"
        };
        
        console.log(`Using ${totalChunks} chunks in parallel for futures trades`);
        
        const url = `${this.baseUrl}/public/get_last_trades_by_currency_and_time`;
        const finalTrades = await this.fetchChunksInParallel(url, baseParams, totalChunks, chunkHours, hoursBack);
        
        if (cacheKey) {
            await this.setCache(cacheKey, finalTrades);
        }
        
        console.log(`Collected ${finalTrades.length} unique futures trades`);
        return finalTrades;
    }

    // ===== UTILITY FUNCTIONS =====

    parseInstrumentName(instrumentName) {
        const parts = instrumentName.split('-');
        if (parts.length !== 4) {
            // Don't log every failure, just return null
            return null;
        }
        
        const [currency, expiryStr, strikeStr, optionType] = parts;
        
        try {
            const strike = parseFloat(strikeStr);
            const expiryDate = this.parseExpiryDate(expiryStr);
            
            if (!expiryDate || isNaN(strike)) {
                return null;
            }
            
            return {
                currency,
                expiry_date: expiryDate,
                strike,
                option_type: optionType,
                is_call: optionType === "C",
                is_put: optionType === "P"
            };
        } catch (error) {
            return null;
        }
    }

    parseExpiryDate(expiryStr) {
        try {
            const months = {
                'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
                'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11
            };

            // Handle both single digit (2JUL25) and double digit (11JUL25) days
            let day, monthStr, yearStr;
            
            if (expiryStr.length === 6 && /^\d[A-Z]{3}\d{2}$/.test(expiryStr)) {
                // Single digit day: 2JUL25
                day = parseInt(expiryStr.slice(0, 1));
                monthStr = expiryStr.slice(1, 4);
                yearStr = expiryStr.slice(4);
            } else if (expiryStr.length === 7 && /^\d{2}[A-Z]{3}\d{2}$/.test(expiryStr)) {
                // Double digit day: 11JUL25
                day = parseInt(expiryStr.slice(0, 2));
                monthStr = expiryStr.slice(2, 5);
                yearStr = expiryStr.slice(5);
            } else {
                return null;
            }

            const month = months[monthStr];
            if (month === undefined) return null;
            
            const year = 2000 + parseInt(yearStr);

            return new Date(Date.UTC(year, month, day));
        } catch {
            return null;
        }
    }

    is0DTE(expiryDate) {
        if (!expiryDate) return false;
        
        const now = new Date();
        const expiryUtc8 = new Date(Date.UTC(
            expiryDate.getUTCFullYear(),
            expiryDate.getUTCMonth(),
            expiryDate.getUTCDate(),
            8, 0, 0
        ));
        
        const timeDiff = expiryUtc8.getTime() - now.getTime();
        return timeDiff > 0 && timeDiff <= 24 * 60 * 60 * 1000;
    }

    isCurrentWeeklyMonthly(expiryDate) {
        if (!expiryDate) return false;
        
        const now = new Date();
        let daysUntilFriday = (5 - now.getUTCDay() + 7) % 7;
        if (daysUntilFriday === 0) {
            daysUntilFriday = 7;
        }
        
        const nextFriday = new Date(now);
        nextFriday.setUTCDate(now.getUTCDate() + daysUntilFriday);
        
        return expiryDate.toDateString() === nextFriday.toDateString();
    }

    is1WExpiry(expiryDate) {
        if (!expiryDate) return false;
        const now = new Date();
        const daysDiff = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return daysDiff >= 5 && daysDiff <= 12;
    }

    is1MExpiry(expiryDate) {
        if (!expiryDate) return false;
        const now = new Date();
        const daysDiff = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return daysDiff >= 20 && daysDiff <= 40;
    }

    calculateDistanceToSpot(level, spotPrice) {
        return ((level - spotPrice) / spotPrice) * 100;
    }

    calculateDeltaSimple(spotPrice, strike, timeToExpiry, isCall, iv = 0.6) {
        if (timeToExpiry <= 0) {
            return (isCall && spotPrice > strike) || (!isCall && spotPrice < strike) ? 1.0 : 0.0;
        }
        
        const moneyness = spotPrice / strike;
        
        if (isCall) {
            return Math.max(0.05, Math.min(0.95, 0.5 + 0.4 * (moneyness - 1)));
        } else {
            return Math.max(0.05, Math.min(0.95, 0.5 - 0.4 * (moneyness - 1)));
        }
    }

    // ===== ANALYTICS METHODS (simplified for worker) =====

    calculate1DLevels(stats24h) {
        return [stats24h.high_24h || 0, stats24h.low_24h || 0];
    }

    calculateVolumeProfileLevels(trades, spotPrice, currency) {
        if (!trades || trades.length === 0) return [];
        
        const priceLevels = {};
        
        for (const trade of trades) {
            const price = trade.price || 0;
            const amount = trade.amount || 0;
            
            if (price <= 0 || amount <= 0) continue;
            
            const level = price > 1000 ? Math.round(price / 10) * 10 : Math.round(price * 10) / 10;
            priceLevels[level] = (priceLevels[level] || 0) + amount;
        }
        
        if (Object.keys(priceLevels).length === 0) return [];
        
        const entries = Object.entries(priceLevels);
        const [hvlPrice, hvlVolume] = entries.reduce((max, current) => 
            current[1] > max[1] ? current : max
        );
        
        return [{ level: "HVL", price: parseFloat(hvlPrice), volume: hvlVolume }];
    }

    // Comprehensive option levels calculation matching the original
    async calculateOptionLevels(instruments, spotPrice) {
        console.log(`calculateOptionLevels called with ${instruments?.length || 0} instruments, spotPrice: ${spotPrice}`);
        
        if (!instruments || instruments.length === 0) {
            console.log('No instruments provided to calculateOptionLevels');
            return { levels: {}, put_call_ratios: {}, iv_data: {} };
        }
        
        console.log(`Calculating option levels for ${instruments.length} instruments...`);
        
        // Group instruments by timeframe
        const currentInstruments = [];
        const dte0Instruments = [];
        const week1Instruments = [];
        const month1Instruments = [];
        
        for (const instrument of instruments) {
            const expiryDate = instrument.expiry_date;
            if (!expiryDate) continue;
            
            if (this.is0DTE(expiryDate)) {
                dte0Instruments.push(instrument);
            } else if (this.isCurrentWeeklyMonthly(expiryDate)) {
                currentInstruments.push(instrument);
            } else if (this.is1WExpiry(expiryDate)) {
                week1Instruments.push(instrument);
            } else if (this.is1MExpiry(expiryDate)) {
                month1Instruments.push(instrument);
            } else {
                currentInstruments.push(instrument); // Default to current
            }
        }
        
        // Helper functions
        const getAvgIV = (ivList, fallback = 60.0) => {
            const validIVs = ivList.filter(iv => iv > 0);
            return validIVs.length > 0 ? validIVs.reduce((a, b) => a + b) / validIVs.length : fallback;
        };
        
        const calculateDynamicBand = (ivPct, timeToExpiryDays) => {
            const baseBand = Math.max(10.0, Math.min(50.0, ivPct * 0.3));
            
            let timeFactor;
            if (timeToExpiryDays <= 1) {
                timeFactor = 1.0;
            } else if (timeToExpiryDays <= 7) {
                timeFactor = 1.2;
            } else {
                timeFactor = Math.min(2.0, 1.0 + (timeToExpiryDays - 7) / 20);
            }
            
            return baseBand * timeFactor;
        };
        
        // Calculate ATM IVs for each timeframe
        const calculateATMIV = (instrumentsList) => {
            if (!instrumentsList || instrumentsList.length === 0) return 50.0;
            
            const atmIVs = [];
            for (const inst of instrumentsList) {
                const strike = inst.strike || 0;
                if (Math.abs(strike - spotPrice) / spotPrice < 0.05) { // Within 5% of ATM
                    const iv = inst.mark_iv || 0;
                    if (iv > 0) {
                        atmIVs.push(iv);
                    }
                }
            }
            
            return getAvgIV(atmIVs, 50.0);
        };
        
        const currentIV = calculateATMIV(currentInstruments);
        const dte0IV = calculateATMIV(dte0Instruments);
        const week1IV = calculateATMIV(week1Instruments);
        const month1IV = calculateATMIV(month1Instruments);
        
        console.log(`ATM IVs - Current: ${currentIV.toFixed(1)}%, 0DTE: ${dte0IV.toFixed(1)}%, 1W: ${week1IV.toFixed(1)}%, 1M: ${month1IV.toFixed(1)}%`);
        
        // Calculate dynamic bands
        const currentBand = calculateDynamicBand(currentIV, 7);
        const dte0Band = calculateDynamicBand(dte0IV, 0.1);
        const week1Band = calculateDynamicBand(week1IV, 7);
        const month1Band = calculateDynamicBand(month1IV, 30);
        
        // Strike filtering functions
        const filterCallStrikes = (strikesDict, band) => {
            const filteredItems = [];
            for (const [strike, oi] of Object.entries(strikesDict)) {
                const strikeNum = parseFloat(strike);
                if (strikeNum > spotPrice && strikeNum <= spotPrice * (1 + band/100)) {
                    filteredItems.push([strikeNum, oi]);
                }
            }
            
            filteredItems.sort((a, b) => a[0] - b[0]);
            return Object.fromEntries(filteredItems.slice(0, 10));
        };
        
        const filterPutStrikes = (strikesDict, band) => {
            const filteredItems = [];
            for (const [strike, oi] of Object.entries(strikesDict)) {
                const strikeNum = parseFloat(strike);
                if (strikeNum < spotPrice && strikeNum >= spotPrice * (1 - band/100)) {
                    filteredItems.push([strikeNum, oi]);
                }
            }
            
            filteredItems.sort((a, b) => b[0] - a[0]);
            return Object.fromEntries(filteredItems.slice(0, 10));
        };
        
        // Process each timeframe
        const processTimeframe = (instrumentsList, timeframeName, band) => {
            const callStrikes = {};
            const putStrikes = {};
            
            for (const instrument of instrumentsList) {
                const strike = instrument.strike || 0;
                const oi = instrument.open_interest || 0;
                
                if (oi <= 0) continue;
                
                if (instrument.is_call) {
                    callStrikes[strike] = (callStrikes[strike] || 0) + oi;
                } else {
                    putStrikes[strike] = (putStrikes[strike] || 0) + oi;
                }
            }
            
            // Filter strikes by dynamic bands
            const filteredCalls = filterCallStrikes(callStrikes, band);
            const filteredPuts = filterPutStrikes(putStrikes, band);
            
            // Find resistance and support levels
            const levels = {};
            
            if (Object.keys(filteredCalls).length > 0) {
                const callResistance = Object.entries(filteredCalls)
                    .reduce((max, current) => current[1] > max[1] ? current : max)[0];
                levels[`Call Resistance${timeframeName ? ' ' + timeframeName : ''}`] = parseFloat(callResistance);
            }
            
            if (Object.keys(filteredPuts).length > 0) {
                const putSupport = Object.entries(filteredPuts)
                    .reduce((max, current) => current[1] > max[1] ? current : max)[0];
                levels[`Put Support${timeframeName ? ' ' + timeframeName : ''}`] = parseFloat(putSupport);
            }
            
            const callOI = Object.values(filteredCalls).reduce((sum, oi) => sum + oi, 0);
            const putOI = Object.values(filteredPuts).reduce((sum, oi) => sum + oi, 0);
            
            return {
                levels,
                callCount: Object.keys(filteredCalls).length,
                putCount: Object.keys(filteredPuts).length,
                callOI,
                putOI
            };
        };
        
        // Calculate Put/Call ratio helper
        const calcPCRatio = (callOI, putOI) => putOI > 0 && callOI > 0 ? putOI / callOI : 0;
        
        // Process all timeframes
        const allLevels = {};
        const pcRatios = {};
        
        const currentResult = processTimeframe(currentInstruments, "", currentBand);
        Object.assign(allLevels, currentResult.levels);
        pcRatios["Current"] = calcPCRatio(currentResult.callOI, currentResult.putOI);
        
        const dte0Result = processTimeframe(dte0Instruments, "0DTE", dte0Band);
        Object.assign(allLevels, dte0Result.levels);
        pcRatios["0DTE"] = calcPCRatio(dte0Result.callOI, dte0Result.putOI);
        
        const week1Result = processTimeframe(week1Instruments, "1W", week1Band);
        Object.assign(allLevels, week1Result.levels);
        pcRatios["1W"] = calcPCRatio(week1Result.callOI, week1Result.putOI);
        
        const month1Result = processTimeframe(month1Instruments, "1M", month1Band);
        Object.assign(allLevels, month1Result.levels);
        pcRatios["1M"] = calcPCRatio(month1Result.callOI, month1Result.putOI);
        
        // Gamma Wall calculation (0DTE focus)
        const gammaWallData = this.calculateGammaWall(dte0Instruments, spotPrice);
        Object.assign(allLevels, gammaWallData);
        
        console.log(`Put/Call ratios - Current: ${pcRatios['Current'].toFixed(2)}, 0DTE: ${pcRatios['0DTE'].toFixed(2)}, 1W: ${pcRatios['1W'].toFixed(2)}, 1M: ${pcRatios['1M'].toFixed(2)}`);
        
        return {
            levels: allLevels,
            put_call_ratios: pcRatios,
            iv_data: {
                current: currentIV,
                dte0: dte0IV,
                week1: week1IV,
                month1: month1IV
            }
        };
    }

    calculateGammaWall(instruments, spotPrice) {
        if (!instruments || instruments.length === 0) return {};
        
        const strikeGamma = {};
        
        for (const instrument of instruments) {
            const strike = instrument.strike || 0;
            const oi = instrument.open_interest || 0;
            
            if (oi <= 0) continue;
            
            // Simple gamma approximation (higher near ATM)
            const moneyness = Math.abs(spotPrice - strike) / spotPrice;
            const gammaWeight = Math.max(0.1, 1.0 - moneyness * 5); // Decays quickly away from ATM
            
            // Calls have positive gamma for dealers (short), puts negative
            let gammaContribution = gammaWeight * oi;
            if (!instrument.is_call) {
                gammaContribution *= -1;
            }
            
            strikeGamma[strike] = (strikeGamma[strike] || 0) + gammaContribution;
        }
        
        if (Object.keys(strikeGamma).length === 0) return {};
        
        // Find strike with largest net gamma
        const [gammaWallStrike, gammaWallValue] = Object.entries(strikeGamma)
            .reduce((max, current) => Math.abs(current[1]) > Math.abs(max[1]) ? current : max);
        
        const gammaType = parseFloat(gammaWallValue) < 0 ? "Short Gamma" : "Long Gamma";
        
        return {
            [`Gamma Wall (${gammaType})`]: parseFloat(gammaWallStrike)
        };
    }

    analyzeCompleteOptionsFlow(trades, spotPrice) {
        if (!trades || trades.length === 0) return {};
        
        console.log(`Analyzing ${trades.length} options trades for flow patterns...`);
        
        const strikeFlow = {};
        let totalVolume = 0;
        
        for (const trade of trades) {
            try {
                const instrument = trade.instrument_name || "";
                if (!instrument) continue;
                
                const parts = instrument.split("-");
                if (parts.length < 4) continue;
                
                const strike = parseFloat(parts[2]);
                const optionType = parts[3];
                const amount = trade.amount || 0;
                const price = trade.price || 0;
                const direction = trade.direction || "";
                const timestamp = trade.timestamp || 0;
                
                if (amount <= 0 || price <= 0) continue;
                
                // Calculate notional value
                const notional = amount * price * spotPrice;
                totalVolume += notional;
                
                // Time weighting - exponential decay
                const nowTimestamp = new Date().getTime();
                const hoursAgo = (nowTimestamp - timestamp) / (1000 * 60 * 60);
                const timeWeight = Math.exp(-hoursAgo / 12); // 12-hour half-life
                
                // Delta-adjusted exposure
                const isCall = optionType === 'C';
                const delta = this.calculateDeltaSimple(spotPrice, strike, 1/365, isCall);
                const deltaExposure = notional * delta;
                
                // Flow direction
                const flowDirection = direction === "buy" ? 1 : -1;
                
                if (!strikeFlow[strike]) {
                    strikeFlow[strike] = {
                        total_volume: 0,
                        net_flow: 0,
                        call_volume: 0,
                        put_volume: 0,
                        weighted_flow: 0
                    };
                }
                
                const data = strikeFlow[strike];
                data.total_volume += notional;
                data.net_flow += deltaExposure * flowDirection;
                data.weighted_flow += deltaExposure * flowDirection * timeWeight;
                
                if (isCall) {
                    data.call_volume += notional;
                } else {
                    data.put_volume += notional;
                }
                
            } catch (e) {
                continue;
            }
        }
        
        if (Object.keys(strikeFlow).length === 0) return {};
        
        console.log(`Processed $${totalVolume.toLocaleString()} in total options volume`);
        
        // Calculate flow levels
        const levels = {};
        
        // 1. Highest Volume Strike (HVS)
        const hvsEntry = Object.entries(strikeFlow)
            .reduce((max, current) => current[1].total_volume > max[1].total_volume ? current : max);
        levels["HVS"] = parseFloat(hvsEntry[0]);
        
        // 2. Max Pain Flow
        const balancedStrikes = [];
        for (const [strike, data] of Object.entries(strikeFlow)) {
            if (data.call_volume > 0 && data.put_volume > 0) {
                const balanceRatio = Math.min(data.call_volume, data.put_volume) / Math.max(data.call_volume, data.put_volume);
                balancedStrikes.push([parseFloat(strike), balanceRatio, data.total_volume]);
            }
        }
        
        if (balancedStrikes.length > 0) {
            balancedStrikes.sort((a, b) => {
                if (b[1] !== a[1]) return b[1] - a[1];
                return b[2] - a[2];
            });
            levels["Max Pain Flow"] = balancedStrikes[0][0];
        }
        
        // 3. Call Flow Resistance
        const callResistance = [];
        for (const [strike, data] of Object.entries(strikeFlow)) {
            const strikeNum = parseFloat(strike);
            if (strikeNum > spotPrice && data.call_volume > data.put_volume) {
                callResistance.push([strikeNum, data.weighted_flow]);
            }
        }
        
        if (callResistance.length > 0) {
            callResistance.sort((a, b) => b[1] - a[1]);
            levels["Call Flow Resistance"] = callResistance[0][0];
        }
        
        // 4. Put Flow Support
        const putSupport = [];
        for (const [strike, data] of Object.entries(strikeFlow)) {
            const strikeNum = parseFloat(strike);
            if (strikeNum < spotPrice && data.put_volume > data.call_volume) {
                putSupport.push([strikeNum, Math.abs(data.weighted_flow)]);
            }
        }
        
        if (putSupport.length > 0) {
            putSupport.sort((a, b) => b[1] - a[1]);
            levels["Put Flow Support"] = putSupport[0][0];
        }
        
        // 5. Volume-Weighted Average Strike (VWAS)
        if (totalVolume > 0) {
            const vwas = Object.entries(strikeFlow)
                .reduce((sum, [strike, data]) => sum + parseFloat(strike) * data.total_volume, 0) / totalVolume;
            levels["VWAS"] = vwas;
        }
        
        return levels;
    }

    // ===== MAIN ANALYSIS FUNCTION =====

    async generateKeyLevels(currency = "BTC") {
        console.log(`\n=== Analyzing ${currency} ===`);
        
        const spotPrice = await this.fetchIndexPrice(currency);
        console.log(`Spot price: $${spotPrice.toLocaleString()}`);
        
        if (spotPrice <= 0) {
            throw new Error(`Failed to fetch spot price for ${currency}`);
        }
        
        // Fetch data in parallel - restored to full 24 hours
        console.log('Fetching all data in parallel...');
        const [stats24h, instruments, futuresTrades, optionsTrades] = await Promise.all([
            this.fetch24hStats(currency),
            this.fetchInstrumentsSummary(currency),
            this.fetchCompleteFuturesTrades(currency, 24), // Restored to 24 hours
            this.fetchCompleteOptionsTrades(currency, 24)  // Restored to 24 hours
        ]);
        
        console.log(`Data fetched - Stats: ${JSON.stringify(stats24h)}`);
        console.log(`Instruments: ${instruments.length}, Futures trades: ${futuresTrades.length}, Options trades: ${optionsTrades.length}`);
        
        // Calculate all analytics
        const [max24h, min24h] = this.calculate1DLevels(stats24h);
        console.log(`1D levels - Max: ${max24h}, Min: ${min24h}`);
        
        const hvlLevels = this.calculateVolumeProfileLevels(futuresTrades, spotPrice, currency);
        console.log(`HVL levels: ${hvlLevels.length} found`);
        
        const optionAnalysis = await this.calculateOptionLevels(instruments, spotPrice);
        console.log(`Option analysis completed - Levels: ${Object.keys(optionAnalysis.levels || {}).length}, PC ratios: ${Object.keys(optionAnalysis.put_call_ratios || {}).length}`);
        
        const flowLevels = this.analyzeCompleteOptionsFlow(optionsTrades, spotPrice);
        console.log(`Flow analysis completed - Levels: ${Object.keys(flowLevels).length}`);
        
        // Combine all levels
        const allLevels = {};
        
        // Add 1D levels
        if (max24h > 0) allLevels["1D Max"] = max24h;
        if (min24h > 0) allLevels["1D Min"] = min24h;
        
        // Add HVL
        for (const hvl of hvlLevels) {
            allLevels[hvl.level] = hvl.price;
        }
        
        // Add option levels
        Object.assign(allLevels, optionAnalysis.levels || {});
        
        // Add flow levels
        Object.assign(allLevels, flowLevels);
        
        console.log(`Calculated levels - Max: $${max24h.toLocaleString()}, Min: $${min24h.toLocaleString()}`);
        
        // Convert to KeyLevel objects with confidence scoring
        const keyLevels = [];
        
        const calculateConfidence = (baseConfidence, distancePct) => {
            const distanceFactor = Math.max(0.1, 1.0 - Math.abs(distancePct) / 100);
            return Math.min(1.0, baseConfidence * distanceFactor);
        };
        
        const confidenceMap = {
            "1D Max": 0.8, "1D Min": 0.7, "HVL": 0.6,
            "Call Resistance": 0.5, "Put Support": 0.4,
            "Call Resistance 0DTE": 0.7, "Put Support 0DTE": 0.8,
            "Call Resistance 1W": 0.5, "Put Support 1W": 0.4,
            "Call Resistance 1M": 0.4, "Put Support 1M": 0.1,
            "Gamma Wall (Short Gamma)": 0.6, "Gamma Wall (Long Gamma)": 0.6,
            "HVS": 0.5, "Max Pain Flow": 0.4,
            "Call Flow Resistance": 0.4, "Put Flow Support": 0.4,
            "VWAS": 0.3
        };
        
        for (const [levelName, levelPrice] of Object.entries(allLevels)) {
            if (levelPrice && levelPrice > 0) {
                const distance = this.calculateDistanceToSpot(levelPrice, spotPrice);
                const baseConf = confidenceMap[levelName] || 0.3;
                const confidence = calculateConfidence(baseConf, distance);
                
                keyLevels.push({
                    name: levelName,
                    value: levelPrice,
                    distance_to_spot: distance,
                    confidence: confidence,
                    to_dict: function() {
                        return {
                            name: this.name,
                            value: this.value,
                            distance_to_spot: `${this.distance_to_spot.toFixed(2)}%`,
                            confidence: this.confidence
                        };
                    }
                });
            }
        }
        
        // Sort by distance from spot
        keyLevels.sort((a, b) => Math.abs(a.distance_to_spot) - Math.abs(b.distance_to_spot));
        
        // Return metadata
        const metadata = {
            currency,
            spot_price: spotPrice,
            put_call_ratios: optionAnalysis.put_call_ratios || {},
            iv_data: optionAnalysis.iv_data || {},
            instruments_analyzed: instruments.length,
            futures_trades: futuresTrades.length,
            options_trades: optionsTrades.length,
            cache_info: {
                local_cache_size: localCache.size,
                ttl_minutes: CACHE_TTL / 60000
            }
        };
        
        return [keyLevels, metadata];
    }
}

// ===== CLOUDFLARE WORKER HANDLER =====

export default {
    async fetch(request, env, ctx) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                }
            });
        }
        
        try {
            const url = new URL(request.url);
            
            // Only respond to /analytics endpoint
            if (url.pathname !== '/analytics') {
                return new Response(JSON.stringify({
                    error: 'Not found.'
                }), {
                    status: 404,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                });
            }
            
            const currency = url.searchParams.get('currency') || 'BTC';
            const forceRefresh = url.searchParams.get('refresh') === 'true';
            
            // Validate currency
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
            
            const analytics = new DeribitAnalyticsV4Worker(env.DERIBIT_CACHE);
            
            // Clear local cache if force refresh is requested
            if (forceRefresh) {
                console.log('Force refresh requested - clearing local cache');
                localCache.clear();
            }
            
            const [keyLevels, metadata] = await analytics.generateKeyLevels(currency.toUpperCase());
            
            const response = {
                success: true,
                data: {
                    key_levels: keyLevels,
                    metadata,
                    timestamp: new Date().toISOString()
                }
            };
            
            return new Response(JSON.stringify(response, null, 2), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'public, max-age=240' // 4 minutes browser cache
                }
            });
            
        } catch (error) {
            console.error('Worker error:', error);
            
            return new Response(JSON.stringify({
                success: false,
                error: error.message,
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
};
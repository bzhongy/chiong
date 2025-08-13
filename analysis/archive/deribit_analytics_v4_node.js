/**
 * Deribit Analytics v4 Comprehensive - Node.js Compatible Version
 * Uses built-in https module instead of fetch for Node.js v14 compatibility
 */

const https = require('https');
const { URL } = require('url');

class DeribitAnalyticsV4Node {
    constructor(baseUrl = "https://www.deribit.com/api/v2") {
        this.baseUrl = baseUrl;
        this.rateLimitDelay = 200; // 200ms between requests
    }

    // ===== UTILITY FUNCTIONS =====

    async fetchWithRetry(url, params = {}, maxRetries = 3) {
        const queryString = new URLSearchParams(params).toString();
        const fullUrl = `${url}${queryString ? '?' + queryString : ''}`;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                await this.sleep(this.rateLimitDelay);
                
                const data = await this.httpsRequest(fullUrl);
                return data.result || data;
            } catch (error) {
                if (error.statusCode === 429) {
                    const waitTime = Math.pow(2, attempt) * 1000;
                    console.log(`Rate limited, waiting ${waitTime/1000}s...`);
                    await this.sleep(waitTime);
                    continue;
                }
                
                if (attempt === maxRetries - 1) {
                    console.error(`Failed after ${maxRetries} attempts:`, error.message);
                    throw error;
                }
                await this.sleep(1000);
            }
        }
        return null;
    }

    httpsRequest(url) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || 443,
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
                headers: {
                    'User-Agent': 'Analytics Client v4 Node.js',
                    'Accept': 'application/json'
                }
            };

            const req = https.request(options, (res) => {
                // Handle redirects
                if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
                    const redirectUrl = res.headers.location;
                    if (redirectUrl) {
                        console.log(`Following redirect to: ${redirectUrl}`);
                        return this.httpsRequest(redirectUrl).then(resolve).catch(reject);
                    }
                }

                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            const error = new Error(`HTTP ${res.statusCode}`);
                            error.statusCode = res.statusCode;
                            reject(error);
                            return;
                        }
                        
                        const jsonData = JSON.parse(data);
                        resolve(jsonData);
                    } catch (parseError) {
                        console.error('Raw response:', data.substring(0, 200));
                        reject(new Error(`JSON parse error: ${parseError.message}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.end();
        });
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ===== DATA FETCHING =====

    async fetchIndexPrice(currency = "BTC") {
        const url = `${this.baseUrl}/public/get_index_price`;
        const params = { index_name: `${currency.toLowerCase()}_usd` };
        
        const result = await this.fetchWithRetry(url, params);
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
        console.log(`\n=== Fetching Complete ${currency} Options Flow (${hoursBack}h) ===`);
        
        const endTime = new Date();
        const uniqueTrades = new Map();
        const totalChunks = Math.ceil(hoursBack / chunkHours);
        
        console.log(`Using ${chunkHours}h chunks, ${totalChunks} total chunks needed`);
        
        for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
            const chunkStartHours = chunkIdx * chunkHours;
            const chunkEndHours = Math.min((chunkIdx + 1) * chunkHours, hoursBack);
            
            const chunkEnd = new Date(endTime.getTime() - chunkStartHours * 60 * 60 * 1000);
            const chunkStart = new Date(endTime.getTime() - chunkEndHours * 60 * 60 * 1000);
            
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
            if (result && typeof result === 'object') {
                chunkTrades = result.trades || [];
                if (result.has_more) {
                    console.log(`  ⚠️  Chunk has more data (may need smaller chunks)`);
                }
            } else if (Array.isArray(result)) {
                chunkTrades = result;
            }
            
            console.log(`  Fetched ${chunkTrades.length} trades`);
            
            // Deduplicate by trade_id
            let chunkUnique = 0;
            for (const trade of chunkTrades) {
                const tradeId = trade.trade_id;
                if (tradeId && !uniqueTrades.has(tradeId)) {
                    uniqueTrades.set(tradeId, trade);
                    chunkUnique++;
                }
            }
            
            console.log(`  Added ${chunkUnique} unique trades`);
            await this.sleep(300); // Be nice to the API
        }
        
        const finalTrades = Array.from(uniqueTrades.values());
        console.log(`\nTotal unique trades collected: ${finalTrades.length}`);
        
        return finalTrades;
    }

    async fetchInstrumentsSummary(currency = "BTC") {
        const url = `${this.baseUrl}/public/get_book_summary_by_currency`;
        const params = { currency, kind: "option" };
        
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
        console.log(`\n=== Fetching Complete ${currency} Futures Data (${hoursBack}h) ===`);
        
        const endTime = new Date();
        const uniqueTrades = new Map();
        const totalChunks = Math.ceil(hoursBack / chunkHours);
        
        console.log(`Using ${chunkHours}h chunks, ${totalChunks} total chunks needed`);
        
        for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
            const chunkStartHours = chunkIdx * chunkHours;
            const chunkEndHours = Math.min((chunkIdx + 1) * chunkHours, hoursBack);
            
            const chunkEnd = new Date(endTime.getTime() - chunkStartHours * 60 * 60 * 1000);
            const chunkStart = new Date(endTime.getTime() - chunkEndHours * 60 * 60 * 1000);
            
            console.log(`Chunk ${chunkIdx + 1}/${totalChunks}: ${chunkStart.toLocaleString()} to ${chunkEnd.toLocaleString()}`);
            
            const params = {
                currency,
                kind: "future",
                start_timestamp: chunkStart.getTime(),
                end_timestamp: chunkEnd.getTime(),
                count: 1000,
                sorting: "desc"
            };
            
            const url = `${this.baseUrl}/public/get_last_trades_by_currency_and_time`;
            const result = await this.fetchWithRetry(url, params);
            
            let chunkTrades = [];
            if (result && typeof result === 'object') {
                chunkTrades = result.trades || [];
                if (result.has_more) {
                    console.log(`  ⚠️  Chunk has more data (may need smaller chunks)`);
                }
            } else if (Array.isArray(result)) {
                chunkTrades = result;
            }
            
            console.log(`  Fetched ${chunkTrades.length} trades`);
            
            // Deduplicate by trade_id
            let chunkUnique = 0;
            for (const trade of chunkTrades) {
                const tradeId = trade.trade_id;
                if (tradeId && !uniqueTrades.has(tradeId)) {
                    uniqueTrades.set(tradeId, trade);
                    chunkUnique++;
                }
            }
            
            console.log(`  Added ${chunkUnique} unique trades`);
            await this.sleep(300); // Be nice to the API
        }
        
        const finalTrades = Array.from(uniqueTrades.values());
        console.log(`\nTotal unique futures trades collected: ${finalTrades.length}`);
        
        return finalTrades;
    }

    // ===== PARSING AND UTILITIES =====

    parseInstrumentName(instrumentName) {
        const parts = instrumentName.split('-');
        if (parts.length !== 4) return null;
        
        const [currency, expiryStr, strikeStr, optionType] = parts;
        
        try {
            const strike = parseFloat(strikeStr);
            const expiryDate = this.parseExpiryDate(expiryStr);
            
            return {
                currency,
                expiry_date: expiryDate,
                strike,
                option_type: optionType,
                is_call: optionType === "C",
                is_put: optionType === "P"
            };
        } catch {
            return null;
        }
    }

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
        } catch {
            return null;
        }
    }

    is0DTE(expiryDate) {
        if (!expiryDate) return false;
        const today = new Date();
        return expiryDate.toDateString() === today.toDateString();
    }

    is1WExpiry(expiryDate) {
        if (!expiryDate) return false;
        const now = new Date();
        const daysDiff = Math.floor((expiryDate - now) / (1000 * 60 * 60 * 24));
        return daysDiff >= 5 && daysDiff <= 12;
    }

    is1MExpiry(expiryDate) {
        if (!expiryDate) return false;
        const now = new Date();
        const daysDiff = Math.floor((expiryDate - now) / (1000 * 60 * 60 * 24));
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

    // ===== ANALYTICS CALCULATIONS =====

    calculate1DLevels(stats24h) {
        return [stats24h.high_24h || 0, stats24h.low_24h || 0];
    }

    calculateVolumeProfileLevels(trades, spotPrice, currency = "BTC") {
        if (!trades || trades.length === 0) return [];
        
        const priceLevels = {};
        
        for (const trade of trades) {
            const price = trade.price || 0;
            const amount = trade.amount || 0;
            
            if (price <= 0 || amount <= 0) continue;
            
            // Round to create levels
            const level = price > 1000 ? Math.round(price / 10) * 10 : Math.round(price * 10) / 10;
            
            priceLevels[level] = (priceLevels[level] || 0) + amount;
        }
        
        if (Object.keys(priceLevels).length === 0) return [];
        
        // Find highest volume level
        const entries = Object.entries(priceLevels);
        const [hvlPrice, hvlVolume] = entries.reduce((max, current) => 
            current[1] > max[1] ? current : max
        );
        
        return [{ level: "HVL", price: parseFloat(hvlPrice), volume: hvlVolume }];
    }

    // ===== SIMPLIFIED TEST FUNCTION =====

    async generateSimpleAnalysis(currency = "BTC") {
        console.log(`\n=== Analyzing ${currency} ===`);
        
        try {
            // Fetch basic data first
            const spotPrice = await this.fetchIndexPrice(currency);
            console.log(`Spot price: $${spotPrice.toLocaleString()}`);
            
            if (spotPrice <= 0) {
                throw new Error(`Failed to fetch spot price for ${currency}`);
            }
            
            // Fetch 24h stats
            const stats24h = await this.fetch24hStats(currency);
            const [max24h, min24h] = this.calculate1DLevels(stats24h);
            
            console.log(`24h High: $${max24h.toLocaleString()}`);
            console.log(`24h Low: $${min24h.toLocaleString()}`);
            
            // Fetch instruments summary
            const instruments = await this.fetchInstrumentsSummary(currency);
            console.log(`Found ${instruments.length} option instruments`);
            
            // Basic analysis
            const levels = {};
            if (max24h > 0) levels["1D Max"] = max24h;
            if (min24h > 0) levels["1D Min"] = min24h;
            
            // Convert to key levels
            const keyLevels = [];
            for (const [levelName, levelPrice] of Object.entries(levels)) {
                if (levelPrice && levelPrice > 0) {
                    const distance = this.calculateDistanceToSpot(levelPrice, spotPrice);
                    keyLevels.push({
                        name: levelName,
                        value: levelPrice,
                        distance_to_spot: distance,
                        confidence: 0.8
                    });
                }
            }
            
            // Sort by distance from spot
            keyLevels.sort((a, b) => Math.abs(a.distance_to_spot) - Math.abs(b.distance_to_spot));
            
            return {
                currency,
                spot_price: spotPrice,
                key_levels: keyLevels,
                instruments_count: instruments.length
            };
            
        } catch (error) {
            console.error(`Error analyzing ${currency}:`, error.message);
            throw error;
        }
    }
}

// ===== TEST FUNCTION =====

async function testNodeAnalytics() {
    console.log("🚀 Testing Deribit Analytics v4 - Node.js Compatible Version");
    console.log("=".repeat(80));
    
    const analytics = new DeribitAnalyticsV4Node();
    
    for (const currency of ["BTC"]) { // Test BTC first
        try {
            const result = await analytics.generateSimpleAnalysis(currency);
            
            console.log(`\n📊 ${currency} Analysis Results:`);
            console.log(`Spot Price: $${result.spot_price.toLocaleString()}`);
            console.log(`Instruments: ${result.instruments_count}`);
            
            if (result.key_levels.length > 0) {
                console.log(`\nKey Levels:`);
                console.log("Level Name           Value           Distance");
                console.log("-".repeat(50));
                
                for (const level of result.key_levels) {
                    const distanceStr = level.distance_to_spot > 0 ? 
                        `+${level.distance_to_spot.toFixed(2)}%` : 
                        `${level.distance_to_spot.toFixed(2)}%`;
                    
                    console.log(`${level.name.padEnd(20)} $${level.value.toLocaleString().padStart(12)} ${distanceStr.padStart(10)}`);
                }
            }
            
            console.log(`\n✅ Successfully analyzed ${currency}`);
            
        } catch (error) {
            console.log(`❌ Error analyzing ${currency}: ${error.message}`);
        }
    }
}

// Run the test
if (require.main === module) {
    testNodeAnalytics().catch(console.error);
}

module.exports = { DeribitAnalyticsV4Node, testNodeAnalytics }; 
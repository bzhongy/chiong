/**
 * Deribit Analytics v4 Comprehensive - JavaScript Version
 * Matches Python v4 comprehensive analytics with:
 * - Multi-timeframe analysis (Current, 0DTE, 1W, 1M)
 * - Complete data pagination for options and futures
 * - Put/Call ratios across all timeframes
 * - Enhanced flow analysis and confidence scoring
 * - Professional-grade analytics with 17+ indicators
 * - Node.js compatible HTTPS calling
 */

const https = require('https');
const { URL } = require('url');

class DeribitAnalyticsV4Comprehensive {
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
                    'User-Agent': 'Analytics Client v4 Comprehensive',
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
        const allTrades = [];
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
        
        // Analyze coverage
        if (finalTrades.length > 0) {
            const timestamps = finalTrades
                .map(trade => trade.timestamp || 0)
                .filter(ts => ts > 0)
                .sort((a, b) => a - b);
            
            if (timestamps.length > 0) {
                const firstTrade = new Date(timestamps[0]);
                const lastTrade = new Date(timestamps[timestamps.length - 1]);
                const coverageHours = (lastTrade - firstTrade) / (1000 * 60 * 60);
                console.log(`Coverage: ${coverageHours.toFixed(1)} hours (${(coverageHours/hoursBack*100).toFixed(1)}%)`);
            }
        }
        
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
        
        // Analyze coverage
        if (finalTrades.length > 0) {
            const timestamps = finalTrades
                .map(trade => trade.timestamp || 0)
                .filter(ts => ts > 0)
                .sort((a, b) => a - b);
            
            if (timestamps.length > 0) {
                const firstTrade = new Date(timestamps[0]);
                const lastTrade = new Date(timestamps[timestamps.length - 1]);
                const coverageHours = (lastTrade - firstTrade) / (1000 * 60 * 60);
                console.log(`Futures coverage: ${coverageHours.toFixed(1)} hours (${(coverageHours/hoursBack*100).toFixed(1)}%)`);
            }
        }
        
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

            // Create UTC date to match Python behavior
            return new Date(Date.UTC(year, month, day));
        } catch {
            return null;
        }
    }

    is0DTE(expiryDate) {
        if (!expiryDate) return false;
        
        const now = new Date(); // Current UTC time
        
        // Create expiry datetime at 08:00 UTC (Deribit expiry time)
        const expiryUtc8 = new Date(Date.UTC(
            expiryDate.getUTCFullYear(),
            expiryDate.getUTCMonth(),
            expiryDate.getUTCDate(),
            8, 0, 0
        ));
        
        // Check if expiry is within next 24 hours and still in the future
        const timeDiff = expiryUtc8.getTime() - now.getTime();
        return timeDiff > 0 && timeDiff <= 24 * 60 * 60 * 1000;
    }

    isCurrentWeeklyMonthly(expiryDate) {
        if (!expiryDate) return false;
        
        const now = new Date();
        
        // Current week: next Friday (Friday is day 5, Saturday is 6, Sunday is 0)
        let daysUntilFriday = (5 - now.getUTCDay() + 7) % 7;
        if (daysUntilFriday === 0) {
            daysUntilFriday = 7; // If today is Friday, next Friday is in 7 days
        }
        
        const nextFriday = new Date(now);
        nextFriday.setUTCDate(now.getUTCDate() + daysUntilFriday);
        
        return expiryDate.toDateString() === nextFriday.toDateString();
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
            
            // Round to create levels - match Python logic exactly
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

    async calculateOptionLevels(instruments, spotPrice) {
        if (!instruments || instruments.length === 0) return {};
        
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
                        // mark_iv is already in percentage format from Deribit API
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
        console.log(`Timeframe counts - Current: ${currentInstruments.length}, 0DTE: ${dte0Instruments.length}, 1W: ${week1Instruments.length}, 1M: ${month1Instruments.length}`);
        
        // Calculate dynamic bands
        const currentBand = calculateDynamicBand(currentIV, 7);
        const dte0Band = calculateDynamicBand(dte0IV, 0.1);
        const week1Band = calculateDynamicBand(week1IV, 7);
        const month1Band = calculateDynamicBand(month1IV, 30);
        
        console.log(`Dynamic bands - Current: ±${currentBand.toFixed(1)}%, 0DTE: ±${dte0Band.toFixed(1)}%, 1W: ±${week1Band.toFixed(1)}%, 1M: ±${month1Band.toFixed(1)}%`);
        
        // Strike filtering functions - match Python logic exactly
        const filterCallStrikes = (strikesDict, band) => {
            // Filter strikes within band
            const filteredItems = [];
            for (const [strike, oi] of Object.entries(strikesDict)) {
                const strikeNum = parseFloat(strike);
                if (strikeNum > spotPrice && strikeNum <= spotPrice * (1 + band/100)) {
                    filteredItems.push([strikeNum, oi]);
                }
            }
            
            // Sort by strike (ascending) and take top 10
            filteredItems.sort((a, b) => a[0] - b[0]);
            return Object.fromEntries(filteredItems.slice(0, 10));
        };
        
        const filterPutStrikes = (strikesDict, band) => {
            // Filter strikes within band
            const filteredItems = [];
            for (const [strike, oi] of Object.entries(strikesDict)) {
                const strikeNum = parseFloat(strike);
                if (strikeNum < spotPrice && strikeNum >= spotPrice * (1 - band/100)) {
                    filteredItems.push([strikeNum, oi]);
                }
            }
            
            // Sort by strike (descending) and take top 10
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
            
            console.log(`Debug - ${timeframeName} strikes after dynamic filtering:`);
            console.log(`  Call: ${Object.keys(filteredCalls).slice(0, 5).join(', ')}...`);
            console.log(`  Put: ${Object.keys(filteredPuts).slice(0, 5).join(', ')}...`);
            
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
        
        console.log(`Option analysis: ${currentResult.callCount} current, ${dte0Result.callCount} 0DTE, ${week1Result.callCount} 1W, ${month1Result.callCount} 1M call levels`);
        console.log(`Put analysis: ${currentResult.putCount} current, ${dte0Result.putCount} 0DTE, ${week1Result.putCount} 1W, ${month1Result.putCount} 1M put levels`);
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
                
                // Time weighting - exponential decay (match Python UTC timing)
                const nowTimestamp = new Date().getTime(); // UTC timestamp in milliseconds
                const hoursAgo = (nowTimestamp - timestamp) / (1000 * 60 * 60);
                const timeWeight = Math.exp(-hoursAgo / 12); // 12-hour half-life
                
                // Delta-adjusted exposure
                const isCall = optionType === 'C';
                const delta = this.calculateDeltaSimple(spotPrice, strike, 1/365, isCall); // Approximate 1 day to expiry
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
        
        console.log(`Processed $${totalVolume.toLocaleString()} in total options volume across ${Object.keys(strikeFlow).length} strikes`);
        
        // Calculate flow levels
        const levels = {};
        
        // 1. Highest Volume Strike (HVS)
        const hvsEntry = Object.entries(strikeFlow)
            .reduce((max, current) => current[1].total_volume > max[1].total_volume ? current : max);
        levels["HVS"] = parseFloat(hvsEntry[0]);
        
        // 2. Max Pain Flow - most balanced call/put activity
        const balancedStrikes = [];
        for (const [strike, data] of Object.entries(strikeFlow)) {
            if (data.call_volume > 0 && data.put_volume > 0) {
                const balanceRatio = Math.min(data.call_volume, data.put_volume) / Math.max(data.call_volume, data.put_volume);
                balancedStrikes.push([parseFloat(strike), balanceRatio, data.total_volume]);
            }
        }
        
        if (balancedStrikes.length > 0) {
            balancedStrikes.sort((a, b) => {
                if (b[1] !== a[1]) return b[1] - a[1]; // Sort by balance ratio desc
                return b[2] - a[2]; // Then by volume desc
            });
            levels["Max Pain Flow"] = balancedStrikes[0][0];
        }
        
        // 3. Call Flow Resistance - above spot with highest weighted call flow
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
        
        // 4. Put Flow Support - below spot with highest weighted put flow
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
        
        // Fetch all data
        const spotPrice = await this.fetchIndexPrice(currency);
        console.log(`Spot price: $${spotPrice.toLocaleString()}`);
        
        if (spotPrice <= 0) {
            throw new Error(`Failed to fetch spot price for ${currency}`);
        }
        
        // Fetch data in parallel
        const [stats24h, instruments, futuresTrades, optionsTrades] = await Promise.all([
            this.fetch24hStats(currency),
            this.fetchInstrumentsSummary(currency),
            this.fetchCompleteFuturesTrades(currency),
            this.fetchCompleteOptionsTrades(currency)
        ]);
        
        // Calculate all analytics
        const [max24h, min24h] = this.calculate1DLevels(stats24h);
        const hvlLevels = this.calculateVolumeProfileLevels(futuresTrades, spotPrice, currency);
        const optionAnalysis = await this.calculateOptionLevels(instruments, spotPrice);
        const flowLevels = this.analyzeCompleteOptionsFlow(optionsTrades, spotPrice);
        
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
        
        console.log(`Calculated levels - Max: $${max24h.toLocaleString()}, Min: $${min24h.toLocaleString()}, HVL: $${hvlLevels[0]?.price?.toLocaleString() || 0}`);
        
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
            options_trades: optionsTrades.length
        };
        
        return [keyLevels, metadata];
    }
}

// ===== TEST FUNCTION =====

async function testComprehensiveAnalytics() {
    console.log("🚀 Testing Deribit Analytics v4 Comprehensive - JavaScript Version");
    console.log("=".repeat(80));
    
    const analytics = new DeribitAnalyticsV4Comprehensive();
    
    for (const currency of ["BTC", "ETH"]) {
        try {
            const [keyLevels, metadata] = await analytics.generateKeyLevels(currency);
            
            console.log(`\nKey Level                 Value           Distance     Confidence`);
            console.log("-".repeat(70));
            
            for (const level of keyLevels) {
                const distanceStr = level.distance_to_spot > 2 ? `🟢 +${level.distance_to_spot.toFixed(2)}%` :
                                  level.distance_to_spot < -2 ? `🔴${level.distance_to_spot.toFixed(2)}%` :
                                  `🟡 ${level.distance_to_spot >= 0 ? '+' : ''}${level.distance_to_spot.toFixed(2)}%`;
                
                const confidenceBar = "█".repeat(Math.max(1, Math.floor(level.confidence * 8)));
                
                console.log(`${level.name.padEnd(25)} $${level.value.toLocaleString().padStart(12)} ${distanceStr.padStart(12)} ${confidenceBar}`);
            }
            
            console.log(`\n✅ Successfully generated ${keyLevels.length} key levels for ${currency}`);
            
            // Print Put/Call ratios
            const pcRatios = metadata.put_call_ratios;
            if (Object.keys(pcRatios).length > 0) {
                console.log(`\n📊 Put/Call Ratios (Higher = More Bearish):`);
                for (const [timeframe, ratio] of Object.entries(pcRatios)) {
                    console.log(`   ${timeframe}: ${ratio.toFixed(2)}`);
                }
            }
            
            console.log("=".repeat(70));
            
        } catch (error) {
            console.log(`❌ Error analyzing ${currency}: ${error.message}`);
        }
    }
}

// Export for Node.js and run directly if main module
if (require.main === module) {
    // Running in Node.js directly
    testComprehensiveAnalytics().catch(console.error);
}

module.exports = { DeribitAnalyticsV4Comprehensive, testComprehensiveAnalytics }; 
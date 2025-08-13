/**
 * Odette Analytics - Cloudflare Worker Integration
 * Generates key levels indicators from Deribit API data
 * 
 * This can be integrated into the existing odette/worker.js
 */

class DeribitAnalytics {
    constructor() {
        this.baseUrl = 'https://www.deribit.com/api/v2';
        this.cache = new Map();
        this.cacheTimeout = 30000; // 30 seconds cache
    }

    async fetchWithCache(url, params = {}) {
        const cacheKey = url + JSON.stringify(params);
        const cached = this.cache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }

        const queryString = new URLSearchParams(params).toString();
        const fullUrl = queryString ? `${url}?${queryString}` : url;

        try {
            const response = await fetch(fullUrl);
            const data = await response.json();
            
            this.cache.set(cacheKey, {
                data: data.result || data,
                timestamp: Date.now()
            });
            
            return data.result || data;
        } catch (error) {
            console.error(`Error fetching ${fullUrl}:`, error);
            return null;
        }
    }

    async fetchInstruments(currency = 'BTC') {
        const url = `${this.baseUrl}/public/get_instruments`;
        const params = {
            currency: currency,
            kind: 'option',
            expired: false
        };
        return await this.fetchWithCache(url, params);
    }

    async fetchIndexPrice(currency = 'BTC') {
        const url = `${this.baseUrl}/public/get_index_price`;
        const params = { index_name: `${currency.toLowerCase()}_usd` };
        const result = await this.fetchWithCache(url, params);
        return result?.index_price || 0;
    }

    async fetchOrderbook(instrumentName) {
        const url = `${this.baseUrl}/public/get_order_book`;
        const params = { instrument_name: instrumentName };
        return await this.fetchWithCache(url, params);
    }

    async fetchHistoricalVolatility(currency = 'BTC') {
        const url = `${this.baseUrl}/public/get_historical_volatility`;
        const params = { currency: currency };
        const result = await this.fetchWithCache(url, params);
        if (result && result.length > 0) {
            return result[result.length - 1][1]; // Latest volatility value
        }
        return 0;
    }

    parseInstrumentName(instrumentName) {
        // Format: BTC-25DEC24-100000-P
        const parts = instrumentName.split('-');
        if (parts.length !== 4) return null;

        const [currency, expiryStr, strikeStr, optionType] = parts;
        const strike = parseFloat(strikeStr);

        // Parse expiry date
        try {
            const day = parseInt(expiryStr.slice(0, 2));
            const monthStr = expiryStr.slice(2, 5);
            const year = 2000 + parseInt(expiryStr.slice(5, 7));
            
            const monthMap = {
                'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
                'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11
            };
            
            const expiryDate = new Date(year, monthMap[monthStr], day);
            
            return {
                currency,
                expiryDate,
                strike,
                optionType,
                isCall: optionType === 'C',
                isPut: optionType === 'P'
            };
        } catch (error) {
            return null;
        }
    }

    is0DTE(expiryDate) {
        const today = new Date();
        return (
            expiryDate.getDate() === today.getDate() &&
            expiryDate.getMonth() === today.getMonth() &&
            expiryDate.getFullYear() === today.getFullYear()
        );
    }

    calculateDistanceToSpot(level, spotPrice) {
        return ((level - spotPrice) / spotPrice) * 100;
    }

    calculate1DLevels(spotPrice, historicalData = null) {
        if (!historicalData || historicalData.length === 0) {
            // Approximate 5% daily range
            const dailyRange = spotPrice * 0.05;
            return {
                max: spotPrice + dailyRange,
                min: spotPrice - dailyRange
            };
        }
        
        return {
            max: Math.max(...historicalData),
            min: Math.min(...historicalData)
        };
    }

    async calculateGammaWall(instruments, spotPrice) {
        const gammaExposure = {};
        
        for (const instrument of instruments) {
            const parsed = this.parseInstrumentName(instrument.instrument_name);
            if (!parsed || !this.is0DTE(parsed.expiryDate)) {
                continue;
            }

            try {
                const orderbook = await this.fetchOrderbook(instrument.instrument_name);
                const openInterest = orderbook?.open_interest || 0;
                
                if (openInterest === 0) continue;
                
                const strike = parsed.strike;
                const isCall = parsed.isCall;
                
                // Simplified gamma calculation
                const moneyness = Math.abs(strike - spotPrice) / spotPrice;
                const gammaApprox = Math.exp(-moneyness * 10);
                
                // Calculate gamma exposure
                const exposure = openInterest * gammaApprox * (isCall ? 1 : -1);
                
                gammaExposure[strike] = (gammaExposure[strike] || 0) + exposure;
                
            } catch (error) {
                console.error(`Error processing ${instrument.instrument_name}:`, error);
                continue;
            }
        }
        
        // Find strike with maximum gamma exposure
        if (Object.keys(gammaExposure).length > 0) {
            const maxGammaStrike = Object.entries(gammaExposure)
                .reduce((max, [strike, exposure]) => 
                    Math.abs(exposure) > Math.abs(max.exposure) 
                        ? { strike: parseFloat(strike), exposure }
                        : max
                , { strike: spotPrice, exposure: 0 });
            
            return maxGammaStrike;
        }
        
        return { strike: spotPrice, exposure: 0 };
    }

    async calculateSupportResistanceLevels(instruments, spotPrice) {
        const callVolumes = {};
        const putVolumes = {};
        
        for (const instrument of instruments) {
            const parsed = this.parseInstrumentName(instrument.instrument_name);
            if (!parsed || !this.is0DTE(parsed.expiryDate)) {
                continue;
            }

            try {
                const orderbook = await this.fetchOrderbook(instrument.instrument_name);
                const volume = orderbook?.stats?.volume || 0;
                
                if (volume === 0) continue;
                
                const strike = parsed.strike;
                if (parsed.isCall) {
                    callVolumes[strike] = (callVolumes[strike] || 0) + volume;
                } else {
                    putVolumes[strike] = (putVolumes[strike] || 0) + volume;
                }
                
            } catch (error) {
                console.error(`Error processing ${instrument.instrument_name}:`, error);
                continue;
            }
        }
        
        // Find key levels based on volume
        const callResistance = Object.keys(callVolumes).length > 0 
            ? parseFloat(Object.entries(callVolumes).reduce((max, [strike, volume]) => 
                volume > max.volume ? { strike, volume } : max
            , { strike: spotPrice, volume: 0 }).strike)
            : spotPrice;
            
        const putSupport = Object.keys(putVolumes).length > 0
            ? parseFloat(Object.entries(putVolumes).reduce((max, [strike, volume]) => 
                volume > max.volume ? { strike, volume } : max
            , { strike: spotPrice, volume: 0 }).strike)
            : spotPrice;
        
        return {
            callResistance,
            putSupport,
            callVolumes,
            putVolumes
        };
    }

    async generateKeyLevels(currency = 'BTC') {
        try {
            // Fetch basic data
            const [spotPrice, instruments, historicalVol] = await Promise.all([
                this.fetchIndexPrice(currency),
                this.fetchInstruments(currency),
                this.fetchHistoricalVolatility(currency)
            ]);

            if (!spotPrice) {
                throw new Error(`Could not fetch spot price for ${currency}`);
            }

            console.log(`Spot price for ${currency}: $${spotPrice.toLocaleString()}`);
            console.log(`Found ${instruments?.length || 0} instruments`);

            // Calculate levels
            const levels1D = this.calculate1DLevels(spotPrice);
            const gammaWall = await this.calculateGammaWall(instruments || [], spotPrice);
            const srLevels = await this.calculateSupportResistanceLevels(instruments || [], spotPrice);
            
            // Calculate HVL (Historic Volatility Level)
            const hvlLevel = spotPrice * (1 + historicalVol * 0.1);

            // Build key levels array
            const keyLevels = [
                {
                    name: '1D Max',
                    value: levels1D.max,
                    distance_to_spot: this.calculateDistanceToSpot(levels1D.max, spotPrice)
                },
                {
                    name: '1D Min',
                    value: levels1D.min,
                    distance_to_spot: this.calculateDistanceToSpot(levels1D.min, spotPrice)
                },
                {
                    name: 'Call Resistance',
                    value: srLevels.callResistance,
                    distance_to_spot: this.calculateDistanceToSpot(srLevels.callResistance, spotPrice)
                },
                {
                    name: 'Call Resistance ODTE',
                    value: srLevels.callResistance,
                    distance_to_spot: this.calculateDistanceToSpot(srLevels.callResistance, spotPrice)
                },
                {
                    name: 'Gamma Wall ODTE',
                    value: gammaWall.strike,
                    distance_to_spot: this.calculateDistanceToSpot(gammaWall.strike, spotPrice)
                },
                {
                    name: 'HVL',
                    value: hvlLevel,
                    distance_to_spot: this.calculateDistanceToSpot(hvlLevel, spotPrice)
                },
                {
                    name: 'Put Support',
                    value: srLevels.putSupport,
                    distance_to_spot: this.calculateDistanceToSpot(srLevels.putSupport, spotPrice)
                },
                {
                    name: 'Put Support ODTE',
                    value: srLevels.putSupport,
                    distance_to_spot: this.calculateDistanceToSpot(srLevels.putSupport, spotPrice)
                }
            ];

            // Sort by distance to spot (absolute value)
            keyLevels.sort((a, b) => Math.abs(a.distance_to_spot) - Math.abs(b.distance_to_spot));

            return {
                currency,
                timestamp: new Date().toISOString(),
                spot_price: spotPrice,
                key_levels: keyLevels.map(level => ({
                    name: level.name,
                    value: parseFloat(level.value.toFixed(2)),
                    distance_to_spot: `${level.distance_to_spot > 0 ? '+' : ''}${level.distance_to_spot.toFixed(2)}%`
                }))
            };

        } catch (error) {
            console.error(`Error generating key levels for ${currency}:`, error);
            return {
                currency,
                timestamp: new Date().toISOString(),
                error: error.message,
                key_levels: []
            };
        }
    }
}

// Integration function for existing Cloudflare Worker
async function handleAnalyticsRequest(request, env, corsHeaders = {}) {
    const url = new URL(request.url);
    const currency = url.searchParams.get('currency') || 'BTC';
    
    try {
        const analytics = new DeribitAnalytics();
        const keyLevels = await analytics.generateKeyLevels(currency.toUpperCase());
        
        return new Response(JSON.stringify(keyLevels, null, 2), {
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            }
        });
        
    } catch (error) {
        console.error('Analytics request error:', error);
        return new Response(JSON.stringify({
            error: 'Analytics generation failed',
            message: error.message
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            }
        });
    }
}

// Export for use in worker.js
// Add this to your existing worker.js handleRequest function:
/*
if (pathname === '/analytics') {
    return await handleAnalyticsRequest(request, env, corsHeaders);
}
*/ 
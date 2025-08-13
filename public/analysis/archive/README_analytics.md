# Odette Analytics Prototype

This prototype generates key trading levels indicators from Deribit API data, similar to the ones shown in your trading interface screenshot.

## Features

### Key Levels Generated
- **1D Max/Min** - Daily high and low levels  
- **Call Resistance** - Key resistance levels based on call option activity
- **Call Resistance ODTE** - Same-day expiry call resistance
- **Gamma Wall ODTE** - Maximum gamma exposure level for 0DTE options
- **HVL (Historic Volatility Level)** - Volatility-based price level
- **Put Support** - Key support levels based on put option activity  
- **Put Support ODTE** - Same-day expiry put support

### Supported Assets
- BTC (Bitcoin)
- ETH (Ethereum)  
- Any currency available on Deribit

## Files Overview

### Python Implementation
- **`analytics_prototype.py`** - Main analytics engine with Deribit API integration
- **`test_analytics.py`** - Test script to demonstrate functionality
- **`requirements.txt`** - Python dependencies

### JavaScript Implementation  
- **`cloudflare_worker_adapter.js`** - Ready-to-integrate Cloudflare Worker code

## Quick Start

### 1. Python Version

Install dependencies:
```bash
pip install -r requirements.txt
```

Run the prototype:
```bash
python analytics_prototype.py
```

Run tests:
```bash
python test_analytics.py
```

### 2. Cloudflare Worker Integration

Add the analytics endpoint to your existing `worker.js`:

```javascript
// Import the analytics code from cloudflare_worker_adapter.js

// Add to your handleRequest function:
if (pathname === '/analytics') {
    return await handleAnalyticsRequest(request, env, corsHeaders);
}
```

## API Usage

### Python API

```python
async with DeribitAnalytics() as analytics:
    key_levels = await analytics.generate_key_levels("BTC")
    for level in key_levels:
        print(f"{level.name}: ${level.value:.2f} ({level.distance_to_spot:.2f}%)")
```

### HTTP API (after Worker integration)

```bash
# Get BTC key levels
curl "https://your-worker.domain.com/analytics?currency=BTC"

# Get ETH key levels  
curl "https://your-worker.domain.com/analytics?currency=ETH"
```

## Sample Output

```
Key Levels for BTC
==================================================
Key Level                 Value        Distance    
==================================================
Call Resistance           107500.00    +0.99%     
1D Min                    102151.34    -6.21%     
Put Support               100000.00    -8.19%     
Gamma Wall ODTE          107500.00    -1.30%     
HVL                      101000.00    -7.27%     
1D Max                   107388.66    -1.41%     
Put Support ODTE         102500.00    -5.89%     
Call Resistance ODTE     107500.00    -1.30%     
```

## Algorithm Details

### Gamma Wall Calculation
- Fetches all 0DTE options for the currency
- Calculates gamma exposure for each strike
- Identifies the strike with maximum absolute gamma exposure
- Uses simplified gamma approximation: `gamma ≈ exp(-moneyness * 10)`

### Support/Resistance Levels
- Analyzes volume and open interest at different strikes
- Call resistance = strike with highest call volume
- Put support = strike with highest put volume
- Focuses on 0DTE options for immediate relevance

### 1D Max/Min
- Uses historical price data when available
- Falls back to volatility-based range estimation (±5% of spot)

### HVL (Historic Volatility Level)
- Fetches Deribit's historical volatility data
- Calculates price level: `HVL = spot_price * (1 + volatility * 0.1)`

## Integration with Existing Odette System

The analytics can be easily integrated with your existing infrastructure:

1. **Data Format** - Outputs JSON compatible with your existing data structures
2. **Caching** - Includes 30-second caching to avoid API rate limits
3. **Error Handling** - Graceful fallbacks when data is unavailable
4. **CORS Support** - Ready for cross-origin requests

### Adding to Your Cloudflare Worker

1. Copy the `DeribitAnalytics` class from `cloudflare_worker_adapter.js`
2. Add the analytics endpoint handler to your existing `worker.js`
3. Test with: `https://odette.fi/analytics?currency=BTC`

### Frontend Integration

```javascript
// Fetch key levels for display
async function loadKeyLevels(currency = 'BTC') {
    const response = await fetch(`/analytics?currency=${currency}`);
    const data = await response.json();
    
    // Display in your UI similar to the screenshot
    displayKeyLevels(data.key_levels);
}
```

## Performance Considerations

- **Caching**: 30-second cache reduces API calls
- **Parallel Requests**: Fetches multiple data sources simultaneously  
- **Error Resilience**: Continues processing even if some data fails
- **Rate Limiting**: Respects Deribit's API limits

## Future Enhancements

1. **Real-time Updates** - WebSocket integration for live data
2. **More Indicators** - Additional levels like VWAP, pivot points
3. **Historical Analysis** - Trend analysis of key level effectiveness
4. **Custom Timeframes** - Support for weekly, monthly expiries
5. **Alert System** - Notifications when price approaches key levels

## Monitoring & Debugging

The system includes extensive logging:
- API response times and errors
- Data processing statistics  
- Cache hit/miss ratios
- Key level calculation details

Monitor the logs to ensure reliable operation in production.

## Support

This prototype demonstrates the core functionality. For production deployment:
- Add comprehensive error handling
- Implement monitoring and alerting
- Consider data backup strategies
- Test thoroughly with edge cases 
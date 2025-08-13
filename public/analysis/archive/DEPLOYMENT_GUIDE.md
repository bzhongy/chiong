# Deribit Analytics - Cloudflare Workers Deployment Guide

## Overview

This is a complete trading analytics API that generates key levels from Deribit options and futures data, ready for Cloudflare Workers deployment.

## Key Features

✅ **No External Dependencies** - Uses only native JavaScript/Web APIs  
✅ **Real-time Data** - Fetches live market data from Deribit  
✅ **Complete Analytics** - Calculates all major trading indicators:
- 1D Max/Min (yesterday's session high/low)
- Call/Put Resistance/Support (delta-adjusted open interest)
- Gamma Wall 0DTE (same-day expiring options concentration)
- HVL (High Volume Level from futures volume clustering)

✅ **Black-Scholes Calculations** - Native implementation of option pricing  
✅ **Confidence Scoring** - Each level includes confidence percentage  
✅ **CORS Enabled** - Ready for frontend integration  

## Quick Deployment

### 1. Cloudflare Workers Setup

```bash
# Install Wrangler CLI
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Create new worker project
wrangler init deribit-analytics
cd deribit-analytics
```

### 2. Replace Default Code

Copy the entire content of `deribit_analytics_worker.js` into your worker's `src/index.js` file.

### 3. Deploy

```bash
wrangler deploy
```

### 4. Test Your API

```bash
# Test BTC analysis
curl "https://your-worker.your-subdomain.workers.dev/?currency=BTC"

# Test ETH analysis  
curl "https://your-worker.your-subdomain.workers.dev/?currency=ETH"
```

## API Usage

### Endpoint
```
GET https://your-worker.your-subdomain.workers.dev/
```

### Parameters
- `currency` (optional): "BTC" or "ETH" (default: "BTC")

### Response Format
```json
{
  "currency": "BTC",
  "spotPrice": 105839.87,
  "timestamp": "2024-06-13T20:32:23.000Z",
  "levels": {
    "1D Min": {
      "price": 105826.5,
      "percentage": -0.01,
      "confidence": 1.0
    },
    "Call Resistance": {
      "price": 170000,
      "percentage": 60.62,
      "confidence": 0.3
    },
    "Put Support": {
      "price": 97000,
      "percentage": -8.35,
      "confidence": 0.83
    },
    "Gamma Wall 0DTE": {
      "price": 105000,
      "percentage": -0.79,
      "confidence": 1.0
    },
    "HVL": {
      "price": 106000,
      "percentage": 0.15,
      "confidence": 1.0
    }
  },
  "metadata": {
    "instrumentsTracked": 756,
    "futuresTradesAnalyzed": 999,
    "optionsTradesAnalyzed": 999
  }
}
```

## Local Testing

### Node.js Version
```bash
# Run locally with Node.js
node deribit_analytics_node.js
```

### Browser Version
```bash
# For browser testing (requires modern browser with fetch)
# Open deribit_analytics_local.js in browser console
```

## Level Definitions

| Level | Definition |
|-------|------------|
| **1D Max/Min** | Yesterday's session high/low from 24h futures data |
| **Call Resistance** | Strike with largest call open interest above spot (delta-adjusted) |
| **Put Support** | Strike with largest put open interest below spot (delta-adjusted) |
| **Gamma Wall 0DTE** | Strike with largest net dealer gamma for same-day expiring options |
| **HVL** | High-Volume Level - price level with highest futures trading volume |

## Confidence Scoring

- **100%**: Levels very close to current spot price
- **90%+**: Levels within 5% of spot price
- **80%+**: Levels within 10% of spot price  
- **70%+**: Levels within 15% of spot price
- **50%+**: Levels within 25% of spot price
- **30%+**: Levels further from spot price

Special bonuses:
- **0DTE/Gamma levels**: +20% confidence boost
- **Flow levels**: +10% confidence boost

## Rate Limiting

- Built-in retry logic with exponential backoff
- Respects Deribit's API rate limits
- Fails gracefully with error responses

## Error Handling

The API returns structured error responses:

```json
{
  "error": "Failed to fetch spot price for INVALID",
  "timestamp": "2024-06-13T20:32:23.000Z"
}
```

## Customization

### Adding New Indicators

1. Create calculation function in analytics class
2. Call it in `getCompleteAnalysis()` 
3. Add results to `allLevels` object
4. Confidence scoring will be applied automatically

### Modifying Confidence Scoring

Edit the `calculateConfidence()` method to adjust scoring logic.

### Adding New Currencies

The API supports any currency available on Deribit. Simply pass the currency code as a parameter.

## Performance

- **Cold start**: ~2-3 seconds
- **Warm requests**: ~500ms-1s
- **Data freshness**: Real-time (API calls on each request)
- **Memory usage**: <10MB

## Production Considerations

1. **Caching**: Consider adding Redis/KV caching for frequent requests
2. **Monitoring**: Add error tracking and performance monitoring
3. **Rate limiting**: Implement client-side rate limiting if needed
4. **Webhooks**: Consider webhook-based updates for real-time data

## Troubleshooting

### Common Issues

1. **CORS errors**: Ensure your worker includes CORS headers
2. **Rate limiting**: Reduce request frequency if hitting limits
3. **Timeout errors**: Increase timeout values for slow responses
4. **Invalid currency**: Verify currency code is supported by Deribit

### Debug Mode

Add console logging to track API calls and responses:

```javascript
console.log('Fetching data for:', currency);
console.log('API response:', result);
```

## Support

For issues or questions:
1. Check Deribit API documentation
2. Verify your Cloudflare Workers configuration
3. Test with the local Node.js version first
4. Check browser console for detailed error messages 
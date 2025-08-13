import asyncio
import aiohttp
from datetime import datetime, timedelta
from typing import List, Dict

class OptionsTradeAnalyzer:
    """Debug analyzer to understand options trade timestamp distribution"""
    
    def __init__(self, base_url: str = "https://deribit.com/api/v2"):
        self.base_url = base_url
        self.session = None
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def fetch_with_retry(self, url: str, params: dict, max_retries: int = 3) -> dict:
        """Fetch data with retry logic"""
        for attempt in range(max_retries):
            try:
                async with self.session.get(url, params=params) as response:
                    if response.status == 429:
                        wait_time = 2 ** attempt
                        print(f"Rate limited, waiting {wait_time}s before retry {attempt + 1}")
                        await asyncio.sleep(wait_time)
                        continue
                    
                    response.raise_for_status()
                    data = await response.json()
                    return data.get("result", data)
                    
            except Exception as e:
                if attempt == max_retries - 1:
                    print(f"Failed to fetch {url} after {max_retries} attempts: {e}")
                    return {}
                await asyncio.sleep(1)
        
        return {}
    
    async def fetch_options_trades_with_analysis(self, currency: str = "BTC", hours_back: int = 24) -> Dict:
        """Fetch options trades and analyze timestamp distribution"""
        url = f"{self.base_url}/public/get_last_trades_by_currency_and_time"
        
        # Calculate time range
        end_time = datetime.now()
        start_time = end_time - timedelta(hours=hours_back)
        
        print(f"\n=== Analyzing {currency} Options Trades ===")
        print(f"Requested time range: {start_time.strftime('%Y-%m-%d %H:%M:%S')} to {end_time.strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"Requested duration: {hours_back} hours")
        
        params = {
            "currency": currency,
            "kind": "option",
            "start_timestamp": int(start_time.timestamp() * 1000),
            "end_timestamp": int(end_time.timestamp() * 1000),
            "count": 1000,  # Max allowed
            "sorting": "desc"  # Most recent first
        }
        
        result = await self.fetch_with_retry(url, params)
        
        # Handle response structure
        trades = []
        if isinstance(result, dict):
            trades = result.get("trades", [])
            has_more = result.get("has_more", False)
            print(f"API indicates has_more: {has_more}")
        elif isinstance(result, list):
            trades = result
        
        if not trades:
            print("No trades found!")
            return {}
        
        print(f"Fetched {len(trades)} trades")
        
        # Analyze timestamps
        timestamps = [trade.get("timestamp", 0) for trade in trades if trade.get("timestamp", 0) > 0]
        timestamps.sort()
        
        if not timestamps:
            print("No valid timestamps found!")
            return {}
        
        # Convert to datetime objects
        first_trade_time = datetime.fromtimestamp(timestamps[0] / 1000)
        last_trade_time = datetime.fromtimestamp(timestamps[-1] / 1000)
        
        print(f"\nActual trade time range:")
        print(f"Oldest trade: {first_trade_time.strftime('%Y-%m-%d %H:%M:%S')} ({first_trade_time})")
        print(f"Newest trade: {last_trade_time.strftime('%Y-%m-%d %H:%M:%S')} ({last_trade_time})")
        
        # Calculate actual duration covered
        actual_duration = last_trade_time - first_trade_time
        actual_hours = actual_duration.total_seconds() / 3600
        print(f"Actual duration covered: {actual_hours:.2f} hours")
        
        # Check if we're missing data at the beginning
        requested_start = start_time
        gap_at_start = first_trade_time - requested_start
        gap_hours = gap_at_start.total_seconds() / 3600
        
        print(f"\nCoverage analysis:")
        print(f"Gap from requested start: {gap_hours:.2f} hours")
        print(f"Coverage: {(actual_hours/hours_back)*100:.1f}% of requested timeframe")
        
        # Analyze trade distribution by hour
        hourly_counts = {}
        for ts in timestamps:
            hour = datetime.fromtimestamp(ts / 1000).strftime('%Y-%m-%d %H:00')
            hourly_counts[hour] = hourly_counts.get(hour, 0) + 1
        
        print(f"\nTrade distribution by hour (last 10 hours):")
        sorted_hours = sorted(hourly_counts.items(), reverse=True)[:10]
        for hour, count in sorted_hours:
            print(f"  {hour}: {count} trades")
        
        # Check if we hit the 1000 limit
        hit_limit = len(trades) >= 1000
        print(f"\nHit 1000 trade limit: {hit_limit}")
        
        if hit_limit:
            print("⚠️  We may be missing older trades due to the 1000 limit!")
            print("Consider implementing timestamp-based pagination for complete coverage.")
        
        # Analyze instrument diversity
        instruments = set()
        strikes = set()
        for trade in trades:
            instrument = trade.get("instrument_name", "")
            if instrument:
                instruments.add(instrument)
                # Extract strike
                parts = instrument.split("-")
                if len(parts) >= 3:
                    try:
                        strike = float(parts[2])
                        strikes.add(strike)
                    except ValueError:
                        pass
        
        print(f"\nInstrument diversity:")
        print(f"Unique instruments traded: {len(instruments)}")
        print(f"Unique strikes traded: {len(strikes)}")
        
        if strikes:
            print(f"Strike range: ${min(strikes):,.0f} - ${max(strikes):,.0f}")
        
        return {
            "total_trades": len(trades),
            "actual_hours_covered": actual_hours,
            "coverage_percentage": (actual_hours/hours_back)*100,
            "hit_limit": hit_limit,
            "unique_instruments": len(instruments),
            "unique_strikes": len(strikes),
            "first_trade_time": first_trade_time,
            "last_trade_time": last_trade_time,
            "hourly_distribution": hourly_counts
        }
    
    async def test_pagination_strategy(self, currency: str = "BTC", hours_back: int = 24, chunk_hours: int = 6):
        """Test a pagination strategy using smaller time chunks"""
        print(f"\n=== Testing Pagination Strategy ===")
        print(f"Breaking {hours_back}h into {chunk_hours}h chunks")
        
        end_time = datetime.now()
        all_trades = []
        chunks_processed = 0
        
        for i in range(0, hours_back, chunk_hours):
            chunk_end = end_time - timedelta(hours=i)
            chunk_start = end_time - timedelta(hours=min(i + chunk_hours, hours_back))
            
            print(f"\nChunk {chunks_processed + 1}: {chunk_start.strftime('%H:%M')} to {chunk_end.strftime('%H:%M')}")
            
            params = {
                "currency": currency,
                "kind": "option",
                "start_timestamp": int(chunk_start.timestamp() * 1000),
                "end_timestamp": int(chunk_end.timestamp() * 1000),
                "count": 1000,
                "sorting": "desc"
            }
            
            url = f"{self.base_url}/public/get_last_trades_by_currency_and_time"
            result = await self.fetch_with_retry(url, params)
            
            chunk_trades = []
            if isinstance(result, dict):
                chunk_trades = result.get("trades", [])
            elif isinstance(result, list):
                chunk_trades = result
            
            print(f"  Fetched {len(chunk_trades)} trades")
            all_trades.extend(chunk_trades)
            chunks_processed += 1
            
            # Small delay to be nice to the API
            await asyncio.sleep(0.5)
        
        # Remove duplicates based on trade_id
        unique_trades = {}
        for trade in all_trades:
            trade_id = trade.get("trade_id")
            if trade_id and trade_id not in unique_trades:
                unique_trades[trade_id] = trade
        
        print(f"\nPagination Results:")
        print(f"Total trades collected: {len(all_trades)}")
        print(f"Unique trades after deduplication: {len(unique_trades)}")
        print(f"Chunks processed: {chunks_processed}")
        
        return list(unique_trades.values())

async def main():
    """Main analysis function"""
    async with OptionsTradeAnalyzer() as analyzer:
        # Analyze BTC first
        btc_analysis = await analyzer.fetch_options_trades_with_analysis("BTC", 24)
        
        # If we hit the limit, test pagination
        if btc_analysis.get("hit_limit", False):
            print("\n" + "="*60)
            paginated_trades = await analyzer.test_pagination_strategy("BTC", 24, 6)
            print(f"Pagination collected {len(paginated_trades)} unique trades")
        
        # Also test ETH
        print("\n" + "="*60)
        eth_analysis = await analyzer.fetch_options_trades_with_analysis("ETH", 24)

if __name__ == "__main__":
    asyncio.run(main()) 
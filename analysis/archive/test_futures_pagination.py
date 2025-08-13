#!/usr/bin/env python3
"""
Test Futures Data Pagination vs Standard Fetch
Compares 1000-trade limit vs complete pagination to see what we're missing
"""

import asyncio
import aiohttp
import math
from datetime import datetime, timedelta
from typing import List, Dict

class FuturesPaginationTest:
    """Test futures data coverage with and without pagination"""
    
    def __init__(self):
        self.base_url = "https://www.deribit.com/api/v2"
        self.session = None
        
    async def __aenter__(self):
        timeout = aiohttp.ClientTimeout(total=30)
        self.session = aiohttp.ClientSession(timeout=timeout)
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    def prepare_params(self, params: Dict) -> Dict:
        """Convert parameters to string format for aiohttp"""
        prepared = {}
        for key, value in params.items():
            if isinstance(value, bool):
                prepared[key] = "true" if value else "false"
            else:
                prepared[key] = str(value)
        return prepared
    
    async def fetch_with_retry(self, url: str, params: Dict = None, max_retries: int = 3) -> Dict:
        """Fetch data with retry logic"""
        for attempt in range(max_retries):
            try:
                await asyncio.sleep(0.2)  # Rate limiting
                
                prepared_params = self.prepare_params(params) if params else {}
                async with self.session.get(url, params=prepared_params) as response:
                    if response.status == 200:
                        data = await response.json()
                        return data.get("result", data)
                    elif response.status == 429:
                        wait_time = 2 ** attempt
                        print(f"Rate limited, waiting {wait_time}s...")
                        await asyncio.sleep(wait_time)
                    else:
                        print(f"HTTP {response.status} for {url}")
                        
            except Exception as e:
                print(f"Attempt {attempt + 1} failed for {url}: {e}")
                if attempt == max_retries - 1:
                    return {}
                await asyncio.sleep(1)
        
        return {}
    
    async def fetch_futures_standard(self, currency: str = "BTC", hours_back: int = 24) -> List[Dict]:
        """Standard futures fetch (limited to 1000 trades)"""
        print(f"\n=== Standard Futures Fetch ({currency}) ===")
        
        url = f"{self.base_url}/public/get_last_trades_by_currency"
        params = {
            "currency": currency,
            "kind": "future",
            "count": 1000,
            "include_old": True
        }
        
        result = await self.fetch_with_retry(url, params)
        
        trades = []
        if isinstance(result, dict):
            trades = result.get("trades", result.get("result", []))
        elif isinstance(result, list):
            trades = result
        
        if not isinstance(trades, list):
            print(f"Could not find trades list in response: {type(result)}")
            return []
        
        print(f"Fetched {len(trades)} total trades")
        
        # Filter trades from the last N hours
        cutoff_time = datetime.now() - timedelta(hours=hours_back)
        cutoff_timestamp = int(cutoff_time.timestamp() * 1000)
        
        filtered_trades = []
        for trade in trades:
            if trade.get("timestamp", 0) >= cutoff_timestamp:
                filtered_trades.append(trade)
        
        print(f"Filtered to {len(filtered_trades)} recent trades (last {hours_back}h)")
        return filtered_trades
    
    async def fetch_futures_paginated(self, currency: str = "BTC", hours_back: int = 24, chunk_hours: int = 4) -> List[Dict]:
        """Paginated futures fetch (complete coverage)"""
        print(f"\n=== Paginated Futures Fetch ({currency}) ===")
        
        end_time = datetime.now()
        all_trades = []
        unique_trades = {}
        total_chunks = math.ceil(hours_back / chunk_hours)
        
        print(f"Using {chunk_hours}h chunks, {total_chunks} total chunks needed")
        
        for chunk_idx in range(total_chunks):
            chunk_start_hours = chunk_idx * chunk_hours
            chunk_end_hours = min((chunk_idx + 1) * chunk_hours, hours_back)
            
            chunk_end = end_time - timedelta(hours=chunk_start_hours)
            chunk_start = end_time - timedelta(hours=chunk_end_hours)
            
            print(f"Chunk {chunk_idx + 1}/{total_chunks}: {chunk_start.strftime('%m/%d %H:%M')} to {chunk_end.strftime('%m/%d %H:%M')}")
            
            params = {
                "currency": currency,
                "kind": "future",
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
                has_more = result.get("has_more", False)
                if has_more:
                    print(f"  ⚠️  Chunk has more data (may need smaller chunks)")
            elif isinstance(result, list):
                chunk_trades = result
            
            print(f"  Fetched {len(chunk_trades)} trades")
            
            # Deduplicate by trade_id
            chunk_unique = 0
            for trade in chunk_trades:
                trade_id = trade.get("trade_id")
                if trade_id and trade_id not in unique_trades:
                    unique_trades[trade_id] = trade
                    chunk_unique += 1
            
            print(f"  Added {chunk_unique} unique trades")
            await asyncio.sleep(0.3)  # Be nice to the API
        
        all_trades = list(unique_trades.values())
        print(f"\nTotal unique trades collected: {len(all_trades)}")
        
        # Analyze coverage
        if all_trades:
            timestamps = [trade.get("timestamp", 0) for trade in all_trades if trade.get("timestamp", 0) > 0]
            if timestamps:
                timestamps.sort()
                first_trade = datetime.fromtimestamp(timestamps[0] / 1000)
                last_trade = datetime.fromtimestamp(timestamps[-1] / 1000)
                coverage_hours = (last_trade - first_trade).total_seconds() / 3600
                print(f"Coverage: {coverage_hours:.1f} hours ({coverage_hours/hours_back*100:.1f}%)")
        
        return all_trades
    
    def analyze_volume_profile(self, trades: List[Dict], label: str) -> Dict:
        """Analyze volume profile from trades"""
        if not trades:
            return {}
        
        print(f"\n--- {label} Volume Profile Analysis ---")
        
        # Group trades by price level
        price_levels = {}
        total_volume = 0
        
        for trade in trades:
            price = trade.get("price", 0)
            amount = trade.get("amount", 0)
            
            if price <= 0 or amount <= 0:
                continue
            
            # Round price to create levels
            if price > 1000:  # BTC-like prices
                level = round(price / 10) * 10
            else:  # ETH-like prices
                level = round(price)
            
            if level not in price_levels:
                price_levels[level] = 0
            
            price_levels[level] += amount
            total_volume += amount
        
        if not price_levels:
            return {}
        
        # Find top volume levels
        sorted_levels = sorted(price_levels.items(), key=lambda x: x[1], reverse=True)
        top_5_levels = sorted_levels[:5]
        
        print(f"Total Volume: {total_volume:,.2f}")
        print(f"Price Levels: {len(price_levels)}")
        print(f"Top 5 Volume Levels:")
        for i, (price, volume) in enumerate(top_5_levels, 1):
            pct = (volume / total_volume) * 100
            print(f"  {i}. ${price:,.0f}: {volume:,.2f} ({pct:.1f}%)")
        
        # Calculate price range and distribution
        prices = [trade.get("price", 0) for trade in trades if trade.get("price", 0) > 0]
        if prices:
            price_range = max(prices) - min(prices)
            avg_price = sum(prices) / len(prices)
            print(f"Price Range: ${min(prices):,.2f} - ${max(prices):,.2f} (${price_range:,.2f})")
            print(f"Average Price: ${avg_price:,.2f}")
        
        return {
            "total_volume": total_volume,
            "price_levels": len(price_levels),
            "hvl_price": top_5_levels[0][0] if top_5_levels else 0,
            "hvl_volume": top_5_levels[0][1] if top_5_levels else 0,
            "price_range": price_range if prices else 0,
            "avg_price": avg_price if prices else 0,
            "top_levels": top_5_levels
        }
    
    def compare_datasets(self, standard_data: Dict, paginated_data: Dict, currency: str):
        """Compare standard vs paginated data"""
        print(f"\n{'='*60}")
        print(f"📊 COMPARISON SUMMARY - {currency}")
        print(f"{'='*60}")
        
        # Volume comparison
        std_volume = standard_data.get("total_volume", 0)
        pag_volume = paginated_data.get("total_volume", 0)
        volume_diff = pag_volume - std_volume
        volume_pct = (volume_diff / std_volume * 100) if std_volume > 0 else 0
        
        print(f"📈 Volume Analysis:")
        print(f"   Standard (1000 limit): {std_volume:,.2f}")
        print(f"   Paginated (complete):  {pag_volume:,.2f}")
        print(f"   Difference: +{volume_diff:,.2f} ({volume_pct:+.1f}%)")
        
        # Price level coverage
        std_levels = standard_data.get("price_levels", 0)
        pag_levels = paginated_data.get("price_levels", 0)
        level_diff = pag_levels - std_levels
        
        print(f"\n🎯 Price Level Coverage:")
        print(f"   Standard: {std_levels} price levels")
        print(f"   Paginated: {pag_levels} price levels")
        print(f"   Additional levels: +{level_diff}")
        
        # HVL comparison
        std_hvl = standard_data.get("hvl_price", 0)
        pag_hvl = paginated_data.get("hvl_price", 0)
        
        print(f"\n🔥 High Volume Level (HVL):")
        print(f"   Standard HVL: ${std_hvl:,.0f}")
        print(f"   Paginated HVL: ${pag_hvl:,.0f}")
        if std_hvl != pag_hvl:
            print(f"   ⚠️  HVL CHANGED with more data!")
        else:
            print(f"   ✅ HVL consistent")
        
        # Price range comparison
        std_range = standard_data.get("price_range", 0)
        pag_range = paginated_data.get("price_range", 0)
        
        print(f"\n📏 Price Range Coverage:")
        print(f"   Standard: ${std_range:,.2f}")
        print(f"   Paginated: ${pag_range:,.2f}")
        print(f"   Additional range: ${pag_range - std_range:,.2f}")
        
        # Impact assessment
        print(f"\n💡 Impact Assessment:")
        if volume_pct > 50:
            print(f"   🔴 CRITICAL: Missing {volume_pct:.1f}% of volume data")
        elif volume_pct > 20:
            print(f"   🟡 SIGNIFICANT: Missing {volume_pct:.1f}% of volume data")
        elif volume_pct > 5:
            print(f"   🟢 MINOR: Missing {volume_pct:.1f}% of volume data")
        else:
            print(f"   ✅ MINIMAL: Only missing {volume_pct:.1f}% of volume data")
        
        if std_hvl != pag_hvl:
            print(f"   🔴 HVL calculation affected by incomplete data")
        
        if level_diff > 10:
            print(f"   🟡 Significant price level coverage gaps")

async def test_futures_pagination():
    """Test futures data with and without pagination"""
    print("=" * 80)
    print("🚀 Testing Futures Data: Standard vs Paginated")
    print("=" * 80)
    
    async with FuturesPaginationTest() as tester:
        for currency in ["BTC", "ETH"]:
            try:
                print(f"\n{'='*60}")
                print(f"Testing {currency} Futures Data Coverage")
                print(f"{'='*60}")
                
                # Test both approaches
                standard_trades = await tester.fetch_futures_standard(currency, hours_back=24)
                paginated_trades = await tester.fetch_futures_paginated(currency, hours_back=24, chunk_hours=4)
                
                # Analyze volume profiles
                standard_analysis = tester.analyze_volume_profile(standard_trades, "Standard (1000 limit)")
                paginated_analysis = tester.analyze_volume_profile(paginated_trades, "Paginated (complete)")
                
                # Compare results
                tester.compare_datasets(standard_analysis, paginated_analysis, currency)
                
            except Exception as e:
                print(f"❌ Error testing {currency}: {e}")
                import traceback
                traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_futures_pagination()) 
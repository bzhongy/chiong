import asyncio
import aiohttp
import math
from typing import List, Dict, Optional
from datetime import datetime, timedelta
import numpy as np
from scipy.stats import norm

class DeribitAnalyticsWithPagination:
    """Enhanced analytics engine with complete options flow coverage via pagination"""
    
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
        """Fetch data with retry logic and rate limiting"""
        for attempt in range(max_retries):
            try:
                # Convert boolean parameters to strings
                str_params = {}
                for key, value in params.items():
                    if isinstance(value, bool):
                        str_params[key] = "true" if value else "false"
                    else:
                        str_params[key] = value
                
                async with self.session.get(url, params=str_params) as response:
                    if response.status == 429:  # Rate limited
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
    
    async def fetch_complete_options_trades(self, currency: str = "BTC", hours_back: int = 24, chunk_hours: int = 4) -> List[Dict]:
        """Fetch complete options trades using timestamp-based pagination"""
        print(f"\n=== Fetching Complete {currency} Options Flow ({hours_back}h) ===")
        
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
            
            # Small delay to be nice to the API
            await asyncio.sleep(0.3)
        
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
                print(f"Time range: {first_trade.strftime('%m/%d %H:%M')} to {last_trade.strftime('%m/%d %H:%M')}")
        
        return all_trades
    
    async def fetch_book_summary_by_currency(self, currency: str = "BTC") -> List[Dict]:
        """Fetch book summary for all instruments in a currency"""
        url = f"{self.base_url}/public/get_book_summary_by_currency"
        params = {"currency": currency, "kind": "option"}
        
        result = await self.fetch_with_retry(url, params)
        return result if isinstance(result, list) else []
    
    async def fetch_futures_trades(self, currency: str = "BTC", hours_back: int = 24) -> List[Dict]:
        """Fetch historical futures trades for volume profile analysis"""
        url = f"{self.base_url}/public/get_last_trades_by_currency"
        
        params = {
            "currency": currency,
            "kind": "future",
            "count": 1000,
            "include_old": True
        }
        
        result = await self.fetch_with_retry(url, params)
        
        # Handle different response structures
        trades = []
        if isinstance(result, dict):
            trades = result.get("trades", result.get("result", []))
        elif isinstance(result, list):
            trades = result
        
        if not isinstance(trades, list):
            return []
        
        # Filter trades from the last N hours
        cutoff_time = datetime.now() - timedelta(hours=hours_back)
        cutoff_timestamp = int(cutoff_time.timestamp() * 1000)
        
        filtered_trades = []
        for trade in trades:
            if trade.get("timestamp", 0) >= cutoff_timestamp:
                filtered_trades.append(trade)
        
        return filtered_trades
    
    async def fetch_index_price(self, currency: str = "BTC") -> float:
        """Fetch current index price"""
        url = f"{self.base_url}/public/get_index_price"
        params = {"index_name": f"{currency.lower()}_usd"}
        
        result = await self.fetch_with_retry(url, params)
        return result.get("index_price", 0)
    
    def analyze_complete_options_flow(self, trades: List[Dict], spot_price: float) -> Dict[str, float]:
        """Analyze complete options flow with time-weighted analysis"""
        if not trades:
            return {}
        
        print(f"Analyzing {len(trades)} options trades for flow patterns...")
        
        # Group trades by strike price and calculate comprehensive flow metrics
        strike_flow = {}
        total_volume = 0
        
        for trade in trades:
            try:
                # Parse instrument name to extract strike and expiry
                instrument = trade.get("instrument_name", "")
                if not instrument:
                    continue
                
                # Format: BTC-25SEP20-6000-P or BTC-25SEP20-6000-C
                parts = instrument.split("-")
                if len(parts) < 4:
                    continue
                
                strike = float(parts[2])
                option_type = parts[3]  # P or C
                expiry_str = parts[1]
                
                amount = trade.get("amount", 0)
                price = trade.get("price", 0)
                direction = trade.get("direction", "")
                timestamp = trade.get("timestamp", 0)
                
                if amount <= 0 or price <= 0:
                    continue
                
                # Calculate notional value (premium paid)
                notional = amount * price * spot_price  # Convert to USD
                total_volume += notional
                
                # Time weighting - more recent trades weighted higher
                hours_ago = (datetime.now().timestamp() * 1000 - timestamp) / (1000 * 3600)
                time_weight = math.exp(-hours_ago / 8)  # 8-hour half-life
                
                # Calculate delta-adjusted exposure
                moneyness = spot_price / strike
                if option_type == "C":  # Call
                    approx_delta = max(0.05, min(0.95, 0.5 + 0.4 * (moneyness - 1)))
                else:  # Put
                    approx_delta = max(0.05, min(0.95, 0.5 - 0.4 * (moneyness - 1)))
                
                delta_exposure = notional * approx_delta
                
                # Flow direction (positive = buying pressure, negative = selling pressure)
                flow_direction = 1 if direction == "buy" else -1
                
                # Check if it's 0DTE (today's expiry)
                today = datetime.now().strftime("%d%b%y").upper()
                is_0dte = expiry_str == today
                
                if strike not in strike_flow:
                    strike_flow[strike] = {
                        "total_volume": 0,
                        "net_flow": 0,
                        "call_volume": 0,
                        "put_volume": 0,
                        "weighted_flow": 0,
                        "call_flow": 0,
                        "put_flow": 0,
                        "dte_0_volume": 0,
                        "dte_0_call_volume": 0,
                        "dte_0_put_volume": 0,
                        "trade_count": 0
                    }
                
                data = strike_flow[strike]
                data["total_volume"] += notional
                data["net_flow"] += delta_exposure * flow_direction
                data["weighted_flow"] += delta_exposure * flow_direction * time_weight
                data["trade_count"] += 1
                
                if option_type == "C":
                    data["call_volume"] += notional
                    data["call_flow"] += delta_exposure * flow_direction
                    if is_0dte:
                        data["dte_0_call_volume"] += notional
                else:
                    data["put_volume"] += notional
                    data["put_flow"] += delta_exposure * flow_direction
                    if is_0dte:
                        data["dte_0_put_volume"] += notional
                
                if is_0dte:
                    data["dte_0_volume"] += notional
                    
            except (ValueError, IndexError) as e:
                continue
        
        if not strike_flow:
            return {}
        
        print(f"Processed ${total_volume:,.0f} in total options volume across {len(strike_flow)} strikes")
        
        # Calculate comprehensive flow levels
        levels = {}
        
        # 1. Highest Volume Strike (HVS) - strike with most trading activity
        max_volume_strike = max(strike_flow.items(), key=lambda x: x[1]["total_volume"])
        levels["HVS"] = max_volume_strike[0]
        levels["HVS_Volume"] = max_volume_strike[1]["total_volume"]
        
        # 2. Max Pain Flow - strike with most balanced call/put activity
        balanced_strikes = []
        for strike, data in strike_flow.items():
            if data["call_volume"] > 0 and data["put_volume"] > 0:
                balance_ratio = min(data["call_volume"], data["put_volume"]) / max(data["call_volume"], data["put_volume"])
                balanced_strikes.append((strike, balance_ratio, data["total_volume"]))
        
        if balanced_strikes:
            balanced_strikes.sort(key=lambda x: (x[1], x[2]), reverse=True)
            levels["Max Pain Flow"] = balanced_strikes[0][0]
        
        # 3. Call Flow Resistance - strike above spot with highest net call buying
        call_resistance_strikes = [
            (strike, data["call_flow"]) 
            for strike, data in strike_flow.items() 
            if strike > spot_price and data["call_flow"] > 0
        ]
        if call_resistance_strikes:
            call_resistance_strikes.sort(key=lambda x: x[1], reverse=True)
            levels["Call Flow Resistance"] = call_resistance_strikes[0][0]
        
        # 4. Put Flow Support - strike below spot with highest net put buying
        put_support_strikes = [
            (strike, abs(data["put_flow"])) 
            for strike, data in strike_flow.items() 
            if strike < spot_price and data["put_flow"] < 0  # Negative put flow = put buying
        ]
        if put_support_strikes:
            put_support_strikes.sort(key=lambda x: x[1], reverse=True)
            levels["Put Flow Support"] = put_support_strikes[0][0]
        
        # 5. 0DTE Flow Levels
        dte_0_call_strikes = [
            (strike, data["dte_0_call_volume"]) 
            for strike, data in strike_flow.items() 
            if strike > spot_price and data["dte_0_call_volume"] > 0
        ]
        if dte_0_call_strikes:
            dte_0_call_strikes.sort(key=lambda x: x[1], reverse=True)
            levels["Call Flow Resistance 0DTE"] = dte_0_call_strikes[0][0]
        
        dte_0_put_strikes = [
            (strike, data["dte_0_put_volume"]) 
            for strike, data in strike_flow.items() 
            if strike < spot_price and data["dte_0_put_volume"] > 0
        ]
        if dte_0_put_strikes:
            dte_0_put_strikes.sort(key=lambda x: x[1], reverse=True)
            levels["Put Flow Support 0DTE"] = dte_0_put_strikes[0][0]
        
        # 6. Volume-Weighted Average Strike (VWAS)
        if total_volume > 0:
            vwas = sum(strike * data["total_volume"] for strike, data in strike_flow.items()) / total_volume
            levels["VWAS"] = vwas
        
        # 7. Flow Momentum - net directional flow
        total_call_flow = sum(data["call_flow"] for data in strike_flow.values())
        total_put_flow = sum(data["put_flow"] for data in strike_flow.values())
        net_flow = total_call_flow + total_put_flow
        
        levels["Net Flow Bias"] = "Bullish" if net_flow > 0 else "Bearish"
        levels["Flow Strength"] = abs(net_flow)
        
        return levels
    
    def calculate_volume_profile(self, trades: List[Dict]) -> Dict[str, float]:
        """Calculate volume profile from futures trades"""
        if not trades:
            return {}
        
        # Group trades by price level
        price_levels = {}
        
        for trade in trades:
            price = trade.get("price", 0)
            amount = trade.get("amount", 0)
            
            # Round price to create levels
            if price > 1000:  # BTC-like prices
                level = round(price / 10) * 10
            else:  # ETH-like prices
                level = round(price)
            
            if level not in price_levels:
                price_levels[level] = 0
            
            price_levels[level] += amount
        
        if not price_levels:
            return {}
        
        # Find high volume level (HVL)
        max_volume_level = max(price_levels.items(), key=lambda x: x[1])
        
        return {
            "HVL": max_volume_level[0],
            "HVL_Volume": max_volume_level[1]
        }
    
    def calculate_1d_max_min(self, trades: List[Dict]) -> Dict[str, float]:
        """Calculate 1D max/min from futures trades"""
        if not trades:
            return {}
        
        prices = [trade.get("price", 0) for trade in trades if trade.get("price", 0) > 0]
        
        if not prices:
            return {}
        
        return {
            "1D Max": max(prices),
            "1D Min": min(prices)
        }
    
    def calculate_open_interest_levels(self, book_data: List[Dict], spot_price: float) -> Dict[str, float]:
        """Calculate support/resistance levels from open interest"""
        if not book_data:
            return {}
        
        # Group by strike and calculate total open interest
        strike_oi = {}
        today = datetime.now().strftime("%d%b%y").upper()
        
        for instrument in book_data:
            try:
                name = instrument.get("instrument_name", "")
                if not name:
                    continue
                
                parts = name.split("-")
                if len(parts) < 4:
                    continue
                
                strike = float(parts[2])
                option_type = parts[3]
                expiry = parts[1]
                
                open_interest = instrument.get("open_interest", 0)
                if open_interest <= 0:
                    continue
                
                if strike not in strike_oi:
                    strike_oi[strike] = {
                        "total_oi": 0,
                        "call_oi": 0,
                        "put_oi": 0,
                        "dte_0_oi": 0
                    }
                
                strike_oi[strike]["total_oi"] += open_interest
                
                if option_type == "C":
                    strike_oi[strike]["call_oi"] += open_interest
                else:
                    strike_oi[strike]["put_oi"] += open_interest
                
                # Check if it's 0DTE
                if expiry == today:
                    strike_oi[strike]["dte_0_oi"] += open_interest
                    
            except (ValueError, IndexError):
                continue
        
        if not strike_oi:
            return {}
        
        levels = {}
        
        # Call Resistance - highest call OI above spot
        call_strikes = [(strike, data["call_oi"]) for strike, data in strike_oi.items() 
                       if strike > spot_price and data["call_oi"] > 0]
        if call_strikes:
            call_strikes.sort(key=lambda x: x[1], reverse=True)
            levels["Call Resistance"] = call_strikes[0][0]
        
        # Put Support - highest put OI below spot
        put_strikes = [(strike, data["put_oi"]) for strike, data in strike_oi.items() 
                      if strike < spot_price and data["put_oi"] > 0]
        if put_strikes:
            put_strikes.sort(key=lambda x: x[1], reverse=True)
            levels["Put Support"] = put_strikes[0][0]
        
        # Gamma Wall 0DTE - highest 0DTE OI
        dte_0_strikes = [(strike, data["dte_0_oi"]) for strike, data in strike_oi.items() 
                        if data["dte_0_oi"] > 0]
        if dte_0_strikes:
            dte_0_strikes.sort(key=lambda x: x[1], reverse=True)
            levels["Gamma Wall 0DTE"] = dte_0_strikes[0][0]
        
        return levels
    
    async def get_complete_analysis(self, currency: str = "BTC") -> Dict[str, any]:
        """Get complete analytics with full options flow coverage"""
        print(f"\n=== Complete {currency} Analysis ===")
        
        # Fetch spot price
        spot_price = await self.fetch_index_price(currency)
        print(f"Current {currency} price: ${spot_price:,.2f}")
        
        # Fetch complete options trades with pagination
        options_trades = await self.fetch_complete_options_trades(currency, 24, 4)
        
        # Fetch other data in parallel
        book_data, futures_trades = await asyncio.gather(
            self.fetch_book_summary_by_currency(currency),
            self.fetch_futures_trades(currency)
        )
        
        print(f"Data summary: {len(options_trades)} options trades, {len(book_data)} instruments, {len(futures_trades)} futures trades")
        
        # Calculate all levels
        flow_levels = self.analyze_complete_options_flow(options_trades, spot_price)
        oi_levels = self.calculate_open_interest_levels(book_data, spot_price)
        volume_levels = self.calculate_volume_profile(futures_trades)
        max_min_levels = self.calculate_1d_max_min(futures_trades)
        
        # Combine all levels
        all_levels = {
            **flow_levels,
            **oi_levels,
            **volume_levels,
            **max_min_levels
        }
        
        # Calculate percentage distances from spot
        result = {
            "currency": currency,
            "spot_price": spot_price,
            "levels": {},
            "metadata": {
                "options_trades_analyzed": len(options_trades),
                "instruments_tracked": len(book_data),
                "futures_trades_analyzed": len(futures_trades)
            }
        }
        
        for level_name, level_price in all_levels.items():
            if isinstance(level_price, (int, float)) and level_price > 0:
                pct_change = ((level_price - spot_price) / spot_price) * 100
                result["levels"][level_name] = {
                    "price": level_price,
                    "percentage": pct_change
                }
            elif isinstance(level_price, str):
                result["levels"][level_name] = level_price
        
        return result

# Test function
async def test_complete_analytics():
    """Test the complete analytics with pagination"""
    async with DeribitAnalyticsWithPagination() as analytics:
        # Test BTC with complete coverage
        btc_result = await analytics.get_complete_analysis("BTC")
        
        print(f"\n=== {btc_result['currency']} Complete Results ===")
        print(f"Spot Price: ${btc_result['spot_price']:,.2f}")
        print(f"Data Coverage: {btc_result['metadata']['options_trades_analyzed']} options trades analyzed")
        
        for level_name, level_data in btc_result['levels'].items():
            if isinstance(level_data, dict) and 'price' in level_data:
                price = level_data['price']
                pct = level_data['percentage']
                print(f"{level_name}: ${price:,.2f} ({pct:+.2f}%)")
            else:
                print(f"{level_name}: {level_data}")

if __name__ == "__main__":
    asyncio.run(test_complete_analytics()) 
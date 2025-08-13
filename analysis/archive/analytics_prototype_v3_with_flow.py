import asyncio
import aiohttp
import math
from typing import List, Dict, Optional
from datetime import datetime, timedelta
import numpy as np
from scipy.stats import norm

class DeribitAnalyticsV3:
    """Enhanced analytics engine with options flow analysis"""
    
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
    
    async def fetch_instruments(self, currency: str = "BTC") -> List[Dict]:
        """Fetch all available instruments for a currency"""
        url = f"{self.base_url}/public/get_instruments"
        params = {"currency": currency, "expired": False}
        
        result = await self.fetch_with_retry(url, params)
        return result if isinstance(result, list) else []
    
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
        
        print(f"Filtered to {len(filtered_trades)} recent trades")
        return filtered_trades
    
    async def fetch_options_trades(self, currency: str = "BTC", hours_back: int = 24) -> List[Dict]:
        """Fetch recent options trades for flow analysis"""
        url = f"{self.base_url}/public/get_last_trades_by_currency_and_time"
        
        # Calculate time range
        end_time = datetime.now()
        start_time = end_time - timedelta(hours=hours_back)
        
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
        elif isinstance(result, list):
            trades = result
        
        print(f"Fetched {len(trades)} options trades for {currency}")
        return trades
    
    async def fetch_index_price(self, currency: str = "BTC") -> float:
        """Fetch current index price"""
        url = f"{self.base_url}/public/get_index_price"
        params = {"index_name": f"{currency.lower()}_usd"}
        
        result = await self.fetch_with_retry(url, params)
        return result.get("index_price", 0)
    
    def black_scholes_delta(self, S: float, K: float, T: float, r: float, sigma: float, option_type: str) -> float:
        """Calculate Black-Scholes delta"""
        if T <= 0:
            return 1.0 if (option_type == "call" and S > K) else 0.0
        
        d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
        
        if option_type == "call":
            return norm.cdf(d1)
        else:  # put
            return norm.cdf(d1) - 1
    
    def black_scholes_gamma(self, S: float, K: float, T: float, r: float, sigma: float) -> float:
        """Calculate Black-Scholes gamma"""
        if T <= 0:
            return 0.0
        
        d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
        return norm.pdf(d1) / (S * sigma * math.sqrt(T))
    
    def analyze_options_flow(self, trades: List[Dict], spot_price: float) -> Dict[str, float]:
        """Analyze options flow to identify key levels from actual trading"""
        if not trades:
            return {}
        
        # Group trades by strike price and calculate flow metrics
        strike_flow = {}
        
        for trade in trades:
            try:
                # Parse instrument name to extract strike
                instrument = trade.get("instrument_name", "")
                if not instrument:
                    continue
                
                # Format: BTC-25SEP20-6000-P or BTC-25SEP20-6000-C
                parts = instrument.split("-")
                if len(parts) < 4:
                    continue
                
                strike = float(parts[2])
                option_type = parts[3]  # P or C
                
                amount = trade.get("amount", 0)
                price = trade.get("price", 0)
                direction = trade.get("direction", "")
                timestamp = trade.get("timestamp", 0)
                
                # Calculate notional value (premium paid)
                notional = amount * price * spot_price  # Convert to USD
                
                # Weight recent trades more heavily (exponential decay)
                hours_ago = (datetime.now().timestamp() * 1000 - timestamp) / (1000 * 3600)
                time_weight = math.exp(-hours_ago / 12)  # Half-life of 12 hours
                
                # Calculate delta-adjusted exposure
                # Simplified delta calculation (more accurate would use Black-Scholes)
                moneyness = spot_price / strike
                if option_type == "C":  # Call
                    approx_delta = max(0.05, min(0.95, 0.5 + 0.4 * (moneyness - 1)))
                else:  # Put
                    approx_delta = max(0.05, min(0.95, 0.5 - 0.4 * (moneyness - 1)))
                
                delta_exposure = notional * approx_delta
                
                # Adjust for buy/sell direction
                flow_direction = 1 if direction == "buy" else -1
                
                if strike not in strike_flow:
                    strike_flow[strike] = {
                        "total_volume": 0,
                        "net_flow": 0,
                        "call_volume": 0,
                        "put_volume": 0,
                        "weighted_flow": 0
                    }
                
                strike_flow[strike]["total_volume"] += notional
                strike_flow[strike]["net_flow"] += delta_exposure * flow_direction
                strike_flow[strike]["weighted_flow"] += delta_exposure * flow_direction * time_weight
                
                if option_type == "C":
                    strike_flow[strike]["call_volume"] += notional
                else:
                    strike_flow[strike]["put_volume"] += notional
                    
            except (ValueError, IndexError) as e:
                continue
        
        if not strike_flow:
            return {}
        
        # Find key levels based on flow analysis
        levels = {}
        
        # 1. Highest Volume Strike (HVS) - strike with most trading activity
        max_volume_strike = max(strike_flow.items(), key=lambda x: x[1]["total_volume"])
        levels["HVS"] = max_volume_strike[0]
        
        # 2. Max Pain Level - strike with most balanced call/put activity
        balanced_strikes = []
        for strike, data in strike_flow.items():
            if data["call_volume"] > 0 and data["put_volume"] > 0:
                balance_ratio = min(data["call_volume"], data["put_volume"]) / max(data["call_volume"], data["put_volume"])
                balanced_strikes.append((strike, balance_ratio, data["total_volume"]))
        
        if balanced_strikes:
            # Sort by balance ratio, then by volume
            balanced_strikes.sort(key=lambda x: (x[1], x[2]), reverse=True)
            levels["Max Pain Flow"] = balanced_strikes[0][0]
        
        # 3. Net Call Flow Resistance - strike above spot with highest net call buying
        call_resistance_strikes = [
            (strike, data["weighted_flow"]) 
            for strike, data in strike_flow.items() 
            if strike > spot_price and data["call_volume"] > data["put_volume"]
        ]
        if call_resistance_strikes:
            call_resistance_strikes.sort(key=lambda x: x[1], reverse=True)
            levels["Call Flow Resistance"] = call_resistance_strikes[0][0]
        
        # 4. Net Put Flow Support - strike below spot with highest net put buying
        put_support_strikes = [
            (strike, abs(data["weighted_flow"])) 
            for strike, data in strike_flow.items() 
            if strike < spot_price and data["put_volume"] > data["call_volume"]
        ]
        if put_support_strikes:
            put_support_strikes.sort(key=lambda x: x[1], reverse=True)
            levels["Put Flow Support"] = put_support_strikes[0][0]
        
        # 5. Volume-Weighted Average Strike (VWAS)
        total_volume = sum(data["total_volume"] for data in strike_flow.values())
        if total_volume > 0:
            vwas = sum(strike * data["total_volume"] for strike, data in strike_flow.items()) / total_volume
            levels["VWAS"] = vwas
        
        return levels
    
    def calculate_volume_profile(self, trades: List[Dict]) -> Dict[str, float]:
        """Calculate volume profile from futures trades"""
        if not trades:
            return {}
        
        # Group trades by price level (rounded to nearest $10 for BTC, $1 for ETH)
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
                
                # Calculate delta-adjusted exposure
                # Simplified calculation
                moneyness = spot_price / strike
                if option_type == "C":
                    delta = max(0.05, min(0.95, 0.5 + 0.4 * (moneyness - 1)))
                else:
                    delta = max(0.05, min(0.95, 0.5 - 0.4 * (moneyness - 1)))
                
                delta_exposure = open_interest * abs(delta) * spot_price
                
                if strike not in strike_oi:
                    strike_oi[strike] = {
                        "total_oi": 0,
                        "call_oi": 0,
                        "put_oi": 0,
                        "delta_exposure": 0,
                        "dte_0_oi": 0
                    }
                
                strike_oi[strike]["total_oi"] += open_interest
                strike_oi[strike]["delta_exposure"] += delta_exposure
                
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
        
        # 0DTE versions
        dte_0_call_strikes = [(strike, data["call_oi"]) for strike, data in strike_oi.items() 
                             if strike > spot_price and data["dte_0_oi"] > 0 and data["call_oi"] > 0]
        if dte_0_call_strikes:
            dte_0_call_strikes.sort(key=lambda x: x[1], reverse=True)
            levels["Call Resistance 0DTE"] = dte_0_call_strikes[0][0]
        
        dte_0_put_strikes = [(strike, data["put_oi"]) for strike, data in strike_oi.items() 
                            if strike < spot_price and data["dte_0_oi"] > 0 and data["put_oi"] > 0]
        if dte_0_put_strikes:
            dte_0_put_strikes.sort(key=lambda x: x[1], reverse=True)
            levels["Put Support 0DTE"] = dte_0_put_strikes[0][0]
        
        # Gamma Wall 0DTE - simplified as highest 0DTE OI
        dte_0_strikes = [(strike, data["dte_0_oi"]) for strike, data in strike_oi.items() 
                        if data["dte_0_oi"] > 0]
        if dte_0_strikes:
            dte_0_strikes.sort(key=lambda x: x[1], reverse=True)
            levels["Gamma Wall 0DTE"] = dte_0_strikes[0][0]
        
        return levels
    
    async def get_all_levels(self, currency: str = "BTC") -> Dict[str, any]:
        """Get all analytics levels for a currency"""
        print(f"\n=== Analyzing {currency} ===")
        
        # Fetch all required data
        spot_price = await self.fetch_index_price(currency)
        print(f"Current {currency} price: ${spot_price:,.2f}")
        
        # Fetch data in parallel for efficiency
        book_data, futures_trades, options_trades = await asyncio.gather(
            self.fetch_book_summary_by_currency(currency),
            self.fetch_futures_trades(currency),
            self.fetch_options_trades(currency)
        )
        
        print(f"Fetched {len(book_data)} instruments, {len(futures_trades)} futures trades, {len(options_trades)} options trades")
        
        # Calculate all levels
        oi_levels = self.calculate_open_interest_levels(book_data, spot_price)
        volume_levels = self.calculate_volume_profile(futures_trades)
        max_min_levels = self.calculate_1d_max_min(futures_trades)
        flow_levels = self.analyze_options_flow(options_trades, spot_price)
        
        # Combine all levels
        all_levels = {
            **oi_levels,
            **volume_levels,
            **max_min_levels,
            **flow_levels
        }
        
        # Calculate percentage distances from spot
        result = {
            "currency": currency,
            "spot_price": spot_price,
            "levels": {}
        }
        
        for level_name, level_price in all_levels.items():
            if level_price and level_price > 0:
                pct_change = ((level_price - spot_price) / spot_price) * 100
                result["levels"][level_name] = {
                    "price": level_price,
                    "percentage": pct_change
                }
        
        return result

# Test function
async def test_flow_analytics():
    """Test the new flow analytics"""
    async with DeribitAnalyticsV3() as analytics:
        # Test BTC
        btc_result = await analytics.get_all_levels("BTC")
        
        print(f"\n=== {btc_result['currency']} Results ===")
        print(f"Spot Price: ${btc_result['spot_price']:,.2f}")
        
        for level_name, level_data in btc_result['levels'].items():
            price = level_data['price']
            pct = level_data['percentage']
            print(f"{level_name}: ${price:,.2f} ({pct:+.2f}%)")
        
        # Test ETH
        print("\n" + "="*50)
        eth_result = await analytics.get_all_levels("ETH")
        
        print(f"\n=== {eth_result['currency']} Results ===")
        print(f"Spot Price: ${eth_result['spot_price']:,.2f}")
        
        for level_name, level_data in eth_result['levels'].items():
            price = level_data['price']
            pct = level_data['percentage']
            print(f"{level_name}: ${price:,.2f} ({pct:+.2f}%)")

if __name__ == "__main__":
    asyncio.run(test_flow_analytics()) 
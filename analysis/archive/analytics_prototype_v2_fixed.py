#!/usr/bin/env python3
"""
Odette Analytics Prototype v2 - Fixed Version
Implements proper indicator calculations with fixed API parameter handling
"""

import asyncio
import aiohttp
import json
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import math
from dataclasses import dataclass

@dataclass
class KeyLevel:
    """Represents a key price level with distance to current spot"""
    name: str
    value: float
    distance_to_spot: float
    confidence: float = 1.0  # Confidence level based on data quality
    
    def to_dict(self):
        return {
            "name": self.name,
            "value": self.value,
            "distance_to_spot": f"{self.distance_to_spot:.2f}%",
            "confidence": self.confidence
        }

class DeribitAnalyticsV2Fixed:
    """Enhanced analytics engine for Deribit options data - Fixed Version"""
    
    def __init__(self):
        self.base_url = "https://www.deribit.com/api/v2"
        self.session = None
        
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
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
                prepared_params = self.prepare_params(params) if params else {}
                async with self.session.get(url, params=prepared_params) as response:
                    if response.status == 200:
                        data = await response.json()
                        return data.get("result", {})
                    else:
                        print(f"HTTP {response.status} for {url}")
                        
            except Exception as e:
                print(f"Attempt {attempt + 1} failed for {url}: {e}")
                if attempt == max_retries - 1:
                    raise
                await asyncio.sleep(1)  # Wait 1 second before retry
        
        return {}
    
    async def fetch_24h_stats(self, currency: str = "BTC") -> Dict:
        """Fetch 24h price statistics"""
        url = f"{self.base_url}/public/get_book_summary_by_currency"
        params = {"currency": currency, "kind": "future"}
        
        data = await self.fetch_with_retry(url, params)
        
        # Find the perpetual future for 24h stats
        if isinstance(data, list):
            for instrument in data:
                if instrument.get("instrument_name", "").endswith("-PERPETUAL"):
                    return {
                        "high_24h": instrument.get("high", 0),
                        "low_24h": instrument.get("low", 0),
                        "last_price": instrument.get("last", 0)
                    }
        
        return {"high_24h": 0, "low_24h": 0, "last_price": 0}
    
    async def fetch_instruments_with_oi(self, currency: str = "BTC") -> List[Dict]:
        """Fetch all active options with open interest data"""
        url = f"{self.base_url}/public/get_instruments"
        params = {
            "currency": currency,
            "kind": "option",
            "expired": False  # This will be converted to "false" string
        }
        
        instruments = await self.fetch_with_retry(url, params)
        
        if not isinstance(instruments, list):
            print(f"Expected list of instruments, got: {type(instruments)}")
            return []
        
        print(f"Found {len(instruments)} total instruments")
        
        # Fetch open interest for each instrument (with rate limiting)
        enhanced_instruments = []
        batch_size = 10  # Process in batches to avoid rate limits
        
        for i in range(0, len(instruments), batch_size):
            batch = instruments[i:i + batch_size]
            batch_tasks = []
            
            for instrument in batch:
                task = self.enhance_instrument_with_oi(instrument)
                batch_tasks.append(task)
            
            batch_results = await asyncio.gather(*batch_tasks, return_exceptions=True)
            
            for result in batch_results:
                if isinstance(result, Exception):
                    print(f"Error in batch processing: {result}")
                elif result:
                    enhanced_instruments.append(result)
            
            # Small delay between batches
            if i + batch_size < len(instruments):
                await asyncio.sleep(0.1)
        
        print(f"Enhanced {len(enhanced_instruments)} instruments with OI data")
        return enhanced_instruments
    
    async def enhance_instrument_with_oi(self, instrument: Dict) -> Optional[Dict]:
        """Add open interest data to a single instrument"""
        try:
            # Get book summary which includes open interest
            book_url = f"{self.base_url}/public/get_order_book"
            book_params = {"instrument_name": instrument["instrument_name"]}
            book_data = await self.fetch_with_retry(book_url, book_params)
            
            instrument["open_interest"] = book_data.get("open_interest", 0)
            instrument["volume"] = book_data.get("stats", {}).get("volume", 0)
            
            # Add parsed instrument details
            parsed = self.parse_instrument_name(instrument["instrument_name"])
            if parsed:
                instrument.update(parsed)
                return instrument
                
        except Exception as e:
            print(f"Error fetching OI for {instrument['instrument_name']}: {e}")
            
        return None
    
    async def fetch_futures_trades(self, currency: str = "BTC", hours_back: int = 24) -> List[Dict]:
        """Fetch historical futures trades for volume profile analysis"""
        url = f"{self.base_url}/public/get_last_trades_by_currency"
        
        # Get perpetual future trades
        params = {
            "currency": currency,
            "kind": "future",
            "count": 1000,  # Max allowed
            "include_old": True  # This will be converted to "true" string
        }
        
        trades = await self.fetch_with_retry(url, params)
        
        if not isinstance(trades, list):
            print(f"Expected list of trades, got: {type(trades)}")
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
    
    async def fetch_index_price(self, currency: str = "BTC") -> float:
        """Fetch current index price"""
        url = f"{self.base_url}/public/get_index_price"
        params = {"index_name": f"{currency.lower()}_usd"}
        
        result = await self.fetch_with_retry(url, params)
        return result.get("index_price", 0)
    
    def parse_instrument_name(self, instrument_name: str) -> Dict:
        """Parse Deribit instrument name into components"""
        # Format: BTC-25DEC24-100000-P
        parts = instrument_name.split('-')
        if len(parts) != 4:
            return {}
        
        currency, expiry_str, strike_str, option_type = parts
        strike = float(strike_str)
        
        # Parse expiry date
        try:
            expiry_date = datetime.strptime(expiry_str, "%d%b%y")
        except:
            return {}
        
        return {
            "currency": currency,
            "expiry_date": expiry_date,
            "strike": strike,
            "option_type": option_type,
            "is_call": option_type == "C",
            "is_put": option_type == "P"
        }
    
    def is_0dte(self, expiry_date: datetime) -> bool:
        """Check if option expires today (0DTE)"""
        today = datetime.now().date()
        return expiry_date.date() == today
    
    def is_current_weekly_monthly(self, expiry_date: datetime) -> bool:
        """Check if option is current weekly or monthly expiry"""
        today = datetime.now().date()
        days_to_expiry = (expiry_date.date() - today).days
        
        # Consider current if expiring within 7 days
        return 0 <= days_to_expiry <= 7
    
    def calculate_distance_to_spot(self, level: float, spot_price: float) -> float:
        """Calculate percentage distance from spot price"""
        return ((level - spot_price) / spot_price) * 100
    
    def calculate_delta(self, spot_price: float, strike: float, time_to_expiry: float, 
                       volatility: float, is_call: bool) -> float:
        """
        Simplified Black-Scholes delta calculation
        For more accuracy, would need risk-free rate and proper vol surface
        """
        if time_to_expiry <= 0:
            # At expiry
            if is_call:
                return 1.0 if spot_price > strike else 0.0
            else:
                return -1.0 if spot_price < strike else 0.0
        
        try:
            from scipy.stats import norm
            import math
            
            # Simplified B-S without risk-free rate
            d1 = (math.log(spot_price / strike) + (volatility**2 / 2) * time_to_expiry) / (volatility * math.sqrt(time_to_expiry))
            
            if is_call:
                return norm.cdf(d1)
            else:
                return norm.cdf(d1) - 1.0
                
        except ImportError:
            # Fallback approximation without scipy
            moneyness = spot_price / strike
            if is_call:
                return max(0, min(1, (moneyness - 0.8) / 0.4))  # Rough approximation
            else:
                return max(-1, min(0, (0.8 - moneyness) / 0.4))
    
    def calculate_gamma(self, spot_price: float, strike: float, time_to_expiry: float, 
                       volatility: float) -> float:
        """Simplified gamma calculation"""
        if time_to_expiry <= 0:
            return 0.0
        
        try:
            from scipy.stats import norm
            import math
            
            d1 = (math.log(spot_price / strike) + (volatility**2 / 2) * time_to_expiry) / (volatility * math.sqrt(time_to_expiry))
            
            return norm.pdf(d1) / (spot_price * volatility * math.sqrt(time_to_expiry))
            
        except ImportError:
            # Fallback - gamma is highest ATM and decreases with distance
            moneyness = abs(strike - spot_price) / spot_price
            return math.exp(-moneyness * 10) / (spot_price * volatility * math.sqrt(time_to_expiry + 0.01))
    
    def calculate_1d_levels(self, stats_24h: Dict) -> Tuple[float, float]:
        """Calculate 1D Max and Min from 24h stats"""
        return stats_24h.get("high_24h", 0), stats_24h.get("low_24h", 0)
    
    def calculate_volume_profile_levels(self, trades: List[Dict], spot_price: float) -> List[Dict]:
        """Calculate High-Volume Levels from futures trades"""
        if not trades:
            return []
        
        # Create price buckets (e.g., $100 buckets for BTC)
        bucket_size = max(1, spot_price * 0.001)  # 0.1% buckets
        
        volume_by_price = {}
        
        for trade in trades:
            price = trade.get("price", 0)
            amount = trade.get("amount", 0)
            
            if price > 0 and amount > 0:
                # Round to nearest bucket
                bucket_price = round(price / bucket_size) * bucket_size
                volume_by_price[bucket_price] = volume_by_price.get(bucket_price, 0) + amount
        
        # Sort by volume and return top levels
        sorted_levels = sorted(volume_by_price.items(), key=lambda x: x[1], reverse=True)
        
        return [{"price": price, "volume": volume} for price, volume in sorted_levels[:10]]
    
    async def calculate_call_resistance_levels(self, instruments: List[Dict], spot_price: float) -> Dict:
        """Calculate Call Resistance based on largest outstanding call OI, delta-adjusted"""
        current_expiry_calls = {}
        dte_calls = {}
        
        # Estimate volatility (simplified - would need proper vol surface)
        estimated_vol = 0.6  # 60% annualized
        
        for instrument in instruments:
            if not instrument.get("is_call", False):
                continue
                
            strike = instrument.get("strike", 0)
            expiry_date = instrument.get("expiry_date")
            open_interest = instrument.get("open_interest", 0)
            
            if not expiry_date or open_interest == 0:
                continue
            
            # Calculate time to expiry in years
            time_to_expiry = max(0.001, (expiry_date - datetime.now()).days / 365.0)
            
            # Calculate delta
            delta = self.calculate_delta(spot_price, strike, time_to_expiry, estimated_vol, True)
            
            # Delta-adjusted notional exposure
            notional_exposure = open_interest * abs(delta) * strike
            
            if self.is_0dte(expiry_date):
                dte_calls[strike] = dte_calls.get(strike, 0) + notional_exposure
            elif self.is_current_weekly_monthly(expiry_date):
                current_expiry_calls[strike] = current_expiry_calls.get(strike, 0) + notional_exposure
        
        # Find strikes with maximum exposure
        call_resistance = max(current_expiry_calls.items(), key=lambda x: x[1])[0] if current_expiry_calls else spot_price
        call_resistance_0dte = max(dte_calls.items(), key=lambda x: x[1])[0] if dte_calls else spot_price
        
        print(f"Call resistance analysis: {len(current_expiry_calls)} current expiry levels, {len(dte_calls)} 0DTE levels")
        
        return {
            "call_resistance": call_resistance,
            "call_resistance_0dte": call_resistance_0dte,
            "current_expiry_exposure": current_expiry_calls,
            "dte_exposure": dte_calls
        }
    
    async def calculate_put_support_levels(self, instruments: List[Dict], spot_price: float) -> Dict:
        """Calculate Put Support based on largest outstanding put OI"""
        current_expiry_puts = {}
        dte_puts = {}
        
        estimated_vol = 0.6  # 60% annualized
        
        for instrument in instruments:
            if not instrument.get("is_put", False):
                continue
                
            strike = instrument.get("strike", 0)
            expiry_date = instrument.get("expiry_date")
            open_interest = instrument.get("open_interest", 0)
            
            if not expiry_date or open_interest == 0:
                continue
            
            time_to_expiry = max(0.001, (expiry_date - datetime.now()).days / 365.0)
            delta = self.calculate_delta(spot_price, strike, time_to_expiry, estimated_vol, False)
            
            notional_exposure = open_interest * abs(delta) * strike
            
            if self.is_0dte(expiry_date):
                dte_puts[strike] = dte_puts.get(strike, 0) + notional_exposure
            elif self.is_current_weekly_monthly(expiry_date):
                current_expiry_puts[strike] = current_expiry_puts.get(strike, 0) + notional_exposure
        
        put_support = max(current_expiry_puts.items(), key=lambda x: x[1])[0] if current_expiry_puts else spot_price
        put_support_0dte = max(dte_puts.items(), key=lambda x: x[1])[0] if dte_puts else spot_price
        
        print(f"Put support analysis: {len(current_expiry_puts)} current expiry levels, {len(dte_puts)} 0DTE levels")
        
        return {
            "put_support": put_support,
            "put_support_0dte": put_support_0dte,
            "current_expiry_exposure": current_expiry_puts,
            "dte_exposure": dte_puts
        }
    
    async def calculate_gamma_wall_0dte(self, instruments: List[Dict], spot_price: float) -> Dict:
        """Calculate Gamma Wall for 0DTE options - strike with largest net dealer gamma"""
        gamma_exposure_by_strike = {}
        
        estimated_vol = 0.6
        dte_options_count = 0
        
        for instrument in instruments:
            expiry_date = instrument.get("expiry_date")
            if not expiry_date or not self.is_0dte(expiry_date):
                continue
                
            dte_options_count += 1
            strike = instrument.get("strike", 0)
            open_interest = instrument.get("open_interest", 0)
            is_call = instrument.get("is_call", False)
            
            if open_interest == 0:
                continue
            
            time_to_expiry = max(0.001, (expiry_date - datetime.now()).seconds / (365 * 24 * 3600))
            
            # Calculate gamma
            gamma = self.calculate_gamma(spot_price, strike, time_to_expiry, estimated_vol)
            
            # Net dealer gamma exposure (dealers are typically short options)
            # Positive gamma means dealers need to buy on upticks, sell on downticks
            dealer_gamma = -gamma * open_interest * (1 if is_call else -1)
            
            gamma_exposure_by_strike[strike] = gamma_exposure_by_strike.get(strike, 0) + dealer_gamma
        
        print(f"Gamma wall analysis: {dte_options_count} 0DTE options, {len(gamma_exposure_by_strike)} strikes with exposure")
        
        if gamma_exposure_by_strike:
            # Find strike with maximum absolute gamma exposure
            max_gamma_strike = max(gamma_exposure_by_strike.items(), key=lambda x: abs(x[1]))
            return {
                "strike": max_gamma_strike[0],
                "gamma_exposure": max_gamma_strike[1],
                "all_exposures": gamma_exposure_by_strike
            }
        
        return {"strike": spot_price, "gamma_exposure": 0, "all_exposures": {}}
    
    async def generate_key_levels(self, currency: str = "BTC") -> List[KeyLevel]:
        """Generate all key levels for the given currency"""
        try:
            print(f"Fetching data for {currency}...")
            
            # Fetch all required data with better error handling
            tasks = [
                self.fetch_index_price(currency),
                self.fetch_24h_stats(currency),
                self.fetch_instruments_with_oi(currency),
                self.fetch_futures_trades(currency)
            ]
            
            results = await asyncio.gather(*tasks, return_exceptions=True)
            spot_price, stats_24h, instruments, futures_trades = results
            
            # Handle any exceptions
            if isinstance(spot_price, Exception):
                print(f"Error fetching spot price: {spot_price}")
                return []
            if isinstance(stats_24h, Exception):
                print(f"Error fetching 24h stats: {stats_24h}")
                stats_24h = {"high_24h": 0, "low_24h": 0, "last_price": 0}
            if isinstance(instruments, Exception):
                print(f"Error fetching instruments: {instruments}")
                instruments = []
            if isinstance(futures_trades, Exception):
                print(f"Error fetching futures trades: {futures_trades}")
                futures_trades = []
            
            if not spot_price:
                raise ValueError(f"Could not fetch spot price for {currency}")
            
            print(f"Spot price: ${spot_price:,.2f}")
            print(f"Found {len(instruments)} instruments with OI data")
            print(f"Found {len(futures_trades)} recent trades")
            
            # Calculate all levels
            max_1d, min_1d = self.calculate_1d_levels(stats_24h)
            call_levels = await self.calculate_call_resistance_levels(instruments, spot_price)
            put_levels = await self.calculate_put_support_levels(instruments, spot_price)
            gamma_wall = await self.calculate_gamma_wall_0dte(instruments, spot_price)
            volume_levels = self.calculate_volume_profile_levels(futures_trades, spot_price)
            
            # Get HVL (highest volume level)
            hvl = volume_levels[0]["price"] if volume_levels else spot_price
            
            print(f"Calculated levels - Max: ${max_1d:,.2f}, Min: ${min_1d:,.2f}, HVL: ${hvl:,.2f}")
            
            # Build key levels list
            key_levels = [
                KeyLevel(
                    name="1D Max",
                    value=max_1d,
                    distance_to_spot=self.calculate_distance_to_spot(max_1d, spot_price),
                    confidence=0.9 if max_1d > 0 else 0.1
                ),
                KeyLevel(
                    name="1D Min",
                    value=min_1d,
                    distance_to_spot=self.calculate_distance_to_spot(min_1d, spot_price),
                    confidence=0.9 if min_1d > 0 else 0.1
                ),
                KeyLevel(
                    name="Call Resistance",
                    value=call_levels["call_resistance"],
                    distance_to_spot=self.calculate_distance_to_spot(call_levels["call_resistance"], spot_price),
                    confidence=0.8 if call_levels["current_expiry_exposure"] else 0.3
                ),
                KeyLevel(
                    name="Call Resistance 0DTE",
                    value=call_levels["call_resistance_0dte"],
                    distance_to_spot=self.calculate_distance_to_spot(call_levels["call_resistance_0dte"], spot_price),
                    confidence=0.9 if call_levels["dte_exposure"] else 0.2
                ),
                KeyLevel(
                    name="Gamma Wall 0DTE",
                    value=gamma_wall["strike"],
                    distance_to_spot=self.calculate_distance_to_spot(gamma_wall["strike"], spot_price),
                    confidence=0.8 if abs(gamma_wall["gamma_exposure"]) > 0 else 0.2
                ),
                KeyLevel(
                    name="HVL",
                    value=hvl,
                    distance_to_spot=self.calculate_distance_to_spot(hvl, spot_price),
                    confidence=0.7 if volume_levels else 0.2
                ),
                KeyLevel(
                    name="Put Support",
                    value=put_levels["put_support"],
                    distance_to_spot=self.calculate_distance_to_spot(put_levels["put_support"], spot_price),
                    confidence=0.8 if put_levels["current_expiry_exposure"] else 0.3
                ),
                KeyLevel(
                    name="Put Support 0DTE",
                    value=put_levels["put_support_0dte"],
                    distance_to_spot=self.calculate_distance_to_spot(put_levels["put_support_0dte"], spot_price),
                    confidence=0.9 if put_levels["dte_exposure"] else 0.2
                )
            ]
            
            # Sort by distance to spot (absolute value)
            key_levels.sort(key=lambda x: abs(x.distance_to_spot))
            
            return key_levels
            
        except Exception as e:
            print(f"Error generating key levels: {e}")
            import traceback
            traceback.print_exc()
            return []

async def main():
    """Main function to demonstrate the enhanced analytics"""
    currencies = ["BTC"]  # Start with just BTC for testing
    
    async with DeribitAnalyticsV2Fixed() as analytics:
        for currency in currencies:
            print(f"\n{'='*60}")
            print(f"Enhanced Key Levels for {currency} (Fixed Version)")
            print(f"{'='*60}")
            
            try:
                key_levels = await analytics.generate_key_levels(currency)
                
                if not key_levels:
                    print(f"No key levels generated for {currency}")
                    continue
                
                # Display in table format
                print(f"\n{'Key Level':<25} {'Value':<15} {'Distance':<12} {'Confidence':<12}")
                print("-" * 70)
                
                for level in key_levels:
                    confidence_str = f"{level.confidence:.1f}"
                    distance_color = "↑" if level.distance_to_spot > 0 else "↓"
                    
                    print(f"{level.name:<25} {level.value:<15,.2f} {distance_color}{level.distance_to_spot:>+6.2f}% {confidence_str:<12}")
                
                # Export enhanced data
                json_data = {
                    "currency": currency,
                    "timestamp": datetime.now().isoformat(),
                    "key_levels": [level.to_dict() for level in key_levels]
                }
                
                with open(f"odette/{currency.lower()}_enhanced_levels_fixed.json", "w") as f:
                    json.dump(json_data, f, indent=2)
                
                print(f"\n💾 Enhanced data exported to {currency.lower()}_enhanced_levels_fixed.json")
                
            except Exception as e:
                print(f"Error processing {currency}: {e}")
                import traceback
                traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main()) 
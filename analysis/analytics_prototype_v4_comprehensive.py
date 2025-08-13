#!/usr/bin/env python3
"""
Odette Analytics Prototype v4 - Comprehensive Version
Combines all the best features:
- Multi-timeframe analysis (Current, 0DTE, 1W, 1M) from v2_improved
- Complete data pagination from analytics_with_pagination
- Enhanced flow analysis from v3_with_flow
- Put/Call ratios and all missing analytics restored
"""

import asyncio
import aiohttp
import json
import numpy as np
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple
import math
from dataclasses import dataclass

@dataclass
class KeyLevel:
    """Represents a key price level with distance to current spot"""
    name: str
    value: float
    distance_to_spot: float
    confidence: float = 1.0
    
    def to_dict(self):
        return {
            "name": self.name,
            "value": self.value,
            "distance_to_spot": f"{self.distance_to_spot:.2f}%",
            "confidence": self.confidence
        }

class DeribitAnalyticsV4Comprehensive:
    """Comprehensive analytics engine with complete coverage and multi-timeframe analysis"""
    
    def __init__(self):
        self.base_url = "https://www.deribit.com/api/v2"
        self.session = None
        self.rate_limit_delay = 0.2  # 200ms between requests
        
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
        """Fetch data with retry logic and rate limiting"""
        for attempt in range(max_retries):
            try:
                await asyncio.sleep(self.rate_limit_delay)
                
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
                    raise
                await asyncio.sleep(1)
        
        return {}
    
    async def fetch_index_price(self, currency: str = "BTC") -> float:
        """Fetch current index price"""
        url = f"{self.base_url}/public/get_index_price"
        params = {"index_name": f"{currency.lower()}_usd"}
        
        result = await self.fetch_with_retry(url, params)
        return result.get("index_price", 0)
    
    async def fetch_24h_stats(self, currency: str = "BTC") -> Dict:
        """Fetch 24h price statistics"""
        url = f"{self.base_url}/public/get_book_summary_by_currency"
        params = {"currency": currency, "kind": "future"}
        
        data = await self.fetch_with_retry(url, params)
        
        if isinstance(data, list):
            for instrument in data:
                if instrument.get("instrument_name", "").endswith("-PERPETUAL"):
                    return {
                        "high_24h": instrument.get("high", 0),
                        "low_24h": instrument.get("low", 0),
                        "last_price": instrument.get("last", 0)
                    }
        
        return {"high_24h": 0, "low_24h": 0, "last_price": 0}
    
    async def fetch_complete_options_trades(self, currency: str = "BTC", hours_back: int = 24, chunk_hours: int = 4) -> List[Dict]:
        """Fetch complete options trades using timestamp-based pagination"""
        print(f"\n=== Fetching Complete {currency} Options Flow ({hours_back}h) ===")
        
        end_time = datetime.now(timezone.utc)  # Use UTC
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
            await asyncio.sleep(0.3)  # Be nice to the API
        
        all_trades = list(unique_trades.values())
        print(f"\nTotal unique trades collected: {len(all_trades)}")
        
        # Analyze coverage
        if all_trades:
            timestamps = [trade.get("timestamp", 0) for trade in all_trades if trade.get("timestamp", 0) > 0]
            if timestamps:
                timestamps.sort()
                first_trade = datetime.fromtimestamp(timestamps[0] / 1000, tz=timezone.utc)
                last_trade = datetime.fromtimestamp(timestamps[-1] / 1000, tz=timezone.utc)
                coverage_hours = (last_trade - first_trade).total_seconds() / 3600
                print(f"Coverage: {coverage_hours:.1f} hours ({coverage_hours/hours_back*100:.1f}%)")
        
        return all_trades
    
    async def fetch_instruments_summary(self, currency: str = "BTC") -> List[Dict]:
        """Fetch options summary with OI data"""
        url = f"{self.base_url}/public/get_book_summary_by_currency"
        params = {"currency": currency, "kind": "option"}
        
        data = await self.fetch_with_retry(url, params)
        
        if not isinstance(data, list):
            print(f"Expected list of instruments, got: {type(data)}")
            return []
        
        print(f"Found {len(data)} option instruments")
        
        enhanced_instruments = []
        for instrument in data:
            parsed = self.parse_instrument_name(instrument.get("instrument_name", ""))
            if parsed:
                instrument.update(parsed)
                instrument["open_interest"] = instrument.get("open_interest", 0)
                instrument["volume"] = instrument.get("volume", 0)
                enhanced_instruments.append(instrument)
        
        print(f"Enhanced {len(enhanced_instruments)} instruments with summary data")
        return enhanced_instruments
    
    async def fetch_complete_futures_trades(self, currency: str = "BTC", hours_back: int = 24, chunk_hours: int = 4) -> List[Dict]:
        """Fetch complete futures trades using timestamp-based pagination"""
        print(f"\n=== Fetching Complete {currency} Futures Data ({hours_back}h) ===")
        
        end_time = datetime.now(timezone.utc)  # Use UTC
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
        print(f"\nTotal unique futures trades collected: {len(all_trades)}")
        
        # Analyze coverage
        if all_trades:
            timestamps = [trade.get("timestamp", 0) for trade in all_trades if trade.get("timestamp", 0) > 0]
            if timestamps:
                timestamps.sort()
                first_trade = datetime.fromtimestamp(timestamps[0] / 1000, tz=timezone.utc)
                last_trade = datetime.fromtimestamp(timestamps[-1] / 1000, tz=timezone.utc)
                coverage_hours = (last_trade - first_trade).total_seconds() / 3600
                print(f"Futures coverage: {coverage_hours:.1f} hours ({coverage_hours/hours_back*100:.1f}%)")
        
        return all_trades
    
    def parse_instrument_name(self, instrument_name: str) -> Dict:
        """Parse Deribit instrument name into components"""
        parts = instrument_name.split('-')
        if len(parts) != 4:
            return {}
        
        currency, expiry_str, strike_str, option_type = parts
        try:
            strike = float(strike_str)
            expiry_date = datetime.strptime(expiry_str, "%d%b%y")
            # Convert to UTC-aware datetime for consistent timezone handling
            expiry_date = expiry_date.replace(tzinfo=timezone.utc)
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
        """Check if expiry is same day trading (0DTE) - Deribit options expire at 08:00 UTC"""
        if not expiry_date:
            return False
        
        now = datetime.now(timezone.utc)
        
        # Create expiry datetime at 08:00 UTC
        if expiry_date.tzinfo is None:
            expiry_date = expiry_date.replace(tzinfo=timezone.utc)
        
        expiry_utc_8am = expiry_date.replace(hour=8, minute=0, second=0, microsecond=0)
        
        # Check if expiry is within next 24 hours and still in the future
        time_diff = (expiry_utc_8am - now).total_seconds()
        return 0 < time_diff <= 24 * 3600
    
    def is_current_weekly_monthly(self, expiry_date: datetime) -> bool:
        """Check if expiry is current week or month"""
        if not expiry_date:
            return False
            
        now = datetime.now(timezone.utc)
        
        # Current week: next Friday
        days_until_friday = (4 - now.weekday()) % 7
        if days_until_friday == 0:
            days_until_friday = 7
        next_friday = now + timedelta(days=days_until_friday)
        
        return expiry_date.date() == next_friday.date()
    
    def is_1w_expiry(self, expiry_date: datetime) -> bool:
        """Check if expiry is ~1 week from now"""
        if not expiry_date:
            return False
            
        now = datetime.now(timezone.utc)
        days_diff = (expiry_date - now).days
        return 5 <= days_diff <= 12
    
    def is_1m_expiry(self, expiry_date: datetime) -> bool:
        """Check if expiry is ~1 month from now"""
        if not expiry_date:
            return False
            
        now = datetime.now(timezone.utc)
        days_diff = (expiry_date - now).days
        return 20 <= days_diff <= 40
    
    def calculate_distance_to_spot(self, level: float, spot_price: float) -> float:
        """Calculate percentage distance from spot price"""
        return ((level - spot_price) / spot_price) * 100
    
    def calculate_delta_simple(self, spot_price: float, strike: float, time_to_expiry: float, is_call: bool, iv: float = 0.6) -> float:
        """Simple delta approximation for exposure calculations"""
        if time_to_expiry <= 0:
            return 1.0 if (is_call and spot_price > strike) or (not is_call and spot_price < strike) else 0.0
        
        moneyness = spot_price / strike
        
        if is_call:
            delta = max(0.05, min(0.95, 0.5 + 0.4 * (moneyness - 1)))
        else:
            delta = max(0.05, min(0.95, 0.5 - 0.4 * (moneyness - 1)))
        
        return delta
    
    def calculate_1d_levels(self, stats_24h: Dict) -> Tuple[float, float]:
        """Calculate 1D max/min levels from 24h stats"""
        return stats_24h.get("high_24h", 0), stats_24h.get("low_24h", 0)
    
    def calculate_volume_profile_levels(self, trades: List[Dict], spot_price: float, currency: str = "BTC") -> List[Dict]:
        """Calculate High Volume Level (HVL) from futures trading data"""
        if not trades:
            return []
        
        # Create price level buckets
        price_levels = {}
        for trade in trades:
            price = trade.get("price", 0)
            amount = trade.get("amount", 0)
            
            if price <= 0 or amount <= 0:
                continue
            
            # Round to create levels - same logic as JS
            level = round(price / 10) * 10 if price > 1000 else round(price * 10) / 10
            
            if level not in price_levels:
                price_levels[level] = 0
            
            price_levels[level] += amount
        
        if not price_levels:
            return []
        
        # Find highest volume level
        hvl_price = max(price_levels.items(), key=lambda x: x[1])[0]
        
        return [{"level": "HVL", "price": hvl_price, "volume": price_levels[hvl_price]}]
    
    async def calculate_option_levels(self, instruments: List[Dict], spot_price: float) -> Dict:
        """Calculate comprehensive option levels with multi-timeframe analysis"""
        if not instruments:
            return {}
        
        print(f"Calculating option levels for {len(instruments)} instruments...")
        
        # Group instruments by timeframe
        current_instruments = []
        dte0_instruments = []
        week1_instruments = []
        month1_instruments = []
        
        for instrument in instruments:
            expiry_date = instrument.get("expiry_date")
            if not expiry_date:
                continue
            
            if self.is_0dte(expiry_date):
                dte0_instruments.append(instrument)
            elif self.is_current_weekly_monthly(expiry_date):
                current_instruments.append(instrument)
            elif self.is_1w_expiry(expiry_date):
                week1_instruments.append(instrument)
            elif self.is_1m_expiry(expiry_date):
                month1_instruments.append(instrument)
            else:
                current_instruments.append(instrument)  # Default to current
        
        # Helper functions
        def get_avg_iv(iv_list, fallback=60.0):
            """Get average IV or fallback"""
            valid_ivs = [iv for iv in iv_list if iv > 0]
            return np.mean(valid_ivs) if valid_ivs else fallback
        
        def calculate_dynamic_band(iv_pct, time_to_expiry_days):
            """Calculate dynamic strike filtering band based on IV and time"""
            base_band = max(10.0, min(50.0, iv_pct * 0.3))
            
            if time_to_expiry_days <= 1:
                time_factor = 1.0
            elif time_to_expiry_days <= 7:
                time_factor = 1.2
            else:
                time_factor = min(2.0, 1.0 + (time_to_expiry_days - 7) / 20)
            
            return base_band * time_factor
        
        # Calculate ATM IVs for each timeframe
        def calculate_atm_iv(instruments_list):
            if not instruments_list:
                return 50.0
            
            atm_ivs = []
            for inst in instruments_list:
                strike = inst.get("strike", 0)
                if abs(strike - spot_price) / spot_price < 0.05:  # Within 5% of ATM
                    iv = inst.get("mark_iv", 0)
                    if iv > 0:
                        # mark_iv is already in percentage format from Deribit API
                        atm_ivs.append(iv)
            
            return get_avg_iv(atm_ivs, 50.0)
        
        current_iv = calculate_atm_iv(current_instruments)
        dte0_iv = calculate_atm_iv(dte0_instruments)
        week1_iv = calculate_atm_iv(week1_instruments)
        month1_iv = calculate_atm_iv(month1_instruments)
        
        print(f"ATM IVs - Current: {current_iv:.1f}%, 0DTE: {dte0_iv:.1f}%, 1W: {week1_iv:.1f}%, 1M: {month1_iv:.1f}%")
        print(f"Timeframe counts - Current: {len(current_instruments)}, 0DTE: {len(dte0_instruments)}, 1W: {len(week1_instruments)}, 1M: {len(month1_instruments)}")
        
        # Calculate dynamic bands
        current_band = calculate_dynamic_band(current_iv, 7)
        dte0_band = calculate_dynamic_band(dte0_iv, 0.1)
        week1_band = calculate_dynamic_band(week1_iv, 7)
        month1_band = calculate_dynamic_band(month1_iv, 30)
        
        print(f"Dynamic bands - Current: ±{current_band:.1f}%, 0DTE: ±{dte0_band:.1f}%, 1W: ±{week1_band:.1f}%, 1M: ±{month1_band:.1f}%")
        
        # Strike filtering functions
        def filter_call_strikes(strikes_dict, band):
            # Filter strikes within band
            filtered_items = []
            for strike, oi in strikes_dict.items():
                if strike > spot_price and strike <= spot_price * (1 + band/100):
                    filtered_items.append((strike, oi))
            
            # Sort by strike (ascending) and take top 10
            filtered_items.sort(key=lambda x: x[0])
            return dict(filtered_items[:10])
        
        def filter_put_strikes(strikes_dict, band):
            # Filter strikes within band
            filtered_items = []
            for strike, oi in strikes_dict.items():
                if strike < spot_price and strike >= spot_price * (1 - band/100):
                    filtered_items.append((strike, oi))
            
            # Sort by strike (descending) and take top 10
            filtered_items.sort(key=lambda x: x[0], reverse=True)
            return dict(filtered_items[:10])
        
        # Process each timeframe
        def process_timeframe(instruments_list, timeframe_name, band):
            call_strikes = {}
            put_strikes = {}
            
            for instrument in instruments_list:
                strike = instrument.get("strike", 0)
                oi = instrument.get("open_interest", 0)
                
                if oi <= 0:
                    continue
                
                if instrument.get("is_call"):
                    call_strikes[strike] = call_strikes.get(strike, 0) + oi
                else:
                    put_strikes[strike] = put_strikes.get(strike, 0) + oi
            
            # Filter strikes by dynamic bands
            filtered_calls = filter_call_strikes(call_strikes, band)
            filtered_puts = filter_put_strikes(put_strikes, band)
            
            print(f"Debug - {timeframe_name} strikes after dynamic filtering:")
            print(f"  Call: {list(filtered_calls.keys())[:5]}...")
            print(f"  Put: {list(filtered_puts.keys())[:5]}...")
            
            # Find resistance and support levels
            levels = {}
            
            if filtered_calls:
                call_resistance = max(filtered_calls.items(), key=lambda x: x[1])[0]
                levels[f"Call Resistance{' ' + timeframe_name if timeframe_name else ''}"] = call_resistance
            
            if filtered_puts:
                put_support = max(filtered_puts.items(), key=lambda x: x[1])[0]
                levels[f"Put Support{' ' + timeframe_name if timeframe_name else ''}"] = put_support
            
            return levels, len(filtered_calls), len(filtered_puts), sum(filtered_calls.values()), sum(filtered_puts.values())
        
        # Calculate Put/Call ratio helper
        def calc_pc_ratio(call_oi, put_oi):
            return put_oi / call_oi if call_oi > 0 else 0
        
        # Process all timeframes
        all_levels = {}
        pc_ratios = {}
        
        current_levels, current_calls, current_puts, current_call_oi, current_put_oi = process_timeframe(current_instruments, "", current_band)
        all_levels.update(current_levels)
        pc_ratios["Current"] = calc_pc_ratio(current_call_oi, current_put_oi)
        
        dte0_levels, dte0_calls, dte0_puts, dte0_call_oi, dte0_put_oi = process_timeframe(dte0_instruments, "0DTE", dte0_band)
        all_levels.update(dte0_levels)
        pc_ratios["0DTE"] = calc_pc_ratio(dte0_call_oi, dte0_put_oi)
        
        week1_levels, week1_calls, week1_puts, week1_call_oi, week1_put_oi = process_timeframe(week1_instruments, "1W", week1_band)
        all_levels.update(week1_levels)
        pc_ratios["1W"] = calc_pc_ratio(week1_call_oi, week1_put_oi)
        
        month1_levels, month1_calls, month1_puts, month1_call_oi, month1_put_oi = process_timeframe(month1_instruments, "1M", month1_band)
        all_levels.update(month1_levels)
        pc_ratios["1M"] = calc_pc_ratio(month1_call_oi, month1_put_oi)
        
        # Gamma Wall calculation (0DTE focus)
        gamma_wall_data = self.calculate_gamma_wall(dte0_instruments, spot_price)
        if gamma_wall_data:
            all_levels.update(gamma_wall_data)
        
        print(f"Option analysis: {current_calls} current, {dte0_calls} 0DTE, {week1_calls} 1W, {month1_calls} 1M call levels")
        print(f"Put analysis: {current_puts} current, {dte0_puts} 0DTE, {week1_puts} 1W, {month1_puts} 1M put levels")
        print(f"Put/Call ratios - Current: {pc_ratios['Current']:.2f}, 0DTE: {pc_ratios['0DTE']:.2f}, 1W: {pc_ratios['1W']:.2f}, 1M: {pc_ratios['1M']:.2f}")
        
        return {
            "levels": all_levels,
            "put_call_ratios": pc_ratios,
            "iv_data": {
                "current": current_iv,
                "dte0": dte0_iv,
                "week1": week1_iv,
                "month1": month1_iv
            }
        }
    
    def calculate_gamma_wall(self, instruments: List[Dict], spot_price: float) -> Dict:
        """Calculate gamma wall from 0DTE options"""
        if not instruments:
            return {}
        
        strike_gamma = {}
        
        for instrument in instruments:
            strike = instrument.get("strike", 0)
            oi = instrument.get("open_interest", 0)
            
            if oi <= 0:
                continue
            
            # Simple gamma approximation (higher near ATM)
            moneyness = abs(spot_price - strike) / spot_price
            gamma_weight = max(0.1, 1.0 - moneyness * 5)  # Decays quickly away from ATM
            
            # Calls have positive gamma for dealers (short), puts negative
            gamma_contribution = gamma_weight * oi
            if not instrument.get("is_call"):
                gamma_contribution *= -1
            
            strike_gamma[strike] = strike_gamma.get(strike, 0) + gamma_contribution
        
        if not strike_gamma:
            return {}
        
        # Find strike with largest net gamma
        gamma_wall_strike = max(strike_gamma.items(), key=lambda x: abs(x[1]))[0]
        gamma_wall_value = strike_gamma[gamma_wall_strike]
        
        gamma_type = "Short Gamma" if gamma_wall_value < 0 else "Long Gamma"
        
        return {
            f"Gamma Wall ({gamma_type})": gamma_wall_strike
        }
    
    def analyze_complete_options_flow(self, trades: List[Dict], spot_price: float) -> Dict[str, float]:
        """Analyze complete options flow with time-weighted analysis"""
        if not trades:
            return {}
        
        print(f"Analyzing {len(trades)} options trades for flow patterns...")
        
        strike_flow = {}
        total_volume = 0
        
        for trade in trades:
            try:
                instrument = trade.get("instrument_name", "")
                if not instrument:
                    continue
                
                parts = instrument.split("-")
                if len(parts) < 4:
                    continue
                
                strike = float(parts[2])
                option_type = parts[3]
                amount = trade.get("amount", 0)
                price = trade.get("price", 0)
                direction = trade.get("direction", "")
                timestamp = trade.get("timestamp", 0)
                
                if amount <= 0 or price <= 0:
                    continue
                
                # Calculate notional value
                notional = amount * price * spot_price
                total_volume += notional
                
                # Time weighting - exponential decay
                now_timestamp = datetime.now(timezone.utc).timestamp() * 1000
                hours_ago = (now_timestamp - timestamp) / (1000 * 60 * 60)
                time_weight = math.exp(-hours_ago / 12)  # 12-hour half-life
                
                # Delta-adjusted exposure
                is_call = option_type == 'C'
                delta = self.calculate_delta_simple(spot_price, strike, 1/365, is_call)  # Approximate 1 day to expiry
                delta_exposure = notional * delta
                
                # Flow direction
                flow_direction = 1 if direction == "buy" else -1
                
                if strike not in strike_flow:
                    strike_flow[strike] = {
                        "total_volume": 0,
                        "net_flow": 0,
                        "call_volume": 0,
                        "put_volume": 0,
                        "weighted_flow": 0
                    }
                
                data = strike_flow[strike]
                data["total_volume"] += notional
                data["net_flow"] += delta_exposure * flow_direction
                data["weighted_flow"] += delta_exposure * flow_direction * time_weight
                
                if is_call:
                    data["call_volume"] += notional
                else:
                    data["put_volume"] += notional
                
            except Exception as e:
                continue
        
        if not strike_flow:
            return {}
        
        print(f"Processed ${total_volume:,.0f} in total options volume across {len(strike_flow)} strikes")
        
        # Calculate flow levels
        levels = {}
        
        # 1. Highest Volume Strike (HVS)
        hvs_strike = max(strike_flow.items(), key=lambda x: x[1]["total_volume"])[0]
        levels["HVS"] = hvs_strike
        
        # 2. Max Pain Flow - most balanced call/put activity
        balanced_strikes = []
        for strike, data in strike_flow.items():
            if data["call_volume"] > 0 and data["put_volume"] > 0:
                balance_ratio = min(data["call_volume"], data["put_volume"]) / max(data["call_volume"], data["put_volume"])
                balanced_strikes.append((strike, balance_ratio, data["total_volume"]))
        
        if balanced_strikes:
            balanced_strikes.sort(key=lambda x: (x[1], x[2]), reverse=True)
            levels["Max Pain Flow"] = balanced_strikes[0][0]
        
        # 3. Call Flow Resistance - above spot with highest weighted call flow
        call_resistance = []
        for strike, data in strike_flow.items():
            if strike > spot_price and data["call_volume"] > data["put_volume"]:
                call_resistance.append((strike, data["weighted_flow"]))
        
        if call_resistance:
            call_resistance.sort(key=lambda x: x[1], reverse=True)
            levels["Call Flow Resistance"] = call_resistance[0][0]
        
        # 4. Put Flow Support - below spot with highest weighted put flow
        put_support = []
        for strike, data in strike_flow.items():
            if strike < spot_price and data["put_volume"] > data["call_volume"]:
                put_support.append((strike, abs(data["weighted_flow"])))
        
        if put_support:
            put_support.sort(key=lambda x: x[1], reverse=True)
            levels["Put Flow Support"] = put_support[0][0]
        
        # 5. Volume-Weighted Average Strike (VWAS)
        if total_volume > 0:
            vwas = sum(strike * data["total_volume"] for strike, data in strike_flow.items()) / total_volume
            levels["VWAS"] = vwas
        
        return levels
    
    async def generate_key_levels(self, currency: str = "BTC") -> Tuple[List[KeyLevel], Dict]:
        """Generate comprehensive key levels with all analytics"""
        print(f"\n=== Analyzing {currency} ===")
        
        # Fetch all data
        spot_price = await self.fetch_index_price(currency)
        print(f"Spot price: ${spot_price:,.2f}")
        
        if spot_price <= 0:
            raise ValueError(f"Failed to fetch spot price for {currency}")
        
        # Fetch data in parallel
        stats_24h, instruments, futures_trades, options_trades = await asyncio.gather(
            self.fetch_24h_stats(currency),
            self.fetch_instruments_summary(currency),
            self.fetch_complete_futures_trades(currency),
            self.fetch_complete_options_trades(currency)
        )
        
        # Calculate all analytics
        max_24h, min_24h = self.calculate_1d_levels(stats_24h)
        hvl_levels = self.calculate_volume_profile_levels(futures_trades, spot_price, currency)
        option_analysis = await self.calculate_option_levels(instruments, spot_price)
        flow_levels = self.analyze_complete_options_flow(options_trades, spot_price)
        
        # Combine all levels
        all_levels = {}
        
        # Add 1D levels
        if max_24h > 0:
            all_levels["1D Max"] = max_24h
        if min_24h > 0:
            all_levels["1D Min"] = min_24h
        
        # Add HVL
        for hvl in hvl_levels:
            all_levels[hvl["level"]] = hvl["price"]
        
        # Add option levels
        all_levels.update(option_analysis.get("levels", {}))
        
        # Add flow levels
        all_levels.update(flow_levels)
        
        print(f"Calculated levels - Max: ${max_24h:,.2f}, Min: ${min_24h:,.2f}, HVL: ${hvl_levels[0]['price'] if hvl_levels else 0:,.2f}")
        
        # Convert to KeyLevel objects with confidence scoring
        key_levels = []
        
        def calculate_confidence(base_confidence: float, distance_pct: float) -> float:
            """Calculate confidence score based on distance from spot"""
            distance_factor = max(0.1, 1.0 - abs(distance_pct) / 100)
            return min(1.0, base_confidence * distance_factor)
        
        confidence_map = {
            "1D Max": 0.8, "1D Min": 0.7, "HVL": 0.6,
            "Call Resistance": 0.5, "Put Support": 0.4,
            "Call Resistance 0DTE": 0.7, "Put Support 0DTE": 0.8,
            "Call Resistance 1W": 0.5, "Put Support 1W": 0.4,
            "Call Resistance 1M": 0.4, "Put Support 1M": 0.1,
            "Gamma Wall (Short Gamma)": 0.6, "Gamma Wall (Long Gamma)": 0.6,
            "HVS": 0.5, "Max Pain Flow": 0.4,
            "Call Flow Resistance": 0.4, "Put Flow Support": 0.4,
            "VWAS": 0.3
        }
        
        for level_name, level_price in all_levels.items():
            if level_price and level_price > 0:
                distance = self.calculate_distance_to_spot(level_price, spot_price)
                base_conf = confidence_map.get(level_name, 0.3)
                confidence = calculate_confidence(base_conf, distance)
                
                key_levels.append(KeyLevel(
                    name=level_name,
                    value=level_price,
                    distance_to_spot=distance,
                    confidence=confidence
                ))
        
        # Sort by distance from spot
        key_levels.sort(key=lambda x: abs(x.distance_to_spot))
        
        # Return metadata
        metadata = {
            "currency": currency,
            "spot_price": spot_price,
            "put_call_ratios": option_analysis.get("put_call_ratios", {}),
            "iv_data": option_analysis.get("iv_data", {}),
            "instruments_analyzed": len(instruments),
            "futures_trades": len(futures_trades),
            "options_trades": len(options_trades)
        }
        
        return key_levels, metadata

async def main():
    """Test the comprehensive analytics"""
    async with DeribitAnalyticsV4Comprehensive() as analytics:
        for currency in ["BTC", "ETH"]:
            try:
                key_levels, metadata = await analytics.generate_key_levels(currency)
                
                print(f"\nKey Level                 Value           Distance     Confidence")
                print("-" * 70)
                
                for level in key_levels:
                    distance_str = f"🟢 +{level.distance_to_spot:.2f}%" if level.distance_to_spot > 2 else \
                                  f"🔴{level.distance_to_spot:.2f}%" if level.distance_to_spot < -2 else \
                                  f"🟡 {level.distance_to_spot:+.2f}%"
                    
                    confidence_bar = "█" * max(1, int(level.confidence * 8))
                    
                    print(f"{level.name:<25} ${level.value:>12,.2f} {distance_str:>12} {confidence_bar}")
                
                print(f"\n✅ Successfully generated {len(key_levels)} key levels for {currency}")
                
                # Print Put/Call ratios
                pc_ratios = metadata.get("put_call_ratios", {})
                if pc_ratios:
                    print(f"\n📊 Put/Call Ratios (Higher = More Bearish):")
                    for timeframe, ratio in pc_ratios.items():
                        print(f"   {timeframe}: {ratio:.2f}")
                
                print("=" * 70)
                
            except Exception as e:
                print(f"❌ Error analyzing {currency}: {e}")

if __name__ == "__main__":
    asyncio.run(main()) 
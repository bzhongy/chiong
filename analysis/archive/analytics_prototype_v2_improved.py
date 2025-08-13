#!/usr/bin/env python3
"""
Odette Analytics Prototype v2 - Improved Version
Better rate limiting and error handling to avoid API issues
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
    confidence: float = 1.0
    
    def to_dict(self):
        return {
            "name": self.name,
            "value": self.value,
            "distance_to_spot": f"{self.distance_to_spot:.2f}%",
            "confidence": self.confidence
        }

class DeribitAnalyticsV2Improved:
    """Improved analytics engine with better rate limiting"""
    
    def __init__(self):
        self.base_url = "https://www.deribit.com/api/v2"
        self.session = None
        self.rate_limit_delay = 0.2  # 200ms between requests
        
    async def __aenter__(self):
        # Add timeout and rate limiting
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
                # Rate limiting
                await asyncio.sleep(self.rate_limit_delay)
                
                prepared_params = self.prepare_params(params) if params else {}
                async with self.session.get(url, params=prepared_params) as response:
                    if response.status == 200:
                        data = await response.json()
                        return data.get("result", data)  # Sometimes result is at top level
                    elif response.status == 429:
                        # Rate limited - wait longer
                        wait_time = 2 ** attempt  # Exponential backoff
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
    
    async def fetch_instruments_summary(self, currency: str = "BTC") -> List[Dict]:
        """Fetch options summary which includes basic OI data"""
        url = f"{self.base_url}/public/get_book_summary_by_currency"
        params = {"currency": currency, "kind": "option"}
        
        data = await self.fetch_with_retry(url, params)
        
        if not isinstance(data, list):
            print(f"Expected list of instruments, got: {type(data)}")
            return []
        
        print(f"Found {len(data)} option instruments")
        
        # Parse and enhance instruments
        enhanced_instruments = []
        for instrument in data:
            parsed = self.parse_instrument_name(instrument.get("instrument_name", ""))
            if parsed:
                instrument.update(parsed)
                # Use basic data from summary
                instrument["open_interest"] = instrument.get("open_interest", 0)
                instrument["volume"] = instrument.get("volume", 0)
                enhanced_instruments.append(instrument)
        
        print(f"Enhanced {len(enhanced_instruments)} instruments with summary data")
        return enhanced_instruments
    
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
            # Sometimes the trades are in a 'trades' key
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
    
    def parse_instrument_name(self, instrument_name: str) -> Dict:
        """Parse Deribit instrument name into components"""
        parts = instrument_name.split('-')
        if len(parts) != 4:
            return {}
        
        currency, expiry_str, strike_str, option_type = parts
        try:
            strike = float(strike_str)
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
        """Check if option expires today or is the next available expiry (Deribit 0DTE logic)"""
        now = datetime.now()
        today = now.date()
        
        # Deribit options expire at 8:00 UTC daily
        # If it's past 8 UTC today, today's options have expired
        # So "0DTE" now refers to tomorrow's options
        
        if now.hour >= 8:
            # Past 8 UTC - today's options expired, tomorrow's are "0DTE"
            next_trading_day = today + timedelta(days=1)
        else:
            # Before 8 UTC - today's options are still "0DTE"
            next_trading_day = today
        
        return expiry_date.date() == next_trading_day
    
    def is_current_weekly_monthly(self, expiry_date: datetime) -> bool:
        """Check if option is current weekly or monthly expiry"""
        now = datetime.now()
        today = now.date()
        
        # Adjust for 8 UTC expiry
        if now.hour >= 8:
            reference_date = today + timedelta(days=1)
        else:
            reference_date = today
            
        days_to_expiry = (expiry_date.date() - reference_date).days
        return 0 <= days_to_expiry <= 7
    
    def is_1w_expiry(self, expiry_date: datetime) -> bool:
        """Check if option is next weekly expiry (1W) - Deribit weeklies expire on Fridays"""
        now = datetime.now()
        today = now.date()
        
        # Adjust for 8 UTC expiry
        if now.hour >= 8:
            reference_date = today + timedelta(days=1)
        else:
            reference_date = today
            
        days_to_expiry = (expiry_date.date() - reference_date).days
        
        # Deribit weeklies: typically 7-28 days out, expire on Fridays
        # But exclude the current week (0-7 days) and monthlies
        if not (7 <= days_to_expiry <= 28):
            return False
            
        # Check if it's a Friday (weekday 4)
        return expiry_date.weekday() == 4
    
    def is_1m_expiry(self, expiry_date: datetime) -> bool:
        """Check if option is monthly expiry (1M) - Deribit monthlies expire end-of-month"""
        now = datetime.now()
        today = now.date()
        
        # Adjust for 8 UTC expiry
        if now.hour >= 8:
            reference_date = today + timedelta(days=1)
        else:
            reference_date = today
            
        days_to_expiry = (expiry_date.date() - reference_date).days
        
        # Monthly expiries are typically 15-90 days out
        if not (15 <= days_to_expiry <= 90):
            return False
            
        # Check if it's near end of month (last Friday of month or close to it)
        expiry_month = expiry_date.month
        expiry_year = expiry_date.year
        
        # Get last day of the month
        if expiry_month == 12:
            next_month = expiry_year + 1, 1
        else:
            next_month = expiry_year, expiry_month + 1
            
        last_day_of_month = (datetime(next_month[0], next_month[1], 1) - timedelta(days=1)).date()
        
        # Monthly expiry should be within last 7 days of month and on a Friday
        days_from_month_end = (last_day_of_month - expiry_date.date()).days
        
        return expiry_date.weekday() == 4 and 0 <= days_from_month_end <= 7
    
    def calculate_distance_to_spot(self, level: float, spot_price: float) -> float:
        """Calculate percentage distance from spot price"""
        if spot_price == 0:
            return 0
        return ((level - spot_price) / spot_price) * 100
    
    def calculate_delta_simple(self, spot_price: float, strike: float, time_to_expiry: float, is_call: bool, iv: float = 0.6) -> float:
        """Simplified delta calculation without requiring scipy"""
        if time_to_expiry <= 0:
            if is_call:
                return 1.0 if spot_price > strike else 0.0
            else:
                return -1.0 if spot_price < strike else 0.0
        
        # Simple approximation based on moneyness and IV
        moneyness = spot_price / strike
        vol_adjustment = iv / 100.0 if iv > 5 else iv  # Handle percentage vs decimal
        
        if is_call:
            base_delta = max(0, min(1, (moneyness - 0.8) / 0.4))
            return base_delta * (0.5 + vol_adjustment * 0.5)
        else:
            base_delta = max(-1, min(0, (0.8 - moneyness) / 0.4))
            return base_delta * (0.5 + vol_adjustment * 0.5)
    
    def calculate_1d_levels(self, stats_24h: Dict) -> Tuple[float, float]:
        """Calculate 1D Max and Min from 24h stats"""
        return stats_24h.get("high_24h", 0), stats_24h.get("low_24h", 0)
    
    def calculate_volume_profile_levels(self, trades: List[Dict], spot_price: float, currency: str = "BTC") -> List[Dict]:
        """Calculate High-Volume Levels from futures trades using fixed grid and cumulative notional"""
        if not trades or spot_price == 0:
            return []
        
        # Fixed grid sizes
        bucket_size = 100 if currency == "BTC" else 10
        notional_by_price = {}
        
        for trade in trades:
            price = trade.get("price", 0)
            amount = trade.get("amount", 0)
            
            if price > 0 and amount > 0:
                # Use cumulative notional (price * amount) instead of just amount
                notional = price * amount
                bucket_price = round(price / bucket_size) * bucket_size
                notional_by_price[bucket_price] = notional_by_price.get(bucket_price, 0) + notional
        
        sorted_levels = sorted(notional_by_price.items(), key=lambda x: x[1], reverse=True)
        return [{"price": price, "notional": notional} for price, notional in sorted_levels[:10]]
    
    async def calculate_option_levels(self, instruments: List[Dict], spot_price: float) -> Dict:
        """Calculate all option-based levels using real IV and Put/Call ratios"""
        call_current = {}
        call_0dte = {}
        call_1w = {}
        call_1m = {}
        put_current = {}
        put_0dte = {}
        put_1w = {}
        put_1m = {}
        gamma_0dte = {}
        
        # Put/Call ratio tracking
        pc_ratios = {
            "current": {"call_oi": 0, "put_oi": 0},
            "0dte": {"call_oi": 0, "put_oi": 0},
            "1w": {"call_oi": 0, "put_oi": 0},
            "1m": {"call_oi": 0, "put_oi": 0}
        }
        
        # Calculate ATM IV for each timeframe for dynamic moneyness bands
        atm_ivs = {"current": [], "0dte": [], "1w": [], "1m": []}
        
        risk_free_rate = 0.04  # 4% risk-free rate
        
        # First pass: collect ATM IVs for dynamic bands
        for instrument in instruments:
            strike = instrument.get("strike", 0)
            expiry_date = instrument.get("expiry_date")
            mark_iv = instrument.get("mark_iv", 60.0)
            
            if not expiry_date or strike == 0:
                continue
                
            # Check if strike is near ATM (within 5% for IV sampling)
            if abs(strike - spot_price) / spot_price <= 0.05:
                if self.is_0dte(expiry_date):
                    atm_ivs["0dte"].append(mark_iv)
                elif self.is_current_weekly_monthly(expiry_date):
                    atm_ivs["current"].append(mark_iv)
                elif self.is_1w_expiry(expiry_date):
                    atm_ivs["1w"].append(mark_iv)
                elif self.is_1m_expiry(expiry_date):
                    atm_ivs["1m"].append(mark_iv)
        
        # Calculate average ATM IV for each timeframe
        def get_avg_iv(iv_list, fallback=60.0):
            return sum(iv_list) / len(iv_list) if iv_list else fallback
        
        avg_iv_current = get_avg_iv(atm_ivs["current"])
        avg_iv_0dte = get_avg_iv(atm_ivs["0dte"])
        avg_iv_1w = get_avg_iv(atm_ivs["1w"])
        avg_iv_1m = get_avg_iv(atm_ivs["1m"])
        
        print(f"ATM IVs - Current: {avg_iv_current:.1f}%, 0DTE: {avg_iv_0dte:.1f}%, 1W: {avg_iv_1w:.1f}%, 1M: {avg_iv_1m:.1f}%")
        
        # Calculate dynamic moneyness bands (±2σ based on ATM IV)
        def calculate_dynamic_band(iv_pct, time_to_expiry_days):
            """Calculate ±2σ move based on IV and time to expiry"""
            iv_decimal = iv_pct / 100.0
            time_factor = math.sqrt(time_to_expiry_days / 365.0)
            two_sigma_move = 2.0 * iv_decimal * time_factor
            return max(0.1, min(0.4, two_sigma_move))  # Cap between 10% and 40%
        
        band_current = calculate_dynamic_band(avg_iv_current, 7)  # ~1 week
        band_0dte = calculate_dynamic_band(avg_iv_0dte, 1)       # 1 day
        band_1w = calculate_dynamic_band(avg_iv_1w, 7)           # 1 week
        band_1m = calculate_dynamic_band(avg_iv_1m, 30)          # 1 month
        
        print(f"Dynamic bands - Current: ±{band_current*100:.1f}%, 0DTE: ±{band_0dte*100:.1f}%, 1W: ±{band_1w*100:.1f}%, 1M: ±{band_1m*100:.1f}%")
        
        for instrument in instruments:
            strike = instrument.get("strike", 0)
            expiry_date = instrument.get("expiry_date")
            open_interest = instrument.get("open_interest", 0)
            is_call = instrument.get("is_call", False)
            is_put = instrument.get("is_put", False)
            
            # Use real mark_iv from API, fallback to 60% if not available
            mark_iv = instrument.get("mark_iv", 60.0)  # API returns as percentage
            
            if not expiry_date or open_interest == 0 or strike == 0:
                continue
            
            time_to_expiry = max(0.001, (expiry_date - datetime.now()).days / 365.0)
            
            # Get delta from API, fallback to calculation if None or 0
            api_delta = instrument.get("mark_delta")
            if api_delta is None or api_delta == 0:
                delta = self.calculate_delta_simple(spot_price, strike, time_to_expiry, is_call, mark_iv)
            else:
                delta = api_delta
            
            # Fix 1: Require |Δ| > 0.02 to filter out ITM zombies and deep OTM
            if abs(delta) <= 0.02:
                continue
            
            # Delta-adjusted notional exposure
            notional_exposure = open_interest * abs(delta) * strike
            
            # Categorize by expiry type and track Put/Call ratios
            if self.is_0dte(expiry_date):
                # Gamma approximation for 0DTE
                moneyness = abs(strike - spot_price) / spot_price
                gamma_approx = math.exp(-moneyness * 10)
                dealer_gamma = -gamma_approx * open_interest
                gamma_0dte[strike] = gamma_0dte.get(strike, 0) + dealer_gamma
                
                if is_call:
                    call_0dte[strike] = call_0dte.get(strike, 0) + notional_exposure
                    pc_ratios["0dte"]["call_oi"] += open_interest
                elif is_put:
                    put_0dte[strike] = put_0dte.get(strike, 0) + notional_exposure
                    pc_ratios["0dte"]["put_oi"] += open_interest
            
            elif self.is_current_weekly_monthly(expiry_date):
                if is_call:
                    call_current[strike] = call_current.get(strike, 0) + notional_exposure
                    pc_ratios["current"]["call_oi"] += open_interest
                elif is_put:
                    put_current[strike] = put_current.get(strike, 0) + notional_exposure
                    pc_ratios["current"]["put_oi"] += open_interest
            
            elif self.is_1w_expiry(expiry_date):
                if is_call:
                    call_1w[strike] = call_1w.get(strike, 0) + notional_exposure
                    pc_ratios["1w"]["call_oi"] += open_interest
                elif is_put:
                    put_1w[strike] = put_1w.get(strike, 0) + notional_exposure
                    pc_ratios["1w"]["put_oi"] += open_interest
            
            elif self.is_1m_expiry(expiry_date):
                if is_call:
                    call_1m[strike] = call_1m.get(strike, 0) + notional_exposure
                    pc_ratios["1m"]["call_oi"] += open_interest
                elif is_put:
                    put_1m[strike] = put_1m.get(strike, 0) + notional_exposure
                    pc_ratios["1m"]["put_oi"] += open_interest
        
        # Fix 2: Dynamic moneyness bands instead of fixed ±20%
        def filter_call_strikes(strikes_dict, band):
            """Filter call strikes to only those above spot and within dynamic band"""
            upper_bound = spot_price * (1 + band)
            return {k: v for k, v in strikes_dict.items() if spot_price < k < upper_bound}
        
        def filter_put_strikes(strikes_dict, band):
            """Filter put strikes to only those below spot and within dynamic band"""
            lower_bound = spot_price * (1 - band)
            return {k: v for k, v in strikes_dict.items() if lower_bound < k < spot_price}
        
        # Apply dynamic filters
        call_current_filtered = filter_call_strikes(call_current, band_current)
        call_0dte_filtered = filter_call_strikes(call_0dte, band_0dte)
        call_1w_filtered = filter_call_strikes(call_1w, band_1w)
        call_1m_filtered = filter_call_strikes(call_1m, band_1m)
        
        put_current_filtered = filter_put_strikes(put_current, band_current)
        put_0dte_filtered = filter_put_strikes(put_0dte, band_0dte)
        put_1w_filtered = filter_put_strikes(put_1w, band_1w)
        put_1m_filtered = filter_put_strikes(put_1m, band_1m)
        
        # Fix 5: Debug prints for strike distribution
        print(f"Debug - Call strikes after dynamic filtering:")
        if call_current_filtered:
            print(f"  Current: {sorted(call_current_filtered.keys())[:5]}...")
        if call_0dte_filtered:
            print(f"  0DTE: {sorted(call_0dte_filtered.keys())[:5]}...")
        if call_1w_filtered:
            print(f"  1W: {sorted(call_1w_filtered.keys())[:5]}...")
        if call_1m_filtered:
            print(f"  1M: {sorted(call_1m_filtered.keys())[:5]}...")
        
        print(f"Debug - Put strikes after dynamic filtering:")
        if put_current_filtered:
            print(f"  Current: {sorted(put_current_filtered.keys(), reverse=True)[:5]}...")
        if put_0dte_filtered:
            print(f"  0DTE: {sorted(put_0dte_filtered.keys(), reverse=True)[:5]}...")
        if put_1w_filtered:
            print(f"  1W: {sorted(put_1w_filtered.keys(), reverse=True)[:5]}...")
        if put_1m_filtered:
            print(f"  1M: {sorted(put_1m_filtered.keys(), reverse=True)[:5]}...")
        
        # Calculate Put/Call ratios
        def calc_pc_ratio(call_oi, put_oi):
            return put_oi / call_oi if call_oi > 0 else 0
        
        pc_ratio_current = calc_pc_ratio(pc_ratios["current"]["call_oi"], pc_ratios["current"]["put_oi"])
        pc_ratio_0dte = calc_pc_ratio(pc_ratios["0dte"]["call_oi"], pc_ratios["0dte"]["put_oi"])
        pc_ratio_1w = calc_pc_ratio(pc_ratios["1w"]["call_oi"], pc_ratios["1w"]["put_oi"])
        pc_ratio_1m = calc_pc_ratio(pc_ratios["1m"]["call_oi"], pc_ratios["1m"]["put_oi"])
        
        # Find max levels for each timeframe (using filtered strikes)
        call_resistance = max(call_current_filtered.items(), key=lambda x: x[1])[0] if call_current_filtered else spot_price
        call_resistance_0dte = max(call_0dte_filtered.items(), key=lambda x: x[1])[0] if call_0dte_filtered else spot_price
        call_resistance_1w = max(call_1w_filtered.items(), key=lambda x: x[1])[0] if call_1w_filtered else spot_price
        call_resistance_1m = max(call_1m_filtered.items(), key=lambda x: x[1])[0] if call_1m_filtered else spot_price
        
        put_support = max(put_current_filtered.items(), key=lambda x: x[1])[0] if put_current_filtered else spot_price
        put_support_0dte = max(put_0dte_filtered.items(), key=lambda x: x[1])[0] if put_0dte_filtered else spot_price
        put_support_1w = max(put_1w_filtered.items(), key=lambda x: x[1])[0] if put_1w_filtered else spot_price
        put_support_1m = max(put_1m_filtered.items(), key=lambda x: x[1])[0] if put_1m_filtered else spot_price
        
        # Gamma wall with direction
        gamma_wall_strike = max(gamma_0dte.items(), key=lambda x: abs(x[1]))[0] if gamma_0dte else spot_price
        gamma_wall_value = gamma_0dte.get(gamma_wall_strike, 0)
        gamma_wall_direction = "Short Gamma" if gamma_wall_value < 0 else "Long Gamma"
        
        print(f"Gamma Wall: ${gamma_wall_strike:,.0f} ({gamma_wall_direction}, Γ={gamma_wall_value:,.0f})")
        
        print(f"Option analysis: {len(call_current_filtered)} current, {len(call_0dte_filtered)} 0DTE, {len(call_1w_filtered)} 1W, {len(call_1m_filtered)} 1M call levels")
        print(f"Put analysis: {len(put_current_filtered)} current, {len(put_0dte_filtered)} 0DTE, {len(put_1w_filtered)} 1W, {len(put_1m_filtered)} 1M put levels")
        print(f"Put/Call ratios - Current: {pc_ratio_current:.2f}, 0DTE: {pc_ratio_0dte:.2f}, 1W: {pc_ratio_1w:.2f}, 1M: {pc_ratio_1m:.2f}")
        
        return {
            "call_resistance": call_resistance,
            "call_resistance_0dte": call_resistance_0dte,
            "call_resistance_1w": call_resistance_1w,
            "call_resistance_1m": call_resistance_1m,
            "put_support": put_support,
            "put_support_0dte": put_support_0dte,
            "put_support_1w": put_support_1w,
            "put_support_1m": put_support_1m,
            "gamma_wall": gamma_wall_strike,
            "gamma_wall_direction": gamma_wall_direction,
            "gamma_wall_value": gamma_wall_value,
            "has_data": len(call_current_filtered) > 0 or len(put_current_filtered) > 0,
            "has_1w_data": len(call_1w_filtered) > 0 or len(put_1w_filtered) > 0,
            "has_1m_data": len(call_1m_filtered) > 0 or len(put_1m_filtered) > 0,
            "pc_ratio_current": pc_ratio_current,
            "pc_ratio_0dte": pc_ratio_0dte,
            "pc_ratio_1w": pc_ratio_1w,
            "pc_ratio_1m": pc_ratio_1m
        }
    
    async def generate_key_levels(self, currency: str = "BTC") -> Tuple[List[KeyLevel], Dict]:
        """Generate all key levels for the given currency and return PC ratios"""
        try:
            print(f"Fetching data for {currency}...")
            
            # Fetch basic data first
            spot_price = await self.fetch_index_price(currency)
            if not spot_price:
                raise ValueError(f"Could not fetch spot price for {currency}")
            
            print(f"Spot price: ${spot_price:,.2f}")
            
            # Fetch other data
            tasks = [
                self.fetch_24h_stats(currency),
                self.fetch_instruments_summary(currency),  # Use summary instead of full data
                self.fetch_futures_trades(currency)
            ]
            
            results = await asyncio.gather(*tasks, return_exceptions=True)
            stats_24h, instruments, futures_trades = results
            
            # Handle exceptions
            if isinstance(stats_24h, Exception):
                print(f"Error fetching 24h stats: {stats_24h}")
                stats_24h = {"high_24h": 0, "low_24h": 0}
            if isinstance(instruments, Exception):
                print(f"Error fetching instruments: {instruments}")
                instruments = []
            if isinstance(futures_trades, Exception):
                print(f"Error fetching futures trades: {futures_trades}")
                futures_trades = []
            
            # Calculate all levels
            max_1d, min_1d = self.calculate_1d_levels(stats_24h)
            option_levels = await self.calculate_option_levels(instruments, spot_price)
            volume_levels = self.calculate_volume_profile_levels(futures_trades, spot_price, currency)
            
            # Get HVL (highest volume level)
            hvl = volume_levels[0]["price"] if volume_levels else spot_price
            
            print(f"Calculated levels - Max: ${max_1d:,.2f}, Min: ${min_1d:,.2f}, HVL: ${hvl:,.2f}")
            
            # Fix 4: Confidence weighting based on distance to spot
            def calculate_confidence(base_confidence: float, distance_pct: float) -> float:
                """Reduce confidence for strikes far from spot using exponential decay"""
                return base_confidence * math.exp(-abs(distance_pct) / 10.0)
            
            # Build key levels list
            key_levels = [
                KeyLevel(
                    name="1D Max",
                    value=max_1d,
                    distance_to_spot=self.calculate_distance_to_spot(max_1d, spot_price),
                    confidence=calculate_confidence(0.9 if max_1d > 0 else 0.1, self.calculate_distance_to_spot(max_1d, spot_price))
                ),
                KeyLevel(
                    name="1D Min",
                    value=min_1d,
                    distance_to_spot=self.calculate_distance_to_spot(min_1d, spot_price),
                    confidence=calculate_confidence(0.9 if min_1d > 0 else 0.1, self.calculate_distance_to_spot(min_1d, spot_price))
                ),
                KeyLevel(
                    name="Call Resistance",
                    value=option_levels["call_resistance"],
                    distance_to_spot=self.calculate_distance_to_spot(option_levels["call_resistance"], spot_price),
                    confidence=calculate_confidence(0.8 if option_levels["has_data"] else 0.3, self.calculate_distance_to_spot(option_levels["call_resistance"], spot_price))
                ),
                KeyLevel(
                    name="Call Resistance 0DTE",
                    value=option_levels["call_resistance_0dte"],
                    distance_to_spot=self.calculate_distance_to_spot(option_levels["call_resistance_0dte"], spot_price),
                    confidence=calculate_confidence(0.9 if option_levels["has_data"] else 0.2, self.calculate_distance_to_spot(option_levels["call_resistance_0dte"], spot_price))
                ),
                KeyLevel(
                    name="Call Resistance 1W",
                    value=option_levels["call_resistance_1w"],
                    distance_to_spot=self.calculate_distance_to_spot(option_levels["call_resistance_1w"], spot_price),
                    confidence=calculate_confidence(0.8 if option_levels["has_1w_data"] else 0.2, self.calculate_distance_to_spot(option_levels["call_resistance_1w"], spot_price))
                ),
                KeyLevel(
                    name="Call Resistance 1M",
                    value=option_levels["call_resistance_1m"],
                    distance_to_spot=self.calculate_distance_to_spot(option_levels["call_resistance_1m"], spot_price),
                    confidence=calculate_confidence(0.7 if option_levels["has_1m_data"] else 0.2, self.calculate_distance_to_spot(option_levels["call_resistance_1m"], spot_price))
                ),
                KeyLevel(
                    name=f"Gamma Wall ({option_levels['gamma_wall_direction']})",
                    value=option_levels["gamma_wall"],
                    distance_to_spot=self.calculate_distance_to_spot(option_levels["gamma_wall"], spot_price),
                    confidence=calculate_confidence(0.8 if option_levels["has_data"] else 0.2, self.calculate_distance_to_spot(option_levels["gamma_wall"], spot_price))
                ),
                KeyLevel(
                    name="HVL",
                    value=hvl,
                    distance_to_spot=self.calculate_distance_to_spot(hvl, spot_price),
                    confidence=calculate_confidence(0.7 if volume_levels else 0.2, self.calculate_distance_to_spot(hvl, spot_price))
                ),
                KeyLevel(
                    name="Put Support",
                    value=option_levels["put_support"],
                    distance_to_spot=self.calculate_distance_to_spot(option_levels["put_support"], spot_price),
                    confidence=calculate_confidence(0.8 if option_levels["has_data"] else 0.3, self.calculate_distance_to_spot(option_levels["put_support"], spot_price))
                ),
                KeyLevel(
                    name="Put Support 0DTE",
                    value=option_levels["put_support_0dte"],
                    distance_to_spot=self.calculate_distance_to_spot(option_levels["put_support_0dte"], spot_price),
                    confidence=calculate_confidence(0.9 if option_levels["has_data"] else 0.2, self.calculate_distance_to_spot(option_levels["put_support_0dte"], spot_price))
                ),
                KeyLevel(
                    name="Put Support 1W",
                    value=option_levels["put_support_1w"],
                    distance_to_spot=self.calculate_distance_to_spot(option_levels["put_support_1w"], spot_price),
                    confidence=calculate_confidence(0.8 if option_levels["has_1w_data"] else 0.2, self.calculate_distance_to_spot(option_levels["put_support_1w"], spot_price))
                ),
                KeyLevel(
                    name="Put Support 1M",
                    value=option_levels["put_support_1m"],
                    distance_to_spot=self.calculate_distance_to_spot(option_levels["put_support_1m"], spot_price),
                    confidence=calculate_confidence(0.7 if option_levels["has_1m_data"] else 0.2, self.calculate_distance_to_spot(option_levels["put_support_1m"], spot_price))
                )
            ]
            
            # Sort by distance to spot (absolute value)
            key_levels.sort(key=lambda x: abs(x.distance_to_spot))
            
            # Extract Put/Call ratios
            pc_ratios = {
                "current": option_levels["pc_ratio_current"],
                "0dte": option_levels["pc_ratio_0dte"],
                "1w": option_levels["pc_ratio_1w"],
                "1m": option_levels["pc_ratio_1m"]
            }
            
            return key_levels, pc_ratios
            
        except Exception as e:
            print(f"Error generating key levels: {e}")
            import traceback
            traceback.print_exc()
            return [], {}

async def main():
    """Main function to demonstrate the improved analytics"""
    currencies = ["BTC"]  # Start with BTC for testing
    
    async with DeribitAnalyticsV2Improved() as analytics:
        for currency in currencies:
            print(f"\n{'='*60}")
            print(f"Enhanced Key Levels for {currency} (Improved Version)")
            print(f"{'='*60}")
            
            try:
                key_levels, pc_ratios = await analytics.generate_key_levels(currency)
                
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
                
                # Export data
                json_data = {
                    "currency": currency,
                    "timestamp": datetime.now().isoformat(),
                    "key_levels": [level.to_dict() for level in key_levels],
                    "pc_ratios": pc_ratios
                }
                
                with open(f"{currency.lower()}_enhanced_levels_improved.json", "w") as f:
                    json.dump(json_data, f, indent=2)
                
                print(f"\n💾 Enhanced data exported to {currency.lower()}_enhanced_levels_improved.json")
                
            except Exception as e:
                print(f"Error processing {currency}: {e}")
                import traceback
                traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main()) 
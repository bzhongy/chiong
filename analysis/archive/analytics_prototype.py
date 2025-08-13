#!/usr/bin/env python3
"""
Odette Analytics Prototype
Generates trading indicators from Deribit API data for incorporation into Cloudflare Worker

Key Levels Generated:
- 1D Max/Min
- Call/Put Resistance/Support 
- Gamma Wall ODTE
- HVL (Historic Volatility Level)
- Put/Call Support ODTE
"""

import asyncio
import aiohttp
import json
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import pandas as pd
from dataclasses import dataclass
import math

@dataclass
class KeyLevel:
    """Represents a key price level with distance to current spot"""
    name: str
    value: float
    distance_to_spot: float
    
    def to_dict(self):
        return {
            "name": self.name,
            "value": self.value,
            "distance_to_spot": f"{self.distance_to_spot:.2f}%"
        }

class DeribitAnalytics:
    """Analytics engine for Deribit options data"""
    
    def __init__(self):
        self.base_url = "https://www.deribit.com/api/v2"
        self.session = None
        
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def fetch_instruments(self, currency: str = "BTC") -> List[Dict]:
        """Fetch all active instruments for a currency"""
        url = f"{self.base_url}/public/get_instruments"
        params = {
            "currency": currency,
            "kind": "option",
            "expired": False
        }
        
        async with self.session.get(url, params=params) as response:
            data = await response.json()
            return data.get("result", [])
    
    async def fetch_orderbook(self, instrument_name: str) -> Dict:
        """Fetch orderbook for specific instrument"""
        url = f"{self.base_url}/public/get_order_book"
        params = {"instrument_name": instrument_name}
        
        async with self.session.get(url, params=params) as response:
            data = await response.json()
            return data.get("result", {})
    
    async def fetch_index_price(self, currency: str = "BTC") -> float:
        """Fetch current index price"""
        url = f"{self.base_url}/public/get_index_price"
        params = {"index_name": f"{currency.lower()}_usd"}
        
        async with self.session.get(url, params=params) as response:
            data = await response.json()
            return data.get("result", {}).get("index_price", 0)
    
    async def fetch_historical_volatility(self, currency: str = "BTC") -> float:
        """Fetch historical volatility data"""
        url = f"{self.base_url}/public/get_historical_volatility"
        params = {"currency": currency}
        
        async with self.session.get(url, params=params) as response:
            data = await response.json()
            volatility_data = data.get("result", [])
            if volatility_data:
                return volatility_data[-1][1]  # Latest volatility value
            return 0
    
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
    
    def calculate_distance_to_spot(self, level: float, spot_price: float) -> float:
        """Calculate percentage distance from spot price"""
        return ((level - spot_price) / spot_price) * 100
    
    def calculate_1d_levels(self, spot_price: float, historical_data: List[float] = None) -> Tuple[float, float]:
        """Calculate 1D Max and Min levels"""
        if not historical_data:
            # If no historical data, use approximate intraday range based on volatility
            daily_range = spot_price * 0.05  # Approximate 5% daily range
            return spot_price + daily_range, spot_price - daily_range
        
        return max(historical_data), min(historical_data)
    
    async def calculate_gamma_wall(self, instruments: List[Dict], spot_price: float) -> Dict:
        """Calculate Gamma Wall levels for 0DTE options"""
        gamma_exposure = {}
        
        for instrument in instruments:
            parsed = self.parse_instrument_name(instrument["instrument_name"])
            if not parsed or not self.is_0dte(parsed["expiry_date"]):
                continue
            
            try:
                # Fetch orderbook to get open interest
                orderbook = await self.fetch_orderbook(instrument["instrument_name"])
                open_interest = orderbook.get("open_interest", 0)
                
                if open_interest == 0:
                    continue
                
                strike = parsed["strike"]
                is_call = parsed["is_call"]
                
                # Simplified gamma calculation (would need Black-Scholes for precision)
                # Gamma is highest near ATM and decreases with distance
                moneyness = abs(strike - spot_price) / spot_price
                gamma_approx = math.exp(-moneyness * 10)  # Simplified gamma curve
                
                # Calculate gamma exposure
                exposure = open_interest * gamma_approx * (1 if is_call else -1)
                
                if strike not in gamma_exposure:
                    gamma_exposure[strike] = 0
                gamma_exposure[strike] += exposure
                
            except Exception as e:
                print(f"Error processing {instrument['instrument_name']}: {e}")
                continue
        
        # Find strike with maximum gamma exposure
        if gamma_exposure:
            max_gamma_strike = max(gamma_exposure.items(), key=lambda x: abs(x[1]))[0]
            return {"strike": max_gamma_strike, "exposure": gamma_exposure[max_gamma_strike]}
        
        return {"strike": spot_price, "exposure": 0}
    
    async def calculate_support_resistance_levels(self, instruments: List[Dict], spot_price: float) -> Dict:
        """Calculate Call/Put Support and Resistance levels"""
        call_volumes = {}
        put_volumes = {}
        
        for instrument in instruments:
            parsed = self.parse_instrument_name(instrument["instrument_name"])
            if not parsed or not self.is_0dte(parsed["expiry_date"]):
                continue
            
            try:
                orderbook = await self.fetch_orderbook(instrument["instrument_name"])
                volume = orderbook.get("stats", {}).get("volume", 0)
                
                if volume == 0:
                    continue
                
                strike = parsed["strike"]
                if parsed["is_call"]:
                    call_volumes[strike] = call_volumes.get(strike, 0) + volume
                else:
                    put_volumes[strike] = put_volumes.get(strike, 0) + volume
                    
            except Exception as e:
                print(f"Error processing {instrument['instrument_name']}: {e}")
                continue
        
        # Find key levels based on volume
        call_resistance = max(call_volumes.items(), key=lambda x: x[1])[0] if call_volumes else spot_price
        put_support = max(put_volumes.items(), key=lambda x: x[1])[0] if put_volumes else spot_price
        
        return {
            "call_resistance": call_resistance,
            "put_support": put_support,
            "call_volumes": call_volumes,
            "put_volumes": put_volumes
        }
    
    async def generate_key_levels(self, currency: str = "BTC") -> List[KeyLevel]:
        """Generate all key levels for the given currency"""
        try:
            # Fetch basic data
            spot_price = await self.fetch_index_price(currency)
            instruments = await self.fetch_instruments(currency)
            historical_vol = await self.fetch_historical_volatility(currency)
            
            if not spot_price:
                raise ValueError(f"Could not fetch spot price for {currency}")
            
            print(f"Spot price for {currency}: ${spot_price:,.2f}")
            print(f"Found {len(instruments)} instruments")
            
            # Calculate 1D Max/Min
            max_1d, min_1d = self.calculate_1d_levels(spot_price)
            
            # Calculate Gamma Wall
            gamma_wall = await self.calculate_gamma_wall(instruments, spot_price)
            
            # Calculate Support/Resistance
            sr_levels = await self.calculate_support_resistance_levels(instruments, spot_price)
            
            # Calculate HVL (Historic Volatility Level)
            hvl_level = spot_price * (1 + historical_vol * 0.1)  # Simplified HVL calculation
            
            # Build key levels list
            key_levels = [
                KeyLevel(
                    name="1D Max",
                    value=max_1d,
                    distance_to_spot=self.calculate_distance_to_spot(max_1d, spot_price)
                ),
                KeyLevel(
                    name="1D Min", 
                    value=min_1d,
                    distance_to_spot=self.calculate_distance_to_spot(min_1d, spot_price)
                ),
                KeyLevel(
                    name="Call Resistance",
                    value=sr_levels["call_resistance"],
                    distance_to_spot=self.calculate_distance_to_spot(sr_levels["call_resistance"], spot_price)
                ),
                KeyLevel(
                    name="Call Resistance ODTE",
                    value=sr_levels["call_resistance"],
                    distance_to_spot=self.calculate_distance_to_spot(sr_levels["call_resistance"], spot_price)
                ),
                KeyLevel(
                    name="Gamma Wall ODTE",
                    value=gamma_wall["strike"],
                    distance_to_spot=self.calculate_distance_to_spot(gamma_wall["strike"], spot_price)
                ),
                KeyLevel(
                    name="HVL",
                    value=hvl_level,
                    distance_to_spot=self.calculate_distance_to_spot(hvl_level, spot_price)
                ),
                KeyLevel(
                    name="Put Support",
                    value=sr_levels["put_support"],
                    distance_to_spot=self.calculate_distance_to_spot(sr_levels["put_support"], spot_price)
                ),
                KeyLevel(
                    name="Put Support ODTE",
                    value=sr_levels["put_support"], 
                    distance_to_spot=self.calculate_distance_to_spot(sr_levels["put_support"], spot_price)
                )
            ]
            
            # Sort by distance to spot (absolute value)
            key_levels.sort(key=lambda x: abs(x.distance_to_spot))
            
            return key_levels
            
        except Exception as e:
            print(f"Error generating key levels: {e}")
            return []

async def main():
    """Main function to demonstrate the analytics"""
    currencies = ["BTC", "ETH"]
    
    async with DeribitAnalytics() as analytics:
        for currency in currencies:
            print(f"\n{'='*50}")
            print(f"Key Levels for {currency}")
            print(f"{'='*50}")
            
            try:
                key_levels = await analytics.generate_key_levels(currency)
                
                if not key_levels:
                    print(f"No key levels generated for {currency}")
                    continue
                
                # Display in table format similar to the screenshot
                print(f"{'Key Levels':<25} {'Value':<15} {'Distance to Spot':<20}")
                print("-" * 60)
                
                for level in key_levels:
                    color_code = ""
                    if level.distance_to_spot > 0:
                        color_code = "↑"  # Above spot
                    else:
                        color_code = "↓"  # Below spot
                    
                    print(f"{level.name:<25} {level.value:<15,.2f} {color_code}{level.distance_to_spot:>+6.2f}%")
                
                # Export to JSON for Cloudflare Worker integration
                json_data = {
                    "currency": currency,
                    "timestamp": datetime.now().isoformat(),
                    "key_levels": [level.to_dict() for level in key_levels]
                }
                
                with open(f"odette/{currency.lower()}_key_levels.json", "w") as f:
                    json.dump(json_data, f, indent=2)
                
                print(f"\nData exported to {currency.lower()}_key_levels.json")
                
            except Exception as e:
                print(f"Error processing {currency}: {e}")

if __name__ == "__main__":
    asyncio.run(main()) 
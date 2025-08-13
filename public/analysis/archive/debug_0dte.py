#!/usr/bin/env python3
"""
Debug script to examine 0DTE detection
"""

import asyncio
from datetime import datetime
from analytics_prototype_v2_improved import DeribitAnalyticsV2Improved

async def debug_0dte():
    """Debug 0DTE detection"""
    
    async with DeribitAnalyticsV2Improved() as analytics:
        print("🔍 Debugging 0DTE Detection")
        print(f"Today's date: {datetime.now().date()}")
        print("="*50)
        
        # Fetch BTC instruments
        instruments = await analytics.fetch_instruments_summary("BTC")
        
        if not instruments:
            print("❌ No instruments found")
            return
        
        print(f"Found {len(instruments)} total instruments")
        
        # Group by expiry date
        expiry_counts = {}
        today = datetime.now().date()
        
        for instrument in instruments[:20]:  # Check first 20
            expiry_date = instrument.get("expiry_date")
            if expiry_date:
                expiry_str = expiry_date.strftime("%Y-%m-%d")
                expiry_counts[expiry_str] = expiry_counts.get(expiry_str, 0) + 1
                
                # Check if this is 0DTE
                is_0dte = analytics.is_0dte(expiry_date)
                days_diff = (expiry_date.date() - today).days
                
                print(f"Instrument: {instrument.get('instrument_name', 'Unknown')}")
                print(f"  Expiry: {expiry_str} (in {days_diff} days)")
                print(f"  Is 0DTE: {is_0dte}")
                print(f"  Open Interest: {instrument.get('open_interest', 0)}")
                print()
        
        print("\nExpiry Date Summary:")
        for expiry, count in sorted(expiry_counts.items()):
            expiry_date = datetime.strptime(expiry, "%Y-%m-%d").date()
            days_diff = (expiry_date - today).days
            is_today = days_diff == 0
            print(f"  {expiry}: {count} instruments ({days_diff} days) {'← TODAY!' if is_today else ''}")

if __name__ == "__main__":
    asyncio.run(debug_0dte()) 
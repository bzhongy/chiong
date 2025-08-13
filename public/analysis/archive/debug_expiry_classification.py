#!/usr/bin/env python3
"""
Debug script to test expiry classification logic
"""

import asyncio
from datetime import datetime
from analytics_prototype_v2_improved import DeribitAnalyticsV2Improved

async def debug_expiry_classification():
    """Debug expiry classification"""
    
    async with DeribitAnalyticsV2Improved() as analytics:
        print("🔍 Debugging Expiry Classification")
        print(f"Today's date: {datetime.now().date()}")
        print("="*70)
        
        # Fetch BTC instruments
        instruments = await analytics.fetch_instruments_summary("BTC")
        
        if not instruments:
            print("❌ No instruments found")
            return
        
        # Group by expiry date and classify
        expiry_data = {}
        today = datetime.now().date()
        
        for instrument in instruments:
            expiry_date = instrument.get("expiry_date")
            if expiry_date:
                expiry_str = expiry_date.strftime("%Y-%m-%d")
                if expiry_str not in expiry_data:
                    days_diff = (expiry_date.date() - today).days
                    is_0dte = analytics.is_0dte(expiry_date)
                    is_current = analytics.is_current_weekly_monthly(expiry_date)
                    is_1w = analytics.is_1w_expiry(expiry_date)
                    is_1m = analytics.is_1m_expiry(expiry_date)
                    
                    # Determine weekday
                    weekday_names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
                    weekday = weekday_names[expiry_date.weekday()]
                    
                    expiry_data[expiry_str] = {
                        'date': expiry_date,
                        'days_diff': days_diff,
                        'weekday': weekday,
                        'is_0dte': is_0dte,
                        'is_current': is_current,
                        'is_1w': is_1w,
                        'is_1m': is_1m,
                        'count': 0
                    }
                
                expiry_data[expiry_str]['count'] += 1
        
        print(f"{'Date':<12} {'Day':<4} {'DTE':<4} {'0DTE':<6} {'Curr':<6} {'1W':<4} {'1M':<4} {'Count':<6} {'Classification'}")
        print("-" * 70)
        
        for expiry_str in sorted(expiry_data.keys()):
            data = expiry_data[expiry_str]
            
            # Determine classification
            classification = []
            if data['is_0dte']:
                classification.append("0DTE")
            if data['is_current']:
                classification.append("Current")
            if data['is_1w']:
                classification.append("1W")
            if data['is_1m']:
                classification.append("1M")
            
            if not classification:
                if data['days_diff'] > 90:
                    classification.append("Quarterly")
                else:
                    classification.append("Other")
            
            class_str = "/".join(classification)
            
            print(f"{expiry_str:<12} {data['weekday']:<4} {data['days_diff']:<4} "
                  f"{'✓' if data['is_0dte'] else '✗':<6} "
                  f"{'✓' if data['is_current'] else '✗':<6} "
                  f"{'✓' if data['is_1w'] else '✗':<4} "
                  f"{'✓' if data['is_1m'] else '✗':<4} "
                  f"{data['count']:<6} {class_str}")

if __name__ == "__main__":
    asyncio.run(debug_expiry_classification()) 
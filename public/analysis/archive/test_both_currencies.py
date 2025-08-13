#!/usr/bin/env python3
"""
Test script to run analytics for both BTC and ETH
"""

import asyncio
from analytics_prototype_v2_improved import DeribitAnalyticsV2Improved

async def test_both_currencies():
    """Test analytics for both BTC and ETH"""
    
    async with DeribitAnalyticsV2Improved() as analytics:
        for currency in ["BTC", "ETH"]:
            print(f"\n{'='*70}")
            print(f"🚀 Testing Enhanced Analytics for {currency}")
            print(f"{'='*70}")
            
            try:
                key_levels, pc_ratios = await analytics.generate_key_levels(currency)
                
                if not key_levels:
                    print(f"❌ No key levels generated for {currency}")
                    continue
                
                # Display results
                print(f"\n{'Key Level':<25} {'Value':<15} {'Distance':<12} {'Confidence'}")
                print("-" * 70)
                
                for level in key_levels:
                    confidence_bar = "█" * int(level.confidence * 10)
                    distance_color = "🔴" if level.distance_to_spot < -2 else "🟡" if abs(level.distance_to_spot) < 2 else "🟢"
                    
                    print(f"{level.name:<25} ${level.value:<14,.2f} {distance_color}{level.distance_to_spot:>+6.2f}% {confidence_bar}")
                
                print(f"\n✅ Successfully generated {len(key_levels)} key levels for {currency}")
                
                # Show Put/Call ratios
                print(f"\n📊 Put/Call Ratios (Higher = More Bearish):")
                print(f"   Current: {pc_ratios.get('current', 0):.2f}")
                print(f"   0DTE: {pc_ratios.get('0dte', 0):.2f}")
                print(f"   1W: {pc_ratios.get('1w', 0):.2f}")  
                print(f"   1M: {pc_ratios.get('1m', 0):.2f}")
                
            except Exception as e:
                print(f"❌ Error processing {currency}: {e}")

if __name__ == "__main__":
    asyncio.run(test_both_currencies()) 
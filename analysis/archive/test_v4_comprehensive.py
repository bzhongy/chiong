#!/usr/bin/env python3
"""
Test script for Analytics v4 Comprehensive
Shows all the restored analytics features
"""

import asyncio
from analytics_prototype_v4_comprehensive import DeribitAnalyticsV4Comprehensive

async def test_comprehensive_analytics():
    """Test the comprehensive analytics with full feature set"""
    print("=" * 80)
    print("🚀 Testing Analytics Prototype v4 - Comprehensive Version")
    print("Features: Multi-timeframe + Pagination + Flow Analysis + Put/Call Ratios")
    print("=" * 80)
    
    async with DeribitAnalyticsV4Comprehensive() as analytics:
        for currency in ["BTC", "ETH"]:
            try:
                print(f"\n" + "=" * 60)
                print(f"🔍 Comprehensive Analysis for {currency}")
                print("=" * 60)
                
                key_levels, metadata = await analytics.generate_key_levels(currency)
                
                # Display summary
                print(f"\n📊 Market Summary:")
                print(f"   Spot Price: ${metadata['spot_price']:,.2f}")
                print(f"   Instruments: {metadata['instruments_analyzed']}")
                print(f"   Futures Trades: {metadata['futures_trades']}")
                print(f"   Options Trades: {metadata['options_trades']}")
                
                # Display IV data
                iv_data = metadata.get('iv_data', {})
                if iv_data:
                    print(f"\n📈 Implied Volatility Analysis:")
                    print(f"   Current Expiry: {iv_data.get('current', 0):.1f}%")
                    print(f"   0DTE: {iv_data.get('dte0', 0):.1f}%")
                    print(f"   1 Week: {iv_data.get('week1', 0):.1f}%")
                    print(f"   1 Month: {iv_data.get('month1', 0):.1f}%")
                
                # Display Put/Call ratios
                pc_ratios = metadata.get('put_call_ratios', {})
                if pc_ratios:
                    print(f"\n⚖️  Put/Call Ratios (Higher = More Bearish):")
                    for timeframe, ratio in pc_ratios.items():
                        sentiment = "🔴 Bearish" if ratio > 1.2 else "🟡 Neutral" if ratio > 0.8 else "🟢 Bullish"
                        print(f"   {timeframe:<10}: {ratio:>5.2f} {sentiment}")
                
                # Display key levels grouped by type
                print(f"\n🎯 Key Trading Levels ({len(key_levels)} total):")
                print("-" * 70)
                print(f"{'Level Name':<25} {'Price':<12} {'Distance':<12} {'Confidence'}")
                print("-" * 70)
                
                # Group levels by category
                immediate_levels = []
                resistance_support = []
                flow_levels = []
                technical_levels = []
                
                for level in key_levels:
                    if any(x in level.name for x in ["1D Max", "1D Min", "HVL", "Gamma Wall"]):
                        immediate_levels.append(level)
                    elif any(x in level.name for x in ["Call Resistance", "Put Support"]):
                        resistance_support.append(level)
                    elif any(x in level.name for x in ["Flow", "HVS", "VWAS", "Max Pain"]):
                        flow_levels.append(level)
                    else:
                        technical_levels.append(level)
                
                # Display grouped levels
                def display_level_group(levels, group_name):
                    if levels:
                        print(f"\n{group_name}:")
                        for level in levels:
                            distance_str = f"{level.distance_to_spot:+.2f}%"
                            if level.distance_to_spot > 2:
                                distance_str = f"🟢 {distance_str}"
                            elif level.distance_to_spot < -2:
                                distance_str = f"🔴 {distance_str}"
                            else:
                                distance_str = f"🟡 {distance_str}"
                            
                            confidence_bar = "█" * max(1, int(level.confidence * 8))
                            print(f"  {level.name:<23} ${level.value:>10,.0f} {distance_str:<12} {confidence_bar}")
                
                display_level_group(immediate_levels, "📍 Immediate Levels")
                display_level_group(resistance_support, "🛡️  Support & Resistance")
                display_level_group(flow_levels, "💧 Options Flow")
                display_level_group(technical_levels, "📐 Technical Levels")
                
                # Key insights
                print(f"\n💡 Key Insights:")
                closest_level = min(key_levels, key=lambda x: abs(x.distance_to_spot))
                print(f"   • Closest level: {closest_level.name} at ${closest_level.value:,.0f} ({closest_level.distance_to_spot:+.2f}%)")
                
                strong_resistance = [l for l in resistance_support if "Call Resistance" in l.name and l.distance_to_spot > 0]
                if strong_resistance:
                    strongest = max(strong_resistance, key=lambda x: x.confidence)
                    print(f"   • Key resistance: {strongest.name} at ${strongest.value:,.0f} (+{strongest.distance_to_spot:.2f}%)")
                
                strong_support = [l for l in resistance_support if "Put Support" in l.name and l.distance_to_spot < 0]
                if strong_support:
                    strongest = max(strong_support, key=lambda x: x.confidence)
                    print(f"   • Key support: {strongest.name} at ${strongest.value:,.0f} ({strongest.distance_to_spot:.2f}%)")
                
                # Market sentiment from Put/Call ratios
                avg_pc_ratio = sum(pc_ratios.values()) / len(pc_ratios) if pc_ratios else 1.0
                if avg_pc_ratio > 1.2:
                    sentiment = "🔴 Bearish (High Put Activity)"
                elif avg_pc_ratio < 0.8:
                    sentiment = "🟢 Bullish (High Call Activity)"
                else:
                    sentiment = "🟡 Neutral"
                print(f"   • Market sentiment: {sentiment}")
                
                print("\n✅ Analysis Complete!")
                
            except Exception as e:
                print(f"❌ Error analyzing {currency}: {e}")
                import traceback
                traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_comprehensive_analytics()) 
#!/usr/bin/env python3
"""
Simple test to compare futures data coverage
"""

import asyncio
from analytics_prototype_v4_comprehensive import DeribitAnalyticsV4Comprehensive

async def test_futures_coverage():
    """Test futures data coverage comparison"""
    print("=" * 80)
    print("🚀 Testing Futures Data Coverage: Standard vs Paginated")
    print("=" * 80)
    
    async with DeribitAnalyticsV4Comprehensive() as analytics:
        for currency in ["BTC"]:  # Test BTC first
            try:
                print(f"\n{'='*60}")
                print(f"Testing {currency} Futures Data Coverage")
                print(f"{'='*60}")
                
                # Test standard approach (1000 limit)
                print("\n--- Standard Futures Fetch (1000 limit) ---")
                standard_trades = await analytics.fetch_futures_trades(currency, hours_back=24)
                
                # Test paginated approach (complete)
                print("\n--- Paginated Futures Fetch (complete) ---")
                paginated_trades = await analytics.fetch_complete_futures_trades(currency, hours_back=24, chunk_hours=4)
                
                # Compare results
                print(f"\n📊 COMPARISON RESULTS - {currency}")
                print(f"{'='*50}")
                print(f"Standard trades: {len(standard_trades)}")
                print(f"Paginated trades: {len(paginated_trades)}")
                print(f"Additional trades: +{len(paginated_trades) - len(standard_trades)}")
                
                if len(paginated_trades) > len(standard_trades):
                    pct_increase = ((len(paginated_trades) - len(standard_trades)) / len(standard_trades)) * 100
                    print(f"Percentage increase: +{pct_increase:.1f}%")
                    
                    if pct_increase > 50:
                        print("🔴 CRITICAL: Missing significant futures data with standard approach")
                    elif pct_increase > 20:
                        print("🟡 SIGNIFICANT: Missing notable futures data")
                    else:
                        print("🟢 MINOR: Small difference in data coverage")
                else:
                    print("✅ Standard approach captures most futures data")
                
                # Analyze volume profiles
                def analyze_volume_profile(trades, label):
                    if not trades:
                        return {}
                    
                    price_levels = {}
                    total_volume = 0
                    
                    for trade in trades:
                        price = trade.get("price", 0)
                        amount = trade.get("amount", 0)
                        
                        if price <= 0 or amount <= 0:
                            continue
                        
                        # Round price to create levels
                        level = round(price / 10) * 10 if price > 1000 else round(price)
                        price_levels[level] = price_levels.get(level, 0) + amount
                        total_volume += amount
                    
                    if not price_levels:
                        return {}
                    
                    # Find HVL
                    hvl_price = max(price_levels.items(), key=lambda x: x[1])[0]
                    hvl_volume = price_levels[hvl_price]
                    
                    # Calculate price range
                    prices = [trade.get("price", 0) for trade in trades if trade.get("price", 0) > 0]
                    price_range = max(prices) - min(prices) if prices else 0
                    
                    print(f"\n{label}:")
                    print(f"  Total Volume: {total_volume:,.2f}")
                    print(f"  Price Levels: {len(price_levels)}")
                    print(f"  HVL: ${hvl_price:,.0f} (Volume: {hvl_volume:,.2f})")
                    print(f"  Price Range: ${price_range:,.2f}")
                    
                    return {
                        "total_volume": total_volume,
                        "price_levels": len(price_levels),
                        "hvl_price": hvl_price,
                        "hvl_volume": hvl_volume,
                        "price_range": price_range
                    }
                
                std_analysis = analyze_volume_profile(standard_trades, "Standard Analysis")
                pag_analysis = analyze_volume_profile(paginated_trades, "Paginated Analysis")
                
                # Compare HVL
                if std_analysis and pag_analysis:
                    if std_analysis["hvl_price"] != pag_analysis["hvl_price"]:
                        print(f"\n⚠️  HVL CHANGED: ${std_analysis['hvl_price']:,.0f} → ${pag_analysis['hvl_price']:,.0f}")
                        print("🔴 HVL calculation affected by incomplete data!")
                    else:
                        print(f"\n✅ HVL consistent: ${std_analysis['hvl_price']:,.0f}")
                
                print("\n✅ Futures coverage test complete!")
                
            except Exception as e:
                print(f"❌ Error testing {currency}: {e}")
                import traceback
                traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_futures_coverage()) 
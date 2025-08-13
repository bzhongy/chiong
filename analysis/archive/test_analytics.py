#!/usr/bin/env python3
"""
Test script for Odette Analytics Prototype
Run this to see sample output of the key levels indicators
"""

import asyncio
import json
from analytics_prototype import DeribitAnalytics

async def test_analytics():
    """Test the analytics system with both BTC and ETH"""
    print("🚀 Testing Odette Analytics Prototype")
    print("=" * 60)
    
    # Test currencies
    currencies = ["BTC", "ETH"]
    
    async with DeribitAnalytics() as analytics:
        for currency in currencies:
            print(f"\n📊 Generating Key Levels for {currency}")
            print("-" * 40)
            
            try:
                # Generate key levels
                key_levels = await analytics.generate_key_levels(currency)
                
                if not key_levels:
                    print(f"❌ No key levels generated for {currency}")
                    continue
                
                # Display results in a table format
                print(f"\n{'Key Level':<25} {'Value':<12} {'Distance':<12}")
                print("=" * 50)
                
                for level in key_levels:
                    distance_str = level.to_dict()["distance_to_spot"]
                    print(f"{level.name:<25} {level.value:<12,.2f} {distance_str:<12}")
                
                # Save to JSON file
                json_data = {
                    "currency": currency,
                    "key_levels": [level.to_dict() for level in key_levels]
                }
                
                filename = f"{currency.lower()}_levels_test.json"
                with open(filename, "w") as f:
                    json.dump(json_data, f, indent=2)
                
                print(f"\n💾 Results saved to {filename}")
                
            except Exception as e:
                print(f"❌ Error testing {currency}: {e}")
                continue
    
    print(f"\n✅ Analytics test completed!")
    print("\nNext steps:")
    print("1. Install dependencies: pip install -r requirements.txt")
    print("2. Run the main analytics: python analytics_prototype.py")
    print("3. Integrate cloudflare_worker_adapter.js into your worker")

if __name__ == "__main__":
    # Run the test
    asyncio.run(test_analytics()) 
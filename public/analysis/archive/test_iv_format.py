#!/usr/bin/env python3
import asyncio
import aiohttp

async def check_iv_format():
    async with aiohttp.ClientSession() as session:
        url = 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency'
        params = {'currency': 'BTC', 'kind': 'option'}
        
        async with session.get(url, params=params) as response:
            data = await response.json()
            result = data.get('result', [])
            
            print("Checking IV format from Deribit API:")
            print("=" * 50)
            
            spot_price = 104800  # approximate current BTC price
            count = 0
            
            for instrument in result:
                if count >= 5:  # Just check first 5 ATM options
                    break
                    
                if instrument.get('open_interest', 0) > 0:
                    try:
                        strike = float(instrument.get('instrument_name', '').split('-')[2])
                        if abs(strike - spot_price) / spot_price < 0.05:  # Within 5% of ATM
                            mark_iv = instrument.get('mark_iv')
                            bid_iv = instrument.get('bid_iv')
                            ask_iv = instrument.get('ask_iv')
                            
                            print(f"Instrument: {instrument.get('instrument_name')}")
                            print(f"  Strike: {strike}")
                            print(f"  mark_iv: {mark_iv} (type: {type(mark_iv)})")
                            print(f"  bid_iv: {bid_iv}")
                            print(f"  ask_iv: {ask_iv}")
                            print(f"  open_interest: {instrument.get('open_interest')}")
                            print()
                            count += 1
                    except:
                        continue

if __name__ == "__main__":
    asyncio.run(check_iv_format()) 
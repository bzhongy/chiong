const { DeribitAnalyticsV4Comprehensive } = require('./deribit_analytics_v4_comprehensive.js');

async function debug0DTE() {
    console.log('=== Debugging 0DTE Classification Issue ===\n');
    
    const analytics = new DeribitAnalyticsV4Comprehensive();
    
    // Get current time
    const now = new Date();
    console.log(`Current time: ${now.toISOString()}`);
    console.log(`Current UTC day: ${now.getUTCDay()} (0=Sunday, 1=Monday, ..., 6=Saturday)`);
    
    // Fetch ETH instruments
    console.log('\nFetching ETH instruments...');
    const instruments = await analytics.fetchInstrumentsSummary('ETH');
    console.log(`Total instruments: ${instruments.length}`);
    
    // Collect all unique expiry dates
    const expiryDates = new Set();
    const instrumentsByExpiry = {};
    let validDates = 0;
    let invalidDates = 0;
    
    console.log('\nFirst 5 instruments with their raw expiry data:');
    for (let i = 0; i < Math.min(5, instruments.length); i++) {
        const inst = instruments[i];
        console.log(`${inst.instrument_name}: expiry_date=${inst.expiry_date}, type=${typeof inst.expiry_date}`);
    }
    
    for (const instrument of instruments) {
        if (instrument.expiry_date) {
            try {
                const expiryKey = instrument.expiry_date.toISOString().split('T')[0]; // YYYY-MM-DD
                expiryDates.add(expiryKey);
                
                if (!instrumentsByExpiry[expiryKey]) {
                    instrumentsByExpiry[expiryKey] = [];
                }
                instrumentsByExpiry[expiryKey].push(instrument);
                validDates++;
            } catch (error) {
                console.log(`Invalid expiry date for ${instrument.instrument_name}: ${instrument.expiry_date}, type: ${typeof instrument.expiry_date}`);
                invalidDates++;
            }
        }
    }
    
    console.log(`\nExpiry date processing: ${validDates} valid, ${invalidDates} invalid`);
    
    // Sort expiry dates
    const sortedExpiryDates = Array.from(expiryDates).sort();
    
    console.log(`\nFound ${sortedExpiryDates.length} unique expiry dates:`);
    
    // Examine the first few expiry dates in detail
    for (let i = 0; i < Math.min(10, sortedExpiryDates.length); i++) {
        const expiryKey = sortedExpiryDates[i];
        const sampleInstrument = instrumentsByExpiry[expiryKey][0];
        const expiryDate = sampleInstrument.expiry_date;
        
        // Test all classification functions
        const is0DTE = analytics.is0DTE(expiryDate);
        const isCurrent = analytics.isCurrentWeeklyMonthly(expiryDate);
        const is1W = analytics.is1WExpiry(expiryDate);
        const is1M = analytics.is1MExpiry(expiryDate);
        
        // Calculate time until expiry at 8AM UTC
        const expiryUtc8 = new Date(Date.UTC(
            expiryDate.getUTCFullYear(),
            expiryDate.getUTCMonth(),
            expiryDate.getUTCDate(),
            8, 0, 0
        ));
        
        const timeDiff = expiryUtc8.getTime() - now.getTime();
        const hoursUntilExpiry = timeDiff / (1000 * 60 * 60);
        
        console.log(`\n${expiryKey} (${instrumentsByExpiry[expiryKey].length} instruments):`);
        console.log(`  Sample: ${sampleInstrument.instrument_name}`);
        console.log(`  Expiry at 8AM UTC: ${expiryUtc8.toISOString()}`);
        console.log(`  Hours until expiry: ${hoursUntilExpiry.toFixed(2)}`);
        console.log(`  Classifications: 0DTE=${is0DTE}, Current=${isCurrent}, 1W=${is1W}, 1M=${is1M}`);
        
        // Show 0DTE logic details
        if (timeDiff > 0 && timeDiff <= 24 * 60 * 60 * 1000) {
            console.log(`  *** Should be 0DTE: timeDiff=${timeDiff}, condition: ${timeDiff > 0 && timeDiff <= 24 * 60 * 60 * 1000} ***`);
        }
    }
    
    // Test with a manual date that should be 0DTE
    console.log('\n=== Testing manual 0DTE date ===');
    const testDate = new Date(now);
    testDate.setUTCDate(testDate.getUTCDate() + 1); // Tomorrow
    testDate.setUTCHours(8, 0, 0, 0); // 8 AM UTC
    
    const testTimeDiff = testDate.getTime() - now.getTime();
    const testHours = testTimeDiff / (1000 * 60 * 60);
    
    console.log(`Test date (tomorrow 8AM): ${testDate.toISOString()}`);
    console.log(`Hours until test date: ${testHours.toFixed(2)}`);
    console.log(`Should be 0DTE: ${analytics.is0DTE(testDate)}`);
    console.log(`0DTE condition: timeDiff > 0 (${testTimeDiff > 0}) && timeDiff <= 24h (${testTimeDiff <= 24 * 60 * 60 * 1000})`);
    
    // Check if there are any Friday expiries (typical for 0DTE)
    console.log('\n=== Checking for Friday expiries ===');
    for (const expiryKey of sortedExpiryDates.slice(0, 5)) {
        const sampleInstrument = instrumentsByExpiry[expiryKey][0];
        const expiryDate = sampleInstrument.expiry_date;
        const dayOfWeek = expiryDate.getUTCDay(); // 0=Sunday, 5=Friday
        console.log(`${expiryKey}: Day of week = ${dayOfWeek} ${dayOfWeek === 5 ? '(FRIDAY)' : ''}`);
    }
}

debug0DTE().catch(console.error); 
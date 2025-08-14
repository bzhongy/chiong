/**
 * Chiong Markets OptionBook Indexer
 * Tracks events from OptionBook and BaseOption contracts
 * Provides API endpoints for user positions and history.
 */

// Configuration
const OPTION_BOOK_ADDRESS = "0xA63D2717538834E553cbe811B04a17eC748D71FB"; // YOUR OPTION BOOK ADDRESS
const OPTION_BOOK_DEPLOY_BLOCK = 33445320; // Replace with actual deployment block
const CHAIN_ID = 8453; // Base Mainnet

const UPDATE_COOLDOWN = 10 * 1000; //10 seconds in milliseconds (adjust as needed)
const BATCH_SIZE = 50000; // Number of blocks to process in one batch (adjust based on RPC limits/performance)
const STATE_FRESHNESS_WINDOW = 15 * 1000; // 15 seconds - consider cached state fresh

// CORS Configuration
const CORS_WHITELIST = [
      'https://chiong.fi',
    'https://app.chiong.fi',
  'http://localhost:3000', // For local development
  'http://127.0.0.1:3000', // For local development
  'https://thetanuts.finance',
  'https://app.thetanuts.finance',
  'https://alpha.thetanuts.finance',
  'https://beta.thetanuts.finance',
  'https://delta.thetanuts.finance',
  'https://gamma.thetanuts.finance',
  'https://thetanuts-ui-main.vercel.app'
];

// ABI fragments for the events we care about
const EVENT_ABI = [
  // --- OptionBook Events ---
  "event OrderFilled(uint256 indexed nonce, address indexed buyer, address indexed seller, address optionAddress, uint256 premiumAmount, uint256 feeCollected, bool sellerWasMaker)",
  "event OrderCancelled(uint256 indexed nonce, address indexed maker)",
  // --- BaseOption Events ---
  "event OptionInitialized(address indexed buyer, address indexed seller, address indexed createdBy, uint256 optionType, address collateralToken, address priceFeed, uint256[] strikes, uint256 expiryTimestamp, uint256 numContracts, uint256 collateralAmount)",
  "event RoleTransferred(address indexed optionAddress, address indexed from, address indexed to, bool isBuyer)",
  "event OptionExpired(address indexed optionAddress, uint256 settlementPrice)",
  "event OptionPayout(address indexed optionAddress, address indexed buyer, uint256 amountPaidOut)",
  "event CollateralReturned(address indexed optionAddress, address indexed seller, uint256 amountReturned)",
  "event OptionClosed(address indexed optionAddress, address indexed closedBy, uint256 collateralReturned)",
  "event OptionSplit(address indexed newOption, uint256 collateralAmount)" // Needed if splits create new trackable options
];

// Simple Metadata Lookup (similar to app.js CONFIG) - Keep this updated!
const METADATA = {
    priceFeeds: {
        '0x71041dddad3595f9ced3dccfbe3d1f4b0a16bb70': { underlyingAsset: 'ETH', decimals: 8 },
        '0x64c911996d3c6ac71f9b455b1e8e7266bcbd848f': { underlyingAsset: 'BTC', decimals: 8 },
    },
    collaterals: {
        '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6 },
        '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18 },
        '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': { symbol: 'CBBTC', decimals: 8 },
    },

    // Option type bit layout: 0xABCD
    // A: 0 (Vanilla) - bits 12-15
    // B: 1 (Quote collateral) - bits 8-11
    // C: 0 (Cash settled) - bits 4-7
    // D: 1 (Put) - bits 0-3
    optionTypes: {
        '0x0000': { name: 'ETH Call', style: 'Inverse Vanilla Call'},
        '0x0101': { name: 'ETH Put', style: 'Vanilla Put ' },
    }
};

// In-memory cache for the full state
let cachedFullState = null;
let cachedStateTimestamp = 0;
let lastProcessedRequestTime = 0;
let localUpdateTimestamp = 0;

const REQUEST_DEDUPLICATION_WINDOW = 1000; // 1 second

// --- BigNumber Class (essential for handling uint256) ---
class BigNumber {
    constructor(value) {
        if (typeof value === 'string') {
            if (value.startsWith('0x')) {
                this.value = BigInt(value);
            } else {
                this.value = BigInt(value);
            }
        } else if (typeof value === 'number') {
             // Avoid precision loss for large numbers
            if (!Number.isSafeInteger(value)) {
                throw new Error(`Unsafe integer value for BigNumber: ${value}`);
            }
            this.value = BigInt(value);
        } else if (value instanceof BigNumber) {
            this.value = value.value;
        } else if (typeof value === 'bigint') {
            this.value = value;
        } else if (value && typeof value === 'object' && value.type === 'BigNumber') {
            // Handle hex values from ethers/viem like { type: "BigNumber", hex: "0x..." }
             this.value = BigInt(value.hex);
        } else {
            this.value = BigInt(0);
        }
    }

    add(other) {
        return new BigNumber(this.value + new BigNumber(other).value);
    }

    sub(other) {
        return new BigNumber(this.value - new BigNumber(other).value);
    }

    mul(other) {
        return new BigNumber(this.value * new BigNumber(other).value);
    }

    div(other) {
        const otherBN = new BigNumber(other);
        if (otherBN.isZero()) throw new Error("Division by zero");
        // Use integer division
        return new BigNumber(this.value / otherBN.value);
    }

     // Add comparison methods
    eq(other) {
        return this.value === new BigNumber(other).value;
    }

    lt(other) {
        return this.value < new BigNumber(other).value;
    }

    lte(other) {
        return this.value <= new BigNumber(other).value;
    }

    gt(other) {
        return this.value > new BigNumber(other).value;
    }

    gte(other) {
        return this.value >= new BigNumber(other).value;
    }

    isZero() {
        return this.value === BigInt(0);
    }

    // Return hex string (useful for comparisons sometimes)
    toHexString() {
        return '0x' + this.value.toString(16);
    }

    // Return decimal string representation
    toString(radix = 10) {
        return this.value.toString(radix);
    }

    // Potentially lossy conversion to JS number
    toNumber() {
        if (this.value > BigInt(Number.MAX_SAFE_INTEGER) || this.value < BigInt(Number.MIN_SAFE_INTEGER)) {
             console.warn(`BigNumber value ${this.value.toString()} is outside safe integer range for JS Number.`);
            // Decide on behavior: throw error, return string, or return potentially inaccurate number
            // Returning string is safest for display purposes if precision matters
             return this.value.toString();
            // return Number(this.value); // Potentially inaccurate
        }
        return Number(this.value);
    }

    // Static method to create from ethers-like BigNumber object
    static from(value) {
        return new BigNumber(value);
    }
}


// --- Event Parser ---
const EventParser = {
  init(env) {
    this.eventHashes = {
      'OrderFilled': '0x5cb63533db2d30efc3d7a8c3625230e90a6b9697b23ceb5a88db87577f014a2c',
      'OrderCancelled': '0xc0362da6f2ff36b382b34aec0814f6b3cdf89f5ef282a1d1f114d0c0b036d596',
      'OptionInitialized': '0x2d27837a600426b91f8973e3ad37045eb3351b43769cbb4fb9ad1f9aaff1a484',
      'RoleTransferred': '0x83a50732194629dbdc1b6553381c106fd007ecfa402a02558dbfb039dda69fb7',
      'OptionExpired': '0xc549d3d80332dee29de8f13591cac9d525bb5fe89a6dd90f44f0f659c6133324',
      'OptionPayout': '0x3a945388fe0a73ff7616714347533e2f1713377f609ad9e8b365949cbee1ff6e',
      'CollateralReturned': '0xedd9aae2554e64d4211870eb367de98af64539d1cb8f93ac941752a1f5c8d16d',
      'OptionClosed': '0xf6b70e7b963f6035e2f7f31cb25d86edbfb11d3006c4ad20bd93923a056e828c',
      'OptionSplit': '0x4ba7101b6ba84855348b94f0e88606a14b7ff364028705c3d880a0741385355c',
    };
    // Reverse map for easier lookup
    this.hashToName = Object.entries(this.eventHashes).reduce((acc, [name, hash]) => {
        acc[hash] = name;
        return acc;
    }, {});
  },

  parseLog(log, env) {
    if (!this.eventHashes) this.init(env); // Initialize if not already done

    try {
      const topics = log.topics || [];
      if (!topics.length) {
        console.warn("Log has no topics:", log);
        return null;
      }

      const eventSignatureHash = topics[0];
      const eventName = this.hashToName[eventSignatureHash];

      if (!eventName) {
        // console.warn("Unknown event signature:", eventSignatureHash, "Tx:", log.transactionHash);
        return null;
      }

      // Decode based on event name
      // NOTE: This requires manual decoding based on ABI, which is less robust than using ethers.js Interface.
      // For production, consider bundling a minimal ethers Interface or similar.
      const data = log.data.startsWith('0x') ? log.data.slice(2) : log.data; // Remove '0x'
      const indexedData = topics.slice(1); // Topics excluding signature

      switch (eventName) {
        case 'OrderFilled':
          return this.parseOrderFilled(indexedData, data, env);
        case 'OrderCancelled':
          return this.parseOrderCancelled(indexedData, data, env);
        case 'OptionInitialized':
          return this.parseOptionInitialized(log, indexedData, data, env);
        case 'RoleTransferred':
           return this.parseRoleTransferred(log, indexedData, data, env);
        case 'OptionExpired':
           return this.parseOptionExpired(log, indexedData, data, env);
        case 'OptionPayout':
            return this.parseOptionPayout(log, indexedData, data, env);
        case 'CollateralReturned':
            return this.parseCollateralReturned(log, indexedData, data, env);
        case 'OptionClosed':
             return this.parseOptionClosed(log, indexedData, data, env);
        // Add parsing for other relevant events (RoleTransferred, OptionExpired, etc.)
        default:
          console.warn(`Parsing not implemented for event: ${eventName}`);
          return null;
      }
    } catch (error) {
      console.error("Error parsing log:", error, log);
      return null;
    }
  },

  decodeAddress(topic) {
    if (!topic) return null;
    
    // For indexed parameters, which are full 32-byte topics
    if (topic.length === 66 && topic.startsWith('0x')) {
      return '0x' + topic.slice(-40).toLowerCase();
    }
    
    // For address in data field, which might be padded to 32 bytes
    if (topic.length === 64 || (topic.length === 66 && topic.startsWith('0x'))) {
      // Remove '0x' if present, then get the last 40 characters
      const hex = topic.startsWith('0x') ? topic.slice(2) : topic;
      return '0x' + hex.slice(-40).toLowerCase();
    }
    
    // If it's already a valid address format
    if ((topic.length === 42 && topic.startsWith('0x')) || 
        (topic.length === 40 && !topic.startsWith('0x'))) {
      return ('0x' + topic.replace(/^0x/, '')).toLowerCase();
    }
    
    console.error(`Invalid address format: ${topic}`);
    return null;
  },

  decodeUint256(hex) {
    if (!hex) return new BigNumber(0);
     // Handle cases where hex might not start with 0x
    const cleanHex = hex.startsWith('0x') ? hex : '0x' + hex;
    if (cleanHex === '0x') return new BigNumber(0);
    try {
         return new BigNumber(cleanHex);
    } catch (e) {
        console.error(`Error decoding uint256 from hex: ${hex}`, e);
        return new BigNumber(0); // Return zero on error
    }
  },

  decodeBool(hex) {
    return hex.endsWith('1');
  },

   // --- Specific Event Parsers ---

  parseOrderFilled(indexedData, data, env) {
    // event OrderFilled(uint256 indexed nonce, address indexed buyer, address indexed seller, address optionAddress, uint256 premiumAmount, uint256 feeCollected, bool sellerWasMaker);
    
    // Check that we have all expected indexed data
    if (indexedData.length < 3) {
      console.error(`Invalid OrderFilled event: missing indexed data. Got ${indexedData.length} items.`);
      return null;
    }

    // Debug logging
    console.log("OrderFilled raw data:", { 
      indexedData, 
      data,
      nonce: indexedData[0],
      buyer: indexedData[1],
      seller: indexedData[2]
    });

    const nonce = this.decodeUint256(indexedData[0]);
    const buyer = this.decodeAddress(indexedData[1]);
    const seller = this.decodeAddress(indexedData[2]);

    // Validate data length
    if (!data || data.length < 256) {
      console.error(`Invalid OrderFilled event: data too short. Length: ${data?.length}`);
      return null;
    }

    const optionAddress = this.decodeAddress('0x' + data.slice(0, 64)); // First 32 bytes (address padded)
    const premiumAmount = this.decodeUint256('0x' + data.slice(64, 128));
    const feeCollected = this.decodeUint256('0x' + data.slice(128, 192));
    const sellerWasMaker = this.decodeBool(data.slice(192, 256));

    // Add validation
    if (!optionAddress) {
      console.error(`Failed to decode option address: ${data.slice(0, 64)}`);
      return null;
    }

    // Log the successful parse
    console.log("OrderFilled parsed:", { 
      nonce: nonce.toString(), 
      buyer, 
      seller, 
      optionAddress, 
      premiumAmount: premiumAmount.toString(),
      feeCollected: feeCollected.toString(),
      sellerWasMaker
    });

    return {
      name: 'OrderFilled',
      args: { nonce, buyer, seller, optionAddress, premiumAmount, feeCollected, sellerWasMaker }
    };
  },

   parseOrderCancelled(indexedData, data, env) {
        // event OrderCancelled(uint256 indexed nonce, address indexed maker);
        const nonce = this.decodeUint256(indexedData[0]);
        // Maker address is in the second topic
        const maker = this.decodeAddress(indexedData[1]);

        return {
            name: 'OrderCancelled',
            args: { nonce, maker }
        };
    },

  parseOptionInitialized(log, indexedData, data, env) {
    // event OptionInitialized(address indexed buyer, address indexed seller, address indexed createdBy, uint256 optionType, address collateralToken, address priceFeed, uint256[] strikes, uint256 expiryTimestamp, uint256 numContracts, uint256 collateralAmount, bytes extraOptionData);
    const buyer = this.decodeAddress(indexedData[0]);
    const seller = this.decodeAddress(indexedData[1]);
    const createdBy = this.decodeAddress(indexedData[2]);

    // Non-indexed data starts after the indexed args
    let offset = 0;
    const optionType = this.decodeUint256('0x' + data.slice(offset, offset + 64)).toNumber(); // Assuming optionType fits in number
    offset += 64;
    const collateralToken = this.decodeAddress('0x' + data.slice(offset, offset + 64));
    offset += 64;
    const priceFeed = this.decodeAddress('0x' + data.slice(offset, offset + 64));
    offset += 64;

    // Dynamic array `strikes`
    // Parse the offset and ensure it's a number type
    const offsetBigNum = this.decodeUint256('0x' + data.slice(offset, offset + 64));
    const strikesOffsetNum = Number(offsetBigNum.toString());
    offset += 64;
    
    // Now strikesOffsetNum is definitely a number
    const strikesOffset = strikesOffsetNum * 2; // Offset in characters
    
    // Parse the length and ensure it's a number type
    const lengthBigNum = this.decodeUint256('0x' + data.slice(strikesOffset, strikesOffset + 64));
    const strikesLengthNum = Number(lengthBigNum.toString());
    
    const strikes = [];
    
    // Use the number version in the loop
    for (let i = 0; i < strikesLengthNum; i++) {
      strikes.push(this.decodeUint256('0x' + data.slice(strikesOffset + 64 + i * 64, strikesOffset + 128 + i * 64)));
    }

    // Continue with fixed-size data after the array pointer
    const expiryTimestamp = this.decodeUint256('0x' + data.slice(offset, offset + 64));
    offset += 64;
    const numContracts = this.decodeUint256('0x' + data.slice(offset, offset + 64));
    offset += 64;
    const collateralAmount = this.decodeUint256('0x' + data.slice(offset, offset + 64));
    offset += 64;
    
    // Parse the extraOptionData bytes
    // First get the offset to the bytes data
    const extraDataOffsetBigNum = this.decodeUint256('0x' + data.slice(offset, offset + 64));
    const extraDataOffset = Number(extraDataOffsetBigNum.toString()) * 2; // Convert to character offset
    
    // Get the length of the bytes
    const extraDataLengthBigNum = this.decodeUint256('0x' + data.slice(extraDataOffset, extraDataOffset + 64));
    const extraDataLength = Number(extraDataLengthBigNum.toString()) * 2; // Convert to character length
    
    // Extract the actual bytes data
    let extraOptionData = '';
    if (extraDataLength > 0) {
      extraOptionData = '0x' + data.slice(extraDataOffset + 64, extraDataOffset + 64 + extraDataLength);
    } else {
      extraOptionData = '0x'; // Empty bytes
    }

    // Get the address that emitted this event (the BaseOption contract address)
    const optionAddress = log.address.toLowerCase();

    return {
      name: 'OptionInitialized',
      args: {
        optionAddress, // Add the emitting address
        buyer,
        seller,
        createdBy,
        optionType,
        collateralToken,
        priceFeed,
        strikes,
        expiryTimestamp,
        numContracts,
        collateralAmount,
        extraOptionData
      }
    };
  },

   parseRoleTransferred(log, indexedData, data, env) {
        // event RoleTransferred(address indexed optionAddress, address indexed from, address indexed to, bool isBuyer);
        // Option address is log.address
        const optionAddress = log.address.toLowerCase(); // Use log.address
        const from = this.decodeAddress(indexedData[1]);
        const to = this.decodeAddress(indexedData[2]);

        const isBuyer = this.decodeBool(data.slice(0, 64));

        return {
            name: 'RoleTransferred',
            args: { optionAddress, from, to, isBuyer }
        };
    },

     parseOptionExpired(log, indexedData, data, env) {
        // event OptionExpired(address indexed optionAddress, uint256 settlementPrice);
         const optionAddress = log.address.toLowerCase(); // Emitting address
         // settlementPrice is in data
         const settlementPrice = this.decodeUint256('0x' + data.slice(0, 64));

        return {
            name: 'OptionExpired',
            args: { optionAddress, settlementPrice }
        };
    },

    parseOptionPayout(log, indexedData, data, env) {
        // event OptionPayout(address indexed optionAddress, address indexed buyer, uint256 amountPaidOut);
        const optionAddress = log.address.toLowerCase();
        const buyer = this.decodeAddress(indexedData[0]); // Check index
        const amountPaidOut = this.decodeUint256('0x' + data.slice(0, 64));

        return {
            name: 'OptionPayout',
            args: { optionAddress, buyer, amountPaidOut }
        };
    },

    parseCollateralReturned(log, indexedData, data, env) {
        // event CollateralReturned(address indexed optionAddress, address indexed seller, uint256 amountReturned);
        const optionAddress = log.address.toLowerCase();
        const seller = this.decodeAddress(indexedData[0]); // Check index
        const amountReturned = this.decodeUint256('0x' + data.slice(0, 64));

        return {
            name: 'CollateralReturned',
            args: { optionAddress, seller, amountReturned }
        };
    },

     parseOptionClosed(log, indexedData, data, env) {
        // event OptionClosed(address indexed optionAddress, address indexed closedBy, uint256 collateralReturned);
         const optionAddress = log.address.toLowerCase();
         const closedBy = this.decodeAddress(indexedData[0]); // Check index
         const collateralReturned = this.decodeUint256('0x' + data.slice(0, 64));

        return {
            name: 'OptionClosed',
            args: { optionAddress, closedBy, collateralReturned }
        };
    },
};

// --- Worker Entry Points ---

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event));
});

addEventListener('scheduled', event => {
  event.waitUntil(processScheduledUpdate(event.env));
});

// --- Request Handling & Routing ---

async function handleRequest(event) {
  const request = event.request;
  const env = event.env;
  const url = new URL(request.url);
  
  console.log("Request handling started:", url.pathname);

  // Handle CORS preflight requests
  if (request.method === 'OPTIONS') {
    return handleCORS(request);
  }

  // Check origin for CORS whitelist
  const origin = request.headers.get('Origin');
  const corsHeaders = getCORSHeaders(origin);

  // API routes
  if (url.pathname.startsWith('/api/')) {
      try {
          
          if (url.pathname === '/api/update') {
            console.log("Handling explicit update request");
            return handleUpdateRequest(env, corsHeaders);
          } 
          
          if (url.pathname === '/api/refresh-blocks') {
            return handleRefreshBlocksRequest(request, env, corsHeaders);
          }

          console.log("Checking if background update is needed for:", url.pathname);
          console.log("Event passed to trigger function:", !!event, "with waitUntil:", !!(event && event.waitUntil));
          
          const updateTriggered = await triggerBackgroundUpdateIfNeeded(env, event);
          console.log("Background update triggered:", updateTriggered);
          
          if (url.pathname.startsWith('/api/user/')) {
            const parts = url.pathname.split('/');
            if (parts.length >= 5) {
                 const userAddress = parts[3].toLowerCase(); // Ensure consistent casing
                 const dataType = parts[4]; // 'positions' or 'history'
                 return handleUserDataRequest(userAddress, dataType, corsHeaders, env);
            }
          } else if (url.pathname === '/api/stats') {
               return handleStatsRequest(corsHeaders, env);
          } else if (url.pathname === '/api/state') {
               // Add a simple endpoint to view the current cached state (for debugging)
               const state = await getFullState(env);
               return new Response(JSON.stringify(state, null, 2), { headers: { 'Content-Type': 'application/json', ...corsHeaders }});
          } else if (url.pathname === '/api/clear-cache') {
               return handleClearCacheRequest(env, corsHeaders);
          } else if (url.pathname.startsWith('/api/option-events/')) {
            const optionAddress = url.pathname.split('/api/option-events/')[1].toLowerCase();
            return handleOptionEventsRequest(optionAddress, corsHeaders, env);
          } else if (url.pathname === '/api/scoreboard') {
            return handleScoreboardRequest(corsHeaders, env);
          } else if (url.pathname === '/api/open-positions') {
            return handleOpenPositionsRequest(corsHeaders, env);
          } else if (url.pathname.startsWith('/api/streaks/')) {
            const userAddress = url.pathname.split('/api/streaks/')[1].toLowerCase();
            return handleUserStreaksRequest(userAddress, corsHeaders, env);
          } else if (url.pathname === '/api/rebuild-metrics') {
            return handleRebuildMetricsRequest(corsHeaders, env);
          } else if (url.pathname.startsWith('/api/debug-user/')) {
            const userAddress = url.pathname.split('/api/debug-user/')[1].toLowerCase();
            return handleDebugUserRequest(userAddress, corsHeaders, env);
          }

          return new Response(JSON.stringify({ error: 'API endpoint not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
      } catch (error) {
           console.error(`API Error (${url.pathname}):`, error);
            return new Response(JSON.stringify({ status: 'error', message: error.message || 'Internal server error' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
      }
  }

  // For all other requests, redirect to thetanuts.finance
          let newUrl = `https://thetanuts.finance/v4/ui/odette${url.pathname}`;
  
  // Preserve query parameters if any
  if (url.search) {
    newUrl += url.search;
  }
  
  // Create a new request with the same method, headers, and body
  const newRequest = new Request(newUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: 'follow'
  });
  
  // Forward the request
  return fetch(newRequest);
}

// --- CORS Handling ---

function getCORSHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, CF-Access-Client-Id, CF-Access-Client-Secret', // Add any other required headers
    'Access-Control-Max-Age': '86400', // 24 hours
  };
  if (origin && CORS_WHITELIST.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  } else {
    // Optional: Disallow if not in whitelist explicitly
    // Or allow all for development (less secure): headers['Access-Control-Allow-Origin'] = '*';
    // Sticking to whitelist is safer
    // console.warn(`Origin ${origin} not in CORS whitelist`);
  }
  return headers;
}

function handleCORS(request) {
  const origin = request.headers.get('Origin');
  const corsHeaders = getCORSHeaders(origin);
  return new Response(null, { status: 204, headers: corsHeaders });
}


// --- State Management & Initialization ---

async function getFullState(env) {
  const currentTime = Date.now();
  if (cachedFullState && (currentTime - cachedStateTimestamp < STATE_FRESHNESS_WINDOW)) {
    // console.log("Using cached state");
    return cachedFullState;
  }

  console.log('Fetching full state from KV');
  const fullStateStr = await KV_STORAGE.get('fullState');
  let fullState;

  if (fullStateStr) {
    try {
      // Need to revive BigNumber instances if stored just as strings
      fullState = JSON.parse(fullStateStr, (key, value) => {
         // Detect keys known to hold BigNumber strings and revive them
          const bigNumKeys = ['entryPremium', 'feePaid', 'numContracts', 'collateralAmount', 'settlementPrice', 'payoutBuyer', 'collateralReturnedSeller'];
           if (bigNumKeys.includes(key) && typeof value === 'string') {
                try {
                     // Use BigNumber internally for consistency if needed, but keep as string for storage
                     return new BigNumber(value).toString(); // Keep as string for JSON compatibility, parse later
                } catch {
                    return value; // If parsing fails, return original string
                }
           }
           // Revive strike arrays which might contain strings
            if (key === 'strikes' && Array.isArray(value)) {
                // Ensure strikes are stored/retrieved as strings to avoid BigInt issues with JSON
                return value.map(v => typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint' ? new BigNumber(v).toString() : v);
            }
           return value;
      });
      // Ensure nested objects/arrays exist
       fullState.positions = fullState.positions || {};
       fullState.userPositions = fullState.userPositions || {};
       fullState.events = fullState.events || {}; // Ensure events object exists
       fullState.userDailyMetrics = fullState.userDailyMetrics || {}; // Ensure daily metrics object exists
       fullState.topProfitableTrades = fullState.topProfitableTrades || []; // Ensure profitable trades array exists

       // --- Add handling for the new field ---
       if (!fullState.indexedOptionBookAddress) {
          console.warn("State loaded without 'indexedOptionBookAddress'. Initializing with current constant.");
          // If the field is missing (old state), assume it was the *previous* run's constant.
          // We'll force a check/reset in updateState anyway.
          // Setting it here helps if the code runs getFullState multiple times before updateState.
          fullState.indexedOptionBookAddress = OPTION_BOOK_ADDRESS.toLowerCase();
       }
        // Ensure lastProcessedBlock is a number
       if (typeof fullState.lastProcessedBlock !== 'number') {
            console.warn(`lastProcessedBlock type invalid (${typeof fullState.lastProcessedBlock}). Resetting.`);
             // Attempt conversion or reset to deploy block
             const parsedBlock = parseInt(fullState.lastProcessedBlock);
             fullState.lastProcessedBlock = !isNaN(parsedBlock) ? parsedBlock : OPTION_BOOK_DEPLOY_BLOCK - 1;
       }


    } catch (e) {
      console.error('Error parsing full state from KV:', e);
      fullState = initializeFullState();
    }
  } else {
    fullState = initializeFullState();
  }

  // Update cache
  cachedFullState = fullState;
  cachedStateTimestamp = currentTime;

  return fullState;
}

function initializeFullState() {
  return {
    lastProcessedBlock: OPTION_BOOK_DEPLOY_BLOCK - 1, // Start processing from deploy block
    indexedOptionBookAddress: OPTION_BOOK_ADDRESS.toLowerCase(), // Store the address being indexed
    positions: {}, // Key: optionAddress, Value: Position object
    userPositions: {}, // Key: userAddress, Value: { open: [optionAddr...], history: [optionAddr...] }
    events: {}, // NEW: Key: optionAddress, Value: Array of processed events
    userDailyMetrics: {}, // NEW: Key: userAddress, Value: daily metrics for streak tracking
    topProfitableTrades: [], // NEW: Array of most profitable trades for marketing
    // Add other state parts if needed (e.g., makerOrders: {})
  };
}

// Custom replacer for JSON.stringify to handle BigInt
function replacer(key, value) {
  if (typeof value === 'bigint') {
    return value.toString(); // Convert BigInt to string
  }
  return value;
}


// --- Update Logic ---

async function handleUpdateRequest(env, corsHeaders = {}) {
  const currentTime = Date.now();

  if (currentTime - lastProcessedRequestTime < REQUEST_DEDUPLICATION_WINDOW) {
    return new Response(JSON.stringify({ status: 'skipped', message: 'Duplicate request' }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }
  lastProcessedRequestTime = currentTime;

  // Check for cooldown using the cached state 
  const fullState = await getFullState(env);

  if (fullState.lastUpdateTimestamp && (currentTime - fullState.lastUpdateTimestamp < UPDATE_COOLDOWN)) {
    return new Response(JSON.stringify({
      status: 'skipped',
      message: 'Update cooldown active',
      nextUpdateAllowed: new Date(fullState.lastUpdateTimestamp + UPDATE_COOLDOWN).toISOString()
    }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }

  // For explicit update, update the local timestamp
  if (!localUpdateTimestamp) {
    localUpdateTimestamp = 0;
  }
  localUpdateTimestamp = currentTime;

  try {
    console.log("Starting manual state update...");
    const updateResult = await updateState(env, fullState);
    console.log("Manual state update finished.", updateResult);

    return new Response(JSON.stringify({ status: 'success', message: 'State updated', ...updateResult }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  } catch (error) {
     console.error("Error during manual update request:", error);
     return new Response(JSON.stringify({ status: 'error', message: error.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }
}

async function processScheduledUpdate(env) {
  console.log("Starting scheduled state update...");
  const fullState = await getFullState(env); // Fetch latest state
  const updateResult = await updateState(env, fullState);
  console.log("Scheduled state update finished.", updateResult);
}


async function updateState(env, fullState) {
  // Ensure fullState has necessary fields initialized
  if (!fullState) {
      console.error("updateState called with null or undefined fullState. Initializing.");
      fullState = initializeFullState();
  }
  fullState.lastProcessedBlock = fullState.lastProcessedBlock ?? (OPTION_BOOK_DEPLOY_BLOCK - 1);
  fullState.indexedOptionBookAddress = fullState.indexedOptionBookAddress ?? OPTION_BOOK_ADDRESS.toLowerCase();


  const results = {
    startBlock: fullState.lastProcessedBlock + 1,
    endBlock: 0,
    processedEvents: 0,
    newPositions: 0,
    updatedPositions: 0,
    errors: []
  };

  try {
    // --- Add Configuration Change Check ---
    const currentOptionBookAddress = OPTION_BOOK_ADDRESS.toLowerCase();
    if (!fullState.indexedOptionBookAddress || fullState.indexedOptionBookAddress !== currentOptionBookAddress) {
      console.warn(`OptionBook address configuration changed.`);
      console.log(` Previously indexed: ${fullState.indexedOptionBookAddress}`);
      console.log(` Currently configured: ${currentOptionBookAddress}`);
      console.log(` Resetting lastProcessedBlock from ${fullState.lastProcessedBlock} to ${OPTION_BOOK_DEPLOY_BLOCK - 1}`);

      fullState.lastProcessedBlock = OPTION_BOOK_DEPLOY_BLOCK - 1;
      fullState.indexedOptionBookAddress = currentOptionBookAddress; // Update the state to reflect the new address

      // Adjust the starting block for this run's results reporting
      results.startBlock = fullState.lastProcessedBlock + 1;

      console.log(`Reprocessing will start from block ${results.startBlock} using the new OptionBook address.`);
    }
    // --- End Configuration Change Check ---


    const currentBlock = await getCurrentBlockNumber(env);
    results.endBlock = currentBlock;
    let fromBlock = fullState.lastProcessedBlock + 1;

    if (fromBlock > currentBlock) {
      console.log(`Already up to date. Last processed: ${fullState.lastProcessedBlock}, Current: ${currentBlock}`);
       fullState.lastUpdateTimestamp = Date.now(); // Update timestamp even if no blocks processed
       // No need to save if nothing changed, but update cache timestamp
       cachedFullState = fullState; // Ensure cache has the potentially updated indexedOptionBookAddress
       cachedStateTimestamp = fullState.lastUpdateTimestamp;
       // Save state even if up-to-date, in case indexedOptionBookAddress was updated
       await KV_STORAGE.put('fullState', JSON.stringify(fullState, replacer));
      return { message: "Already up to date.", ...results };
    }

    // Process in batches
    while (fromBlock <= currentBlock) {
      const toBlock = Math.min(fromBlock + BATCH_SIZE -1, currentBlock);
      console.log(`Processing blocks ${fromBlock} to ${toBlock} (Current: ${currentBlock})`);

      try {
        // Fetch all relevant logs in the batch
        // 1. OptionBook events (using the CURRENT configured address)
        const optionBookLogs = await fetchLogs(OPTION_BOOK_ADDRESS, fromBlock, toBlock, [], env);

        // 2. BaseOption events (globally, filtered by topics)
        const baseOptionTopics = [];
        
        // Check if EventParser.eventHashes exists before trying to use it
        if (!(EventParser && EventParser.eventHashes)) {
          await EventParser.init(env);
        }

        // Create an array of topic[0] hashes for all relevant BaseOption events
        baseOptionTopics.push(
            Object.values(EventParser.eventHashes).filter(hash =>
                hash !== EventParser.eventHashes.OrderFilled &&
                hash !== EventParser.eventHashes.OrderCancelled
            )
          );

        // Fetch logs emitted by ANY address, but matching specific event signatures
        const baseOptionLogs = await fetchLogs(null, fromBlock, toBlock, baseOptionTopics, env);

        // Combine and sort logs (important for processing order)
        const allLogs = [...optionBookLogs, ...baseOptionLogs];
        allLogs.sort((a, b) => {
          const blockDiff = parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16);
          if (blockDiff !== 0) return blockDiff;
          return parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16); // Sort by log index within block
        });

        // Process logs
        for (const log of allLogs) {
          const parsed = EventParser.parseLog(log, env);
          if (parsed) {
            processEvent(fullState, parsed, log, results); // Pass results to track changes
            results.processedEvents++;
          }
        }

        // Update last processed block *after* successfully processing the batch
        fullState.lastProcessedBlock = toBlock;

      } catch (batchError) {
        console.error(`Error processing batch ${fromBlock}-${toBlock}:`, batchError);
        results.errors.push(`Batch ${fromBlock}-${toBlock}: ${batchError.message}`);
        // Decide on error strategy: stop, skip batch, retry?
        // For simplicity, we stop processing further batches on error.
        throw batchError; // Rethrow to be caught by the main try/catch
      }

      fromBlock = toBlock + 1;
    }

    if (results.updatedPositions > 0) {
      // Reset the scoreboard cache to force regeneration on next request
      cachedScoreboard = {
        all: null,
        past_week: null
      };
      cachedScoreboardSettledCount = 0;
    }

    // Final save state
    fullState.lastUpdateTimestamp = Date.now();
    await KV_STORAGE.put('fullState', JSON.stringify(fullState, replacer)); // State now includes the potentially updated address

    // Update cache
    cachedFullState = fullState;
    cachedStateTimestamp = fullState.lastUpdateTimestamp;

    console.log(`Update complete. Processed up to block ${fullState.lastProcessedBlock}. Events: ${results.processedEvents}`);
    return results;

  } catch (error) {
    console.error('Failed to update state:', error);
    // Don't update timestamp or lastProcessedBlock on failure
    // Consider logging the error state for debugging
    results.errors.push(`Overall update failed: ${error.message}`);
    // DO NOT save state on error to avoid persisting a potentially bad state,
    // UNLESS the error happened *after* successfully updating indexedOptionBookAddress.
    // For simplicity, we don't save on error here. The config change will be re-detected on the next run.
    throw error; // Re-throw so the caller knows it failed
  }
}

// --- Event Processing Logic ---

function processEvent(state, parsedEvent, log, results) {
  const { name, args } = parsedEvent;
  const timestamp = Math.floor(Date.now() / 1000); // Approximate timestamp, block timestamp not easily available without extra calls
  const txHash = log.transactionHash;
  const blockNumber = parseInt(log.blockNumber, 16); // Get block number from log
  
  // NEW: Store the event in the events collection
  // For OrderFilled and OptionInitialized, use the option address from the event
  // For other events, use the event's address itself
  let optionAddress;
  if (name === 'OrderFilled') {
    optionAddress = args.optionAddress.toLowerCase();
  } else if (name === 'OptionInitialized') {
    optionAddress = args.optionAddress.toLowerCase();
  } else if (args.optionAddress) {
    optionAddress = args.optionAddress.toLowerCase();
  } else if (log.address) {
    optionAddress = log.address.toLowerCase();
  }
  
  if (optionAddress) {
    if (!state.events[optionAddress]) {
      state.events[optionAddress] = [];
    }
    
    // Store the essential info for debugging
    state.events[optionAddress].push({
      name,
      blockNumber,
      txHash,
      logIndex: parseInt(log.logIndex, 16),
      timestamp,
      args: JSON.parse(JSON.stringify(args, replacer)), // Use replacer to handle BigNumbers
    });
    
    // Sort events by block and log index to ensure order
    state.events[optionAddress].sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
      return a.logIndex - b.logIndex;
    });
  }

  try {
      // Process OrderFilled events first since they contain premium information
      if (name === 'OrderFilled') {
        handleOrderFilled(state, args, timestamp, txHash, blockNumber, results);
      } 
      // Then process other events
      else if (name === 'OptionInitialized') {
        handleOptionInitialized(state, args, timestamp, txHash, blockNumber, results);
      }
      else if (name === 'RoleTransferred') {
        handleRoleTransferred(state, args, timestamp, txHash, blockNumber, results);
      }
      else if (name === 'OptionExpired' || name === 'OptionPayout' || name === 'CollateralReturned') {
        handleSettlementEvent(state, name, args, timestamp, txHash, blockNumber, results);
      }
      else if (name === 'OptionClosed') {
        handleOptionClosed(state, args, timestamp, txHash, blockNumber, results);
      }
      else if (name === 'OrderCancelled') {
        // Handle order cancelled if needed
      }
  } catch (processingError) {
       console.error(`Error processing ${name} event (Tx: ${txHash}, LogIndex: ${log.logIndex}):`, processingError, args);
       results.errors.push(`Event ${name} (Tx: ${txHash}): ${processingError.message}`);
  }
}

function handleOrderFilled(state, args, timestamp, txHash, blockNumber, results) {
  const { buyer, seller, optionAddress, premiumAmount, feeCollected } = args;
  const lowerOptionAddress = optionAddress.toLowerCase(); // Ensure consistent casing

  // Create a preliminary position entry or update existing
  if (!state.positions[lowerOptionAddress]) {
    state.positions[lowerOptionAddress] = {
      address: lowerOptionAddress,
      status: 'pending_init', // Mark as waiting for OptionInitialized
      entryTimestamp: timestamp,
      entryTxHash: txHash,
      entryBlock: blockNumber,
      // Store data from this event
      orderFilledData: {
        buyer: buyer.toLowerCase(),
        seller: seller.toLowerCase(),
        premiumAmount: premiumAmount.toString(),
        feeCollected: feeCollected.toString(),
        sellerWasMaker: args.sellerWasMaker
      },
      // Placeholders for data from OptionInitialized
      initializedData: null,
      // Placeholders for settlement data
      settlementData: null,
      closeData: null,
    };
    results.newPositions = (results.newPositions || 0) + 1;

    // Add to user's open list (preliminarily)
    addUserPosition(state, buyer.toLowerCase(), lowerOptionAddress, 'open');
    addUserPosition(state, seller.toLowerCase(), lowerOptionAddress, 'open');

  } else {
    // Position already exists - might have been created by OptionInitialized first
    console.log(`OrderFilled for existing position ${lowerOptionAddress}. Updating premium information.`);
    
    // Update the order data
    state.positions[lowerOptionAddress].orderFilledData = {
      buyer: buyer.toLowerCase(),
      seller: seller.toLowerCase(),
      premiumAmount: premiumAmount.toString(),
      feeCollected: feeCollected.toString(),
      sellerWasMaker: args.sellerWasMaker
    };
    
    // If this came after OptionInitialized, status might already be 'open'
    // Set entry timestamp to the earlier of the two events if they're different
    if (timestamp < state.positions[lowerOptionAddress].entryTimestamp) {
      state.positions[lowerOptionAddress].entryTimestamp = timestamp;
      state.positions[lowerOptionAddress].entryTxHash = txHash;
      state.positions[lowerOptionAddress].entryBlock = blockNumber;
    }
    
    results.updatedPositions = (results.updatedPositions || 0) + 1;
  }
}

function handleOptionInitialized(state, args, timestamp, txHash, blockNumber, results) {
  const {
    optionAddress, // This is the emitting address from the parser
    buyer, seller, createdBy, optionType, collateralToken,
    priceFeed, strikes, expiryTimestamp, numContracts, collateralAmount
  } = args;
  const lowerOptionAddress = optionAddress.toLowerCase();
  
  console.log(`OptionInitialized received for ${lowerOptionAddress}`, {
    buyer: buyer.toLowerCase(),
    seller: seller.toLowerCase(),
    existingPosition: state.positions[lowerOptionAddress] ? state.positions[lowerOptionAddress].status : 'none'
  });

  if (state.positions[lowerOptionAddress]) {
    // Update the existing preliminary entry
    const position = state.positions[lowerOptionAddress];

    // Verify consistency (optional but good practice)
    if (position.orderFilledData?.buyer !== buyer.toLowerCase() || position.orderFilledData?.seller !== seller.toLowerCase()) {
      console.warn(`Buyer/Seller mismatch between OrderFilled and OptionInitialized for ${lowerOptionAddress}`);
      console.log('OrderFilled data:', position.orderFilledData);
      console.log('OptionInitialized data:', { buyer: buyer.toLowerCase(), seller: seller.toLowerCase() });
      // Decide how to handle mismatch - log, overwrite, ignore?
    }
    
    if (position.initializedData) {
      console.warn(`OptionInitialized received again for ${lowerOptionAddress}. Ignoring.`);
      return; // Avoid overwriting if already initialized
    }

    position.initializedData = {
        createdBy: createdBy.toLowerCase(),
        optionType: optionType,
        collateralToken: collateralToken.toLowerCase(),
        priceFeed: priceFeed.toLowerCase(),
        strikes: strikes.map(s => s.toString()),
        expiryTimestamp: expiryTimestamp.toNumber(), // Convert BigNumber timestamp to number
        numContracts: numContracts.toString(),
        collateralAmount: collateralAmount.toString()
    };

    // Update status with more logging
    if (position.status === 'pending_init') {
      console.log(`Updating position status from pending_init to open for ${lowerOptionAddress}`);
      position.status = 'open';
      results.updatedPositions = (results.updatedPositions || 0) + 1;
    } else {
      console.log(`Position already in status ${position.status}, not updating for ${lowerOptionAddress}`);
    }
    
    // Add underlying asset and collateral symbol from metadata
    const priceFeedMeta = METADATA.priceFeeds[position.initializedData.priceFeed.toLowerCase()];
    const collateralMeta = METADATA.collaterals[position.initializedData.collateralToken.toLowerCase()];
    position.underlyingAsset = priceFeedMeta ? priceFeedMeta.underlyingAsset : position.initializedData.priceFeed;
    position.collateralSymbol = collateralMeta ? collateralMeta.symbol : position.initializedData.collateralToken;
    position.collateralDecimals = collateralMeta ? collateralMeta.decimals : 18; // Default or error?
  } else {
    // OptionInitialized seen before OrderFilled - CREATE a position in this case
    console.log(`OptionInitialized encountered before OrderFilled for ${lowerOptionAddress}. Creating new position.`);
    
    // Create a new position entry
    state.positions[lowerOptionAddress] = {
      address: lowerOptionAddress,
      status: 'open', // Mark as open since we have initialization data
      entryTimestamp: timestamp,
      entryTxHash: txHash,
      entryBlock: blockNumber,
      // Placeholder for OrderFilled data (may be filled later if that event is processed)
      orderFilledData: null,
      // Store initialization data
      initializedData: {
        createdBy: createdBy.toLowerCase(),
        optionType: optionType,
        collateralToken: collateralToken.toLowerCase(),
        priceFeed: priceFeed.toLowerCase(),
        strikes: strikes.map(s => s.toString()),
        expiryTimestamp: expiryTimestamp.toNumber(),
        numContracts: numContracts.toString(),
        collateralAmount: collateralAmount.toString()
      },
      // Placeholders for settlement data
      settlementData: null,
      closeData: null,
    };
    
    // Add metadata
    const priceFeedMeta = METADATA.priceFeeds[priceFeed.toLowerCase()];
    const collateralMeta = METADATA.collaterals[collateralToken.toLowerCase()];
    state.positions[lowerOptionAddress].underlyingAsset = priceFeedMeta ? priceFeedMeta.underlyingAsset : 'UNKNOWN';
    state.positions[lowerOptionAddress].collateralSymbol = collateralMeta ? collateralMeta.symbol : 'UNKNOWN';
    state.positions[lowerOptionAddress].collateralDecimals = collateralMeta ? collateralMeta.decimals : 18;
    
    results.newPositions = (results.newPositions || 0) + 1;
    
    // Add to user's open positions
    addUserPosition(state, buyer.toLowerCase(), lowerOptionAddress, 'open');
    addUserPosition(state, seller.toLowerCase(), lowerOptionAddress, 'open');
  }
}

function handleRoleTransferred(state, args, timestamp, txHash, blockNumber, results) {
    const { optionAddress, from, to, isBuyer } = args;
    const lowerOptionAddress = optionAddress.toLowerCase();
    const lowerFrom = from.toLowerCase();
    const lowerTo = to.toLowerCase();

    if (state.positions[lowerOptionAddress]) {
        const position = state.positions[lowerOptionAddress];

        // Update buyer/seller in the main position data
        // Use initializedData if available, otherwise orderFilledData
        const currentBuyer = position.initializedData?.buyer || position.orderFilledData?.buyer;
        const currentSeller = position.initializedData?.seller || position.orderFilledData?.seller;
         let roleUpdated = false;

        if (isBuyer && currentBuyer === lowerFrom) {
            if (position.initializedData) position.initializedData.buyer = lowerTo;
            if (position.orderFilledData) position.orderFilledData.buyer = lowerTo; // Keep consistent?
             roleUpdated = true;
        } else if (!isBuyer && currentSeller === lowerFrom) {
            if (position.initializedData) position.initializedData.seller = lowerTo;
            if (position.orderFilledData) position.orderFilledData.seller = lowerTo;
             roleUpdated = true;
        } else {
            console.warn(`RoleTransferred 'from' mismatch or role inconsistency for ${lowerOptionAddress}. From: ${lowerFrom}, IsBuyer: ${isBuyer}`);
             // Potentially log expected vs actual 'from'
        }

        if (roleUpdated) {
             // Determine the correct list type based on position status
             const listType = (position.status === 'open' || position.status === 'pending_init') ? 'open' : 'history';
             
             // Update userPositions: remove from 'from', add to 'to'
             removeUserPosition(state, lowerFrom, lowerOptionAddress, listType);
             addUserPosition(state, lowerTo, lowerOptionAddress, listType);
             results.updatedPositions = (results.updatedPositions || 0) + 1;

              // Optionally add a transfer history entry within the position object
             if (!position.transferHistory) position.transferHistory = [];
             position.transferHistory.push({ from: lowerFrom, to: lowerTo, isBuyer, timestamp, txHash, blockNumber });
        }

    } else {
        console.warn(`RoleTransferred for unknown optionAddress: ${lowerOptionAddress}`);
    }
}

function handleSettlementEvent(state, eventName, args, timestamp, txHash, blockNumber, results) {
    const { optionAddress } = args; // Common field
    const lowerOptionAddress = optionAddress.toLowerCase();

    if (state.positions[lowerOptionAddress]) {
        const position = state.positions[lowerOptionAddress];

         // Prevent processing settlement events multiple times or on closed options
        if (position.status !== 'open' && position.status !== 'pending_init') {
             // Allow adding more settlement data even if already 'settled', but not if 'closed'/'transferred' fully?
             // For simplicity, let's allow updates if status is 'settled' but log if status is 'closed'
             if (position.status === 'closed') {
                 console.warn(`Settlement event ${eventName} received for already closed option ${lowerOptionAddress}`);
                 // return; // Maybe skip processing if fully closed?
             }
        }


        if (!position.settlementData) {
            position.settlementData = {};
        }
        let wasUpdated = false;

        switch (eventName) {
            case 'OptionExpired':
                if (!position.settlementData.settlementPrice) {
                    position.settlementData.settlementPrice = args.settlementPrice.toString();
                     wasUpdated = true;
                }
                 position.settlementData.expiryTimestamp = position.initializedData?.expiryTimestamp || args.timestamp?.toNumber() || timestamp; // Use actual expiry if available
                break;
            case 'OptionPayout':
                 // Allow multiple payouts? Or just the final one? Assume final for now.
                 if (!position.settlementData.payoutBuyer) {
                     position.settlementData.payoutBuyer = args.amountPaidOut.toString();
                     wasUpdated = true;
                 }
                break;
            case 'CollateralReturned':
                 if (!position.settlementData.collateralReturnedSeller) {
                     position.settlementData.collateralReturnedSeller = args.amountReturned.toString();
                     wasUpdated = true;
                 }
                break;
        }

        // If this is the first settlement event received, or if significant data added, mark as settled
        if (position.status === 'open' || position.status === 'pending_init') {
             position.status = 'settled';
             position.closeTimestamp = timestamp; // Mark time of first settlement event as close time
             position.closeTxHash = txHash; // Mark tx hash of first settlement event
             position.closeBlock = blockNumber;
             
             // Move from open to history for users
             const buyer = position.initializedData?.buyer || position.orderFilledData?.buyer;
             const seller = position.initializedData?.seller || position.orderFilledData?.seller;
             if (buyer) moveUserPosition(state, buyer, lowerOptionAddress, 'open', 'history');
             if (seller) moveUserPosition(state, seller, lowerOptionAddress, 'open', 'history');
             
             // Update daily metrics for the buyer when position is settled
             if (buyer && position.initializedData?.expiryTimestamp) {
                 const profitUSD = calculatePositionProfitUSD(position);
                 if (profitUSD !== null) {
                     updateUserDailyMetrics(state, buyer, position.initializedData.expiryTimestamp, profitUSD);
                     
                     // Track profitable trades for marketing
                     if (profitUSD > 0) {
                         addProfitableTrade(state, position, buyer, profitUSD, timestamp);
                     }
                 }
             }
             
             wasUpdated = true; // Ensure update is counted
        }

         if (wasUpdated) {
             results.updatedPositions = (results.updatedPositions || 0) + 1;
         }

    } else {
        console.warn(`Settlement event ${eventName} for unknown optionAddress: ${lowerOptionAddress}`);
    }
}


function handleOptionClosed(state, args, timestamp, txHash, blockNumber, results) {
    const { optionAddress, closedBy, collateralReturned } = args;
    const lowerOptionAddress = optionAddress.toLowerCase();

    if (state.positions[lowerOptionAddress]) {
        const position = state.positions[lowerOptionAddress];

        if (position.status === 'closed') {
            console.warn(`OptionClosed received again for ${lowerOptionAddress}. Ignoring.`);
            return;
        }

        const oldStatus = position.status; // Remember old status ('open' or 'settled')

        position.status = 'closed';
        position.closeTimestamp = timestamp;
        position.closeTxHash = txHash;
         position.closeBlock = blockNumber;
        position.closeData = { // Store specific close info
            closedBy: closedBy.toLowerCase(),
            collateralReturned: collateralReturned.toString()
        };
         results.updatedPositions = (results.updatedPositions || 0) + 1;

        // Move from open/settled to history
        const user = closedBy.toLowerCase(); // Only the closer is relevant now
        // If it was already settled, it might already be in history. If open, move it.
        if (oldStatus === 'open' || oldStatus === 'pending_init') {
             moveUserPosition(state, user, lowerOptionAddress, 'open', 'history');
             // If buyer/seller were different, should we remove from their 'open' list too?
             const buyer = position.initializedData?.buyer || position.orderFilledData?.buyer;
             const seller = position.initializedData?.seller || position.orderFilledData?.seller;
             if (buyer && buyer !== user) removeUserPosition(state, buyer, lowerOptionAddress, 'open');
             if (seller && seller !== user) removeUserPosition(state, seller, lowerOptionAddress, 'open');

        } else if (oldStatus === 'settled') {
             // It might already be in history, ensure it is.
              addUserPosition(state, user, lowerOptionAddress, 'history'); // Ensures it's in the closer's history
             // If buyer/seller different, ensure it's in their history too? Or just closer?
             // Let's assume settlement already moved buyer/seller to history.
        }


    } else {
        console.warn(`OptionClosed for unknown optionAddress: ${lowerOptionAddress}`);
    }
}


// --- User Position Helpers ---

function ensureUser(state, userAddress) {
    if (!state.userPositions[userAddress]) {
        state.userPositions[userAddress] = { open: [], history: [] };
    }
}

function addUserPosition(state, userAddress, optionAddress, listType) { // listType: 'open' or 'history'
    ensureUser(state, userAddress);
    const list = state.userPositions[userAddress][listType];
    if (!list.includes(optionAddress)) {
        list.push(optionAddress);
    }
}

function removeUserPosition(state, userAddress, optionAddress, listType) {
    if (state.userPositions[userAddress]) {
        const list = state.userPositions[userAddress][listType];
        if (list && Array.isArray(list)) {
            const index = list.indexOf(optionAddress);
            if (index > -1) {
                list.splice(index, 1);
            }
        } else {
            console.warn(`Invalid list type "${listType}" for user ${userAddress}. Expected 'open' or 'history'.`);
        }
    }
}

function moveUserPosition(state, userAddress, optionAddress, fromList, toList) {
    removeUserPosition(state, userAddress, optionAddress, fromList);
    addUserPosition(state, userAddress, optionAddress, toList);
}


// --- API Endpoint Handlers ---

/**
 * Handle a request for user streak statistics
 */
async function handleUserStreaksRequest(userAddress, corsHeaders, env) {
  if (!userAddress || !/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
    return new Response(JSON.stringify({ error: 'Invalid user address format' }), 
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
  }
  
  try {
    const fullState = await getFullState(env);
    
    // Check if daily metrics need to be rebuilt (first time or after reset) 
    const needsMetricsRebuild = !fullState.userDailyMetrics || Object.keys(fullState.userDailyMetrics).length === 0;
    const needsTradesRebuild = !fullState.topProfitableTrades || fullState.topProfitableTrades.length === 0;
    
    if (needsMetricsRebuild || needsTradesRebuild) {
      console.log(`Rebuilding needed for streaks - metrics: ${needsMetricsRebuild}, trades: ${needsTradesRebuild}`);
      
      if (needsMetricsRebuild && needsTradesRebuild) {
        // Both need rebuilding - use the full rebuild
        rebuildAllDailyMetrics(fullState);
      } else if (needsMetricsRebuild) {
        // Only metrics need rebuilding - preserve existing profitable trades
        rebuildDailyMetricsOnly(fullState);
      } else if (needsTradesRebuild) {
        // Only profitable trades need rebuilding - preserve existing daily metrics
        rebuildProfitableTradesOnly(fullState);
      }
    }
    
    const userDailyMetrics = fullState.userDailyMetrics[userAddress] || {};
    
    // Calculate streaks for both periods
    const allTimeStreaks = calculateStreakStats(userDailyMetrics, null);
    const weeklyStreaks = calculateStreakStats(userDailyMetrics, 7);
    
    return new Response(JSON.stringify({
      address: userAddress,
      dailyMetrics: userDailyMetrics,
      streaks: {
        allTime: allTimeStreaks,
        pastWeek: weeklyStreaks
      }
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (error) {
    console.error(`Error fetching user streaks for ${userAddress}:`, error);
    return new Response(JSON.stringify({
      error: `Failed to fetch user streaks`,
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

/**
 * Handle a request to rebuild daily metrics
 */
async function handleRebuildMetricsRequest(corsHeaders, env) {
  try {
    const fullState = await getFullState(env);
    
    console.log("Rebuilding daily metrics...");
    rebuildAllDailyMetrics(fullState);
    
    // Save the updated state
    await KV_STORAGE.put('fullState', JSON.stringify(fullState, replacer));
    // Update cache
    cachedFullState = fullState;
    cachedStateTimestamp = Date.now();
    
    // Reset scoreboard cache to force regeneration
    cachedScoreboard = {
      all: null,
      past_week: null
    };
    cachedScoreboardSettledCount = 0;
    
    return new Response(JSON.stringify({
      status: 'success',
      message: 'Daily metrics rebuilt successfully',
      userCount: Object.keys(fullState.userDailyMetrics).length,
      totalDays: Object.values(fullState.userDailyMetrics).reduce((total, userMetrics) => 
        total + Object.keys(userMetrics).length, 0),
      profitableTradesCount: fullState.topProfitableTrades ? fullState.topProfitableTrades.length : 0
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (error) {
    console.error('Error rebuilding daily metrics:', error);
    return new Response(JSON.stringify({
      status: 'error',
      message: `Error rebuilding daily metrics: ${error.message}`
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

async function handleUserDataRequest(userAddress, dataType, corsHeaders, env) {
  if (!userAddress || !['positions', 'history'].includes(dataType)) {
      return new Response(JSON.stringify({ error: 'Invalid request parameters' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
  }
  // Basic address validation (doesn't check checksum)
   if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
        return new Response(JSON.stringify({ error: 'Invalid user address format' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
   }


  const fullState = await getFullState(env);
  const userLists = fullState.userPositions[userAddress];
  const listType = dataType === 'positions' ? 'open' : 'history';
  const positionAddresses = userLists ? userLists[listType] : [];

  const positionsData = positionAddresses
      .map(addr => fullState.positions[addr])
      .filter(pos => pos && pos.orderFilledData && pos.initializedData); // Only include positions with both orderFilledData and initializedData

  // Format the response data
  const formattedPositions = await Promise.all(positionsData.map(formatPositionData));

  return new Response(JSON.stringify(formattedPositions), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

async function handleStatsRequest(corsHeaders, env) {
     const fullState = await getFullState(env);
     const positions = Object.values(fullState.positions);

     const stats = {
          totalOptionsTracked: positions.length,
          openPositions: positions.filter(p => p.status === 'open' || p.status === 'pending_init').length,
          settledPositions: positions.filter(p => p.status === 'settled').length,
          closedPositions: positions.filter(p => p.status === 'closed').length,
          uniqueUsers: Object.keys(fullState.userPositions).length,
          lastProcessedBlock: fullState.lastProcessedBlock,
          lastUpdateTimestamp: fullState.lastUpdateTimestamp,
          // Add more stats: total premium, total fees, volume by asset etc.
          // Requires iterating and summing BigNumber values carefully
     };

     return new Response(JSON.stringify(stats), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
}


// --- Data Formatting ---
async function formatPositionData(position) {
    if (!position) return null;

    const initialized = position.initializedData;
    const filled = position.orderFilledData;
    const settlement = position.settlementData;
    const closeInfo = position.closeData;

    // Basic details always present (or should be after init)
    let formatted = {
        address: position.address,
        status: position.status,
        entryTimestamp: position.entryTimestamp,
        entryTxHash: position.entryTxHash,
        entryBlock: position.entryBlock,
        closeTimestamp: position.closeTimestamp || null,
        closeTxHash: position.closeTxHash || null,
        closeBlock: position.closeBlock || null,
        buyer: initialized?.buyer || filled?.buyer || 'N/A',
        seller: initialized?.seller || filled?.seller || 'N/A',
        entryPremium: filled?.premiumAmount || '0', // Cost basis for buyer, revenue for seller (before fees)
        entryFeePaid: filled?.feeCollected || '0', // Fee paid by the buyer (long holder)
    };

    // Add details from initialization
    if (initialized) {
        formatted = {
            ...formatted,
            createdBy: initialized.createdBy,
            optionTypeRaw: initialized.optionType,
            collateralToken: initialized.collateralToken,
            priceFeed: initialized.priceFeed,
            strikes: initialized.strikes,
            expiryTimestamp: initialized.expiryTimestamp,
            numContracts: initialized.numContracts,
            collateralAmount: initialized.collateralAmount,
             // Add enriched data from metadata
            underlyingAsset: position.underlyingAsset || 'UNKNOWN',
            collateralSymbol: position.collateralSymbol || 'UNKNOWN',
            collateralDecimals: position.collateralDecimals !== undefined ? position.collateralDecimals : null,
            optionType: initialized.optionType,
        };
    } else {
         // Add placeholders if not initialized yet
         formatted = { ...formatted, numContracts: 'N/A', strikes: [], expiryTimestamp: 0 };
    } 

    // Add details from settlement
    if (settlement) {
        formatted.settlement = {
            settlementPrice: settlement.settlementPrice || null,
            payoutBuyer: settlement.payoutBuyer || null,
            collateralReturnedSeller: settlement.collateralReturnedSeller || null,
        };
    } else {
        formatted.settlement = {
          settlementPrice: null,
          payoutBuyer: null,
          collateralReturnedSeller: null,
        };

        if (initialized && initialized.expiryTimestamp) {
          const currentTime = Math.floor(Date.now() / 1000);
          const isExpired = initialized.expiryTimestamp < currentTime;
          if (isExpired) {
            formatted.settlement.settlementPrice = await rpcCall(position.address, '0x05ecd003'); // getTWAP()
          }
        }
    }

    // Add details from explicit close
    if (closeInfo) {
         formatted.explicitClose = {
            closedBy: closeInfo.closedBy,
            collateralReturned: closeInfo.collateralReturned,
         };
    } else {
        formatted.explicitClose = null;
    }

    // Add PNL calculation (example - needs careful BigNumber math)
    // PNL depends on whether the user we query for is the buyer or seller
    // This generic formatter doesn't know the user context, so PNL might be better calculated client-side
    // or in the API handler if user context is passed.

    return formatted;
}


// --- RPC Interaction ---

async function fetchLogs(address, fromBlock, toBlock, topics = [], env) {
  const infuraEndpoint = `https://rpc.ankr.com/base/b265bc0484761da3baea12fcc955e9bb10545e664b75976d20c8089c163b0a53`;
  
  // Create the params object for the request
  const params = {
    fromBlock: '0x' + fromBlock.toString(16),
    toBlock: '0x' + toBlock.toString(16),
    topics: topics.length > 0 ? topics : undefined
  };
  
  // Only add address if it's provided (for filtering by specific contract)
  if (address) {
    params.address = address;
  }
  
  const response = await fetch(infuraEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getLogs',
      params: [params]
    })
  });
  
  const data = await response.json();
  
  if (data.error) {
    throw new Error(`Infura error: ${data.error.message}`);
  }
  
  return data.result;
}

async function getCurrentBlockNumber(env) {
  const infuraEndpoint = `https://rpc.ankr.com/base/b265bc0484761da3baea12fcc955e9bb10545e664b75976d20c8089c163b0a53`;
  
  const response = await fetch(infuraEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_blockNumber',
      params: []
    })
  });
  
  const data = await response.json();
  
  if (data.error) {
    throw new Error(`Infura error: ${data.error.message}`);
  }
  
  return parseInt(data.result, 16);
}

/**
 * Handle a request to clear all caches and start fresh
 */
async function handleClearCacheRequest(env, corsHeaders = {}) {
  try {
    // Clear in-memory cache
    cachedFullState = null;
    cachedStateTimestamp = 0;

    // Also clear scoreboard cache
    cachedScoreboard = {
      all: null,
      past_week: null
    };
    cachedScoreboardSettledCount = 0;
    
    // Delete from KV storage
    await KV_STORAGE.delete('fullState');
    
    // Initialize a new empty state
    const freshState = initializeFullState();
    
    // Save the fresh state
    await KV_STORAGE.put('fullState', JSON.stringify(freshState, replacer));
    
    return new Response(JSON.stringify({
      status: 'success',
      message: 'Cache cleared successfully. All data will be reprocessed from scratch.'
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      status: 'error',
      message: `Failed to clear cache: ${error.message}`
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

async function handleOptionEventsRequest(optionAddress, corsHeaders, env) {
  if (!optionAddress || !/^0x[a-fA-F0-9]{40}$/.test(optionAddress)) {
    return new Response(JSON.stringify({ error: 'Invalid option address format' }), 
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
  }
  
  const fullState = await getFullState(env);
  const events = fullState.events[optionAddress] || [];
  const position = fullState.positions[optionAddress] || null;
  
  return new Response(JSON.stringify({
    address: optionAddress,
    position: position ? await formatPositionData(position) : null,
    events: events,
    eventCount: events.length
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

/**
 * Make an RPC call to a contract method
 * @param {string} contractAddress - The address of the contract to call
 * @param {string} methodSignature - The function signature (4 bytes)
 * @param {string[]} args - Optional function arguments (not used for getTWAP)
 * @returns {Promise<string>} - The result as a string
 */
async function rpcCall(contractAddress, methodSignature, args = []) {
  const infuraEndpoint = `https://rpc.ankr.com/base/b265bc0484761da3baea12fcc955e9bb10545e664b75976d20c8089c163b0a53`;
  
  // For getTWAP, we don't need to encode additional arguments
  // If args are needed in future, additional encoding would be done here
  const data = methodSignature; // For simple no-argument calls
  
  const response = await fetch(infuraEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{
        to: contractAddress,
        data: data
      }, 'latest']
    })
  });
  
  const result = await response.json();
  
  if (result.error) {
    console.error(`RPC call error for ${contractAddress}:`, result.error);
    return null;
  }
  
  // For getTWAP which returns a uint256, decode the hex value
  if (result.result && result.result.startsWith('0x')) {
    try {
      return new BigNumber(result.result).toString();
    } catch (err) {
      console.error(`Error decoding result from ${contractAddress}:`, err);
      return null;
    }
  }
  
  return null;
}

/**
 * Check if update is needed and trigger it in the background if so
 * @param {Object} env - Environment object
 * @param {FetchEvent} event - Fetch event to attach waitUntil
 * @returns {Promise<boolean>} - Whether an update was triggered
 */
async function triggerBackgroundUpdateIfNeeded(env, event) {
  const currentTime = Date.now();
  console.log("Entering triggerBackgroundUpdateIfNeeded");
  
  // Log event object to check if it's properly passed
  console.log("Event object available:", !!event);
  console.log("Event waitUntil available:", !!(event && event.waitUntil));
  
  // Skip if this worker instance has updated recently (instance-level cooldown)
  // We store this in a variable attached to the env object which persists during the worker's lifetime
  if (!localUpdateTimestamp) {
    console.log("Initializing LOCAL_UPDATE_TIMESTAMP to 0");
    localUpdateTimestamp = 0; // Initialize if it doesn't exist
  } else {
    console.log("LOCAL_UPDATE_TIMESTAMP already exists:", localUpdateTimestamp);
    console.log("Time since last local update:", currentTime - localUpdateTimestamp, "ms");
  }
  
  if (currentTime - localUpdateTimestamp < UPDATE_COOLDOWN) {
    console.log("Local update cooldown still active. Skipping update.");
    console.log("Time remaining:", UPDATE_COOLDOWN - (currentTime - localUpdateTimestamp), "ms");
    return false;
  }
  
  console.log("Local cooldown passed, checking global state...");
  
  // Get the current state to check global cooldown
  const fullState = await getFullState(env);
  
  // Log state details
  console.log("Last global update timestamp:", fullState.lastUpdateTimestamp || "never");
  if (fullState.lastUpdateTimestamp) {
    console.log("Time since last global update:", currentTime - fullState.lastUpdateTimestamp, "ms");
    console.log("Global cooldown period:", UPDATE_COOLDOWN, "ms");
  }
  
  // Skip if global state was updated recently
  if (fullState.lastUpdateTimestamp && (currentTime - fullState.lastUpdateTimestamp < UPDATE_COOLDOWN)) {
    console.log("Global update cooldown still active. Skipping update.");
    console.log("Time remaining:", UPDATE_COOLDOWN - (currentTime - fullState.lastUpdateTimestamp), "ms");
    return false;
  }
  
  console.log("Global cooldown passed. Proceeding with update...");
  
  // We've passed all checks - update the local timestamp immediately to prevent other
  // API calls in this worker from starting an update
  console.log("Setting LOCAL_UPDATE_TIMESTAMP to current time:", currentTime);
  localUpdateTimestamp = currentTime;
  
  try {
    // Verify we have event.waitUntil before using it
    if (!event || typeof event.waitUntil !== 'function') {
      console.error("Cannot start background update: event.waitUntil is not a function");
      console.log("Event object:", JSON.stringify(event, (key, value) => {
        if (typeof value === 'function') return 'function';
        return value;
      }));
      return false;
    }
    
    console.log("Starting waitUntil for background update...");
    
    // Fire the update in the background
    event.waitUntil((async () => {
      try {
        console.log('Background update process started');
        const updateResult = await updateState(env, fullState);
        console.log('Background state update finished:', updateResult);
      } catch (error) {
        console.error('Background update failed:', error);
      }
    })());
    
    console.log("Background update successfully queued");
    return true;
  } catch (error) {
    console.error("Error setting up background update:", error);
    return false;
  }
}

// Replace the existing cache variable with a structure that holds both periods
let cachedScoreboard = {
  all: null,
  past_week: null
};
let cachedScoreboardSettledCount = 0;

async function handleScoreboardRequest(corsHeaders, env) {
  // Get the current state
  const fullState = await getFullState(env);
  
  // Check if daily metrics need to be rebuilt (first time or after reset)
  const needsMetricsRebuild = !fullState.userDailyMetrics || Object.keys(fullState.userDailyMetrics).length === 0;
  const needsTradesRebuild = !fullState.topProfitableTrades || fullState.topProfitableTrades.length === 0;
  
  if (needsMetricsRebuild || needsTradesRebuild) {
    console.log(`Rebuilding needed - metrics: ${needsMetricsRebuild}, trades: ${needsTradesRebuild}`);
    
    if (needsMetricsRebuild && needsTradesRebuild) {
      // Both need rebuilding - use the full rebuild
      rebuildAllDailyMetrics(fullState);
    } else if (needsMetricsRebuild) {
      // Only metrics need rebuilding - preserve existing profitable trades
      rebuildDailyMetricsOnly(fullState);
    } else if (needsTradesRebuild) {
      // Only profitable trades need rebuilding - preserve existing daily metrics
      rebuildProfitableTradesOnly(fullState);
    }
    
    // Save the updated state
    await KV_STORAGE.put('fullState', JSON.stringify(fullState, replacer));
    // Update cache
    cachedFullState = fullState;
    cachedStateTimestamp = Date.now();
  }
  
  // Count the current number of settled positions
  const currentSettledCount = Object.values(fullState.positions)
    .filter(position => (position.status === 'settled' || position.status === 'closed') && position.settlementData)
    .length;
  
  // Check if we have valid caches with matching settled count
  const validCache = cachedScoreboard && currentSettledCount === cachedScoreboardSettledCount 
                   && cachedScoreboard.all && cachedScoreboard.past_week;
  
  if (validCache) {
    console.log(`Using cached scoreboards (${currentSettledCount} settled positions)`);
    // Return both all-time and weekly data in one response
    return new Response(JSON.stringify({
      all: cachedScoreboard.all,
      past_week: cachedScoreboard.past_week
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  console.log(`Regenerating both scoreboards (${currentSettledCount} settled positions)`);

  try {
    // Calculate time filters
    const now = Math.floor(Date.now() / 1000); // Current time in seconds
    const pastWeekCutoff = now - (8 * 24 * 60 * 60); // 8 days ago in seconds
    
    // Generate results for both periods
    const results = {};
    
    // Process for each period ('all' and 'past_week')
    for (const period of ['all', 'past_week']) {
      // Time filter function based on period
      const timeFilter = (period === 'past_week') 
        ? position => position.entryTimestamp >= pastWeekCutoff
        : () => true; // No filter for 'all'
      
      // Aggregate data for all users
      const traderStats = {};
      const totals = {
        premiumPaidUSD: 0,
        profitUSD: 0,
        volumeUSD: 0,
        trades: 0,
        settledTrades: 0
      };
      
      // Process all positions with time filtering
      Object.values(fullState.positions)
        .filter(timeFilter) // Apply time filter
        .forEach(position => {
          // Skip positions without essential data
          if (!position.orderFilledData || !position.initializedData || !position.initializedData.strikes || position.initializedData.strikes.length === 0) {
            return;
          }
          
          const buyer = position.orderFilledData.buyer;
          const isCall = position.initializedData.optionType === 0; // 0 = Call, others are variations of puts
          
          // Initialize trader data if not exists
          if (!traderStats[buyer]) {
            traderStats[buyer] = {
              address: buyer,
              premiumPaidUSD: 0,
              profitUSD: 0,
              volumeUSD: 0,
              numTrades: 0,
              settledTrades: 0
            };
          }
          
          // Get strike price (as reference for asset price)
          let strike = 0;
          try {
            const strikeBN = new BigNumber(position.initializedData.strikes[0]);
            strike = Number(strikeBN.toString()) / Math.pow(10, 8); // Strike in PRICE_DECIMALS (8)
          } catch (e) {
            console.error("Error parsing strike:", e);
            return; // Skip this position if we can't get strike
          }
          
          // Extract number of contracts
          let numContracts = 0;
          try {
            if (position.initializedData.numContracts) {
              const contractsBN = new BigNumber(position.initializedData.numContracts);
              // Convert to standard number (will be decimal for ETH/BTC denominated options)
              numContracts = Number(contractsBN.toString());
            }
          } catch (e) {
            console.error("Error parsing number of contracts:", e);
            return; // Skip if we can't parse contracts
          }
          
          // Parse premium amount
          let premiumAmount;
          try {
            const premiumBN = new BigNumber(position.orderFilledData.premiumAmount);
            premiumAmount = Number(premiumBN.toString());
          } catch (e) {
            console.error("Error parsing premium amount:", e);
            return; // Skip this position if we can't parse premium
          }
          
          // Get collateral details
          const collateralToken = position.initializedData.collateralToken.toLowerCase();
          const collateralDetails = METADATA.collaterals[collateralToken];
          
          if (!collateralDetails) {
            console.warn(`Unknown collateral token: ${collateralToken}`);
            return; // Skip this position
          }
          
          // Convert raw premium to human-readable token amount
          const premiumTokenAmount = premiumAmount / Math.pow(10, collateralDetails.decimals);
          
          // Convert premium to USD based on collateral type
          let premiumUSD = premiumTokenAmount;
          
          // For non-stablecoin collaterals, use strike price to normalize
          if (collateralDetails.symbol === 'WETH') {
            // For ETH-denominated premiums, multiply by price
            premiumUSD = premiumTokenAmount * strike;
          } else if (collateralDetails.symbol === 'CBBTC') {
            // For BTC-denominated premiums, multiply by price
            premiumUSD = premiumTokenAmount * strike;
          }
          // USDC premiums already in USD terms
          
          // Calculate the notional value (contracts × price)
          // Convert contracts to human-readable value based on decimals
          const contractsHumanReadable = numContracts / Math.pow(10, collateralDetails.decimals);
          
          // Use settlement price if available, otherwise use strike
          let priceForNotional = strike;
          if (position.settlementData && position.settlementData.settlementPrice) {
            try {
              const settlementPriceBN = new BigNumber(position.settlementData.settlementPrice);
              priceForNotional = Number(settlementPriceBN.toString()) / Math.pow(10, 8);
            } catch (e) {
              console.error("Error parsing settlement price:", e);
            }
          }
          
          // Calculate volume as notional value
          let volumeUSD = contractsHumanReadable * priceForNotional;
          
          // Log key metrics
          console.log(`Position ${position.address}: Strike $${strike}, Contracts ${contractsHumanReadable}, Notional Volume $${volumeUSD}`);
          
          // Track trade regardless of settlement status
          traderStats[buyer].numTrades += 1;
          traderStats[buyer].premiumPaidUSD += premiumUSD;
          traderStats[buyer].volumeUSD += volumeUSD; // Use notional value for volume
          
          totals.trades += 1;
          totals.premiumPaidUSD += premiumUSD;
          totals.volumeUSD += volumeUSD; // Use notional value for volume
          
          // Only calculate profit for settled or closed positions
          if ((position.status === 'settled' || position.status === 'closed') && position.settlementData) {
            traderStats[buyer].settledTrades += 1;
            totals.settledTrades += 1;
            
            // Use settlement price if available, otherwise use strike
            let settlementPrice = strike; // Default to strike if no settlement price
            if (position.settlementData.settlementPrice) {
              try {
                const settlementPriceBN = new BigNumber(position.settlementData.settlementPrice);
                // Settlement price is in PRICE_DECIMALS (8)
                settlementPrice = Number(settlementPriceBN.toString()) / Math.pow(10, 8);
                console.log(`Position ${position.address}: Settlement price = $${settlementPrice}`);
              } catch (e) {
                console.error("Error parsing settlement price:", e);
              }
            }
            
            // Calculate profit based on option type and settlement data
            let profitUSD = 0;
            
            if (position.settlementData.payoutBuyer) {
              // If there was a payout, we can calculate profit directly
              try {
                const payoutBN = new BigNumber(position.settlementData.payoutBuyer);
                const payoutAmount = Number(payoutBN.toString());
                const payoutTokenAmount = payoutAmount / Math.pow(10, collateralDetails.decimals);
                
                // Convert payout to USD based on token type and settlement price
                let payoutUSD = payoutTokenAmount;
                if (collateralDetails.symbol === 'WETH') {
                  payoutUSD = payoutTokenAmount * settlementPrice;
                } else if (collateralDetails.symbol === 'CBBTC') {
                  payoutUSD = payoutTokenAmount * settlementPrice;
                }
                
                // Profit = payout - premium (in USD)
                profitUSD = payoutUSD - premiumUSD;
                console.log(`Position ${position.address}: Profit = $${profitUSD} (Payout $${payoutUSD} - Premium $${premiumUSD})`);
              } catch (e) {
                console.error("Error calculating payout:", e);
              }
            } else {
              // Option expired worthless (no payout event), loss is the premium
              profitUSD = -premiumUSD;
              
              // Verify using settlement price and strike for sanity check
              const isInTheMoney = isCall ? 
                (settlementPrice > strike) : 
                (settlementPrice < strike);
                
              if (isInTheMoney) {
                console.warn(`Position ${position.address}: Appears in-the-money (${isCall ? 'CALL' : 'PUT'}, Strike: $${strike}, Settlement: $${settlementPrice}) but no payout recorded`);
              } else {
                console.log(`Position ${position.address}: Out-of-money as expected (${isCall ? 'CALL' : 'PUT'}, Strike: $${strike}, Settlement: $${settlementPrice})`);
              }
            }
            
            // Update trader's profit
            traderStats[buyer].profitUSD += profitUSD;
            
            // Track all profits (both positive and negative) for calculations
            if (profitUSD > 0) {
              totals.profitUSD += profitUSD;
            }
          }
        });
      
      // Get array of traders for calculations
      const traderArray = Object.values(traderStats);
      
      // Calculate median premium for premium score component
      const allPremiums = traderArray.map(t => t.premiumPaidUSD);
      allPremiums.sort((a, b) => a - b);
      const medianPremium = allPremiums.length % 2 === 0 
        ? (allPremiums[allPremiums.length/2 - 1] + allPremiums[allPremiums.length/2]) / 2
        : allPremiums[Math.floor(allPremiums.length/2)];
      
      // Find max premium for logging/metrics
      const maxPremium = Math.max(...allPremiums);
      
      // Calculate profit ratios (profit / premium) for each trader
      traderArray.forEach(trader => {
        trader.profitRatio = trader.profitUSD / Math.max(trader.premiumPaidUSD, 0.01);
      });
      
      // Find min and max profit ratios for normalization
      const profitRatios = traderArray.map(t => t.profitRatio);
      const minProfitRatio = Math.min(...profitRatios);
      const maxProfitRatio = Math.max(...profitRatios);
      const profitRatioRange = Math.abs(minProfitRatio) + maxProfitRatio;
      
      console.log(`Scoring metrics - Median Premium: $${medianPremium.toFixed(2)}, Max Premium: $${maxPremium.toFixed(2)}, Min Profit Ratio: ${minProfitRatio.toFixed(2)}, Max Profit Ratio: ${maxProfitRatio.toFixed(2)}`);
      
      // Calculate scores using profit ratio approach and square root premium scaling
      const traders = traderArray.map(trader => {
        // 1. Premium Component (max 30 points) with square root scaling
        // Square root scaling gives a more gradual scale that doesn't unfairly advantage large traders
        const premiumScore = Math.min(
          Math.sqrt(trader.premiumPaidUSD / Math.max(medianPremium, 0.01)) * 15, 
          30
        );
        
        // 2. Profit Ratio Component (max 40 points)
        // Normalize profit ratios across the full range from worst to best ratio
        const premiumFactor = Math.min(1, Math.sqrt(trader.premiumPaidUSD / (medianPremium * 2)));

        // Trade count factor - rewards consistency
        const tradeFactor = Math.min(1, trader.settledTrades / 10);

        // Combined scaling factor
        const scalingFactor = 0.2 + (0.8 * (premiumFactor * tradeFactor));

        // Apply to profit score
        const maxPossibleProfitScore = 40 * scalingFactor;
        const profitScore = profitRatioRange > 0 
          ? Math.min(((trader.profitRatio + Math.abs(minProfitRatio)) / profitRatioRange) * maxPossibleProfitScore, maxPossibleProfitScore)
          : 0;
        
        // 3. Volume Diversity Component (max 30 points)
        // Using square root to reward diversity without excessive farming
        const tradeScore = Math.min(Math.sqrt(trader.numTrades) * 3, 30);
        
        // Total combined score
        const totalScore = premiumScore + profitScore + tradeScore;
        
        return {
          ...trader,
          profitRatio: parseFloat(trader.profitRatio.toFixed(4)), // Include profit ratio in output
          premiumScore: parseFloat(premiumScore.toFixed(2)),
          profitScore: parseFloat(profitScore.toFixed(2)),
          tradeScore: parseFloat(tradeScore.toFixed(2)),
          score: parseFloat(totalScore.toFixed(2)),
          // Rename for clarity in API response
          premiumPaid: trader.premiumPaidUSD,
          profit: trader.profitUSD,
          volume: trader.volumeUSD,
          // Add streak statistics
          streaks: calculateStreakStats(
            fullState.userDailyMetrics[trader.address] || {}, 
            period === 'past_week' ? 7 : null
          )
        };
      });
      
      // Sort by total score, descending
      traders.sort((a, b) => b.score - a.score);
      
      // Build the result for this period
      results[period] = {
        traders,
        scoringMetrics: {
          medianPremium,
          maxPremium,
          minProfitRatio: minProfitRatio,
          maxProfitRatio: maxProfitRatio,
          profitRatioRange: profitRatioRange,
          totalPremiumPaid: totals.premiumPaidUSD,
          totalProfit: totals.profitUSD
        },
        totals: {
          premiumPaid: totals.premiumPaidUSD,
          profit: totals.profitUSD,
          volume: totals.volumeUSD,
          trades: totals.trades,
          settledTrades: totals.settledTrades
        },
        topProfitableTrades: getTopProfitableTrades(
          fullState, 
          period === 'past_week' ? 7 : null, 
          15 // Top 15 trades for marketing
        ),
        marketingStats: {
          totalWinners: traders.filter(t => t.profit > 0).length,
          averageWinnerReturn: traders.filter(t => t.profit > 0).length > 0 
            ? traders.filter(t => t.profit > 0).reduce((sum, t) => sum + (t.profit / t.premiumPaid * 100), 0) / traders.filter(t => t.profit > 0).length
            : 0,
          biggestWin: (() => {
            const topTrades = getTopProfitableTrades(fullState, period === 'past_week' ? 7 : null, 1);
            return topTrades.length > 0 ? topTrades[0].absoluteReturn : 0;
          })(),
          mostProfitableAsset: getMostProfitableAsset(fullState, period === 'past_week' ? 7 : null)
        }
      };
    }
    
    // Update the cache with both periods
    cachedScoreboard = {
      all: results.all,
      past_week: results.past_week
    };
    cachedScoreboardSettledCount = currentSettledCount;
    
    return new Response(JSON.stringify(results), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (error) {
    console.error(`Error generating scoreboards:`, error);
    return new Response(JSON.stringify({
      error: `Failed to generate scoreboards`,
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

/**
 * Handle a request to refresh events from a specific block range
 */
async function handleRefreshBlocksRequest(request, env, corsHeaders = {}) {
  // Parse query parameters
  const url = new URL(request.url);
  const fromBlock = parseInt(url.searchParams.get('fromBlock'));
  const toBlock = parseInt(url.searchParams.get('toBlock'));
  const forceUpdate = url.searchParams.get('force') === 'true';
  const deduplicate = url.searchParams.get('deduplicate') !== 'false'; // Default to true
  
  // Validate parameters
  if (isNaN(fromBlock) || isNaN(toBlock) || fromBlock > toBlock) {
    return new Response(JSON.stringify({ 
      status: 'error', 
      message: 'Invalid block range. Please provide valid fromBlock and toBlock parameters.' 
    }), { 
      status: 400, 
      headers: { 'Content-Type': 'application/json', ...corsHeaders } 
    });
  }
  
  // Set reasonable limits to prevent abuse
  const maxRange = 100000; // Maximum block range to process in one request
  if (toBlock - fromBlock > maxRange) {
    return new Response(JSON.stringify({ 
      status: 'error', 
      message: `Block range too large. Maximum range is ${maxRange} blocks.` 
    }), { 
      status: 400, 
      headers: { 'Content-Type': 'application/json', ...corsHeaders } 
    });
  }
  
  try {
    console.log(`Refreshing events from block ${fromBlock} to ${toBlock} (deduplicate: ${deduplicate})`);
    
    // Get current state
    const fullState = await getFullState(env);
    
    // Track results for response
    const results = {
      fromBlock,
      toBlock,
      processedEvents: 0,
      newPositions: 0,
      updatedPositions: 0,
      removedEvents: 0,
      errors: []
    };
    
    // Fetch all relevant logs in the requested range
    // 1. OptionBook events (using the configured address)
    const optionBookLogs = await fetchLogs(OPTION_BOOK_ADDRESS, fromBlock, toBlock, [], env);
    
    // 2. BaseOption events (globally, filtered by topics)
    if (!EventParser.eventHashes) {
      await EventParser.init(env);
    }
    
    const baseOptionTopics = [
      Object.values(EventParser.eventHashes).filter(hash =>
        hash !== EventParser.eventHashes.OrderFilled &&
        hash !== EventParser.eventHashes.OrderCancelled
      )
    ];
    
    const baseOptionLogs = await fetchLogs(null, fromBlock, toBlock, baseOptionTopics, env);
    
    // Combine and sort logs
    const allLogs = [...optionBookLogs, ...baseOptionLogs];
    allLogs.sort((a, b) => {
      const blockDiff = parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16);
      if (blockDiff !== 0) return blockDiff;
      return parseInt(a.logIndex, 16) - parseInt(b.logIndex, 16);
    });
    
    // If deduplicate is enabled, remove existing events with matching txHashes
    if (deduplicate && allLogs.length > 0) {
      console.log('Deduplicating events before processing...');
      
      // Collect all txHashes from the new logs
      const newTxHashes = new Set(allLogs.map(log => log.transactionHash.toLowerCase()));
      console.log(`Found ${newTxHashes.size} unique transaction hashes to deduplicate`);
      
      // Remove existing events with matching txHashes from state.events
      Object.keys(fullState.events).forEach(optionAddress => {
        if (fullState.events[optionAddress]) {
          const originalLength = fullState.events[optionAddress].length;
          fullState.events[optionAddress] = fullState.events[optionAddress].filter(event => {
            if (newTxHashes.has(event.txHash.toLowerCase())) {
              console.log(`Removing duplicate event: ${event.name} for option ${optionAddress} (tx: ${event.txHash})`);
              results.removedEvents++;
              return false; // Remove this event
            }
            return true; // Keep this event
          });
          
          const removedCount = originalLength - fullState.events[optionAddress].length;
          if (removedCount > 0) {
            console.log(`Removed ${removedCount} duplicate events for option ${optionAddress}`);
          }
        }
      });
      
      console.log(`Total removed events: ${results.removedEvents}`);
    }
    
    // Process logs
    console.log(`Processing ${allLogs.length} events from the block range`);
    for (const log of allLogs) {
      const parsed = EventParser.parseLog(log, env);
      if (parsed) {
        // Optionally allow forced reprocessing of events for positions that already exist
        if (forceUpdate) {
          // For certain event types that create positions, check if we need to reset existing position data
          if (parsed.name === 'OptionInitialized' || parsed.name === 'OrderFilled') {
            const optionAddress = (parsed.name === 'OptionInitialized') 
              ? parsed.args.optionAddress.toLowerCase() 
              : parsed.args.optionAddress.toLowerCase();
            
            // Log if we're updating an existing position
            if (fullState.positions[optionAddress]) {
              console.log(`Force updating existing position: ${optionAddress}`);
            }
          }
        }
        
        // Process the event
        processEvent(fullState, parsed, log, results);
        results.processedEvents++;
      }
    }
    
    // Save updated state
    if (results.processedEvents > 0 || results.removedEvents > 0) {
      await KV_STORAGE.put('fullState', JSON.stringify(fullState, replacer));
      // Update cache
      cachedFullState = fullState;
      cachedStateTimestamp = Date.now();
      // Reset scoreboard cache if positions were updated
      if (results.updatedPositions > 0 || results.newPositions > 0) {
        cachedScoreboard = {
          all: null,
          past_week: null
        };
        cachedScoreboardSettledCount = 0;
      }
    }
    
    return new Response(JSON.stringify({ 
      status: 'success', 
      message: `Processed ${results.processedEvents} events and removed ${results.removedEvents} duplicate events from blocks ${fromBlock} to ${toBlock}`,
      details: results
    }), { 
      headers: { 'Content-Type': 'application/json', ...corsHeaders } 
    });
  } catch (error) {
    console.error('Error refreshing blocks:', error);
    return new Response(JSON.stringify({ 
      status: 'error', 
      message: `Error refreshing blocks: ${error.message}` 
    }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json', ...corsHeaders } 
    });
  }
}

async function handleOpenPositionsRequest(corsHeaders, env) {
  try {
    const fullState = await getFullState(env);
    
    // Filter only open positions
    const openPositions = Object.values(fullState.positions)
      .filter(position => position.status === 'open' || position.status === 'pending_init')
      // Only include positions with sufficient data
      .filter(position => position.orderFilledData && position.initializedData)
      // Sort by entry timestamp (newest first)
      .sort((a, b) => b.entryTimestamp - a.entryTimestamp);
    
    // Format the response data
    const formattedPositions = await Promise.all(openPositions.map(formatPositionData));
    
    return new Response(JSON.stringify({
      count: formattedPositions.length,
      positions: formattedPositions
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (error) {
    console.error("Error fetching open positions:", error);
    return new Response(JSON.stringify({
      error: "Failed to fetch open positions",
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

// --- Daily Metrics and Streak Calculation Functions ---

/**
 * Get the UTC date string from a timestamp (in seconds)
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {string} - Date string in YYYY-MM-DD format
 */
function getUTCDateString(timestamp) {
  const date = new Date(timestamp * 1000); // Convert to milliseconds
  return date.toISOString().split('T')[0]; // Get YYYY-MM-DD part
}

/**
 * Update daily metrics for a user when a position is settled
 * @param {Object} state - Full state object
 * @param {string} userAddress - User address (buyer)
 * @param {number} expiryTimestamp - Expiry timestamp in seconds
 * @param {number} profitUSD - Profit/loss in USD (positive for profit, negative for loss)
 */
function updateUserDailyMetrics(state, userAddress, expiryTimestamp, profitUSD) {
  if (!state.userDailyMetrics[userAddress]) {
    state.userDailyMetrics[userAddress] = {};
  }
  
  const dateString = getUTCDateString(expiryTimestamp);
  
  if (!state.userDailyMetrics[userAddress][dateString]) {
    state.userDailyMetrics[userAddress][dateString] = {
      hasTraded: false,
      netPnL: 0,
      isWinning: false,
      tradeCount: 0
    };
  }
  
  const dayMetrics = state.userDailyMetrics[userAddress][dateString];
  dayMetrics.hasTraded = true;
  dayMetrics.netPnL += profitUSD;
  dayMetrics.tradeCount += 1;
  dayMetrics.isWinning = dayMetrics.netPnL > 0;
  
  console.log(`Updated daily metrics for ${userAddress} on ${dateString}: netPnL=${dayMetrics.netPnL.toFixed(2)}, tradeCount=${dayMetrics.tradeCount}, isWinning=${dayMetrics.isWinning}`);
}

/**
 * Calculate streak statistics for a user
 * @param {Object} userDailyMetrics - User's daily metrics object
 * @param {number} daysCutoff - Number of days to look back (7 for weekly, null for all-time)
 * @returns {Object} - Streak statistics
 */
function calculateStreakStats(userDailyMetrics, daysCutoff = null) {
  // Calculate cutoff timestamp - if daysCutoff provided, look back N days from start of today
  let cutoffTimestamp = 0;
  if (daysCutoff) {
    const now = new Date();
    // Get start of today in UTC
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    // Subtract N days to get the cutoff (inclusive)
    cutoffTimestamp = Math.floor(startOfToday.getTime() / 1000) - (daysCutoff * 24 * 60 * 60);
  }
  
  // Get all dates and sort them
  const allDates = Object.keys(userDailyMetrics)
    .map(dateStr => ({
      dateStr,
      timestamp: new Date(dateStr + 'T08:00:00Z').getTime() / 1000, // 8 AM UTC expiry time
      metrics: userDailyMetrics[dateStr]
    }))
    .filter(item => item.timestamp >= cutoffTimestamp)
    .sort((a, b) => a.timestamp - b.timestamp);
  
  const stats = {
    daysWithTrades: 0,
    daysWithWins: 0,
    longestTradingStreak: 0,
    longestWinStreak: 0
  };
  
  // Count days with trades and wins
  allDates.forEach(item => {
    if (item.metrics.hasTraded) {
      stats.daysWithTrades++;
    }
    if (item.metrics.isWinning) {
      stats.daysWithWins++;
    }
  });
  
  // Calculate longest trading streak
  let currentTradingStreak = 0;
  let maxTradingStreak = 0;
  
  if (allDates.length > 0) {
    const firstDate = allDates[0].timestamp;
    const lastDate = allDates[allDates.length - 1].timestamp;
    const metricsMap = new Map(allDates.map(item => [item.dateStr, item.metrics]));
    
    // Iterate through each day from first to last filtered date
    for (let dayTimestamp = firstDate; dayTimestamp <= lastDate; dayTimestamp += 24 * 60 * 60) {
      const dayDateStr = getUTCDateString(dayTimestamp);
      const dayMetrics = metricsMap.get(dayDateStr);
      
      if (dayMetrics && dayMetrics.hasTraded) {
        currentTradingStreak++;
        maxTradingStreak = Math.max(maxTradingStreak, currentTradingStreak);
      } else {
        currentTradingStreak = 0;
      }
    }
  }
  
  stats.longestTradingStreak = maxTradingStreak;
  
  // Calculate longest win streak
  let currentWinStreak = 0;
  let maxWinStreak = 0;
  
  if (allDates.length > 0) {
    const firstDate = allDates[0].timestamp;
    const lastDate = allDates[allDates.length - 1].timestamp;
    const metricsMap = new Map(allDates.map(item => [item.dateStr, item.metrics]));
    
    // Iterate through each day from first to last filtered date
    for (let dayTimestamp = firstDate; dayTimestamp <= lastDate; dayTimestamp += 24 * 60 * 60) {
      const dayDateStr = getUTCDateString(dayTimestamp);
      const dayMetrics = metricsMap.get(dayDateStr);
      
      if (dayMetrics && dayMetrics.isWinning) {
        currentWinStreak++;
        maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
      } else if (dayMetrics && dayMetrics.hasTraded) {
        // Only break streak if user traded but didn't win (had a losing day)
        currentWinStreak = 0;
      }
      // If user didn't trade at all, don't break the streak (just skip the day)
    }
    
    stats.longestWinStreak = maxWinStreak;
  }
  
  return stats;
}

/**
 * Rebuild daily metrics and profitable trades for all users from existing settled positions
 * This should be called once to populate historical data
 * @param {Object} state - Full state object
 */
function rebuildAllDailyMetrics(state) {
  console.log("Rebuilding daily metrics and profitable trades from all settled positions...");
  
  // Clear existing data
  state.userDailyMetrics = {};
  state.topProfitableTrades = [];
  
  let processedPositions = 0;
  let addedProfitableTrades = 0;
  
  // Process all settled positions
  Object.values(state.positions).forEach(position => {
    if ((position.status === 'settled' || position.status === 'closed') && position.settlementData && position.initializedData && position.orderFilledData) {
      const buyer = position.orderFilledData.buyer;
      const expiryTimestamp = position.initializedData.expiryTimestamp;
      
      // Calculate profit for this position
      const profitUSD = calculatePositionProfitUSD(position);
      
      if (profitUSD !== null) {
        updateUserDailyMetrics(state, buyer, expiryTimestamp, profitUSD);
        processedPositions++;
        
        // Add profitable trades for marketing (if position was profitable)
        if (profitUSD > 0) {
          console.log(`DEBUG: Found profitable position with profit ${profitUSD} for buyer ${buyer}`);
          addProfitableTrade(state, position, buyer, profitUSD, position.closeTimestamp || expiryTimestamp);
          addedProfitableTrades++;
        } else {
          console.log(`DEBUG: Position had negative/zero profit: ${profitUSD}`);
        }
      } else {
        console.log(`DEBUG: Could not calculate profit for position ${position.address}`);
      }
    } else {
      console.log(`DEBUG: Skipping position ${position.address} - status: ${position.status}, hasSettlement: ${!!position.settlementData}, hasInit: ${!!position.initializedData}, hasOrder: ${!!position.orderFilledData}`);
    }
  });
  
  console.log(`Rebuilt daily metrics for ${processedPositions} positions and ${addedProfitableTrades} profitable trades across ${Object.keys(state.userDailyMetrics).length} users`);
}

/**
 * Calculate profit in USD for a settled position
 * @param {Object} position - Position object
 * @returns {number|null} - Profit in USD or null if cannot calculate
 */
function calculatePositionProfitUSD(position) {
  try {
    if (!position.orderFilledData || !position.initializedData || !position.settlementData) {
      console.log(`DEBUG: calculatePositionProfitUSD - Missing data for ${position.address}:`, {
        hasOrderFilled: !!position.orderFilledData,
        hasInitialized: !!position.initializedData,
        hasSettlement: !!position.settlementData
      });
      return null;
    }
    
    const isCall = position.initializedData.optionType === 0;
    
    // Get strike price
    const strikeBN = new BigNumber(position.initializedData.strikes[0]);
    const strike = Number(strikeBN.toString()) / Math.pow(10, 8);
    
    // Get premium amount
    const premiumBN = new BigNumber(position.orderFilledData.premiumAmount);
    const premiumAmount = Number(premiumBN.toString());
    
    // Get collateral details
    const collateralToken = position.initializedData.collateralToken.toLowerCase();
    const collateralDetails = METADATA.collaterals[collateralToken];
    
    if (!collateralDetails) {
      console.warn(`Unknown collateral token for profit calculation: ${collateralToken}`);
      return null;
    }
    
    // Convert premium to USD
    const premiumTokenAmount = premiumAmount / Math.pow(10, collateralDetails.decimals);
    let premiumUSD = premiumTokenAmount;
    
    // For non-stablecoin collaterals, use strike price to normalize
    if (collateralDetails.symbol === 'WETH') {
      premiumUSD = premiumTokenAmount * strike;
    } else if (collateralDetails.symbol === 'CBBTC') {
      premiumUSD = premiumTokenAmount * strike;
    }
    
    // Calculate profit
    let profitUSD = 0;
    
    if (position.settlementData.payoutBuyer) {
      // There was a payout - calculate profit directly
      const payoutBN = new BigNumber(position.settlementData.payoutBuyer);
      const payoutAmount = Number(payoutBN.toString());
      const payoutTokenAmount = payoutAmount / Math.pow(10, collateralDetails.decimals);
      
      // Convert payout to USD
      let payoutUSD = payoutTokenAmount;
      
      // Use settlement price if available, otherwise strike
      let settlementPrice = strike;
      if (position.settlementData.settlementPrice) {
        const settlementPriceBN = new BigNumber(position.settlementData.settlementPrice);
        settlementPrice = Number(settlementPriceBN.toString()) / Math.pow(10, 8);
      }
      
      if (collateralDetails.symbol === 'WETH') {
        payoutUSD = payoutTokenAmount * settlementPrice;
      } else if (collateralDetails.symbol === 'CBBTC') {
        payoutUSD = payoutTokenAmount * settlementPrice;
      }
      
      profitUSD = payoutUSD - premiumUSD;
    } else {
      // Option expired worthless
      profitUSD = -premiumUSD;
    }
    
    console.log(`DEBUG: calculatePositionProfitUSD result for ${position.address}: ${profitUSD} (premium: ${premiumUSD}, payout: ${position.settlementData.payoutBuyer ? 'exists' : 'none'})`);
    return profitUSD;
  } catch (error) {
    console.error("Error calculating position profit:", error, position.address);
    return null;
  }
}

/**
 * Handle a request to debug a specific user's daily metrics and positions
 */
async function handleDebugUserRequest(userAddress, corsHeaders, env) {
  if (!userAddress || !/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
    return new Response(JSON.stringify({ error: 'Invalid user address format' }), 
      { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }});
  }
  
  try {
    const fullState = await getFullState(env);
    
    // Find all positions for this user
    const userPositions = Object.values(fullState.positions).filter(position => {
      const buyer = position.orderFilledData?.buyer || position.initializedData?.buyer;
      return buyer && buyer.toLowerCase() === userAddress;
    });
    
    const settledPositions = userPositions.filter(p => 
      (p.status === 'settled' || p.status === 'closed') && p.settlementData && p.initializedData
    );
    
    // Get user daily metrics
    const userDailyMetrics = fullState.userDailyMetrics[userAddress] || {};
    
    // Calculate detailed streak info with debug logging
    const streakDebug = calculateStreakStatsDebug(userDailyMetrics, null);
    
    // Format settled positions for inspection
    const formattedPositions = settledPositions.map(position => ({
      address: position.address,
      expiryTimestamp: position.initializedData?.expiryTimestamp,
      expiryDate: position.initializedData?.expiryTimestamp ? 
        getUTCDateString(position.initializedData.expiryTimestamp) : 'unknown',
      profitUSD: calculatePositionProfitUSD(position),
      status: position.status
    }));
    
    return new Response(JSON.stringify({
      address: userAddress,
      totalPositions: userPositions.length,
      settledPositions: settledPositions.length,
      dailyMetrics: userDailyMetrics,
      streakDebug,
      positions: formattedPositions
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (error) {
    console.error(`Error debugging user ${userAddress}:`, error);
    return new Response(JSON.stringify({
      error: `Failed to debug user`,
      message: error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

/**
 * Calculate streak statistics with detailed debug information
 */
function calculateStreakStatsDebug(userDailyMetrics, daysCutoff = null) {
  // Get all dates and sort them
  const allDates = Object.keys(userDailyMetrics)
    .map(dateStr => ({
      dateStr,
      timestamp: new Date(dateStr + 'T08:00:00Z').getTime() / 1000, // 8 AM UTC expiry time
      metrics: userDailyMetrics[dateStr]
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
  
  // If daysCutoff is specified, filter to the most recent N days with data
  let filteredDates = allDates;
  if (daysCutoff && allDates.length > 0) {
    filteredDates = allDates.slice(-daysCutoff);
  }
  
  const stats = {
    daysWithTrades: 0,
    daysWithWins: 0,
    longestTradingStreak: 0,
    longestWinStreak: 0
  };
  
  // Count days with trades and wins
  filteredDates.forEach(item => {
    if (item.metrics.hasTraded) {
      stats.daysWithTrades++;
    }
    if (item.metrics.isWinning) {
      stats.daysWithWins++;
    }
  });
  
  // Calculate longest trading streak
  let currentTradingStreak = 0;
  let maxTradingStreak = 0;
  
  if (filteredDates.length > 0) {
    const firstDate = filteredDates[0].timestamp;
    const lastDate = filteredDates[filteredDates.length - 1].timestamp;
    const metricsMap = new Map(filteredDates.map(item => [item.dateStr, item.metrics]));
    
    console.log(`Debug: trading streak calculation from ${getUTCDateString(firstDate)} to ${getUTCDateString(lastDate)}`);
    
    // Iterate through each day from first to last filtered date
    for (let dayTimestamp = firstDate; dayTimestamp <= lastDate; dayTimestamp += 24 * 60 * 60) {
      const dayDateStr = getUTCDateString(dayTimestamp);
      const dayMetrics = metricsMap.get(dayDateStr);
      
      if (dayMetrics && dayMetrics.hasTraded) {
        currentTradingStreak++;
        maxTradingStreak = Math.max(maxTradingStreak, currentTradingStreak);
      } else {
        currentTradingStreak = 0;
      }
    }
  }
  
  stats.longestTradingStreak = maxTradingStreak;
  
  // Calculate longest win streak
  let currentWinStreak = 0;
  let maxWinStreak = 0;
  
  if (filteredDates.length > 0) {
    const firstDate = filteredDates[0].timestamp;
    const lastDate = filteredDates[filteredDates.length - 1].timestamp;
    const metricsMap = new Map(filteredDates.map(item => [item.dateStr, item.metrics]));
    
    console.log(`Debug: win streak calculation from ${getUTCDateString(firstDate)} to ${getUTCDateString(lastDate)}`);
    
    // Iterate through each day from first to last filtered date
    for (let dayTimestamp = firstDate; dayTimestamp <= lastDate; dayTimestamp += 24 * 60 * 60) {
      const dayDateStr = getUTCDateString(dayTimestamp);
      const dayMetrics = metricsMap.get(dayDateStr);
      
      if (dayMetrics && dayMetrics.isWinning) {
        currentWinStreak++;
        maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
      } else if (dayMetrics && dayMetrics.hasTraded) {
        // Only break streak if user traded but didn't win (had a losing day)
        currentWinStreak = 0;
      }
      // If user didn't trade at all, don't break the streak (just skip the day)
    }
    
    stats.longestWinStreak = maxWinStreak;
  }
  
  return {
    ...stats,
    debugInfo: {
      totalDailyMetrics: Object.keys(userDailyMetrics).length,
      filteredDates: filteredDates.length,
      firstDate: filteredDates.length > 0 ? filteredDates[0].dateStr : null,
      lastDate: filteredDates.length > 0 ? filteredDates[filteredDates.length - 1].dateStr : null
    }
  };
}

/**
 * Add a profitable trade to the top profitable trades list
 * Format: Size x Expiry x Asset x Strike x Type (e.g., 193770x-20Jun25-WS-0.4585-C)
 */
function addProfitableTrade(state, position, userAddress, profitUSD, timestamp) {
    console.log(`DEBUG: addProfitableTrade called for user ${userAddress} with profit ${profitUSD}`);
    
    if (!state.topProfitableTrades) {
        state.topProfitableTrades = [];
    }
    
    try {
        // Debug the position structure
        console.log(`DEBUG: Position structure:`, {
            address: position.address,
            hasOrderFilledData: !!position.orderFilledData,
            hasInitializedData: !!position.initializedData,
            orderFilledKeys: position.orderFilledData ? Object.keys(position.orderFilledData) : 'none',
            initDataKeys: position.initializedData ? Object.keys(position.initializedData) : 'none',
            collateralDecimals: position.collateralDecimals,
            underlyingAsset: position.underlyingAsset
        });
        
        // Extract trade details - fix field name issues
        const premiumAmount = position.orderFilledData?.premiumAmount || '0';
        console.log(`DEBUG: Premium amount raw:`, premiumAmount);
        
        const entryPremium = parseFloat(premiumAmount);
        const collateralDecimals = position.collateralDecimals || 18;
        const premiumTokenAmount = entryPremium / Math.pow(10, collateralDecimals);
        
        // Convert premium to USD based on option type and collateral
        let premiumUSD = premiumTokenAmount;
        const isCall = position.initializedData?.optionType === 0;
        const asset = position.underlyingAsset || 'Unknown';
        
        if (isCall && (asset === 'ETH' || asset === 'BTC')) {
            // For calls, premium is paid in base asset (ETH/BTC) - use strike price as approximation
            const strike = parseFloat(position.initializedData?.strikes?.[0] || '0') / Math.pow(10, 8);
            premiumUSD = premiumTokenAmount * strike;
        }
        // For puts, premium is already in USDC (quote asset), so premiumUSD = premiumTokenAmount
        
        console.log(`DEBUG: Premium calculation:`, {
            entryPremium,
            collateralDecimals,
            premiumTokenAmount,
            isCall,
            asset,
            premiumUSD
        });
        
        // Calculate percentage return
        const percentageReturn = premiumUSD > 0 ? (profitUSD / premiumUSD) * 100 : 0;
        
        // Format trade description
        const tradeDescription = formatTradeDescription(position);
        console.log(`DEBUG: Trade description:`, tradeDescription);
        
        // Get expiry date for time filtering
        const expiryTimestamp = position.initializedData?.expiryTimestamp || timestamp;
        
        const profitableTrade = {
            userAddress: userAddress.toLowerCase(),
            tradeDescription,
            absoluteReturn: profitUSD,
            percentageReturn,
            premiumPaid: premiumUSD,
            timestamp: timestamp,
            expiryTimestamp,
            optionAddress: position.address || '',
            asset: position.underlyingAsset || 'Unknown',
            rank: 0 // Will be calculated when generating scoreboard
        };
        
        console.log(`DEBUG: Created profitable trade:`, profitableTrade);
        
        // Add to the list
        state.topProfitableTrades.push(profitableTrade);
        console.log(`DEBUG: Added to list. Total profitable trades: ${state.topProfitableTrades.length}`);
        
        // Keep only top 100 trades by absolute return (memory management)
        if (state.topProfitableTrades.length > 100) {
            state.topProfitableTrades.sort((a, b) => b.absoluteReturn - a.absoluteReturn);
            state.topProfitableTrades = state.topProfitableTrades.slice(0, 100);
        }
        
    } catch (error) {
        console.error('Error adding profitable trade:', error);
        console.error('Position data:', position);
    }
}

/**
 * Format trade description: Size x Expiry x Asset x Strike x Type
 * Example: 193770x-20Jun25-WS-0.4585-C
 */
function formatTradeDescription(position) {
    try {
        const orderData = position.orderFilledData || {};
        const initData = position.initializedData || {};
        
        // Extract contract size (in human readable format) - fix field name issues
        const numContracts = parseFloat(initData.numContracts || '0');
        const collateralDecimals = position.collateralDecimals || 18;
        const contractSizeRaw = numContracts / Math.pow(10, collateralDecimals);
        
        // Format contract size with up to 6 decimal places, removing trailing zeros
        const contractSize = parseFloat(contractSizeRaw.toFixed(6));
        
        // Format expiry date
        const expiryTimestamp = initData.expiryTimestamp || Date.now() / 1000;
        const expiryDate = new Date(expiryTimestamp * 1000);
        const expiryStr = expiryDate.toLocaleDateString('en-GB', { 
            day: '2-digit', 
            month: 'short', 
            year: '2-digit' 
        }).replace(/\s/g, '');
        
        // Get asset symbol
        const asset = position.underlyingAsset || 'UNK';
        
        // Format strike price - smart formatting based on asset
        const strike = parseFloat(initData.strikes?.[0] || '0') / Math.pow(10, 8);
        let strikeStr;
        
        if (asset === 'BTC' || asset === 'ETH' || strike >= 100) {
            // Show integers for major assets and larger strikes
            strikeStr = Math.round(strike).toString();
        } else {
            // Show 4 decimal places for smaller/exotic strikes
            strikeStr = strike.toFixed(4);
        }
        
        // Format option type
        const optionType = initData.optionType === 0 ? 'C' : 'P'; // 0=Call, 257=Put
        
        return `${contractSize}x-${expiryStr}-${asset}-${strikeStr}-${optionType}`;
    } catch (error) {
        console.error('Error formatting trade description:', error);
        return 'Unknown Trade Format';
    }
}

/**
 * Get top profitable trades filtered by time period
 */
function getTopProfitableTrades(state, daysCutoff = null, limit = 20) {
    console.log(`DEBUG: getTopProfitableTrades called with daysCutoff=${daysCutoff}, limit=${limit}`);
    console.log(`DEBUG: state.topProfitableTrades exists: ${!!state.topProfitableTrades}`);
    console.log(`DEBUG: state.topProfitableTrades length: ${state.topProfitableTrades ? state.topProfitableTrades.length : 'N/A'}`);
    
    if (!state.topProfitableTrades || state.topProfitableTrades.length === 0) {
        console.log(`DEBUG: Returning empty array - no profitable trades found`);
        return [];
    }
    
    let trades = [...state.topProfitableTrades];
    console.log(`DEBUG: Initial trades count: ${trades.length}`);
    
    // Apply time filter if specified
    if (daysCutoff !== null) {
        const cutoffTimestamp = Math.floor(Date.now() / 1000) - (daysCutoff * 24 * 60 * 60);
        console.log(`DEBUG: Applying time filter with cutoff timestamp: ${cutoffTimestamp}`);
        trades = trades.filter(trade => trade.timestamp >= cutoffTimestamp);
        console.log(`DEBUG: After time filter, trades count: ${trades.length}`);
    }
    
    // Sort by absolute return (descending)
    trades.sort((a, b) => b.absoluteReturn - a.absoluteReturn);
    
    // Add ranks and limit results
    trades = trades.slice(0, limit).map((trade, index) => ({
        ...trade,
        rank: index + 1
    }));
    
    console.log(`DEBUG: Final trades count after limit ${limit}: ${trades.length}`);
    return trades;
}

/**
 * Get the most profitable asset for marketing stats
 */
function getMostProfitableAsset(state, daysCutoff = null) {
    if (!state.topProfitableTrades || state.topProfitableTrades.length === 0) {
        return { asset: 'N/A', totalProfit: 0, tradeCount: 0 };
    }
    
    let trades = [...state.topProfitableTrades];
    
    // Apply time filter if specified
    if (daysCutoff !== null) {
        const cutoffTimestamp = Math.floor(Date.now() / 1000) - (daysCutoff * 24 * 60 * 60);
        trades = trades.filter(trade => trade.timestamp >= cutoffTimestamp);
    }
    
    // Group by asset and calculate totals
    const assetStats = {};
    trades.forEach(trade => {
        const asset = trade.asset || 'Unknown';
        if (!assetStats[asset]) {
            assetStats[asset] = { totalProfit: 0, tradeCount: 0 };
        }
        assetStats[asset].totalProfit += trade.absoluteReturn;
        assetStats[asset].tradeCount += 1;
    });
    
    // Find the most profitable asset
    let mostProfitable = { asset: 'N/A', totalProfit: 0, tradeCount: 0 };
    Object.entries(assetStats).forEach(([asset, stats]) => {
        if (stats.totalProfit > mostProfitable.totalProfit) {
            mostProfitable = { asset, ...stats };
        }
    });
    
    return mostProfitable;
}

/**
 * Rebuild only daily metrics, preserving existing profitable trades
 * @param {Object} state - Full state object
 */
function rebuildDailyMetricsOnly(state) {
  console.log("Rebuilding daily metrics only (preserving existing profitable trades)...");
  
  // Clear only daily metrics
  state.userDailyMetrics = {};
  
  let processedPositions = 0;
  
  // Process all settled positions for daily metrics only
  Object.values(state.positions).forEach(position => {
    if ((position.status === 'settled' || position.status === 'closed') && position.settlementData && position.initializedData && position.orderFilledData) {
      const buyer = position.orderFilledData.buyer;
      const expiryTimestamp = position.initializedData.expiryTimestamp;
      
      // Calculate profit for this position
      const profitUSD = calculatePositionProfitUSD(position);
      
      if (profitUSD !== null) {
        updateUserDailyMetrics(state, buyer, expiryTimestamp, profitUSD);
        processedPositions++;
      }
    }
  });
  
  console.log(`Rebuilt daily metrics for ${processedPositions} positions across ${Object.keys(state.userDailyMetrics).length} users (preserved ${state.topProfitableTrades ? state.topProfitableTrades.length : 0} profitable trades)`);
}

/**
 * Rebuild only profitable trades, preserving existing daily metrics
 * @param {Object} state - Full state object
 */
function rebuildProfitableTradesOnly(state) {
  console.log("Rebuilding profitable trades only (preserving existing daily metrics)...");
  
  // Clear only profitable trades
  state.topProfitableTrades = [];
  
  let addedProfitableTrades = 0;
  
  // Process all settled positions for profitable trades only
  Object.values(state.positions).forEach(position => {
    if ((position.status === 'settled' || position.status === 'closed') && position.settlementData && position.initializedData && position.orderFilledData) {
      const buyer = position.orderFilledData.buyer;
      
      // Calculate profit for this position
      const profitUSD = calculatePositionProfitUSD(position);
      
      if (profitUSD !== null && profitUSD > 0) {
        addProfitableTrade(state, position, buyer, profitUSD, position.closeTimestamp || position.initializedData.expiryTimestamp);
        addedProfitableTrades++;
      }
    }
  });
  
  console.log(`Rebuilt ${addedProfitableTrades} profitable trades (preserved daily metrics for ${Object.keys(state.userDailyMetrics || {}).length} users)`);
}

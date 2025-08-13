/**
 * Retry helper with exponential backoff for RPC calls
 * Handles HTTP 429 (Too Many Requests) and other transient errors
 */

/**
 * Exponential backoff retry function
 * @param {Function} fn - The function to retry
 * @param {Object} options - Retry configuration
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {number} options.baseDelayMs - Base delay in milliseconds (default: 1000)
 * @param {number} options.maxDelayMs - Maximum delay in milliseconds (default: 8000)
 * @param {Function} options.shouldRetry - Function to determine if error should be retried
 * @returns {Promise} - Promise that resolves with the result or rejects with final error
 */
async function retryWithExponentialBackoff(fn, options = {}) {
    const {
        maxRetries = 3,
        baseDelayMs = 1000,
        maxDelayMs = 8000,
        shouldRetry = defaultShouldRetry
    } = options;
    
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            
            // Don't retry on the last attempt
            if (attempt === maxRetries) {
                break;
            }
            
            // Check if we should retry this error
            if (!shouldRetry(error)) {
                break;
            }
            
            // Calculate delay with exponential backoff
            const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
            
            console.warn(`RPC call failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`, {
                error: error.message,
                attempt: attempt + 1,
                maxRetries: maxRetries + 1
            });
            
            await sleep(delay);
        }
    }
    
    throw lastError;
}

/**
 * Default function to determine if an error should be retried
 * @param {Error} error - The error to check
 * @returns {boolean} - True if the error should be retried
 */
function defaultShouldRetry(error) {
    // Check for HTTP 429 (Too Many Requests)
    if (error.message && error.message.includes('429')) {
        return true;
    }
    
    // Check for specific RPC error codes that indicate rate limiting
    if (error.message && error.message.includes('Too Many Requests')) {
        return true;
    }
    
    // Check for network errors that might be transient
    if (error.message && (
        error.message.includes('network') ||
        error.message.includes('timeout') ||
        error.message.includes('ECONNRESET') ||
        error.message.includes('ETIMEDOUT')
    )) {
        return true;
    }
    
    // Check for specific JSON-RPC error codes
    if (error.code === -32603 && error.message && error.message.includes('429')) {
        return true;
    }
    
    return false;
}

/**
 * Sleep function for delays
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} - Promise that resolves after the delay
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wrapper for fetch requests with retry logic
 * @param {string} url - The URL to fetch
 * @param {Object} options - Fetch options
 * @param {Object} retryOptions - Retry configuration
 * @returns {Promise} - Promise that resolves with the response
 */
async function fetchWithRetry(url, options = {}, retryOptions = {}) {
    return retryWithExponentialBackoff(async () => {
        const response = await fetch(url, options);
        
        // Check if response indicates rate limiting
        if (response.status === 429) {
            throw new Error(`HTTP ${response.status}: Too Many Requests`);
        }
        
        // Parse JSON response to check for JSON-RPC errors
        const result = await response.json();
        
        // Check for JSON-RPC errors that indicate rate limiting
        if (result.error && result.error.code === -32603 && 
            result.error.message && result.error.message.includes('429')) {
            throw new Error(`RPC request failed: HTTP 429: Too Many Requests`);
        }
        
        return result;
    }, retryOptions);
}

// Export functions
if (typeof module !== 'undefined' && module.exports) {
    // Node.js environment
    module.exports = {
        retryWithExponentialBackoff,
        defaultShouldRetry,
        sleep,
        fetchWithRetry
    };
} else {
    // Browser environment
    window.retryHelper = {
        retryWithExponentialBackoff,
        defaultShouldRetry,
        sleep,
        fetchWithRetry
    };
} 
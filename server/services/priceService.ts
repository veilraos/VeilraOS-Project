interface PriceCache {
  price: number;
  timestamp: number;
}

const priceCache = new Map<string, PriceCache>();
const CACHE_TTL_MS = 60000;
const FALLBACK_PRICES: Record<string, number> = {
  bitcoin: 42000,
  ethereum: 2500,
  solana: 100,
  binancecoin: 300,
};

export async function getCryptoPrice(coinId: string = 'bitcoin', vsCurrency: string = 'usd'): Promise<number> {
  const cacheKey = `${coinId}-${vsCurrency}`;
  const cached = priceCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.price;
  }

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=${vsCurrency}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      if (response.status === 429) {
        console.warn(`CoinGecko rate limited, using cached/fallback price for ${coinId}`);
        return cached?.price ?? FALLBACK_PRICES[coinId] ?? 1000;
      }
      throw new Error(`CoinGecko API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data[coinId] || !data[coinId][vsCurrency]) {
      throw new Error(`Price not found for ${coinId}/${vsCurrency}`);
    }
    
    const price = data[coinId][vsCurrency];
    priceCache.set(cacheKey, { price, timestamp: Date.now() });
    return price;
  } catch (error) {
    console.error('Error fetching crypto price:', error);
    if (cached) {
      console.warn(`Using cached price for ${coinId}: $${cached.price}`);
      return cached.price;
    }
    const fallback = FALLBACK_PRICES[coinId] ?? 1000;
    console.warn(`Using fallback price for ${coinId}: $${fallback}`);
    return fallback;
  }
}

export async function getMultiplePrices(coinIds: string[], vsCurrency: string = 'usd'): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const uncached: string[] = [];
  
  for (const coinId of coinIds) {
    const cacheKey = `${coinId}-${vsCurrency}`;
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      result[coinId] = cached.price;
    } else {
      uncached.push(coinId);
    }
  }
  
  if (uncached.length === 0) return result;
  
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${uncached.join(',')}&vs_currencies=${vsCurrency}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      for (const coinId of uncached) {
        result[coinId] = FALLBACK_PRICES[coinId] ?? 1000;
      }
      return result;
    }
    
    const data = await response.json();
    for (const coinId of uncached) {
      if (data[coinId]?.[vsCurrency]) {
        result[coinId] = data[coinId][vsCurrency];
        priceCache.set(`${coinId}-${vsCurrency}`, { price: result[coinId], timestamp: Date.now() });
      } else {
        result[coinId] = FALLBACK_PRICES[coinId] ?? 1000;
      }
    }
  } catch (error) {
    console.error('Error fetching multiple prices:', error);
    for (const coinId of uncached) {
      result[coinId] = FALLBACK_PRICES[coinId] ?? 1000;
    }
  }
  
  return result;
}

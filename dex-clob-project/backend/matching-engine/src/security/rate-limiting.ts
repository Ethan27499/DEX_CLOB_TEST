import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth-simple';

// Rate limiting store
interface RateLimitEntry {
  count: number;
  resetTime: number;
  blocked: boolean;
  blockUntil?: number;
}

// Different rate limits for different endpoints
export const RATE_LIMITS = {
  // Trading endpoints - more restrictive
  PLACE_ORDER: { requests: 10, window: 60 * 1000 }, // 10 requests per minute
  CANCEL_ORDER: { requests: 20, window: 60 * 1000 }, // 20 requests per minute
  SWAP: { requests: 5, window: 60 * 1000 }, // 5 swaps per minute
  
  // Liquidity endpoints
  ADD_LIQUIDITY: { requests: 5, window: 60 * 1000 }, // 5 requests per minute
  REMOVE_LIQUIDITY: { requests: 5, window: 60 * 1000 }, // 5 requests per minute
  
  // View endpoints - more lenient
  GET_ORDERS: { requests: 60, window: 60 * 1000 }, // 60 requests per minute
  GET_ORDERBOOK: { requests: 100, window: 60 * 1000 }, // 100 requests per minute
  GET_PRICES: { requests: 120, window: 60 * 1000 }, // 120 requests per minute
  
  // WebSocket connections
  WEBSOCKET: { requests: 5, window: 60 * 1000 }, // 5 connections per minute
  
  // Authentication
  LOGIN: { requests: 5, window: 15 * 60 * 1000 }, // 5 attempts per 15 minutes
  
  // Global fallback
  GLOBAL: { requests: 100, window: 60 * 1000 } // 100 requests per minute
} as const;

// Store for rate limits - in production, use Redis
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime && (!entry.blockUntil || now > entry.blockUntil)) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

// Get rate limit key
const getRateLimitKey = (req: AuthenticatedRequest, type: string): string => {
  const userId = req.user?.id;
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  
  // Use user ID if authenticated, otherwise use IP
  return `${type}:${userId || ip}`;
};

// Enhanced rate limiting middleware
export const createRateLimit = (
  limitType: keyof typeof RATE_LIMITS,
  options?: {
    skipSuccessfulRequests?: boolean;
    skipFailedRequests?: boolean;
    blockDuration?: number; // Block duration in ms after hitting limit
    keyGenerator?: (req: AuthenticatedRequest) => string;
  }
) => {
  const limit = RATE_LIMITS[limitType];
  const blockDuration = options?.blockDuration || 5 * 60 * 1000; // 5 minutes default
  
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const key = options?.keyGenerator ? options.keyGenerator(req) : getRateLimitKey(req, limitType);
    const now = Date.now();
    
    let entry = rateLimitStore.get(key);
    
    // Initialize or reset if window expired
    if (!entry || now > entry.resetTime) {
      entry = {
        count: 0,
        resetTime: now + limit.window,
        blocked: false
      };
    }
    
    // Check if currently blocked
    if (entry.blocked && entry.blockUntil && now < entry.blockUntil) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded - temporarily blocked',
        retryAfter: Math.ceil((entry.blockUntil - now) / 1000),
        type: 'BLOCKED'
      });
    }
    
    // Reset block if expired
    if (entry.blocked && entry.blockUntil && now >= entry.blockUntil) {
      entry.blocked = false;
      entry.blockUntil = undefined;
      entry.count = 0;
      entry.resetTime = now + limit.window;
    }
    
    // Check rate limit
    if (entry.count >= limit.requests) {
      // Block user for specified duration
      entry.blocked = true;
      entry.blockUntil = now + blockDuration;
      
      rateLimitStore.set(key, entry);
      
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil(blockDuration / 1000),
        type: 'RATE_LIMITED'
      });
    }
    
    // Increment counter
    entry.count++;
    rateLimitStore.set(key, entry);
    
    // Add rate limit headers
    res.set({
      'X-RateLimit-Limit': limit.requests.toString(),
      'X-RateLimit-Remaining': Math.max(0, limit.requests - entry.count).toString(),
      'X-RateLimit-Reset': Math.ceil(entry.resetTime / 1000).toString(),
      'X-RateLimit-Window': Math.ceil(limit.window / 1000).toString()
    });
    
    // Handle response-based cleanup
    const originalSend = res.send;
    res.send = function(data) {
      const shouldSkip = 
        (options?.skipSuccessfulRequests && res.statusCode < 400) ||
        (options?.skipFailedRequests && res.statusCode >= 400);
      
      if (shouldSkip) {
        // Decrement counter if we're skipping this request
        const currentEntry = rateLimitStore.get(key);
        if (currentEntry && currentEntry.count > 0) {
          currentEntry.count--;
          rateLimitStore.set(key, currentEntry);
        }
      }
      
      return originalSend.call(this, data);
    };
    
    next();
  };
};

// Progressive rate limiting - stricter limits for repeated violations
export const progressiveRateLimit = (baseLimit: keyof typeof RATE_LIMITS) => {
  const violationStore = new Map<string, { count: number, lastViolation: number }>();
  
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const key = getRateLimitKey(req, baseLimit);
    const violation = violationStore.get(key);
    const now = Date.now();
    
    // Reset violation count after 1 hour
    if (violation && now - violation.lastViolation > 60 * 60 * 1000) {
      violationStore.delete(key);
    }
    
    // Calculate progressive limits
    const violationCount = violation?.count || 0;
    const baseConfig = RATE_LIMITS[baseLimit];
    const multiplier = Math.max(1, violationCount);
    
    const adjustedLimit = {
      requests: Math.max(1, Math.floor(baseConfig.requests / multiplier)),
      window: baseConfig.window
    };
    
    // Apply rate limiting logic
    let entry = rateLimitStore.get(key);
    
    if (!entry || now > entry.resetTime) {
      entry = {
        count: 0,
        resetTime: now + adjustedLimit.window,
        blocked: false
      };
    }
    
    if (entry.count >= adjustedLimit.requests) {
      // Record violation
      const currentViolation = violationStore.get(key) || { count: 0, lastViolation: now };
      currentViolation.count++;
      currentViolation.lastViolation = now;
      violationStore.set(key, currentViolation);
      
      return res.status(429).json({
        success: false,
        error: 'Progressive rate limit exceeded',
        retryAfter: Math.ceil((entry.resetTime - now) / 1000),
        violationCount: currentViolation.count,
        adjustedLimit: adjustedLimit.requests
      });
    }
    
    entry.count++;
    rateLimitStore.set(key, entry);
    
    res.set({
      'X-RateLimit-Limit': adjustedLimit.requests.toString(),
      'X-RateLimit-Remaining': Math.max(0, adjustedLimit.requests - entry.count).toString(),
      'X-RateLimit-Reset': Math.ceil(entry.resetTime / 1000).toString(),
      'X-RateLimit-Violations': (violation?.count || 0).toString()
    });
    
    next();
  };
};

// Burst protection - allows short bursts but prevents sustained high traffic
export const burstProtection = (
  shortWindow: { requests: number, window: number },
  longWindow: { requests: number, window: number }
) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const key = getRateLimitKey(req, 'GLOBAL');
    const now = Date.now();
    
    const shortKey = `short:${key}`;
    const longKey = `long:${key}`;
    
    // Check short window (burst)
    let shortEntry = rateLimitStore.get(shortKey);
    if (!shortEntry || now > shortEntry.resetTime) {
      shortEntry = {
        count: 0,
        resetTime: now + shortWindow.window,
        blocked: false
      };
    }
    
    // Check long window (sustained)
    let longEntry = rateLimitStore.get(longKey);
    if (!longEntry || now > longEntry.resetTime) {
      longEntry = {
        count: 0,
        resetTime: now + longWindow.window,
        blocked: false
      };
    }
    
    // Check both limits
    if (shortEntry.count >= shortWindow.requests) {
      return res.status(429).json({
        success: false,
        error: 'Burst limit exceeded',
        retryAfter: Math.ceil((shortEntry.resetTime - now) / 1000),
        type: 'BURST_LIMIT'
      });
    }
    
    if (longEntry.count >= longWindow.requests) {
      return res.status(429).json({
        success: false,
        error: 'Sustained rate limit exceeded',
        retryAfter: Math.ceil((longEntry.resetTime - now) / 1000),
        type: 'SUSTAINED_LIMIT'
      });
    }
    
    // Increment both counters
    shortEntry.count++;
    longEntry.count++;
    
    rateLimitStore.set(shortKey, shortEntry);
    rateLimitStore.set(longKey, longEntry);
    
    res.set({
      'X-RateLimit-Burst-Limit': shortWindow.requests.toString(),
      'X-RateLimit-Burst-Remaining': Math.max(0, shortWindow.requests - shortEntry.count).toString(),
      'X-RateLimit-Sustained-Limit': longWindow.requests.toString(),
      'X-RateLimit-Sustained-Remaining': Math.max(0, longWindow.requests - longEntry.count).toString()
    });
    
    next();
  };
};

// IP-based rate limiting for public endpoints
export const ipRateLimit = (requests: number, windowMs: number) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const key = `ip:${ip}`;
    const now = Date.now();
    
    let entry = rateLimitStore.get(key);
    
    if (!entry || now > entry.resetTime) {
      entry = {
        count: 0,
        resetTime: now + windowMs,
        blocked: false
      };
    }
    
    if (entry.count >= requests) {
      return res.status(429).json({
        success: false,
        error: 'IP rate limit exceeded',
        retryAfter: Math.ceil((entry.resetTime - now) / 1000)
      });
    }
    
    entry.count++;
    rateLimitStore.set(key, entry);
    
    next();
  };
};

// Get rate limit status for debugging
export const getRateLimitStatus = (req: AuthenticatedRequest, limitType: string) => {
  const key = getRateLimitKey(req, limitType);
  const entry = rateLimitStore.get(key);
  const limit = RATE_LIMITS[limitType as keyof typeof RATE_LIMITS] || RATE_LIMITS.GLOBAL;
  
  if (!entry) {
    return {
      requests: 0,
      limit: limit.requests,
      remaining: limit.requests,
      resetTime: Date.now() + limit.window,
      blocked: false
    };
  }
  
  return {
    requests: entry.count,
    limit: limit.requests,
    remaining: Math.max(0, limit.requests - entry.count),
    resetTime: entry.resetTime,
    blocked: entry.blocked,
    blockUntil: entry.blockUntil
  };
};

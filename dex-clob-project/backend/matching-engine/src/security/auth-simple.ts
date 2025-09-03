import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// Extended Request interface to include user info
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    address: string;
    role: 'user' | 'admin';
    permissions: string[];
  };
  sessionId?: string;
}

// Simple JWT implementation without external dependencies
class SimpleJWT {
  private static secret = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');

  static sign(payload: any, expiresIn: string = '24h'): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.parseTimeToSeconds(expiresIn);
    
    const fullPayload = { ...payload, iat: now, exp };
    
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
    
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');
    
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  static verify(token: string): any {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token format');
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    
    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', this.secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');
    
    if (signature !== expectedSignature) {
      throw new Error('Invalid signature');
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());
    
    // Check expiration
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      throw new Error('Token expired');
    }

    return payload;
  }

  private static parseTimeToSeconds(time: string): number {
    const match = time.match(/^(\d+)([hmsd])$/);
    if (!match) return 24 * 60 * 60; // Default 24 hours
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 60 * 60;
      case 'd': return value * 24 * 60 * 60;
      default: return 24 * 60 * 60;
    }
  }
}

// Simple password hashing without bcrypt
class SimpleAuth {
  static async hashPassword(password: string): Promise<string> {
    const salt = crypto.randomBytes(32).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
  }

  static async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const [salt, hash] = storedHash.split(':');
    const hashToVerify = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return hash === hashToVerify;
  }
}

// User roles and permissions
export const PERMISSIONS = {
  TRADE: 'trade',
  VIEW_ORDERS: 'view_orders',
  CANCEL_ORDERS: 'cancel_orders',
  ADD_LIQUIDITY: 'add_liquidity',
  REMOVE_LIQUIDITY: 'remove_liquidity',
  VIEW_ANALYTICS: 'view_analytics',
  ADMIN_ACCESS: 'admin_access'
} as const;

export const ROLES = {
  USER: {
    name: 'user',
    permissions: [
      PERMISSIONS.TRADE,
      PERMISSIONS.VIEW_ORDERS,
      PERMISSIONS.CANCEL_ORDERS,
      PERMISSIONS.ADD_LIQUIDITY,
      PERMISSIONS.REMOVE_LIQUIDITY,
      PERMISSIONS.VIEW_ANALYTICS
    ] as string[]
  },
  ADMIN: {
    name: 'admin',
    permissions: Object.values(PERMISSIONS) as string[]
  }
} as const;

// Session management
const activeSessions = new Map<string, {
  userId: string;
  address: string;
  createdAt: Date;
  lastActivity: Date;
  ipAddress: string;
}>();

// Rate limiting by user
const userRateLimits = new Map<string, {
  requests: number;
  resetTime: number;
}>();

// Generate tokens
export const generateAccessToken = (payload: any): string => {
  return SimpleJWT.sign(payload, '24h');
};

export const generateRefreshToken = (payload: any): string => {
  return SimpleJWT.sign(payload, '7d');
};

// Verify JWT token
export const verifyToken = (token: string): any => {
  return SimpleJWT.verify(token);
};

// Session management functions
export const createSession = (userId: string, address: string, ipAddress: string): string => {
  const sessionId = crypto.randomUUID();
  activeSessions.set(sessionId, {
    userId,
    address,
    createdAt: new Date(),
    lastActivity: new Date(),
    ipAddress
  });
  return sessionId;
};

export const validateSession = (sessionId: string): boolean => {
  const session = activeSessions.get(sessionId);
  if (!session) return false;

  // Check if session is expired (24 hours)
  const now = new Date();
  const hoursSinceCreation = (now.getTime() - session.createdAt.getTime()) / (1000 * 60 * 60);
  
  if (hoursSinceCreation > 24) {
    activeSessions.delete(sessionId);
    return false;
  }

  // Update last activity
  session.lastActivity = now;
  return true;
};

export const destroySession = (sessionId: string): void => {
  activeSessions.delete(sessionId);
};

// Authentication middleware
export const authenticate = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    const sessionId = req.headers['x-session-id'] as string;

    // Check for JWT token
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = verifyToken(token);
      
      req.user = {
        id: decoded.userId,
        address: decoded.address,
        role: decoded.role || 'user',
        permissions: ROLES[decoded.role?.toUpperCase() as keyof typeof ROLES]?.permissions || ROLES.USER.permissions
      };
      
      return next();
    }

    // Check for session-based auth
    if (sessionId && validateSession(sessionId)) {
      const session = activeSessions.get(sessionId);
      if (session) {
        req.user = {
          id: session.userId,
          address: session.address,
          role: 'user',
          permissions: ROLES.USER.permissions
        };
        req.sessionId = sessionId;
        return next();
      }
    }

    // No valid authentication found
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });

  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({
      success: false,
      error: 'Invalid authentication'
    });
  }
};

// Optional authentication (for public endpoints that benefit from user context)
export const optionalAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    const sessionId = req.headers['x-session-id'] as string;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = verifyToken(token);
        req.user = {
          id: decoded.userId,
          address: decoded.address,
          role: decoded.role || 'user',
          permissions: ROLES[decoded.role?.toUpperCase() as keyof typeof ROLES]?.permissions || ROLES.USER.permissions
        };
      } catch (error) {
        // Invalid token, but continue without user context
      }
    } else if (sessionId && validateSession(sessionId)) {
      const session = activeSessions.get(sessionId);
      if (session) {
        req.user = {
          id: session.userId,
          address: session.address,
          role: 'user',
          permissions: ROLES.USER.permissions
        };
        req.sessionId = sessionId;
      }
    }

    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

// Permission checking middleware
export const requirePermission = (permission: string) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    if (!req.user.permissions.includes(permission)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions'
      });
    }

    next();
  };
};

// Rate limiting by user
export const userRateLimit = (maxRequests: number, windowMs: number) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = req.user?.id || req.ip;
    const now = Date.now();
    
    const userLimit = userRateLimits.get(userId);
    
    if (!userLimit || now > userLimit.resetTime) {
      userRateLimits.set(userId, {
        requests: 1,
        resetTime: now + windowMs
      });
      return next();
    }
    
    if (userLimit.requests >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil((userLimit.resetTime - now) / 1000)
      });
    }
    
    userLimit.requests++;
    next();
  };
};

// Hash password utility
export const hashPassword = async (password: string): Promise<string> => {
  return SimpleAuth.hashPassword(password);
};

// Verify password utility
export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  return SimpleAuth.verifyPassword(password, hash);
};

// Generate API key
export const generateApiKey = (): string => {
  return 'dex_' + crypto.randomBytes(32).toString('hex');
};

// Validate API key format
export const isValidApiKeyFormat = (apiKey: string): boolean => {
  return /^dex_[a-f0-9]{64}$/.test(apiKey);
};

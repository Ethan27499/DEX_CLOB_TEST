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

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || crypto.randomBytes(64).toString('hex');

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
};

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

// Simple JWT-like token implementation using crypto
export const generateAccessToken = (payload: any): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadStr = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payloadStr}`).digest('base64url');
  return `${header}.${payloadStr}.${signature}`;
};

export const generateRefreshToken = (payload: any): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadStr = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', REFRESH_TOKEN_SECRET).update(`${header}.${payloadStr}`).digest('base64url');
  return `${header}.${payloadStr}.${signature}`;
};

// Verify JWT token
export const verifyToken = (token: string): any => {
  try {
    const [header, payload, signature] = token.split('.');
    const expectedSignature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
    
    if (signature !== expectedSignature) {
      throw new Error('Invalid signature');
    }
    
    const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (decodedPayload.exp < Date.now()) {
      throw new Error('Token expired');
    }
    
    return decodedPayload;
  } catch (error) {
    throw new Error('Invalid token');
  }
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

// Hash password utility using crypto
export const hashPassword = async (password: string): Promise<string> => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
};

// Verify password utility using crypto
export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  const [salt, originalHash] = hash.split(':');
  const hashBuffer = crypto.scryptSync(password, salt, 64);
  return originalHash === hashBuffer.toString('hex');
};

// Generate API key
export const generateApiKey = (): string => {
  return 'dex_' + crypto.randomBytes(32).toString('hex');
};

// Validate API key format
export const isValidApiKeyFormat = (apiKey: string): boolean => {
  return /^dex_[a-f0-9]{64}$/.test(apiKey);
};

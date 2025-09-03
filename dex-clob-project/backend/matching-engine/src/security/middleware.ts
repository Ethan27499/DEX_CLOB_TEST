import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { AuthenticatedRequest } from './auth-simple';

// Security headers middleware
export const securityHeaders = () => {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "wss:", "ws:"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false, // For development
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
  });
};

// Request size limiting
export const requestSizeLimit = (maxSize: string = '10mb') => {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = req.headers['content-length'];
    
    if (contentLength) {
      const size = parseInt(contentLength);
      const maxBytes = parseSize(maxSize);
      
      if (size > maxBytes) {
        return res.status(413).json({
          success: false,
          error: 'Request too large',
          maxSize
        });
      }
    }
    
    next();
  };
};

// Parse size string to bytes
const parseSize = (size: string): number => {
  const units: { [key: string]: number } = {
    'b': 1,
    'kb': 1024,
    'mb': 1024 * 1024,
    'gb': 1024 * 1024 * 1024
  };
  
  const match = size.toLowerCase().match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb)$/);
  if (!match) return 10 * 1024 * 1024; // Default 10MB
  
  const value = parseFloat(match[1]);
  const unit = match[2];
  
  return Math.floor(value * units[unit]);
};

// IP whitelist/blacklist
const blacklistedIPs = new Set<string>();
const whitelistedIPs = new Set<string>();

export const ipFilter = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.connection.remoteAddress || '';
    
    // Check blacklist first
    if (blacklistedIPs.has(ip)) {
      return res.status(403).json({
        success: false,
        error: 'IP address blocked'
      });
    }
    
    // If whitelist is not empty, check whitelist
    if (whitelistedIPs.size > 0 && !whitelistedIPs.has(ip)) {
      return res.status(403).json({
        success: false,
        error: 'IP address not allowed'
      });
    }
    
    next();
  };
};

// Add IP to blacklist
export const blacklistIP = (ip: string): void => {
  blacklistedIPs.add(ip);
};

// Remove IP from blacklist
export const removeFromBlacklist = (ip: string): void => {
  blacklistedIPs.delete(ip);
};

// Add IP to whitelist
export const whitelistIP = (ip: string): void => {
  whitelistedIPs.add(ip);
};

// Request logging for security monitoring
export const securityLogger = () => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const start = Date.now();
    const userAgent = req.get('User-Agent') || 'unknown';
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userId = req.user?.id || 'anonymous';
    
    // Log suspicious patterns
    const suspiciousPatterns = [
      /script/i,
      /alert\(/i,
      /document\./i,
      /window\./i,
      /eval\(/i,
      /javascript:/i,
      /vbscript:/i,
      /onload/i,
      /onerror/i,
      /<iframe/i,
      /<object/i,
      /<embed/i,
      /union.*select/i,
      /drop.*table/i,
      /insert.*into/i,
      /delete.*from/i
    ];
    
    const requestString = JSON.stringify({
      url: req.url,
      query: req.query,
      body: req.body,
      headers: req.headers
    });
    
    const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(requestString));
    
    if (isSuspicious) {
      console.warn('🚨 SUSPICIOUS REQUEST DETECTED:', {
        timestamp: new Date().toISOString(),
        ip,
        userId,
        method: req.method,
        url: req.originalUrl,
        userAgent,
        body: req.body,
        query: req.query
      });
    }
    
    // Enhanced logging for authenticated users
    const originalSend = res.send;
    res.send = function(data) {
      const duration = Date.now() - start;
      const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
      
      console[logLevel](`${req.method} ${req.originalUrl}`, {
        timestamp: new Date().toISOString(),
        ip,
        userId,
        userAgent,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        suspicious: isSuspicious
      });
      
      return originalSend.call(this, data);
    };
    
    next();
  };
};

// CORS configuration for production
export const corsConfig = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Define allowed origins
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:8080',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:8080'
      // Add production domains here
    ];
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'X-Session-ID',
    'X-API-Key'
  ]
};

// Error handling middleware
export const errorHandler = () => {
  return (error: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('❌ ERROR:', {
      timestamp: new Date().toISOString(),
      error: error.message,
      stack: error.stack,
      url: req.originalUrl,
      method: req.method,
      ip: req.ip
    });
    
    // Don't leak error details in production
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    res.status(500).json({
      success: false,
      error: isDevelopment ? error.message : 'Internal Server Error',
      ...(isDevelopment && { stack: error.stack })
    });
  };
};

// Request timeout middleware
export const requestTimeout = (timeoutMs: number = 30000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setTimeout(timeoutMs, () => {
      res.status(408).json({
        success: false,
        error: 'Request timeout'
      });
    });
    
    next();
  };
};

// Prevent parameter pollution
export const parameterPollutionProtection = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Check for duplicate parameters
    const urlParts = req.url.split('?');
    if (urlParts.length > 1) {
      const queryString = urlParts[1];
      const params = queryString.split('&');
      const paramNames = new Set<string>();
      
      for (const param of params) {
        const name = param.split('=')[0];
        if (paramNames.has(name)) {
          return res.status(400).json({
            success: false,
            error: 'Parameter pollution detected'
          });
        }
        paramNames.add(name);
      }
    }
    
    next();
  };
};

// Security monitoring and alerting
export class SecurityMonitor {
  private static instance: SecurityMonitor;
  private alerts: Array<{ type: string; message: string; timestamp: Date; ip: string }> = [];
  private readonly maxAlerts = 1000;
  
  static getInstance(): SecurityMonitor {
    if (!SecurityMonitor.instance) {
      SecurityMonitor.instance = new SecurityMonitor();
    }
    return SecurityMonitor.instance;
  }
  
  addAlert(type: string, message: string, ip: string): void {
    this.alerts.push({
      type,
      message,
      timestamp: new Date(),
      ip
    });
    
    // Keep only recent alerts
    if (this.alerts.length > this.maxAlerts) {
      this.alerts = this.alerts.slice(-this.maxAlerts);
    }
    
    // Log critical alerts
    if (type === 'CRITICAL') {
      console.error('🚨 CRITICAL SECURITY ALERT:', message, 'IP:', ip);
    }
  }
  
  getRecentAlerts(minutes: number = 60): Array<{ type: string; message: string; timestamp: Date; ip: string }> {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    return this.alerts.filter(alert => alert.timestamp > cutoff);
  }
  
  getAlertsByIP(ip: string, minutes: number = 60): Array<{ type: string; message: string; timestamp: Date; ip: string }> {
    return this.getRecentAlerts(minutes).filter(alert => alert.ip === ip);
  }
}

// Export all security middleware as a combined setup function
export const setupSecurity = () => {
  return [
    requestTimeout(),
    securityHeaders(),
    requestSizeLimit(),
    ipFilter(),
    parameterPollutionProtection(),
    securityLogger(),
    errorHandler()
  ];
};

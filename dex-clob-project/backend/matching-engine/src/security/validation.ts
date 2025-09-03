import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

// Input validation schemas
export const orderSchema = Joi.object({
  side: Joi.string().valid('buy', 'sell').required(),
  amount: Joi.number().positive().max(1000000).required(),
  price: Joi.number().positive().max(1000000).required(),
  tokenIn: Joi.string().alphanum().min(3).max(10).required(),
  tokenOut: Joi.string().alphanum().min(3).max(10).required(),
  userId: Joi.string().alphanum().min(1).max(50).required(),
  timestamp: Joi.number().optional()
});

export const swapSchema = Joi.object({
  tokenIn: Joi.string().alphanum().min(3).max(10).required(),
  tokenOut: Joi.string().alphanum().min(3).max(10).required(),
  amountIn: Joi.number().positive().max(1000000).required(),
  userId: Joi.string().alphanum().min(1).max(50).required(),
  slippage: Joi.number().min(0).max(50).optional().default(1)
});

export const liquiditySchema = Joi.object({
  tokenA: Joi.string().alphanum().min(3).max(10).required(),
  tokenB: Joi.string().alphanum().min(3).max(10).required(),
  amountA: Joi.number().positive().max(1000000).required(),
  amountB: Joi.number().positive().max(1000000).required(),
  userId: Joi.string().alphanum().min(1).max(50).required()
});

export const userIdSchema = Joi.object({
  userId: Joi.string().alphanum().min(1).max(50).required()
});

// Basic sanitization without external dependencies
export const sanitizeInput = (input: any): any => {
  if (typeof input === 'string') {
    // Remove potential XSS vectors
    return input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .replace(/[<>'"&]/g, '')
      .trim();
  }
  if (typeof input === 'object' && input !== null) {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(input)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }
  return input;
};

// Validation middleware factory
export const validateRequest = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Sanitize input first
      const sanitizedBody = sanitizeInput(req.body);
      const sanitizedQuery = sanitizeInput(req.query);
      const sanitizedParams = sanitizeInput(req.params);

      // Validate request body
      if (Object.keys(sanitizedBody).length > 0) {
        const { error, value } = schema.validate(sanitizedBody, {
          abortEarly: false,
          stripUnknown: true
        });

        if (error) {
          return res.status(400).json({
            success: false,
            error: 'Validation Error',
            details: error.details.map(detail => ({
              field: detail.path.join('.'),
              message: detail.message
            }))
          });
        }

        req.body = value;
      }

      // Validate query parameters if schema supports them
      if (Object.keys(sanitizedQuery).length > 0) {
        const queryResult = schema.validate(sanitizedQuery, {
          abortEarly: false,
          stripUnknown: true,
          allowUnknown: true
        });

        if (queryResult.error) {
          return res.status(400).json({
            success: false,
            error: 'Query Validation Error',
            details: queryResult.error.details.map(detail => ({
              field: detail.path.join('.'),
              message: detail.message
            }))
          });
        }
      }

      // Update sanitized data
      req.query = sanitizedQuery;
      req.params = sanitizedParams;

      next();
    } catch (error) {
      console.error('Validation middleware error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal Server Error'
      });
    }
  };
};

// Additional security validations
export const validateOrderSize = (req: Request, res: Response, next: NextFunction) => {
  const { amount, price } = req.body;
  const totalValue = amount * price;

  if (totalValue > 100000) { // Max order value
    return res.status(400).json({
      success: false,
      error: 'Order value exceeds maximum limit'
    });
  }

  if (amount < 0.001) { // Min order size
    return res.status(400).json({
      success: false,
      error: 'Order amount below minimum'
    });
  }

  next();
};

export const validateTokenPair = (req: Request, res: Response, next: NextFunction) => {
  const { tokenIn, tokenOut, tokenA, tokenB } = req.body;
  
  // Check for same token pair
  if (tokenIn === tokenOut || tokenA === tokenB) {
    return res.status(400).json({
      success: false,
      error: 'Cannot trade same token pair'
    });
  }

  // Validate against supported tokens
  const supportedTokens = ['ETH', 'USDC', 'USDT', 'DAI', 'WBTC', 'BTC'];
  const tokens = [tokenIn, tokenOut, tokenA, tokenB].filter(Boolean);
  
  for (const token of tokens) {
    if (!supportedTokens.includes(token)) {
      return res.status(400).json({
        success: false,
        error: `Unsupported token: ${token}`
      });
    }
  }

  next();
};

// SQL Injection protection
export const sanitizeSQLInput = (input: string): string => {
  return input.replace(/['"\\;]/g, '').trim();
};

// XSS protection
export const sanitizeHTML = (input: string): string => {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/[<>'"&]/g, '');
};

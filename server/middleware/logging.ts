import winston from 'winston';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

// Extend Request type to include request ID and organization context
declare global {
  namespace Express {
    interface Request {
      requestId: string;
      organizationId?: string;
      uid?: string;
      startTime: number;
    }
  }
}

/**
 * SMB-Enhanced Structured Logger
 * Provides consistent, searchable logging across the entire application
 */
class StructuredLogger {
  private logger: winston.Logger;

  constructor() {
    // Create Winston logger with multiple formats for different environments
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { 
        service: 'clasio-document-management',
        version: process.env.npm_package_version || '1.0.0'
      },
      transports: [
        // Console output for development and container logs
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({ format: 'HH:mm:ss' }),
            winston.format.printf(({ level, message, timestamp, requestId, organizationId, uid, ...meta }) => {
              const context = [
                requestId && `req:${String(requestId).slice(0, 8)}`,
                organizationId && `org:${String(organizationId).slice(0, 8)}`,
                uid && `user:${String(uid).slice(0, 8)}`
              ].filter(Boolean).join(' ');
              
              const metaStr = Object.keys(meta).length > 0 ? 
                JSON.stringify(meta, null, 0) : '';
              
              return `${timestamp} [${level}] ${context ? `[${context}] ` : ''}${message} ${metaStr}`;
            })
          )
        }),
        // File output for persistent logs in production
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
          format: winston.format.json()
        }),
        new winston.transports.File({
          filename: 'logs/combined.log',
          format: winston.format.json()
        })
      ]
    });
  }

  /**
   * Log info message with context
   */
  public info(message: string, meta: any = {}, req?: Request): void {
    this.logger.info(message, this.enrichMeta(meta, req));
  }

  /**
   * Log warning with context
   */
  public warn(message: string, meta: any = {}, req?: Request): void {
    this.logger.warn(message, this.enrichMeta(meta, req));
  }

  /**
   * Log error with context and stack trace
   */
  public error(message: string, error?: Error | any, meta: any = {}, req?: Request): void {
    this.logger.error(message, this.enrichMeta({
      ...meta,
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : error
    }, req));
  }

  /**
   * Log debug information (only in development)
   */
  public debug(message: string, meta: any = {}, req?: Request): void {
    this.logger.debug(message, this.enrichMeta(meta, req));
  }

  /**
   * SMB-Enhanced: Log business events for audit and analytics
   */
  public business(event: string, data: any = {}, req?: Request): void {
    this.logger.info(`Business Event: ${event}`, this.enrichMeta({
      businessEvent: true,
      eventType: event,
      ...data
    }, req));
  }

  /**
   * SMB-Enhanced: Log security events
   */
  public security(event: string, data: any = {}, req?: Request): void {
    this.logger.warn(`Security Event: ${event}`, this.enrichMeta({
      securityEvent: true,
      eventType: event,
      ...data
    }, req));
  }

  /**
   * Enrich metadata with request context
   */
  private enrichMeta(meta: any = {}, req?: Request): any {
    if (!req) return meta;

    return {
      ...meta,
      requestId: req.requestId,
      organizationId: req.organizationId,
      uid: req.uid,
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    };
  }
}

// Create singleton logger instance
export const logger = new StructuredLogger();

/**
 * SMB-Enhanced: Request ID and timing middleware
 * Adds unique request ID and tracks request duration
 */
export function requestLoggingMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Generate unique request ID
    req.requestId = uuidv4();
    req.startTime = Date.now();
    
    // Set request ID header for client debugging
    res.setHeader('X-Request-ID', req.requestId);

    // Log incoming request
    logger.info('Request started', {
      method: req.method,
      url: req.url,
      query: req.query,
      headers: {
        contentType: req.get('Content-Type'),
        authorization: req.get('Authorization') ? '[REDACTED]' : undefined,
        userAgent: req.get('User-Agent')
      }
    }, req);

    // Capture response details
    const originalSend = res.send;
    res.send = function(body) {
      try {
        const duration = Date.now() - req.startTime;
        
        // Safely compute response size
        let responseSize = 0;
        try {
          if (Buffer.isBuffer(body)) {
            responseSize = body.length;
          } else if (typeof body === 'string') {
            responseSize = body.length;
          } else if (body !== undefined) {
            responseSize = JSON.stringify(body).length;
          }
        } catch (sizeError) {
          // If size computation fails, log 0 and continue
          responseSize = 0;
        }
        
        // Log response
        logger.info('Request completed', {
          statusCode: res.statusCode,
          duration: `${duration}ms`,
          responseSize
        }, req);

        // Log slow requests as warnings
        if (duration > 5000) {
          logger.warn('Slow request detected', {
            duration: `${duration}ms`,
            threshold: '5000ms'
          }, req);
        }

        return originalSend.call(this, body);
      } finally {
        // Ensure original response is sent even if logging fails
        if (arguments.length && !res.headersSent) {
          return originalSend.call(this, body);
        }
      }
    };

    next();
  };
}

/**
 * SMB-Enhanced: Error logging middleware
 * Captures and logs all Express errors
 */
export function errorLoggingMiddleware() {
  return (err: Error, req: Request, res: Response, next: NextFunction) => {
    // Log error with full context
    logger.error('Request error', err, {
      statusCode: res.statusCode || 500,
      duration: Date.now() - req.startTime
    }, req);

    // If headers not sent, send error response
    if (!res.headersSent) {
      const isDevelopment = process.env.NODE_ENV === 'development';
      
      res.status(500).json({
        error: 'Internal server error',
        requestId: req.requestId,
        ...(isDevelopment && {
          message: err.message,
          stack: err.stack
        })
      });
    }

    next(err);
  };
}

/**
 * Organization context middleware - populate organizationId from auth
 */
export function organizationContextMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    // organizationId should already be set by auth middleware
    // This middleware just logs when context is available
    if (req.organizationId && req.uid) {
      logger.debug('Organization context available', {
        hasOrganization: !!req.organizationId,
        hasUser: !!req.uid
      }, req);
    }
    next();
  };
}
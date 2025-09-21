import * as Sentry from '@sentry/node';
import { Request, Response, NextFunction } from 'express';
import { logger } from './logging';

/**
 * SMB-Enhanced Sentry Configuration
 * Enterprise-grade error tracking and performance monitoring
 */
export function initializeSentry() {
  // Only initialize Sentry if DSN is provided
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info('Sentry not initialized - SENTRY_DSN not provided');
    return;
  }

  const environment = process.env.NODE_ENV || 'development';
  const release = process.env.npm_package_version || 'unknown';
  
  Sentry.init({
    dsn,
    environment,
    release: `clasio-document-management@${release}`,
    
    // Performance monitoring for SMB apps
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
    
    // Profiling for performance insights
    profilesSampleRate: environment === 'production' ? 0.1 : 1.0,
    integrations: [
      // HTTP integration for request tracking  
      Sentry.httpIntegration(),
      // Express integration
      Sentry.expressIntegration(),
    ],

    // Enhanced error filtering for SMB needs
    beforeSend(event, hint) {
      // Filter out common non-critical errors
      const error = hint.originalException;
      
      if (error instanceof Error) {
        // Skip client disconnect errors
        if (error.message.includes('ECONNRESET') || 
            error.message.includes('EPIPE') ||
            error.message.includes('Client closed connection')) {
          return null;
        }
        
        // Skip rate limit errors (these are business logic, not bugs)
        if (error.message.includes('Rate limit exceeded') ||
            error.message.includes('Quota exceeded')) {
          return null;
        }
      }

      // Enhance event with SMB context
      if (event.contexts) {
        event.contexts.business = {
          type: 'SMB Document Management',
          feature_set: 'Enterprise',
          multi_tenant: true
        };
      }

      return event;
    },

    // Tag all events for better filtering
    initialScope: {
      tags: {
        component: 'clasio-backend',
        architecture: 'fullstack-js'
      }
    }
  });

  logger.info('Sentry initialized', {
    environment,
    release,
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0
  });
}

/**
 * SMB-Enhanced: Organization context middleware for Sentry (v10+ compatible)
 * Sets per-request context that will be captured by setupExpressErrorHandler
 */
export function sentryContextMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Only set context if Sentry is initialized
    if (!process.env.SENTRY_DSN) {
      return next();
    }
    
    // Use configureScope to set context for the current request
    Sentry.configureScope((scope) => {
      // Set request-specific tags and context
      scope.setTag('requestId', req.requestId);
      scope.setContext('http', {
        method: req.method,
        url: req.url,
        query: req.query,
        headers: {
          userAgent: req.get('User-Agent'),
          contentType: req.get('Content-Type')
        },
        ip: req.ip
      });

      // Set organization context for SMB multi-tenancy
      if (req.organizationId) {
        scope.setTag('organizationId', req.organizationId);
        scope.setContext('organization', {
          id: req.organizationId,
          segment: 'SMB'
        });
      }

      // Set user context
      if (req.uid) {
        scope.setUser({
          id: req.uid,
          segment: 'SMB'
        });
      }
    });

    next();
  };
}

/**
 * SMB-Enhanced: Sentry error handling middleware
 * Captures errors and sends to Sentry with enhanced context
 */
export function sentryErrorMiddleware() {
  return (err: Error, req: Request, res: Response, next: NextFunction) => {
    // Add extra context for SMB errors
    Sentry.withScope((scope) => {
      scope.setLevel('error');
      scope.setTag('handled', true);
      scope.setContext('error_details', {
        statusCode: res.statusCode || 500,
        requestDuration: Date.now() - req.startTime,
        organization: req.organizationId,
        user: req.uid
      });

      // Capture the error
      Sentry.captureException(err);
    });

    next(err);
  };
}

/**
 * Capture business exception with enhanced context
 */
export function captureBusinessException(
  error: Error, 
  context: any = {}, 
  req?: Request
): void {
  Sentry.withScope((scope) => {
    scope.setLevel('error');
    scope.setTag('errorType', 'business');
    
    if (req) {
      scope.setTag('requestId', req.requestId);
      scope.setTag('organizationId', req.organizationId);
    }
    
    scope.setContext('business_context', context);
    Sentry.captureException(error);
  });
}

/**
 * Capture security event
 */
export function captureSecurityEvent(
  message: string,
  level: 'info' | 'warning' | 'error' = 'warning',
  context: any = {},
  req?: Request
): void {
  Sentry.withScope((scope) => {
    scope.setLevel(level);
    scope.setTag('eventType', 'security');
    
    if (req) {
      scope.setTag('requestId', req.requestId);
      scope.setTag('organizationId', req.organizationId);
      scope.setContext('request_context', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        method: req.method,
        url: req.url
      });
    }
    
    scope.setContext('security_context', context);
    Sentry.captureMessage(message);
  });
}

// Export Sentry for direct usage where needed
export { Sentry };

/**
 * SMB-Enhanced: Sentry request middleware (Sentry v8+ compatible)
 */
export function sentryExpressRequestMiddleware() {
  if (!process.env.SENTRY_DSN) {
    return (req: any, res: any, next: any) => next();
  }
  
  // For Sentry v8+, use a custom implementation
  return (req: Request, res: Response, next: NextFunction) => {
    // Initialize new scope for this request
    Sentry.withScope(() => {
      // Set basic request info
      Sentry.getCurrentScope().setContext('http', {
        method: req.method,
        url: req.url,
        query: req.query,
        headers: req.headers,
        ip: req.ip
      });
      
      next();
    });
  };
}

/**
 * SMB-Enhanced: Sentry Express error middleware (Sentry v8+ compatible)  
 */
export function sentryExpressErrorMiddleware() {
  if (!process.env.SENTRY_DSN) {
    return (err: any, req: any, res: any, next: any) => next(err);
  }
  
  return (err: Error, req: Request, res: Response, next: NextFunction) => {
    // Capture exception with request context
    Sentry.withScope((scope) => {
      scope.setLevel('error');
      scope.setContext('express_error', {
        message: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        requestId: req.requestId,
        organizationId: req.organizationId,
        userId: req.uid
      });
      
      Sentry.captureException(err);
    });
    
    next(err);
  };
}
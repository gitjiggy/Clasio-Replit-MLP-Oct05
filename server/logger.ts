/**
 * Token 5/8: Structured Logging System
 * 
 * Provides enterprise-grade JSON logging with:
 * - Correlation IDs (reqId) across all operations
 * - Tenant context tracking
 * - PII sanitization
 * - Request metrics integration
 * - Searchable log fields
 */

import { randomUUID } from 'crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  msg: string;
  reqId?: string;
  tenantId?: string;
  userId?: string;
  route?: string;
  method?: string;
  status?: number;
  latencyMs?: number;
  workerId?: string;
  jobId?: string;
  jobType?: string;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  metadata?: Record<string, any>;
}

/**
 * PII Sanitization - removes sensitive data from logs
 */
function sanitizeForLogging(data: any): any {
  if (typeof data !== 'object' || data === null) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(sanitizeForLogging);
  }

  const sanitized: any = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    
    // Sanitize sensitive fields
    if (lowerKey.includes('password') || 
        lowerKey.includes('token') || 
        lowerKey.includes('secret') || 
        lowerKey.includes('key') ||
        lowerKey.includes('authorization') ||
        lowerKey.includes('cookie') ||
        lowerKey === 'ssn' ||
        lowerKey === 'phone' ||
        lowerKey.includes('email')) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeForLogging(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

/**
 * Structured Logger with JSON output
 */
class StructuredLogger {
  private context: Partial<StructuredLogEntry> = {};

  /**
   * Set persistent context for this logger instance
   */
  setContext(context: Partial<StructuredLogEntry>): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * Clear specific context fields
   */
  clearContext(fields?: (keyof StructuredLogEntry)[]): void {
    if (fields) {
      fields.forEach(field => delete this.context[field]);
    } else {
      this.context = {};
    }
  }

  /**
   * Create a child logger with additional context
   */
  child(context: Partial<StructuredLogEntry>): StructuredLogger {
    const child = new StructuredLogger();
    child.setContext({ ...this.context, ...context });
    return child;
  }

  private log(level: LogLevel, msg: string, metadata?: Record<string, any>): void {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      msg,
      ...this.context,
      ...(metadata && { metadata: sanitizeForLogging(metadata) })
    };

    // Remove undefined fields for cleaner JSON
    Object.keys(entry).forEach(key => {
      if (entry[key as keyof StructuredLogEntry] === undefined) {
        delete entry[key as keyof StructuredLogEntry];
      }
    });

    console.log(JSON.stringify(entry));
  }

  debug(msg: string, metadata?: Record<string, any>): void {
    this.log('debug', msg, metadata);
  }

  info(msg: string, metadata?: Record<string, any>): void {
    this.log('info', msg, metadata);
  }

  warn(msg: string, metadata?: Record<string, any>): void {
    this.log('warn', msg, metadata);
  }

  error(msg: string, error?: Error | string, metadata?: Record<string, any>): void {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      msg,
      ...this.context,
      ...(metadata && { metadata: sanitizeForLogging(metadata) })
    };

    if (error) {
      if (typeof error === 'string') {
        entry.error = { name: 'Error', message: error };
      } else {
        entry.error = {
          name: error.name,
          message: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        };
      }
    }

    // Remove undefined fields
    Object.keys(entry).forEach(key => {
      if (entry[key as keyof StructuredLogEntry] === undefined) {
        delete entry[key as keyof StructuredLogEntry];
      }
    });

    console.log(JSON.stringify(entry));
  }
}

/**
 * Global logger instance
 */
export const logger = new StructuredLogger();

/**
 * Generate correlation ID for request tracking
 */
export function generateReqId(): string {
  return randomUUID();
}

/**
 * Request logging utility for Express middleware
 */
export function logRequest(
  reqId: string,
  method: string,
  route: string,
  status: number,
  latencyMs: number,
  userId?: string,
  tenantId?: string,
  error?: Error
): void {
  const requestLogger = logger.child({
    reqId,
    userId,
    tenantId,
    route,
    method,
    status,
    latencyMs
  });

  if (error) {
    requestLogger.error(`Request failed: ${method} ${route}`, error);
  } else if (status >= 400) {
    requestLogger.warn(`Request error: ${method} ${route}`);
  } else {
    requestLogger.info(`Request completed: ${method} ${route}`);
  }
}

/**
 * Worker logging utility
 */
export function logWorkerOperation(
  workerId: string,
  jobId: string,
  jobType: string,
  operation: string,
  tenantId?: string,
  userId?: string,
  metadata?: Record<string, any>
): void {
  const workerLogger = logger.child({
    workerId,
    jobId,
    jobType,
    tenantId,
    userId
  });

  workerLogger.info(`Worker operation: ${operation}`, metadata);
}

/**
 * Database operation logging
 */
export function logDatabaseOperation(
  operation: string,
  table: string,
  reqId?: string,
  tenantId?: string,
  latencyMs?: number,
  error?: Error
): void {
  const dbLogger = logger.child({
    reqId,
    tenantId,
    latencyMs
  });

  if (error) {
    dbLogger.error(`Database operation failed: ${operation} on ${table}`, error);
  } else {
    dbLogger.debug(`Database operation: ${operation} on ${table}`);
  }
}

/**
 * Queue operation logging
 */
export function logQueueOperation(
  operation: string,
  jobType: string,
  jobId?: string,
  reqId?: string,
  tenantId?: string,
  metadata?: Record<string, any>
): void {
  const queueLogger = logger.child({
    reqId,
    tenantId,
    jobId,
    jobType
  });

  queueLogger.info(`Queue operation: ${operation}`, metadata);
}

export default logger;
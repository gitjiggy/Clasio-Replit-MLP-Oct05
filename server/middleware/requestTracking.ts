/**
 * Token 5/8: Request Tracking Middleware
 * 
 * Adds correlation IDs and structured logging to all requests
 */

import { Request, Response, NextFunction } from 'express';
import { generateReqId, logRequest, logger } from '../logger.js';
import type { AuthenticatedRequest } from '../auth.js';

export interface TrackedRequest extends AuthenticatedRequest {
  reqId: string;
  startTime: number;
}

/**
 * Request tracking middleware that adds correlation IDs and timing
 */
export function requestTrackingMiddleware(req: TrackedRequest, res: Response, next: NextFunction): void {
  // Generate correlation ID
  req.reqId = generateReqId();
  req.startTime = Date.now();

  // Set correlation ID in response headers for client tracking
  res.setHeader('X-Request-ID', req.reqId);

  // Set context for this request's logger
  const requestLogger = logger.child({
    reqId: req.reqId,
    method: req.method,
    route: req.route?.path || req.path,
    userId: req.userId,
    tenantId: req.userId // In our system, userId is the tenant identifier
  });

  // Log request start
  requestLogger.info('Request started', {
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress
  });

  // Override res.end to capture response metrics
  const originalEnd = res.end;
  res.end = function(chunk?: any, encoding?: any) {
    const latencyMs = Date.now() - req.startTime;
    
    // Log request completion
    logRequest(
      req.reqId,
      req.method,
      req.route?.path || req.path,
      res.statusCode,
      latencyMs,
      req.userId,
      req.userId, // tenantId = userId in our system
      res.statusCode >= 400 ? new Error(`HTTP ${res.statusCode}`) : undefined
    );

    // Record metrics
    recordRequestMetrics(req.method, req.route?.path || req.path, res.statusCode, latencyMs);

    return originalEnd.call(this, chunk, encoding);
  };

  next();
}

/**
 * Metrics collection for requests
 */
interface RequestMetrics {
  totalRequests: number;
  errorRequests: number;
  latencies: number[];
  lastUpdated: Date;
}

const routeMetrics = new Map<string, RequestMetrics>();

function recordRequestMetrics(method: string, route: string, status: number, latencyMs: number): void {
  const routeKey = `${method} ${route}`;
  
  if (!routeMetrics.has(routeKey)) {
    routeMetrics.set(routeKey, {
      totalRequests: 0,
      errorRequests: 0,
      latencies: [],
      lastUpdated: new Date()
    });
  }

  const metrics = routeMetrics.get(routeKey)!;
  metrics.totalRequests++;
  metrics.latencies.push(latencyMs);
  metrics.lastUpdated = new Date();

  if (status >= 400) {
    metrics.errorRequests++;
  }

  // Keep only last 1000 latencies for memory efficiency
  if (metrics.latencies.length > 1000) {
    metrics.latencies = metrics.latencies.slice(-1000);
  }
}

/**
 * Get current request metrics for monitoring
 */
export function getRequestMetrics(): Record<string, any> {
  const metrics: Record<string, any> = {};

  for (const [route, routeMetric] of Array.from(routeMetrics.entries())) {
    const latencies = routeMetric.latencies.sort((a: number, b: number) => a - b);
    const p95Index = Math.floor(latencies.length * 0.95);
    const p99Index = Math.floor(latencies.length * 0.99);

    metrics[route] = {
      totalRequests: routeMetric.totalRequests,
      errorRequests: routeMetric.errorRequests,
      errorRate: routeMetric.totalRequests > 0 ? (routeMetric.errorRequests / routeMetric.totalRequests) * 100 : 0,
      avgLatencyMs: latencies.length > 0 ? latencies.reduce((a: number, b: number) => a + b, 0) / latencies.length : 0,
      p95LatencyMs: latencies.length > 0 ? latencies[p95Index] || 0 : 0,
      p99LatencyMs: latencies.length > 0 ? latencies[p99Index] || 0 : 0,
      minLatencyMs: latencies.length > 0 ? latencies[0] : 0,
      maxLatencyMs: latencies.length > 0 ? latencies[latencies.length - 1] : 0,
      lastUpdated: routeMetric.lastUpdated
    };
  }

  return metrics;
}

/**
 * Reset metrics (useful for testing or periodic resets)
 */
export function resetRequestMetrics(): void {
  routeMetrics.clear();
}

/**
 * Get overall system metrics summary
 */
export function getSystemMetricsSummary(): {
  totalRequests: number;
  totalErrors: number;
  systemErrorRate: number;
  avgSystemLatency: number;
} {
  let totalRequests = 0;
  let totalErrors = 0;
  let totalLatency = 0;
  let latencyCount = 0;

  for (const metrics of Array.from(routeMetrics.values())) {
    totalRequests += metrics.totalRequests;
    totalErrors += metrics.errorRequests;
    totalLatency += metrics.latencies.reduce((a: number, b: number) => a + b, 0);
    latencyCount += metrics.latencies.length;
  }

  return {
    totalRequests,
    totalErrors,
    systemErrorRate: totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0,
    avgSystemLatency: latencyCount > 0 ? totalLatency / latencyCount : 0
  };
}
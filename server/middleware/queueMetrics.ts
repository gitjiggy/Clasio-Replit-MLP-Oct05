/**
 * Token 5/8: Queue Metrics Collection
 * 
 * Tracks queue depth, processing rates, success/fail/retry counts
 */

import { logger } from '../logger.js';

export interface QueueMetrics {
  // Queue depth metrics
  currentDepth: number;
  dlqDepth: number;
  
  // Processing rate metrics (per minute)
  enqueuedPerMinute: number;
  processedPerMinute: number;
  successPerMinute: number;
  failurePerMinute: number;
  retryPerMinute: number;
  
  // Latency metrics
  avgProcessingLatencyMs: number;
  p95ProcessingLatencyMs: number;
  
  // Counters (lifetime)
  totalEnqueued: number;
  totalProcessed: number;
  totalSuccess: number;
  totalFailures: number;
  totalRetries: number;
  totalDLQ: number;
  
  // Time window
  windowStart: Date;
  lastUpdated: Date;
}

class QueueMetricsCollector {
  private metrics: QueueMetrics;
  private recentEvents: Array<{
    type: 'enqueued' | 'processed' | 'success' | 'failure' | 'retry' | 'dlq';
    timestamp: Date;
    latencyMs?: number;
    jobType?: string;
    tenantId?: string;
  }> = [];

  private readonly windowSizeMs = 60 * 1000; // 1 minute window

  constructor() {
    this.metrics = {
      currentDepth: 0,
      dlqDepth: 0,
      enqueuedPerMinute: 0,
      processedPerMinute: 0,
      successPerMinute: 0,
      failurePerMinute: 0,
      retryPerMinute: 0,
      avgProcessingLatencyMs: 0,
      p95ProcessingLatencyMs: 0,
      totalEnqueued: 0,
      totalProcessed: 0,
      totalSuccess: 0,
      totalFailures: 0,
      totalRetries: 0,
      totalDLQ: 0,
      windowStart: new Date(),
      lastUpdated: new Date()
    };

    // Update metrics every minute
    setInterval(() => this.updateRateMetrics(), this.windowSizeMs);
  }

  /**
   * Record job enqueued
   */
  recordEnqueued(jobType: string, tenantId?: string): void {
    this.metrics.totalEnqueued++;
    this.metrics.currentDepth++;
    this.metrics.lastUpdated = new Date();

    this.recentEvents.push({
      type: 'enqueued',
      timestamp: new Date(),
      jobType,
      tenantId
    });

    logger.debug('Queue metrics: Job enqueued', {
      jobType,
      tenantId,
      currentDepth: this.metrics.currentDepth,
      totalEnqueued: this.metrics.totalEnqueued
    });
  }

  /**
   * Record job started processing
   */
  recordProcessingStarted(jobType: string, tenantId?: string): void {
    this.metrics.currentDepth = Math.max(0, this.metrics.currentDepth - 1);
    this.metrics.lastUpdated = new Date();

    this.recentEvents.push({
      type: 'processed',
      timestamp: new Date(),
      jobType,
      tenantId
    });
  }

  /**
   * Record job completed successfully
   */
  recordSuccess(jobType: string, processingLatencyMs: number, tenantId?: string): void {
    this.metrics.totalProcessed++;
    this.metrics.totalSuccess++;
    this.metrics.lastUpdated = new Date();

    this.recentEvents.push({
      type: 'success',
      timestamp: new Date(),
      latencyMs: processingLatencyMs,
      jobType,
      tenantId
    });

    logger.debug('Queue metrics: Job completed successfully', {
      jobType,
      tenantId,
      processingLatencyMs,
      totalSuccess: this.metrics.totalSuccess
    });
  }

  /**
   * Record job failed
   */
  recordFailure(jobType: string, processingLatencyMs: number, error: string, tenantId?: string): void {
    this.metrics.totalProcessed++;
    this.metrics.totalFailures++;
    this.metrics.lastUpdated = new Date();

    this.recentEvents.push({
      type: 'failure',
      timestamp: new Date(),
      latencyMs: processingLatencyMs,
      jobType,
      tenantId
    });

    logger.warn('Queue metrics: Job failed', {
      jobType,
      tenantId,
      processingLatencyMs,
      error,
      totalFailures: this.metrics.totalFailures
    });
  }

  /**
   * Record job retry
   */
  recordRetry(jobType: string, attemptCount: number, tenantId?: string): void {
    this.metrics.totalRetries++;
    this.metrics.currentDepth++; // Back in queue
    this.metrics.lastUpdated = new Date();

    this.recentEvents.push({
      type: 'retry',
      timestamp: new Date(),
      jobType,
      tenantId
    });

    logger.info('Queue metrics: Job retried', {
      jobType,
      tenantId,
      attemptCount,
      totalRetries: this.metrics.totalRetries
    });
  }

  /**
   * Record job moved to DLQ
   */
  recordDLQ(jobType: string, reason: string, tenantId?: string): void {
    this.metrics.totalDLQ++;
    this.metrics.dlqDepth++;
    this.metrics.lastUpdated = new Date();

    this.recentEvents.push({
      type: 'dlq',
      timestamp: new Date(),
      jobType,
      tenantId
    });

    logger.warn('Queue metrics: Job moved to DLQ', {
      jobType,
      tenantId,
      reason,
      dlqDepth: this.metrics.dlqDepth,
      totalDLQ: this.metrics.totalDLQ
    });
  }

  /**
   * Update current queue depth (called from queue status checks)
   */
  updateQueueDepth(pendingJobs: number, dlqJobs: number): void {
    this.metrics.currentDepth = pendingJobs;
    this.metrics.dlqDepth = dlqJobs;
    this.metrics.lastUpdated = new Date();
  }

  /**
   * Update rate-based metrics (called periodically)
   */
  private updateRateMetrics(): void {
    const now = new Date();
    const windowStart = new Date(now.getTime() - this.windowSizeMs);

    // Filter events to current window
    const windowEvents = this.recentEvents.filter(event => event.timestamp >= windowStart);

    // Calculate per-minute rates
    this.metrics.enqueuedPerMinute = windowEvents.filter(e => e.type === 'enqueued').length;
    this.metrics.processedPerMinute = windowEvents.filter(e => e.type === 'processed').length;
    this.metrics.successPerMinute = windowEvents.filter(e => e.type === 'success').length;
    this.metrics.failurePerMinute = windowEvents.filter(e => e.type === 'failure').length;
    this.metrics.retryPerMinute = windowEvents.filter(e => e.type === 'retry').length;

    // Calculate latency metrics
    const completedEvents = windowEvents.filter(e => e.latencyMs !== undefined);
    if (completedEvents.length > 0) {
      const latencies = completedEvents.map(e => e.latencyMs!).sort((a, b) => a - b);
      this.metrics.avgProcessingLatencyMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      
      const p95Index = Math.floor(latencies.length * 0.95);
      this.metrics.p95ProcessingLatencyMs = latencies[p95Index] || 0;
    }

    // Clean up old events (keep last 5 minutes for debugging)
    const cleanupThreshold = new Date(now.getTime() - (5 * this.windowSizeMs));
    this.recentEvents = this.recentEvents.filter(event => event.timestamp >= cleanupThreshold);

    this.metrics.windowStart = windowStart;
    this.metrics.lastUpdated = now;

    // Log metrics summary
    logger.info('Queue metrics updated', {
      currentDepth: this.metrics.currentDepth,
      dlqDepth: this.metrics.dlqDepth,
      successPerMinute: this.metrics.successPerMinute,
      failurePerMinute: this.metrics.failurePerMinute,
      avgProcessingLatencyMs: this.metrics.avgProcessingLatencyMs
    });
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics(): QueueMetrics {
    return { ...this.metrics };
  }

  /**
   * Get metrics by job type
   */
  getMetricsByJobType(): Record<string, {
    totalEnqueued: number;
    totalSuccess: number;
    totalFailures: number;
    totalRetries: number;
    avgLatencyMs: number;
  }> {
    const jobTypeMetrics: Record<string, any> = {};

    for (const event of this.recentEvents) {
      if (!event.jobType) continue;

      if (!jobTypeMetrics[event.jobType]) {
        jobTypeMetrics[event.jobType] = {
          totalEnqueued: 0,
          totalSuccess: 0,
          totalFailures: 0,
          totalRetries: 0,
          latencies: []
        };
      }

      const metrics = jobTypeMetrics[event.jobType];
      
      switch (event.type) {
        case 'enqueued':
          metrics.totalEnqueued++;
          break;
        case 'success':
          metrics.totalSuccess++;
          if (event.latencyMs) metrics.latencies.push(event.latencyMs);
          break;
        case 'failure':
          metrics.totalFailures++;
          if (event.latencyMs) metrics.latencies.push(event.latencyMs);
          break;
        case 'retry':
          metrics.totalRetries++;
          break;
      }
    }

    // Calculate average latencies
    Object.keys(jobTypeMetrics).forEach(jobType => {
      const metrics = jobTypeMetrics[jobType];
      metrics.avgLatencyMs = metrics.latencies.length > 0 
        ? metrics.latencies.reduce((a: number, b: number) => a + b, 0) / metrics.latencies.length 
        : 0;
      delete metrics.latencies; // Remove raw data
    });

    return jobTypeMetrics;
  }

  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    this.metrics = {
      currentDepth: 0,
      dlqDepth: 0,
      enqueuedPerMinute: 0,
      processedPerMinute: 0,
      successPerMinute: 0,
      failurePerMinute: 0,
      retryPerMinute: 0,
      avgProcessingLatencyMs: 0,
      p95ProcessingLatencyMs: 0,
      totalEnqueued: 0,
      totalProcessed: 0,
      totalSuccess: 0,
      totalFailures: 0,
      totalRetries: 0,
      totalDLQ: 0,
      windowStart: new Date(),
      lastUpdated: new Date()
    };
    this.recentEvents = [];
  }
}

// Global metrics collector instance
export const queueMetrics = new QueueMetricsCollector();
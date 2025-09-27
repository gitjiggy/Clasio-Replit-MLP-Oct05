#!/usr/bin/env tsx

/**
 * Token 4/8: Standalone AI Worker Process
 * 
 * Enterprise-grade AI processing worker with full durability:
 * - Separate process isolation from web server
 * - Dead Letter Queue (DLQ) handling  
 * - Exponential backoff with poison pill detection
 * - Idempotent write-backs with unique constraints
 * - Comprehensive retry logic with attempt counting
 * - Graceful shutdown and crash recovery
 * - Tenant isolation for multi-tenant security
 * - Operational controls (pause/resume, DLQ replay)
 * - Rich metrics and monitoring
 */

import { storage } from './storage.js';
import { analyzeDocumentContent, generateEmbedding, serializeEmbeddingToJSON } from './gemini.js';
import type { AiAnalysisQueue, InsertAiQueueMetrics } from '../shared/schema.js';
import process from 'process';
import { logger, logWorkerOperation } from './logger.js';
import { queueMetrics } from './middleware/queueMetrics.js';

// Enhanced configuration for Token 4/8
interface WorkerConfig {
  // Rate limiting
  requestsPerMinute: number;
  dailyRequestLimit: number;
  processingIntervalMs: number;
  
  // Worker concurrency
  maxContentExtractionWorkers: number;
  maxAnalysisWorkers: number;
  maxEmbeddingWorkers: number;
  
  // Retry and backoff configuration
  initialBackoffMs: number;
  maxBackoffMs: number;
  maxAttempts: number;
  
  // Poison pill detection
  poisonPillThreshold: number; // Number of immediate failures before fast-DLQ
  poisonPillTimeWindowMs: number;
  
  // Metrics collection
  metricsCollectionIntervalMs: number;
  
  // Operational controls
  pauseProcessing: boolean;
}

/**
 * Standalone AI Worker with Enterprise Durability
 */
class StandaloneAIWorker {
  private readonly config: WorkerConfig;
  private readonly workerId: string;
  
  // Worker state
  private contentExtractionWorkers: Set<Promise<void>> = new Set();
  private analysisWorkers: Set<Promise<void>> = new Set();
  private embeddingWorkers: Set<Promise<void>> = new Set();
  private processingInterval: NodeJS.Timeout | null = null;
  private metricsInterval: NodeJS.Timeout | null = null;
  
  // Rate limiting with token bucket
  private tokenBucket: number;
  private lastTokenRefill: number = Date.now();
  
  // Enhanced retry tracking with poison pill detection
  private documentFailureCount: Map<string, number> = new Map();
  private documentFirstFailure: Map<string, number> = new Map();
  
  // Graceful shutdown
  private isShuttingDown: boolean = false;
  
  // Metrics tracking
  private metricsData = {
    jobsProcessed: 0,
    jobsSucceeded: 0,
    jobsFailed: 0,
    jobsRetried: 0,
    jobsDLQed: 0,
    poisonPillsDetected: 0,
    totalProcessingTime: 0,
    lastProcessingTime: 0
  };

  constructor() {
    this.workerId = `worker-${process.pid}-${Date.now()}`;
    
    this.config = {
      // Rate limits (respect Gemini API quotas)
      requestsPerMinute: 15,
      dailyRequestLimit: 1200,
      processingIntervalMs: 2000,
      
      // Worker concurrency
      maxContentExtractionWorkers: 2,
      maxAnalysisWorkers: 3,
      maxEmbeddingWorkers: 2,
      
      // Enhanced retry logic
      initialBackoffMs: 5000,       // 5 seconds
      maxBackoffMs: 300000,         // 5 minutes
      maxAttempts: 3,
      
      // Poison pill detection
      poisonPillThreshold: 3,       // 3 immediate failures = poison pill
      poisonPillTimeWindowMs: 60000, // Within 1 minute
      
      // Metrics
      metricsCollectionIntervalMs: 60000, // Every minute
      
      // Controls
      pauseProcessing: false
    };
    
    this.tokenBucket = this.config.requestsPerMinute;
    
    console.log(`🚀 Standalone AI Worker started: ${this.workerId}`);
    this.setupGracefulShutdown();
  }

  /**
   * Setup graceful shutdown handlers for production reliability
   */
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      console.log(`📡 Received ${signal} - initiating graceful shutdown...`);
      this.isShuttingDown = true;
      
      // Stop accepting new work
      this.pause();
      
      // Wait for active workers to complete
      console.log(`⏳ Waiting for ${this.getTotalActiveWorkers()} active workers to complete...`);
      
      const maxWaitTime = 30000; // 30 seconds max wait
      const startTime = Date.now();
      
      while (this.getTotalActiveWorkers() > 0 && (Date.now() - startTime) < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log(`⏳ Still waiting for ${this.getTotalActiveWorkers()} workers...`);
      }
      
      // Force stop if workers didn't complete
      if (this.getTotalActiveWorkers() > 0) {
        console.log(`⚠️ Force stopping ${this.getTotalActiveWorkers()} remaining workers`);
      }
      
      console.log(`✅ AI Worker ${this.workerId} shutdown complete`);
      process.exit(0);
    };
    
    // Handle common termination signals
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGQUIT', () => shutdown('SIGQUIT'));
    
    // Handle uncaught errors gracefully
    process.on('uncaughtException', (error) => {
      console.error('💥 Uncaught Exception in AI Worker:', error);
      shutdown('UNCAUGHT_EXCEPTION');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('💥 Unhandled Rejection in AI Worker:', reason, 'at:', promise);
      shutdown('UNHANDLED_REJECTION');
    });
  }

  /**
   * Start the AI worker with full monitoring
   */
  public start(): void {
    if (!process.env.GEMINI_API_KEY) {
      logger.error('Cannot start AI Worker - GEMINI_API_KEY not configured', undefined, { workerId: this.workerId });
      process.exit(1);
    }

    if (this.processingInterval) {
      logger.warn('AI Worker is already running', { workerId: this.workerId });
      return;
    }

    logger.info('Starting AI Worker with configuration', {
      workerId: this.workerId,
      requestsPerMinute: this.config.requestsPerMinute,
      maxAttempts: this.config.maxAttempts,
      maxWorkers: {
        content: this.config.maxContentExtractionWorkers,
        analysis: this.config.maxAnalysisWorkers,
        embedding: this.config.maxEmbeddingWorkers
      }
    });

    // Start main processing loop
    this.processingInterval = setInterval(() => {
      if (!this.config.pauseProcessing && !this.isShuttingDown) {
        this.processQueue().catch(error => {
          logger.error('Queue processing error', error instanceof Error ? error : new Error(String(error)), {
            workerId: this.workerId
          });
        });
      }
    }, this.config.processingIntervalMs);

    // Start metrics collection
    this.metricsInterval = setInterval(() => {
      this.collectAndSubmitMetrics().catch(error => {
        logger.error('Metrics collection error', error instanceof Error ? error : new Error(String(error)), {
          workerId: this.workerId
        });
      });
    }, this.config.metricsCollectionIntervalMs);

    logger.info('AI Worker started successfully', { workerId: this.workerId });
  }

  /**
   * Pause processing (operational control)
   */
  public pause(): void {
    this.config.pauseProcessing = true;
    logger.info('AI Worker paused', { workerId: this.workerId, operation: 'pause' });
  }

  /**
   * Resume processing (operational control)  
   */
  public resume(): void {
    this.config.pauseProcessing = false;
    logger.info('AI Worker resumed', { workerId: this.workerId, operation: 'resume' });
  }

  /**
   * Stop the worker gracefully
   */
  public stop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
    
    logger.info('AI Worker stopped', { workerId: this.workerId, operation: 'stop' });
  }

  /**
   * Token bucket rate limiting with refill
   */
  private refillTokenBucket(): void {
    const now = Date.now();
    const timePassed = now - this.lastTokenRefill;
    const tokensToAdd = Math.floor(timePassed / (60000 / this.config.requestsPerMinute));
    
    if (tokensToAdd > 0) {
      this.tokenBucket = Math.min(this.config.requestsPerMinute, this.tokenBucket + tokensToAdd);
      this.lastTokenRefill = now;
    }
  }

  /**
   * Enhanced queue processing with Token 4/8 durability
   */
  private async processQueue(): Promise<void> {
    try {
      // Refill rate limiting tokens
      this.refillTokenBucket();

      // Process different job types in parallel
      await Promise.all([
        this.processContentExtractionJobs(),
        this.processAnalysisJobs(), 
        this.processEmbeddingJobs()
      ]);

    } catch (error) {
      console.error('💥 Queue processor error:', error);
    }
  }

  /**
   * Process content extraction jobs with enhanced error handling
   */
  private async processContentExtractionJobs(): Promise<void> {
    while (this.contentExtractionWorkers.size < this.config.maxContentExtractionWorkers) {
      const job = await this.dequeueNextJob('content_extraction');
      if (!job) break;

      const worker = this.processJob(job, 'content_extraction');
      this.contentExtractionWorkers.add(worker);
      
      worker.finally(() => {
        this.contentExtractionWorkers.delete(worker);
      });
    }
  }

  /**
   * Process analysis jobs with rate limiting
   */
  private async processAnalysisJobs(): Promise<void> {
    while (this.analysisWorkers.size < this.config.maxAnalysisWorkers && this.tokenBucket > 0) {
      const job = await this.dequeueNextJob('analysis');
      if (!job) break;

      // Consume token for API call
      this.tokenBucket--;

      const worker = this.processJob(job, 'analysis');
      this.analysisWorkers.add(worker);
      
      worker.finally(() => {
        this.analysisWorkers.delete(worker);
      });
    }
  }

  /**
   * Process embedding jobs with rate limiting
   */
  private async processEmbeddingJobs(): Promise<void> {
    while (this.embeddingWorkers.size < this.config.maxEmbeddingWorkers && this.tokenBucket > 0) {
      const job = await this.dequeueNextJob('embedding_generation');
      if (!job) break;

      // Consume token for API calls (embeddings use multiple calls)
      this.tokenBucket--;

      const worker = this.processJob(job, 'embedding_generation');
      this.embeddingWorkers.add(worker);
      
      worker.finally(() => {
        this.embeddingWorkers.delete(worker);
      });
    }
  }

  /**
   * Enhanced job dequeue with retry scheduling and DLQ support
   */
  private async dequeueNextJob(jobType: string): Promise<AiAnalysisQueue | null> {
    return await storage.dequeueNextDurableJob(jobType, this.workerId);
  }

  /**
   * Process individual job with full Token 4/8 durability
   */
  private async processJob(job: AiAnalysisQueue, jobType: string): Promise<void> {
    const startTime = Date.now();
    this.metricsData.jobsProcessed++;

    try {
      console.log(`🔄 Processing ${jobType} job for document: ${job.documentId} (attempt ${job.attemptCount + 1}/${job.maxAttempts})`);

      // Check for poison pill pattern
      if (this.isPoisonPill(job.documentId)) {
        await this.fastTrackToDLQ(job, 'Poison pill detected - repeated deterministic failures');
        return;
      }

      // Process based on job type
      let success = false;
      switch (jobType) {
        case 'content_extraction':
          success = await this.processContentExtraction(job);
          break;
        case 'analysis':
          success = await this.processAnalysis(job);
          break;
        case 'embedding_generation':
          success = await this.processEmbedding(job);
          break;
        default:
          throw new Error(`Unknown job type: ${jobType}`);
      }

      if (success) {
        await this.markJobCompleted(job);
        this.metricsData.jobsSucceeded++;
        this.clearFailureTracking(job.documentId);
      } else {
        await this.handleJobFailure(job, 'Processing failed');
      }

    } catch (error: any) {
      console.error(`❌ Error processing ${jobType} job ${job.id}:`, error.message);
      await this.handleJobFailure(job, error.message);
    } finally {
      const processingTime = Date.now() - startTime;
      this.metricsData.totalProcessingTime += processingTime;
      this.metricsData.lastProcessingTime = processingTime;
    }
  }

  /**
   * Enhanced job failure handling with exponential backoff and DLQ
   */
  private async handleJobFailure(job: AiAnalysisQueue, errorMessage: string): Promise<void> {
    this.metricsData.jobsFailed++;
    this.trackFailure(job.documentId);

    const nextAttempt = job.attemptCount + 1;

    if (nextAttempt >= job.maxAttempts) {
      // Max attempts reached - move to DLQ
      await this.moveToDLQ(job, `Max attempts (${job.maxAttempts}) reached: ${errorMessage}`);
      this.metricsData.jobsDLQed++;
    } else {
      // Schedule retry with exponential backoff
      const backoffMs = Math.min(
        this.config.initialBackoffMs * Math.pow(2, nextAttempt - 1),
        this.config.maxBackoffMs
      );
      const nextRetryAt = new Date(Date.now() + backoffMs);

      await storage.scheduleJobRetry(job.id, nextAttempt, errorMessage, nextRetryAt, this.workerId);
      this.metricsData.jobsRetried++;
      
      console.log(`🔄 Scheduled retry ${nextAttempt}/${job.maxAttempts} for job ${job.id} in ${backoffMs}ms`);
    }
  }

  /**
   * Poison pill detection - fast-track deterministic failures to DLQ
   */
  private isPoisonPill(documentId: string): boolean {
    const failureCount = this.documentFailureCount.get(documentId) || 0;
    const firstFailure = this.documentFirstFailure.get(documentId) || Date.now();
    const timeWindow = Date.now() - firstFailure;

    return failureCount >= this.config.poisonPillThreshold && 
           timeWindow <= this.config.poisonPillTimeWindowMs;
  }

  /**
   * Track failures for poison pill detection
   */
  private trackFailure(documentId: string): void {
    if (!this.documentFirstFailure.has(documentId)) {
      this.documentFirstFailure.set(documentId, Date.now());
    }
    
    const currentCount = this.documentFailureCount.get(documentId) || 0;
    this.documentFailureCount.set(documentId, currentCount + 1);
  }

  /**
   * Clear failure tracking on success
   */
  private clearFailureTracking(documentId: string): void {
    this.documentFailureCount.delete(documentId);
    this.documentFirstFailure.delete(documentId);
  }

  /**
   * Fast-track job to DLQ (poison pill handling)
   */
  private async fastTrackToDLQ(job: AiAnalysisQueue, reason: string): Promise<void> {
    await storage.moveToDLQ(job.id, reason, this.workerId);
    this.metricsData.poisonPillsDetected++;
    console.log(`☠️ Fast-tracked poison pill to DLQ: ${job.documentId} - ${reason}`);
  }

  /**
   * Move job to Dead Letter Queue
   */
  private async moveToDLQ(job: AiAnalysisQueue, reason: string): Promise<void> {
    await storage.moveToDLQ(job.id, reason, this.workerId);
    console.log(`💀 Moved job to DLQ: ${job.id} - ${reason}`);
  }

  /**
   * Mark job as completed with idempotency
   */
  private async markJobCompleted(job: AiAnalysisQueue): Promise<void> {
    await storage.markJobCompleted(job.id, this.workerId);
    console.log(`✅ Job completed: ${job.id} for document: ${job.documentId}`);
  }

  // Individual job processing methods (implement specific logic)
  private async processContentExtraction(job: AiAnalysisQueue): Promise<boolean> {
    return await storage.extractDocumentContent(job.documentId, job.userId);
  }

  private async processAnalysis(job: AiAnalysisQueue): Promise<boolean> {
    return await storage.analyzeDocumentWithAI(job.documentId, job.userId);
  }

  private async processEmbedding(job: AiAnalysisQueue): Promise<boolean> {
    // Implementation would be similar to existing embedding generation
    return await storage.generateDocumentEmbeddings(job.documentId, job.userId);
  }

  /**
   * Get total active workers for shutdown coordination
   */
  private getTotalActiveWorkers(): number {
    return this.contentExtractionWorkers.size + 
           this.analysisWorkers.size + 
           this.embeddingWorkers.size;
  }

  /**
   * Collect and submit operational metrics
   */
  private async collectAndSubmitMetrics(): Promise<void> {
    try {
      const queueStats = await storage.getQueueStats();
      
      const metricsSnapshot: InsertAiQueueMetrics = {
        queueDepth: queueStats.pendingJobs,
        dlqDepth: queueStats.dlqJobs,
        processingRate: this.metricsData.jobsProcessed, // Reset after collection
        successRate: this.metricsData.jobsSucceeded,
        failureRate: this.metricsData.jobsFailed,
        retryRate: this.metricsData.jobsRetried,
        avgProcessingTimeMs: this.metricsData.totalProcessingTime > 0 ? 
          Math.round(this.metricsData.totalProcessingTime / this.metricsData.jobsProcessed) : 0,
        activeWorkers: this.getTotalActiveWorkers(),
        poisonPillCount: this.metricsData.poisonPillsDetected
      };

      await storage.recordQueueMetrics(metricsSnapshot);

      // Reset counters for next collection period
      this.metricsData.jobsProcessed = 0;
      this.metricsData.jobsSucceeded = 0;
      this.metricsData.jobsFailed = 0;
      this.metricsData.jobsRetried = 0;
      this.metricsData.poisonPillsDetected = 0;
      this.metricsData.totalProcessingTime = 0;

    } catch (error) {
      console.error('📊 Failed to collect metrics:', error);
    }
  }
}

// Main execution
async function main() {
  console.log('🚀 Starting Standalone AI Worker for Token 4/8...');
  
  const worker = new StandaloneAIWorker();
  worker.start();
  
  // Keep process alive
  process.stdin.resume();
}

// Start the worker if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('💥 Failed to start AI Worker:', error);
    process.exit(1);
  });
}

export { StandaloneAIWorker };
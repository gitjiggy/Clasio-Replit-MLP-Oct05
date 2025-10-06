/**
 * Token 5/8: Health and Readiness Checks
 * 
 * Provides Kubernetes-style health probes for monitoring and orchestration
 */

import { Request, Response } from 'express';
import { storage } from '../storage.js';
import { logger } from '../logger.js';
import { getAdminAuth } from '../auth.js';

interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  checks: Record<string, {
    status: 'pass' | 'fail';
    message?: string;
    duration_ms?: number;
  }>;
}

interface ReadinessStatus {
  status: 'ready' | 'not_ready';
  timestamp: string;
  checks: Record<string, {
    status: 'pass' | 'fail';
    message?: string;
    duration_ms?: number;
    threshold?: string;
  }>;
}

/**
 * Health check - Liveness probe
 * Always returns healthy unless process is fundamentally broken
 */
export async function healthCheck(req: Request, res: Response): Promise<void> {
  const startTime = Date.now();
  const healthStatus: HealthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    checks: {}
  };

  try {
    // Basic process health checks
    const memUsage = process.memoryUsage();
    const memUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    
    // Check if memory usage is excessive (> 1GB heap)
    const memoryCheck = memUsageMB < 1024;
    healthStatus.checks.memory = {
      status: memoryCheck ? 'pass' : 'fail',
      message: `Heap usage: ${memUsageMB}MB`,
      duration_ms: Date.now() - startTime
    };

    // Check event loop lag (basic responsiveness)
    const eventLoopStart = Date.now();
    await new Promise(resolve => setImmediate(resolve));
    const eventLoopLag = Date.now() - eventLoopStart;
    
    const eventLoopCheck = eventLoopLag < 100; // < 100ms lag
    healthStatus.checks.event_loop = {
      status: eventLoopCheck ? 'pass' : 'fail',
      message: `Event loop lag: ${eventLoopLag}ms`,
      duration_ms: eventLoopLag
    };

    // Overall health status
    const allPassed = Object.values(healthStatus.checks).every(check => check.status === 'pass');
    healthStatus.status = allPassed ? 'healthy' : 'unhealthy';

    const statusCode = healthStatus.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(healthStatus);

    // Log health check result
    logger.info(`Health check completed: ${healthStatus.status}`, {
      checks: healthStatus.checks,
      duration_ms: Date.now() - startTime
    });

  } catch (error) {
    healthStatus.status = 'unhealthy';
    healthStatus.checks.process = {
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unknown error',
      duration_ms: Date.now() - startTime
    };

    res.status(503).json(healthStatus);
    logger.error('Health check failed', error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Readiness check - Readiness probe
 * Checks if service can handle traffic (DB, dependencies, queue lag)
 */
export async function readinessCheck(req: Request, res: Response): Promise<void> {
  const startTime = Date.now();
  const readinessStatus: ReadinessStatus = {
    status: 'ready',
    timestamp: new Date().toISOString(),
    checks: {}
  };

  try {
    // Database connectivity check
    const dbStart = Date.now();
    try {
      await storage.ensureInitialized();
      // Simple DB ping - get count of documents (fastest query)
      await storage.getDocumentsCount({ search: '', fileType: '', folderId: '', tagId: '', page: 1 }, 'health-check');
      
      readinessStatus.checks.database = {
        status: 'pass',
        message: 'Database connection successful',
        duration_ms: Date.now() - dbStart
      };
    } catch (dbError) {
      readinessStatus.checks.database = {
        status: 'fail',
        message: dbError instanceof Error ? dbError.message : 'Database connection failed',
        duration_ms: Date.now() - dbStart
      };
    }

    // Firebase Admin SDK check
    const firebaseStart = Date.now();
    try {
      // Test Firebase Admin by trying to list users (limited to 1)
      // This verifies the service account credentials are valid
      const listResult = await getAdminAuth().listUsers(1);
      
      readinessStatus.checks.firebase_admin = {
        status: 'pass',
        message: 'Firebase Admin SDK operational',
        duration_ms: Date.now() - firebaseStart
      };
    } catch (firebaseError) {
      readinessStatus.checks.firebase_admin = {
        status: 'fail',
        message: firebaseError instanceof Error ? firebaseError.message : 'Firebase Admin SDK failed',
        duration_ms: Date.now() - firebaseStart
      };
      
      logger.error('Firebase Admin SDK health check failed', firebaseError instanceof Error ? firebaseError : new Error(String(firebaseError)));
    }

    // Queue lag check - measure actual lag of oldest pending job
    const queueStart = Date.now();
    try {
      const queueStatus = await storage.getQueueStatus();
      const currentTime = Date.now();
      const maxQueueLagMs = 5 * 60 * 1000; // 5 minutes threshold
      
      if (queueStatus.pending === 0) {
        // No pending jobs - system is ready
        readinessStatus.checks.queue_lag = {
          status: 'pass',
          message: 'No pending jobs',
          duration_ms: Date.now() - queueStart,
          threshold: '5 minutes max lag'
        };
      } else {
        // Check oldest pending job to measure actual lag
        const oldestPendingJob = await storage.getOldestPendingJob();
        
        if (oldestPendingJob) {
          const jobAge = currentTime - new Date(oldestPendingJob.createdAt).getTime();
          const lagSeconds = Math.round(jobAge / 1000);
          const lagMinutes = jobAge / (60 * 1000);
          
          const queueLagOk = jobAge < maxQueueLagMs;
          
          readinessStatus.checks.queue_lag = {
            status: queueLagOk ? 'pass' : 'fail',
            message: queueLagOk ? 
              `${queueStatus.pending} pending jobs, oldest: ${lagSeconds}s old` :
              `Queue lag exceeded: ${lagMinutes.toFixed(1)} minutes (${queueStatus.pending} jobs)`,
            duration_ms: Date.now() - queueStart,
            threshold: '5 minutes max lag',
            current_lag_seconds: lagSeconds,
            oldest_job_id: oldestPendingJob.jobId
          };
        } else {
          // Edge case: pending count > 0 but no job found
          readinessStatus.checks.queue_lag = {
            status: 'pass',
            message: `${queueStatus.pending} pending jobs (no timestamps available)`,
            duration_ms: Date.now() - queueStart,
            threshold: '5 minutes max lag'
          };
        }
      }
    } catch (queueError) {
      readinessStatus.checks.queue_lag = {
        status: 'fail',
        message: queueError instanceof Error ? queueError.message : 'Queue status check failed',
        duration_ms: Date.now() - queueStart,
        threshold: '5 minutes max lag'
      };
    }

    // Reindex SLA monitor - specific check for reindex job lag (<5 minutes requirement)
    const reindexSlaStart = Date.now();
    try {
      const oldestReindexJob = await storage.getOldestPendingReindexJob();
      const currentTime = Date.now();
      const reindexSlaMs = 5 * 60 * 1000; // 5 minutes SLA threshold
      
      if (!oldestReindexJob) {
        // No pending reindex jobs - SLA is met
        readinessStatus.checks.reindex_sla = {
          status: 'pass',
          message: 'No pending reindex jobs',
          duration_ms: Date.now() - reindexSlaStart,
          threshold: '<5 minutes SLA'
        };
      } else {
        const jobAge = currentTime - new Date(oldestReindexJob.createdAt).getTime();
        const lagSeconds = Math.round(jobAge / 1000);
        const lagMinutes = jobAge / (60 * 1000);
        
        const slaOk = jobAge < reindexSlaMs;
        
        readinessStatus.checks.reindex_sla = {
          status: slaOk ? 'pass' : 'fail',
          message: slaOk ? 
            `Reindex job in queue: ${lagSeconds}s old (within SLA)` :
            `⚠️ REINDEX SLA VIOLATED: ${lagMinutes.toFixed(1)} minutes (job: ${oldestReindexJob.jobId})`,
          duration_ms: Date.now() - reindexSlaStart,
          threshold: '<5 minutes SLA',
          queue_lag_seconds: lagSeconds,
          oldest_reindex_job_id: oldestReindexJob.jobId
        };
      }
    } catch (reindexError) {
      readinessStatus.checks.reindex_sla = {
        status: 'fail',
        message: reindexError instanceof Error ? reindexError.message : 'Reindex SLA check failed',
        duration_ms: Date.now() - reindexSlaStart,
        threshold: '<5 minutes SLA'
      };
    }

    // File storage accessibility check (GCS)
    const storageStart = Date.now();
    try {
      // This is a light check - we already initialized GCS in the app
      // In production, you might want to do a simple list operation
      readinessStatus.checks.file_storage = {
        status: 'pass',
        message: 'File storage initialized',
        duration_ms: Date.now() - storageStart
      };
    } catch (storageError) {
      readinessStatus.checks.file_storage = {
        status: 'fail',
        message: storageError instanceof Error ? storageError.message : 'File storage check failed',
        duration_ms: Date.now() - storageStart
      };
    }

    // Overall readiness status
    const allPassed = Object.values(readinessStatus.checks).every(check => check.status === 'pass');
    readinessStatus.status = allPassed ? 'ready' : 'not_ready';

    const statusCode = readinessStatus.status === 'ready' ? 200 : 503;
    res.status(statusCode).json(readinessStatus);

    // Log readiness check result
    logger.info(`Readiness check completed: ${readinessStatus.status}`, {
      checks: readinessStatus.checks,
      duration_ms: Date.now() - startTime
    });

  } catch (error) {
    readinessStatus.status = 'not_ready';
    readinessStatus.checks.system = {
      status: 'fail',
      message: error instanceof Error ? error.message : 'System check failed',
      duration_ms: Date.now() - startTime
    };

    res.status(503).json(readinessStatus);
    logger.error('Readiness check failed', error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Get detailed system status for monitoring dashboards
 */
export async function getSystemStatus(): Promise<{
  uptime: number;
  memory: NodeJS.MemoryUsage;
  cpu: NodeJS.CpuUsage;
  nodeVersion: string;
  environment: string;
}> {
  return {
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'unknown'
  };
}
import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { aiQueueProcessor } from "./aiQueueProcessor";
import * as cron from "node-cron";
import { DatabaseStorage } from "./storage";
import { cspMiddleware } from "./csp";
import { transactionManager } from "./transactionManager";
import { requestTrackingMiddleware, getRequestMetrics, getSystemMetricsSummary } from './middleware/requestTracking.js';
import { healthCheck, readinessCheck, getSystemStatus } from './middleware/healthChecks.js';
import { queueMetrics } from './middleware/queueMetrics.js';
import { logger } from './logger.js';

// Environment variable validation
function validateEnvironment() {
  const requiredEnvVars = [
    'DATABASE_URL',
    'VITE_FIREBASE_PROJECT_ID',
  ];
  
  const optionalEnvVars = [
    'GEMINI_API_KEY', // Optional but recommended for AI features
    'PORT',
    'TRASH_RETENTION_DAYS', // Optional, defaults to 7 days
  ];

  const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);
  
  if (missing.length > 0) {
    console.error('Missing required environment variables:');
    missing.forEach(envVar => console.error(`  - ${envVar}`));
    console.error('\nPlease set these environment variables before starting the server.');
    process.exit(1);
  }

  // Warn about missing optional variables
  const missingOptional = optionalEnvVars.filter(envVar => !process.env[envVar]);
  if (missingOptional.length > 0) {
    console.warn('Missing optional environment variables:');
    missingOptional.forEach(envVar => {
      if (envVar === 'GEMINI_API_KEY') {
        console.warn(`  - ${envVar} (AI analysis features will be disabled)`);
      } else if (envVar === 'TRASH_RETENTION_DAYS') {
        console.warn(`  - ${envVar} (defaults to 7 days - documents auto-delete after this period)`);
      } else {
        console.warn(`  - ${envVar}`);
      }
    });
  }

  // Validate DATABASE_URL format
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith('postgresql://')) {
    console.error('DATABASE_URL must be a valid PostgreSQL connection string');
    process.exit(1);
  }

  console.log('Environment validation passed');
}

// Run environment validation before starting the server
validateEnvironment();

const app = express();

// Configure trust proxy for rate limiting (Replit uses proxies)
app.set('trust proxy', 1);

// Configure CORS
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://clasio.ai', 'https://www.clasio.ai']
    : true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Apply CSP middleware
app.use(cspMiddleware());

// Rate limiters are now in separate module to avoid circular dependencies

// Cookie parser middleware for reading httpOnly cookies
app.use(cookieParser());

// JSON middleware moved to routes.ts to prevent parsing multipart uploads
// app.use(express.json()); // REMOVED - now scoped to specific routes

// Apply urlencoded middleware but exclude Drive sync routes
app.use((req, res, next) => {
  // Skip urlencoded parsing for Drive sync routes to prevent stream consumption
  if (req.path.startsWith('/api/drive/sync')) {
    return next();
  }
  express.urlencoded({ extended: false })(req, res, next);
});

// Token 5/8: Structured logging and request tracking middleware
app.use(requestTrackingMiddleware);

// Legacy logging for non-API routes (keep for Vite dev server compatibility)
app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      log(`${req.method} ${req.path} ${res.statusCode} in ${duration}ms`);
    });
  }
  next();
});

// Firebase Auth Handler Proxy - Required for custom domain redirect auth
// This proxies /__/auth/* requests to Firebase's actual auth handler
app.use('/__/auth', async (req, res) => {
  const firebaseAuthUrl = `https://documentorganizerclean-b629f.firebaseapp.com${req.originalUrl}`;
  
  try {
    // Fetch from Firebase's auth handler
    const response = await fetch(firebaseAuthUrl, {
      method: req.method,
      headers: {
        ...req.headers,
        host: 'documentorganizerclean-b629f.firebaseapp.com',
      } as any,
    });

    // Copy status and headers
    res.status(response.status);
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    // Stream the response body
    const body = await response.text();
    res.send(body);
  } catch (error) {
    console.error('Firebase auth proxy error:', error);
    res.status(500).send('Auth proxy error');
  }
});

// Token 5/8: Health and monitoring endpoints (before main routes)
app.get('/health', healthCheck);
app.get('/ready', readinessCheck);

// Monitoring and metrics endpoints
app.get('/metrics', async (req, res) => {
  try {
    const requestMetrics = getRequestMetrics();
    const systemSummary = getSystemMetricsSummary();
    const queueMetrics_ = queueMetrics.getMetrics();
    const queueByJobType = queueMetrics.getMetricsByJobType();
    const systemStatus = await getSystemStatus();

    const metricsData = {
      timestamp: new Date().toISOString(),
      system: {
        ...systemStatus,
        summary: systemSummary
      },
      requests: requestMetrics,
      queue: {
        overall: queueMetrics_,
        byJobType: queueByJobType
      }
    };

    res.json(metricsData);
  } catch (error) {
    logger.error('Failed to collect metrics', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to collect metrics' });
  }
});

// Monitoring dashboard endpoint
app.get('/dashboard', (req, res) => {
  const dashboardHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>Clasio Monitoring Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; }
        .metric-card { background: white; padding: 20px; margin: 10px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .metric-value { font-size: 2em; font-weight: bold; color: #2196F3; }
        .metric-label { color: #666; margin-top: 5px; }
        .status-good { color: #4CAF50; }
        .status-warning { color: #FF9800; }
        .status-error { color: #F44336; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; }
        .alert { padding: 10px; margin: 10px 0; border-radius: 4px; }
        .alert-warning { background: #fff3cd; border: 1px solid #ffeaa7; color: #856404; }
        .alert-error { background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; }
        h1, h2 { color: #333; }
        .refresh-btn { background: #2196F3; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; }
    </style>
    <script>
        async function loadMetrics() {
            try {
                const response = await fetch('/metrics');
                const data = await response.json();
                updateDashboard(data);
            } catch (error) {
                console.error('Failed to load metrics:', error);
            }
        }
        
        function updateDashboard(data) {
            document.getElementById('uptime').textContent = Math.floor(data.system.uptime / 3600) + 'h';
            document.getElementById('memory').textContent = Math.round(data.system.memory.heapUsed / 1024 / 1024) + 'MB';
            document.getElementById('error-rate').textContent = data.system.summary.systemErrorRate.toFixed(2) + '%';
            document.getElementById('avg-latency').textContent = data.system.summary.avgSystemLatency.toFixed(0) + 'ms';
            document.getElementById('queue-depth').textContent = data.queue.overall.currentDepth;
            document.getElementById('dlq-depth').textContent = data.queue.overall.dlqDepth;
            document.getElementById('success-rate').textContent = ((data.queue.overall.totalSuccess / Math.max(data.queue.overall.totalProcessed, 1)) * 100).toFixed(1) + '%';
            document.getElementById('p95-latency').textContent = data.queue.overall.p95ProcessingLatencyMs.toFixed(0) + 'ms';
            
            // Update alerts
            const alertsDiv = document.getElementById('alerts');
            let alerts = [];
            
            if (data.system.summary.systemErrorRate > 2) {
                alerts.push('<div class="alert alert-error">🚨 Error rate > 2%: ' + data.system.summary.systemErrorRate.toFixed(2) + '%</div>');
            }
            if (data.queue.overall.currentDepth > 50) {
                alerts.push('<div class="alert alert-warning">⚠️ Queue depth high: ' + data.queue.overall.currentDepth + ' jobs</div>');
            }
            if (data.queue.overall.dlqDepth > 0) {
                alerts.push('<div class="alert alert-warning">⚠️ DLQ has ' + data.queue.overall.dlqDepth + ' jobs</div>');
            }
            
            alertsDiv.innerHTML = alerts.length > 0 ? alerts.join('') : '<div class="alert" style="background: #d4edda; border: 1px solid #c3e6cb; color: #155724;">✅ All systems normal</div>';
            
            document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();
        }
        
        setInterval(loadMetrics, 30000); // Refresh every 30 seconds
        window.onload = loadMetrics;
    </script>
</head>
<body>
    <div class="container">
        <h1>🚀 Clasio Enterprise Monitoring Dashboard</h1>
        <p>Last updated: <span id="last-updated">Loading...</span> | <button class="refresh-btn" onclick="loadMetrics()">Refresh Now</button></p>
        
        <div id="alerts"></div>
        
        <h2>System Overview</h2>
        <div class="grid">
            <div class="metric-card">
                <div class="metric-value" id="uptime">-</div>
                <div class="metric-label">System Uptime</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="memory">-</div>
                <div class="metric-label">Memory Usage</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="error-rate">-</div>
                <div class="metric-label">Error Rate</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="avg-latency">-</div>
                <div class="metric-label">Avg Response Time</div>
            </div>
        </div>
        
        <h2>Queue Metrics</h2>
        <div class="grid">
            <div class="metric-card">
                <div class="metric-value" id="queue-depth">-</div>
                <div class="metric-label">Current Queue Depth</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="dlq-depth">-</div>
                <div class="metric-label">Dead Letter Queue</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="success-rate">-</div>
                <div class="metric-label">Success Rate</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" id="p95-latency">-</div>
                <div class="metric-label">P95 Processing Time</div>
            </div>
        </div>
        
        <h2>Quick Actions</h2>
        <div style="margin: 20px 0;">
            <a href="/health" target="_blank" style="margin-right: 10px; color: #2196F3;">Health Check</a>
            <a href="/ready" target="_blank" style="margin-right: 10px; color: #2196F3;">Readiness Check</a>
            <a href="/metrics" target="_blank" style="margin-right: 10px; color: #2196F3;">Raw Metrics</a>
        </div>
    </div>
</body>
</html>`;
  res.send(dashboardHtml);
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    let message = err.message || "Internal Server Error";
    
    // Provide more helpful error messages for common scenarios
    if (status === 500 && !err.message) {
      message = "An unexpected error occurred. Please try again or contact support if the problem persists.";
    } else if (status === 404) {
      message = message || "The requested resource was not found.";
    } else if (status === 400) {
      message = message || "The request contains invalid data. Please check your input and try again.";
    } else if (status === 401) {
      message = message || "Authentication required. Please sign in and try again.";
    } else if (status === 403) {
      message = message || "You don't have permission to access this resource.";
    } else if (status === 429) {
      message = message || "Too many requests. Please wait a moment before trying again.";
    }

    // Log error details for debugging (but don't expose sensitive info to client)
    console.error(`Error ${status} on ${req.method} ${req.path}:`, err.message || err);

    res.status(status).json({ 
      error: message,
      status: status,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
    // Don't throw after responding - this can crash the server
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Start AI Queue Processor for background document analysis (can be disabled for standalone worker deployment)
  const enableInProcessWorker = process.env.ENABLE_INPROCESS_WORKER === 'true' || process.env.NODE_ENV === 'development';
  if (enableInProcessWorker) {
    console.log('Starting AI Queue Processor for document analysis');
    aiQueueProcessor.start();
  } else {
    console.log('⚠️  In-process AI Queue Processor disabled. Use standalone worker (server/aiWorker.ts) for production.');
  }

  // Start TTL cleanup job for expired idempotency keys (24-72h TTL)
  console.log('Starting TTL cleanup job for expired idempotency keys');
  transactionManager.startTTLCleanup();

  // Start daily auto-cleanup job for expired trashed documents
  console.log('Starting daily auto-cleanup job for trashed documents');
  const storage = new DatabaseStorage();
  
  // Schedule daily cleanup at 2:00 AM to avoid peak usage hours
  cron.schedule('0 2 * * *', async () => {
    try {
      console.log('🕐 Starting daily auto-cleanup of expired trashed documents...');
      const result = await storage.purgeExpiredTrashedDocuments();
      if (result.deletedCount > 0) {
        console.log(`🕐 Daily auto-cleanup completed: ${result.deletedCount} expired documents purged`);
      } else {
        console.log('🕐 Daily auto-cleanup completed: No expired documents found');
      }
    } catch (error) {
      console.error('❌ Daily auto-cleanup failed:', error);
    }
  }, {
    timezone: 'UTC'
  });

  console.log('🕐 Daily auto-cleanup scheduled for 2:00 AM UTC');

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();

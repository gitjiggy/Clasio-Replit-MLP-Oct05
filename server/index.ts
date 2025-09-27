import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { aiQueueProcessor } from "./aiQueueProcessor";
import * as cron from "node-cron";
import { DatabaseStorage } from "./storage";
import { getSecurityConfig, getHelmetConfig, logSecurityStatus } from "./security";

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

// Security configuration based on environment
const securityConfig = getSecurityConfig();

// Configure CORS with environment-based origins
app.use(cors({
  origin: securityConfig.corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Security middleware with staged rollout capabilities
app.use(helmet(getHelmetConfig()));

// Log security status on startup
logSecurityStatus();

// Rate limiters are now in separate module to avoid circular dependencies

// Cookie parser middleware for reading httpOnly cookies
app.use(cookieParser());

// JSON middleware moved to routes.ts to prevent parsing multipart uploads
// app.use(express.json()); // REMOVED - now scoped to specific routes
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
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

  // Start AI Queue Processor for background document analysis
  console.log('Starting AI Queue Processor for document analysis');
  aiQueueProcessor.start();

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

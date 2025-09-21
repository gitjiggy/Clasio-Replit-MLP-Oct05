import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { aiQueueProcessor } from "./aiQueueProcessor";
import { enterpriseJobQueue } from "./services/jobQueue";

// SMB-Enhanced: Initialize error tracking and structured logging FIRST
import { initializeSentry } from './middleware/sentry';
import { 
  logger, 
  requestLoggingMiddleware, 
  errorLoggingMiddleware, 
  organizationContextMiddleware 
} from './middleware/logging';
import { sentryContextMiddleware } from './middleware/sentry';
import * as Sentry from '@sentry/node';

// Initialize Sentry before anything else for SMB error tracking
initializeSentry();

// SMB-Enhanced: Environment variable validation with structured logging
function validateEnvironment() {
  const requiredEnvVars = [
    'DATABASE_URL',
    'VITE_FIREBASE_PROJECT_ID',
  ];
  
  const optionalEnvVars = [
    'GEMINI_API_KEY', // Optional but recommended for AI features
    'SENTRY_DSN', // Optional but recommended for error tracking
    'PORT',
  ];

  const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);
  
  if (missing.length > 0) {
    logger.error('Missing required environment variables', { missingVars: missing });
    missing.forEach(envVar => logger.error(`Missing: ${envVar}`));
    logger.error('Please set these environment variables before starting the server.');
    process.exit(1);
  }

  // Warn about missing optional variables
  const missingOptional = optionalEnvVars.filter(envVar => !process.env[envVar]);
  if (missingOptional.length > 0) {
    logger.warn('Missing optional environment variables', { missingOptional });
    missingOptional.forEach(envVar => {
      if (envVar === 'GEMINI_API_KEY') {
        logger.warn(`Missing ${envVar} - AI analysis features will be disabled`);
      } else if (envVar === 'SENTRY_DSN') {
        logger.warn(`Missing ${envVar} - Error tracking will be limited to logs`);
      } else {
        logger.warn(`Missing ${envVar}`);
      }
    });
  }

  // Validate DATABASE_URL format
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith('postgresql://')) {
    logger.error('DATABASE_URL must be a valid PostgreSQL connection string');
    process.exit(1);
  }

  logger.info('Environment validation passed', {
    requiredVarsSet: requiredEnvVars.length,
    optionalVarsSet: optionalEnvVars.length - missingOptional.length,
    nodeEnv: process.env.NODE_ENV || 'development'
  });
}

// Run environment validation before starting the server
validateEnvironment();

const app = express();

// Configure trust proxy for rate limiting (Replit uses proxies)
app.set('trust proxy', 1);

// Configure CORS for FlutterFlow and other frontends
app.use(cors({
  origin: [
    // Allow localhost for development
    "http://localhost:3000",
    "http://localhost:5000",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5000",
    // Allow Replit preview domains
    /.*\.replit\.app$/,
    /.*\.replit\.dev$/,
    // Allow FlutterFlow domains
    /.*\.flutterflow\.app$/,
    /.*\.web\.app$/,
    /.*\.firebaseapp\.com$/,
    // Allow custom domains (add your FlutterFlow domain here when you get it)
    // "https://your-custom-domain.com"
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-drive-access-token']
}));

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline styles/scripts for development
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' } // Allow OAuth popup flows
}));

// SMB-Enhanced: Structured logging and error tracking middleware
app.use(requestLoggingMiddleware());
app.use(organizationContextMiddleware());
app.use(sentryContextMiddleware());

// Rate limiters are now in separate module to avoid circular dependencies

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Legacy logging middleware replaced by structured logging above
// The requestLoggingMiddleware() handles comprehensive request/response logging

(async () => {
  const server = await registerRoutes(app);

  // SMB-Enhanced: Sentry error handler (v10+ single setup - after routes, before other handlers)
  if (process.env.SENTRY_DSN) {
    Sentry.setupExpressErrorHandler(app);
  }
  
  // SMB-Enhanced: Structured logging error handler  
  app.use(errorLoggingMiddleware());
  
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

    // Enhanced error logging with business context
    logger.error('Request error handled', err, {
      statusCode: status,
      userMessage: message,
      originalMessage: err.message
    }, req);

    // Don't send response if headers already sent
    if (!res.headersSent) {
      res.status(status).json({ 
        error: message,
        status: status,
        requestId: req.requestId, // Include request ID for debugging
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
      });
    }
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // SMB-Enhanced: Start background processors with structured logging
  logger.info('Starting AI Queue Processor for smart document analysis');
  logger.business('ai_processor_started', { processor: 'gemini_analysis' });
  aiQueueProcessor.start();

  logger.info('Starting Enterprise Job Queue for multi-tenant background processing');
  logger.business('job_queue_started', { processor: 'enterprise_jobs' });
  enterpriseJobQueue.start();

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
    logger.info('Clasio Document Management Server started', {
      port,
      environment: process.env.NODE_ENV || 'development',
      features: {
        ai_analysis: !!process.env.GEMINI_API_KEY,
        error_tracking: !!process.env.SENTRY_DSN,
        structured_logging: true
      }
    });
    logger.business('server_started', { port, host: '0.0.0.0' });
    log(`serving on port ${port}`);
  });
})();

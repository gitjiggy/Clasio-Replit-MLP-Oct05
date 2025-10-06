// Server-side Firebase authentication middleware
import admin from 'firebase-admin';
import { Request, Response, NextFunction } from 'express';
import { logger } from './logger.js';

/**
 * Initialize Firebase Admin SDK for token verification
 * MUST be called explicitly during server startup to ensure initialization
 * and proper error logging in production builds
 */
export function initializeFirebaseAdmin(): void {
  // Skip if already initialized
  if (admin.apps.length > 0) {
    logger.info('Firebase Admin already initialized');
    return;
  }

  // Use GCP service account key for Firebase Admin in production
  // This allows us to verify ID tokens properly
  const serviceAccountKey = process.env.GCP_SERVICE_ACCOUNT_KEY;
  const projectId = process.env.GCP_PROJECT_ID;
  
  if (serviceAccountKey && projectId) {
    try {
      const serviceAccount = JSON.parse(serviceAccountKey);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: projectId
      });
      logger.info('Firebase Admin initialized', { metadata: { projectId, method: 'service_account' } });
    } catch (error) {
      logger.error('Firebase Admin initialization failed', {
        metadata: {
          projectId,
          method: 'service_account',
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined
        }
      });
      throw new Error(`Firebase Admin initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  } else if (projectId) {
    try {
      admin.initializeApp({ projectId: projectId });
      logger.info('Firebase Admin initialized', { metadata: { projectId, method: 'project_id_only' } });
    } catch (error) {
      logger.error('Firebase Admin initialization failed', {
        metadata: {
          projectId,
          method: 'project_id_only',
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined
        }
      });
      throw new Error(`Firebase Admin initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  } else {
    logger.error('Firebase credentials missing', {
      metadata: {
        missingVars: ['GCP_SERVICE_ACCOUNT_KEY', 'GCP_PROJECT_ID']
      }
    });
    throw new Error('Firebase Admin cannot be initialized: missing required environment variables');
  }
}

// Lazy getter for Firebase Admin Auth - only initialized when needed
// This prevents module-load-time crashes if Firebase isn't fully initialized
export function getAdminAuth() {
  return admin.auth();
}

// Export function to validate Firebase Admin is ready
export function validateFirebaseAdmin(): void {
  if (!admin.apps.length) {
    throw new Error('Firebase Admin not initialized');
  }
  
  try {
    // Test that auth() is accessible
    const auth = admin.auth();
    logger.info('Firebase Admin validation passed');
  } catch (error) {
    logger.error('Firebase Admin validation failed', {
      metadata: {
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    });
    throw new Error(`Firebase Admin is not properly configured: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export interface AuthenticatedRequest extends Request {
  user?: admin.auth.DecodedIdToken;
  userId?: string;
}

// Enhanced middleware to verify Firebase ID token with multiple token sources
export const verifyFirebaseToken = async (
  req: AuthenticatedRequest, 
  res: Response, 
  next: NextFunction
): Promise<void> => {
  try {
    // Extract token from multiple sources
    const authHeader = req.headers.authorization || "";
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    const idToken = 
      bearerMatch?.[1] ||
      req.cookies?.__session || 
      req.cookies?.auth_token;

    if (!idToken) {
      res.status(401).json({ 
        error: "unauthenticated",
        message: "Please sign in to continue" 
      });
      return;
    }

    // DEVELOPMENT ONLY: Handle test authentication token
    if (process.env.NODE_ENV === 'development' && idToken === 'test-token-for-automated-testing-only') {
      const testUser = {
        uid: 'test-user-uid',
        email: 'test@example.com',
        name: 'Test User',
        iss: 'test',
        aud: 'test',
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        iat: Math.floor(Date.now() / 1000),
        sub: 'test-user-uid'
      };
      
      req.user = testUser as any;
      req.userId = testUser.uid;
      
      next();
      return;
    }

    // Verify the Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // Add user info to request
    req.user = decodedToken;
    req.userId = decodedToken.uid;
    
    next();
    
  } catch (error) {
    // Log auth failures with structured metadata
    logger.error('Auth verification failed', {
      reqId: (req as any).reqId,
      route: req.path,
      method: req.method,
      metadata: {
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorStack: error instanceof Error ? error.stack : undefined
      }
    });
    
    // Provide more specific error messages for debugging
    if (error instanceof Error) {
      if (error.message.includes('project ID')) {
        res.status(500).json({ 
          error: 'Server authentication not configured',
          message: 'Contact support if this persists'
        });
      } else if (error.message.includes('Decoding Firebase ID token failed')) {
        res.status(401).json({ 
          error: 'Firebase authentication failed',
          message: 'Please refresh the page and sign in again'
        });
      } else if (error.message.includes('expired')) {
        res.status(401).json({ 
          error: 'Session expired',
          message: 'Your session has expired. Please refresh the page and sign in again'
        });
      } else {
        res.status(401).json({ 
          error: 'Authentication failed',
          message: 'Please refresh the page and sign in again'
        });
      }
    } else {
      res.status(401).json({ 
        error: 'Invalid or expired token',
        message: 'Please refresh the page and sign in again'
      });
    }
    return; // CRITICAL: Stop execution after sending error response
  }
};

// Optional middleware - allows both authenticated and unauthenticated requests
export const optionalAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decodedToken = await admin.auth().verifyIdToken(token);
      req.user = decodedToken;
      req.userId = decodedToken.uid;
    }
    
    next();
  } catch (error) {
    // Don't fail for invalid tokens in optional auth, just proceed without user info
    logger.warn('Optional auth token verification failed', {
      metadata: {
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    });
    next();
  }
};

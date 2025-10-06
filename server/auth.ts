// Server-side Firebase authentication middleware
import admin from 'firebase-admin';
import { Request, Response, NextFunction } from 'express';

// Initialize Firebase Admin SDK for token verification
if (!admin.apps.length) {
  // Use GCP service account key for Firebase Admin in production
  // This allows us to verify ID tokens properly
  const serviceAccountKey = process.env.GCP_SERVICE_ACCOUNT_KEY;
  const projectId = process.env.GCP_PROJECT_ID;
  
  if (serviceAccountKey && projectId) {
    console.log('🔑 Initializing Firebase Admin with service account credentials...');
    console.log('📋 Project ID:', projectId);
    console.log('📋 Service account key length:', serviceAccountKey.length);
    
    try {
      // Step 1: Parse the JSON
      console.log('🔄 Step 1: Parsing service account JSON...');
      const serviceAccount = JSON.parse(serviceAccountKey);
      console.log('✅ JSON.parse succeeded');
      console.log('📋 Service account email:', serviceAccount.client_email);
      console.log('📋 Service account project_id:', serviceAccount.project_id);
      
      // Step 2: Initialize Firebase Admin
      console.log('🔄 Step 2: Calling admin.initializeApp...');
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: projectId
      });
      
      console.log('✅ Firebase Admin initialized successfully');
    } catch (error) {
      console.error('❌ FATAL: Failed to initialize Firebase Admin with service account');
      console.error('❌ Error type:', error?.constructor?.name);
      console.error('❌ Error message:', error instanceof Error ? error.message : String(error));
      console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      console.error('❌ Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
      throw new Error(`Firebase Admin initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  } else if (projectId) {
    // Fallback: Initialize with just project ID (works in some environments)
    console.warn('⚠️  No service account key found. Initializing with project ID only...');
    try {
      admin.initializeApp({
        projectId: projectId,
      });
      console.log('✅ Firebase Admin initialized with project ID only');
    } catch (error) {
      console.error('❌ FATAL: Failed to initialize Firebase Admin with project ID:', error);
      throw new Error(`Firebase Admin initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  } else {
    // No credentials available - cannot initialize
    console.error('❌ FATAL: No Firebase credentials found. Missing both:');
    console.error('  - GCP_SERVICE_ACCOUNT_KEY (Firebase service account JSON)');
    console.error('  - GCP_PROJECT_ID (Firebase project ID)');
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
    console.log('✅ Firebase Admin validation passed');
  } catch (error) {
    console.error('❌ Firebase Admin validation failed:', error);
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
      console.log(`🔒 Auth required for ${req.method} ${req.path} - no token provided`);
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
      
      console.log(`✅ Test auth verified for ${req.method} ${req.path} - uid: ${req.userId}`);
      next();
      return;
    }

    // Verify the Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // Add user info to request
    req.user = decodedToken;
    req.userId = decodedToken.uid;
    
    console.log(`✅ Auth verified for ${req.method} ${req.path} - uid: ${req.userId}`);
    next();
    
  } catch (error) {
    console.error(`🚫 Auth failed for ${req.method} ${req.path} - ${error instanceof Error ? error.message : 'Unknown error'}`);
    
    // Log auth failures with correlation ID for debugging
    if ((req as any).reqId) {
      console.error(JSON.stringify({
        evt: "auth.error",
        reqId: (req as any).reqId,
        route: req.path,
        method: req.method,
        reason: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      }));
    }
    
    // Provide more specific error messages for debugging
    if (error instanceof Error) {
      if (error.message.includes('project ID')) {
        console.error('❌ CRITICAL: Firebase Admin not properly configured. Missing project ID or service account credentials.');
        res.status(500).json({ 
          error: 'Server authentication not configured',
          message: 'Contact support if this persists'
        });
      } else if (error.message.includes('Decoding Firebase ID token failed')) {
        console.error('Firebase ID token is malformed or invalid');
        res.status(401).json({ 
          error: 'Firebase authentication failed',
          message: 'Please refresh the page and sign in again'
        });
      } else if (error.message.includes('expired')) {
        console.error('Firebase ID token has expired');
        res.status(401).json({ 
          error: 'Session expired',
          message: 'Your session has expired. Please refresh the page and sign in again'
        });
      } else {
        console.error('Other Firebase auth error:', error.message);
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
    console.warn('Optional auth token verification failed:', error);
    next();
  }
};

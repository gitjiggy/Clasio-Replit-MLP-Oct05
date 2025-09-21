// Server-side Firebase authentication middleware
import admin from 'firebase-admin';
import { Request, Response, NextFunction } from 'express';

// Initialize Firebase Admin SDK for token verification
if (!admin.apps.length) {
  try {
    // For Replit environment, we'll use a simpler approach with just the project ID
    // This allows us to verify ID tokens without full admin privileges
    admin.initializeApp({
      projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    });
  } catch (error) {
    console.error('Failed to initialize Firebase Admin:', error);
  }
}

export interface AuthenticatedRequest extends Request {
  user?: admin.auth.DecodedIdToken;
  userId?: string;
}

// Middleware to verify Firebase ID token
export const verifyFirebaseToken = async (
  req: AuthenticatedRequest, 
  res: Response, 
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid authorization header' });
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Verify the ID token
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    // Add user info to request
    req.user = decodedToken;
    req.userId = decodedToken.uid;
    
    next();
  } catch (error) {
    console.error('Error verifying Firebase token:', error);
    
    // Provide more specific error messages for debugging
    if (error instanceof Error) {
      if (error.message.includes('Decoding Firebase ID token failed')) {
        console.error('🔥 Firebase ID token is malformed or invalid');
        res.status(401).json({ error: 'Firebase authentication failed. Please refresh the page and sign in again.' });
      } else if (error.message.includes('expired')) {
        console.error('🕒 Firebase ID token has expired');
        res.status(401).json({ error: 'Your session has expired. Please refresh the page and sign in again.' });
      } else {
        console.error('🚫 Other Firebase auth error:', error.message);
        res.status(401).json({ error: 'Authentication failed. Please refresh the page and sign in again.' });
      }
    } else {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
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
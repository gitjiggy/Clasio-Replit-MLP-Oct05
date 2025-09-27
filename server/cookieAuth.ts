import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';

// Cookie configuration based on environment
export const DRIVE_TOKEN_COOKIE_NAME = 'drive_access_token';
export const DRIVE_TOKEN_TIMESTAMP_COOKIE_NAME = 'drive_access_token_time';

export const getCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  return {
    httpOnly: true,
    secure: isProduction, // HTTPS only in production
    sameSite: isProduction ? 'strict' : 'lax' as const,
    domain: isProduction ? '.clasio.ai' : undefined, // Support subdomains in production
    path: '/',
    maxAge: 50 * 60 * 1000 // 50 minutes (tokens expire at 60 minutes)
  };
};

// Set Drive access token in httpOnly cookie
export const setDriveTokenCookie = (res: Response, token: string) => {
  const options = getCookieOptions();
  
  // Set the token
  res.cookie(DRIVE_TOKEN_COOKIE_NAME, token, options);
  
  // Set the timestamp for expiration checking
  res.cookie(DRIVE_TOKEN_TIMESTAMP_COOKIE_NAME, Date.now().toString(), options);
  
  // Add telemetry header to track cookie usage
  res.setHeader('X-Drive-Auth-Method', 'cookie');
};

// Clear Drive token cookies on sign-out
export const clearDriveTokenCookies = (res: Response) => {
  const options = getCookieOptions();
  
  res.clearCookie(DRIVE_TOKEN_COOKIE_NAME, options);
  res.clearCookie(DRIVE_TOKEN_TIMESTAMP_COOKIE_NAME, options);
};

// Get Drive token from cookie or header (dual path support)
export const getDriveToken = (req: Request): { token: string | null; source: 'cookie' | 'header' | null } => {
  // First try cookie (preferred method)
  const cookieToken = req.cookies?.[DRIVE_TOKEN_COOKIE_NAME];
  const cookieTimestamp = req.cookies?.[DRIVE_TOKEN_TIMESTAMP_COOKIE_NAME];
  
  if (cookieToken && cookieTimestamp) {
    // Check if token is still valid (not older than 50 minutes)
    const tokenAge = Date.now() - parseInt(cookieTimestamp);
    const fiftyMinutes = 50 * 60 * 1000;
    
    if (tokenAge <= fiftyMinutes) {
      // Log telemetry for cookie usage
      console.log('[Telemetry] Drive auth via cookie');
      return { token: cookieToken, source: 'cookie' };
    }
  }
  
  // Fallback to header (legacy method for dual path)
  const headerToken = req.headers['x-drive-access-token'] as string;
  if (headerToken) {
    // Log telemetry for header usage (should decrease over time)
    console.log('[Telemetry] Drive auth via header (legacy)');
    return { token: headerToken, source: 'header' };
  }
  
  return { token: null, source: null };
};

// CSRF protection middleware
export const csrfProtection = (req: Request, res: Response, next: NextFunction) => {
  // Skip CSRF check for GET requests (read-only)
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  
  // Check for CSRF header
  const csrfHeader = req.headers['x-requested-with'];
  
  if (!csrfHeader || csrfHeader !== 'XMLHttpRequest') {
    console.warn('[Security] CSRF protection: Missing or invalid X-Requested-With header');
    return res.status(403).json({ 
      error: 'CSRF protection', 
      message: 'Request must include X-Requested-With: XMLHttpRequest header' 
    });
  }
  
  next();
};

// Enhanced Drive access middleware with cookie support
export async function requireDriveAccessWithCookie(
  req: AuthenticatedRequest, 
  res: Response, 
  next: NextFunction
) {
  try {
    const { token, source } = getDriveToken(req);
    
    if (!token) {
      return res.status(401).json({ 
        error: "Google Drive access token required",
        message: "Please authenticate with Google Drive first"
      });
    }
    
    // Add telemetry metadata to request
    (req as any).driveAuthSource = source;
    (req as any).driveAccessToken = token;
    
    // The existing Drive verification logic will be handled by the original middleware
    next();
  } catch (error) {
    console.error("Drive cookie access failed:", error);
    return res.status(401).json({ 
      error: "Invalid Drive authentication",
      message: "Please re-authenticate with Google Drive"
    });
  }
}
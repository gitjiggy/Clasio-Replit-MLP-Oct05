import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';

// Cookie configuration based on environment
export const DRIVE_TOKEN_COOKIE_NAME = 'drive_access_token';
export const DRIVE_TOKEN_TIMESTAMP_COOKIE_NAME = 'drive_access_token_time';

export const getCookieOptions = (req?: Request) => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Derive domain dynamically from request hostname
  let domain = undefined;
  let isReplitDev = false;
  
  if (req) {
    const hostname = req.get('host') || req.hostname;
    console.log(`[Cookie Config] Request hostname: ${hostname}, NODE_ENV: ${process.env.NODE_ENV}`);
    
    if (hostname) {
      // Check if this is a replit.dev domain
      isReplitDev = hostname.includes('replit.dev');
      
      if (isReplitDev) {
        // For staging on replit.dev: Extract full subdomain (e.g., .abc-123.janeway.replit.dev)
        const replitParts = hostname.split('.');
        if (replitParts.length >= 3) {
          domain = '.' + replitParts.slice(-3).join('.'); // .janeway.replit.dev
        }
        console.log(`[Cookie Config] Replit.dev domain detected: ${domain}`);
      } else if (hostname.includes('clasio.ai')) {
        // For production on clasio.ai
        domain = '.clasio.ai';
        console.log(`[Cookie Config] Clasio.ai domain detected: ${domain}`);
      } else {
        // Generic domain resolution
        const parts = hostname.split('.');
        if (parts.length >= 2) {
          domain = '.' + parts.slice(-2).join('.');
        }
        console.log(`[Cookie Config] Generic domain resolution: ${domain}`);
      }
    }
  }
  
  // Different security settings for staging vs production
  const secure = isReplitDev ? false : isProduction; // HTTP allowed for replit.dev staging
  const sameSite = isReplitDev ? 'lax' : (isProduction ? 'strict' : 'lax') as 'strict' | 'lax';
  
  const options = {
    httpOnly: true,
    secure,
    sameSite,
    domain,
    path: '/',
    maxAge: 50 * 60 * 1000 // 50 minutes (tokens expire at 60 minutes)
  };
  
  console.log(`[Cookie Config] Final options:`, {
    domain: options.domain,
    secure: options.secure,
    sameSite: options.sameSite,
    httpOnly: options.httpOnly,
    isReplitDev,
    hostname: req?.get('host') || req?.hostname
  });
  
  return options;
};

// Set Drive access token in httpOnly cookie
export const setDriveTokenCookie = (res: Response, token: string, req?: Request) => {
  const options = getCookieOptions(req);
  
  console.log(`[setDriveTokenCookie] Setting Drive token cookie with options:`, {
    domain: options.domain,
    secure: options.secure,
    sameSite: options.sameSite,
    httpOnly: options.httpOnly,
    tokenLength: token?.length || 0,
    hostname: req?.get('host') || req?.hostname,
    reqId: (req as any)?.reqId
  });
  
  // Set the token
  res.cookie(DRIVE_TOKEN_COOKIE_NAME, token, options);
  console.log(`[setDriveTokenCookie] ✅ Set ${DRIVE_TOKEN_COOKIE_NAME} cookie`);
  
  // Set the timestamp for expiration checking
  res.cookie(DRIVE_TOKEN_TIMESTAMP_COOKIE_NAME, Date.now().toString(), options);
  console.log(`[setDriveTokenCookie] ✅ Set ${DRIVE_TOKEN_TIMESTAMP_COOKIE_NAME} cookie`);
  
  // Add telemetry header to track cookie usage
  res.setHeader('X-Drive-Auth-Method', 'cookie');
};

// Clear Drive token cookies on sign-out
export const clearDriveTokenCookies = (res: Response, req?: Request) => {
  const options = getCookieOptions(req);
  
  console.log(`[clearDriveTokenCookies] Clearing Drive token cookies with options:`, {
    domain: options.domain,
    secure: options.secure,
    sameSite: options.sameSite,
    hostname: req?.get('host') || req?.hostname,
    reqId: (req as any)?.reqId
  });
  
  res.clearCookie(DRIVE_TOKEN_COOKIE_NAME, options);
  res.clearCookie(DRIVE_TOKEN_TIMESTAMP_COOKIE_NAME, options);
  
  console.log(`[clearDriveTokenCookies] ✅ Cleared Drive token cookies`);
};

// Get Drive token from httpOnly cookie only (legacy header path removed)
export const getDriveToken = (req: Request): { token: string | null; source: 'cookie' | null } => {
  const cookieToken = req.cookies?.[DRIVE_TOKEN_COOKIE_NAME];
  const cookieTimestamp = req.cookies?.[DRIVE_TOKEN_TIMESTAMP_COOKIE_NAME];
  
  if (cookieToken && cookieTimestamp) {
    // Check if token is still valid (not older than 50 minutes)
    const tokenAge = Date.now() - parseInt(cookieTimestamp);
    const fiftyMinutes = 50 * 60 * 1000;
    
    if (tokenAge <= fiftyMinutes) {
      console.log('[Auth] Drive authentication via httpOnly cookie');
      return { token: cookieToken, source: 'cookie' };
    } else {
      console.log('[Auth] Drive cookie expired, requiring re-authentication');
    }
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

// Middleware to explicitly reject legacy x-drive-access-token header
export const rejectLegacyDriveHeader = (req: Request, res: Response, next: NextFunction) => {
  const legacyHeader = req.headers['x-drive-access-token'];
  
  if (legacyHeader) {
    console.warn('[Security] Rejected request with legacy x-drive-access-token header');
    return res.status(400).json({
      error: 'Legacy authentication method not supported',
      message: 'Drive authentication now uses secure httpOnly cookies. Please refresh and re-authenticate.',
      code: 'LEGACY_AUTH_REJECTED'
    });
  }
  
  next();
};

// Drive access middleware - cookie only
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
        message: "Please authenticate with Google Drive using the secure cookie method"
      });
    }
    
    // Add metadata to request
    (req as any).driveAuthSource = source;
    (req as any).driveAccessToken = token;
    
    next();
  } catch (error) {
    console.error("Drive cookie authentication failed:", error);
    return res.status(401).json({ 
      error: "Invalid Drive authentication",
      message: "Please re-authenticate with Google Drive"
    });
  }
}
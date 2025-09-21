import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// Rate limiting configuration - separated to avoid circular dependencies

// User-based key generator for authenticated routes with proper IPv6 handling
function userBasedKeyGenerator(req: any) {
  // Use Firebase UID if available (for authenticated routes), otherwise fall back to properly handled IP
  return req.user?.uid || ipKeyGenerator(req);
}

export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: {
    error: "Too many resource-intensive requests",
    retryAfter: "15 minutes"
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userBasedKeyGenerator,
});

export const moderateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 requests per window
  message: {
    error: "Too many API requests",
    retryAfter: "15 minutes"
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userBasedKeyGenerator,
});

export const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes 
  max: 100, // 100 requests per window
  message: {
    error: "Too many requests",
    retryAfter: "15 minutes"
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userBasedKeyGenerator,
});

export const bulkUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 bulk operations per window
  message: {
    error: "Whoa there, speed racer! 🚀 Too many bulk uploads. Even our servers need to catch their breath sometimes!",
    retryAfter: "15 minutes",
    funnyMessage: "Our hamsters powering the upload servers are getting dizzy from all that spinning! 🐹💫"
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userBasedKeyGenerator,
});
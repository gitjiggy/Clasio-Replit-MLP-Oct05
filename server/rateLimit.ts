import rateLimit from "express-rate-limit";

// Rate limiting configuration - separated to avoid circular dependencies

// User-based key generator for authenticated routes
function userBasedKeyGenerator(req: any) {
  // Use Firebase UID if available (for authenticated routes), otherwise fall back to IP
  return req.user?.uid || req.ip;
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
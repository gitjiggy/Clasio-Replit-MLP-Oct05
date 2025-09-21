import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { logger } from './middleware/logging';

// Rate limiting configuration - separated to avoid circular dependencies

// SMB-Enhanced: Organization-based key generator for true multi-tenant rate limiting
function organizationBasedKeyGenerator(req: any): string {
  // Prioritize organization-based limiting over user-based
  const organizationId = req.organizationId || req.user?.organizationId;
  const userId = req.user?.uid;
  
  if (organizationId) {
    logger.debug('Rate limit using organization key', { organizationId, userId });
    return `org:${organizationId}`;
  }
  
  if (userId) {
    logger.debug('Rate limit using user key', { userId });
    return `user:${userId}`;
  }
  
  // Fallback to IP-based limiting with proper IPv6 handling
  logger.debug('Rate limit using IP fallback', { ip: req.ip });
  return `ip:${ipKeyGenerator(req)}`;
}

// SMB-Enhanced: Dynamic rate limiting based on organization tier
function createTieredRateLimiter(limits: { free: number; pro: number; enterprise: number }, windowMs = 15 * 60 * 1000) {
  return rateLimit({
    windowMs,
    max: (req: any) => {
      const organization = req.organization;
      if (!organization) {
        logger.warn('No organization found for rate limiting, using free tier limits');
        return limits.free;
      }
      
      const tier = organization.subscriptionTier || 'free';
      const maxRequests = limits[tier as keyof typeof limits] || limits.free;
      
      logger.debug('Applied rate limit', { 
        organizationId: organization.id,
        tier,
        maxRequests,
        windowMs 
      });
      
      return maxRequests;
    },
    message: (req: any) => {
      const organization = req.organization;
      const tier = organization?.subscriptionTier || 'free';
      const maxRequests = limits[tier as keyof typeof limits] || limits.free;
      
      return {
        error: `Rate limit exceeded for ${tier} tier`,
        maxRequests,
        windowMs,
        retryAfter: `${windowMs / (60 * 1000)} minutes`,
        tier,
        organizationId: organization?.id
      };
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: organizationBasedKeyGenerator,
    handler: (req: any, res: any) => {
      // Log the rate limit exceeded event
      logger.business('rate_limit_exceeded', {
        organizationId: req.organizationId,
        userId: req.user?.uid,
        tier: req.organization?.subscriptionTier || 'free',
        endpoint: req.path,
        method: req.method,
        windowMs
      });
      
      // Send response using the message function
      const organization = req.organization;
      const tier = organization?.subscriptionTier || 'free';
      const maxRequests = limits[tier as keyof typeof limits] || limits.free;
      
      res.status(429).json({
        error: `Rate limit exceeded for ${tier} tier`,
        maxRequests,
        windowMs,
        retryAfter: `${windowMs / (60 * 1000)} minutes`,
        tier,
        organizationId: organization?.id
      });
    }
  });
}

// SMB-Enhanced: Tiered rate limiters for different operation types
export const strictLimiter = createTieredRateLimiter({
  free: 3,      // Very restrictive for free tier
  pro: 8,       // Reasonable for small businesses  
  enterprise: 15 // More generous for larger SMBs
}, 15 * 60 * 1000);

export const moderateLimiter = createTieredRateLimiter({
  free: 20,     // Adequate for free tier
  pro: 50,      // Good for growing businesses
  enterprise: 100 // Generous for larger SMBs
}, 15 * 60 * 1000);

export const standardLimiter = createTieredRateLimiter({
  free: 60,     // Standard for free tier
  pro: 150,     // Higher limit for paying customers
  enterprise: 300 // Very generous for enterprise SMBs
}, 15 * 60 * 1000);

export const bulkUploadLimiter = createTieredRateLimiter({
  free: 10,     // Limited for free tier  
  pro: 25,      // Moderate for business use
  enterprise: 50 // Generous for enterprise bulk operations
}, 15 * 60 * 1000);
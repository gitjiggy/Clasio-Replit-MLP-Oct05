// Production Security Configuration
// Implements staged rollout with environment-based controls

import { randomBytes } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export interface SecurityConfig {
  corsOrigins: (string | RegExp)[];
  enableCSP: boolean;
  cspReportOnly: boolean;
  enableCOEP: boolean;
  enableSTSHeader: boolean;
  cspDirectives: Record<string, string[]>;
}

/**
 * Get security configuration based on environment with dynamic API domain management
 */
export function getSecurityConfig(): SecurityConfig {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const isProduction = process.env.NODE_ENV === 'production';
  const enableSecurityHeaders = process.env.ENABLE_SECURITY_HEADERS === 'true' || isProduction;
  const cspReportOnly = process.env.CSP_REPORT_ONLY === 'true';

  // Core Google API domains (configurable via environment)
  const coreApiDomains = [
    process.env.GOOGLE_STORAGE_ENDPOINT || 'storage.googleapis.com',
    process.env.GOOGLE_APIS_ENDPOINT || 'www.googleapis.com',
    process.env.GOOGLE_ACCOUNTS_ENDPOINT || 'accounts.google.com',
    process.env.GEMINI_API_ENDPOINT || 'generativelanguage.googleapis.com'
  ];

  // Additional allowed domains from environment
  const additionalDomains = process.env.ALLOWED_API_DOMAINS?.split(',').map(d => d.trim()) || [];

  // Combine and create HTTPS URLs (avoid double prefixing)
  const allowedApiDomains = [...coreApiDomains, ...additionalDomains]
    .filter(domain => domain && domain.length > 0)
    .map(domain => {
      if (domain.startsWith('https://') || domain.startsWith('http://')) {
        return domain;
      }
      return `https://${domain}`;
    });

  // Production domain allowlist
  const productionOrigins: (string | RegExp)[] = [
    ...(process.env.CORS_PRODUCTION_ORIGINS?.split(',').map(origin => origin.trim()) || []),
  ];

  // Development origins (broad for development)
  const developmentOrigins: (string | RegExp)[] = [
    'http://localhost:3000',
    'http://localhost:5000',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5000',
    /.*\.replit\.app$/,
    /.*\.replit\.dev$/,
  ];

  // Controlled third-party origins
  const controlledThirdPartyOrigins: (string | RegExp)[] = [
    // Add specific approved domains here
    ...(process.env.APPROVED_THIRD_PARTY_ORIGINS?.split(',').map(origin => origin.trim()) || [])
  ];

  // Security warnings
  if (isProduction && productionOrigins.length === 0) {
    console.warn('⚠️  SECURITY WARNING: No production CORS origins configured. Set CORS_PRODUCTION_ORIGINS environment variable.');
  }

  if (additionalDomains.length > 0) {
    console.log(`🔒 Additional API domains allowed: ${additionalDomains.join(', ')}`);
  }

  return {
    corsOrigins: isProduction
      ? [...productionOrigins, ...controlledThirdPartyOrigins]
      : [...developmentOrigins, ...controlledThirdPartyOrigins],

    enableCSP: enableSecurityHeaders,
    cspReportOnly: cspReportOnly || (!isProduction && enableSecurityHeaders),
    enableCOEP: enableSecurityHeaders && process.env.DISABLE_COEP !== 'true',
    enableSTSHeader: isProduction,

    cspDirectives: {
      'default-src': ["'self'"],
      'script-src': [
        "'self'",
        ...(isDevelopment ? ["'unsafe-eval'"] : []),
        "https://replit.com",
        "https://www.googletagmanager.com",
        "https://apis.google.com",
        "https://www.gstatic.com",
        "https://securetoken.googleapis.com",
        "https://identitytoolkit.googleapis.com",
        // Dynamic nonce will be injected per-request in getHelmetConfig
      ],
      'style-src': [
        "'self'",
        ...(isDevelopment ? ["'unsafe-inline'"] : []),
        "https://fonts.googleapis.com",
      ],
      'font-src': [
        "'self'",
        "https://fonts.gstatic.com",
      ],
      'img-src': [
        "'self'",
        "data:",
        "blob:",
        ...allowedApiDomains.filter(domain => domain.includes('storage.googleapis.com')),
        "https://drive.google.com",
        "https://lh3.googleusercontent.com",
      ],
      'connect-src': [
        "'self'",
        ...allowedApiDomains, // Dynamic API domains
        "https://apis.google.com",
        "https://securetoken.googleapis.com",
        "https://identitytoolkit.googleapis.com",
        "https://firebaseinstallations.googleapis.com",
        ...(isDevelopment ? ["ws://localhost:*", "wss://localhost:*"] : []),
      ],
      'frame-src': [
        "https://accounts.google.com",
        "https://drive.google.com",
      ],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'upgrade-insecure-requests': [],
    }
  };
}

/**
 * CSP Nonce middleware for dynamic script execution
 */
export function generateCSPNonce(req: Request, res: Response, next: NextFunction) {
  const nonce = randomBytes(16).toString('base64');
  res.locals.nonce = nonce;
  res.setHeader('X-CSP-Nonce', nonce); // For client-side access if needed
  next();
}

/**
 * Get helmet configuration based on security settings
 */
export function getHelmetConfig(req?: Request, res?: Response) {
  const config = getSecurityConfig();
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  // Clone CSP directives and inject per-request nonce if available
  let cspDirectives = { ...config.cspDirectives };
  if (res?.locals?.nonce) {
    cspDirectives = {
      ...cspDirectives,
      'script-src': [
        ...cspDirectives['script-src'],
        `'nonce-${res.locals.nonce}'`
      ]
    };
  }
  
  return {
    // Content Security Policy
    contentSecurityPolicy: config.enableCSP ? {
      directives: cspDirectives,
      reportOnly: config.cspReportOnly,
      // Add report URI in production
      ...(process.env.CSP_REPORT_URI && {
        reportUri: process.env.CSP_REPORT_URI
      })
    } : false,
    
    // Cross-Origin Embedder Policy (can break GCS/Drive previews)
    crossOriginEmbedderPolicy: config.enableCOEP,
    
    // Cross-Origin Opener Policy (allow OAuth popups)
    crossOriginOpenerPolicy: { 
      policy: 'same-origin-allow-popups' as const
    },
    
    // HTTP Strict Transport Security (HTTPS only)
    hsts: config.enableSTSHeader ? {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true
    } : false,
    
    // X-Content-Type-Options
    noSniff: true,
    
    // X-Frame-Options
    frameguard: { action: 'deny' },
    
    // Referrer Policy
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    
    // X-XSS-Protection (legacy but still useful)
    xssFilter: true,
    
    // X-Permitted-Cross-Domain-Policies
    permittedCrossDomainPolicies: false,
  };
}

/**
 * Log security configuration on startup
 */
export function logSecurityStatus() {
  const config = getSecurityConfig();
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  console.log('🔒 Security Configuration:');
  console.log(`   Environment: ${process.env.NODE_ENV}`);
  console.log(`   CSP Enabled: ${config.enableCSP}`);
  console.log(`   CSP Report-Only: ${config.cspReportOnly}`);
  console.log(`   COEP Enabled: ${config.enableCOEP}`);
  console.log(`   CORS Origins: ${config.corsOrigins.length} configured`);
  
  if (isDevelopment && config.enableCSP) {
    console.warn('⚠️  CSP enabled in development - watch for violations');
  }
  
  if (!config.enableCSP && process.env.NODE_ENV === 'production') {
    console.error('🚨 SECURITY WARNING: CSP disabled in production!');
  }
}
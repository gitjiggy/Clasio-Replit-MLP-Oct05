// Production Security Configuration
// Implements staged rollout with environment-based controls

export interface SecurityConfig {
  corsOrigins: (string | RegExp)[];
  enableCSP: boolean;
  cspReportOnly: boolean;
  enableCOEP: boolean;
  enableSTSHeader: boolean;
  cspDirectives: Record<string, string[]>;
}

/**
 * Get security configuration based on environment
 */
export function getSecurityConfig(): SecurityConfig {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const isProduction = process.env.NODE_ENV === 'production';
  const enableSecurityHeaders = process.env.ENABLE_SECURITY_HEADERS === 'true' || isProduction;
  const cspReportOnly = process.env.CSP_REPORT_ONLY === 'true';
  
  // Production domain allowlist - replace with your actual domains
  const productionOrigins: (string | RegExp)[] = [
    // Add your production domains here when ready
    // 'https://your-app.com',
    // 'https://www.your-app.com',
    // 'https://staging.your-app.com'
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
  
  // FlutterFlow and Firebase origins (controlled list)
  const controlledThirdPartyOrigins: (string | RegExp)[] = [
    // Only add specific FlutterFlow app domains here
    // /^https:\/\/[a-z0-9-]+\.flutterflow\.app$/,
    // /^https:\/\/[a-z0-9-]+\.web\.app$/,
    // /^https:\/\/[a-z0-9-]+\.firebaseapp\.com$/,
  ];
  
  return {
    // CORS Origins: Strict in production, permissive in development
    corsOrigins: isProduction 
      ? [...productionOrigins, ...controlledThirdPartyOrigins]
      : [...developmentOrigins, ...controlledThirdPartyOrigins],
    
    // CSP: Enable in production or when explicitly enabled
    enableCSP: enableSecurityHeaders,
    cspReportOnly: cspReportOnly || (!isProduction && enableSecurityHeaders),
    
    // Other security headers
    enableCOEP: enableSecurityHeaders && !process.env.DISABLE_COEP, // Can disable for GCS/Drive previews
    enableSTSHeader: isProduction,
    
    // CSP Directives for production
    cspDirectives: {
      'default-src': ["'self'"],
      'script-src': [
        "'self'",
        "'unsafe-eval'", // Needed for Vite dev mode, remove in production
        "https://replit.com", // Replit dev banner
        "https://www.googletagmanager.com", // Google Analytics
      ],
      'style-src': [
        "'self'",
        "'unsafe-inline'", // Temporary - will replace with hashes
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
        "https://storage.googleapis.com", // GCS previews
        "https://drive.google.com", // Google Drive previews
        "https://lh3.googleusercontent.com", // Google user avatars
      ],
      'connect-src': [
        "'self'",
        "https://storage.googleapis.com", // GCS API
        "https://www.googleapis.com", // Google APIs
        "https://accounts.google.com", // OAuth
        "https://generativelanguage.googleapis.com", // Gemini AI
        ...(isDevelopment ? ["ws://localhost:*", "wss://localhost:*"] : []), // Vite HMR
      ],
      'frame-src': [
        "https://accounts.google.com", // OAuth
        "https://drive.google.com", // Drive previews
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
 * Get helmet configuration based on security settings
 */
export function getHelmetConfig() {
  const config = getSecurityConfig();
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  return {
    // Content Security Policy
    contentSecurityPolicy: config.enableCSP ? {
      directives: config.cspDirectives,
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
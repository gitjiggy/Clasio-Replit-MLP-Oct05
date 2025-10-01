import helmet from "helmet";
import type { Express, RequestHandler } from "express";

const allow = {
  scripts: [
    "'self'",
    "'unsafe-inline'",
    "https://apis.google.com",
    "https://www.googletagmanager.com",
    "https://www.gstatic.com",
    "https://www.google-analytics.com",
    "https://replit.com"
  ],
  scriptsElem: [
    "'self'",
    "'unsafe-inline'",
    "https://apis.google.com",
    "https://www.googletagmanager.com",
    "https://www.gstatic.com",
    "https://www.google-analytics.com",
    "https://replit.com"
  ],
  styles: [
    "'self'",
    "'unsafe-inline'",
    "https://fonts.googleapis.com"
  ],
  fonts: ["'self'", "https://fonts.gstatic.com", "data:"],
  connects: [
    "'self'",
    "https://apis.google.com",
    "https://www.googleapis.com",
    "https://securetoken.googleapis.com",
    "https://identitytoolkit.googleapis.com",
    "https://firebasestorage.googleapis.com",
    "https://firestore.googleapis.com",
    "https://content-firebaseappcheck.googleapis.com",
    "https://oauth2.googleapis.com",
    "https://accounts.google.com",
    "https://openidconnect.googleapis.com",
    "https://www.gstatic.com",
    "https://www.google-analytics.com"
  ],
  frames: [
    "'self'",
    "https://accounts.google.com",
    "https://apis.google.com",
    "https://*.firebaseapp.com",
    "https://*.google.com",
    "https://*.gstatic.com",
    "https://*.googleusercontent.com"
  ],
  childFrames: [
    "'self'",
    "https://accounts.google.com",
    "https://apis.google.com",
    "https://*.firebaseapp.com",
    "https://*.google.com",
    "https://*.gstatic.com",
    "https://*.googleusercontent.com"
  ],
  imgs: [
    "'self'",
    "data:",
    "https://lh3.googleusercontent.com",
    "https://*.googleusercontent.com"
  ]
};

export function cspMiddleware(): RequestHandler {
  const ENABLE_CSP = String(process.env.ENABLE_CSP || "true").toLowerCase() === "true";
  const CSP_REPORT_ONLY = String(process.env.CSP_REPORT_ONLY || "false").toLowerCase() === "true";

  if (!ENABLE_CSP) {
    return (req, res, next) => next();
  }

  // Skip CSP for Firebase auth handler - it needs its own CSP
  return (req, res, next) => {
    if (req.path.startsWith('/__/auth')) {
      return next();
    }
    
    helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": allow.scripts,
        "script-src-elem": allow.scriptsElem,
        "style-src": allow.styles,
        "font-src": allow.fonts,
        "connect-src": allow.connects,
        "frame-src": allow.frames,
        "child-src": allow.childFrames,
        "img-src": allow.imgs,
        "frame-ancestors": ["'self'", "https://*.replit.dev", "https://*.replit.app", "https://*.replit.com"]
      },
      reportOnly: CSP_REPORT_ONLY
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false
  })(req, res, next);
  };
}

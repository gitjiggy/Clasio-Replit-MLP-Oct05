import helmet from "helmet";
import type { Express, RequestHandler } from "express";

const allow = {
  scripts: [
    "'self'",
    "'unsafe-inline'",
    "https://apis.google.com",
    "https://www.googletagmanager.com",
    "https://www.gstatic.com"
  ],
  scriptsElem: [
    "'self'",
    "'unsafe-inline'",
    "https://apis.google.com",
    "https://www.googletagmanager.com",
    "https://www.gstatic.com"
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
    "https://www.gstatic.com"
  ],
  frames: [
    "'self'",
    "https://accounts.google.com",
    "https://apis.google.com"
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

  return helmet({
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
        "img-src": allow.imgs,
        "frame-ancestors": ["'self'", "https://*.replit.dev", "https://*.replit.app", "https://*.replit.com"]
      },
      reportOnly: CSP_REPORT_ONLY
    },
    crossOriginEmbedderPolicy: false
  });
}

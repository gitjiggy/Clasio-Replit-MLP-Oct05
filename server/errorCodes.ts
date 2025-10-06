/**
 * Standardized Error Codes for Production Debugging
 * 
 * Format: CATEGORY-NUMBER
 * - AUTH: Authentication and authorization errors (1000-1999)
 * - DB: Database errors (2000-2999)
 * - API: API and request errors (3000-3999)
 * - SYS: System and infrastructure errors (4000-4999)
 * - FILE: File storage and upload errors (5000-5999)
 */

export const ErrorCodes = {
  // Authentication Errors (1000-1999)
  AUTH_PROXY_FAILURE: 'AUTH-1001',
  AUTH_FIREBASE_INIT_FAILURE: 'AUTH-1002',
  AUTH_TOKEN_INVALID: 'AUTH-1003',
  AUTH_TOKEN_EXPIRED: 'AUTH-1004',
  AUTH_UNAUTHORIZED: 'AUTH-1005',
  AUTH_FORBIDDEN: 'AUTH-1006',
  
  // Database Errors (2000-2999)
  DB_CONNECTION_FAILURE: 'DB-2001',
  DB_QUERY_FAILURE: 'DB-2002',
  DB_TRANSACTION_FAILURE: 'DB-2003',
  DB_CONSTRAINT_VIOLATION: 'DB-2004',
  DB_NOT_FOUND: 'DB-2005',
  
  // API Errors (3000-3999)
  API_VALIDATION_ERROR: 'API-3001',
  API_RATE_LIMIT_EXCEEDED: 'API-3002',
  API_INVALID_REQUEST: 'API-3003',
  API_NOT_FOUND: 'API-3004',
  API_METHOD_NOT_ALLOWED: 'API-3005',
  
  // System Errors (4000-4999)
  SYS_STARTUP_FAILURE: 'SYS-4001',
  SYS_CONFIGURATION_ERROR: 'SYS-4002',
  SYS_INTERNAL_ERROR: 'SYS-4003',
  SYS_SERVICE_UNAVAILABLE: 'SYS-4004',
  
  // File Storage Errors (5000-5999)
  FILE_UPLOAD_FAILURE: 'FILE-5001',
  FILE_DOWNLOAD_FAILURE: 'FILE-5002',
  FILE_NOT_FOUND: 'FILE-5003',
  FILE_SIZE_EXCEEDED: 'FILE-5004',
  FILE_TYPE_INVALID: 'FILE-5005',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

export interface StandardErrorResponse {
  error: string;
  errorCode: ErrorCode;
  errorId: string;
  timestamp: string;
  message: string;
  details?: any;
  path?: string;
  method?: string;
  userMessage?: string;
}

/**
 * Generate a unique error ID for tracking
 */
export function generateErrorId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  return `${timestamp}-${random}`.toUpperCase();
}

/**
 * Create a standardized error response
 */
export function createErrorResponse(
  errorCode: ErrorCode,
  message: string,
  options: {
    details?: any;
    path?: string;
    method?: string;
    userMessage?: string;
  } = {}
): StandardErrorResponse {
  return {
    error: errorCode.split('-')[0], // Extract category (e.g., "AUTH" from "AUTH-1001")
    errorCode,
    errorId: generateErrorId(),
    timestamp: new Date().toISOString(),
    message,
    ...options,
    userMessage: options.userMessage || 'An error occurred. Please try again or contact support with the error code below.',
  };
}

/**
 * Get user-friendly error message for error codes
 */
export function getUserFriendlyMessage(errorCode: ErrorCode): string {
  const messages: Record<ErrorCode, string> = {
    // Auth errors
    'AUTH-1001': 'Authentication service is temporarily unavailable. Please refresh the page.',
    'AUTH-1002': 'Authentication system failed to initialize. Please contact support.',
    'AUTH-1003': 'Your session token is invalid. Please sign in again.',
    'AUTH-1004': 'Your session has expired. Please sign in again.',
    'AUTH-1005': 'You must be signed in to access this resource.',
    'AUTH-1006': 'You don\'t have permission to access this resource.',
    
    // Database errors
    'DB-2001': 'Database connection failed. Please try again in a few moments.',
    'DB-2002': 'Failed to retrieve data. Please try again.',
    'DB-2003': 'Failed to save data. Please try again.',
    'DB-2004': 'Data validation failed. Please check your input.',
    'DB-2005': 'The requested resource was not found.',
    
    // API errors
    'API-3001': 'Invalid request data. Please check your input.',
    'API-3002': 'Too many requests. Please wait a moment and try again.',
    'API-3003': 'Invalid request format.',
    'API-3004': 'The requested endpoint was not found.',
    'API-3005': 'This operation is not allowed.',
    
    // System errors
    'SYS-4001': 'System startup failed. Please contact support.',
    'SYS-4002': 'System configuration error. Please contact support.',
    'SYS-4003': 'An internal error occurred. Please try again.',
    'SYS-4004': 'Service is temporarily unavailable. Please try again later.',
    
    // File errors
    'FILE-5001': 'File upload failed. Please try again.',
    'FILE-5002': 'File download failed. Please try again.',
    'FILE-5003': 'File not found.',
    'FILE-5004': 'File size exceeds the maximum allowed (50MB).',
    'FILE-5005': 'This file type is not supported.',
  };
  
  return messages[errorCode] || 'An unexpected error occurred. Please try again or contact support.';
}

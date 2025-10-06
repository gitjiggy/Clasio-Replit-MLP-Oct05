import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { ObjectStorageService, ObjectNotFoundError, generateDocumentPath } from "./objectStorage";
import { randomUUID } from 'crypto';
import { verifyFirebaseToken, optionalAuth, AuthenticatedRequest } from "./auth";
import { logger } from "./logger.js";
import { DriveService } from "./driveService";
import { strictLimiter, moderateLimiter, standardLimiter, bulkUploadLimiter } from "./rateLimit";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { insertDocumentSchema, insertDocumentVersionSchema, insertFolderSchema, insertTagSchema, insertDocumentTagSchema, documentVersions, documents, type DocumentWithFolderAndTags } from "@shared/schema";
import { sql, eq } from "drizzle-orm";
import { db } from "./db.js";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { google } from 'googleapis';
// Enhanced file validation and quota management
import { createUploadMiddleware, multerErrorHandler as newMulterErrorHandler, validateFileSize } from "./fileValidation.js";
import { 
  checkStorageQuota, 
  checkDocumentQuota, 
  updateStorageUsage, 
  decreaseStorageUsage,
  getUserQuota,
  getQuotaUsageSummary
} from "./quotaManager.js";

// Enhanced file signature validation with bomb checks
async function validateFileSignature(filePath: string, mimeType: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    const buffer = await fs.readFile(filePath, { flag: 'r' });
    
    if (buffer.length < 4) {
      logger.warn('File too small for signature validation', {
        metadata: { fileSize: buffer.length, filePath }
      });
      return false; // Need at least 4 bytes for most signatures
    }
    
    const bytes = Array.from(buffer.subarray(0, 16)).map(b => b.toString(16).padStart(2, '0'));
    const signature = bytes.join('');
    
    // Define magic bytes for supported file types
    const signatures: Record<string, string[]> = {
      'application/pdf': ['25504446'], // %PDF
      'image/jpeg': ['ffd8ff'],
      'image/png': ['89504e47'],
      'image/gif': ['474946383761', '474946383961'], // GIF87a, GIF89a
      'image/webp': ['52494646'], // RIFF (WebP container)
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['504b0304'], // ZIP (Office files)
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['504b0304'], // ZIP
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['504b0304'], // ZIP
      'application/vnd.ms-excel': ['d0cf11e0'], // OLE2 (legacy Office)
      'application/msword': ['d0cf11e0'], // OLE2
      'application/vnd.ms-powerpoint': ['d0cf11e0'], // OLE2
      'text/plain': [], // No signature validation for text files
      'text/csv': [] // No signature validation for CSV files
    };
    
    const expectedSignatures = signatures[mimeType];
    if (!expectedSignatures) {
      return true; // Allow unknown types to pass through
    }
    
    if (expectedSignatures.length === 0) {
      return true; // Skip validation for text files
    }
    
    // Check if any expected signature matches
    const isValid = expectedSignatures.some(expectedSig => 
      signature.toLowerCase().startsWith(expectedSig.toLowerCase())
    );
    
    if (!isValid) {
      logger.error('File signature mismatch', {
        metadata: { 
          expectedSignatures, 
          mimeType, 
          actualSignature: signature.slice(0, 16),
          filePath
        }
      });
      return false;
    }
    
    // Enhanced bomb detection for different file types
    if (['504b0304'].some(sig => signature.toLowerCase().startsWith(sig))) {
      return await validateZipBomb(buffer, stats.size);
    }
    
    // PDF bomb detection
    if (mimeType === 'application/pdf') {
      if (!(await validatePdfBomb(buffer, stats.size))) {
        logger.warn('PDF bomb detected', { metadata: { filePath } });
        return false;
      }
    }
    
    // Image bomb detection  
    if (mimeType.startsWith('image/')) {
      if (!(await validateImageBomb(buffer, stats.size))) {
        logger.warn('Image bomb detected', { metadata: { filePath } });
        return false;
      }
    }
    
    return true;
  } catch (error) {
    logger.error('File signature validation failed', {
      metadata: {
        errorMessage: error instanceof Error ? error.message : String(error),
        filePath
      }
    });
    return false;
  }
}

// Enhanced zip bomb detection for Office documents with central directory parsing
async function validateZipBomb(buffer: Buffer, fileSize: number): Promise<boolean> {
  try {
    const maxCompressionRatio = 100; // Allow up to 100:1 compression
    const maxUncompressedSize = 500 * 1024 * 1024; // 500MB uncompressed max
    
    // Quick check: if file is suspiciously small for its claimed type
    if (fileSize < 100) {
      logger.warn('Suspiciously small Office document', { metadata: { fileSize } });
      return false;
    }
    
    // Find End of Central Directory Record (EOCD) - search from end
    let eocdPos = -1;
    for (let i = buffer.length - 22; i >= 0; i--) {
      if (buffer[i] === 0x50 && buffer[i + 1] === 0x4b && 
          buffer[i + 2] === 0x05 && buffer[i + 3] === 0x06) {
        eocdPos = i;
        break;
      }
    }
    
    if (eocdPos === -1) {
      logger.warn('Invalid ZIP: No End of Central Directory found');
      return false;
    }
    
    // Parse EOCD to get central directory info
    const totalEntries = buffer.readUInt16LE(eocdPos + 10);
    const centralDirSize = buffer.readUInt32LE(eocdPos + 12);
    const centralDirOffset = buffer.readUInt32LE(eocdPos + 16);
    
    // Safety check for too many entries
    if (totalEntries > 10000) {
      logger.warn('ZIP bomb: excessive file count', { metadata: { totalEntries } });
      return false;
    }
    
    // Parse central directory entries for accurate size information
    let totalUncompressedSize = 0;
    let totalCompressedSize = 0;
    let pos = centralDirOffset;
    
    for (let i = 0; i < totalEntries && pos < buffer.length - 46; i++) {
      // Check central directory file header signature: PK\x01\x02
      if (buffer[pos] !== 0x50 || buffer[pos + 1] !== 0x4b || 
          buffer[pos + 2] !== 0x01 || buffer[pos + 3] !== 0x02) {
        logger.warn('Invalid ZIP: Bad central directory entry', { metadata: { entryIndex: i } });
        return false;
      }
      
      // Extract sizes from central directory (more reliable than local headers)
      const compressedSize = buffer.readUInt32LE(pos + 20);
      const uncompressedSize = buffer.readUInt32LE(pos + 24);
      const fileNameLength = buffer.readUInt16LE(pos + 28);
      const extraFieldLength = buffer.readUInt16LE(pos + 30);
      const fileCommentLength = buffer.readUInt16LE(pos + 32);
      
      totalCompressedSize += compressedSize;
      totalUncompressedSize += uncompressedSize;
      
      // Check individual file compression ratio (avoid division by zero)
      if (compressedSize > 0 && uncompressedSize / compressedSize > maxCompressionRatio) {
        logger.warn('ZIP bomb: excessive compression ratio', {
          metadata: { fileIndex: i + 1, ratio: Math.round(uncompressedSize / compressedSize) }
        });
        return false;
      }
      
      // Move to next central directory entry
      pos += 46 + fileNameLength + extraFieldLength + fileCommentLength;
    }
    
    // Check total uncompressed size limit
    if (totalUncompressedSize > maxUncompressedSize) {
      logger.warn('ZIP bomb: total size exceeds limit', {
        metadata: { totalMB: Math.round(totalUncompressedSize / 1024 / 1024) }
      });
      return false;
    }
    
    // Check overall compression ratio
    if (totalCompressedSize > 0) {
      const overallRatio = totalUncompressedSize / totalCompressedSize;
      if (overallRatio > maxCompressionRatio) {
        logger.warn('ZIP bomb: overall compression ratio exceeds limit', {
          metadata: { ratio: Math.round(overallRatio) }
        });
        return false;
      }
    }
    
    // Additional heuristic: file size vs compressed content ratio
    if (fileSize > 0 && totalUncompressedSize > 0) {
      const expansionRatio = totalUncompressedSize / fileSize;
      if (expansionRatio > maxCompressionRatio) {
        logger.warn('ZIP bomb: expansion ratio exceeds limit', {
          metadata: { ratio: Math.round(expansionRatio) }
        });
        return false;
      }
    }
    
    return true;
  } catch (error) {
    logger.error('ZIP bomb validation failed', {
      metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
    });
    return false;
  }
}

// PDF bomb detection - looks for decompression bombs and excessive objects
async function validatePdfBomb(buffer: Buffer, fileSize: number): Promise<boolean> {
  try {
    // Basic PDF structure analysis
    const pdfContent = buffer.toString('latin1');
    
    // Check for excessive object count relative to file size
    const objectMatches = pdfContent.match(/\d+\s+\d+\s+obj/g);
    const objectCount = objectMatches ? objectMatches.length : 0;
    
    // Heuristic: More than 1 object per 100 bytes is suspicious
    if (objectCount > fileSize / 100) {
      logger.warn('Suspicious PDF structure', {
        metadata: { objectCount, fileSize }
      });
      return false;
    }
    
    // Check for excessive stream objects (potential decompression bombs)
    const streamMatches = pdfContent.match(/stream\s*\n/g);
    const streamCount = streamMatches ? streamMatches.length : 0;
    
    // Too many streams for file size
    if (streamCount > fileSize / 500) {
      logger.warn('Suspicious PDF streams', {
        metadata: { streamCount, fileSize }
      });
      return false;
    }
    
    // Check for suspicious filter patterns that could indicate bombs
    const suspiciousFilters = ['/FlateDecode', '/DCTDecode', '/CCITTFaxDecode'];
    let filterCount = 0;
    for (const filter of suspiciousFilters) {
      const matches = pdfContent.match(new RegExp(filter, 'g'));
      filterCount += matches ? matches.length : 0;
    }
    
    // Excessive compression filters
    if (filterCount > objectCount) {
      logger.warn('Suspicious PDF compression', {
        metadata: { filterCount, objectCount }
      });
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error('PDF bomb validation failed', {
      metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
    });
    return false;
  }
}

// Image bomb detection - looks for decompression bombs in images
async function validateImageBomb(buffer: Buffer, fileSize: number): Promise<boolean> {
  try {
    const maxDimensions = 50000; // Max width/height in pixels
    const maxPixels = 100 * 1024 * 1024; // 100MP max
    
    // Quick heuristic checks based on file type
    const header = buffer.subarray(0, 32);
    
    // PNG bomb detection
    if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
      // Look for IHDR chunk to get dimensions
      const ihdrIndex = buffer.indexOf('IHDR');
      if (ihdrIndex >= 0 && ihdrIndex < buffer.length - 8) {
        const width = buffer.readUInt32BE(ihdrIndex + 4);
        const height = buffer.readUInt32BE(ihdrIndex + 8);
        
        if (width > maxDimensions || height > maxDimensions) {
          logger.warn('PNG dimensions too large', {
            metadata: { width, height }
          });
          return false;
        }
        
        if (width * height > maxPixels) {
          logger.warn('PNG pixel count too large', {
            metadata: { pixels: width * height }
          });
          return false;
        }
      }
    }
    
    // JPEG bomb detection - look for suspicious compression ratios
    if (header[0] === 0xFF && header[1] === 0xD8) {
      // Basic heuristic: JPEG files should have reasonable size-to-compression ratio
      // Very small file claiming to be large image is suspicious
      if (fileSize < 1000 && buffer.length < 1000) {
        // Look for SOF markers to get dimensions
        let pos = 2;
        while (pos < buffer.length - 10) {
          if (buffer[pos] === 0xFF && (buffer[pos + 1] >= 0xC0 && buffer[pos + 1] <= 0xCF)) {
            const length = buffer.readUInt16BE(pos + 2);
            if (pos + length < buffer.length) {
              const height = buffer.readUInt16BE(pos + 5);
              const width = buffer.readUInt16BE(pos + 7);
              
              // Suspicious compression ratio check
              const expectedMinSize = (width * height) / 10000; // Very rough estimate
              if (fileSize < expectedMinSize) {
                logger.warn('JPEG compression ratio suspicious', {
                  metadata: { width, height, fileSize }
                });
                return false;
              }
            }
            break;
          }
          pos++;
        }
      }
    }
    
    return true;
  } catch (error) {
    logger.error('Image bomb validation failed', {
      metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
    });
    return false;
  }
}

// Multer error handler middleware - maps file size errors to HTTP 413
function multerErrorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  if (err instanceof multer.MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        logger.error('File size limit exceeded', {
          reqId: (req as any).reqId,
          metadata: { field: err.field, limit: '50MB' }
        });
        return res.status(413).json({
          error: 'File too large',
          message: 'File size cannot exceed 50MB. Please select a smaller file.',
          limit: '50MB',
          code: 'FILE_SIZE_EXCEEDED'
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(413).json({
          error: 'Too many files',
          message: 'Cannot upload more than 50 files at once.',
          limit: '50 files',
          code: 'FILE_COUNT_EXCEEDED'
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          error: 'Unexpected file',
          message: 'Unexpected file field in upload request.',
          code: 'UNEXPECTED_FILE'
        });
      default:
        logger.error('Multer error', {
          reqId: (req as any).reqId,
          metadata: { code: err.code, message: err.message }
        });
        return res.status(400).json({
          error: 'Upload error',
          message: 'An error occurred during file upload. Please try again.',
          code: err.code || 'UPLOAD_ERROR'
        });
    }
  }
  // Pass other errors to next middleware
  next(err);
}

import { lookup as mimeLookup } from "mime-types";
import { 
  setDriveTokenCookie, 
  clearDriveTokenCookies, 
  getDriveToken, 
  csrfProtection,
  requireDriveAccessWithCookie,
  rejectLegacyDriveHeader
} from "./cookieAuth";

// Middleware to verify Drive access token belongs to the authenticated Firebase user
// Cookie-only authentication (legacy header path removed)
async function requireDriveAccess(req: AuthenticatedRequest, res: any, next: any) {
  try {
    // Get token from httpOnly cookie only
    const { token: driveAccessToken, source } = getDriveToken(req);
    
    if (!driveAccessToken) {
      return res.status(401).json({ 
        error: "Google Drive access token required",
        message: "Please authenticate with Google Drive using secure cookies"
      });
    }

    // Get Firebase user email from the verified token
    const firebaseUserEmail = req.user?.email;
    if (!firebaseUserEmail) {
      return res.status(401).json({ error: "Firebase user email not available" });
    }

    // Verify the Google access token belongs to the same user
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: driveAccessToken });
    
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    
    const googleUserEmail = userInfo.data.email;
    
    // DEVELOPMENT MODE: Skip email matching for test users
    const isTestUser = process.env.NODE_ENV === 'development' && firebaseUserEmail === 'test@example.com';
    
    if (!isTestUser && (!googleUserEmail || googleUserEmail !== firebaseUserEmail)) {
      return res.status(403).json({ 
        error: "Drive access token does not belong to the authenticated user",
        message: "Token mismatch detected"
      });
    }
    
    // Store Drive service in request for reuse
    (req as any).driveService = new DriveService(driveAccessToken);
    (req as any).driveAuthSource = source; // Should always be 'cookie' now
    (req as any).driveAccessToken = driveAccessToken;
    
    next();
  } catch (error) {
    logger.error("Drive access verification failed", {
      reqId: (req as any).reqId,
      metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
    });
    return res.status(403).json({ 
      error: "Invalid or expired Drive access token",
      message: "Please re-authenticate with Google Drive"
    });
  }
}

// Zod schemas for input validation and sanitization
const searchSchema = z.object({
  search: z.string().max(100).regex(/^[a-zA-Z0-9\s\-_.]+$/).optional(),
  fileType: z.string().max(50).optional(),
  folderId: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
  page: z.string().regex(/^\d+$/).transform(Number).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().min(1).max(50)).optional()
});

const uploadSchema = z.object({
  name: z.string().min(1).max(255).regex(/^[^<>:"/\\|?*]+$/),
  originalName: z.string().min(1).max(255),
  fileSize: z.number().positive().max(50 * 1024 * 1024),
  fileType: z.enum(['pdf', 'doc', 'docx', 'txt', 'jpg', 'png', 'gif', 'webp', 'csv', 'xlsx', 'pptx']),
  mimeType: z.string().min(1),
  folderId: z.string().uuid().nullish(),
  tagIds: z.array(z.string().uuid()).optional()
});

const analysisSchema = z.object({
  forceReanalysis: z.boolean().default(false),
  categories: z.array(z.string().max(50)).max(10).optional()
});

// Classification update schema
const classificationUpdateSchema = z.object({
  category: z.string()
    .min(1, "Category cannot be empty")
    .max(100, "Category name too long")
    .trim()
    .regex(/^[^\/<>:"|?*\x00-\x1F]+$/, "Category contains invalid path characters"),
  documentType: z.string()
    .min(1, "Document type cannot be empty")
    .max(100, "Document type name too long")
    .trim()
    .regex(/^[^\/<>:"|?*\x00-\x1F]+$/, "Document type contains invalid path characters")
});

// Zod schemas for Drive API validation
const driveSyncSchema = z.object({
  driveFileId: z.string().min(1, "Drive file ID is required"),
  folderId: z.string().optional(),
  runAiAnalysis: z.boolean().default(false),
});

const driveDocumentsQuerySchema = z.object({
  search: z.string().optional(),
  pageToken: z.string().optional(),
  folderId: z.string().optional(),
  pageSize: z.string().default("20").transform(val => {
    const parsed = parseInt(val);
    return isNaN(parsed) || parsed < 1 || parsed > 100 ? 20 : parsed;
  }),
});

// Robust MIME resolver (works even when File.type is empty / weird)
function resolveMime(name: string, mime?: string) {
  return (mime && mime.trim()) || mimeLookup(name) || "application/octet-stream";
}

// Bulk upload schemas - match client request exactly
const bulkUploadRequestSchema = z.object({
  files: z.array(z.object({
    name: z.string().min(1).max(255),
    mimeType: z.string().optional(), // File.type may be empty
    size: z.number().optional() // For logging purposes
  })).min(1).max(50), // Required array of file objects for canonical paths
  folderId: z.string().uuid().nullish(),
  tagIds: z.array(z.string().uuid()).optional(),
  analyzeImmediately: z.boolean().default(false), // Whether to analyze immediately or queue
});

const bulkDocumentCreationSchema = z.object({
  documents: z.array(z.object({
    uploadURL: z.string().min(1),
    objectPath: z.string().min(1), // REQUIRED for canonical path validation
    docId: z.string().optional(), // Allow docId for coordination
    name: z.string().min(1).max(255).regex(/^[^<>:"/\\|?*]+$/),
    originalName: z.string().min(1).max(255),
    fileSize: z.number().positive().max(50 * 1024 * 1024),
    fileType: z.enum(['pdf', 'doc', 'docx', 'txt', 'jpg', 'png', 'gif', 'webp', 'csv', 'xlsx', 'pptx']),
    mimeType: z.string().min(1),
  })).min(1).max(50),
  folderId: z.string().uuid().nullish(),
  tagIds: z.array(z.string().uuid()).optional(),
  analyzeImmediately: z.boolean().default(false),
});

// Create tmp directory for uploads with cleanup
const TMP_UPLOAD_DIR = path.join(os.tmpdir(), 'clasio-uploads');
let concurrentUploads = 0;
const MAX_CONCURRENT_UPLOADS = 10;

// Ensure tmp directory exists
async function ensureTmpDir() {
  try {
    await fs.access(TMP_UPLOAD_DIR);
  } catch {
    await fs.mkdir(TMP_UPLOAD_DIR, { recursive: true });
  }
}

// Cleanup old temp files (older than 1 hour)
async function cleanupTmpFiles() {
  try {
    const files = await fs.readdir(TMP_UPLOAD_DIR);
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour
    
    for (const file of files) {
      const filePath = path.join(TMP_UPLOAD_DIR, file);
      const stats = await fs.stat(filePath);
      if (now - stats.mtime.getTime() > maxAge) {
        await fs.unlink(filePath);
      }
    }
  } catch (error) {
    logger.error('Error cleaning up tmp files', {
      reqId: undefined,
      userId: undefined,
      metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
    });
  }
}

// Initialize tmp directory and cleanup
ensureTmpDir();
setInterval(cleanupTmpFiles, 15 * 60 * 1000); // Clean every 15 minutes

// Use enhanced multer configuration from fileValidation with 50MB limits
const uploadProxy = createUploadMiddleware();

export async function registerRoutes(app: Express): Promise<Server> {
  const objectStorageService = new ObjectStorageService();

  // Apply standard rate limiting to all API routes
  app.use('/api', standardLimiter);
  
  // Add correlation ID for request tracking
  app.use((req: any, res, next) => { 
    req.reqId = randomUUID(); 
    next(); 
  });

  // DEVELOPMENT ONLY: Test authentication endpoint for automated testing
  if (process.env.NODE_ENV === 'development') {
    app.post("/api/test-auth", (req, res) => {
      const testToken = 'test-token-for-automated-testing-only';
      const testUser = {
        uid: 'test-user-uid',
        email: 'test@example.com',
        name: 'Test User'
      };
      
      // Set both httpOnly cookie for server-side auth and non-httpOnly for frontend
      res.cookie('auth_token', testToken, {
        httpOnly: true,
        secure: false, // Development only
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax'
      });
      
      // Frontend-readable cookie for client-side authentication detection
      res.cookie('test_auth', testToken, {
        httpOnly: false, // Allow frontend to read this
        secure: false, // Development only
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax'
      });
      
      res.json({ 
        success: true, 
        message: 'Test authentication set',
        user: testUser 
      });
    });
  }
  
  // Helper to sanitize paths: keep userId/docId, hide filename
  const obfuscatePath = (p?: string) => {
    const m = p?.match(/^users\/([^/]+)\/docs\/([^/]+)\/(.+)$/);
    return m ? `users/${m[1]}/docs/${m[2]}/<file>` : p;
  };

  // Use the disk storage multer configuration for upload-proxy
  // (uploadProxy is already configured above with disk storage)

  // Upload proxy MUST consume the body before any JSON middleware
  app.post("/api/documents/upload-proxy", 
    verifyFirebaseToken,
    uploadProxy.single("file"), // <<< this must run before any json parser
    newMulterErrorHandler, // Enhanced multer error handler with 50MB limits
    async (req: AuthenticatedRequest, res) => {
      // Set up abort detection
      let isAborted = false;
      req.on('aborted', () => {
        isAborted = true;
      });

      // Helper function to check if request was aborted
      const checkAborted = (operation: string) => {
        return isAborted;
      };

      let quotaUpdated = false; // Track quota updates for potential rollback
      let uid: string | undefined;
      let size: number | undefined;
      
      try {
        if (!req.file) return res.status(400).json({ error: "file missing" });

        const { originalname, mimetype, path: filePath } = req.file;
        size = req.file.size;
        uid = req.user?.uid!;
        const forceUpload = req.body.forceUpload === 'true'; // Check if user decided to force upload
        
        // 1. Enhanced file size validation with quirky messages
        const fileSizeValidation = validateFileSize(size, mimetype, originalname);
        if (!fileSizeValidation.valid) {
          // Cleanup concurrency counter and temp file
          (req as any).cleanup?.();
          await fs.unlink(filePath).catch(() => {});
          
          logger.error('File size exceeded', {
            reqId: (req as any).reqId,
            userId: uid,
            metadata: { fileName: originalname, fileSize: size }
          });
          
          return res.status(413).json({
            error: 'File too large',
            message: fileSizeValidation.error,
            code: 'FILE_TOO_LARGE',
            details: fileSizeValidation.details
          });
        }
        
        // 2. Check storage quota (1GB limit)
        const storageQuotaCheck = await checkStorageQuota(uid, size);
        if (!storageQuotaCheck.allowed) {
          // Cleanup concurrency counter and temp file
          (req as any).cleanup?.();
          await fs.unlink(filePath).catch(() => {});
          
          logger.error('Storage quota exceeded', {
            reqId: (req as any).reqId,
            userId: uid,
            metadata: { fileName: originalname, fileSize: size }
          });
          
          return res.status(413).json({
            error: 'Storage quota exceeded',
            message: storageQuotaCheck.reason,
            code: 'STORAGE_QUOTA_EXCEEDED',
            details: storageQuotaCheck.details
          });
        }
        
        // 3. Check document count quota (200 documents max)
        const documentQuotaCheck = await checkDocumentQuota(uid);
        if (!documentQuotaCheck.allowed) {
          // Cleanup concurrency counter and temp file
          (req as any).cleanup?.();
          await fs.unlink(filePath).catch(() => {});
          
          logger.error('Document quota exceeded', {
            reqId: (req as any).reqId,
            userId: uid,
            metadata: { fileName: originalname }
          });
          
          return res.status(400).json({
            error: 'Document limit exceeded',
            message: documentQuotaCheck.reason,
            code: 'DOCUMENT_QUOTA_EXCEEDED',
            details: documentQuotaCheck.details
          });
        }
        
        // 4. Validate file signature to prevent MIME spoofing
        if (!(await validateFileSignature(filePath, mimetype))) {
          // Cleanup concurrency counter and temp file
          (req as any).cleanup?.();
          await fs.unlink(filePath).catch(() => {}); // Ignore cleanup errors
          
          logger.error('MIME validation failed', {
            reqId: (req as any).reqId,
            userId: uid,
            metadata: { fileName: originalname, claimedMimeType: mimetype }
          });
          return res.status(400).json({
            error: 'File type validation failed',
            message: 'The file content does not match its claimed file type. This may be a security risk.',
            code: 'INVALID_FILE_SIGNATURE'
          });
        }
        
        // Check for duplicate files unless user is forcing upload after decision
        const duplicates = await storage.findDuplicateFiles(originalname, size, uid);
        
        // Check if client aborted after duplicate check
        if (checkAborted("duplicate-check")) {
          // Cleanup temp file and concurrency counter before aborting
          await fs.unlink(filePath).catch(() => {});
          (req as any).cleanup?.();
          return; // Request was aborted, stop processing
        }
        
        // PAUSE upload if duplicates found AND user hasn't already decided to force upload
        if (duplicates.length > 0 && !forceUpload) {
          const funnyMessages = [
            "Déjà vu! This file is already in your collection. Did you time travel? 🕰️",
            "Hold up! This file already exists. No need to clone your documents! 🤖", 
            "Whoa there! This file is already uploaded. Are we playing file hide-and-seek? 🙈",
            "File already exists! Your documents don't need a twin! 👯‍♀️",
            "File déjà vu detected! This document is already living its best life in your collection! ✨",
            "Another copy? Your files are multiplying like rabbits! 🐰"
          ];
          const randomMessage = funnyMessages[Math.floor(Math.random() * funnyMessages.length)];

          // Return 409 Conflict status - upload paused, awaiting user decision
          return res.status(409).json({
            ok: false,
            requiresUserDecision: true,
            type: "duplicate_detected",
            message: randomMessage,
            fileName: originalname,
            duplicateCount: duplicates.length,
            existingDocs: duplicates.map(d => ({ 
              id: d.id, 
              name: d.name,
              uploadDate: d.createdAt 
            }))
          });
        }
        
        const docId = randomUUID();
        const objectPath = `users/${uid}/docs/${docId}/${originalname}`; // raw name; SDK encodes

        // Check if client aborted before GCS upload
        if (checkAborted("pre-gcs-upload")) {
          // Cleanup temp file and concurrency counter before aborting
          await fs.unlink(filePath).catch(() => {});
          (req as any).cleanup?.();
          return; // Request was aborted, stop processing
        }

        // Step 1: Upload to GCS using file path - read file and upload
        const fileBuffer = await fs.readFile(filePath);
        await objectStorageService.uploadFileBuffer(
          fileBuffer, 
          objectPath, 
          mimetype || "application/octet-stream"
        );
        
        // Cleanup temp file after upload
        await fs.unlink(filePath).catch(() => {}); // Ignore cleanup errors
        
        // Cleanup concurrency counter
        (req as any).cleanup?.();

        // Check if client aborted after GCS upload, before database operations
        if (checkAborted("pre-db-operations")) {
          return; // Request was aborted, stop processing
        }

        // Step 2: Create database record (this was missing!)
        const determinedFileType = getFileTypeFromMimeType(mimetype || "", originalname);
        const documentData = {
          id: docId,
          userId: uid,
          name: originalname,
          originalName: originalname,
          filePath: objectPath,
          fileSize: size,
          fileType: determinedFileType,
          mimeType: mimetype || "application/octet-stream",
          folderId: null, // No folder for fallback uploads
          isFavorite: false,
          isDeleted: false,
        };

        const validatedData = insertDocumentSchema.parse(documentData);
        // Generate unique idempotency key that includes objectPath to prevent conflicts
        const customIdempotencyKey = `upload-proxy:${uid}:${objectPath}:${size}`;
        const document = await storage.createDocument(validatedData, (req as any).reqId, customIdempotencyKey);
        
        // Update user storage quota after successful upload
        try {
          const quotaUpdateSuccess = await updateStorageUsage(uid, size);
          if (!quotaUpdateSuccess) {
            throw new Error('Failed to update storage quota');
          }
          quotaUpdated = true;
        } catch (quotaError) {
          logger.error('Quota update failed', {
            reqId: (req as any).reqId,
            userId: uid,
            metadata: {
              fileSize: size,
              documentId: document.id,
              error: quotaError instanceof Error ? quotaError.message : String(quotaError)
            }
          });
          
          // If quota update fails, we should cleanup the uploaded file and fail the request
          // Note: Document creation succeeded, but quota tracking failed
          // This is a data consistency issue that should be handled
          throw new Error('Failed to track storage usage - upload aborted for data consistency');
        }

        // Step 3: Queue for AI analysis (CRITICAL - fail upload if this fails)
        try {
          await storage.enqueueDocumentForAnalysis(document.id, uid, 5); // Normal priority
        } catch (analysisError) {
          logger.error('Analysis queue failed', {
            reqId: (req as any).reqId,
            userId: uid,
            metadata: {
              docId: document.id,
              filename: originalname,
              errorMessage: analysisError instanceof Error ? analysisError.message : String(analysisError),
              errorStack: analysisError instanceof Error ? analysisError.stack : undefined
            }
          });
          
          // AI analysis is a core feature - fail the upload if queue creation fails
          throw new Error(`Upload succeeded but AI analysis failed to start: ${analysisError instanceof Error ? analysisError.message : String(analysisError)}`);
        }

        // Step 4: Queue content extraction for background processing (non-blocking)
        try {
          await storage.enqueueDocumentForContentExtraction(document.id, uid, 3); // Medium priority, background
        } catch (queueError) {
          logger.warn('Content extraction queue failed', {
            reqId: (req as any).reqId,
            userId: uid,
            metadata: {
              docId: document.id,
              filename: originalname,
              error: queueError instanceof Error ? queueError.message : String(queueError)
            }
          });
          // Don't fail the upload if queueing fails - content can be extracted later
        }
        
        return res.status(200).json({ 
          ok: true, 
          objectPath, 
          docId: document.id, 
          contentType: mimetype, 
          size
        });
      } catch (err: any) {
        // Rollback quota update if it was performed
        if (quotaUpdated) {
          try {
            const rollbackSuccess = await decreaseStorageUsage(uid, size);
            logger.info("Upload proxy quota rollback", {
              reqId: (req as any).reqId,
              userId: uid,
              metadata: { fileSize: size, rollbackSuccess }
            });
          } catch (rollbackError) {
            logger.error("Upload proxy quota rollback failed", {
              reqId: (req as any).reqId,
              userId: uid,
              metadata: {
                fileSize: size,
                errorMessage: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
              }
            });
          }
        }
        
        logger.error("Upload proxy error", {
          reqId: (req as any).reqId,
          userId: req.user?.uid,
          metadata: {
            errorMessage: err.message,
            errorStack: err.stack
          }
        });
        // Return the actual error message to surface queue creation failures
        return res.status(500).json({ error: err.message || "proxy upload failed" });
      }
    }
  );

  // Create separate router for JSON routes only
  const jsonRouter = express.Router();
  jsonRouter.use(express.json({ type: "application/json" })); // IMPORTANT: restrict type

  // Download documents by document ID - protected with authentication and rate limiting
  app.get("/api/documents/:documentId/download", verifyFirebaseToken, moderateLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      const { documentId } = req.params;
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      
      // Get document from database - scoped by user for security
      const document = await storage.getDocumentById(documentId, userId);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }
      
      // For Drive documents, redirect to Drive viewer
      if (document.driveWebViewLink) {
        return res.redirect(document.driveWebViewLink);
      }
      
      // For uploaded documents, serve from object storage
      if (document.filePath) {
        const objectFile = await objectStorageService.getObjectEntityFile(document.filePath);
        objectStorageService.downloadObject(objectFile, res);
      } else {
        return res.status(404).json({ error: "Document file not found" });
      }
    } catch (error) {
      logger.error("Error retrieving document for download", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { documentId, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Document not found" });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Serve documents - protected with authentication and rate limiting
  app.get("/objects/:objectPath(*)", verifyFirebaseToken, moderateLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      
      // Validate user owns this object path for multi-tenant security
      const objectPath = req.path.replace('/objects/', '');
      
      // Check if this object path belongs to the authenticated user
      // Object paths should follow pattern: users/{userId}/docs/{docId}/{filename}
      if (!objectPath.startsWith(`users/${userId}/`)) {
        return res.status(403).json({ error: "Access denied - object not owned by user" });
      }
      
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      logger.error("Error retrieving document object", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { objectPath: req.path, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Document not found" });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get upload URL - protected with authentication and strict rate limiting
  app.post("/api/documents/upload-url", verifyFirebaseToken, strictLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      const { originalFileName, contentType } = req.body;
      
      // Enforce canonical path structure - require originalFileName
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      
      if (!originalFileName) {
        return res.status(400).json({ error: "originalFileName is required for canonical object path generation" });
      }
      
      // Generate upload URL with proper user path (no fallbacks)
      const result = await objectStorageService.getObjectEntityUploadURL(userId, originalFileName, contentType);
        
      res.json(result);
    } catch (error) {
      logger.error("Error generating upload URL", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { originalFileName, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  // Complete document upload
  app.post("/api/documents", verifyFirebaseToken, strictLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      const { uploadURL, objectPath, docId, ...uploadData } = req.body;
      
      // Enforce canonical object path - require objectPath for all new documents
      if (!uploadURL) {
        return res.status(400).json({ error: "Upload URL is required" });
      }
      
      if (!objectPath) {
        return res.status(400).json({ error: "objectPath is required for canonical file storage - please use the proper upload URL endpoint" });
      }
      
      // Validate and sanitize upload data
      const validationResult = uploadSchema.safeParse({
        ...uploadData,
        fileSize: parseInt(uploadData.fileSize) // Convert string to number
      });
      
      if (!validationResult.success) {
        return res.status(400).json({ 
          error: "Invalid upload data",
          details: validationResult.error.issues
        });
      }
      
      const { name, originalName, fileSize, fileType, mimeType, folderId, tagIds } = validationResult.data;

      // Get userId for duplicate check
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      
      // Check for duplicate files and warn user (but allow upload to proceed)
      const duplicates = await storage.findDuplicateFiles(originalName, fileSize, userId);
      let duplicateWarning = null;
      if (duplicates.length > 0) {
        const funnyMessages = [
          "File twins detected! This document already exists in your digital library! 📚",
          "Oops! This file is already uploaded. No need for photocopies here! 🖨️",
          "Duplicate file alert! Your storage already has this masterpiece! 🎨",
          "This file already lives here! Are you trying to create a backup of a backup? 💾",
          "File déjà vu! This document is already chilling in your collection! 😎",
          "Another copy detected! Your files are having a family reunion! 👨‍👩‍👧‍👦"
        ];
        const randomMessage = funnyMessages[Math.floor(Math.random() * funnyMessages.length)];
        duplicateWarning = {
          type: "duplicate_warning",
          message: randomMessage
        };
      }

      // Validate the object path structure and ownership  
      const validation = objectStorageService.validateCanonicalObjectPath(objectPath, req.user?.uid!, originalName);
      if (!validation.isValid) {
        return res.status(400).json({ error: validation.error });
      }

      // Use the validated canonical object path
      const filePath = objectPath;

      // Create document record
      const normalizedFolderId = folderId && folderId !== "all" ? folderId : null;
      
      const documentData = {
        name,
        originalName,
        filePath,
        fileSize, // Already converted to number by validation
        fileType,
        mimeType,
        folderId: normalizedFolderId,
        isFavorite: false,
        isDeleted: false,
      };

      const validatedData = insertDocumentSchema.parse(documentData);
      const document = await storage.createDocument(validatedData);

      // Add tags if provided
      if (tagIds && Array.isArray(tagIds)) {
        for (const tagId of tagIds) {
          await storage.addDocumentTag({ documentId: document.id, tagId });
        }
      }

      // Validate user for queueing operations  
      if (!userId) {
        return res.status(401).json({ error: "User authentication required for document processing" });
      }

      // Get document with folder and tags
      const documentWithDetails = await storage.getDocumentById(document.id);
      
      // Queue for AI analysis immediately (CRITICAL - fail upload if this fails)
      try {
        await storage.enqueueDocumentForAnalysis(document.id, userId, 5); // Normal priority
      } catch (analysisError) {
        logger.error("Analysis queue failed for standard upload", {
          reqId: (req as any).reqId,
          userId: userId,
          metadata: {
            documentId: document.id,
            filename: document.name,
            errorMessage: analysisError instanceof Error ? analysisError.message : String(analysisError),
            errorStack: analysisError instanceof Error ? analysisError.stack : undefined
          }
        });
        
        // AI analysis is a core feature - fail the upload if queue creation fails
        throw new Error(`Upload succeeded but AI analysis failed to start: ${analysisError instanceof Error ? analysisError.message : String(analysisError)}`);
      }
      
      // Trigger background content extraction (fire-and-forget for better UX)
      const correlationId = (req as any).reqId;
      storage.extractDocumentContent(document.id, userId)
        .catch(error => {
          logger.error("Content extraction error in background", {
            reqId: correlationId,
            userId: userId,
            metadata: {
              documentId: document.id,
              filename: document.name,
              errorMessage: error instanceof Error ? error.message : String(error)
            }
          });
        });
      
      res.status(201).json({ 
        ...documentWithDetails,
        warning: duplicateWarning 
      });
    } catch (error) {
      logger.error("Document creation error in standard upload", {
        reqId: (req as any).reqId,
        userId: req.user?.uid,
        metadata: {
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined
        }
      });
      // Return the actual error message to surface queue creation failures
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create document" });
    }
  });

  // OLD upload-proxy route removed - now handled earlier before JSON parsing

  // Standard upload route - handles single file uploads with multipart data
  app.post("/api/documents/upload", verifyFirebaseToken, uploadProxy.single('file'), newMulterErrorHandler, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }

      // Validate file signature to prevent MIME spoofing
      if (!(await validateFileSignature(req.file.path, req.file.mimetype))) {
        logger.warn("MIME validation failed - potential spoofing attempt", {
          reqId: (req as any).reqId,
          userId: userId,
          metadata: {
            fileName: req.file.originalname,
            claimedMimeType: req.file.mimetype
          }
        });
        return res.status(400).json({
          error: 'File type validation failed',
          message: 'The file content does not match its claimed file type. This may be a security risk.',
          code: 'INVALID_FILE_SIGNATURE'
        });
      }

      const originalFileName = req.file.originalname;
      const docId = randomUUID();
      const canonicalPath = generateDocumentPath(userId, docId, originalFileName);
      
      // Upload to GCS via server - read file and upload
      const fileBuffer = await fs.readFile(req.file.path);
      await objectStorageService.uploadFileBuffer(
        fileBuffer, 
        canonicalPath, 
        req.file.mimetype
      );
      
      // Cleanup temp file after upload
      await fs.unlink(req.file.path).catch(() => {}); // Ignore cleanup errors
      
      // Cleanup concurrency counter
      (req as any).cleanup?.();
      
      const determinedFileType = getFileTypeFromMimeType(req.file.mimetype, originalFileName);
      
      res.json({
        success: true,
        objectPath: canonicalPath,
        docId,
        originalFileName,
        fileSize: req.file.size,
        fileType: determinedFileType,
        mimeType: req.file.mimetype
      });
    } catch (error) {
      logger.error("Standard upload failed", {
        reqId: (req as any).reqId,
        userId: req.user?.uid,
        metadata: {
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined
        }
      });
      res.status(500).json({ error: "Upload failed" });
    }
  });

  app.post("/api/documents/bulk-upload-urls", express.json({ limit: '10mb' }), verifyFirebaseToken, bulkUploadLimiter, async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.uid;
    
    try {
      // Verify userId is present first
      if (!userId) {
        return res.status(401).json({ 
          error: "Authentication required", 
          results: [] 
        });
      }
      
      // Never 500 the entire batch. Return per-file results even if one fails.
      const files = z.array(z.object({
        name: z.string(),
        size: z.number().optional(),
        mimeType: z.string().optional()
      })).parse(req.body?.files ?? []);

      const results = await Promise.all(files.map(async (f) => {
        try {
          // Check for duplicate files and add warning (but allow upload to proceed)
          // PAUSE bulk upload if duplicates found - return special response
          if (f.size !== undefined) {
            const duplicates = await storage.findDuplicateFiles(f.name, f.size, userId);
            
            if (duplicates.length > 0) {
              const funnyMessages = [
                "File déjà vu! This file already exists in your collection! 🔄",
                "Duplicate alert! This file is already living rent-free in your storage! 🏠",
                "Twin files detected! But hey, more the merrier! 📋",
                "This file is already uploaded! Are you testing my memory? 🧠",
                "File already exists! Your storage is having a reunion! 👯‍♀️"
              ];
              const randomMessage = funnyMessages[Math.floor(Math.random() * funnyMessages.length)];

              // Return special response - no signed URL, awaiting user decision
              return {
                ok: false,
                requiresUserDecision: true,
                type: "duplicate_detected",
                name: f.name,
                message: randomMessage,
                duplicateCount: duplicates.length,
                existingDocs: duplicates.map(d => ({ 
                  id: d.id, 
                  name: d.name,
                  uploadDate: d.createdAt 
                }))
              };
            }
          }
          
          const contentType = resolveMime(f.name, f.mimeType);
          // Use the same path builder as the single-file route. Don't pre-encode names.
          const objectPath = `users/${userId}/docs/${randomUUID()}/${f.name}`; // raw name
          
          // Get bucket and sign URL directly like single-file route
          const bucket = objectStorageService.getBucket();
          const [url] = await bucket.file(objectPath).getSignedUrl({
            version: "v4", 
            action: "write",
            expires: Date.now() + 10*60*1000,
            contentType
          });
          
          return { 
            ok: true, 
            url, 
            method: "PUT", 
            headers: { "Content-Type": contentType }, 
            objectPath, 
            name: f.name
          };
        } catch (e: any) {
          logger.error("Bulk upload URL sign failed", {
            reqId: (req as any).reqId,
            userId: userId,
            metadata: { fileName: f.name, errorMessage: e?.message, errorStack: e?.stack }
          });
          return { 
            ok: false, 
            name: f.name, 
            reason: e?.message || "sign failed" 
          };
        }
      }));

      return res.status(200).json({ results });
      
    } catch (err: any) {
      logger.error("Bulk upload URLs generation failed", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: {
          filesCount: (req.body?.files || []).length,
          errorMessage: err?.message,
          errorStack: err?.stack
        }
      });
      // Note: even on exception, return 200 with ok:false per file so the client can retry individually without blocking the user.
      return res.status(200).json({ 
        results: (req.body?.files||[]).map((f: any) => ({ ok:false, name:f?.name, reason:"route error" })) 
      });
    }
  });

  // Bulk document creation - the grand finale of your upload symphony! 🎼
  app.post("/api/documents/bulk", express.json({ limit: '10mb' }), verifyFirebaseToken, bulkUploadLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      // Validate bulk document creation request
      const validationResult = bulkDocumentCreationSchema.safeParse(req.body);
      if (!validationResult.success) {
        logger.error("Bulk upload validation failed", {
          reqId: (req as any).reqId,
          userId: req.user?.uid,
          metadata: {
            validationErrors: validationResult.error.issues,
            fileTypeRejections: validationResult.error.issues
              .filter(issue => issue.path.includes('fileType'))
              .map(issue => ({ received: issue.received, expected: issue.options }))
          }
        });
        
        return res.status(400).json({ 
          error: "Oops! 🎪 Your bulk upload circus needs some organizing...",
          details: validationResult.error.issues,
          funnyMessage: "Even the most talented juggler needs to know which balls to catch! 🤹‍♂️"
        });
      }

      const { documents: documentsData, folderId, tagIds, analyzeImmediately } = validationResult.data;
      const userId = req.user?.uid;

      if (!userId) {
        return res.status(401).json({ 
          error: "User authentication required",
          funnyMessage: "Who goes there?! 🕵️‍♀️ Our security guards need to know who's uploading all these files!"
        });
      }

      // Normalize folder ID
      const normalizedFolderId = folderId && folderId !== "all" ? folderId : null;


      // Create documents in parallel for speed
      const documentPromises = documentsData.map(async (docData) => {
        try {
          // Validate canonical object path for all bulk documents
          if (!userId) {
            throw new Error("User authentication required for bulk document creation");
          }
          
          const validation = objectStorageService.validateCanonicalObjectPath(docData.objectPath, userId, docData.originalName);
          if (!validation.isValid) {
            throw new Error(`Document "${docData.name}" invalid objectPath: ${validation.error}`);
          }
          
          const filePath = docData.objectPath;

          const documentData = {
            name: docData.name,
            originalName: docData.originalName,
            filePath,
            fileSize: docData.fileSize,
            fileType: docData.fileType,
            mimeType: docData.mimeType,
            folderId: normalizedFolderId,
            isFavorite: false,
            isDeleted: false,
          };

          const validatedData = insertDocumentSchema.parse(documentData);
          const document = await storage.createDocument(validatedData);

          // Add tags if provided
          if (tagIds && Array.isArray(tagIds)) {
            for (const tagId of tagIds) {
              await storage.addDocumentTag({ documentId: document.id, tagId });
            }
          }

          // Queue for AI analysis or trigger immediately
          if (analyzeImmediately) {
            // High priority for immediate analysis
            await storage.enqueueDocumentForAnalysis(document.id, userId, 1);
          } else {
            // Normal priority for bulk upload
            await storage.enqueueDocumentForAnalysis(document.id, userId, 5);
          }

          // Trigger background content extraction (don't wait for it)
          storage.extractDocumentContent(document.id)
            .catch(error => {
              logger.error("Content extraction error for bulk document", {
                reqId: (req as any).reqId,
                userId: userId,
                metadata: { documentId: document.id, errorMessage: error instanceof Error ? error.message : String(error) }
              });
            });

          return { success: true, document, originalName: docData.originalName };
        } catch (error) {
          logger.error("Error creating document in bulk", {
            reqId: (req as any).reqId,
            userId: userId,
            metadata: { originalName: docData.originalName, errorMessage: error instanceof Error ? error.message : String(error) }
          });
          return { success: false, originalName: docData.originalName, error: error instanceof Error ? error.message : String(error) };
        }
      });

      // Wait for all documents to be processed
      const results = await Promise.all(documentPromises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);


      // Get queue status for user feedback
      const queueStatus = await storage.getQueueStatus(userId);
      
      res.status(201).json({
        success: true,
        message: failed.length === 0 
          ? `🎉 Fantastic! All ${successful.length} files uploaded successfully! Your digital library just got a major upgrade!`
          : `📊 Upload completed: ${successful.length} succeeded, ${failed.length} had issues. Don't worry, we're not keeping score! 😅`,
        results: {
          successful: successful.length,
          failed: failed.length,
          details: results
        },
        aiAnalysis: {
          status: analyzeImmediately ? "priority_processing" : "queued",
          message: analyzeImmediately 
            ? "🚀 AI analysis is running in the fast lane! Results coming hot off the digital press!"
            : "🎭 AI analysis queued with style! Your documents are waiting for their moment in the spotlight!",
          queueStatus,
          funnyTip: queueStatus.pending > 10 
            ? "Looks like you're keeping our AI very busy! ☕ Maybe time for a coffee break while it catches up?"
            : "Our AI is ready and raring to analyze your documents! 🤖⚡"
        },
        tips: [
          failed.length > 0 ? "💡 Pro tip: Check the failed uploads for any file format or size issues!" : null,
          "🌟 Your documents are now searchable and ready for AI magic!",
          analyzeImmediately ? "⚡ Priority analysis means faster results!" : "🕐 Queued analysis ensures quality processing for all!"
        ].filter(Boolean)
      });
    } catch (error) {
      logger.error("Error in bulk document creation", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ 
        error: "Failed to create bulk documents",
        funnyMessage: "Our digital filing cabinet seems to be having a tantrum! 📁💥 Please try again!"
      });
    }
  });

  // Get all documents with filters
  app.get("/api/documents", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      // Validate and sanitize query parameters
      const validationResult = searchSchema.safeParse(req.query);
      if (!validationResult.success) {
        return res.status(400).json({ 
          error: "Invalid search parameters",
          details: validationResult.error.issues
        });
      }
      
      const { search, fileType, folderId, tagId, page = 1, limit = 12 } = validationResult.data;
      
      const filters = {
        search,
        fileType,
        folderId,
        tagId,
        page,
        limit,
      };

      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      
      const documents = await storage.getDocuments(filters, userId);
      const total = await storage.getDocumentsCount(filters, userId);
      
      res.json({
        documents,
        pagination: {
          page: filters.page,
          limit: filters.limit,
          total,
          pages: Math.ceil(total / filters.limit),
        }
      });
    } catch (error) {
      logger.error("Error fetching documents", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { filters, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  // Get trashed documents (only show trashed items)
  app.get("/api/documents/trash", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      const result = await storage.getTrashedDocuments(userId);
      res.json(result);
    } catch (error) {
      logger.error("Error fetching trashed documents", {
        reqId: (req as any).reqId,
        userId: req.user?.uid,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to fetch trashed documents" });
    }
  });

  // Delete all active documents (move all to trash)
  app.delete("/api/documents/all", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const { DatabaseStorage } = await import("./storage");
      const storage = new DatabaseStorage();
      
      // Get ALL active documents (ignoring any filters)
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      
      const allActiveDocuments = await storage.getAllActiveDocuments(userId);
      
      // Delete each document (move to trash)
      let deletedCount = 0;
      for (const document of allActiveDocuments) {
        const success = await storage.deleteDocument(document.id, userId);
        if (success) deletedCount++;
      }

      res.json({ 
        success: true, 
        deletedCount,
        message: `Successfully moved ${deletedCount} documents to trash`
      });
    } catch (error) {
      logger.error("Error deleting all documents", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to delete all documents" });
    }
  });

  // Empty trash - permanently delete all trashed documents
  app.delete("/api/documents/trash", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const result = await storage.emptyTrash(req.userId!);
      res.json({ 
        success: true,
        message: `Successfully deleted ${result.deletedCount} documents permanently`,
        deletedCount: result.deletedCount
      });
    } catch (error) {
      logger.error("Error emptying trash", {
        reqId: (req as any).reqId,
        userId: req.userId,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to empty trash" });
    }
  });

  // 🔧 GCS Path Reconciler - fixes path mismatches between DB and GCS
  app.post("/api/admin/reconcile-gcs-paths", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const { dryRun = true } = req.body;
      const result = await storage.reconcileGCSPaths(dryRun);
      
      res.json({
        success: true,
        result,
        message: dryRun 
          ? "Dry run completed. Review results and call with dryRun=false to apply changes."
          : "Reconciliation completed successfully!"
      });
    } catch (error) {
      logger.error("Error during GCS reconciliation", {
        reqId: (req as any).reqId,
        userId: req.user?.uid,
        metadata: { dryRun, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ 
        error: "Failed to reconcile GCS paths",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get trash configuration (retention period)
  app.get("/api/config/trash", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      // Use the same validated function as storage layer to ensure consistency
      const { getTrashRetentionDays } = await import("./storage");
      const retentionDays = getTrashRetentionDays();
      res.json({ 
        retentionDays,
        policy: `Documents are automatically deleted after ${retentionDays} days in trash`,
        description: "Files are immediately removed when trashed to save storage costs, but document metadata is preserved for restore within the retention period."
      });
    } catch (error) {
      logger.error("Error fetching trash config", {
        reqId: (req as any).reqId,
        userId: req.user?.uid,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to fetch trash configuration" });
    }
  });

  // Enhanced conversational search endpoint using Flash-lite
  app.get("/api/documents/search", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const { query, fileType, folderId, tagId, limit = 12 } = req.query;
      
      // Validate required query parameter
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return res.status(400).json({ 
          error: "Query parameter is required for conversational search" 
        });
      }

      // Validate query length to prevent abuse (max 100 words)
      const wordCount = query.trim().split(/\s+/).length;
      if (wordCount > 100) {
        return res.status(400).json({
          error: "Query too long",
          message: `Your search query contains ${wordCount} words but the maximum allowed is 100 words. Please shorten your query and try again.`
        });
      }
      
      // Validate and sanitize other parameters
      const filters = {
        fileType: typeof fileType === 'string' ? fileType : undefined,
        folderId: typeof folderId === 'string' ? folderId : undefined,
        tagId: typeof tagId === 'string' ? tagId : undefined,
        limit: typeof limit === 'string' ? Math.min(parseInt(limit) || 12, 50) : 12,
      };
      
      // Use hybrid FTS + semantic search for optimal performance (no userId for GET endpoint)
      const searchResult = await storage.searchFTSPlusSemanticOptimized(query.trim(), filters);
      
      res.json({
        documents: searchResult.documents,
        response: searchResult.response,
        intent: searchResult.intent,
        keywords: searchResult.keywords,
        query: query.trim(),
        totalResults: searchResult.documents.length
      });
    } catch (error) {
      logger.error("Error in conversational search", {
        reqId: (req as any).reqId,
        userId: req.user?.uid,
        metadata: { query, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ 
        error: "Failed to perform conversational search",
        message: "Our AI assistant seems to be taking a coffee break! ☕ Please try again in a moment."
      });
    }
  });

  // New AI-powered search endpoint with enhanced scoring
  app.post("/api/search", express.json({ limit: '10mb' }), verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }

      const { query, fileType, folderId, tagId, limit = 12 } = req.body;
      
      // Validate required query parameter
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return res.status(400).json({ 
          error: "Query parameter is required for AI search" 
        });
      }

      // Validate query length
      const wordCount = query.trim().split(/\s+/).length;
      if (wordCount > 100) {
        return res.status(400).json({
          error: "Query too long",
          message: `Search query contains ${wordCount} words but maximum allowed is 100 words.`
        });
      }
      
      // Validate and sanitize filters
      const filters = {
        fileType: typeof fileType === 'string' ? fileType : undefined,
        folderId: typeof folderId === 'string' ? folderId : undefined,
        tagId: typeof tagId === 'string' ? tagId : undefined,
        limit: typeof limit === 'number' ? Math.min(limit, 50) : 12,
      };
      
      // Check feature flag for new scoring system (enable by default for better experience)
      const useNewScoring = process.env.USE_NEW_SCORING !== 'false';
      
      if (useNewScoring) {
        // Use enhanced AI search with hybrid FTS + semantic optimization
        const searchResult = await storage.searchFTSPlusSemanticOptimized(query.trim(), filters, userId);
        
        // Use the already-calculated scores from searchConversational function
        // The searchConversational function already computes proper AI scores using 3-stage scoring
        const enhancedResults = searchResult.documents.map(doc => ({
          ...doc,
          aiScore: doc.confidenceScore, // Map confidenceScore to aiScore for frontend compatibility
          scoringMethod: 'new_3_stage'
        }));
        
        res.json({
          documents: enhancedResults,
          response: searchResult.response,
          intent: searchResult.intent,
          keywords: searchResult.keywords,
          query: query.trim(),
          totalResults: enhancedResults.length,
          scoringMethod: 'enhanced',
          useNewScoring: true
        });
      } else {
        // Use hybrid FTS + semantic search (replaces legacy approach)
        const searchResult = await storage.searchFTSPlusSemanticOptimized(query.trim(), filters, userId);
        
        res.json({
          documents: searchResult.documents.map(doc => ({
            ...doc,
            aiScore: 50, // Default legacy score
            scoringMethod: 'legacy'
          })),
          response: searchResult.response,
          intent: searchResult.intent,
          keywords: searchResult.keywords,
          query: query.trim(),
          totalResults: searchResult.documents.length,
          scoringMethod: 'legacy',
          useNewScoring: false
        });
      }
    } catch (error) {
      logger.error("Error in AI search", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { query, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ 
        error: "Failed to perform AI search",
        message: "AI search service is temporarily unavailable. Please try again."
      });
    }
  });

  // Consciousness-powered search: Returns direct answers with source attribution
  app.post("/api/search/consciousness", express.json({ limit: '10mb' }), verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }

      const { query } = req.body;
      
      // Validate required query parameter
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return res.status(400).json({ 
          error: "Query parameter is required for consciousness search" 
        });
      }
      
      // Use consciousness-powered search engine
      const searchResult = await storage.searchConsciousness(query.trim(), userId);
      
      // Return structured results with answers + source documents
      res.json({
        hasAnswer: searchResult.hasAnswer,
        answers: searchResult.answers.map(answer => ({
          answer: answer.answer,
          confidence: answer.confidence,
          sourceDocument: answer.sourceDocument,
          context: answer.context,
          matchType: answer.matchType
        })),
        relatedDocuments: searchResult.relatedDocuments,
        query: query.trim(),
        totalAnswers: searchResult.answers.length
      });
      
    } catch (error) {
      logger.error("Error in consciousness search", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { query, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ 
        error: "Failed to perform consciousness search",
        message: "Consciousness search service encountered an error. Please try again."
      });
    }
  });

  // Get document content on-demand
  app.get("/api/documents/:id/content", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      const content = await storage.getDocumentContent(id, userId);
      
      if (content === null) {
        res.status(404).json({ error: "Document not found or has no content" });
        return;
      }
      
      res.json({ content });
    } catch (error) {
      logger.error("Error fetching document content", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { documentId: id, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to fetch document content" });
    }
  });

  // Get document by ID
  app.get("/api/documents/:id", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      const document = await storage.getDocumentById(req.params.id, userId);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }
      res.json(document);
    } catch (error) {
      logger.error("Error fetching document by ID", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { documentId: req.params.id, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to fetch document" });
    }
  });

  // Get AI analysis queue status - for when you want to know what our digital brain is up to! 🧠📊
  app.get("/api/queue/status", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ 
          error: "User authentication required",
          funnyMessage: "Who goes there?! 🕵️‍♀️ Our queue status is classified information!"
        });
      }

      // Get queue status for the user
      const queueStatus = await storage.getQueueStatus(userId);
      
      // Get daily quota usage  
      const today = new Date().toISOString().split('T')[0];
      const dailyUsage = await storage.getDailyUsage(today);
      
      // Calculate some fun stats
      const totalRequests = queueStatus.pending + queueStatus.processing + queueStatus.completed + queueStatus.failed;
      const completionRate = totalRequests > 0 ? Math.round((queueStatus.completed / totalRequests) * 100) : 0;
      const dailyQuotaUsed = dailyUsage?.requestCount || 0;
      const dailyQuotaLimit = 1200; // Our safety buffer
      const quotaPercentage = Math.round((dailyQuotaUsed / dailyQuotaLimit) * 100);

      // Generate funny messages based on queue status
      let statusMessage = "🤖 Our AI is ready and waiting for action!";
      let priorityTip = "💡 Pro tip: Priority 1 gets VIP treatment, priority 5 is chill mode!";
      
      if (queueStatus.pending > 10) {
        statusMessage = "🍿 Our AI is quite popular today! Your documents are in a VIP queue!";
        priorityTip = "☕ Maybe time for a coffee break while our digital brain catches up?";
      } else if (queueStatus.pending > 0) {
        statusMessage = `📋 ${queueStatus.pending} documents waiting for their AI makeover!`;
      } else if (queueStatus.processing > 0) {
        statusMessage = "⚡ AI analysis in progress! Digital magic is happening right now!";
      }

      if (quotaPercentage > 80) {
        statusMessage += " 🚨 Daily quota is getting cozy - our AI needs rest too!";
      }

      res.json({
        success: true,
        queueStatus,
        dailyQuota: {
          used: dailyQuotaUsed,
          limit: dailyQuotaLimit,
          percentage: quotaPercentage,
          remaining: dailyQuotaLimit - dailyQuotaUsed,
        },
        statistics: {
          totalRequests,
          completionRate,
          funnyStats: {
            coffeeBreaksNeeded: Math.ceil(queueStatus.pending / 5),
            aiHappinessLevel: Math.max(0, 100 - queueStatus.failed * 10),
            digitalMagicLevel: queueStatus.completed > 10 ? "🌟 Legendary" : queueStatus.completed > 5 ? "✨ Magical" : "🔮 Apprentice"
          }
        },
        messages: {
          statusMessage,
          priorityTip,
          quotaWarning: quotaPercentage > 80 ? "🛑 Approaching daily limit! Time for our AI to take a breather!" : null,
          encouragement: queueStatus.completed > 0 ? `🎉 ${queueStatus.completed} documents successfully analyzed! You're on fire!` : "🚀 Ready to analyze your first document!"
        },
        tips: [
          "🎯 Higher priority = faster processing!",
          "📊 Bulk uploads are automatically queued for efficient processing",
          "☕ Our AI works best with a steady flow - no need to rush!",
          quotaPercentage < 50 ? "🌟 Plenty of quota left - upload away!" : "⏰ Consider spreading uploads throughout the day"
        ].filter(Boolean)
      });
    } catch (error) {
      logger.error("Error fetching queue status", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ 
        error: "Failed to fetch queue status",
        funnyMessage: "Our status dashboard seems to be having a coffee break! ☕ Please try again!"
      });
    }
  });

  // Get fun facts and statistics about user's document management patterns
  app.get("/api/fun-facts", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }

      // Get all active documents for the user
      const allDocuments = await storage.getAllActiveDocuments(userId);
      const folders = await storage.getFolders(userId);
      const tags = await storage.getTags(userId);

      // Calculate file count quota (200 files)
      const fileCount = allDocuments.length;
      const fileQuota = 200;
      const fileQuotaPercentage = Math.round((fileCount / fileQuota) * 100);

      // Calculate storage quota (1GB = 1073741824 bytes)
      const totalStorage = allDocuments.reduce((sum, doc) => sum + (doc.fileSize || 0), 0);
      const storageQuotaBytes = 1073741824; // 1GB in bytes
      const storageUsedMB = Math.round(totalStorage / 1024 / 1024 * 100) / 100;
      const storageUsedGB = Math.round(totalStorage / 1024 / 1024 / 1024 * 1000) / 1000;
      const storageQuotaPercentage = Math.round((totalStorage / storageQuotaBytes) * 100);

      // Organization Patterns - only include folders with documents
      const folderCounts = folders
        .map(folder => ({
          name: folder.name,
          count: folder.documentCount
        }))
        .filter(folder => folder.count > 0)
        .sort((a, b) => b.count - a.count);
      const mostActiveFolder = folderCounts[0];

      // Tag usage statistics
      const tagUsageMap = new Map<string, number>();
      allDocuments.forEach(doc => {
        doc.tags?.forEach(tag => {
          tagUsageMap.set(tag.name, (tagUsageMap.get(tag.name) || 0) + 1);
        });
      });
      const tagUsageArray = Array.from(tagUsageMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
      const mostUsedTag = tagUsageArray[0];
      const tagUsageRatio = mostUsedTag && tagUsageArray[1] ? 
        Math.round(mostUsedTag.count / tagUsageArray[1].count * 10) / 10 : 0;

      // AI Classification Insights
      const aiCategorizedDocs = allDocuments.filter(doc => doc.aiCategory);
      const aiCategorizationRate = fileCount > 0 ? Math.round((aiCategorizedDocs.length / fileCount) * 100) : 0;

      // Document type distribution
      const typeDistribution = new Map<string, number>();
      allDocuments.forEach(doc => {
        const type = doc.aiDocumentType || doc.fileType || 'Unknown';
        typeDistribution.set(type, (typeDistribution.get(type) || 0) + 1);
      });
      const typeArray = Array.from(typeDistribution.entries())
        .map(([type, count]) => ({ 
          type, 
          count, 
          percentage: Math.round((count / fileCount) * 100) 
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);

      // Document Lifecycle
      const now = Date.now();
      const documentAges = allDocuments.map(doc => {
        const uploadDate = new Date(doc.uploadedAt);
        const ageInDays = Math.floor((now - uploadDate.getTime()) / (1000 * 60 * 60 * 24));
        let ageText: string;
        
        if (ageInDays === 0) {
          ageText = 'uploaded today';
        } else if (ageInDays === 1) {
          ageText = 'uploaded yesterday';
        } else {
          ageText = `${ageInDays} days old`;
        }
        
        return {
          name: doc.name,
          age: ageInDays,
          ageText
        };
      }).sort((a, b) => b.age - a.age);
      const oldestDoc = documentAges[0];

      // Drive sync stats
      const driveDocsCount = allDocuments.filter(doc => doc.isFromDrive).length;
      const directUploadsCount = fileCount - driveDocsCount;
      const drivePercentage = fileCount > 0 ? Math.round((driveDocsCount / fileCount) * 100) : 0;
      const directPercentage = 100 - drivePercentage;

      // Time intelligence - documents uploaded this month
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const docsThisMonth = allDocuments.filter(doc => 
        new Date(doc.uploadedAt) >= startOfMonth
      ).length;

      // Storage optimization
      const largeFiles = allDocuments.filter(doc => doc.fileSize > 5 * 1024 * 1024); // > 5MB
      const largeFilesStorage = largeFiles.reduce((sum, doc) => sum + (doc.fileSize || 0), 0);
      const largeFilesPercentage = totalStorage > 0 ? Math.round((largeFilesStorage / totalStorage) * 100) : 0;
      const largeFilesCountPercentage = fileCount > 0 ? Math.round((largeFiles.length / fileCount) * 100) : 0;

      // Untagged documents
      const untaggedDocs = allDocuments.filter(doc => !doc.tags || doc.tags.length === 0);

      res.json({
        success: true,
        quotas: {
          files: {
            used: fileCount,
            limit: fileQuota,
            percentage: fileQuotaPercentage,
            remaining: fileQuota - fileCount
          },
          storage: {
            usedBytes: totalStorage,
            usedMB: storageUsedMB,
            usedGB: storageUsedGB,
            limitGB: 1,
            percentage: storageQuotaPercentage,
            remainingGB: Math.round((1 - storageUsedGB) * 1000) / 1000
          }
        },
        insights: {
          organizationPatterns: {
            mostActiveFolder: mostActiveFolder && mostActiveFolder.count > 0
              ? `Your most active folder is '${mostActiveFolder.name}' with ${mostActiveFolder.count} documents`
              : fileCount > 0 
                ? "Documents are evenly distributed across folders" 
                : "Upload documents to see folder patterns",
            tagCount: tags.length,
            mostUsedTag: mostUsedTag ? `You've created ${tags.length} custom tags - '${mostUsedTag.name}' is used ${tagUsageRatio}x more than others` : "Create tags to organize your documents",
          },
          aiClassification: {
            categorizationRate: `AI correctly auto-categorized ${aiCategorizationRate}% of your documents`,
            documentTypes: typeArray.length > 0 ? 
              `Most common document types: ${typeArray.map(t => `${t.type} (${t.percentage}%)`).join(', ')}` :
              "Upload more documents to see type distribution",
            timeSaved: fileCount > 0 ? 
              `Time saved: ${Math.round(fileCount * 0.9 / 60 * 10) / 10} hours from automated filing vs manual organization` :
              "Start uploading to track time savings"
          },
          documentLifecycle: {
            oldestDocument: oldestDoc ? 
              `Oldest document: '${oldestDoc.name}' (${oldestDoc.ageText})` :
              "No documents yet",
            documentsThisMonth: `You've processed ${docsThisMonth} documents this month`,
          },
          productivity: {
            speedup: `You've processed ${fileCount} documents 5x faster than manual filing`,
            driveSync: driveDocsCount > 0 ? 
              `${driveDocsCount} Drive documents organized without opening Drive once` :
              "Connect Drive to see sync statistics",
            crossPlatform: fileCount > 0 ?
              `Cross-platform documents: ${drivePercentage}% Drive, ${directPercentage}% direct uploads` :
              "Upload documents to see distribution"
          },
          smartRecommendations: {
            untaggedDocs: untaggedDocs.length > 0 ?
              `${untaggedDocs.length} documents haven't been tagged - want AI to suggest tags?` :
              "All documents are tagged! 🎉",
            storageOptimization: largeFilesCountPercentage > 0 ?
              `Large files comprise ${largeFilesPercentage}% of storage but only ${largeFilesCountPercentage}% of documents` :
              "No large files detected"
          }
        }
      });
    } catch (error) {
      logger.error("Error fetching fun facts", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ 
        error: "Failed to fetch fun facts"
      });
    }
  });

  // Get system-wide analytics metrics - for tracking platform growth and usage! 📊
  app.get("/api/analytics/system-metrics", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }

      // Query database for system-wide metrics
      const [
        totalDocumentsResult,
        uniqueUsersResult,
        storageUsageResult
      ] = await Promise.all([
        // Total documents count (excluding deleted)
        db.select({ count: sql<number>`count(*)::int` })
          .from(documents)
          .where(eq(documents.isDeleted, false)),
        
        // Unique users count
        db.select({ count: sql<number>`count(distinct user_id)::int` })
          .from(documents),
        
        // Total storage used in MB
        db.select({ 
          totalBytes: sql<number>`coalesce(sum(file_size), 0)::bigint`,
          totalMB: sql<number>`coalesce(round(sum(file_size) / 1024.0 / 1024.0, 2), 0)::numeric`
        })
          .from(documents)
          .where(eq(documents.isDeleted, false))
      ]);

      const totalDocuments = totalDocumentsResult[0]?.count || 0;
      const uniqueUsers = uniqueUsersResult[0]?.count || 0;
      const storageUsedMB = Number(storageUsageResult[0]?.totalMB) || 0;
      const documentsPerUser = uniqueUsers > 0 ? 
        Math.round((totalDocuments / uniqueUsers) * 10) / 10 : 0;

      res.json({
        success: true,
        metrics: {
          total_documents: totalDocuments,
          total_users: uniqueUsers,
          documents_per_user: documentsPerUser,
          storage_used_mb: storageUsedMB,
          storage_used_gb: Math.round((storageUsedMB / 1024) * 100) / 100
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error("Error fetching system analytics", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ 
        error: "Failed to fetch system analytics",
        message: "Unable to retrieve analytics metrics. Please try again later."
      });
    }
  });

  // Bulk enqueue documents for embedding generation - for processing existing documents! 📊
  app.post("/api/queue/bulk-embeddings", verifyFirebaseToken, moderateLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({
          error: "User authentication required",
          funnyMessage: "Who goes there?! 🕵️‍♀️ Our embedding queue is VIP only!"
        });
      }
      
      // Trigger bulk embedding generation
      const result = await storage.bulkEnqueueDocumentsForEmbedding(userId, 9); // Very low priority
      
      res.json({
        success: true,
        result,
        message: result.queued > 0 
          ? `📊 Successfully queued ${result.queued} documents for embedding generation!`
          : result.skipped > 0 
            ? "🎯 All documents already have embeddings or are queued!"
            : "📝 No documents found that need embeddings!",
        funnyMessage: result.queued > 10 
          ? "🚀 Whoa! That's a lot of embeddings to generate! Our AI is going to be busy!"
          : result.queued > 0 
            ? "📊 Our embedding generator is fired up and ready to go!"
            : "✨ Looks like you're all caught up with embeddings!",
        details: {
          queued: result.queued,
          skipped: result.skipped,
          errors: result.errors,
          tip: "Embeddings are generated in the background and improve search accuracy! 🎯"
        }
      });
      
    } catch (error) {
      logger.error("Error in bulk embedding generation", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({
        error: "Failed to enqueue documents for embedding generation",
        funnyMessage: "Our embedding queue seems to be having technical difficulties! 🤖💭 Please try again!"
      });
    }
  });

  // Update document
  app.put("/api/documents/:id", express.json(), verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const { name, folderId, isFavorite, tagIds } = req.body;
      
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      
      // Build update object with only defined values
      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (folderId !== undefined) updateData.folderId = folderId;
      if (isFavorite !== undefined) updateData.isFavorite = isFavorite;
      
      const document = await storage.updateDocument(req.params.id, updateData, userId);

      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Update tags if provided
      if (tagIds !== undefined) {
        await storage.removeDocumentTags(document.id, userId);
        if (Array.isArray(tagIds)) {
          for (const tagId of tagIds) {
            await storage.addDocumentTag({ documentId: document.id, tagId }, userId);
          }
        }
      }

      const updatedDocument = await storage.getDocumentById(document.id, userId);
      res.json(updatedDocument);
    } catch (error) {
      logger.error("Error updating document", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { documentId: req.params.id, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to update document" });
    }
  });

  // Update document classification
  app.patch("/api/documents/:id/classification", express.json(), verifyFirebaseToken, moderateLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      const documentId = req.params.id;
      
      // Validate input
      const validationResult = classificationUpdateSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          error: "Invalid classification parameters",
          details: validationResult.error.issues
        });
      }
      
      
      const { category, documentType } = validationResult.data;
      
      // Check if document exists
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      
      const document = await storage.getDocumentById(documentId, userId);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }
      
      // Update document with user override classifications
      const updatedDocument = await storage.updateDocument(documentId, {
        overrideCategory: category,
        overrideDocumentType: documentType,
        classificationOverridden: true
      }, userId);
      
      if (!updatedDocument) {
        return res.status(500).json({ error: "Failed to update document classification" });
      }
      
      // Reorganize document into the correct folder based on new classification
      const organizeSuccess = await storage.organizeDocumentIntoFolder(documentId, category, documentType, userId);
      if (!organizeSuccess) {
        logger.warn("Failed to reorganize document after classification update", {
          reqId: (req as any).reqId,
          userId: userId,
          metadata: { documentId, category, documentType }
        });
        // Don't fail the request, as the classification was still updated
      }
      
      // Return the updated document with folder information
      const finalDocument = await storage.getDocumentById(documentId, userId);
      res.json(finalDocument);
      
    } catch (error) {
      logger.error("Error updating document classification", {
        reqId: (req as any).reqId,
        userId: req.user?.uid,
        metadata: { documentId: documentId, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to update document classification" });
    }
  });

  // Delete document
  app.delete("/api/documents/:id", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      const deleted = await storage.deleteDocument(req.params.id, userId);
      if (!deleted) {
        return res.status(404).json({ error: "Document not found" });
      }
      res.status(204).send();
    } catch (error) {
      logger.error("Error deleting document", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { documentId: req.params.id, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to delete document" });
    }
  });

  // Restore document from trash
  app.patch("/api/documents/:id/restore", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      const result = await storage.restoreDocument(req.params.id, userId);
      if (!result.success) {
        const statusCode = result.error?.includes("not found") ? 404 : 400;
        return res.status(statusCode).json({ 
          error: result.error || "Failed to restore document",
          details: result.error?.includes("7-day") 
            ? "Documents can only be restored within 7 days of deletion"
            : "Check if the document exists in trash and is eligible for restore"
        });
      }
      res.json({ 
        success: true,
        message: result.message || "Document and file restored successfully from trash",
        note: result.alreadyLive 
          ? "Document restored (file was already available in cloud storage)"
          : "Both the document record and the file in cloud storage have been restored",
        alreadyLive: result.alreadyLive || false
      });
    } catch (error) {
      logger.error("Error restoring document", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { documentId: req.params.id, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to restore document" });
    }
  });

  // Restore all documents from trash
  app.patch("/api/documents/trash/restore-all", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      
      // Get all trashed documents for this user
      const trashedDocs = await storage.getTrashedDocuments(userId);
      
      if (trashedDocs.documents.length === 0) {
        return res.json({ 
          success: true,
          message: "No documents to restore",
          restoredCount: 0
        });
      }
      
      // Restore each document
      let restoredCount = 0;
      let failedCount = 0;
      const errors: string[] = [];
      
      for (const doc of trashedDocs.documents) {
        try {
          const result = await storage.restoreDocument(doc.id, userId);
          if (result.success) {
            restoredCount++;
          } else {
            failedCount++;
            errors.push(`${doc.name}: ${result.error || 'Unknown error'}`);
          }
        } catch (err: any) {
          failedCount++;
          errors.push(`${doc.name}: ${err.message || 'Unknown error'}`);
        }
      }
      
      res.json({ 
        success: true,
        message: `Restored ${restoredCount} of ${trashedDocs.documents.length} documents`,
        restoredCount,
        failedCount,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      logger.error("Error restoring all documents", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to restore all documents" });
    }
  });

  // AI Analysis endpoint
  app.post("/api/documents/:id/analyze", verifyFirebaseToken, moderateLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      const documentId = req.params.id;
      
      // Validate and sanitize analysis parameters
      const validationResult = analysisSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          error: "Invalid analysis parameters",
          details: validationResult.error.issues
        });
      }
      
      const { forceReanalysis, categories } = validationResult.data;
      
      // Check if API key is configured
      if (!process.env.GEMINI_API_KEY) {
        logger.error("AI analysis failed: API key not configured", {
          reqId: (req as any).reqId,
          userId: req.user?.uid,
          metadata: { documentId }
        });
        return res.status(503).json({ error: "AI analysis unavailable - API key not configured" });
      }
      
      // Check if document exists
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      
      const document = await storage.getDocumentById(documentId, userId);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      // If force reanalysis, queue the job instead of running immediately
      if (forceReanalysis) {
        try {
          // Enqueue for background analysis
          await storage.enqueueDocumentForAnalysis(documentId, userId, 1); // High priority for user-requested
          
          // Clear any stale error flags
          await db
            .update(documents)
            .set({
              aiSummary: null,
              aiKeyTopics: null,
              aiDocumentType: null,
              aiCategory: null,
              aiSentiment: null,
              aiWordCount: null,
              aiAnalyzedAt: null,
              aiConciseName: null,
              aiCategoryConfidence: null,
              aiDocumentTypeConfidence: null
            })
            .where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
          
          return res.json({
            success: true,
            message: "Document queued for AI analysis",
            status: "pending"
          });
        } catch (error) {
          logger.error("Failed to enqueue document for reanalysis", {
            reqId: (req as any).reqId,
            userId: userId,
            metadata: { documentId, errorMessage: error instanceof Error ? error.message : String(error) }
          });
          return res.status(500).json({ error: "Failed to queue document for analysis" });
        }
      }

      // Handle Drive vs uploaded documents differently for immediate analysis
      let success = false;
      
      if (document.driveFileId) {
        // For Drive documents, try to get the Drive access token but don't require it
        const { token: driveAccessToken } = getDriveToken(req);
        
        try {
          // Pass the Drive access token if available, otherwise try without it
          success = await storage.analyzeDocumentWithAI(documentId, userId, undefined, driveAccessToken || undefined);
        } catch (error) {
          logger.error("AI analysis failed for Drive document", {
            reqId: (req as any).reqId,
            userId: userId,
            metadata: { documentId, errorMessage: error instanceof Error ? error.message : String(error) }
          });
          success = false;
        }
      } else {
        // For uploaded documents, analyze normally
        try {
          success = await storage.analyzeDocumentWithAI(documentId, userId);
        } catch (aiError) {
          logger.error("AI analysis failed for uploaded file", {
            reqId: (req as any).reqId,
            userId: userId,
            metadata: { documentId, errorMessage: aiError instanceof Error ? aiError.message : String(aiError) }
          });
          success = false;
        }
      }
      
      if (!success) {
        return res.status(500).json({ error: "Failed to analyze document with AI" });
      }

      // Return updated document with AI analysis
      const updatedDocument = await storage.getDocumentById(documentId, userId);
      res.json({
        success: true,
        message: "Document analyzed successfully",
        document: updatedDocument
      });
    } catch (error) {
      logger.error("AI analysis exception", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { documentId: req.params.id, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to analyze document" });
    }
  });

  // Content extraction endpoint for single document
  app.post("/api/documents/:id/extract-content", verifyFirebaseToken, moderateLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      const documentId = req.params.id;
      
      // Check if document exists
      const document = await storage.getDocumentById(documentId);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }
      
      let success = false;
      
      // Check if this is a Google Drive document
      if (document.driveFileId) {
        
        // For Drive documents, we need the user's Google access token
        const { token: driveAccessToken, source } = getDriveToken(req);
        
        if (!driveAccessToken) {
          return res.status(403).json({ 
            error: "Google Drive access token required",
            message: "Please authenticate with Google Drive first",
            code: "DRIVE_TOKEN_REQUIRED"
          });
        }
        
        try {
          // Extract with Drive authentication
          success = await storage.extractDocumentContent(documentId, userId, driveAccessToken);
          
        } catch (driveError) {
          logger.error("Drive authentication failed", {
            reqId: (req as any).reqId,
            userId: userId,
            metadata: { documentId, errorMessage: driveError instanceof Error ? driveError.message : String(driveError) }
          });
          return res.status(403).json({ 
            error: "Failed to authenticate with Google Drive",
            message: "Please re-authenticate with Google Drive",
            code: "DRIVE_AUTH_FAILED"
          });
        }
      } else {
        // Regular uploaded document
        success = await storage.extractDocumentContent(documentId, userId);
      }
      
      if (!success) {
        return res.status(500).json({ error: "Failed to extract document content" });
      }

      // Return updated document with extracted content
      const updatedDocument = await storage.getDocumentById(documentId);
      res.json({
        success: true,
        message: "Document content extracted successfully",
        document: updatedDocument
      });
    } catch (error) {
      logger.error("Error extracting document content", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { documentId, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to extract document content" });
    }
  });

  // Batch content extraction endpoint
  app.post("/api/documents/batch-extract-content", verifyFirebaseToken, moderateLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      
      // Get documents without extracted content
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      const documentsWithoutContent = await storage.getDocumentsWithoutContent(userId);
      
      if (documentsWithoutContent.length === 0) {
        return res.json({
          success: true,
          message: "All documents already have extracted content",
          processed: 0,
          total: 0
        });
      }


      // Process documents in batches (don't wait for all to complete)
      let processed = 0;
      let successful = 0;

      // Start processing asynchronously
      const processingPromise = Promise.all(
        documentsWithoutContent.map(async (doc) => {
          try {
            const success = await storage.extractDocumentContent(doc.id);
            if (success) successful++;
            return { id: doc.id, success };
          } catch (error) {
            logger.error("Error processing document in batch", {
              reqId: (req as any).reqId,
              userId: userId,
              metadata: { documentId: doc.id, errorMessage: error instanceof Error ? error.message : String(error) }
            });
            return { id: doc.id, success: false };
          } finally {
            processed++;
          }
        })
      );

      // Don't wait for all to complete - return immediate response
      res.json({
        success: true,
        message: `Batch content extraction started for ${documentsWithoutContent.length} documents`,
        total: documentsWithoutContent.length,
        status: "processing"
      });

      // Log completion asynchronously
      processingPromise.then(() => {
      }).catch((error) => {
        logger.error("Batch content extraction error", {
          reqId: (req as any).reqId,
          userId: userId,
          metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
        });
      });
      
    } catch (error) {
      logger.error("Error in batch content extraction", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to start batch content extraction" });
    }
  });

  // PDF-specific AI analysis endpoint - Ensure PDFs get properly analyzed
  app.post("/api/documents/analyze-pdfs", verifyFirebaseToken, strictLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      
      // Get all PDF documents that need analysis
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      const allDocuments = await storage.getDocuments({
        search: "",
        page: 1,
        limit: 1000,
        includeContent: false
      });
      
      // Filter for PDFs that need analysis
      const pdfDocuments = allDocuments.filter((doc: DocumentWithFolderAndTags) => 
        !doc.isDeleted && 
        doc.name.toLowerCase().endsWith('.pdf') && (
          doc.aiCategory === null || 
          doc.aiAnalyzedAt === null
        )
      );
      
      if (pdfDocuments.length === 0) {
        return res.json({
          success: true,
          message: "All PDFs are already analyzed",
          processed: 0,
          total: 0
        });
      }


      let processed = 0;
      let successful = 0;
      let needsExtraction = 0;

      // Process PDFs in batches
      const batchPromise = async () => {
        for (const doc of pdfDocuments) {
          try {
            
            // Check if document has extracted content
            if (!doc.contentExtracted) {
              needsExtraction++;
              processed++;
              continue;
            }
            
            // Try AI analysis for PDFs with content
            let success = false;
            if (doc.driveFileId) {
              // Drive document - try analysis (may work if content is already extracted)
              success = await storage.analyzeDocumentWithAI(doc.id);
            } else {
              // Uploaded document
              success = await storage.analyzeDocumentWithAI(doc.id);
            }
            
            if (success) {
              successful++;
            } else {
            }
            
            processed++;
            
          } catch (error) {
            logger.error("Error processing PDF document", {
              reqId: (req as any).reqId,
              userId: userId,
              metadata: { documentId: doc.id, errorMessage: error instanceof Error ? error.message : String(error) }
            });
            processed++;
          }
        }
      };

      // Return immediate response
      res.json({
        success: true,
        message: `PDF analysis started for ${pdfDocuments.length} PDFs`,
        total: pdfDocuments.length,
        status: "processing"
      });

      // Log completion asynchronously
      batchPromise().then(() => {
      }).catch((error) => {
        logger.error("PDF analysis error", {
          reqId: (req as any).reqId,
          userId: userId,
          metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
        });
      });

    } catch (error) {
      logger.error("PDF analysis failed", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to start PDF analysis" });
    }
  });

  // Bulk AI analysis endpoint - Re-analyze documents with improved classification
  app.post("/api/documents/bulk-ai-analysis", strictLimiter, verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      
      // Get all documents and filter those that need AI analysis
      const allDocuments = await storage.getDocuments({
        search: "",
        page: 1,
        limit: 1000, // Get up to 1000 documents
        includeContent: false
      });
      
      // Filter documents that need re-analysis (NULL category or misclassified)
      const documentsForAnalysis = allDocuments.filter((doc: DocumentWithFolderAndTags) => 
        !doc.isDeleted && (
          doc.aiCategory === null || 
          doc.aiDocumentType === 'Event Notice' || 
          doc.aiDocumentType === 'Unknown' || 
          doc.aiDocumentType === 'Letter' ||
          doc.aiCategory === 'Education'
        )
      );
      
      if (documentsForAnalysis.length === 0) {
        return res.json({
          success: true,
          message: "All documents already have proper AI classification",
          processed: 0,
          total: 0
        });
      }


      // Process documents in batches with concurrency limit
      let processed = 0;
      let successful = 0;
      const concurrency = 3; // Limit concurrent AI requests

      // Start processing asynchronously with limited concurrency
      const batchPromise = async () => {
        for (let i = 0; i < documentsForAnalysis.length; i += concurrency) {
          const batch = documentsForAnalysis.slice(i, i + concurrency);
          
          await Promise.all(
            batch.map(async (doc: DocumentWithFolderAndTags) => {
              try {
                
                let success = false;
                if (doc.driveFileId) {
                  // Drive document - need user's access token for authentication
                  processed++;
                  return { id: doc.id, success: false, reason: "drive_auth_required" };
                } else {
                  // Uploaded document
                  success = await storage.analyzeDocumentWithAI(doc.id);
                }
                
                if (success) {
                  successful++;
                } else {
                }
                
                return { id: doc.id, success };
              } catch (error) {
                logger.error("Error analyzing document", {
                  reqId: (req as any).reqId,
                  userId: userId,
                  metadata: { documentId: doc.id, errorMessage: error instanceof Error ? error.message : String(error) }
                });
                return { id: doc.id, success: false };
              } finally {
                processed++;
              }
            })
          );
          
          // Small delay between batches to prevent overwhelming the AI service
          if (i + concurrency < documentsForAnalysis.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      };

      // Return immediate response
      res.json({
        success: true,
        message: `Bulk AI analysis started for ${documentsForAnalysis.length} documents`,
        total: documentsForAnalysis.length,
        status: "processing"
      });

      // Log completion asynchronously
      batchPromise().then(() => {
      }).catch((error) => {
        logger.error("Bulk AI analysis error", {
          reqId: (req as any).reqId,
          userId: userId,
          metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
        });
      });

    } catch (error) {
      logger.error("Bulk AI analysis failed", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to start bulk AI analysis" });
    }
  });

  // Smart Organization Check endpoint - Intelligently detects and fixes incomplete documents
  app.post("/api/smart-organization", moderateLimiter, verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const { DatabaseStorage } = await import("./storage");
      const storage = new DatabaseStorage();
      const userId = req.userId!;
      
      // Fetch ALL documents in batches - continues until natural end (partial batch)
      const BATCH_SIZE = 500;
      const MAX_PAGES = 1000; // Safety failsafe to prevent infinite loops only
      let allDocuments: DocumentWithFolderAndTags[] = [];
      let currentPage = 1;
      
      while (currentPage <= MAX_PAGES) {
        const batch = await storage.getDocuments({
          search: "",
          page: currentPage,
          limit: BATCH_SIZE,
          includeContent: false
        }, userId);  // userId is a SEPARATE parameter, not in filters!
        
        // Empty batch = reached end
        if (batch.length === 0) {
          break;
        }
        
        allDocuments = allDocuments.concat(batch);
        currentPage++;
        
        // Partial batch = natural end reached
        if (batch.length < BATCH_SIZE) {
          break;
        }
      }
      
      // Log error if we hit the safety failsafe (indicates possible infinite loop)
      if (currentPage > MAX_PAGES) {
        logger.error("Smart Organization hit pagination safety failsafe", {
          reqId: (req as any).reqId,
          userId: userId,
          metadata: { maxPages: MAX_PAGES, documentsLoaded: allDocuments.length }
        });
      }
      
      // Classify documents into categories
      const needsReanalysis: DocumentWithFolderAndTags[] = [];
      const needsOrganization: DocumentWithFolderAndTags[] = [];
      const alreadyComplete: DocumentWithFolderAndTags[] = [];
      
      for (const doc of allDocuments) {
        if (doc.isDeleted) continue;
        
        // Check if document needs re-analysis (missing AI data)
        if (!doc.aiSummary || !doc.aiCategory || !doc.aiDocumentType) {
          needsReanalysis.push(doc);
        }
        // Check if has AI data but not organized
        else if (!doc.folderId && doc.aiCategory && doc.aiDocumentType) {
          needsOrganization.push(doc);
        }
        // Already complete - has AI data and is organized
        else {
          alreadyComplete.push(doc);
        }
      }
      
      // Re-analyze documents that need it with concurrency control
      const CONCURRENCY_LIMIT = 3;
      let reanalyzedCount = 0;
      
      // Process in batches of CONCURRENCY_LIMIT with delays
      for (let i = 0; i < needsReanalysis.length; i += CONCURRENCY_LIMIT) {
        const batch = needsReanalysis.slice(i, i + CONCURRENCY_LIMIT);
        
        await Promise.all(
          batch.map(async (doc) => {
            try {
              if (doc.driveFileId) {
                return;
              }
              await storage.analyzeDocumentWithAI(doc.id, userId);
              reanalyzedCount++;
            } catch (error) {
              logger.error("Failed to re-analyze document", {
                reqId: (req as any).reqId,
                userId: userId,
                metadata: {
                  documentId: doc.id,
                  documentName: doc.name,
                  errorMessage: error instanceof Error ? error.message : String(error)
                }
              });
            }
          })
        );
        
        // Add delay between batches to avoid overwhelming the system
        if (i + CONCURRENCY_LIMIT < needsReanalysis.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // Organize all documents that need organization
      let organizedCount = 0;
      if (needsOrganization.length > 0 || reanalyzedCount > 0) {
        const result = await storage.organizeAllUnorganizedDocuments(userId);
        organizedCount = result.organized;
      }
      
      // Return response AFTER all processing is complete
      res.json({
        success: true,
        reanalyzed: reanalyzedCount,
        organized: organizedCount,
        alreadyComplete: alreadyComplete.length,
        total: allDocuments.length,
        status: "complete",
        message: reanalyzedCount > 0 
          ? `✨ Re-analyzed ${reanalyzedCount} documents and organized ${organizedCount} total`
          : organizedCount > 0 
            ? `✨ Organized ${organizedCount} documents`
            : `✨ All ${allDocuments.length} documents are already organized!`
      });
      
    } catch (error) {
      logger.error("Smart organization failed", {
        reqId: (req as any).reqId,
        userId: req.user?.uid,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to complete smart organization" });
    }
  });

  // Document Versioning endpoints
  
  // Get document with all versions
  app.get("/api/documents/:id/versions", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const documentWithVersions = await storage.getDocumentWithVersions(req.params.id, req.userId!);
      if (!documentWithVersions) {
        return res.status(404).json({ error: "Document not found" });
      }
      res.json(documentWithVersions);
    } catch (error) {
      logger.error("Error fetching document versions", {
        reqId: (req as any).reqId,
        userId: req.userId,
        metadata: { documentId: req.params.id, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to fetch document versions" });
    }
  });

  // Create new version
  app.post("/api/documents/:id/versions", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const { uploadURL, changeDescription, uploadedBy = "system", idempotencyKey } = req.body;
      
      if (!uploadURL) {
        return res.status(400).json({ error: "Upload URL is required" });
      }

      // Get existing document to get file info (with user verification)
      const document = await storage.getDocumentById(req.params.id, req.userId!);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Normalize the object path
      const objectStorageService = new ObjectStorageService();
      const filePath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      // Create version data (version number will be generated automatically by storage)
      const versionData = {
        documentId: req.params.id,
        // Don't set version - it will be generated atomically by storage
        filePath,
        fileSize: parseInt(req.body.fileSize) || document.fileSize,
        fileType: req.body.fileType || document.fileType,
        mimeType: req.body.mimeType || document.mimeType,
        uploadedBy,
        changeDescription,
        isActive: false, // New versions start as inactive
      };

      const validatedData = insertDocumentVersionSchema.parse(versionData);
      const version = await storage.createDocumentVersion(
        validatedData, 
        req.userId!, 
        undefined, // reqId will be auto-generated
        idempotencyKey // Optional client-provided idempotency key
      );
      
      res.status(201).json(version);
    } catch (error) {
      logger.error("Error creating document version", {
        reqId: (req as any).reqId,
        userId: req.userId,
        metadata: { documentId: req.params.id, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      
      // Handle idempotency conflicts (409)
      if (error instanceof Error && error.message.includes('same idempotency key')) {
        return res.status(409).json({ 
          error: "Idempotency conflict: Operation with same key already processed",
          code: "IDEMPOTENCY_CONFLICT"
        });
      }
      
      // Handle unique constraint violations (Postgres error code 23505)
      if (error instanceof Error && (error as any).code === '23505') {
        return res.status(409).json({ 
          error: "Version conflict detected. Please retry your request.",
          code: "VERSION_CONFLICT"
        });
      }
      
      res.status(500).json({ error: "Failed to create document version" });
    }
  });

  // Set active version
  app.put("/api/documents/:id/versions/:versionId/activate", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const activated = await storage.setActiveVersion(req.params.id, req.params.versionId, req.userId!);
      if (!activated) {
        return res.status(404).json({ error: "Document or version not found" });
      }
      res.json({ message: "Version activated successfully" });
    } catch (error) {
      logger.error("Error activating version", {
        reqId: (req as any).reqId,
        userId: req.userId,
        metadata: { documentId: req.params.id, versionId: req.params.versionId, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      
      // Handle unique constraint violations during activation (Postgres error code 23505)
      if (error instanceof Error && (error as any).code === '23505') {
        return res.status(409).json({ 
          error: "Activation conflict detected. Please retry your request.",
          code: "ACTIVE_VERSION_CONFLICT"
        });
      }
      
      res.status(500).json({ error: "Failed to activate version" });
    }
  });

  // Delete version
  app.delete("/api/documents/:id/versions/:versionId", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const deleted = await storage.deleteDocumentVersion(req.params.id, req.params.versionId, req.userId!);
      if (!deleted) {
        return res.status(404).json({ error: "Version not found or doesn't belong to this document" });
      }
      res.status(204).send();
    } catch (error) {
      logger.error("Error deleting version", {
        reqId: (req as any).reqId,
        userId: req.userId,
        metadata: { documentId: req.params.id, versionId: req.params.versionId, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      
      // Handle unique constraint violations during deletion (when promoting new active version)
      if (error instanceof Error && (error as any).code === '23505') {
        return res.status(409).json({ 
          error: "Deletion conflict detected. Please retry your request.",
          code: "VERSION_DELETE_CONFLICT"
        });
      }
      
      res.status(500).json({ error: "Failed to delete version" });
    }
  });

  // Smart Organization endpoint - organize all unorganized documents
  app.post("/api/documents/organize-all", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const result = await storage.organizeAllUnorganizedDocuments();
      
      res.json({
        success: true,
        message: `Successfully organized ${result.organized} documents into smart folders`,
        organized: result.organized,
        errors: result.errors
      });
    } catch (error) {
      logger.error("Error in Smart Organization", {
        reqId: (req as any).reqId,
        userId: req.user?.uid,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ 
        success: false,
        error: "Failed to organize documents",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Folders endpoints
  // Get user quota usage summary
  app.get("/api/user/quota", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }

      const quotaSummary = await getQuotaUsageSummary(userId);
      if (!quotaSummary) {
        return res.status(500).json({ error: "Failed to retrieve quota information" });
      }

      res.json({
        success: true,
        quota: quotaSummary
      });
    } catch (error) {
      logger.error("Error fetching quota usage", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to retrieve quota usage" });
    }
  });

  app.get("/api/folders", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      const folders = await storage.getFolders(userId);
      res.json(folders);
    } catch (error) {
      logger.error("Error fetching folders", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to fetch folders" });
    }
  });

  app.post("/api/folders", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      const validatedData = insertFolderSchema.parse(req.body);
      const folder = await storage.createFolder(validatedData, userId);
      res.status(201).json(folder);
    } catch (error) {
      logger.error("Error creating folder", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to create folder" });
    }
  });

  app.put("/api/folders/:id", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      const folder = await storage.updateFolder(req.params.id, req.body, userId);
      if (!folder) {
        return res.status(404).json({ error: "Folder not found" });
      }
      res.json(folder);
    } catch (error) {
      logger.error("Error updating folder", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { folderId: req.params.id, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to update folder" });
    }
  });

  app.delete("/api/folders/:id", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      const deleted = await storage.deleteFolder(req.params.id, userId);
      if (!deleted) {
        return res.status(404).json({ error: "Folder not found" });
      }
      res.status(204).send();
    } catch (error) {
      logger.error("Error deleting folder", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { folderId: req.params.id, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to delete folder" });
    }
  });

  // Tags endpoints
  app.get("/api/tags", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      const tags = await storage.getTags(userId);
      res.json(tags);
    } catch (error) {
      logger.error("Error fetching tags", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to fetch tags" });
    }
  });

  app.post("/api/tags", express.json(), verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      
      // Only validate name and color from request body, userId comes from auth
      const bodySchema = insertTagSchema.omit({ userId: true });
      const validatedData = bodySchema.parse(req.body);
      const tag = await storage.createTag({ ...validatedData, userId }, userId);
      res.status(201).json(tag);
    } catch (error) {
      logger.error("Error creating tag", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to create tag" });
    }
  });

  app.put("/api/tags/:id", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      const tag = await storage.updateTag(req.params.id, req.body, userId);
      if (!tag) {
        return res.status(404).json({ error: "Tag not found" });
      }
      res.json(tag);
    } catch (error) {
      logger.error("Error updating tag", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { tagId: req.params.id, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to update tag" });
    }
  });

  app.delete("/api/tags/:id", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      const deleted = await storage.deleteTag(req.params.id, userId);
      if (!deleted) {
        return res.status(404).json({ error: "Tag not found" });
      }
      res.status(204).send();
    } catch (error) {
      logger.error("Error deleting tag", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { tagId: req.params.id, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to delete tag" });
    }
  });

  // Document-Tags endpoints
  app.post("/api/document-tags", express.json(), verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      // The userId needs to be added BEFORE validation
      const userId = req.userId || req.user?.uid;
      
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }
      
      // Add userId to body BEFORE parsing with Zod
      const bodyWithUser = { ...req.body, userId };
      
      // NOW parse with Zod using safeParse
      const parsed = insertDocumentTagSchema.safeParse(bodyWithUser);
      
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error });
      }
      
      // Continue with validated data
      const documentTag = await storage.addDocumentTag(parsed.data, userId);
      res.status(201).json(documentTag);
    } catch (error) {
      logger.error("Error adding tag to document", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to add tag to document" });
    }
  });

  app.delete("/api/document-tags/:documentId/:tagId", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }
      const { documentId, tagId } = req.params;
      await storage.removeDocumentTag(documentId, tagId, userId);
      res.status(204).send();
    } catch (error) {
      logger.error("Error removing tag from document", {
        reqId: (req as any).reqId,
        userId: userId,
        metadata: { documentId: req.params.documentId, tagId: req.params.tagId, errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to remove tag from document" });
    }
  });

  // Google Drive Integration endpoints
  
  // Content-Type validation middleware for OAuth callback
  const validateJsonContentType = (req: any, res: any, next: any) => {
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      return res.status(415).json({ 
        error: "Unsupported Media Type",
        message: "Content-Type must be application/json"
      });
    }
    next();
  };

  // Add diagnostic endpoint for cookie debugging (temporary)
  app.get('/api/drive/debug-cookie', (req, res) => {
    const has = Boolean(req.cookies?.drive_access_token);
    res.json({ has, cookies: Object.keys(req.cookies || {}) });
  });

  // Token 2: Build URL with URLSearchParams (zero chance of HTML escaping)
  function buildGoogleDriveAuthUrl(req: Request) {
    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const origin = `${req.protocol}://${req.get('host')}`;
    const redirectUri = `${origin}/api/drive/oauth-callback`;
    const scope = [
      'https://www.googleapis.com/auth/drive.readonly'
    ].join(' ');
    const state = String(Date.now());

    const p = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope,
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
  }

  // OAuth initiation endpoint - redirects to Google OAuth
  app.get('/api/auth/drive-redirect', (req, res) => {
    // Build URL using URLSearchParams (Token 2)
    const fullUrl = buildGoogleDriveAuthUrl(req);

    // Add cache-busting headers
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    res.redirect(302, fullUrl);
  });

  // OAuth callback endpoint - sets httpOnly cookie with Drive token
  app.get("/api/drive/oauth-callback", async (req, res) => {
    try {
      const { code, error } = req.query;
      
      if (error) {
        return res.status(400).send(`
          <script>
            window.opener.postMessage({ success: false, error: '${error}' }, '*');
            window.close();
          </script>
        `);
      }
      
      if (!code) {
        return res.status(400).send(`
          <script>
            window.opener.postMessage({ success: false, error: 'No authorization code received' }, '*');
            window.close();
          </script>
        `);
      }

      // Exchange code for access token
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        `${req.protocol}://${req.get('host')}/api/drive/oauth-callback`
      );

      const { tokens } = await oauth2Client.getToken(code as string);
      const accessToken = tokens.access_token;
      
      if (!accessToken) {
        return res.status(400).send(`
          <script>
            window.opener.postMessage({ success: false, error: 'No access token received' }, '*');
            window.close();
          </script>
        `);
      }
      
      // Verify token with Google and get user info
      oauth2Client.setCredentials({ access_token: accessToken });
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();
      
      const googleUserEmail = userInfo.data.email;
      if (!googleUserEmail) {
        return res.status(400).send(`
          <script>
            window.opener.postMessage({ success: false, error: 'Could not get user email from Google' }, '*');
            window.close();
          </script>
        `);
      }
      
      // Set the token in httpOnly cookie
      setDriveTokenCookie(res, accessToken, req);
      
      // Send success message to parent window and close popup
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .success-message {
              background: white;
              padding: 2rem;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.2);
              text-align: center;
            }
            .checkmark {
              width: 60px;
              height: 60px;
              border-radius: 50%;
              background: #10b981;
              color: white;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 32px;
              margin: 0 auto 1rem;
            }
            h1 {
              margin: 0 0 0.5rem;
              color: #1f2937;
              font-size: 24px;
            }
            p {
              margin: 0;
              color: #6b7280;
            }
          </style>
        </head>
        <body>
          <div class="success-message">
            <div class="checkmark">✓</div>
            <h1>Connected Successfully!</h1>
            <p>Returning to Drive...</p>
          </div>
          <script>
            // Send message to parent window
            if (window.opener) {
              window.opener.postMessage({ 
                success: true, 
                email: '${googleUserEmail}',
                authMethod: 'cookie'
              }, '*');
            }
            
            // Close popup after brief delay to show success message
            setTimeout(() => {
              window.close();
              // Fallback: if window.close() is blocked, redirect to main page
              setTimeout(() => {
                if (!window.closed) {
                  window.location.href = '/';
                }
              }, 500);
            }, 1500);
          </script>
        </body>
        </html>
      `);
      
    } catch (error) {
      logger.error("Drive OAuth callback failed", {
        reqId: (req as any).reqId,
        userId: undefined,
        metadata: {
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined
        }
      });
      
      res.status(500).send(`
        <script>
          window.opener.postMessage({ 
            success: false, 
            error: 'OAuth callback failed: ${error instanceof Error ? error.message : 'Unknown error'}' 
          }, '*');
          window.close();
        </script>
      `);
    }
  });
  
  // Sign out endpoint - clears Drive token cookies
  app.post("/api/drive/signout", express.json(), verifyFirebaseToken, csrfProtection, async (req: AuthenticatedRequest, res) => {
    try {
      clearDriveTokenCookies(res, req);
      
      res.json({
        success: true,
        message: "Drive sign-out successful"
      });
    } catch (error) {
      logger.error("Drive sign-out error", {
        reqId: (req as any).reqId,
        userId: req.user?.uid,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ 
        error: "Sign-out failed",
        message: "Failed to clear Drive authentication"
      });
    }
  });
  
  // Verify Drive connection and get status
  app.get("/api/drive/connect", verifyFirebaseToken, rejectLegacyDriveHeader, async (req: AuthenticatedRequest, res) => {
    try {
      // Check if Drive token exists (without requiring it)
      const { token: driveAccessToken } = getDriveToken(req);
      
      if (!driveAccessToken) {
        // Not connected - return friendly status instead of 401 error
        return res.json({
          connected: false,
          hasAccess: false,
          quota: null,
          message: "Google Drive not connected"
        });
      }

      // Token exists - verify it and get quota
      const driveService = new DriveService(driveAccessToken);
      
      // Verify Drive access
      const hasAccess = await driveService.verifyDriveAccess();
      if (!hasAccess) {
        return res.status(403).json({ 
          error: "Drive access not granted", 
          message: "Please re-authenticate with Drive permissions" 
        });
      }

      // Get storage quota info
      const quota = await driveService.getStorageQuota();
      
      res.json({
        connected: true,
        hasAccess: true,
        quota: quota || null,
        message: "Drive connected successfully"
      });
    } catch (error) {
      logger.error("Error checking Drive connection", {
        reqId: (req as any).reqId,
        userId: req.user?.uid,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to check Drive connection" });
    }
  });

  // List documents from Google Drive
  app.get("/api/drive/documents", moderateLimiter, verifyFirebaseToken, rejectLegacyDriveHeader, requireDriveAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const driveService = (req as any).driveService as DriveService;
      
      // Validate query parameters
      const validatedQuery = driveDocumentsQuerySchema.parse(req.query);
      
      const result = await driveService.listFiles({
        query: validatedQuery.search,
        pageToken: validatedQuery.pageToken,
        folderId: validatedQuery.folderId,
        pageSize: validatedQuery.pageSize
      });

      // Get folders for navigation
      const folders = await driveService.getFolders();
      
      res.json({
        files: result.files,
        folders,
        nextPageToken: result.nextPageToken,
        pagination: {
          pageSize: validatedQuery.pageSize,
          hasNext: !!result.nextPageToken
        }
      });
    } catch (error) {
      logger.error("Error listing Drive documents", {
        reqId: (req as any).reqId,
        userId: req.user?.uid,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: "Failed to list Drive documents" });
    }
  });

  // Token 6 - Content-Type guard for sync route (logs but allows missing headers)
  const contentTypeGuard = (req: any, res: any, next: any) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType) {
      logger.warn("Drive sync missing content-type header", {
        reqId: (req as any).reqId,
        userId: req.user?.uid,
        metadata: { userAgent: req.headers['user-agent'] }
      });
    } else if (!contentType.startsWith('application/json')) {
      logger.warn("Drive sync invalid content-type", {
        reqId: (req as any).reqId,
        userId: req.user?.uid,
        metadata: { contentType }
      });
      return res.status(415).json({
        error: 'Expected application/json for this endpoint.'
      });
    }
    next();
  };

  // Sync Drive document to local system (with CSRF protection for state-changing operation)
  // Token 1 - exactly one parser at route level
  app.post("/api/drive/sync", contentTypeGuard, express.json(), strictLimiter, verifyFirebaseToken, rejectLegacyDriveHeader, csrfProtection, requireDriveAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const reqId = (req as any).reqId;
      const userId = req.user?.uid;
      
      // Validate request body
      const validatedBody = driveSyncSchema.parse(req.body);
      const { driveFileId, folderId, runAiAnalysis } = validatedBody;

      const driveService = (req as any).driveService as DriveService;
      
      // Get file content from Drive
      const driveFile = await driveService.getFileContent(driveFileId);
      if (!driveFile) {
        logger.error("Drive file not found", {
          reqId,
          userId: userId,
          metadata: { driveFileId }
        });
        return res.status(404).json({ error: "Drive file not found or cannot be accessed" });
      }
      
      // Check if document already exists in our system
      const existingDocument = await storage.getDocumentByDriveFileId(driveFileId, userId!);
      if (existingDocument) {
        // Update existing document sync status
        const updatedDocument = await storage.updateDocument(
          existingDocument.id, 
          {
            driveSyncStatus: "synced",
            driveSyncedAt: new Date(),
          },
          userId!, // Pass userId for tenant context
          reqId
        );
        
        return res.json({
          message: "Document already synced",
          document: updatedDocument || existingDocument,
          isNew: false
        });
      }
      
      const docId = randomUUID();
      const objectPath = `users/${userId}/docs/${docId}/${driveFile.name}`;
      
      // Upload Drive file content to GCS (same as regular uploads)
      if (driveFile.content) {
        try {
          const bucket = objectStorageService.getBucket();
          await bucket.file(objectPath).save(Buffer.from(driveFile.content, 'utf8'), {
            contentType: driveFile.mimeType || "application/octet-stream",
            resumable: false,
            validation: false,
          });
        } catch (gcsError) {
          logger.error("Drive sync GCS upload failed", {
            reqId,
            userId: userId,
            metadata: {
              driveFileId,
              objectPath,
              errorMessage: gcsError instanceof Error ? gcsError.message : String(gcsError),
              errorStack: gcsError instanceof Error ? gcsError.stack : undefined
            }
          });
          // Don't fail the entire sync - fall back to database storage for now
        }
      }
      
      const documentData = {
        id: docId, // Use the same ID for consistency
        userId, // Required field for multi-tenant document ownership
        name: driveFile.name,
        originalName: driveFile.name,
        filePath: objectPath, // Use GCS path like regular uploads instead of drive: prefix
        objectPath: driveFile.content ? objectPath : null, // Set objectPath for GCS-stored files
        fileSize: driveFile.content ? driveFile.content.length : 0,
        fileType: getFileTypeFromMimeType(driveFile.mimeType, driveFile.name),
        mimeType: driveFile.mimeType,
        folderId: folderId || null,
        isFromDrive: true,
        driveFileId: driveFile.id,
        driveWebViewLink: `https://drive.google.com/file/d/${driveFile.id}/view`,
        driveLastModified: new Date(),
        driveSyncStatus: "synced",
        driveSyncedAt: new Date(),
        isFavorite: false,
        isDeleted: false,
        // Store content in database only as fallback if GCS upload fails
        documentContent: driveFile.content || null,
        contentExtracted: driveFile.content ? true : false,
        contentExtractedAt: driveFile.content ? new Date() : null,
      };

      const validatedData = insertDocumentSchema.parse(documentData);
      const document = await storage.createDocument(validatedData);

      // Queue for AI analysis if requested (matching Upload functionality)
      if (runAiAnalysis) {
        try {
          // Use same queue system as Upload for consistent Smart Organization
          await storage.enqueueDocumentForAnalysis(document.id, userId, 1); // High priority for user-requested
        } catch (aiError) {
          logger.error("Drive sync AI analysis enqueue failed", {
            reqId,
            userId: userId,
            metadata: {
              driveFileId,
              documentId: document.id,
              errorMessage: aiError instanceof Error ? aiError.message : String(aiError)
            }
          });
          // Don't let AI analysis queue errors crash the document sync
        }
      }

      // Get document with details
      const documentWithDetails = await storage.getDocumentById(document.id);
      
      res.status(201).json({
        message: "Document synced from Drive successfully",
        document: documentWithDetails,
        isNew: true
      });
    } catch (error) {
      const reqId = (req as any).reqId;
      const userId = req.user?.uid;
      const driveFileId = req.body?.driveFileId;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error("Drive sync failed", {
        reqId,
        userId: userId,
        metadata: {
          driveFileId,
          errorMessage,
          errorStack: error instanceof Error ? error.stack : undefined
        }
      });
      
      // Provide specific, user-friendly error messages based on error type
      let statusCode = 500;
      let userMessage = "Failed to sync Drive document";
      let userFriendlyMessage = "Something went wrong while syncing your document from Google Drive. Please try again.";
      
      if (errorMessage.includes("Idempotency key conflict")) {
        // This should now be rare with our new Drive-aware idempotency system
        statusCode = 409;
        userMessage = "Document update in progress";
        userFriendlyMessage = "This document is being updated from Google Drive. If you recently modified it, please wait a moment and try syncing again.";
      } else if (errorMessage.includes("access") || errorMessage.includes("permission") || errorMessage.includes("forbidden")) {
        statusCode = 403;
        userMessage = "Access denied";
        userFriendlyMessage = "Unable to access this Google Drive document. Please make sure you have permission to view the file and try reconnecting your Google Drive.";
      } else if (errorMessage.includes("not found") || errorMessage.includes("404")) {
        statusCode = 404;
        userMessage = "Document not found";
        userFriendlyMessage = "This document could not be found in your Google Drive. It may have been moved, deleted, or you may not have access to it.";
      } else if (errorMessage.includes("authentication") || errorMessage.includes("invalid token") || errorMessage.includes("401")) {
        statusCode = 401;
        userMessage = "Authentication required";
        userFriendlyMessage = "Your Google Drive connection has expired. Please reconnect your Google Drive account and try again.";
      } else if (errorMessage.includes("quota") || errorMessage.includes("limit") || errorMessage.includes("429")) {
        statusCode = 429;
        userMessage = "Rate limit exceeded";
        userFriendlyMessage = "Too many requests to Google Drive. Please wait a few minutes before trying to sync again.";
      } else if (errorMessage.includes("network") || errorMessage.includes("timeout") || errorMessage.includes("ECONNRESET")) {
        statusCode = 503;
        userMessage = "Network error";
        userFriendlyMessage = "Unable to connect to Google Drive right now. Please check your internet connection and try again.";
      } else if (errorMessage.includes("file too large") || errorMessage.includes("size")) {
        statusCode = 413;
        userMessage = "File too large";
        userFriendlyMessage = "This document is too large to sync. Please try with a smaller file.";
      }
      
      res.status(statusCode).json({ 
        error: userMessage,
        message: userFriendlyMessage,
        code: "DRIVE_SYNC_ERROR",
        retryable: statusCode === 503 || statusCode === 429 || statusCode === 409
      });
    }
  });


  // Helper function to determine file type from MIME type
  type FileType = "pdf"|"doc"|"docx"|"txt"|"jpg"|"png"|"gif"|"webp"|"csv"|"xlsx"|"pptx";

  const MIME_TO_TYPE: Record<string, FileType> = {
    "application/pdf": "pdf",

    // Word
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",

    // Text
    "text/plain": "txt",

    // Images
    "image/jpeg": "jpg",   // <- NOT "jpeg"
    "image/jpg":  "jpg",
    "image/png":  "png",
    "image/gif":  "gif",
    "image/webp": "webp",

    // Spreadsheets
    "text/csv": "csv",     // <- NOT "xlsx"
    "application/vnd.ms-excel": "xlsx", // (older .xls; we normalize to xlsx for schema)
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",

    // Slides
    "application/vnd.ms-powerpoint": "pptx", // normalize legacy .ppt to pptx for schema
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  };

  const EXT_TO_TYPE: Record<string, FileType> = {
    pdf: "pdf", doc: "doc", docx: "docx", txt: "txt",
    jpg: "jpg", jpeg: "jpg", png: "png", gif: "gif", webp: "webp",
    csv: "csv", xls: "xlsx", xlsx: "xlsx", ppt: "pptx", pptx: "pptx",
  };

  function getFileTypeFromMimeType(mime: string, filename?: string): FileType {
    const m = (mime || "").toLowerCase().trim();
    if (MIME_TO_TYPE[m]) return MIME_TO_TYPE[m];
    if (filename) {
      const ext = filename.split(".").pop()?.toLowerCase();
      if (ext && EXT_TO_TYPE[ext]) return EXT_TO_TYPE[ext];
    }
    // conservative default that passes schema and won't block finalize:
    return "txt";
  }

  // Admin: Clean up orphaned GCS files (development only)
  if (process.env.NODE_ENV === 'development') {
    app.post('/api/admin/cleanup-gcs', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
      try {
        const { DatabaseStorage } = await import('./storage');
        const storage = new DatabaseStorage();
        
        const { dryRun = true } = req.body;
        const result = await storage.reconcileGCSPaths(dryRun);
        
        res.json({
          success: true,
          ...result,
          dryRun
        });
      } catch (error) {
        logger.error('Error during GCS cleanup', {
          reqId: (req as any).reqId,
          userId: req.user?.uid,
          metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
        });
        res.status(500).json({ error: 'Failed to cleanup GCS files' });
      }
    });
  }

  // TESTING ONLY: Failpoint management endpoints for proving rollback behavior
  if (process.env.NODE_ENV === 'development') {
    // Add failpoint for testing rollback behavior
    app.post('/api/test/failpoint/add', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
      try {
        const { operationType, failurePoint, errorMessage } = req.body;
        
        if (!operationType || !failurePoint) {
          return res.status(400).json({ error: 'operationType and failurePoint are required' });
        }

        const { TransactionManager } = await import('./transactionManager');
        TransactionManager.addFailpoint({
          operationType,
          failurePoint,
          errorMessage: errorMessage || `Test rollback failure for ${operationType}`
        });

        res.json({
          success: true,
          message: `Failpoint added for ${operationType} at ${failurePoint}`,
          activeFailpoints: TransactionManager.getActiveFailpoints()
        });
      } catch (error) {
        logger.error('Error adding failpoint', {
          reqId: (req as any).reqId,
          userId: req.user?.uid,
          metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
        });
        res.status(500).json({ error: 'Failed to add failpoint' });
      }
    });

    // Remove specific failpoint
    app.delete('/api/test/failpoint/remove', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
      try {
        const { operationType, failurePoint } = req.body;
        
        if (!operationType || !failurePoint) {
          return res.status(400).json({ error: 'operationType and failurePoint are required' });
        }

        const { TransactionManager } = await import('./transactionManager');
        TransactionManager.removeFailpoint(operationType, failurePoint);

        res.json({
          success: true,
          message: `Failpoint removed for ${operationType} at ${failurePoint}`,
          activeFailpoints: TransactionManager.getActiveFailpoints()
        });
      } catch (error) {
        logger.error('Error removing failpoint', {
          reqId: (req as any).reqId,
          userId: req.user?.uid,
          metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
        });
        res.status(500).json({ error: 'Failed to remove failpoint' });
      }
    });

    // Clear all failpoints
    app.delete('/api/test/failpoint/clear', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
      try {
        const { TransactionManager } = await import('./transactionManager');
        TransactionManager.clearAllFailpoints();

        res.json({
          success: true,
          message: 'All failpoints cleared'
        });
      } catch (error) {
        logger.error('Error clearing failpoints', {
          reqId: (req as any).reqId,
          userId: req.user?.uid,
          metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
        });
        res.status(500).json({ error: 'Failed to clear failpoints' });
      }
    });

    // Get active failpoints
    app.get('/api/test/failpoint/status', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
      try {
        const { TransactionManager } = await import('./transactionManager');
        const activeFailpoints = TransactionManager.getActiveFailpoints();

        res.json({
          success: true,
          activeFailpoints,
          count: activeFailpoints.length
        });
      } catch (error) {
        logger.error('Error getting failpoint status', {
          reqId: (req as any).reqId,
          userId: req.user?.uid,
          metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
        });
        res.status(500).json({ error: 'Failed to get failpoint status' });
      }
    });
  }

  // Contact form endpoint
  app.post("/api/contact", express.json(), standardLimiter, async (req: Request, res: Response) => {
    try {
      const { from, to, subject, message } = req.body;

      // Validate input
      if (!from || !to || !subject || !message) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(from)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }

      // Check if Resend API key is configured
      const resendApiKey = process.env.RESEND_API_KEY;
      if (!resendApiKey) {
        logger.error('RESEND_API_KEY not configured', {
          reqId: (req as any).reqId,
          userId: undefined,
          metadata: {}
        });
        return res.status(500).json({ error: 'Email service not configured' });
      }

      // Send email using Resend with verified domain
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Clasio Contact <support@clasio.ai>',
          to: ['support@clasio.ai'],
          reply_to: from,
          subject: `[Contact Form] ${subject}`,
          html: `
            <div>
              <h2>New Contact Form Submission</h2>
              <p><strong>From:</strong> ${from}</p>
              <p><strong>Subject:</strong> ${subject}</p>
              <hr />
              <p>${message.replace(/\n/g, '<br />')}</p>
            </div>
          `
        })
      });

      const data = await response.json();

      if (!response.ok) {
        logger.error('Resend API error', {
          reqId: (req as any).reqId,
          userId: undefined,
          metadata: { resendResponse: data }
        });
        return res.status(500).json({ error: 'Failed to send email' });
      }

      res.json({ success: true, id: data.id });
    } catch (error) {
      logger.error('Error sending contact email', {
        reqId: (req as any).reqId,
        userId: undefined,
        metadata: { errorMessage: error instanceof Error ? error.message : String(error) }
      });
      res.status(500).json({ error: 'Failed to send email' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { ObjectStorageService, ObjectNotFoundError, generateDocumentPath } from "./objectStorage";
import { randomUUID } from 'crypto';
import { verifyFirebaseToken, optionalAuth, AuthenticatedRequest } from "./auth";
import { DriveService } from "./driveService";
import { strictLimiter, moderateLimiter, standardLimiter, bulkUploadLimiter } from "./rateLimit";
import multer from "multer";
import path from "path";
import { insertDocumentSchema, insertDocumentVersionSchema, insertFolderSchema, insertTagSchema, insertDocumentTagSchema, documentVersions, documents, type DocumentWithFolderAndTags } from "@shared/schema";
import { sql, eq } from "drizzle-orm";
import { db } from "./db.js";
import { z } from "zod";
import { google } from 'googleapis';
import { lookup as mimeLookup } from "mime-types";

// Middleware to verify Drive access token belongs to the authenticated Firebase user
async function requireDriveAccess(req: AuthenticatedRequest, res: any, next: any) {
  try {
    const driveAccessToken = req.headers['x-drive-access-token'] as string;
    if (!driveAccessToken) {
      return res.status(401).json({ error: "Google Drive access token required in x-drive-access-token header" });
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
    if (!googleUserEmail || googleUserEmail !== firebaseUserEmail) {
      return res.status(403).json({ 
        error: "Drive access token does not belong to the authenticated user",
        message: "Token mismatch detected"
      });
    }

    // Store Drive service in request for reuse
    (req as any).driveService = new DriveService(driveAccessToken);
    next();
  } catch (error) {
    console.error("Drive access verification failed:", error);
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
    .regex(/^[^<>:"/\\|?*\u0000-\u001F]+$/, "Category contains invalid characters"),
  documentType: z.string()
    .min(1, "Document type cannot be empty")
    .max(100, "Document type name too long")
    .trim()
    .regex(/^[^<>:"/\\|?*\u0000-\u001F]+$/, "Document type contains invalid characters")
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

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow common document types
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'text/plain',
      'text/csv'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  }
});

export async function registerRoutes(app: Express): Promise<Server> {
  const objectStorageService = new ObjectStorageService();

  // Apply standard rate limiting to all API routes
  app.use('/api', standardLimiter);
  
  // Add correlation ID for request tracking
  app.use((req: any, res, next) => { 
    req.reqId = randomUUID(); 
    next(); 
  });
  
  // Helper to sanitize paths: keep userId/docId, hide filename
  const obfuscatePath = (p?: string) => {
    const m = p?.match(/^users\/([^/]+)\/docs\/([^/]+)\/(.+)$/);
    return m ? `users/${m[1]}/docs/${m[2]}/<file>` : p;
  };

  // Configure multer for upload-proxy (BEFORE any JSON parser)
  const uploadProxy = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB cap
  });

  // Upload proxy MUST consume the body before any JSON middleware
  app.post("/api/documents/upload-proxy", 
    verifyFirebaseToken,
    uploadProxy.single("file"), // <<< this must run before any json parser
    async (req: AuthenticatedRequest, res) => {
      try {
        // Entry log with content-type
        console.info(JSON.stringify({ 
          evt: "upload-proxy.entry", 
          uid: req.user?.uid, 
          ct: req.headers["content-type"] 
        }));

        if (!req.file) return res.status(400).json({ error: "file missing" });

        const { originalname, mimetype, buffer, size } = req.file;
        const uid = req.user?.uid!;
        const docId = randomUUID();
        const objectPath = `users/${uid}/docs/${docId}/${originalname}`; // raw name; SDK encodes

        // Step 1: Upload to GCS
        const bucket = objectStorageService.getBucket();
        await bucket.file(objectPath).save(buffer, {
          contentType: mimetype || "application/octet-stream",
          resumable: false,
          validation: false,
        });

        console.info(JSON.stringify({
          evt: "upload-proxy.gcs_saved",
          uid, 
          objectPath: obfuscatePath(objectPath), 
          size
        }));

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
        const document = await storage.createDocument(validatedData);

        console.info(JSON.stringify({
          evt: "upload-proxy.db_created",
          uid,
          docId,
          fileType: determinedFileType,
          objectPathPrefix: `users/${uid}/docs/${docId}`
        }));

        // Step 3: Queue for AI analysis (like other upload routes)
        let analysisQueued = false;
        try {
          await storage.enqueueDocumentForAnalysis(document.id, uid, 5); // Normal priority
          analysisQueued = true;
          console.log(`🔍 Auto-queued AI analysis for: ${originalname} (proxy upload)`);
        } catch (analysisError) {
          console.warn(`Failed to auto-queue AI analysis for ${originalname}:`, analysisError);
        }

        // Step 4: Trigger background content extraction (same as normal uploads)
        storage.extractDocumentContent(document.id)
          .then(async (success) => {
            if (success) {
              console.log(`✅ Content extracted for: ${originalname} (proxy upload)`);
            } else {
              console.error(`❌ Content extraction failed for: ${originalname} (proxy upload)`);
            }
          })
          .catch(error => {
            console.error(`❌ Content extraction error for ${originalname}:`, error);
          });

        console.info(JSON.stringify({
          evt: "upload-proxy.finalized",
          uid,
          docId,
          analysisQueued
        }));
        
        return res.status(200).json({ 
          ok: true, 
          objectPath, 
          docId, 
          contentType: mimetype, 
          size 
        });
      } catch (err: any) {
        console.error("upload-proxy failed", { err: err.message, stack: err.stack });
        return res.status(500).json({ error: "proxy upload failed" });
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
      
      // Get document from database
      const document = await storage.getDocumentById(documentId);
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
      console.error("Error retrieving document:", error);
      if (error instanceof ObjectNotFoundError) {
        return res.status(404).json({ error: "Document not found" });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Serve documents - protected with authentication and rate limiting
  app.get("/objects/:objectPath(*)", verifyFirebaseToken, moderateLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error retrieving document:", error);
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
      console.error("Error generating upload URL:", error);
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
      const currentUserId = req.user?.uid;
      if (!currentUserId) {
        return res.status(401).json({ error: "User authentication required for document processing" });
      }

      // Get document with folder and tags
      const documentWithDetails = await storage.getDocumentById(document.id);
      
      // Trigger background content extraction with proper automation pipeline
      storage.extractDocumentContent(document.id)
        .then(async (success) => {
          if (success) {
            console.log(`✅ Content extracted for: ${document.name}`);
            
            // 🚀 AUTO-QUEUE AI ANALYSIS: Only after content extraction succeeds
            try {
              await storage.enqueueDocumentForAnalysis(document.id, currentUserId, 5); // Normal priority
              console.log(`🔍 Auto-queued AI analysis for: ${document.name} (triggered by content extraction)`);
            } catch (analysisError) {
              console.warn(`Failed to auto-queue AI analysis for ${document.name}:`, analysisError);
            }
          } else {
            console.error(`Content extraction failed for document: ${document.name}`);
          }
        })
        .catch(error => {
          console.error(`Content extraction error for document ${document.name}:`, error);
        });
      
      res.status(201).json(documentWithDetails);
    } catch (error) {
      console.error("Error creating document:", error);
      res.status(500).json({ error: "Failed to create document" });
    }
  });

  // OLD upload-proxy route removed - now handled earlier before JSON parsing

  // Standard upload route - handles single file uploads with multipart data
  app.post("/api/documents/upload", verifyFirebaseToken, upload.single('file'), async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.uid;
      console.log(`📤 Upload request for uid: ${userId}`);
      
      if (!userId) {
        return res.status(401).json({ error: "User authentication required" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "No file provided" });
      }

      const originalFileName = req.file.originalname;
      const docId = randomUUID();
      const canonicalPath = generateDocumentPath(userId, docId, originalFileName);
      
      // Upload to GCS via server
      await objectStorageService.uploadFileBuffer(
        req.file.buffer, 
        canonicalPath, 
        req.file.mimetype
      );
      
      const determinedFileType = getFileTypeFromMimeType(req.file.mimetype, originalFileName);
      console.log(`✅ Upload success - File: ${originalFileName}, MIME: ${req.file.mimetype}`);
      
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
      console.error(`❌ Upload failed:`, error);
      res.status(500).json({ error: "Upload failed" });
    }
  });

  app.post("/api/documents/bulk-upload-urls", verifyFirebaseToken, bulkUploadLimiter, async (req: AuthenticatedRequest, res) => {
    const userId = req.user?.uid;
    
    try {
      // Verify userId is present first
      if (!userId) {
        return res.status(200).json({ results: [] }); // Non-blocking response
      }
      
      // Never 500 the entire batch. Return per-file results even if one fails.
      const files = z.array(z.object({
        name: z.string(),
        size: z.number().optional(),
        mimeType: z.string().optional()
      })).parse(req.body?.files ?? []);

      // ENTRY log – batch sign
      console.info(JSON.stringify({
        evt: "bulk_sign.entry",
        route: "/api/documents/bulk-upload-urls",
        reqId: (req as any).reqId,
        uid: userId,
        files: files.map(f => ({ name: f.name, mimeType: f.mimeType, size: f.size }))
      }));

      console.log(`📦 Processing bulk upload for ${files.length} files in bucket: ${process.env.GCS_BUCKET_NAME || 'development-bucket'}`);
      
      const results = await Promise.all(files.map(async (f) => {
        try {
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
          
          console.info("sign", { objectPath, contentType });
          return { 
            ok: true, 
            url, 
            method: "PUT", 
            headers: { "Content-Type": contentType }, 
            objectPath, 
            name: f.name 
          };
        } catch (e: any) {
          console.error("sign-failed", { name: f.name, err: e?.message, stack: e?.stack });
          return { 
            ok: false, 
            name: f.name, 
            reason: e?.message || "sign failed" 
          };
        }
      }));

      // EXIT log – batch sign (per-file result, sanitized)
      console.info(JSON.stringify({
        evt: "bulk_sign.success",
        reqId: (req as any).reqId,
        uid: userId,
        status: 200,
        results: results.map(r => ({
          name: r.name,
          ok: r.ok,
          objectPath: r.ok ? obfuscatePath(r.objectPath) : undefined,
          reason: r.ok ? undefined : r.reason
        }))
      }));

      return res.status(200).json({ results });
      
    } catch (err: any) {
      console.error("bulk-upload-urls failed", {
        userId,
        files: (req.body?.files||[]).map((f: any) => ({ name:f?.name, mimeType:f?.mimeType, size:f?.size })),
        err: err?.message, 
        stack: err?.stack
      });
      // Note: even on exception, return 200 with ok:false per file so the client can retry individually without blocking the user.
      return res.status(200).json({ 
        results: (req.body?.files||[]).map((f: any) => ({ ok:false, name:f?.name, reason:"route error" })) 
      });
    }
  });

  // Bulk document creation - the grand finale of your upload symphony! 🎼
  app.post("/api/documents/bulk", verifyFirebaseToken, bulkUploadLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      // Validate bulk document creation request
      const validationResult = bulkDocumentCreationSchema.safeParse(req.body);
      if (!validationResult.success) {
        // Log validation details for debugging
        console.error("🚨 Bulk upload validation failed:", JSON.stringify(validationResult.error.issues, null, 2));
        
        // Surface rejected fileType values in logs for easier debugging
        validationResult.error.issues.forEach(issue => {
          if (issue.path.includes('fileType')) {
            console.error(`❌ FileType rejection: received "${issue.received}", expected one of: ${issue.options?.join(', ')}`);
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

      // ENTRY log – batch finalize
      console.info(JSON.stringify({
        evt: "finalize.entry",
        route: "/api/documents/bulk",
        reqId: (req as any).reqId,
        uid: userId,
        count: documentsData?.length
      }));

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
            .then(success => {
              if (success) {
              } else {
                console.error("Content extraction failed for bulk document");
              }
            })
            .catch(error => {
              console.error("Content extraction error for bulk document:", error);
            });

          return { success: true, document, originalName: docData.originalName };
        } catch (error) {
          console.error(`Error creating document ${docData.originalName}:`, error);
          return { success: false, originalName: docData.originalName, error: error instanceof Error ? error.message : String(error) };
        }
      });

      // Wait for all documents to be processed
      const results = await Promise.all(documentPromises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);


      // Get queue status for user feedback
      const queueStatus = await storage.getQueueStatus(userId);
      
      // Extract created document IDs for logging
      const createdDocIds = successful.map(r => r.document?.id).filter(Boolean);
      
      // EXIT log – batch finalize
      console.info(JSON.stringify({
        evt: "finalize.success",
        reqId: (req as any).reqId,
        uid: userId,
        status: 201,
        createdDocIds
      }));

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
      console.error("Error in bulk document creation:", error);
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
      
      // Debug logging for search requests
      if (search) {
        console.log(`🔍 Simple search request: "${search}" (fileType: ${fileType}, folderId: ${folderId}, tagId: ${tagId})`);
      }
      
      const filters = {
        search,
        fileType,
        folderId,
        tagId,
        page,
        limit,
      };

      const documents = await storage.getDocuments(filters);
      const total = await storage.getDocumentsCount(filters);
      
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
      console.error("Error fetching documents:", error);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  });

  // Get trashed documents (only show trashed items)
  app.get("/api/documents/trash", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const trashedDocuments = await storage.getTrashedDocuments();
      res.json({ documents: trashedDocuments });
    } catch (error) {
      console.error("Error fetching trashed documents:", error);
      res.status(500).json({ error: "Failed to fetch trashed documents" });
    }
  });

  // Delete all active documents (move all to trash)
  app.delete("/api/documents/all", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const { DatabaseStorage } = await import("./storage");
      const storage = new DatabaseStorage();
      
      // Get ALL active documents (ignoring any filters)
      const allActiveDocuments = await storage.getAllActiveDocuments();
      
      // Delete each document (move to trash)
      let deletedCount = 0;
      for (const document of allActiveDocuments) {
        const success = await storage.deleteDocument(document.id);
        if (success) deletedCount++;
      }

      res.json({ 
        success: true, 
        deletedCount,
        message: `Successfully moved ${deletedCount} documents to trash`
      });
    } catch (error) {
      console.error("Error deleting all documents:", error);
      res.status(500).json({ error: "Failed to delete all documents" });
    }
  });

  // Empty trash - permanently delete all trashed documents
  app.delete("/api/documents/trash", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const result = await storage.emptyTrash();
      res.json({ 
        success: true,
        message: `Successfully deleted ${result.deletedCount} documents permanently`,
        deletedCount: result.deletedCount
      });
    } catch (error) {
      console.error("Error emptying trash:", error);
      res.status(500).json({ error: "Failed to empty trash" });
    }
  });

  // 🔧 GCS Path Reconciler - fixes path mismatches between DB and GCS
  app.post("/api/admin/reconcile-gcs-paths", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const { dryRun = true } = req.body;
      
      console.log(`🔧 Starting GCS reconciliation (dryRun: ${dryRun})`);
      const result = await storage.reconcileGCSPaths(dryRun);
      
      res.json({
        success: true,
        result,
        message: dryRun 
          ? "Dry run completed. Review results and call with dryRun=false to apply changes."
          : "Reconciliation completed successfully!"
      });
    } catch (error) {
      console.error("Error during GCS reconciliation:", error);
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
      console.error("Error fetching trash config:", error);
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
      console.error("Error in conversational search:", error);
      res.status(500).json({ 
        error: "Failed to perform conversational search",
        message: "Our AI assistant seems to be taking a coffee break! ☕ Please try again in a moment."
      });
    }
  });

  // New AI-powered search endpoint with enhanced scoring
  app.post("/api/search", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
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
      console.error("Error in AI search:", error);
      res.status(500).json({ 
        error: "Failed to perform AI search",
        message: "AI search service is temporarily unavailable. Please try again."
      });
    }
  });

  // Get document content on-demand
  app.get("/api/documents/:id/content", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const content = await storage.getDocumentContent(id);
      
      if (content === null) {
        res.status(404).json({ error: "Document not found or has no content" });
        return;
      }
      
      res.json({ content });
    } catch (error) {
      console.error("Error fetching document content:", error);
      res.status(500).json({ error: "Failed to fetch document content" });
    }
  });

  // Get document by ID
  app.get("/api/documents/:id", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const document = await storage.getDocumentById(req.params.id);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }
      res.json(document);
    } catch (error) {
      console.error("Error fetching document:", error);
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
      console.error("Error fetching queue status:", error);
      res.status(500).json({ 
        error: "Failed to fetch queue status",
        funnyMessage: "Our status dashboard seems to be having a coffee break! ☕ Please try again!"
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

      console.log(`Starting bulk embedding generation for user: ${userId}`);
      
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
      console.error("Error in bulk embedding generation:", error);
      res.status(500).json({
        error: "Failed to enqueue documents for embedding generation",
        funnyMessage: "Our embedding queue seems to be having technical difficulties! 🤖💭 Please try again!"
      });
    }
  });

  // Update document
  app.put("/api/documents/:id", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const { name, folderId, isFavorite, tagIds } = req.body;
      
      const document = await storage.updateDocument(req.params.id, {
        name,
        folderId,
        isFavorite,
      });

      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Update tags if provided
      if (tagIds !== undefined) {
        await storage.removeDocumentTags(document.id);
        if (Array.isArray(tagIds)) {
          for (const tagId of tagIds) {
            await storage.addDocumentTag({ documentId: document.id, tagId });
          }
        }
      }

      const updatedDocument = await storage.getDocumentById(document.id);
      res.json(updatedDocument);
    } catch (error) {
      console.error("Error updating document:", error);
      res.status(500).json({ error: "Failed to update document" });
    }
  });

  // Update document classification
  app.patch("/api/documents/:id/classification", verifyFirebaseToken, moderateLimiter, async (req: AuthenticatedRequest, res) => {
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
      const document = await storage.getDocumentById(documentId);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }
      
      // Update document with user override classifications
      const updatedDocument = await storage.updateDocument(documentId, {
        overrideCategory: category,
        overrideDocumentType: documentType,
        classificationOverridden: true
      });
      
      if (!updatedDocument) {
        return res.status(500).json({ error: "Failed to update document classification" });
      }
      
      // Reorganize document into the correct folder based on new classification
      const organizeSuccess = await storage.organizeDocumentIntoFolder(documentId, category, documentType);
      if (!organizeSuccess) {
        console.warn(`Failed to reorganize document ${documentId} into folder for category: ${category}, type: ${documentType}`);
        // Don't fail the request, as the classification was still updated
      }
      
      // Return the updated document with folder information
      const finalDocument = await storage.getDocumentById(documentId);
      res.json(finalDocument);
      
    } catch (error) {
      console.error("Error updating document classification:", error);
      res.status(500).json({ error: "Failed to update document classification" });
    }
  });

  // Delete document
  app.delete("/api/documents/:id", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const deleted = await storage.deleteDocument(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Document not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting document:", error);
      res.status(500).json({ error: "Failed to delete document" });
    }
  });

  // Restore document from trash
  app.patch("/api/documents/:id/restore", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const result = await storage.restoreDocument(req.params.id);
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
      console.error("Error restoring document:", error);
      res.status(500).json({ error: "Failed to restore document" });
    }
  });

  // AI Analysis endpoint
  app.post("/api/documents/:id/analyze", verifyFirebaseToken, strictLimiter, async (req: AuthenticatedRequest, res) => {
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
        console.error("AI analysis failed: API key not configured");
        return res.status(503).json({ error: "AI analysis unavailable - API key not configured" });
      }
      
      // Check if document exists
      const document = await storage.getDocumentById(documentId);
      if (!document) {
        console.error("AI analysis failed: Document not found");
        return res.status(404).json({ error: "Document not found" });
      }

      // Check if document was recently analyzed (prevent spam)
      if (document.aiAnalyzedAt) {
        const timeSinceLastAnalysis = Date.now() - new Date(document.aiAnalyzedAt).getTime();
        const oneMinute = 60 * 1000; // 1 minute in milliseconds
        if (timeSinceLastAnalysis < oneMinute) {
          console.error("AI analysis failed: Rate limited");
          return res.status(429).json({ 
            error: "Document was recently analyzed. Please wait before analyzing again.",
            retryAfter: Math.ceil((oneMinute - timeSinceLastAnalysis) / 1000)
          });
        }
      }

      // Handle Drive vs uploaded documents differently
      let success = false;
      
      if (document.driveFileId) {
        // For Drive documents, try to get the Drive access token but don't require it
        const driveAccessToken = req.headers['x-drive-access-token'] as string;
        
        try {
          // Pass the Drive access token if available, otherwise try without it
          success = await storage.analyzeDocumentWithAI(documentId, undefined, driveAccessToken);
        } catch (error) {
          console.error("AI analysis failed for Drive document:", error);
          success = false;
        }
      } else {
        // For uploaded documents, analyze normally
        try {
          success = await storage.analyzeDocumentWithAI(documentId);
        } catch (aiError) {
          console.error("AI analysis failed for uploaded file:", aiError);
          success = false;
        }
      }
      
      if (!success) {
        console.error("AI analysis completion failed");
        return res.status(500).json({ error: "Failed to analyze document with AI" });
      }

      // Return updated document with AI analysis
      const updatedDocument = await storage.getDocumentById(documentId);
      res.json({
        success: true,
        message: "Document analyzed successfully",
        document: updatedDocument
      });
    } catch (error) {
      console.error("AI analysis exception:", error);
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
        const driveAccessToken = req.headers['x-drive-access-token'] as string;
        
        if (!driveAccessToken) {
          return res.status(403).json({ 
            error: "Google Drive access token required",
            message: "Please provide Drive access token in x-drive-access-token header",
            code: "DRIVE_TOKEN_REQUIRED"
          });
        }
        
        try {
          // Extract with Drive authentication
          success = await storage.extractDocumentContent(documentId, driveAccessToken);
          
        } catch (driveError) {
          console.error("Drive authentication failed:", driveError);
          return res.status(403).json({ 
            error: "Failed to authenticate with Google Drive",
            message: "Please re-authenticate with Google Drive",
            code: "DRIVE_AUTH_FAILED"
          });
        }
      } else {
        // Regular uploaded document
        success = await storage.extractDocumentContent(documentId);
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
      console.error("Error extracting document content:", error);
      res.status(500).json({ error: "Failed to extract document content" });
    }
  });

  // Batch content extraction endpoint
  app.post("/api/documents/batch-extract-content", verifyFirebaseToken, moderateLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      
      // Get documents without extracted content
      const documentsWithoutContent = await storage.getDocumentsWithoutContent();
      
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
            console.error(`Error processing document ${doc.id}:`, error);
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
        console.error("Batch content extraction error:", error);
      });
      
    } catch (error) {
      console.error("Error in batch content extraction:", error);
      res.status(500).json({ error: "Failed to start batch content extraction" });
    }
  });

  // PDF-specific AI analysis endpoint - Ensure PDFs get properly analyzed
  app.post("/api/documents/analyze-pdfs", verifyFirebaseToken, strictLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      
      // Get all PDF documents that need analysis
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
            console.error("Error processing PDF document:", error);
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
        console.error("PDF analysis error:", error);
      });

    } catch (error) {
      console.error("PDF analysis failed:", error);
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
                console.error("Error analyzing document:", error);
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
        console.error("Bulk AI analysis error:", error);
      });

    } catch (error) {
      console.error("Bulk AI analysis failed:", error);
      res.status(500).json({ error: "Failed to start bulk AI analysis" });
    }
  });

  // Document Versioning endpoints
  
  // Get document with all versions
  app.get("/api/documents/:id/versions", async (req, res) => {
    try {
      const documentWithVersions = await storage.getDocumentWithVersions(req.params.id);
      if (!documentWithVersions) {
        return res.status(404).json({ error: "Document not found" });
      }
      res.json(documentWithVersions);
    } catch (error) {
      console.error("Error fetching document versions:", error);
      res.status(500).json({ error: "Failed to fetch document versions" });
    }
  });

  // Create new version
  app.post("/api/documents/:id/versions", async (req, res) => {
    try {
      const { uploadURL, changeDescription, uploadedBy = "system" } = req.body;
      
      if (!uploadURL) {
        return res.status(400).json({ error: "Upload URL is required" });
      }

      // Get existing document to get file info
      const document = await storage.getDocumentById(req.params.id);
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
      const version = await storage.createDocumentVersion(validatedData);
      
      res.status(201).json(version);
    } catch (error) {
      console.error("Error creating document version:", error);
      
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
  app.put("/api/documents/:id/versions/:versionId/activate", async (req, res) => {
    try {
      const activated = await storage.setActiveVersion(req.params.id, req.params.versionId);
      if (!activated) {
        return res.status(404).json({ error: "Document or version not found" });
      }
      res.json({ message: "Version activated successfully" });
    } catch (error) {
      console.error("Error activating version:", error);
      
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
  app.delete("/api/documents/:id/versions/:versionId", async (req, res) => {
    try {
      const deleted = await storage.deleteDocumentVersion(req.params.id, req.params.versionId);
      if (!deleted) {
        return res.status(404).json({ error: "Version not found or doesn't belong to this document" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting version:", error);
      
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
      console.log("🗂️ Starting Smart Organization for all unorganized documents...");
      const result = await storage.organizeAllUnorganizedDocuments();
      
      console.log(`✅ Smart Organization complete: ${result.organized} organized, ${result.errors.length} errors`);
      
      res.json({
        success: true,
        message: `Successfully organized ${result.organized} documents into smart folders`,
        organized: result.organized,
        errors: result.errors
      });
    } catch (error) {
      console.error("Error in Smart Organization:", error);
      res.status(500).json({ 
        success: false,
        error: "Failed to organize documents",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Folders endpoints
  app.get("/api/folders", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const folders = await storage.getFolders();
      res.json(folders);
    } catch (error) {
      console.error("Error fetching folders:", error);
      res.status(500).json({ error: "Failed to fetch folders" });
    }
  });

  app.post("/api/folders", async (req, res) => {
    try {
      const validatedData = insertFolderSchema.parse(req.body);
      const folder = await storage.createFolder(validatedData);
      res.status(201).json(folder);
    } catch (error) {
      console.error("Error creating folder:", error);
      res.status(500).json({ error: "Failed to create folder" });
    }
  });

  app.put("/api/folders/:id", async (req, res) => {
    try {
      const folder = await storage.updateFolder(req.params.id, req.body);
      if (!folder) {
        return res.status(404).json({ error: "Folder not found" });
      }
      res.json(folder);
    } catch (error) {
      console.error("Error updating folder:", error);
      res.status(500).json({ error: "Failed to update folder" });
    }
  });

  app.delete("/api/folders/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteFolder(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Folder not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting folder:", error);
      res.status(500).json({ error: "Failed to delete folder" });
    }
  });

  // Tags endpoints
  app.get("/api/tags", async (req, res) => {
    try {
      const tags = await storage.getTags();
      res.json(tags);
    } catch (error) {
      console.error("Error fetching tags:", error);
      res.status(500).json({ error: "Failed to fetch tags" });
    }
  });

  app.post("/api/tags", async (req, res) => {
    try {
      const validatedData = insertTagSchema.parse(req.body);
      const tag = await storage.createTag(validatedData);
      res.status(201).json(tag);
    } catch (error) {
      console.error("Error creating tag:", error);
      res.status(500).json({ error: "Failed to create tag" });
    }
  });

  app.put("/api/tags/:id", async (req, res) => {
    try {
      const tag = await storage.updateTag(req.params.id, req.body);
      if (!tag) {
        return res.status(404).json({ error: "Tag not found" });
      }
      res.json(tag);
    } catch (error) {
      console.error("Error updating tag:", error);
      res.status(500).json({ error: "Failed to update tag" });
    }
  });

  app.delete("/api/tags/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteTag(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Tag not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting tag:", error);
      res.status(500).json({ error: "Failed to delete tag" });
    }
  });

  // Document-Tags endpoints
  app.post("/api/document-tags", async (req, res) => {
    try {
      const validatedData = insertDocumentTagSchema.parse(req.body);
      const documentTag = await storage.addDocumentTag(validatedData);
      res.status(201).json(documentTag);
    } catch (error) {
      console.error("Error adding tag to document:", error);
      res.status(500).json({ error: "Failed to add tag to document" });
    }
  });

  app.delete("/api/document-tags/:documentId/:tagId", async (req, res) => {
    try {
      const { documentId, tagId } = req.params;
      await storage.removeDocumentTag(documentId, tagId);
      res.status(204).send();
    } catch (error) {
      console.error("Error removing tag from document:", error);
      res.status(500).json({ error: "Failed to remove tag from document" });
    }
  });

  // Google Drive Integration endpoints
  
  // Verify Drive connection and get status
  app.get("/api/drive/connect", verifyFirebaseToken, requireDriveAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const driveService = (req as any).driveService as DriveService;
      
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
      console.error("Error checking Drive connection:", error);
      res.status(500).json({ error: "Failed to check Drive connection" });
    }
  });

  // List documents from Google Drive
  app.get("/api/drive/documents", moderateLimiter, verifyFirebaseToken, requireDriveAccess, async (req: AuthenticatedRequest, res) => {
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
      console.error("Error listing Drive documents:", error);
      res.status(500).json({ error: "Failed to list Drive documents" });
    }
  });

  // Sync Drive document to local system
  app.post("/api/drive/sync", strictLimiter, verifyFirebaseToken, requireDriveAccess, async (req: AuthenticatedRequest, res) => {
    try {
      // Validate request body
      const validatedBody = driveSyncSchema.parse(req.body);
      const { driveFileId, folderId, runAiAnalysis } = validatedBody;

      const driveService = (req as any).driveService as DriveService;
      
      // Get file content from Drive
      const driveFile = await driveService.getFileContent(driveFileId);
      if (!driveFile) {
        return res.status(404).json({ error: "Drive file not found or cannot be accessed" });
      }

      // Check if document already exists in our system
      const existingDocument = await storage.getDocumentByDriveFileId(driveFileId);
      if (existingDocument) {
        // Update existing document sync status
        const updatedDocument = await storage.updateDocument(existingDocument.id, {
          driveSyncStatus: "synced",
          driveSyncedAt: new Date(),
        });
        
        return res.json({
          message: "Document already synced",
          document: updatedDocument || existingDocument,
          isNew: false
        });
      }

      // Create new document from Drive file
      const documentData = {
        name: driveFile.name,
        originalName: driveFile.name,
        filePath: `drive:${driveFile.id}`, // Use Drive file ID as path identifier
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
      };

      const validatedData = insertDocumentSchema.parse(documentData);
      const document = await storage.createDocument(validatedData);

      // Run AI analysis if requested
      if (runAiAnalysis) {
        try {
          // Determine if this file type supports direct text export
          const textExportableMimeTypes = [
            'application/vnd.google-apps.document',
            'text/plain', 
            'text/csv', 
            'text/html'
          ];
          
          const isTextExportable = textExportableMimeTypes.includes(driveFile.mimeType);
          const driveAccessToken = req.headers['x-drive-access-token'] as string;
          
          if (isTextExportable && driveFile.content && !driveFile.content.startsWith('[Binary file:')) {
            // For Google Docs and text files, use the exported content directly
            await storage.analyzeDocumentWithAI(document.id, driveFile.content, driveAccessToken);
          } else {
            // For binary files (PDFs, Word docs, etc.), let storage handle binary download and extraction
            await storage.analyzeDocumentWithAI(document.id, undefined, driveAccessToken);
          }
        } catch (aiError) {
          console.error("AI analysis failed, but continuing without analysis:", aiError);
          // Don't let AI analysis errors crash the document sync
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
      console.error("Error syncing Drive document:", error);
      res.status(500).json({ error: "Failed to sync Drive document" });
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

  const httpServer = createServer(app);
  return httpServer;
}

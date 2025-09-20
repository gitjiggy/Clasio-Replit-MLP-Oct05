import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";
import { verifyFirebaseToken, optionalAuth, AuthenticatedRequest } from "./auth";
import { DriveService } from "./driveService";
import multer from "multer";
import path from "path";
import { insertDocumentSchema, insertDocumentVersionSchema, insertFolderSchema, insertTagSchema, documentVersions, documents } from "@shared/schema";
import { sql, eq } from "drizzle-orm";
import { db } from "./db.js";
import { z } from "zod";
import { google } from 'googleapis';

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

  // Serve documents
  app.get("/objects/:objectPath(*)", async (req, res) => {
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

  // Get upload URL
  app.post("/api/documents/upload-url", async (req, res) => {
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error generating upload URL:", error);
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  });

  // Complete document upload
  app.post("/api/documents", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const { uploadURL, name, originalName, fileSize, fileType, mimeType, folderId, tagIds } = req.body;
      
      if (!uploadURL || !name || !originalName || !fileSize || !fileType || !mimeType) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Normalize the object path
      const filePath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      // Create document record
      console.log(`🔍 UPLOAD DEBUG: Received folderId="${folderId}" (type: ${typeof folderId})`);
      const normalizedFolderId = folderId && folderId !== "all" ? folderId : null;
      console.log(`🔍 UPLOAD DEBUG: Normalized folderId="${normalizedFolderId}" (type: ${typeof normalizedFolderId})`);
      
      const documentData = {
        name,
        originalName,
        filePath,
        fileSize: parseInt(fileSize),
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

      // Get document with folder and tags
      const documentWithDetails = await storage.getDocumentById(document.id);
      
      // Trigger background content extraction (don't wait for it)
      storage.extractDocumentContent(document.id)
        .then(success => {
          if (success) {
            console.log(`✅ Content extraction completed for document: ${document.id}`);
          } else {
            console.error(`❌ Content extraction failed for document: ${document.id}`);
          }
        })
        .catch(error => {
          console.error(`💥 Content extraction error for document ${document.id}:`, error);
        });
      
      res.status(201).json(documentWithDetails);
    } catch (error) {
      console.error("Error creating document:", error);
      res.status(500).json({ error: "Failed to create document" });
    }
  });

  // Get all documents with filters
  app.get("/api/documents", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const { search, fileType, folderId, tagId, page = 1, limit = 12 } = req.query;
      
      const filters = {
        search: search as string,
        fileType: fileType as string,
        folderId: folderId as string,
        tagId: tagId as string,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
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

  // AI Analysis endpoint
  app.post("/api/documents/:id/analyze", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const documentId = req.params.id;
      console.log(`📋 AI Analysis request for document: ${documentId}`);
      
      // Check if API key is configured
      if (!process.env.GEMINI_API_KEY) {
        console.error(`❌ AI analysis failed: API key not configured (doc: ${documentId})`);
        return res.status(503).json({ error: "AI analysis unavailable - API key not configured" });
      }
      
      // Check if document exists
      const document = await storage.getDocumentById(documentId);
      if (!document) {
        console.error(`❌ AI analysis failed: Document not found (doc: ${documentId})`);
        return res.status(404).json({ error: "Document not found" });
      }

      // Check if document was recently analyzed (prevent spam)
      if (document.aiAnalyzedAt) {
        const timeSinceLastAnalysis = Date.now() - new Date(document.aiAnalyzedAt).getTime();
        const oneMinute = 60 * 1000; // 1 minute in milliseconds
        if (timeSinceLastAnalysis < oneMinute) {
          console.error(`❌ AI analysis failed: Rate limited (doc: ${documentId})`);
          return res.status(429).json({ 
            error: "Document was recently analyzed. Please wait before analyzing again.",
            retryAfter: Math.ceil((oneMinute - timeSinceLastAnalysis) / 1000)
          });
        }
      }

      // Handle Drive vs uploaded documents differently
      let success = false;
      
      if (document.driveFileId) {
        console.log(`🔗 Document is from Google Drive (ID: ${document.driveFileId})`);
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
        console.log(`📄 Document is uploaded file (not from Drive)`);
        // For uploaded documents, analyze normally
        try {
          success = await storage.analyzeDocumentWithAI(documentId);
          console.log(`✅ AI analysis completed for uploaded document: ${success}`);
        } catch (aiError) {
          console.error("❌ AI analysis failed for uploaded file:", aiError);
          success = false;
        }
      }
      
      if (!success) {
        console.error(`❌ AI analysis completion failed (doc: ${documentId}, status: 500)`);
        return res.status(500).json({ error: "Failed to analyze document with AI" });
      }

      // Return updated document with AI analysis
      const updatedDocument = await storage.getDocumentById(documentId);
      console.log(`✅ AI analysis completed successfully (doc: ${documentId}, status: 200, branch: ${document.driveFileId ? 'drive' : 'uploaded'})`);
      res.json({
        success: true,
        message: "Document analyzed successfully",
        document: updatedDocument
      });
    } catch (error) {
      console.error(`❌ AI analysis exception (doc: ${documentId}, status: 500):`, error);
      res.status(500).json({ error: "Failed to analyze document" });
    }
  });

  // Content extraction endpoint for single document
  app.post("/api/documents/:id/extract-content", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
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
        console.log(`📄 Extracting content from Drive document: ${document.name}`);
        
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
  app.post("/api/documents/batch-extract-content", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      console.log("🚀 Starting batch content extraction...");
      
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

      console.log(`📄 Found ${documentsWithoutContent.length} documents needing content extraction`);

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
        console.log(`✅ Batch content extraction completed: ${successful}/${processed} successful`);
      }).catch((error) => {
        console.error("❌ Batch content extraction error:", error);
      });
      
    } catch (error) {
      console.error("Error in batch content extraction:", error);
      res.status(500).json({ error: "Failed to start batch content extraction" });
    }
  });

  // PDF-specific AI analysis endpoint - Ensure PDFs get properly analyzed
  app.post("/api/documents/analyze-pdfs", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      console.log("🚀 Starting PDF-specific AI analysis...");
      
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

      console.log(`🎯 Found ${pdfDocuments.length} PDFs needing analysis`);

      let processed = 0;
      let successful = 0;
      let needsExtraction = 0;

      // Process PDFs in batches
      const batchPromise = async () => {
        for (const doc of pdfDocuments) {
          try {
            console.log(`📄 Processing PDF: ${doc.name} (${doc.id})`);
            
            // Check if document has extracted content
            if (!doc.contentExtracted) {
              console.log(`⚠️ PDF ${doc.name} needs content extraction first`);
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
              console.log(`✅ Successfully analyzed PDF: ${doc.name}`);
            } else {
              console.log(`⚠️ Failed to analyze PDF: ${doc.name}`);
            }
            
            processed++;
            
          } catch (error) {
            console.error(`❌ Error processing PDF ${doc.name}:`, error);
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
        console.log(`✅ PDF analysis completed: ${successful}/${processed} successful, ${needsExtraction} need content extraction`);
        console.log(`🎯 PDFs should now have proper AI classification in folders`);
      }).catch((error) => {
        console.error("❌ PDF analysis error:", error);
      });

    } catch (error) {
      console.error("❌ PDF analysis failed:", error);
      res.status(500).json({ error: "Failed to start PDF analysis" });
    }
  });

  // Bulk AI analysis endpoint - Re-analyze documents with improved classification
  app.post("/api/documents/bulk-ai-analysis", verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      console.log("🚀 Starting bulk AI analysis with improved classification rules...");
      
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

      console.log(`🎯 Found ${documentsForAnalysis.length} documents needing AI re-analysis`);

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
                console.log(`🔍 Analyzing document: ${doc.name} (${doc.id})`);
                
                let success = false;
                if (doc.driveFileId) {
                  // Drive document - need user's access token for authentication
                  console.log(`📄 Skipping Drive document ${doc.name} (requires user interaction)`);
                  processed++;
                  return { id: doc.id, success: false, reason: "drive_auth_required" };
                } else {
                  // Uploaded document
                  success = await storage.analyzeDocumentWithAI(doc.id);
                }
                
                if (success) {
                  successful++;
                  console.log(`✅ Successfully analyzed: ${doc.name}`);
                } else {
                  console.log(`⚠️ Failed to analyze: ${doc.name}`);
                }
                
                return { id: doc.id, success };
              } catch (error) {
                console.error(`❌ Error analyzing document ${doc.name}:`, error);
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
        console.log(`✅ Bulk AI analysis completed: ${successful}/${processed} successful`);
        console.log(`🎯 Tax documents should now be properly classified as "Taxes/Tax Document"`);
      }).catch((error) => {
        console.error("❌ Bulk AI analysis error:", error);
      });

    } catch (error) {
      console.error("❌ Bulk AI analysis failed:", error);
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
  app.get("/api/drive/documents", verifyFirebaseToken, requireDriveAccess, async (req: AuthenticatedRequest, res) => {
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
  app.post("/api/drive/sync", verifyFirebaseToken, requireDriveAccess, async (req: AuthenticatedRequest, res) => {
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
        fileType: getFileTypeFromMimeType(driveFile.mimeType),
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

      // Store Drive content for AI analysis
      if (runAiAnalysis && driveFile.content && driveFile.content !== `[Binary file: ${driveFile.name}]`) {
        // Run AI analysis on the existing document with Drive content
        try {
          await storage.analyzeDocumentWithAI(document.id, driveFile.content);
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
  function getFileTypeFromMimeType(mimeType: string): string {
    const mimeTypeMap: { [key: string]: string } = {
      'application/pdf': 'pdf',
      'application/vnd.google-apps.document': 'document',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
      'application/msword': 'document',
      'text/plain': 'text',
      'text/csv': 'spreadsheet',
      'application/rtf': 'document',
      'text/html': 'text'
    };
    
    return mimeTypeMap[mimeType] || 'other';
  }

  const httpServer = createServer(app);
  return httpServer;
}

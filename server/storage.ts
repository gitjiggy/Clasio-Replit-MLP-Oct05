import {
  type Document,
  type Folder,
  type Tag,
  type DocumentTag,
  type DocumentVersion,
  type DocumentAccessLog,
  type AiAnalysisQueue,
  type DailyApiUsage,
  type InsertDocument,
  type InsertFolder,
  type InsertTag,
  type InsertDocumentTag,
  type InsertDocumentVersion,
  type InsertDocumentAccessLog,
  type InsertAiAnalysisQueue,
  type InsertDailyApiUsage,
  type DocumentWithFolderAndTags,
  type DocumentWithVersions,
  documents,
  folders,
  tags,
  documentTags,
  documentVersions,
  documentAccessLog,
  aiAnalysisQueue,
  dailyApiUsage,
} from "@shared/schema";
import { ObjectStorageService } from "./objectStorage";
import { randomUUID } from "crypto";
import { db } from "./db";
import { eq, and, desc, ilike, inArray, count, sql, or, isNotNull } from "drizzle-orm";
import { 
  processConversationalQuery, 
  generateConversationalResponse, 
  analyzeDocumentRelevance,
  calculateCosineSimilarity, 
  isAmbiguousQuery, 
  generateEmbedding, 
  parseEmbeddingFromJSON, 
  serializeEmbeddingToJSON 
} from "./gemini.js";

// Utility function to get configurable trash retention period
export function getTrashRetentionDays(): number {
  const envValue = process.env.TRASH_RETENTION_DAYS;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (isNaN(parsed) || parsed < 1) {
      console.warn(`⚠️ Invalid TRASH_RETENTION_DAYS value: ${envValue}. Using default 7 days.`);
      return 7;
    }
    return parsed;
  }
  return 7; // Default to 7 days
}

// Query embedding cache for performance optimization
interface QueryEmbeddingCache {
  [query: string]: {
    embedding: number[];
    timestamp: number;
  };
}

// Simple LRU cache for query embeddings to eliminate API calls during search
class QueryEmbeddingCacheManager {
  private cache: QueryEmbeddingCache = {};
  private readonly maxEntries = 100; // Cache up to 100 recent queries
  private readonly ttlMs = 24 * 60 * 60 * 1000; // 24 hour TTL

  getCachedEmbedding(query: string): number[] | null {
    const normalized = query.trim().toLowerCase();
    const entry = this.cache[normalized];
    
    if (!entry) return null;
    
    // Check if entry is expired
    if (Date.now() - entry.timestamp > this.ttlMs) {
      delete this.cache[normalized];
      return null;
    }
    
    // Update timestamp for true LRU behavior (move to front)
    entry.timestamp = Date.now();
    
    return entry.embedding;
  }

  setCachedEmbedding(query: string, embedding: number[]): void {
    const normalized = query.trim().toLowerCase();
    
    // If cache is full, remove oldest entries
    const entries = Object.entries(this.cache);
    if (entries.length >= this.maxEntries) {
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = Math.floor(this.maxEntries * 0.2); // Remove 20%
      for (let i = 0; i < toRemove; i++) {
        delete this.cache[entries[i][0]];
      }
    }
    
    this.cache[normalized] = {
      embedding,
      timestamp: Date.now()
    };
  }

  clearExpiredEntries(): void {
    const now = Date.now();
    for (const [query, entry] of Object.entries(this.cache)) {
      if (now - entry.timestamp > this.ttlMs) {
        delete this.cache[query];
      }
    }
  }
}

// Predefined main categories for automatic organization
const MAIN_CATEGORIES = [
  "Taxes", "Medical", "Insurance", "Legal", "Immigration", 
  "Financial", "Employment", "Education", "Real Estate", 
  "Travel", "Personal", "Business"
] as const;

type MainCategory = typeof MAIN_CATEGORIES[number];

// Extended types for API responses
type FolderWithCounts = Folder & { documentCount: number };

export interface DocumentFilters {
  search?: string;
  fileType?: string;
  folderId?: string;
  tagId?: string;
  page: number;
  limit: number;
  includeContent?: boolean; // Flag to include document content
}

export interface IStorage {
  // Documents
  createDocument(document: InsertDocument): Promise<Document>;
  getDocuments(filters: DocumentFilters): Promise<DocumentWithFolderAndTags[]>;
  getAllActiveDocuments(): Promise<DocumentWithFolderAndTags[]>;
  getTrashedDocuments(): Promise<DocumentWithFolderAndTags[]>;
  emptyTrash(): Promise<{ deletedCount: number }>;
  purgeExpiredTrashedDocuments(): Promise<{ deletedCount: number }>;
  getDocumentsCount(filters: DocumentFilters): Promise<number>;
  getDocumentById(id: string): Promise<DocumentWithFolderAndTags | undefined>;
  getDocumentContent(id: string): Promise<string | null>; // Get just the content for a document
  getDocumentByDriveFileId(driveFileId: string): Promise<DocumentWithFolderAndTags | undefined>;
  getDocumentWithVersions(id: string): Promise<DocumentWithVersions | undefined>;
  updateDocument(id: string, updates: Partial<InsertDocument>): Promise<Document | undefined>;
  deleteDocument(id: string): Promise<boolean>;
  restoreDocument(id: string): Promise<boolean>;
  analyzeDocumentWithAI(id: string, driveContent?: string, driveAccessToken?: string): Promise<boolean>;
  extractDocumentContent(id: string, driveAccessToken?: string): Promise<boolean>;
  getDocumentsWithoutContent(): Promise<Document[]>;

  // Document Versions
  createDocumentVersion(version: InsertDocumentVersion): Promise<DocumentVersion>;
  getDocumentVersions(documentId: string): Promise<DocumentVersion[]>;
  setActiveVersion(documentId: string, versionId: string): Promise<boolean>;
  deleteDocumentVersion(documentId: string, versionId: string): Promise<boolean>;

  // Folders
  createFolder(folder: InsertFolder): Promise<Folder>;
  getFolders(): Promise<(Folder & { documentCount: number })[]>;
  updateFolder(id: string, updates: Partial<InsertFolder>): Promise<Folder | undefined>;
  deleteFolder(id: string): Promise<boolean>;

  // Tags
  createTag(tag: InsertTag): Promise<Tag>;
  getTags(): Promise<Tag[]>;
  updateTag(id: string, updates: Partial<InsertTag>): Promise<Tag | undefined>;
  deleteTag(id: string): Promise<boolean>;

  // Document Tags
  addDocumentTag(documentTag: InsertDocumentTag): Promise<DocumentTag>;
  removeDocumentTag(documentId: string, tagId: string): Promise<void>;
  
  // Automatic Folder Organization
  findOrCreateCategoryFolder(category: string): Promise<Folder>;
  findOrCreateSubFolder(parentId: string, documentType: string): Promise<Folder>;
  organizeDocumentIntoFolder(documentId: string, category: string, documentType: string): Promise<boolean>;
  removeDocumentTags(documentId: string): Promise<void>;

  // AI Analysis Queue Management
  enqueueDocumentForAnalysis(documentId: string, userId: string, priority?: number): Promise<AiAnalysisQueue>;
  enqueueDocumentForEmbedding(documentId: string, userId: string, priority?: number): Promise<AiAnalysisQueue>;
  bulkEnqueueDocumentsForEmbedding(userId: string, priority?: number): Promise<{queued: number; skipped: number; errors: string[]}>;
  dequeueNextAnalysisJob(): Promise<AiAnalysisQueue | null>;
  updateQueueJobStatus(jobId: string, status: string, failureReason?: string): Promise<boolean>;
  getQueueStatus(userId?: string): Promise<{pending: number; processing: number; completed: number; failed: number}>;
  getQueueJobsByUser(userId: string): Promise<AiAnalysisQueue[]>;
  
  // Daily API Usage Tracking  
  incrementDailyUsage(date: string, tokens: number, success: boolean): Promise<DailyApiUsage>;
  getDailyUsage(date: string): Promise<DailyApiUsage | null>;
  canProcessAnalysis(): Promise<{canProcess: boolean; remaining: number; resetTime: string}>;
  
  // Enhanced conversational search using AI metadata
  searchConversational(query: string, filters?: Partial<Omit<DocumentFilters, 'search'>>, userId?: string): Promise<{
    documents: DocumentWithFolderAndTags[];
    relevantDocuments: DocumentWithFolderAndTags[];
    relatedDocuments: DocumentWithFolderAndTags[];
    response: string;
    intent: string;
    keywords: string[];
  }>;

  // Hybrid FTS + Limited Semantic Search for optimal performance
  searchFTSPlusSemanticOptimized(query: string, filters?: Partial<Omit<DocumentFilters, 'search'>>, userId?: string): Promise<{
    documents: DocumentWithFolderAndTags[];
    relevantDocuments: DocumentWithFolderAndTags[];
    relatedDocuments: DocumentWithFolderAndTags[];
    response: string;
    intent: string;
    keywords: string[];
    timing?: { total: number; fts: number; semantic: number };
  }>;
}

export class DatabaseStorage implements IStorage {
  private isInitialized = false;
  private queryEmbeddingCache = new QueryEmbeddingCacheManager();

  private async ensureInitialized() {
    if (!this.isInitialized) {
      await this.initializeDefaults();
      this.isInitialized = true;
      
      // Start periodic cache cleanup (every hour)
      setInterval(() => {
        this.queryEmbeddingCache.clearExpiredEntries();
      }, 60 * 60 * 1000);
    }
  }

  private async initializeDefaults() {
    try {
      // Check if we have any folders, if not create defaults
      const existingFolders = await db.select().from(folders);
      if (existingFolders.length === 0) {
        const defaultFolders = [
          { name: "Contracts", color: "#f59e0b" },
          { name: "Reports", color: "#3b82f6" },
          { name: "Invoices", color: "#10b981" },
          { name: "Legal Documents", color: "#8b5cf6" },
        ];
        
        await db.insert(folders).values(defaultFolders);
      }

      // Check if we have any tags, if not create defaults
      const existingTags = await db.select().from(tags);
      if (existingTags.length === 0) {
        const defaultTags = [
          { name: "Taxes", color: "#ef4444" },
          { name: "Medical", color: "#10b981" },
          { name: "Insurance", color: "#3b82f6" },
          { name: "Legal", color: "#8b5cf6" },
          { name: "Immigration", color: "#f59e0b" },
          { name: "Financial", color: "#06b6d4" },
          { name: "Important", color: "#dc2626" },
          { name: "Pending", color: "#f97316" },
        ];
        
        await db.insert(tags).values(defaultTags);
      }
    } catch (error) {
    }
  }

  // Documents
  async createDocument(insertDocument: InsertDocument): Promise<Document> {
    await this.ensureInitialized();
    return await db.transaction(async (tx) => {
      const [document] = await tx
        .insert(documents)
        .values({
          ...insertDocument,
          folderId: insertDocument.folderId || null,
          isFavorite: insertDocument.isFavorite ?? false,
          isDeleted: insertDocument.isDeleted ?? false,
        })
        .returning();

      // Create initial version (version 1) as active within the same transaction
      // Ensure required fields are not null for documentVersions table
      if (!document.filePath || document.fileSize === null || document.fileSize === undefined) {
        throw new Error("Document must have filePath and fileSize to create initial version");
      }
      
      await tx.insert(documentVersions).values({
        documentId: document.id,
        version: 1,
        filePath: document.filePath,
        fileSize: document.fileSize,
        fileType: document.fileType,
        mimeType: document.mimeType,
        uploadedBy: "system",
        changeDescription: "Initial version",
        isActive: true,
      });

      return document;
    });
  }

  async getDocuments(filters: DocumentFilters): Promise<DocumentWithFolderAndTags[]> {
    await this.ensureInitialized();
    
    // Apply filters - exclude deleted and trashed documents by default
    const conditions = [
      eq(documents.isDeleted, false), // Backward compatibility
      eq(documents.status, 'active')   // New trash system - only show active documents
    ];

    if (filters.search) {
      // Search in document name, content, and tag names
      const nameCondition = ilike(documents.name, `%${filters.search}%`);
      const contentCondition = and(
        isNotNull(documents.documentContent),
        ilike(documents.documentContent, `%${filters.search}%`)
      );
      
      // Search in tag names by finding documents that have tags matching the search
      const tagSearchSubquery = db
        .select({ documentId: documentTags.documentId })
        .from(documentTags)
        .innerJoin(tags, eq(documentTags.tagId, tags.id))
        .where(ilike(tags.name, `%${filters.search}%`));
      
      const tagCondition = inArray(documents.id, tagSearchSubquery);
      
      // Combine all search conditions
      const searchConditions = [nameCondition];
      if (contentCondition) {
        searchConditions.push(contentCondition);
      }
      searchConditions.push(tagCondition);
      
      conditions.push(or(...searchConditions)!);
    }

    if (filters.fileType && filters.fileType !== 'all') {
      conditions.push(eq(documents.fileType, filters.fileType));
    }

    if (filters.folderId && filters.folderId !== 'all') {
      conditions.push(eq(documents.folderId, filters.folderId));
    }

    if (filters.tagId) {
      const docsWithTag = await db
        .select({ documentId: documentTags.documentId })
        .from(documentTags)
        .where(eq(documentTags.tagId, filters.tagId));
      
      const docIds = docsWithTag.map(dt => dt.documentId);
      if (docIds.length > 0) {
        conditions.push(inArray(documents.id, docIds));
      } else {
        // No documents with this tag
        return [];
      }
    }

    // Select only necessary fields, exclude documentContent by default for performance
    const documentSelect = filters.includeContent ? documents : {
      id: documents.id,
      name: documents.name,
      originalName: documents.originalName,
      filePath: documents.filePath,
      objectPath: documents.objectPath, // GCS path for deletions
      fileSize: documents.fileSize,
      fileType: documents.fileType,
      mimeType: documents.mimeType,
      folderId: documents.folderId,
      uploadedAt: documents.uploadedAt,
      isFavorite: documents.isFavorite,
      isDeleted: documents.isDeleted,
      // Trash system fields
      status: documents.status,
      deletedAt: documents.deletedAt,
      driveFileId: documents.driveFileId,
      driveWebViewLink: documents.driveWebViewLink,
      isFromDrive: documents.isFromDrive,
      driveLastModified: documents.driveLastModified,
      driveSyncStatus: documents.driveSyncStatus,
      driveSyncedAt: documents.driveSyncedAt,
      aiSummary: documents.aiSummary,
      aiKeyTopics: documents.aiKeyTopics,
      aiDocumentType: documents.aiDocumentType,
      aiCategory: documents.aiCategory,
      aiSentiment: documents.aiSentiment,
      aiWordCount: documents.aiWordCount,
      aiAnalyzedAt: documents.aiAnalyzedAt,
      aiConciseName: documents.aiConciseName,
      aiCategoryConfidence: documents.aiCategoryConfidence,
      aiDocumentTypeConfidence: documents.aiDocumentTypeConfidence,
      overrideCategory: documents.overrideCategory,
      overrideDocumentType: documents.overrideDocumentType,
      classificationOverridden: documents.classificationOverridden,
      // Exclude documentContent for performance
      documentContent: sql<string | null>`NULL`.as('documentContent'),
      contentExtracted: documents.contentExtracted,
      contentExtractedAt: documents.contentExtractedAt,
      // Embedding fields (exclude from default queries for performance)
      titleEmbedding: sql<string | null>`NULL`.as('titleEmbedding'),
      contentEmbedding: sql<string | null>`NULL`.as('contentEmbedding'),
      summaryEmbedding: sql<string | null>`NULL`.as('summaryEmbedding'),
      keyTopicsEmbedding: sql<string | null>`NULL`.as('keyTopicsEmbedding'),
      embeddingsGenerated: documents.embeddingsGenerated,
      embeddingsGeneratedAt: documents.embeddingsGeneratedAt,
    };

    const results = await db
      .select({
        document: documentSelect,
        folder: folders,
      })
      .from(documents)
      .leftJoin(folders, eq(documents.folderId, folders.id))
      .where(and(...conditions))
      .orderBy(desc(documents.uploadedAt))
      .limit(filters.limit)
      .offset((filters.page - 1) * filters.limit);


    // Get tags and version information for each document
    const docsWithTags = await Promise.all(
      results.map(async (result) => {
        const docTags = await db
          .select({ tag: tags })
          .from(documentTags)
          .leftJoin(tags, eq(documentTags.tagId, tags.id))
          .where(eq(documentTags.documentId, result.document.id));

        // Get version information
        const currentVersionInfo = await db
          .select({
            version: documentVersions.version,
          })
          .from(documentVersions)
          .where(and(
            eq(documentVersions.documentId, result.document.id),
            eq(documentVersions.isActive, true)
          ))
          .limit(1);

        const totalVersions = await db
          .select({ count: count() })
          .from(documentVersions)
          .where(eq(documentVersions.documentId, result.document.id));

        return {
          ...result.document,
          folder: result.folder || undefined,
          tags: docTags.map(dt => dt.tag).filter(Boolean) as Tag[],
          currentVersionNumber: currentVersionInfo[0]?.version || 1,
          versionCount: totalVersions[0]?.count || 1,
        };
      })
    );

    return docsWithTags;
  }

  async getAllActiveDocuments(): Promise<DocumentWithFolderAndTags[]> {
    await this.ensureInitialized();
    
    // Get ALL active documents using simple query to avoid relational issues
    const docs = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.isDeleted, false),
          eq(documents.status, 'active')
        )
      )
      .orderBy(desc(documents.uploadedAt));

    // For each document, fetch folder and tags separately 
    const result = await Promise.all(
      docs.map(async (doc) => {
        // Get folder
        const folder = doc.folderId 
          ? await db.query.folders.findFirst({
              where: eq(folders.id, doc.folderId)
            })
          : undefined;

        // Get tags
        const docTags = await db.query.documentTags.findMany({
          where: eq(documentTags.documentId, doc.id),
          with: { tag: true }
        });

        return {
          ...doc,
          folder,
          tags: docTags.map(dt => dt.tag)
        };
      })
    );

    return result as DocumentWithFolderAndTags[];
  }

  async getTrashedDocuments(): Promise<DocumentWithFolderAndTags[]> {
    await this.ensureInitialized();
    
    // Get only documents that are trashed (status='trashed')
    const results = await db
      .select({
        document: {
          id: documents.id,
          name: documents.name,
          originalName: documents.originalName,
          filePath: documents.filePath,
          objectPath: documents.objectPath,
          fileSize: documents.fileSize,
          fileType: documents.fileType,
          mimeType: documents.mimeType,
          folderId: documents.folderId,
          uploadedAt: documents.uploadedAt,
          isFavorite: documents.isFavorite,
          isDeleted: documents.isDeleted,
          status: documents.status,
          deletedAt: documents.deletedAt,
          // Include other fields needed for display but exclude heavy content
          aiSummary: documents.aiSummary,
          aiKeyTopics: documents.aiKeyTopics,
          aiDocumentType: documents.aiDocumentType,
          aiCategory: documents.aiCategory,
        },
        folder: folders,
      })
      .from(documents)
      .leftJoin(folders, eq(documents.folderId, folders.id))
      .where(eq(documents.status, 'trashed'))
      .orderBy(desc(documents.deletedAt)); // Show most recently deleted first

    // Get tags for each trashed document
    const docsWithTags = await Promise.all(
      results.map(async (result) => {
        const docTags = await db
          .select({ tag: tags })
          .from(documentTags)
          .leftJoin(tags, eq(documentTags.tagId, tags.id))
          .where(eq(documentTags.documentId, result.document.id));

        return {
          ...result.document,
          folder: result.folder || undefined,
          tags: docTags.map(dt => dt.tag).filter(Boolean) as Tag[],
        };
      })
    );

    return docsWithTags;
  }

  async emptyTrash(): Promise<{ deletedCount: number }> {
    await this.ensureInitialized();
    
    // Get all trashed documents with their file paths for deletion
    const trashedDocs = await db
      .select({ 
        id: documents.id,
        objectPath: documents.objectPath,
        filePath: documents.filePath // Fallback for older documents
      })
      .from(documents)
      .where(eq(documents.status, 'trashed'));
    
    const deletedCount = trashedDocs.length;
    
    if (deletedCount === 0) {
      return { deletedCount: 0 };
    }
    
    // Delete actual files from GCS first
    const objectStorageService = new ObjectStorageService();
    const fileDeletionErrors: string[] = [];
    
    for (const doc of trashedDocs) {
      try {
        // Use objectPath if available (canonical), otherwise fall back to filePath
        const pathToDelete = doc.objectPath || doc.filePath;
        if (pathToDelete) {
          await objectStorageService.deleteObject(pathToDelete);
          console.log(`✅ File deleted from GCS: ${pathToDelete}`);
        }
      } catch (gcsError: any) {
        console.error(`❌ Failed to delete file from GCS for document ${doc.id}:`, gcsError);
        fileDeletionErrors.push(`Document ${doc.id}: ${gcsError.message}`);
        // Continue deleting other files - don't fail the entire operation
      }
    }
    
    // Get all document versions for these trashed documents to delete their files too
    const trashedVersions = await db
      .select({ filePath: documentVersions.filePath })
      .from(documentVersions)
      .where(inArray(documentVersions.documentId, trashedDocs.map(d => d.id)));
    
    // Delete version files from GCS
    for (const version of trashedVersions) {
      if (version.filePath) {
        try {
          await objectStorageService.deleteObject(version.filePath);
          console.log(`✅ Version file deleted from GCS: ${version.filePath}`);
        } catch (gcsError: any) {
          console.error(`❌ Failed to delete version file from GCS:`, gcsError);
          fileDeletionErrors.push(`Version file ${version.filePath}: ${gcsError.message}`);
          // Continue - don't fail the entire operation
        }
      }
    }
    
    // Permanently delete all trashed documents and their associated data from database
    await db.transaction(async (tx) => {
      // Delete document tags
      await tx
        .delete(documentTags)
        .where(inArray(documentTags.documentId, trashedDocs.map(d => d.id)));
      
      // Delete document versions
      await tx
        .delete(documentVersions)
        .where(inArray(documentVersions.documentId, trashedDocs.map(d => d.id)));
      
      // Delete the documents themselves
      await tx
        .delete(documents)
        .where(eq(documents.status, 'trashed'));
    });
    
    if (fileDeletionErrors.length > 0) {
      console.warn(`🗑️ Empty Trash completed with some file deletion errors:`, fileDeletionErrors);
    }
    
    console.log(`🗑️ Empty Trash: Permanently deleted ${deletedCount} documents, their files, and database records`);
    
    return { deletedCount };
  }

  async purgeExpiredTrashedDocuments(): Promise<{ deletedCount: number }> {
    await this.ensureInitialized();
    
    // Calculate retention threshold timestamp using configurable period
    const retentionDays = getTrashRetentionDays();
    const retentionThreshold = new Date();
    retentionThreshold.setDate(retentionThreshold.getDate() - retentionDays);
    
    // Get all trashed documents older than retention period with their file paths
    const expiredTrashedDocs = await db
      .select({ 
        id: documents.id,
        objectPath: documents.objectPath,
        filePath: documents.filePath, // Fallback for older documents
        deletedAt: documents.deletedAt
      })
      .from(documents)
      .where(
        and(
          eq(documents.status, 'trashed'),
          sql`${documents.deletedAt} <= ${retentionThreshold.toISOString()}`
        )
      );
    
    const deletedCount = expiredTrashedDocs.length;
    
    if (deletedCount === 0) {
      console.log(`🕐 Auto-cleanup: No expired trashed documents found (older than ${retentionDays} days)`);
      return { deletedCount: 0 };
    }
    
    console.log(`🕐 Auto-cleanup: Found ${deletedCount} expired trashed documents to purge (older than ${retentionDays} days)`);
    
    // Delete actual files from GCS first (same logic as emptyTrash but for expired items only)
    const objectStorageService = new ObjectStorageService();
    const fileDeletionErrors: string[] = [];
    
    for (const doc of expiredTrashedDocs) {
      try {
        // Use objectPath if available (canonical), otherwise fall back to filePath
        const pathToDelete = doc.objectPath || doc.filePath;
        if (pathToDelete) {
          await objectStorageService.deleteObject(pathToDelete);
          console.log(`✅ Auto-cleanup: File deleted from GCS: ${pathToDelete}`);
        }
      } catch (gcsError: any) {
        console.error(`❌ Auto-cleanup: Failed to delete file from GCS for document ${doc.id}:`, gcsError);
        fileDeletionErrors.push(`Document ${doc.id}: ${gcsError.message}`);
        // Continue deleting other files - don't fail the entire operation
      }
    }
    
    // Get all document versions for these expired trashed documents to delete their files too
    const expiredVersions = await db
      .select({ filePath: documentVersions.filePath })
      .from(documentVersions)
      .where(inArray(documentVersions.documentId, expiredTrashedDocs.map(d => d.id)));
    
    // Delete version files from GCS
    for (const version of expiredVersions) {
      if (version.filePath) {
        try {
          await objectStorageService.deleteObject(version.filePath);
          console.log(`✅ Auto-cleanup: Version file deleted from GCS: ${version.filePath}`);
        } catch (gcsError: any) {
          console.error(`❌ Auto-cleanup: Failed to delete version file from GCS:`, gcsError);
          fileDeletionErrors.push(`Version file ${version.filePath}: ${gcsError.message}`);
          // Continue - don't fail the entire operation
        }
      }
    }
    
    // Permanently delete all expired trashed documents and their associated data from database
    await db.transaction(async (tx) => {
      // Delete document tags
      await tx
        .delete(documentTags)
        .where(inArray(documentTags.documentId, expiredTrashedDocs.map(d => d.id)));
      
      // Delete document versions
      await tx
        .delete(documentVersions)
        .where(inArray(documentVersions.documentId, expiredTrashedDocs.map(d => d.id)));
      
      // Delete the expired trashed documents themselves
      await tx
        .delete(documents)
        .where(
          and(
            eq(documents.status, 'trashed'),
            sql`${documents.deletedAt} <= ${retentionThreshold.toISOString()}`
          )
        );
    });
    
    if (fileDeletionErrors.length > 0) {
      console.warn(`🕐 Auto-cleanup completed with some file deletion errors:`, fileDeletionErrors);
    }
    
    console.log(`🕐 Auto-cleanup: Successfully purged ${deletedCount} expired documents, their files, and database records`);
    
    return { deletedCount };
  }

  // Smart fallback for extracting keywords from conversational queries
  private extractKeywordsFromConversationalQuery(query: string) {
    const lowerQuery = query.toLowerCase();
    
    // Common conversational patterns and keyword extraction
    const patterns = [
      // "do I have any documents with the term X?"
      /(?:do\s+i\s+have|are\s+there).*?(?:documents?|files?).*?(?:with\s+the\s+term|containing|about)\s+["']?([^"'?\s]+)["']?/i,
      // "find documents containing X"
      /(?:find|search|show|get).*?(?:documents?|files?).*?(?:containing|with|about)\s+["']?([^"'?\s]+)["']?/i,
      // "documents about X" or "files with X"
      /(?:documents?|files?).*?(?:about|with|containing)\s+["']?([^"'?\s]+)["']?/i,
      // Extract quoted terms
      /["']([^"']+)["']/g,
      // Extract terms after "term", "keyword", "word"
      /(?:term|keyword|word)\s+["']?([^"'?\s]+)["']?/i
    ];
    
    const extractedKeywords: string[] = [];
    
    // Try each pattern
    for (const pattern of patterns) {
      const matches = lowerQuery.match(pattern);
      if (matches) {
        // Add captured groups (excluding the full match)
        for (let i = 1; i < matches.length; i++) {
          if (matches[i] && matches[i].length > 2) {
            extractedKeywords.push(matches[i].trim());
          }
        }
      }
    }
    
    // If no patterns matched, extract meaningful words (excluding common stop words)
    if (extractedKeywords.length === 0) {
      const stopWords = new Set(['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'among', 'any', 'some', 'all', 'each', 'few', 'more', 'most', 'other', 'such', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'can', 'will', 'just', 'should', 'now', 'document', 'documents', 'file', 'files', 'have', 'find', 'search', 'show', 'get', 'containing', 'with', 'about', 'term']);
      
      const words = lowerQuery.split(/\s+/).filter(word => 
        word.length > 2 && 
        !stopWords.has(word) && 
        !/^[?!.,;:()]+$/.test(word)
      );
      extractedKeywords.push(...words);
    }
    
    console.log(`Extracted keywords from "${query}":`, extractedKeywords);
    
    return {
      intent: "conversational_search",
      keywords: extractedKeywords,
      semanticQuery: query.toLowerCase(),
      categoryFilter: undefined,
      documentTypeFilter: undefined
    };
  }

  // Calculate confidence score for document match
  private calculateConfidenceScore(doc: any, keywords: string[]): number {
    let score = 0;
    const maxScore = 100;
    
    for (const keyword of keywords) {
      const lowerKeyword = keyword.toLowerCase();
      
      // Title matches (highest weight: 25 points per keyword)
      if (doc.name?.toLowerCase().includes(lowerKeyword) || doc.originalName?.toLowerCase().includes(lowerKeyword)) {
        score += 25;
      }
      
      // AI Key Topics matches (high weight: 20 points per keyword)
      if (doc.aiKeyTopics && Array.isArray(doc.aiKeyTopics)) {
        const topicsMatch = doc.aiKeyTopics.some((topic: string) => 
          topic.toLowerCase().includes(lowerKeyword)
        );
        if (topicsMatch) score += 20;
      }
      
      // AI Summary matches (medium weight: 15 points per keyword)
      if (doc.aiSummary?.toLowerCase().includes(lowerKeyword)) {
        score += 15;
      }
      
      // Document content matches (medium weight: 10 points per keyword)
      if (doc.documentContent?.toLowerCase().includes(lowerKeyword)) {
        score += 10;
      }
      
      // AI Category/Type matches (lower weight: 8 points per keyword)
      if (doc.aiCategory?.toLowerCase().includes(lowerKeyword) || 
          doc.aiDocumentType?.toLowerCase().includes(lowerKeyword) ||
          doc.overrideCategory?.toLowerCase().includes(lowerKeyword) ||
          doc.overrideDocumentType?.toLowerCase().includes(lowerKeyword)) {
        score += 8;
      }
      
      // AI Concise Name matches (lower weight: 5 points per keyword)
      if (doc.aiConciseName?.toLowerCase().includes(lowerKeyword)) {
        score += 5;
      }
    }
    
    // Cap at maximum score and convert to percentage
    return Math.min(score, maxScore);
  }

  // NEW 3-Stage Scoring System Helper Functions
  
  private preFilterCandidates(allDocuments: any[], query: string): any[] {
    // GENERALIZED RECALL-FIRST PRE-FILTER
    // Goal: Maximize candidates for scoring using cheap, domain-agnostic signals
    
    const KMIN = parseInt(process.env.PREFILTER_K_MIN || '10');
    const KMAX = parseInt(process.env.PREFILTER_K_MAX || '100');
    
    // Clean query tokens (remove stopwords, normalize)
    const queryTokens = this.normalizeQueryTokens(query);
    console.log(`Pre-filter query tokens: [${queryTokens.join(', ')}]`);
    
    // Score each document using cheap, domain-agnostic signals
    const scoredCandidates = allDocuments
      .filter(doc => !doc.isDeleted && doc.name) // Only exclude deleted/empty docs
      .map(doc => ({
        ...doc,
        preScore: this.calculateCheapPreScore(doc, queryTokens)
      }))
      .filter(doc => doc.preScore > 0) // Include any document with matching signals
      .sort((a, b) => b.preScore - a.preScore);
    
    console.log(`Pre-filter: Found ${scoredCandidates.length} candidates with signal matches`);
    
    // Adaptive widening: ensure minimum candidate pool
    let finalCandidates = scoredCandidates;
    if (finalCandidates.length < KMIN) {
      console.log(`Widening candidate pool: ${finalCandidates.length} < ${KMIN} minimum`);
      
      // Add favorites and recent docs until we hit KMIN
      const additionalCandidates = allDocuments
        .filter(doc => !doc.isDeleted && doc.name)
        .filter(doc => !finalCandidates.some(candidate => candidate.id === doc.id))
        .sort((a, b) => {
          // Prioritize: favorites first, then recent uploads, then those with embeddings
          if (a.isFavorite !== b.isFavorite) return b.isFavorite ? 1 : -1;
          if (a.embeddingsGenerated !== b.embeddingsGenerated) return b.embeddingsGenerated ? 1 : -1;
          return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
        })
        .slice(0, KMIN - finalCandidates.length)
        .map(doc => ({ ...doc, preScore: 0.1 })); // Small baseline score
      
      finalCandidates = [...finalCandidates, ...additionalCandidates];
      console.log(`Widened to ${finalCandidates.length} candidates (added ${additionalCandidates.length})`);
    }
    
    // Cap at maximum to prevent performance issues
    const cappedCandidates = finalCandidates.slice(0, KMAX);
    console.log(`Pre-filter result: ${cappedCandidates.length} candidates (capped at ${KMAX})`);
    
    return cappedCandidates;
  }
  
  // Simplified domain-agnostic helpers (kept for backward compatibility)
  private titleSummaryContainsKeywords(doc: any, query: string): boolean {
    const queryTokens = this.normalizeQueryTokens(query);
    return this.calculateCheapPreScore(doc, queryTokens) > 0;
  }

  private documentTypeMatches(documentType: string | null, query: string): boolean {
    if (!documentType) return false;
    const queryTokens = this.normalizeQueryTokens(query);
    const docTypeLower = documentType.toLowerCase();
    return queryTokens.some(token => docTypeLower.includes(token));
  }
  
  private normalizeQueryTokens(query: string): string[] {
    // Remove stopwords and normalize tokens for domain-agnostic matching
    const stopWords = new Set(['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'my', 'your', 'their', 'his', 'her', 'its', 'where', 'what', 'when', 'who', 'how', 'why', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'document']);
    
    return query.toLowerCase()
      .split(/\s+/)
      .filter(token => token.length > 2 && !stopWords.has(token))
      .map(token => token.replace(/[^a-z0-9]/g, '')) // Remove punctuation
      .filter(token => token.length > 1);
  }

  private calculateCheapPreScore(doc: any, queryTokens: string[]): number {
    if (queryTokens.length === 0) return 0;
    
    let score = 0;
    
    // Signal 1: Title/name overlap (weight: 3)
    const titleText = `${doc.name || ''} ${doc.originalName || ''} ${doc.aiConciseName || ''}`.toLowerCase();
    const titleMatches = queryTokens.filter(token => titleText.includes(token)).length;
    score += titleMatches * 3;
    
    // Signal 2: AI key topics overlap (weight: 2) 
    if (doc.aiKeyTopics && Array.isArray(doc.aiKeyTopics)) {
      const topicsText = doc.aiKeyTopics.join(' ').toLowerCase();
      const topicMatches = queryTokens.filter(token => topicsText.includes(token)).length;
      score += topicMatches * 2;
    }
    
    // Signal 3: AI summary overlap (weight: 1)
    if (doc.aiSummary) {
      const summaryText = doc.aiSummary.toLowerCase();
      const summaryMatches = queryTokens.filter(token => summaryText.includes(token)).length;
      score += summaryMatches * 1;
    }
    
    // Signal 4: Category/Document type direct containment (weight: 1)
    const metaText = `${doc.aiCategory || ''} ${doc.aiDocumentType || ''}`.toLowerCase();
    const metaMatches = queryTokens.filter(token => metaText.includes(token)).length;
    score += metaMatches * 1;
    
    return score;
  }
  
  private calculateOptimizedSemanticScore(doc: any, queryEmbedding: number[], originalQuery: string): number {
    // Check if document has any embeddings generated
    const hasEmbeddings = doc.titleEmbedding || doc.summaryEmbedding || doc.contentEmbedding || doc.keyTopicsEmbedding;
    
    if (!hasEmbeddings) {
      console.log(`No embeddings available for "${doc.name}", using lexical fallback scoring`);
      // Fallback to lexical similarity when embeddings are missing
      return this.calculateQueryAwareLexicalScore(doc, originalQuery);
    }
    
    // Early exit strategy - don't calculate all fields unnecessarily
    const titleEmb = parseEmbeddingFromJSON(doc.titleEmbedding);
    const titleScore = titleEmb ? calculateCosineSimilarity(queryEmbedding, titleEmb) * 1.2 : 0; // Boost titles
    
    if (titleScore > 0.7) {
      console.log(`High title match (${titleScore.toFixed(3)}), skipping other calculations`);
      return titleScore;
    }

    const summaryEmb = parseEmbeddingFromJSON(doc.summaryEmbedding);
    const summaryScore = summaryEmb ? calculateCosineSimilarity(queryEmbedding, summaryEmb) : 0;
    
    if (summaryScore > 0.6) {
      console.log(`Good summary match (${summaryScore.toFixed(3)}), skipping content`);
      return Math.max(titleScore, summaryScore);
    }

    // Only calculate content for borderline cases
    const contentEmb = parseEmbeddingFromJSON(doc.contentEmbedding);
    const contentScore = contentEmb ? calculateCosineSimilarity(queryEmbedding, contentEmb) : 0;
    
    const keyTopicsEmb = parseEmbeddingFromJSON(doc.keyTopicsEmbedding);
    const keyTopicsScore = keyTopicsEmb ? calculateCosineSimilarity(queryEmbedding, keyTopicsEmb) : 0;
    
    const maxScore = Math.max(titleScore, summaryScore, contentScore, keyTopicsScore);
    console.log(`Full calculation: title=${titleScore.toFixed(3)}, summary=${summaryScore.toFixed(3)}, content=${contentScore.toFixed(3)}, topics=${keyTopicsScore.toFixed(3)}, max=${maxScore.toFixed(3)}`);
    
    return maxScore;
  }

  private calculateQueryAwareLexicalScore(doc: any, query: string): number {
    // Query-aware lexical similarity for documents without embeddings
    const queryTokens = this.normalizeQueryTokens(query);
    if (queryTokens.length === 0) {
      console.log(`Empty query tokens, returning base score: 0.25`);
      return 0.25;
    }
    
    // Get document text fields
    const title = (doc.name || '').toLowerCase();
    const summary = (doc.aiSummary || '').toLowerCase();  
    const topics = Array.isArray(doc.aiKeyTopics) ? doc.aiKeyTopics.join(' ').toLowerCase() : '';
    const content = (doc.documentContent || '').toLowerCase();
    
    // Calculate term overlap scores
    let score = 0;
    let maxPossibleScore = queryTokens.length * 4; // Max score if all terms found in all fields
    
    for (const token of queryTokens) {
      const tokenLower = token.toLowerCase();
      
      // Title match (highest weight: 4 points)
      if (title.includes(tokenLower)) {
        score += 4;
      }
      // Summary match (high weight: 3 points) 
      if (summary.includes(tokenLower)) {
        score += 3;
      }
      // Topics match (medium weight: 2 points)
      if (topics.includes(tokenLower)) {
        score += 2;
      }
      // Content match (lower weight: 1 point)
      if (content.includes(tokenLower)) {
        score += 1;
      }
    }
    
    // Normalize to 0-1 range
    const normalizedScore = maxPossibleScore > 0 ? score / maxPossibleScore : 0;
    
    // Apply metadata quality bonus (but don't let it dominate)
    let qualityBonus = 0;
    if (summary && topics) {
      qualityBonus = 0.15; // Good metadata bonus
    } else if (summary || topics) {
      qualityBonus = 0.08; // Basic metadata bonus
    }
    
    const finalScore = Math.min(normalizedScore + qualityBonus, 1.0);
    
    console.log(`Lexical fallback for "${doc.name}": query="${query}", tokens=[${queryTokens.join(',')}], score=${score}/${maxPossibleScore}, normalized=${normalizedScore.toFixed(3)}, quality_bonus=${qualityBonus.toFixed(3)}, final=${finalScore.toFixed(3)}`);
    
    return finalScore;
  }

  private async calculateSemanticScore(doc: any, queryEmbedding: number[]): Promise<number> {
    // Use maximum field scoring instead of weighted averages to prevent dilution of strong signals
    const fieldScores: number[] = [];
    
    console.log(`    Semantic debug for "${doc.name}": using maximum field scoring`);
    
    // Title embedding (with slight boost)
    if (doc.titleEmbedding) {
      const titleEmb = parseEmbeddingFromJSON(doc.titleEmbedding);
      if (titleEmb) {
        const similarity = calculateCosineSimilarity(queryEmbedding, titleEmb);
        const titleScore = similarity * 0.9; // Slight boost for titles
        console.log(`      Title cosine similarity: ${similarity.toFixed(4)} → boosted to ${titleScore.toFixed(4)}`);
        fieldScores.push(titleScore);
      } else {
        console.log(`      Title embedding parsing failed`);
      }
    } else {
      console.log(`      No title embedding`);
    }
    
    // Key topics embedding
    if (doc.keyTopicsEmbedding) {
      const keyTopicsEmb = parseEmbeddingFromJSON(doc.keyTopicsEmbedding);
      if (keyTopicsEmb) {
        const similarity = calculateCosineSimilarity(queryEmbedding, keyTopicsEmb);
        console.log(`      Key topics cosine similarity: ${similarity.toFixed(4)}`);
        fieldScores.push(similarity);
      } else {
        console.log(`      Key topics embedding parsing failed`);
      }
    } else {
      console.log(`      No key topics embedding`);
    }
    
    // Summary embedding  
    if (doc.summaryEmbedding) {
      const summaryEmb = parseEmbeddingFromJSON(doc.summaryEmbedding);
      if (summaryEmb) {
        const similarity = calculateCosineSimilarity(queryEmbedding, summaryEmb);
        console.log(`      Summary cosine similarity: ${similarity.toFixed(4)}`);
        fieldScores.push(similarity);
      } else {
        console.log(`      Summary embedding parsing failed`);
      }
    } else {
      console.log(`      No summary embedding`);
    }
    
    // Content embedding
    if (doc.contentEmbedding) {
      const contentEmb = parseEmbeddingFromJSON(doc.contentEmbedding);
      if (contentEmb) {
        const similarity = calculateCosineSimilarity(queryEmbedding, contentEmb);
        console.log(`      Content cosine similarity: ${similarity.toFixed(4)}`);
        fieldScores.push(similarity);
      } else {
        console.log(`      Content embedding parsing failed`);
      }
    } else {
      console.log(`      No content embedding`);
    }
    
    // Use the maximum score across all fields (let strongest field dominate)
    const maxSemanticScore = fieldScores.length > 0 ? Math.max(...fieldScores) : 0;
    console.log(`      → Maximum field score: ${maxSemanticScore.toFixed(4)} (strongest field wins)`);
    return maxSemanticScore;
  }
  
  private calculateTieredScore(semanticScore: number, lexicalScore: number, qualityScore: number): number {
    // Convert all scores to 0-1 scale first
    const semantic = semanticScore;
    const lexical = lexicalScore; 
    const quality = qualityScore;
    
    console.log(`    Tiered scoring: semantic=${semantic.toFixed(3)}, lexical=${lexical.toFixed(3)}, quality=${quality.toFixed(3)}`);
    
    // Tier 1: High confidence semantic matches (adjusted for realistic Gemini embedding scores)
    if (semantic >= 0.7) {
      const tier1Score = Math.round(semantic * 100); // Return 70-100% directly
      console.log(`    → Tier 1 (high semantic): ${tier1Score}%`);
      return tier1Score / 100;
    }
    
    // Tier 2: Moderate semantic matches  
    if (semantic >= 0.4) {
      const combined = (semantic * 0.6) + (lexical * 0.3) + (quality * 0.1);
      const tier2Score = Math.round(combined * 100);
      console.log(`    → Tier 2 (moderate semantic): ${tier2Score}%`);
      return tier2Score / 100;
    }
    
    // Tier 3: Low semantic matches - lexical dominant
    const fallback = (lexical * 0.7) + (quality * 0.3);
    const tier3Score = Math.round(fallback * 100);
    console.log(`    → Tier 3 (lexical dominant): ${tier3Score}%`);
    return tier3Score / 100;
  }
  
  private async calculateLexicalScore(doc: any, searchTerms: string): Promise<number> {
    try {
      // Safely convert aiKeyTopics array to string
      const keyTopicsText = Array.isArray(doc.aiKeyTopics) 
        ? doc.aiKeyTopics.join(' ') 
        : (doc.aiKeyTopics || '');
      
      // Fetch tag names for this document
      const docTags = await db
        .select({ name: tags.name })
        .from(documentTags)
        .innerJoin(tags, eq(documentTags.tagId, tags.id))
        .where(eq(documentTags.documentId, doc.id));
      
      const tagNamesText = docTags.map(tag => tag.name).join(' ');
      
      // Get base PostgreSQL ts_rank score (including tag names)
      const result = await db.execute(sql`
        SELECT ts_rank(
          to_tsvector('english', 
            coalesce(${doc.name || ''},'') || ' ' || 
            coalesce(${doc.aiSummary || ''},'') || ' ' || 
            coalesce(${keyTopicsText},'') || ' ' || 
            coalesce(${tagNamesText},'')
          ), 
          plainto_tsquery('english', ${searchTerms})
        ) as score
      `);
      
      let baseScore = parseFloat(((result.rows[0] as any)?.score || 0).toString());
      
      // Apply match bonuses across all searchable fields (including content for broader search results)
      const titleText = (doc.name || '').toLowerCase();
      const summaryText = (doc.aiSummary || '').toLowerCase();
      const topicsText = keyTopicsText.toLowerCase();
      const contentText = (doc.documentContent || '').toLowerCase();
      const tagText = tagNamesText.toLowerCase();
      const allSearchableText = `${titleText} ${summaryText} ${topicsText} ${contentText} ${tagText}`;
      
      const searchLower = searchTerms.toLowerCase();
      const searchTermsList = searchLower.split(' ').map(t => t.trim()).filter(t => t.length > 0);
      
      console.log(`FTS Debug for "${doc.name}": search="${searchLower}", terms=[${searchTermsList.join(',')}], baseScore=${baseScore.toFixed(3)}`);
      
      // Check where the terms are found
      const titleMatches = searchTermsList.filter(term => titleText.includes(term));
      const summaryMatches = searchTermsList.filter(term => summaryText.includes(term));
      const topicsMatches = searchTermsList.filter(term => topicsText.includes(term));
      const contentMatches = searchTermsList.filter(term => contentText.includes(term));
      const tagMatches = searchTermsList.filter(term => tagText.includes(term));
      
      // Exact name match: highest boost
      if (titleText === searchLower) {
        baseScore = Math.max(baseScore, 0.95);
        console.log(`  → Exact name match bonus: ${baseScore.toFixed(3)}`);
      }
      // All terms found in name: significant boost  
      else if (searchTermsList.every(term => titleText.includes(term))) {
        baseScore = Math.max(baseScore, 0.8);
        console.log(`  → All terms in name bonus: ${baseScore.toFixed(3)}`);
      }
      // All terms found in summary: high boost (AI analysis is very relevant)
      else if (searchTermsList.every(term => summaryText.includes(term))) {
        baseScore = Math.max(baseScore, 0.75);
        console.log(`  → All terms in AI summary bonus: ${baseScore.toFixed(3)}`);
      }
      // All terms found in key topics: good boost
      else if (searchTermsList.every(term => topicsText.includes(term))) {
        baseScore = Math.max(baseScore, 0.7);
        console.log(`  → All terms in key topics bonus: ${baseScore.toFixed(3)}`);
      }
      // All terms found in tags: good boost (tags are important for categorization)
      else if (searchTermsList.every(term => tagText.includes(term))) {
        baseScore = Math.max(baseScore, 0.68);
        console.log(`  → All terms in tags bonus: ${baseScore.toFixed(3)}`);
      }
      // All terms found in document content: solid boost (content is highly relevant)
      else if (searchTermsList.every(term => contentText.includes(term))) {
        baseScore = Math.max(baseScore, 0.65);
        console.log(`  → All terms in document content bonus: ${baseScore.toFixed(3)}`);
      }
      // Some terms found in content: moderate boost  
      else if (contentMatches.length > 0) {
        baseScore = Math.max(baseScore, 0.55);
        console.log(`  → Some terms found in content (${contentMatches.join(',')}) bonus: ${baseScore.toFixed(3)}`);
      }
      // Some terms found anywhere: base boost
      else if (searchTermsList.some(term => allSearchableText.includes(term))) {
        const allMatches = Array.from(new Set([...titleMatches, ...summaryMatches, ...topicsMatches, ...contentMatches, ...tagMatches]));
        baseScore = Math.max(baseScore, 0.4);
        console.log(`  → Some terms found bonus (${allMatches.join(',')}) in searchable fields: ${baseScore.toFixed(3)}`);
      }
      // Pure ts_rank with better normalization
      else {
        baseScore = Math.min(0.8, baseScore * 2); // Scale up ts_rank scores
        console.log(`  → No field match, scaled ts_rank: ${baseScore.toFixed(3)}`);
      }
      
      return Math.min(1, Math.max(0, baseScore));
    } catch (error) {
      console.error('FTS scoring failed for doc:', doc.name, 'error:', error);
      return 0;
    }
  }
  
  private async calculateQualityBoost(doc: any, userId?: string): Promise<number> {
    let boost = 0;
    
    // Recent access: +0.3 if opened in last 30 days
    if (userId) {
      try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const recentAccess = await db
          .select({ count: count() })
          .from(documentAccessLog)
          .where(and(
            eq(documentAccessLog.userId, userId),
            eq(documentAccessLog.documentId, doc.id),
            sql`${documentAccessLog.accessedAt} >= ${thirtyDaysAgo}`
          ));
          
        if (recentAccess[0]?.count > 0) {
          boost += 0.3;
        }
      } catch (error) {
        console.warn('Recent access check failed:', error);
      }
    }
    
    // Document completeness: +0.2 if word_count > 100
    if (doc.aiWordCount && doc.aiWordCount > 100) {
      boost += 0.2;
    }
    
    // User favorites: +0.5 if marked as favorite
    if (doc.isFavorite) {
      boost += 0.5;
    }
    
    return Math.min(1.0, boost); // Cap total at 1.0
  }
  
  private async new3StageScoring(
    candidates: any[], 
    query: string, 
    userId?: string
  ): Promise<any[]> {
    console.log(`Starting new 3-stage scoring for ${candidates.length} candidates`);
    
    // Check feature flag (enabled by default)
    const useNewScoring = process.env.USE_NEW_SCORING !== 'false';
    if (!useNewScoring) {
      console.log('New scoring disabled via feature flag, using fallback');
      return candidates; // Return unchanged
    }
    
    // Pre-filter candidates (metadata filtering)
    const filteredCandidates = this.preFilterCandidates(candidates, query);
    console.log(`Pre-filtering: ${candidates.length} → ${filteredCandidates.length} candidates`);
    
    if (filteredCandidates.length === 0) {
      return []; // No candidates after filtering
    }
    
    // Generate or retrieve cached query embedding
    let queryEmbedding: number[];
    const cachedEmbedding = this.queryEmbeddingCache.getCachedEmbedding(query);
    
    if (cachedEmbedding) {
      console.log(`Using cached query embedding for: "${query}"`);
      queryEmbedding = cachedEmbedding;
    } else {
      try {
        console.log(`Generating new query embedding for: "${query}"`);
        queryEmbedding = await generateEmbedding(query, 'RETRIEVAL_QUERY');
        this.queryEmbeddingCache.setCachedEmbedding(query, queryEmbedding);
        console.log(`Cached new query embedding for future searches`);
      } catch (error) {
        console.warn('Query embedding generation failed:', error);
        return candidates; // Fallback to original candidates
      }
    }
    
    const scoredDocuments = [];
    
    for (const doc of filteredCandidates) {
      try {
        // Stage 1: Semantic Scoring (50% weight)
        const semanticScore = await this.calculateSemanticScore(doc, queryEmbedding);
        console.log(`  → Semantic details for "${doc.name}": checking embeddings...`);
        
        // Stage 2: Lexical Scoring (35% weight) 
        const lexicalScore = await this.calculateLexicalScore(doc, query);
        
        // Stage 3: Quality Boost (15% weight)
        const qualityBoost = await this.calculateQualityBoost(doc, userId);
        
        // Tiered scoring approach - prevents good semantic matches from being artificially capped
        const finalScore = this.calculateTieredScore(semanticScore, lexicalScore, qualityBoost);
        
        console.log(`Document "${doc.name}": semantic=${semanticScore.toFixed(3)}, lexical=${lexicalScore.toFixed(3)}, quality=${qualityBoost.toFixed(3)}, final=${finalScore.toFixed(3)}`);
        
        // Determine match type for transparency
        let matchType = 'semantic';
        let matchReason = '';
        
        // Check for exact lexical matches
        const docText = `${doc.name || ''} ${doc.aiSummary || ''} ${doc.documentContent || ''}`.toLowerCase();
        const queryLower = query.toLowerCase();
        
        if (docText.includes(queryLower)) {
          matchType = 'exact';
          matchReason = `Contains "${query}"`;
        } else if (lexicalScore > 0.6) {
          matchType = 'lexical';
          matchReason = `Strong keyword match`;
        } else if (semanticScore > 0.6) {
          matchType = 'semantic';
          matchReason = `Conceptually related`;
        } else {
          matchType = 'partial';
          matchReason = `Partial relevance`;
        }

        scoredDocuments.push({
          ...doc,
          newScore: finalScore,
          semanticScore,
          lexicalScore,
          qualityBoost,
          scoringMethod: 'new_3_stage',
          matchType,
          matchReason
        });
      } catch (error) {
        console.warn(`Scoring failed for document ${doc.id}:`, error);
        // Include document with 0 score rather than excluding it
        scoredDocuments.push({
          ...doc,
          newScore: 0,
          scoringMethod: 'fallback'
        });
      }
    }
    
    // Sort by final score (highest first)
    scoredDocuments.sort((a, b) => b.newScore - a.newScore);
    
    console.log(`3-stage scoring completed: ${scoredDocuments.length} documents scored`);
    return scoredDocuments;
  }

  // Document Management Stop Words List for preprocessing search queries
  private readonly DOCUMENT_STOP_WORDS = new Set([
    // Generic Document Terms
    'document', 'documents', 'doc', 'docs', 'file', 'files', 'filing', 'paper', 'papers', 'paperwork',
    'form', 'forms', 'record', 'records', 'recording', 'report', 'reports', 'reporting', 'sheet', 'sheets',
    'copy', 'copies', 'scan', 'scans', 'scanned', 'pdf', 'pdfs', 'attachment', 'attachments',
    
    // Action/Request Words
    'find', 'finding', 'found', 'show', 'showing', 'shown', 'get', 'getting', 'got', 'search', 'searching', 'searched',
    'look', 'looking', 'looked', 'give', 'giving', 'gave', 'need', 'needing', 'needed', 'want', 'wanting', 'wanted',
    'help', 'helping', 'helped', 'locate', 'locating', 'located',
    
    // Possessive/Determiners
    'my', 'mine', 'our', 'ours', 'the', 'this', 'that', 'these', 'those', 'any', 'some', 'all',
    'where', 'what', 'which', 'who', 'when', 'how',
    
    // Location/Storage Terms
    'folder', 'folders', 'drive', 'drives', 'storage', 'stored', 'saved', 'save', 'uploaded', 'upload',
    'downloaded', 'download',
    
    // Vague Qualifiers
    'stuff', 'things', 'items', 'something', 'anything', 'everything', 'related', 'regarding', 'about',
    'concerning', 'type', 'types', 'kind', 'kinds',
    
    // Common prepositions and articles
    'with', 'for', 'in', 'on', 'at', 'by', 'from', 'to', 'of', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
    'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
    'can', 'a', 'an'
  ]);

  /**
   * Remove stop words from search query while preserving meaningful phrases
   */
  private preprocessSearchQuery(query: string): string {
    // Split into words while preserving quoted phrases
    const words = query.toLowerCase()
      .split(/\s+/)
      .map(word => word.trim())
      .filter(word => word.length > 0);
    
    // Filter out stop words but keep meaningful terms (length > 2)
    const meaningfulWords = words.filter(word => {
      // Keep words that are:
      // 1. Not in stop words list
      // 2. Have meaningful length (>2 characters)
      // 3. Are not just punctuation
      return !this.DOCUMENT_STOP_WORDS.has(word) && 
             word.length > 2 && 
             /[a-zA-Z0-9]/.test(word);
    });
    
    const cleanedQuery = meaningfulWords.join(' ');
    console.log(`Stop word filtering: "${query}" → "${cleanedQuery}"`);
    return cleanedQuery || query; // Fallback to original if everything was filtered
  }

  // Hybrid FTS + Limited Semantic Search for optimal performance
  async searchFTSPlusSemanticOptimized(query: string, filters: Partial<Omit<DocumentFilters, 'search'>> = {}, userId?: string): Promise<{
    documents: DocumentWithFolderAndTags[];
    relevantDocuments: DocumentWithFolderAndTags[];
    relatedDocuments: DocumentWithFolderAndTags[];
    response: string;
    intent: string;
    keywords: string[];
    timing?: { total: number; fts: number; semantic: number };
  }> {
    await this.ensureInitialized();
    
    const startTime = performance.now();
    console.log(`🚀 Hybrid search request: "${query}"`);
    
    // Phase 1: Fast FTS pre-filtering (get more candidates quickly)
    const ftsStartTime = performance.now();
    
    // Apply stop word preprocessing before FTS search
    const preprocessedQuery = this.preprocessSearchQuery(query);
    const rawSearchInput = preprocessedQuery;
    let useFTS = false;
    let searchTerms = '';
    
    if (rawSearchInput.trim()) {
      const searchWords = rawSearchInput.split(/\s+/).filter(word => word.trim().length > 0);
      if (searchWords.length > 0) {
        searchTerms = searchWords.join(' OR ');
        useFTS = true;
        console.log(`FTS search terms: "${searchTerms}" (${searchWords.length > 1 ? 'OR logic' : 'single term'} with websearch_to_tsquery)`);
      }
    }

    // Execute fast FTS query to get top 15 candidates
    let ftsResults = [];
    let ftsTime = 0;
    
    if (useFTS) {
      try {
        console.log(`Phase 1: Fast ILIKE pre-filtering for query: "${query}"`);
        
        // Use ILIKE search (same as simple search) instead of FTS for consistency
        const searchTerm = `%${query}%`;
        
        // Build search conditions (same as simple search) - exclude trashed documents
        const conditions = [
          eq(documents.isDeleted, false),
          eq(documents.status, 'active')
        ];
        
        // Search in document name, content, and tag names (same as simple search)
        const nameCondition = ilike(documents.name, searchTerm);
        const contentCondition = and(
          isNotNull(documents.documentContent),
          ilike(documents.documentContent, searchTerm)
        );
        
        // Search in tag names by finding documents that have tags matching the search
        const tagSearchSubquery = db
          .select({ documentId: documentTags.documentId })
          .from(documentTags)
          .innerJoin(tags, eq(documentTags.tagId, tags.id))
          .where(ilike(tags.name, searchTerm));
        
        const tagCondition = inArray(documents.id, tagSearchSubquery);
        
        // Combine all search conditions
        const searchConditions = [nameCondition, contentCondition, tagCondition];
        conditions.push(or(...searchConditions)!);
        
        // Apply additional filters
        if (filters?.fileType && filters.fileType !== 'all') {
          conditions.push(eq(documents.fileType, filters.fileType));
        }
        
        if (filters?.folderId && filters.folderId !== 'all') {
          conditions.push(eq(documents.folderId, filters.folderId));
        }
        
        if (filters?.tagId) {
          const docsWithTag = await db
            .select({ documentId: documentTags.documentId })
            .from(documentTags)
            .where(eq(documentTags.tagId, filters.tagId));
            
          conditions.push(inArray(documents.id, docsWithTag.map(d => d.documentId)));
        }
        
        // Get documents with ILIKE search (limit to 15 for efficiency)
        const rawFtsResults = await db
          .select()
          .from(documents)
          .leftJoin(folders, eq(documents.folderId, folders.id))
          .where(and(...conditions))
          .orderBy(desc(documents.uploadedAt))
          .limit(15);
        
        ftsResults = rawFtsResults.map((result) => ({
          ...result.documents,
          folder: result.folders,
          tags: [],
          ftsScore: 1.0 // Give all ILIKE matches a base score
        }));
        
        ftsTime = performance.now() - ftsStartTime;
        console.log(`ILIKE phase: ${ftsTime.toFixed(2)}ms, found ${ftsResults.length} candidates`);
        
      } catch (error) {
        console.warn('ILIKE query failed, falling back to empty results:', error);
        ftsResults = [];
        ftsTime = performance.now() - ftsStartTime;
      }
    }
    
    if (ftsResults.length === 0) {
      const totalTime = performance.now() - startTime;
      return { 
        documents: [], 
        relevantDocuments: [],
        relatedDocuments: [],
        response: "No matches found", 
        intent: 'hybrid_search',
        keywords: query.split(' '),
        timing: { total: totalTime, fts: ftsTime, semantic: 0 }
      };
    }

    // Phase 2: Semantic scoring on top candidates only
    const semanticStartTime = performance.now();
    
    // Generate or retrieve cached query embedding
    let queryEmbedding: number[];
    const cachedEmbedding = this.queryEmbeddingCache.getCachedEmbedding(query);
    
    if (cachedEmbedding) {
      console.log(`Using cached query embedding for: "${query}"`);
      queryEmbedding = cachedEmbedding;
    } else {
      try {
        console.log(`Generating new query embedding for: "${query}"`);
        queryEmbedding = await generateEmbedding(query, 'RETRIEVAL_QUERY');
        this.queryEmbeddingCache.setCachedEmbedding(query, queryEmbedding);
        console.log(`Cached new query embedding for future searches`);
      } catch (error) {
        console.warn('Query embedding generation failed:', error);
        // Fallback to FTS-only results
        const totalTime = performance.now() - startTime;
        const semanticTime = performance.now() - semanticStartTime;
        
        const documents = ftsResults.map(doc => ({ ...doc, tags: [] }));
        
        return {
          documents,
          relevantDocuments: documents,
          relatedDocuments: [],
          response: `Found ${documents.length} documents using text search`,
          intent: 'fts_only',
          keywords: query.split(' '),
          timing: { total: totalTime, fts: ftsTime, semantic: semanticTime }
        };
      }
    }

    // Only score top 6 FTS results with semantic analysis
    const topCandidates = ftsResults.slice(0, 6);
    console.log(`Phase 2: Semantic scoring on top ${topCandidates.length} FTS candidates`);
    
    const semanticScored = await Promise.all(topCandidates.map(async doc => {
      const semanticScore = this.calculateOptimizedSemanticScore(doc, queryEmbedding, query);
      
      // Apply quality boost for personalization (same as existing system)
      const qualityBoost = userId ? await this.calculateQualityBoost(doc, userId) : 0;
      
      return {
        ...doc,
        semanticScore,
        qualityBoost,
        combinedScore: (doc.ftsScore * 0.3) + (semanticScore * 0.6) + (qualityBoost * 0.1), // Rebalanced weights
        confidenceScore: Math.round(semanticScore * 100),
        tags: [] // Ensure tags array exists
      };
    }));

    const semanticTime = performance.now() - semanticStartTime;
    console.log(`Semantic phase: ${semanticTime.toFixed(2)}ms, scored ${topCandidates.length} documents`);

    // Phase 3: Combine scores and rank
    const finalResults = semanticScored.sort((a, b) => b.combinedScore - a.combinedScore);

    const totalTime = performance.now() - startTime;
    console.log(`🚀 Hybrid search completed: ${totalTime.toFixed(2)}ms (FTS: ${ftsTime.toFixed(2)}ms, Semantic: ${semanticTime.toFixed(2)}ms)`);

    // Group results by confidence level
    const relevantDocuments = finalResults.filter(doc => doc.confidenceScore >= 50);
    const relatedDocuments = finalResults.filter(doc => doc.confidenceScore < 50);

    // Generate conversational AI response (same as searchConversational)
    let conversationalResponse;
    
    if (finalResults.length === 0) {
      conversationalResponse = `I couldn't find any documents matching "${query}". Try searching with different keywords, or check if the document might be in a specific folder or have different tags.`;
    } else {
      try {
        // Generate friendly AI response with numbered rankings
        conversationalResponse = await generateConversationalResponse(
          query,
          finalResults,
          'hybrid_search'
        );
      } catch (error) {
        console.warn('Failed to generate conversational response, using enhanced fallback:', error);
        // Enhanced fallback with numbered rankings and confidence levels
        
        if (finalResults.length === 1) {
          const doc = finalResults[0];
          conversationalResponse = `🎯 **Perfect Match!** I found exactly what you're looking for:\n\n**1.** "${doc.name}" (${doc.confidenceScore}% confidence)\n   ${doc.aiSummary ? `📄 ${doc.aiSummary.substring(0, 120)}...` : 'Document ready for review'}\n\nThis appears to be exactly what you were searching for!`;
        } else {
          // Multi-document response with numbered rankings
          let responseLines = [`🔍 **Found ${finalResults.length} relevant documents:**\n`];
          
          finalResults.slice(0, 3).forEach((doc, index) => {
            const ranking = index + 1;
            const emoji = ranking === 1 ? '🥇' : ranking === 2 ? '🥈' : '🥉';
            const confidence = doc.confidenceScore >= 70 ? 'High' : doc.confidenceScore >= 50 ? 'Medium' : 'Low';
            
            responseLines.push(`${emoji} **${ranking}.** "${doc.name}" (${doc.confidenceScore}% - ${confidence} confidence)`);
            
            if (doc.aiSummary) {
              responseLines.push(`   📄 ${doc.aiSummary.substring(0, 100)}...`);
            }
            responseLines.push('');
          });
          
          if (finalResults.length > 3) {
            responseLines.push(`📚 *Plus ${finalResults.length - 3} more documents with lower confidence scores.*`);
          }
          
          conversationalResponse = responseLines.join('\n');
        }
      }
    }

    return {
      documents: finalResults,
      relevantDocuments,
      relatedDocuments,
      response: conversationalResponse,
      intent: 'hybrid_search',
      keywords: query.split(' ').filter(word => word.trim().length > 0),
      timing: { total: totalTime, fts: ftsTime, semantic: semanticTime }
    };
  }

  // Enhanced conversational search using AI metadata
  async searchConversational(query: string, filters: Partial<Omit<DocumentFilters, 'search'>> = {}, userId?: string): Promise<{
    documents: DocumentWithFolderAndTags[];
    relevantDocuments: DocumentWithFolderAndTags[];
    relatedDocuments: DocumentWithFolderAndTags[];
    response: string;
    intent: string;
    keywords: string[];
  }> {
    await this.ensureInitialized();
    
    // Add performance monitoring to search functions
    const startTime = performance.now();
    
    try {
      // Enhanced query processing with better fallbacks
      let queryAnalysis;
      
      // Smart bypass: For truly simple queries (single meaningful words), bypass AI processing
      const meaningfulWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !/^(the|and|or|but|in|on|at|to|for|of|with|by|from|up|about|into|through|my|your|their|his|her|its|where|what|when|who|how|why)$/.test(w));
      const isReallySimpleQuery = meaningfulWords.length === 1 && meaningfulWords[0].length > 3 && !/['"?!]/.test(query);
      
      if (isReallySimpleQuery) {
        // Direct search for truly simple single-word queries only
        console.log(`Direct search for simple query: "${query}"`);
        queryAnalysis = {
          intent: "simple_search",
          keywords: meaningfulWords,
          semanticQuery: query.toLowerCase(),
          categoryFilter: undefined,
          documentTypeFilter: undefined
        };
      } else {
        try {
          // Preprocess the query to remove stop words before sending to AI
          const cleanedQuery = this.preprocessSearchQuery(query);
          console.log(`Preprocessing query for AI: "${query}" → "${cleanedQuery}"`);
          
          // Process the conversational query using Flash-lite for complex queries
          queryAnalysis = await processConversationalQuery(cleanedQuery);
          console.log(`AI Query Analysis for "${cleanedQuery}":`, queryAnalysis);
        } catch (error) {
          console.warn("AI processing failed, using smart fallback:", error instanceof Error ? error.message : String(error));
          // Enhanced fallback: Extract keywords from conversational questions
          queryAnalysis = this.extractKeywordsFromConversationalQuery(query);
          console.log(`Fallback Query Analysis for "${query}":`, queryAnalysis);
        }
      }
      
      // Apply base filters - exclude trashed documents
      const conditions = [
        eq(documents.isDeleted, false),
        eq(documents.status, 'active')
      ];
      
      // Add category filter from AI analysis or explicit filters
      if (queryAnalysis.categoryFilter) {
        // Check both AI category and user-overridden category
        const categoryCondition = or(
          eq(documents.aiCategory, queryAnalysis.categoryFilter),
          eq(documents.overrideCategory, queryAnalysis.categoryFilter)
        );
        if (categoryCondition) {
          conditions.push(categoryCondition);
        }
      }
      
      // Add document type filter from AI analysis
      if (queryAnalysis.documentTypeFilter) {
        const docTypeCondition = or(
          eq(documents.aiDocumentType, queryAnalysis.documentTypeFilter),
          eq(documents.overrideDocumentType, queryAnalysis.documentTypeFilter)
        );
        if (docTypeCondition) {
          conditions.push(docTypeCondition);
        }
      }
      
      // Apply additional filters (file type, folder, tag)
      if (filters.fileType && filters.fileType !== 'all') {
        conditions.push(eq(documents.fileType, filters.fileType));
      }
      
      if (filters.folderId && filters.folderId !== 'all') {
        conditions.push(eq(documents.folderId, filters.folderId));
      }
      
      if (filters.tagId) {
        const docsWithTag = await db
          .select({ documentId: documentTags.documentId })
          .from(documentTags)
          .where(eq(documentTags.tagId, filters.tagId));
        
        const docIds = docsWithTag.map(dt => dt.documentId);
        if (docIds.length > 0) {
          conditions.push(inArray(documents.id, docIds));
        } else {
          // No documents with this tag
          return {
            documents: [],
            relevantDocuments: [],
            relatedDocuments: [],
            response: `No documents found with the specified tag.`,
            intent: queryAnalysis.intent,
            keywords: queryAnalysis.keywords
          };
        }
      }
      
      // ENHANCED PERMISSIVE SEARCH: Find all potentially relevant documents for confidence scoring
      // Instead of strict filtering, we'll get potential matches and score them
      const potentialMatchConditions = [];
      
      if (queryAnalysis.keywords.length > 0) {
        for (const keyword of queryAnalysis.keywords) {
          const keywordConditions = [
            // Search in document names 
            ilike(documents.name, `%${keyword}%`),
            ilike(documents.originalName, `%${keyword}%`),
            
            // Search in AI-generated metadata
            and(isNotNull(documents.aiSummary), ilike(documents.aiSummary, `%${keyword}%`)),
            and(isNotNull(documents.aiConciseName), ilike(documents.aiConciseName, `%${keyword}%`)),
            
            // Search in AI categories and document types
            and(isNotNull(documents.aiCategory), ilike(documents.aiCategory, `%${keyword}%`)),
            and(isNotNull(documents.overrideCategory), ilike(documents.overrideCategory, `%${keyword}%`)),
            and(isNotNull(documents.aiDocumentType), ilike(documents.aiDocumentType, `%${keyword}%`)),
            and(isNotNull(documents.overrideDocumentType), ilike(documents.overrideDocumentType, `%${keyword}%`)),
            
            // Search full document content 
            and(isNotNull(documents.documentContent), ilike(documents.documentContent, `%${keyword}%`))
          ];
          
          // Search in key topics array
          try {
            // Exact array overlap
            const keyTopicsExactCondition = sql`${documents.aiKeyTopics} && ARRAY[${keyword}]::text[]`;
            keywordConditions.push(keyTopicsExactCondition);
            
            // Substring search within array elements
            const keyTopicsSubstringCondition = sql`EXISTS (
              SELECT 1 FROM unnest(${documents.aiKeyTopics}) AS topic 
              WHERE topic ILIKE ${`%${keyword}%`}
            )`;
            keywordConditions.push(keyTopicsSubstringCondition);
          } catch (error) {
            console.warn("Array search fallback for keyword:", keyword, error);
          }
          
          potentialMatchConditions.push(or(...keywordConditions.filter(Boolean))!);
        }
        
        if (potentialMatchConditions.length > 0) {
          // Use OR for multiple keywords (any can match) for maximum recall
          conditions.push(or(...potentialMatchConditions)!);
        }
      }
      
      // If no keyword matches, expand search to include semantic query in all fields
      if (potentialMatchConditions.length === 0 && queryAnalysis.semanticQuery) {
        const semanticConditions = [
          ilike(documents.name, `%${queryAnalysis.semanticQuery}%`),
          ilike(documents.originalName, `%${queryAnalysis.semanticQuery}%`),
          and(isNotNull(documents.aiSummary), ilike(documents.aiSummary, `%${queryAnalysis.semanticQuery}%`)),
          and(isNotNull(documents.aiConciseName), ilike(documents.aiConciseName, `%${queryAnalysis.semanticQuery}%`)),
          and(isNotNull(documents.documentContent), ilike(documents.documentContent, `%${queryAnalysis.semanticQuery}%`))
        ];
        
        conditions.push(or(...semanticConditions.filter(Boolean))!);
      }
      
      // IMPROVED: Don't apply AI category/type filters for keyword-based searches
      // This prevents over-filtering when users search for specific terms that might exist in different categories
      // For example, "escrow" documents might be in Taxes, Real Estate, or Legal categories
      console.log("Skipping category/type filters to prioritize keyword matching");
      
      console.log(`Search conditions applied for "${query}":`, conditions.length, "conditions");
      console.log(`Keywords being searched:`, queryAnalysis.keywords);
      
      // Execute permissive search to get potential matches for confidence scoring
      let foundDocuments = await db
        .select({
          id: documents.id,
          name: documents.name,
          originalName: documents.originalName,
          filePath: documents.filePath,
          fileSize: documents.fileSize,
          fileType: documents.fileType,
          mimeType: documents.mimeType,
          folderId: documents.folderId,
          uploadedAt: documents.uploadedAt,
          isFavorite: documents.isFavorite,
          isDeleted: documents.isDeleted,
          driveFileId: documents.driveFileId,
          driveWebViewLink: documents.driveWebViewLink,
          isFromDrive: documents.isFromDrive,
          driveLastModified: documents.driveLastModified,
          driveSyncStatus: documents.driveSyncStatus,
          driveSyncedAt: documents.driveSyncedAt,
          aiSummary: documents.aiSummary,
          aiKeyTopics: documents.aiKeyTopics,
          aiDocumentType: documents.aiDocumentType,
          aiCategory: documents.aiCategory,
          aiSentiment: documents.aiSentiment,
          aiWordCount: documents.aiWordCount,
          aiAnalyzedAt: documents.aiAnalyzedAt,
          aiConciseName: documents.aiConciseName,
          aiCategoryConfidence: documents.aiCategoryConfidence,
          aiDocumentTypeConfidence: documents.aiDocumentTypeConfidence,
          overrideCategory: documents.overrideCategory,
          overrideDocumentType: documents.overrideDocumentType,
          classificationOverridden: documents.classificationOverridden,
          documentContent: documents.documentContent,
          contentExtracted: documents.contentExtracted,
          contentExtractedAt: documents.contentExtractedAt,
          titleEmbedding: documents.titleEmbedding,
          contentEmbedding: documents.contentEmbedding,
          summaryEmbedding: documents.summaryEmbedding,
          keyTopicsEmbedding: documents.keyTopicsEmbedding,
          embeddingsGenerated: documents.embeddingsGenerated,
          embeddingsGeneratedAt: documents.embeddingsGeneratedAt
        })
        .from(documents)
        .where(and(...conditions))
        .orderBy(desc(documents.uploadedAt))
        .limit(filters.limit || 20); // Increased limit for confidence scoring
      
      // If no matches found with current conditions, try a broader search
      if (foundDocuments.length === 0 && queryAnalysis.keywords.length > 0) {
        console.log("No matches found, trying broader search...");
        
        // Try searching for individual keywords more broadly - exclude trashed documents
        const broadConditions = [
          eq(documents.isDeleted, false),
          eq(documents.status, 'active')
        ];
        const anyKeywordConditions = [];
        
        for (const keyword of queryAnalysis.keywords) {
          anyKeywordConditions.push(
            ilike(documents.name, `%${keyword}%`),
            ilike(documents.originalName, `%${keyword}%`),
            and(isNotNull(documents.documentContent), ilike(documents.documentContent, `%${keyword}%`)),
            and(isNotNull(documents.aiSummary), ilike(documents.aiSummary, `%${keyword}%`))
          );
        }
        
        if (anyKeywordConditions.length > 0) {
          broadConditions.push(or(...anyKeywordConditions)!);
          
          foundDocuments = await db
            .select({
              id: documents.id,
              name: documents.name,
              originalName: documents.originalName,
              filePath: documents.filePath,
              fileSize: documents.fileSize,
              fileType: documents.fileType,
              mimeType: documents.mimeType,
              folderId: documents.folderId,
              uploadedAt: documents.uploadedAt,
              isFavorite: documents.isFavorite,
              isDeleted: documents.isDeleted,
              driveFileId: documents.driveFileId,
              driveWebViewLink: documents.driveWebViewLink,
              isFromDrive: documents.isFromDrive,
              driveLastModified: documents.driveLastModified,
              driveSyncStatus: documents.driveSyncStatus,
              driveSyncedAt: documents.driveSyncedAt,
              aiSummary: documents.aiSummary,
              aiKeyTopics: documents.aiKeyTopics,
              aiDocumentType: documents.aiDocumentType,
              aiCategory: documents.aiCategory,
              aiSentiment: documents.aiSentiment,
              aiWordCount: documents.aiWordCount,
              aiAnalyzedAt: documents.aiAnalyzedAt,
              aiConciseName: documents.aiConciseName,
              aiCategoryConfidence: documents.aiCategoryConfidence,
              aiDocumentTypeConfidence: documents.aiDocumentTypeConfidence,
              overrideCategory: documents.overrideCategory,
              overrideDocumentType: documents.overrideDocumentType,
              classificationOverridden: documents.classificationOverridden,
              documentContent: documents.documentContent,
              contentExtracted: documents.contentExtracted,
              contentExtractedAt: documents.contentExtractedAt,
              titleEmbedding: documents.titleEmbedding,
              contentEmbedding: documents.contentEmbedding,
              summaryEmbedding: documents.summaryEmbedding,
              keyTopicsEmbedding: documents.keyTopicsEmbedding,
              embeddingsGenerated: documents.embeddingsGenerated,
              embeddingsGeneratedAt: documents.embeddingsGeneratedAt
            })
            .from(documents)
            .where(and(...broadConditions))
            .orderBy(desc(documents.uploadedAt))
            .limit(20);
          
          console.log(`Broader search found ${foundDocuments.length} potential matches`);
        }
      }
      
      // STAGE 1: True PostgreSQL FTS Database-level Pre-filtering  
      console.log(`Stage 1: Database-level FTS pre-filtering for query: "${query}"`);
      
      // Apply stop word preprocessing before FTS search
      const preprocessedQuery = this.preprocessSearchQuery(query);
      
      // Create search query for PostgreSQL FTS with safe OR logic
      const rawSearchInput = preprocessedQuery || queryAnalysis.keywords.join(' ');
      let searchTerms = '';
      let useFTS = false;
      
      if (rawSearchInput.trim()) {
        // Split terms and use websearch_to_tsquery for each term individually, then combine with OR
        const searchWords = rawSearchInput.split(/\s+/).filter(word => word.trim().length > 0);
        
        if (searchWords.length > 0) {
          // Create OR query by joining terms with OR operator for websearch_to_tsquery
          searchTerms = searchWords.join(' OR ');
          useFTS = true;
          console.log(`FTS search terms: "${searchTerms}" (${searchWords.length > 1 ? 'OR logic' : 'single term'} with websearch_to_tsquery)`);
        }
      } else {
        console.log(`FTS skipped: empty search input`);
      }
      
      // Execute raw SQL for proper PostgreSQL FTS with safe query handling
      let ftsResults = { rows: [] };
      
      if (useFTS && searchTerms) {
        try {
          ftsResults = await db.execute(sql`
            SELECT 
              d.id, d.name, d.original_name, d.file_path, d.file_size, d.file_type, d.mime_type, 
              d.folder_id, d.uploaded_at, d.is_favorite, d.is_deleted, d.drive_file_id, 
              d.drive_web_view_link, d.is_from_drive, d.drive_last_modified, d.drive_sync_status, 
              d.drive_synced_at, d.ai_summary, d.ai_key_topics, d.ai_document_type, d.ai_category, 
              d.ai_sentiment, d.ai_word_count, d.ai_analyzed_at, d.ai_concise_name, 
              d.ai_category_confidence, d.ai_document_type_confidence, d.override_category, 
              d.override_document_type, d.classification_overridden, d.document_content, 
              d.content_extracted, d.content_extracted_at, d.title_embedding, d.content_embedding, 
              d.summary_embedding, d.key_topics_embedding, d.embeddings_generated, d.embeddings_generated_at,
              ts_rank(
                to_tsvector('english', 
                  coalesce(d.name,'') || ' ' || 
                  coalesce(d.original_name,'') || ' ' || 
                  coalesce(d.ai_summary,'') || ' ' || 
                  array_to_string(coalesce(d.ai_key_topics,'{}'), ' ') || ' ' ||
                  coalesce((
                    SELECT string_agg(t.name, ' ')
                    FROM document_tags dt
                    JOIN tags t ON dt.tag_id = t.id
                    WHERE dt.document_id = d.id
                  ), '')
                ), 
                websearch_to_tsquery('english', ${searchTerms})
              ) as fts_score
            FROM documents d
            WHERE 
              d.is_deleted = false 
              AND to_tsvector('english', 
                coalesce(d.name,'') || ' ' || 
                coalesce(d.original_name,'') || ' ' || 
                coalesce(d.ai_summary,'') || ' ' || 
                array_to_string(coalesce(d.ai_key_topics,'{}'), ' ') || ' ' ||
                coalesce((
                  SELECT string_agg(t.name, ' ')
                  FROM document_tags dt
                  JOIN tags t ON dt.tag_id = t.id
                  WHERE dt.document_id = d.id
                ), '')
              ) @@ websearch_to_tsquery('english', ${searchTerms})
            ORDER BY fts_score DESC 
            LIMIT 8
          `);
        } catch (error) {
          console.warn(`FTS query failed with terms "${searchTerms}":`, error instanceof Error ? error.message : String(error));
          console.log('Falling back to semantic search due to FTS error');
        }
      }
      
      // Convert raw results to typed documents
      const stage1Candidates = ftsResults.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        originalName: row.original_name,
        filePath: row.file_path,
        fileSize: row.file_size,
        fileType: row.file_type,
        mimeType: row.mime_type,
        folderId: row.folder_id,
        uploadedAt: row.uploaded_at,
        isFavorite: row.is_favorite,
        isDeleted: row.is_deleted,
        driveFileId: row.drive_file_id,
        driveWebViewLink: row.drive_web_view_link,
        isFromDrive: row.is_from_drive,
        driveLastModified: row.drive_last_modified,
        driveSyncStatus: row.drive_sync_status,
        driveSyncedAt: row.drive_synced_at,
        aiSummary: row.ai_summary,
        aiKeyTopics: row.ai_key_topics,
        aiDocumentType: row.ai_document_type,
        aiCategory: row.ai_category,
        aiSentiment: row.ai_sentiment,
        aiWordCount: row.ai_word_count,
        aiAnalyzedAt: row.ai_analyzed_at,
        aiConciseName: row.ai_concise_name,
        aiCategoryConfidence: row.ai_category_confidence,
        aiDocumentTypeConfidence: row.ai_document_type_confidence,
        overrideCategory: row.override_category,
        overrideDocumentType: row.override_document_type,
        classificationOverridden: row.classification_overridden,
        documentContent: row.document_content,
        contentExtracted: row.content_extracted,
        contentExtractedAt: row.content_extracted_at,
        titleEmbedding: row.title_embedding,
        contentEmbedding: row.content_embedding,
        summaryEmbedding: row.summary_embedding,
        keyTopicsEmbedding: row.key_topics_embedding,
        embeddingsGenerated: row.embeddings_generated,
        embeddingsGeneratedAt: row.embeddings_generated_at,
        ftsScore: parseFloat(row.fts_score) || 0
      }));
      
      console.log(`Stage 1: PostgreSQL FTS found ${stage1Candidates.length} candidates`);
      stage1Candidates.forEach(doc => 
        console.log(`- ${doc.name}: FTS score ${doc.ftsScore?.toFixed(4) || 0}`)
      );
      
      // If FTS found no candidates but broader search found some, use broader search results
      let candidatesForScoring = stage1Candidates;
      if (stage1Candidates.length === 0 && foundDocuments.length > 0) {
        console.log(`FTS found 0 candidates, using ${foundDocuments.length} candidates from broader search`);
        candidatesForScoring = foundDocuments.map(doc => ({
          ...doc,
          ftsScore: 0 // No FTS score available
        }));
      }
      
      // STAGE 2: Selective AI Deep Analysis (only for top candidates)
      const documentsWithConfidenceScores = [];
      
      // Smart query routing: detect truly simple queries that don't benefit from semantic analysis
      // Person names and complex concepts should use semantic analysis for better matching
      const isPersonNameQuery = queryAnalysis.intent.includes('person') || 
                               queryAnalysis.intent.includes('specific names') ||
                               /\b(mr|mrs|dr|ms)\b/i.test(query);
      
      const isSimpleQuery = queryAnalysis.intent === "simple_search" && 
                           !isPersonNameQuery &&
                           (queryAnalysis.keywords.length === 1 && queryAnalysis.keywords[0].length > 3);
      
      // Force 3-stage scoring for documents found via broader search (they contain keywords in non-FTS fields)
      const foundViaBroaderSearch = stage1Candidates.length === 0 && foundDocuments.length > 0;
      
      if (isSimpleQuery && !foundViaBroaderSearch) {
        console.log(`Stage 2: Skipping AI analysis for simple query, using improved FTS scores`);
        // For simple queries, use improved FTS scores with title match bonuses
        // Use preprocessed query (stop words removed) for better scoring
        const keywordsForScoring = preprocessedQuery || queryAnalysis.keywords.join(' ') || query;
        console.log(`Using preprocessed keywords for scoring: "${keywordsForScoring}" (vs original: "${query}")`);
        
        const scoredDocuments = await Promise.all(candidatesForScoring.map(async (doc) => {
          // Apply lexical scoring using preprocessed keywords only
          const improvedScore = await this.calculateLexicalScore(doc, keywordsForScoring);
          return {
            ...doc,
            confidenceScore: Math.round(improvedScore * 100), // Convert to percentage
            relevanceReason: `Enhanced FTS match (keywords: "${keywordsForScoring}", score: ${improvedScore.toFixed(3)})`,
            isRelevant: improvedScore > 0.15
          };
        }));
        documentsWithConfidenceScores.push(...scoredDocuments);
      } else {
        console.log(`Stage 2: Complex query detected, running analysis on ${candidatesForScoring.length} candidates`);
        
        // Check if new 3-stage scoring is enabled via feature flag (enabled by default)
        const useNewScoring = process.env.USE_NEW_SCORING !== 'false';
        console.log(`Using ${useNewScoring ? 'new 3-stage' : 'legacy 2-stage'} scoring system`);
        
        if (useNewScoring) {
          // NEW 3-STAGE SCORING SYSTEM
          console.log("Using new 3-stage scoring: Semantic (50%) + Lexical (35%) + Quality (15%)");
          
          // Use preprocessed query (stop words removed) for consistent scoring
          const keywordsForScoring = preprocessedQuery || queryAnalysis.keywords.join(' ') || query;
          console.log(`Using preprocessed keywords for 3-stage scoring: "${keywordsForScoring}" (vs original: "${query}")`);
          
          // Apply the new 3-stage scoring
          const scoredDocuments = await this.new3StageScoring(candidatesForScoring, keywordsForScoring, undefined);
          
          // Convert scored documents to expected format (newScore is 0-1 scale)
          documentsWithConfidenceScores.push(...scoredDocuments.map(doc => ({
            ...doc,
            confidenceScore: Math.round(doc.newScore * 100), // Convert 0-1 to percentage
            relevanceReason: `3-stage scoring: ${doc.scoringMethod || 'new_3_stage'}`,
            isRelevant: doc.newScore >= 0.2 // Lower threshold for more permissive results
          })));
          
        } else {
          // LEGACY 2-STAGE SYSTEM (for backward compatibility)
          console.log("Using legacy 2-stage scoring: FTS (30%) + AI Analysis (70%)");
          
          // Only run expensive AI analysis on top candidates from Stage 1
          for (const doc of stage1Candidates) {
            // Load content if needed for AI analysis
            let documentContent = doc.documentContent;
            let hasContent = documentContent && documentContent.trim().length > 0;
            
            if (!hasContent) {
              documentContent = await this.getDocumentContent(doc.id);
              hasContent = documentContent && documentContent.trim().length > 0;
              
              if (!hasContent) {
                const extractionSuccess = await this.extractDocumentContent(doc.id);
                if (extractionSuccess) {
                  documentContent = await this.getDocumentContent(doc.id);
                  hasContent = documentContent && documentContent.trim().length > 0;
                }
              }
            }
            
            // Run AI analysis only if content is available
            if (hasContent) {
              const aiAnalysis = await analyzeDocumentRelevance(
                documentContent || '', 
                doc.name, 
                query
              );
              
              // Combine Stage 1 FTS + AI analysis scores
              const ftsScore = Math.round((doc.ftsScore || 0) * 100);
              const finalScore = Math.round((ftsScore * 0.3) + (aiAnalysis.confidenceScore * 0.7));
              
              console.log(`Stage 2: "${doc.name}" - FTS: ${ftsScore}%, AI: ${aiAnalysis.confidenceScore}%, Final: ${finalScore}%`);
              
              documentsWithConfidenceScores.push({
                ...doc,
                documentContent: documentContent,
                confidenceScore: finalScore,
                relevanceReason: aiAnalysis.relevanceReason,
                isRelevant: aiAnalysis.isRelevant
              });
            } else {
              // No content available, use FTS score only
              const ftsScore = Math.round((doc.ftsScore || 0) * 100);
              console.log(`Stage 2: "${doc.name}" - No content available, using FTS score: ${ftsScore}%`);
              documentsWithConfidenceScores.push({
                ...doc,
                confidenceScore: ftsScore,
                relevanceReason: `No extractable content - FTS similarity only`,
                isRelevant: (doc.ftsScore || 0) > 0.01
              });
            }
          }
        }
      }
      
      // Sort by confidence score (highest first)
      documentsWithConfidenceScores.sort((a, b) => b.confidenceScore - a.confidenceScore);
      
      console.log("Document confidence scores:");
      documentsWithConfidenceScores.forEach(doc => 
        console.log(`- ${doc.name}: ${doc.confidenceScore}% confidence`)
      );
      
      // CONFIDENCE-BASED FILTERING SYSTEM
      // High confidence (>80): Return results normally
      // Medium confidence (40-79): Return with caveat  
      // Low confidence (<40): Return top candidates but suggest alternatives
      
      const highConfidenceDocs = documentsWithConfidenceScores.filter(doc => doc.confidenceScore >= 80);
      const mediumConfidenceDocs = documentsWithConfidenceScores.filter(doc => doc.confidenceScore >= 40 && doc.confidenceScore < 80);
      const lowConfidenceDocs = documentsWithConfidenceScores.filter(doc => doc.confidenceScore < 40);
      
      let filteredDocuments = [];
      let confidenceLevel = 'none';
      
      // Improved filtering: Include multiple confidence tiers for better recall
      if (highConfidenceDocs.length > 0) {
        // High confidence exists: include high + medium + some low for comprehensive results
        filteredDocuments = [...highConfidenceDocs, ...mediumConfidenceDocs.slice(0, 2), ...lowConfidenceDocs.slice(0, 2)];
        confidenceLevel = 'high';
        console.log(`Found ${highConfidenceDocs.length} high-confidence matches (>80%)`);
        if (mediumConfidenceDocs.length > 0) {
          console.log(`Also including ${Math.min(2, mediumConfidenceDocs.length)} medium-confidence matches`);
        }
        if (lowConfidenceDocs.length > 0) {
          console.log(`Also including ${Math.min(2, lowConfidenceDocs.length)} low-confidence matches`);
        }
      } else if (mediumConfidenceDocs.length > 0) {
        // Medium confidence exists: include medium + some low  
        filteredDocuments = [...mediumConfidenceDocs.slice(0, 3), ...lowConfidenceDocs.slice(0, 2)];
        confidenceLevel = 'medium';
        console.log(`Found ${mediumConfidenceDocs.length} medium-confidence matches (40-79%)`);
        if (lowConfidenceDocs.length > 0) {
          console.log(`Also including ${Math.min(2, lowConfidenceDocs.length)} low-confidence matches`);
        }
      } else if (lowConfidenceDocs.length > 0) {
        filteredDocuments = lowConfidenceDocs.slice(0, 3); // Limit to top 3 for low confidence
        confidenceLevel = 'low';
        console.log(`Found ${lowConfidenceDocs.length} low-confidence matches (<40%)`);
      } else if (documentsWithConfidenceScores.length > 0) {
        // Fallback: take top 2 documents regardless of score
        filteredDocuments = documentsWithConfidenceScores.slice(0, 2);
        confidenceLevel = 'fallback';
        console.log("Using fallback: showing top candidates with any confidence level");
      }
      
      // Fetch folder and tag information for each document
      const documentsWithFoldersAndTags: DocumentWithFolderAndTags[] = [];
      
      for (const doc of filteredDocuments) {
        const folder = doc.folderId 
          ? (await db.select().from(folders).where(eq(folders.id, doc.folderId)))[0] || null
          : null;
        
        const docTags = await db
          .select({
            id: tags.id,
            name: tags.name,
            color: tags.color,
            createdAt: tags.createdAt,
          })
          .from(tags)
          .innerJoin(documentTags, eq(tags.id, documentTags.tagId))
          .where(eq(documentTags.documentId, doc.id));
        
        documentsWithFoldersAndTags.push({
          ...doc,
          folder: folder || undefined,
          tags: docTags,
          confidenceScore: doc.confidenceScore  // Add confidence score to final result
        });
      }
      
      console.log(`Found ${documentsWithFoldersAndTags.length} filtered documents for query "${query}"`);
      documentsWithFoldersAndTags.forEach(doc => console.log(`- ${doc.name} (${doc.confidenceScore}% confidence)`));
      
      // Group documents into "Relevant" and "Related" sections based on keyword matching
      const relevantDocuments: DocumentWithFolderAndTags[] = [];
      const relatedDocuments: DocumentWithFolderAndTags[] = [];
      
      // Extract key search terms from the query (e.g., "niraj desai" from "where are niraj desai docs")
      const searchKeywords = queryAnalysis.keywords || [];
      
      for (const doc of documentsWithFoldersAndTags) {
        const docText = `${doc.name || ''} ${doc.aiSummary || ''} ${doc.documentContent || ''}`.toLowerCase();
        const highConfidence = (doc.confidenceScore || 0) >= 70;
        
        // Check for exact keyword matches in the document
        let exactKeywordMatches = 0;
        let partialKeywordMatches = 0;
        
        for (const keyword of searchKeywords) {
          const keywordLower = keyword.toLowerCase();
          if (docText.includes(keywordLower)) {
            exactKeywordMatches++;
          }
        }
        
        // For multi-keyword searches (like "niraj desai"), check for partial matches
        if (searchKeywords.length > 1) {
          for (const keyword of searchKeywords) {
            const keywordLower = keyword.toLowerCase();
            // Check if individual words appear anywhere in the document
            if (docText.split(/\s+/).some(word => word.includes(keywordLower))) {
              partialKeywordMatches++;
            }
          }
        }
        
        // Classification logic:
        // RELEVANT: Contains all or most search keywords (exact match for search intent)
        // RELATED: Contains some keywords but not all (related but not exact match)
        const keywordMatchRatio = exactKeywordMatches / Math.max(1, searchKeywords.length);
        
        if (keywordMatchRatio >= 0.7 || highConfidence >= 70 || exactKeywordMatches >= 2) {
          // High keyword match or high confidence = Relevant
          relevantDocuments.push(doc);
        } else if (exactKeywordMatches > 0 || partialKeywordMatches > 0) {
          // Some keyword matches = Related
          relatedDocuments.push(doc);
        } else {
          // No keyword matches but returned by search = Related (lower priority)
          relatedDocuments.push(doc);
        }
      }
      
      console.log(`Document grouping: ${relevantDocuments.length} relevant, ${relatedDocuments.length} related`);
      
      // Generate confidence-based conversational response
      let conversationalResponse;
      
      if (documentsWithFoldersAndTags.length === 0) {
        // No documents found
        conversationalResponse = `I couldn't find any documents matching "${query}". Try searching with different keywords, or check if the document might be in a specific folder or have different tags.`;
      } else {
        // Generate response based on confidence level
        switch (confidenceLevel) {
          case 'high':
            conversationalResponse = await generateConversationalResponse(
              query, 
              documentsWithFoldersAndTags,
              queryAnalysis.intent
            );
            break;
            
          case 'medium':
            const mediumResponse = await generateConversationalResponse(
              query, 
              documentsWithFoldersAndTags,
              queryAnalysis.intent
            );
            conversationalResponse = mediumResponse;
            break;
            
          case 'low':
            conversationalResponse = `I found some documents that might be related, but with low confidence. You might want to try different search terms like "${queryAnalysis.keywords.slice(0, 2).join('", "')}" or check specific folders.`;
            break;
            
          case 'fallback':
            conversationalResponse = `I found some documents but they may not be exactly what you're looking for. Try refining your search with more specific terms.`;
            break;
            
          default:
            conversationalResponse = await generateConversationalResponse(
              query, 
              documentsWithFoldersAndTags,
              queryAnalysis.intent
            );
        }
      }
      
      // Add performance monitoring to search functions
      const duration = performance.now() - startTime;
      console.log(`Search completed in ${duration.toFixed(2)}ms`);
      
      return {
        documents: documentsWithFoldersAndTags, // Keep for backward compatibility 
        relevantDocuments,
        relatedDocuments,
        response: conversationalResponse,
        intent: queryAnalysis.intent,
        keywords: queryAnalysis.keywords
      };
      
    } catch (error) {
      console.error("Error in conversational search:", error);
      
      // Enhanced fallback: Extract keywords using smart fallback even when entire search fails
      const smartFallback = this.extractKeywordsFromConversationalQuery(query);
      console.log("Using enhanced fallback with keywords:", smartFallback.keywords);
      
      // Fallback to regular search but use extracted keywords for better results
      const fallbackResults = await this.getDocuments({
        search: smartFallback.keywords.join(' '), // Use extracted keywords instead of full query
        limit: filters.limit || 20,
        page: filters.page || 1,
        ...filters
      });
      
      // Generate helpful response based on results
      let responseMessage;
      if (fallbackResults.length === 0) {
        responseMessage = `I couldn't find any documents matching "${query}". Try searching with different keywords, or check if the document might be in a specific folder or have different tags.`;
      } else {
        responseMessage = `I found ${fallbackResults.length} document${fallbackResults.length === 1 ? '' : 's'} that might be relevant to your search.`;
      }

      // Add performance monitoring to search functions (fallback path)
      const duration = performance.now() - startTime;
      console.log(`Search completed in ${duration.toFixed(2)}ms (fallback)`);
      
      return {
        documents: fallbackResults, // Keep for backward compatibility
        relevantDocuments: fallbackResults, // For fallback, treat all as relevant
        relatedDocuments: [],
        response: responseMessage,
        intent: "general_search",
        keywords: smartFallback.keywords  // Use extracted keywords instead of entire query
      };
    }
  }

  async getDocumentsCount(filters: DocumentFilters): Promise<number> {
    await this.ensureInitialized();
    const conditions = [
      eq(documents.isDeleted, false),
      eq(documents.status, 'active')
    ];

    if (filters.search) {
      // Search in both document name and content
      const nameCondition = ilike(documents.name, `%${filters.search}%`);
      const contentCondition = and(
        isNotNull(documents.documentContent),
        ilike(documents.documentContent, `%${filters.search}%`)
      );
      if (contentCondition) {
        conditions.push(or(nameCondition, contentCondition)!);
      } else {
        conditions.push(nameCondition);
      }
    }

    if (filters.fileType && filters.fileType !== 'all') {
      conditions.push(eq(documents.fileType, filters.fileType));
    }

    if (filters.folderId && filters.folderId !== 'all') {
      conditions.push(eq(documents.folderId, filters.folderId));
    }

    if (filters.tagId) {
      const docsWithTag = await db
        .select({ documentId: documentTags.documentId })
        .from(documentTags)
        .where(eq(documentTags.tagId, filters.tagId));
      
      const docIds = docsWithTag.map(dt => dt.documentId);
      if (docIds.length > 0) {
        conditions.push(inArray(documents.id, docIds));
      } else {
        return 0;
      }
    }

    const [result] = await db
      .select({ count: count() })
      .from(documents)
      .where(and(...conditions));

    return result.count;
  }

  async getDocumentById(id: string): Promise<DocumentWithFolderAndTags | undefined> {
    const result = await db
      .select({
        document: documents,
        folder: folders,
      })
      .from(documents)
      .leftJoin(folders, eq(documents.folderId, folders.id))
      .where(and(
        eq(documents.id, id), 
        eq(documents.isDeleted, false),
        eq(documents.status, 'active')
      ))
      .limit(1);

    if (result.length === 0) {
      return undefined;
    }

    const docTags = await db
      .select({ tag: tags })
      .from(documentTags)
      .leftJoin(tags, eq(documentTags.tagId, tags.id))
      .where(eq(documentTags.documentId, id));

    return {
      ...result[0].document,
      folder: result[0].folder || undefined,
      tags: docTags.map(dt => dt.tag).filter(Boolean) as Tag[],
    };
  }

  async getDocumentContent(id: string): Promise<string | null> {
    const result = await db
      .select({ 
        documentContent: documents.documentContent 
      })
      .from(documents)
      .where(and(
        eq(documents.id, id), 
        eq(documents.isDeleted, false),
        eq(documents.status, 'active')
      ))
      .limit(1);

    return result.length > 0 ? result[0].documentContent : null;
  }

  async updateDocument(id: string, updates: Partial<InsertDocument>): Promise<Document | undefined> {
    const [updatedDocument] = await db
      .update(documents)
      .set(updates)
      .where(and(
        eq(documents.id, id), 
        eq(documents.isDeleted, false),
        eq(documents.status, 'active')
      ))
      .returning();

    return updatedDocument;
  }

  async deleteDocument(id: string): Promise<boolean> {
    try {
      // Get document details first (need objectPath for GCS deletion)
      const document = await this.getDocumentById(id);
      if (!document) {
        console.warn(`Document ${id} not found for deletion`);
        return false;
      }

      // Mark as trashed in database (soft delete with 7-day retention)
      const result = await db
        .update(documents)
        .set({ 
          status: 'trashed',
          deletedAt: new Date(),
          isDeleted: true // Keep for backward compatibility
        })
        .where(eq(documents.id, id))
        .returning();

      if (result.length === 0) {
        console.warn(`Failed to mark document ${id} as trashed`);
        return false;
      }

      // Delete from GCS immediately (idempotent; treat 404 as success)
      if (document.objectPath || document.filePath) {
        try {
          const objectPath = document.objectPath || document.filePath;
          if (objectPath) {
            const objectStorageService = new ObjectStorageService();
            await objectStorageService.deleteObject(objectPath);
            console.log(`✅ File deleted from GCS: ${objectPath}`);
          }
        } catch (gcsError: any) {
          // Treat 404 as success (file already gone)
          if (gcsError.code === 404 || gcsError.message?.includes('No such object')) {
            console.log(`📁 File already deleted from GCS: ${document.objectPath || document.filePath}`);
          } else {
            console.error(`⚠️ GCS deletion failed for ${document.objectPath || document.filePath}:`, gcsError.message);
            // Don't fail the operation - file will be cleaned up by reconcile job
          }
        }
      }

      // TODO: Invalidate search/embeddings (implement when adding search invalidation)
      console.log(`🗑️ Document "${document.name}" moved to trash (auto-deletes in 7 days)`);
      
      return true;
    } catch (error) {
      console.error(`Error deleting document ${id}:`, error);
      return false;
    }
  }

  async restoreDocument(id: string): Promise<boolean> {
    try {
      await this.ensureInitialized();

      // First, fetch the trashed document
      const trashedDoc = await db
        .select()
        .from(documents)
        .where(and(eq(documents.id, id), eq(documents.status, 'trashed')))
        .limit(1);

      if (trashedDoc.length === 0) {
        console.warn(`Document ${id} not found in trash or not eligible for restore`);
        return false;
      }

      const document = trashedDoc[0];

      // Check if within 7-day restore window
      if (document.deletedAt) {
        const daysSinceDeleted = (Date.now() - document.deletedAt.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceDeleted > 7) {
          console.warn(`Document ${id} is beyond the 7-day restore window (${daysSinceDeleted.toFixed(1)} days old)`);
          return false;
        }
      }

      // Restore the document by updating status and clearing deletedAt
      const result = await db
        .update(documents)
        .set({
          status: 'active',
          deletedAt: null,
        })
        .where(eq(documents.id, id))
        .returning();

      if (result.length === 0) {
        console.warn(`Failed to restore document ${id}`);
        return false;
      }

      // Note: Files were already deleted from GCS during trash operation
      // User will need to re-upload the file if they want the content back
      console.log(`🔄 Document "${document.name}" restored from trash (file content will need to be re-uploaded)`);
      
      return true;
    } catch (error) {
      console.error(`Error restoring document ${id}:`, error);
      return false;
    }
  }

  async getDocumentByDriveFileId(driveFileId: string): Promise<DocumentWithFolderAndTags | undefined> {
    const result = await db
      .select({
        document: documents,
        folder: folders,
      })
      .from(documents)
      .leftJoin(folders, eq(documents.folderId, folders.id))
      .where(and(
        eq(documents.driveFileId, driveFileId), 
        eq(documents.isDeleted, false),
        eq(documents.status, 'active')
      ))
      .limit(1);

    if (result.length === 0) {
      return undefined;
    }

    const docTags = await db
      .select({ tag: tags })
      .from(documentTags)
      .leftJoin(tags, eq(documentTags.tagId, tags.id))
      .where(eq(documentTags.documentId, result[0].document.id));

    return {
      ...result[0].document,
      folder: result[0].folder || undefined,
      tags: docTags.map(dt => dt.tag).filter(Boolean) as Tag[],
    };
  }

  async getDocumentWithVersions(id: string): Promise<DocumentWithVersions | undefined> {
    const documentWithDetails = await this.getDocumentById(id);
    if (!documentWithDetails) {
      return undefined;
    }

    const versions = await this.getDocumentVersions(id);
    const currentVersion = versions.find(v => v.isActive);

    return {
      ...documentWithDetails,
      versions,
      currentVersion,
    };
  }

  // Document Versions
  async createDocumentVersion(insertVersion: InsertDocumentVersion): Promise<DocumentVersion> {
    // Always force isActive=false for new versions - only document creation can set active=true
    const safeInsertVersion = { ...insertVersion, isActive: false };
    
    return await db.transaction(async (tx) => {
      // Lock the parent document to prevent concurrent version creation
      await tx
        .select({ id: sql<string>`id` })
        .from(documents)
        .where(eq(documents.id, safeInsertVersion.documentId))
        .for('update');

      // Get next version number
      const result = await tx
        .select({ maxVersion: sql<number>`COALESCE(MAX(version), 0) + 1` })
        .from(documentVersions)
        .where(eq(documentVersions.documentId, safeInsertVersion.documentId));
      
      const nextVersion = result[0].maxVersion;

      // Insert the new version with computed version number
      const [version] = await tx
        .insert(documentVersions)
        .values({ ...safeInsertVersion, version: nextVersion })
        .returning();
        
      return version;
    });
  }

  async getDocumentVersions(documentId: string): Promise<DocumentVersion[]> {
    return await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId))
      .orderBy(desc(documentVersions.version));
  }

  async setActiveVersion(documentId: string, versionId: string): Promise<boolean> {
    // Get the version we want to activate to ensure it exists and belongs to this document
    const targetVersion = await db
      .select()
      .from(documentVersions)
      .where(and(
        eq(documentVersions.id, versionId),
        eq(documentVersions.documentId, documentId)
      ))
      .limit(1);

    if (targetVersion.length === 0) {
      return false; // Version not found or doesn't belong to this document
    }

    const version = targetVersion[0];

    // Use a transaction to ensure atomicity with parent document locking
    return await db.transaction(async (tx) => {
      // Lock the parent document to serialize concurrent activations
      await tx
        .select({ id: sql<string>`id` })
        .from(documents)
        .where(eq(documents.id, documentId))
        .for('update');
      // First, deactivate all versions for this document
      await tx
        .update(documentVersions)
        .set({ isActive: false })
        .where(eq(documentVersions.documentId, documentId));

      // Then activate the specified version
      await tx
        .update(documentVersions)
        .set({ isActive: true })
        .where(eq(documentVersions.id, versionId));

      // Update the document's metadata to match the active version
      await tx
        .update(documents)
        .set({
          filePath: version.filePath,
          fileSize: version.fileSize,
          fileType: version.fileType,
          mimeType: version.mimeType,
        })
        .where(eq(documents.id, documentId));

      return true;
    });
  }

  async deleteDocumentVersion(documentId: string, versionId: string): Promise<boolean> {
    // Use a transaction to ensure atomicity and lock parent for consistency
    return await db.transaction(async (tx) => {
      // Lock the parent document to prevent concurrent operations
      await tx
        .select({ id: sql<string>`id` })
        .from(documents)
        .where(eq(documents.id, documentId))
        .for('update');

      // Get the version to be deleted, ensuring it belongs to the specified document
      const versionToDelete = await tx
        .select()
        .from(documentVersions)
        .where(and(
          eq(documentVersions.id, versionId),
          eq(documentVersions.documentId, documentId)
        ))
        .limit(1);

      if (versionToDelete.length === 0) {
        return false; // Version not found
      }

      const version = versionToDelete[0];

      // Get all versions for this document within the transaction
      const allVersions = await tx
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.documentId, documentId))
        .orderBy(desc(documentVersions.version));

      // Prevent deleting the only version
      if (allVersions.length === 1) {
        return false; // Cannot delete the only version
      }
      // Delete the version
      await tx
        .delete(documentVersions)
        .where(eq(documentVersions.id, versionId));

      // If we deleted the active version, activate the latest remaining version
      if (version.isActive) {
        const remainingVersions = allVersions.filter(v => v.id !== versionId);
        const latestVersion = remainingVersions[0]; // Already sorted by version desc

        if (latestVersion) {
          // Activate the latest remaining version
          await tx
            .update(documentVersions)
            .set({ isActive: true })
            .where(eq(documentVersions.id, latestVersion.id));

          // Update document metadata to match the new active version
          await tx
            .update(documents)
            .set({
              filePath: latestVersion.filePath,
              fileSize: latestVersion.fileSize,
              fileType: latestVersion.fileType,
              mimeType: latestVersion.mimeType,
            })
            .where(eq(documents.id, documentId));
        }
      }

      return true;
    });
  }

  // Folders
  async createFolder(insertFolder: InsertFolder): Promise<Folder> {
    const [folder] = await db
      .insert(folders)
      .values({
        ...insertFolder,
        color: insertFolder.color ?? "#f59e0b",
      })
      .returning();
    return folder;
  }

  async getFolders(): Promise<(Folder & { documentCount: number })[]> {
    await this.ensureInitialized();
    
    // Get all folders with their basic info
    const allFolders = await db
      .select({
        id: folders.id,
        name: folders.name,
        color: folders.color,
        parentId: folders.parentId,
        isAutoCreated: folders.isAutoCreated,
        category: folders.category,
        documentType: folders.documentType,
        gcsPath: folders.gcsPath,
        createdAt: folders.createdAt,
      })
      .from(folders)
      .orderBy(folders.name);

    // Calculate document counts for each folder
    const foldersWithCounts = await Promise.all(
      allFolders.map(async (folder) => {
        let documentCount = 0;

        if (!folder.parentId) {
          // For main category folders (no parent), count all documents in subfolders
          const subfolderDocs = await db
            .select({
              count: sql<number>`CAST(COUNT(${documents.id}) AS INTEGER)`,
            })
            .from(documents)
            .innerJoin(folders, eq(documents.folderId, folders.id))
            .where(
              and(
                eq(folders.parentId, folder.id),
                eq(documents.isDeleted, false),
                eq(documents.status, 'active')
              )
            );

          documentCount = subfolderDocs[0]?.count || 0;
        } else {
          // For subfolders, count direct documents
          const directDocs = await db
            .select({
              count: sql<number>`CAST(COUNT(${documents.id}) AS INTEGER)`,
            })
            .from(documents)
            .where(
              and(
                eq(documents.folderId, folder.id),
                eq(documents.isDeleted, false),
                eq(documents.status, 'active')
              )
            );

          documentCount = directDocs[0]?.count || 0;
        }

        return {
          ...folder,
          documentCount,
        };
      })
    );

    return foldersWithCounts;
  }

  async updateFolder(id: string, updates: Partial<InsertFolder>): Promise<Folder | undefined> {
    const [updatedFolder] = await db
      .update(folders)
      .set(updates)
      .where(eq(folders.id, id))
      .returning();

    return updatedFolder;
  }

  async deleteFolder(id: string): Promise<boolean> {
    const result = await db
      .delete(folders)
      .where(eq(folders.id, id))
      .returning();

    return result.length > 0;
  }

  // Tags
  async createTag(insertTag: InsertTag): Promise<Tag> {
    const [tag] = await db
      .insert(tags)
      .values({
        ...insertTag,
        color: insertTag.color ?? "#3b82f6",
      })
      .returning();
    return tag;
  }

  async getTags(): Promise<Tag[]> {
    await this.ensureInitialized();
    return await db
      .select()
      .from(tags)
      .orderBy(tags.name);
  }

  async updateTag(id: string, updates: Partial<InsertTag>): Promise<Tag | undefined> {
    const [updatedTag] = await db
      .update(tags)
      .set(updates)
      .where(eq(tags.id, id))
      .returning();

    return updatedTag;
  }

  async deleteTag(id: string): Promise<boolean> {
    const result = await db
      .delete(tags)
      .where(eq(tags.id, id))
      .returning();

    return result.length > 0;
  }

  // Document Tags
  async addDocumentTag(insertDocumentTag: InsertDocumentTag): Promise<DocumentTag> {
    const [documentTag] = await db
      .insert(documentTags)
      .values(insertDocumentTag)
      .returning();
    return documentTag;
  }

  async removeDocumentTags(documentId: string): Promise<void> {
    await db
      .delete(documentTags)
      .where(eq(documentTags.documentId, documentId));
  }

  async removeDocumentTag(documentId: string, tagId: string): Promise<void> {
    await db
      .delete(documentTags)
      .where(
        sql`${documentTags.documentId} = ${documentId} AND ${documentTags.tagId} = ${tagId}`
      );
  }

  // AI Analysis
  async analyzeDocumentWithAI(documentId: string, driveContent?: string, driveAccessToken?: string): Promise<boolean> {
    try {
      // Import here to avoid circular dependencies
      const { summarizeDocument, analyzeDocumentContent, extractTextFromDocument } = await import("./gemini.js");
      
      // Get the document
      const document = await this.getDocumentById(documentId);
      if (!document) {
        return false;
      }

      // Extract text from the document
      let documentText: string;
      
      if (driveContent) {
        // Use provided Drive content directly
        documentText = driveContent;
      } else {
        // Extract from stored file
        if (!document.filePath) {
          console.error("Document has no file path for AI analysis");
          return false;
        }
        
        // Pass Drive access token for Drive documents
        documentText = await extractTextFromDocument(document.filePath, document.mimeType, driveAccessToken);
        
        // Check if extraction failed or returned placeholder content
        if (documentText.startsWith('Error extracting text') || 
            documentText.startsWith('Google Drive document content extraction requires authentication') ||
            documentText.includes('Text extraction from') ||
            documentText.length < 10) {
          console.warn(`Failed to extract meaningful text from document ${documentId}: ${document.filePath}`);
          return false;
        }
      }
      
      // Generate AI analysis
      const [summary, analysis] = await Promise.all([
        summarizeDocument(documentText),
        analyzeDocumentContent(documentText)
      ]);

      // Update the document with AI analysis AND save content for search
      const [updatedDoc] = await db
        .update(documents)
        .set({
          aiSummary: summary,
          aiKeyTopics: analysis.keyTopics,
          aiDocumentType: analysis.documentType,
          aiCategory: analysis.category, // Store the AI-classified category
          aiSentiment: "neutral", // TODO: Add actual sentiment analysis
          aiWordCount: analysis.wordCount,
          aiAnalyzedAt: new Date(),
          // Enhanced AI fields
          aiConciseName: analysis.conciseTitle,
          aiCategoryConfidence: analysis.categoryConfidence,
          aiDocumentTypeConfidence: analysis.documentTypeConfidence,
          // Save the document content for search functionality
          documentContent: documentText,
          contentExtracted: true,
          contentExtractedAt: new Date()
        })
        .where(eq(documents.id, documentId))
        .returning();

      // Automatically organize the document into folders based on AI classification
      if (updatedDoc && analysis.category && analysis.documentType) {
        try {
          await this.organizeDocumentIntoFolder(documentId, analysis.category, analysis.documentType);
        } catch (orgError) {
          console.error("Failed to auto-organize document, but continuing:", orgError);
          // Don't fail the AI analysis if organization fails
        }
      }

      return !!updatedDoc;
    } catch (error) {
      console.error("Error analyzing document with AI:", error);
      return false;
    }
  }

  async extractDocumentContent(documentId: string, driveAccessToken?: string): Promise<boolean> {
    try {
      // Import here to avoid circular dependencies
      const { extractTextFromDocument } = await import("./gemini.js");
      
      
      // Get the document
      const document = await this.getDocumentById(documentId);
      if (!document) {
        console.error(`Document not found: ${documentId}`);
        return false;
      }

      // Skip if content already extracted
      if (document.contentExtracted) {
        return true;
      }

      // Check if document has a file path
      if (!document.filePath) {
        console.error(`Document has no file path for content extraction: ${documentId}`);
        return false;
      }

      // Extract text content - pass Drive access token if provided
      const documentText = await extractTextFromDocument(document.filePath, document.mimeType, driveAccessToken);
      
      // Check if extraction failed with authentication error
      if (documentText.includes('Google Drive document content extraction requires authentication')) {
        console.error(`Drive authentication required for document: ${documentId}`);
        return false;
      }
      
      // Update the document with extracted content
      const [updatedDoc] = await db
        .update(documents)
        .set({
          documentContent: documentText,
          contentExtracted: true,
          contentExtractedAt: new Date()
        })
        .where(eq(documents.id, documentId))
        .returning();

      const success = !!updatedDoc;
      if (success) {
      } else {
        console.error(`Failed to update document with extracted content: ${documentId}`);
      }

      return success;
    } catch (error) {
      console.error(`Error extracting document content for ${documentId}:`, error);
      return false;
    }
  }

  async getDocumentsWithoutContent(): Promise<Document[]> {
    await this.ensureInitialized();
    
    const documentsWithoutContent = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.isDeleted, false),
          eq(documents.status, 'active'),
          eq(documents.contentExtracted, false)
        )
      )
      .orderBy(desc(documents.uploadedAt))
      .limit(100); // Limit to 100 documents at a time for performance
    
    return documentsWithoutContent;
  }

  // Automatic Folder Organization Methods
  async findOrCreateCategoryFolder(category: string): Promise<Folder> {
    await this.ensureInitialized();
    
    // Validate that category is one of the predefined categories
    if (!MAIN_CATEGORIES.includes(category as MainCategory)) {
      // Default to "Personal" for invalid categories
      category = "Personal";
    }
    
    // Create GCS path with proper sanitization
    const gcsPath = `/categories/${this.slugify(category)}`;
    
    // Try to insert with ON CONFLICT DO NOTHING
    const insertResult = await db
      .insert(folders)
      .values({
        name: category,
        color: this.getCategoryColor(category),
        parentId: null,
        isAutoCreated: true,
        category: category,
        documentType: null,
        gcsPath: gcsPath,
      })
      .onConflictDoNothing()
      .returning();
    
    if (insertResult.length > 0) {
      return insertResult[0];
    }
    
    // Folder already exists, fetch it
    const existingFolder = await db
      .select()
      .from(folders)
      .where(
        and(
          eq(folders.category, category),
          eq(folders.isAutoCreated, true),
          sql`parent_id IS NULL`
        )
      )
      .limit(1);
    
    if (existingFolder.length > 0) {
      return existingFolder[0];
    }
    
    throw new Error(`Failed to create or find category folder: ${category}`);
  }

  async findOrCreateSubFolder(parentId: string, documentType: string): Promise<Folder> {
    await this.ensureInitialized();
    
    // Normalize document type for folder naming
    const normalizedType = this.normalizeDocumentType(documentType);
    if (!normalizedType || normalizedType.trim() === '') {
      throw new Error('Document type cannot be empty after normalization');
    }
    
    // Get parent folder to construct GCS path
    const parentFolder = await db
      .select()
      .from(folders)
      .where(eq(folders.id, parentId))
      .limit(1);
    
    if (parentFolder.length === 0) {
      throw new Error(`Parent folder ${parentId} not found`);
    }
    
    // Create GCS path with proper sanitization
    const gcsPath = `${parentFolder[0].gcsPath}/${this.slugify(normalizedType)}`;
    
    // Try to insert with ON CONFLICT DO NOTHING
    const insertResult = await db
      .insert(folders)
      .values({
        name: normalizedType,
        color: "#9ca3af", // Gray color for sub-folders
        parentId: parentId,
        isAutoCreated: true,
        category: parentFolder[0].category,
        documentType: normalizedType,
        gcsPath: gcsPath,
      })
      .onConflictDoNothing()
      .returning();
    
    if (insertResult.length > 0) {
      return insertResult[0];
    }
    
    // Sub-folder already exists, fetch it
    const existingSubFolder = await db
      .select()
      .from(folders)
      .where(
        and(
          eq(folders.parentId, parentId),
          eq(folders.documentType, normalizedType),
          eq(folders.isAutoCreated, true)
        )
      )
      .limit(1);
    
    if (existingSubFolder.length > 0) {
      return existingSubFolder[0];
    }
    
    throw new Error(`Failed to create or find sub-folder: ${normalizedType} under ${parentId}`);
  }

  async organizeDocumentIntoFolder(documentId: string, category: string, documentType: string): Promise<boolean> {
    try {
      await this.ensureInitialized();
      
      // Find or create the main category folder
      const categoryFolder = await this.findOrCreateCategoryFolder(category);
      
      // Find or create the document type sub-folder
      const subFolder = await this.findOrCreateSubFolder(categoryFolder.id, documentType);
      
      // Update the document to assign it to the sub-folder
      const [updatedDoc] = await db
        .update(documents)
        .set({
          folderId: subFolder.id
        })
        .where(eq(documents.id, documentId))
        .returning();
      
      return !!updatedDoc;
    } catch (error) {
      console.error("Error organizing document into folder:", error);
      return false;
    }
  }

  // Helper methods
  private getCategoryColor(category: string): string {
    const categoryColors: Record<string, string> = {
      "Taxes": "#dc2626", // Red
      "Medical": "#059669", // Green
      "Insurance": "#2563eb", // Blue
      "Legal": "#7c3aed", // Purple
      "Immigration": "#ea580c", // Orange
      "Financial": "#0891b2", // Cyan
      "Employment": "#65a30d", // Lime
      "Education": "#c2410c", // Amber
      "Real Estate": "#be123c", // Rose
      "Travel": "#0d9488", // Teal
      "Personal": "#6366f1", // Indigo
      "Business": "#4338ca", // Violet
    };
    return categoryColors[category] || "#f59e0b"; // Default gold
  }

  private normalizeDocumentType(documentType: string): string {
    // Normalize common document type variations
    const typeMap: Record<string, string> = {
      "report": "Reports",
      "contract": "Contracts", 
      "letter": "Letters",
      "invoice": "Invoices",
      "resume": "Resumes",
      "cv": "Resumes",
      "receipt": "Receipts",
      "statement": "Statements",
      "form": "Forms",
      "application": "Applications",
      "certificate": "Certificates",
      "license": "Licenses",
      "policy": "Policies",
      "agreement": "Agreements",
      "memo": "Memos",
      "proposal": "Proposals",
      "presentation": "Presentations",
      "spreadsheet": "Spreadsheets",
      "technical documentation": "Technical Docs",
    };
    
    const normalized = typeMap[documentType.toLowerCase()] || documentType;
    // Capitalize first letter and ensure proper format
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  private slugify(text: string): string {
    if (!text || typeof text !== 'string') {
      return 'uncategorized';
    }
    
    const slug = text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-\s]/g, '') // Remove invalid characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
    
    // Ensure we have a valid slug
    return slug || 'uncategorized';
  }

  // Method to organize all unorganized documents
  async organizeAllUnorganizedDocuments(): Promise<{ organized: number; errors: string[] }> {
    try {
      await this.ensureInitialized();
      
      console.log("Starting organization of unorganized documents...");
      
      // Get all documents that have AI categories but no folder assignment
      const unorganizedDocs = await db
        .select({
          id: documents.id,
          name: documents.name,
          aiCategory: documents.aiCategory,
          aiDocumentType: documents.aiDocumentType,
        })
        .from(documents)
        .where(
          and(
            eq(documents.isDeleted, false),
            eq(documents.status, 'active'),
            sql`${documents.aiCategory} IS NOT NULL`,
            sql`${documents.folderId} IS NULL`
          )
        );

      console.log(`Found ${unorganizedDocs.length} unorganized documents:`, unorganizedDocs.map(d => ({ name: d.name, category: d.aiCategory, type: d.aiDocumentType })));

      let organized = 0;
      const errors: string[] = [];

      for (const doc of unorganizedDocs) {
        if (doc.aiCategory && doc.aiDocumentType) {
          try {
            const success = await this.organizeDocumentIntoFolder(doc.id, doc.aiCategory, doc.aiDocumentType);
            if (success) {
              organized++;
              console.log(`✓ Organized "${doc.name}" into ${doc.aiCategory}/${doc.aiDocumentType}`);
            } else {
              errors.push(`Failed to organize "${doc.name}"`);
            }
          } catch (error) {
            const errorMsg = `Error organizing "${doc.name}": ${error instanceof Error ? error.message : 'Unknown error'}`;
            errors.push(errorMsg);
            console.error(errorMsg);
          }
        } else {
          errors.push(`"${doc.name}" missing AI category or document type`);
        }
      }

      console.log(`Organization complete: ${organized} organized, ${errors.length} errors`);
      return { organized, errors };
    } catch (error) {
      console.error("Error in organizeAllUnorganizedDocuments:", error);
      throw error;
    }
  }

  // AI Analysis Queue Management Methods
  async enqueueDocumentForAnalysis(documentId: string, userId: string, priority: number = 5): Promise<AiAnalysisQueue> {
    await this.ensureInitialized();
    
    try {
      // Estimate tokens based on document content or size
      const document = await this.getDocumentById(documentId);
      let estimatedTokens = 3000; // Default estimate
      
      if (document && document.documentContent) {
        // Rough estimate: 1 token ≈ 4 characters
        estimatedTokens = Math.ceil(document.documentContent.length / 4) + 1000; // Add buffer for prompt
      } else if (document && document.fileSize) {
        // Estimate based on file size (very rough)
        estimatedTokens = Math.min(Math.ceil(document.fileSize / 5), 8000); // Cap at 8k tokens
      }

      const [queueJob] = await db
        .insert(aiAnalysisQueue)
        .values({
          documentId,
          userId,
          priority,
          estimatedTokens,
          status: "pending",
          scheduledAt: new Date(), // Schedule immediately by default
        })
        .onConflictDoNothing() // Handle duplicate prevention from unique index
        .returning();

      if (!queueJob) {
        // Job already exists, get existing one
        const existingJob = await db
          .select()
          .from(aiAnalysisQueue)
          .where(
            and(
              eq(aiAnalysisQueue.documentId, documentId),
              inArray(aiAnalysisQueue.status, ["pending", "processing"])
            )
          )
          .limit(1);
        
        if (existingJob[0]) {
          return existingJob[0];
        }
        throw new Error("Failed to enqueue document and no existing job found");
      }

      return queueJob;
    } catch (error) {
      console.error(`❌ Failed to enqueue document ${documentId} for analysis:`, error);
      throw error;
    }
  }

  async enqueueDocumentForEmbedding(documentId: string, userId: string, priority: number = 8): Promise<AiAnalysisQueue> {
    await this.ensureInitialized();
    
    try {
      // Check if document already has embeddings
      const document = await this.getDocumentById(documentId);
      if (document?.embeddingsGenerated) {
        console.log(`Document ${documentId} already has embeddings, skipping`);
        // Return a dummy completed job
        const existingJob = await db
          .select()
          .from(aiAnalysisQueue)
          .where(
            and(
              eq(aiAnalysisQueue.documentId, documentId),
              eq(aiAnalysisQueue.jobType, "embedding_generation")
            )
          )
          .limit(1);
        
        if (existingJob[0]) {
          return existingJob[0];
        }
      }

      // Estimate tokens for embedding generation (much lower than analysis)
      let estimatedTokens = 500; // Base estimate for embeddings
      
      if (document && document.documentContent) {
        // Rough estimate: embeddings use fewer tokens than analysis
        estimatedTokens = Math.ceil(document.documentContent.length / 8) + 200; // Much lower than analysis
      } else if (document && document.fileSize) {
        // Conservative estimate for embedding generation
        estimatedTokens = Math.min(Math.ceil(document.fileSize / 10), 2000); // Cap at 2k tokens
      }

      const [queueJob] = await db
        .insert(aiAnalysisQueue)
        .values({
          documentId,
          userId,
          jobType: "embedding_generation",
          priority, // Default 8 for background embedding generation
          estimatedTokens,
          status: "pending",
          scheduledAt: new Date(),
        })
        .onConflictDoNothing() // Handle duplicate prevention
        .returning();

      if (!queueJob) {
        // Job already exists, get existing one
        const existingJob = await db
          .select()
          .from(aiAnalysisQueue)
          .where(
            and(
              eq(aiAnalysisQueue.documentId, documentId),
              eq(aiAnalysisQueue.jobType, "embedding_generation"),
              inArray(aiAnalysisQueue.status, ["pending", "processing"])
            )
          )
          .limit(1);
        
        if (existingJob[0]) {
          return existingJob[0];
        }
        throw new Error("Failed to enqueue document for embedding generation and no existing job found");
      }

      console.log(`📊 Enqueued document ${documentId} for embedding generation`);
      return queueJob;
    } catch (error) {
      console.error(`❌ Failed to enqueue document ${documentId} for embedding generation:`, error);
      throw error;
    }
  }

  async bulkEnqueueDocumentsForEmbedding(userId: string, priority: number = 9): Promise<{queued: number; skipped: number; errors: string[]}> {
    await this.ensureInitialized();
    
    console.log(`📊 Starting bulk embedding generation queue for user ${userId}`);
    
    try {
      // Find all documents that need embeddings (analyzed but no embeddings)
      const documentsNeedingEmbeddings = await db
        .select({
          id: documents.id,
          name: documents.name,
          embeddingsGenerated: documents.embeddingsGenerated,
          aiAnalyzedAt: documents.aiAnalyzedAt
        })
        .from(documents)
        .where(
          and(
            eq(documents.isDeleted, false),
            isNotNull(documents.aiAnalyzedAt), // Only documents that have been analyzed
            or(
              eq(documents.embeddingsGenerated, false),
              sql`${documents.embeddingsGenerated} IS NULL`
            )
          )
        )
        .orderBy(desc(documents.aiAnalyzedAt)); // Process most recently analyzed first

      console.log(`Found ${documentsNeedingEmbeddings.length} documents needing embeddings`);
      
      if (documentsNeedingEmbeddings.length === 0) {
        return { queued: 0, skipped: 0, errors: [] };
      }

      let queued = 0;
      let skipped = 0;
      const errors: string[] = [];

      // Check if we should limit the bulk operation to avoid overwhelming the queue
      const maxBulkSize = 50; // Limit bulk operations to 50 documents at a time
      const documentsToProcess = documentsNeedingEmbeddings.slice(0, maxBulkSize);
      
      if (documentsNeedingEmbeddings.length > maxBulkSize) {
        console.log(`Limiting bulk operation to ${maxBulkSize} documents (${documentsNeedingEmbeddings.length} total need embeddings)`);
      }

      for (const doc of documentsToProcess) {
        try {
          // Check if already in queue
          const existingJob = await db
            .select()
            .from(aiAnalysisQueue)
            .where(
              and(
                eq(aiAnalysisQueue.documentId, doc.id),
                eq(aiAnalysisQueue.jobType, "embedding_generation"),
                inArray(aiAnalysisQueue.status, ["pending", "processing"])
              )
            )
            .limit(1);

          if (existingJob.length > 0) {
            console.log(`Skipping ${doc.name} - already in embedding queue`);
            skipped++;
            continue;
          }

          // Enqueue for embedding generation
          await this.enqueueDocumentForEmbedding(doc.id, userId, priority);
          queued++;
          console.log(`📊 Queued ${doc.name} for embedding generation`);

        } catch (error) {
          const errorMsg = `Failed to enqueue ${doc.name}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          errors.push(errorMsg);
          console.warn(errorMsg);
        }
      }

      console.log(`📊 Bulk embedding queue complete: ${queued} queued, ${skipped} skipped, ${errors.length} errors`);
      return { queued, skipped, errors };

    } catch (error) {
      console.error('Error in bulkEnqueueDocumentsForEmbedding:', error);
      throw error;
    }
  }

  async dequeueNextAnalysisJob(): Promise<AiAnalysisQueue | null> {
    await this.ensureInitialized();
    
    try {
      // Check daily quota first
      const today = new Date().toISOString().split('T')[0];
      const quotaCheck = await this.canProcessAnalysis();
      
      if (!quotaCheck.canProcess) {
        return null;
      }

      // Get next job by priority and schedule time
      const [nextJob] = await db
        .select()
        .from(aiAnalysisQueue)
        .where(
          and(
            eq(aiAnalysisQueue.status, "pending"),
            sql`scheduled_at <= NOW()`
          )
        )
        .orderBy(aiAnalysisQueue.priority, aiAnalysisQueue.requestedAt)
        .limit(1);

      if (!nextJob) {
        return null;
      }

      // Mark as processing
      const [processingJob] = await db
        .update(aiAnalysisQueue)
        .set({
          status: "processing",
          processedAt: new Date(),
        })
        .where(eq(aiAnalysisQueue.id, nextJob.id))
        .returning();

      return processingJob;
    } catch (error) {
      console.error("❌ Failed to dequeue analysis job:", error);
      return null;
    }
  }

  async updateQueueJobStatus(jobId: string, status: string, failureReason?: string): Promise<boolean> {
    await this.ensureInitialized();
    
    try {
      const updateData: any = { status };
      
      if (status === "failed" && failureReason) {
        updateData.failureReason = failureReason;
        updateData.retryCount = sql`retry_count + 1`;
      }

      const [updatedJob] = await db
        .update(aiAnalysisQueue)
        .set(updateData)
        .where(eq(aiAnalysisQueue.id, jobId))
        .returning();

      if (updatedJob) {
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`❌ Failed to update queue job ${jobId} status:`, error);
      return false;
    }
  }

  async getQueueStatus(userId?: string): Promise<{pending: number; processing: number; completed: number; failed: number}> {
    await this.ensureInitialized();
    
    try {
      const whereClause = userId ? eq(aiAnalysisQueue.userId, userId) : undefined;
      
      const statusCounts = await db
        .select({
          status: aiAnalysisQueue.status,
          count: count()
        })
        .from(aiAnalysisQueue)
        .where(whereClause)
        .groupBy(aiAnalysisQueue.status);

      const result = {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0
      };

      statusCounts.forEach(item => {
        if (item.status in result) {
          (result as any)[item.status] = item.count;
        }
      });

      return result;
    } catch (error) {
      console.error("❌ Failed to get queue status:", error);
      return { pending: 0, processing: 0, completed: 0, failed: 0 };
    }
  }

  async getQueueJobsByUser(userId: string): Promise<AiAnalysisQueue[]> {
    await this.ensureInitialized();
    
    try {
      const jobs = await db
        .select()
        .from(aiAnalysisQueue)
        .where(eq(aiAnalysisQueue.userId, userId))
        .orderBy(desc(aiAnalysisQueue.requestedAt))
        .limit(50); // Limit to recent 50 jobs

      return jobs;
    } catch (error) {
      console.error(`❌ Failed to get queue jobs for user ${userId}:`, error);
      return [];
    }
  }

  // Daily API Usage Tracking Methods
  async incrementDailyUsage(date: string, tokens: number, success: boolean): Promise<DailyApiUsage> {
    await this.ensureInitialized();
    
    try {
      // Try to update existing record first
      const [existingUsage] = await db
        .select()
        .from(dailyApiUsage)
        .where(eq(dailyApiUsage.date, date))
        .limit(1);

      if (existingUsage) {
        // Update existing record
        const [updatedUsage] = await db
          .update(dailyApiUsage)
          .set({
            requestCount: sql`request_count + 1`,
            tokenCount: sql`token_count + ${tokens}`,
            successCount: success ? sql`success_count + 1` : existingUsage.successCount,
            failureCount: !success ? sql`failure_count + 1` : existingUsage.failureCount,
            lastUpdated: new Date(),
          })
          .where(eq(dailyApiUsage.id, existingUsage.id))
          .returning();

        return updatedUsage;
      } else {
        // Create new record
        const [newUsage] = await db
          .insert(dailyApiUsage)
          .values({
            date,
            requestCount: 1,
            tokenCount: tokens,
            successCount: success ? 1 : 0,
            failureCount: success ? 0 : 1,
          })
          .returning();

        return newUsage;
      }
    } catch (error) {
      console.error(`❌ Failed to increment daily usage for ${date}:`, error);
      throw error;
    }
  }

  async getDailyUsage(date: string): Promise<DailyApiUsage | null> {
    await this.ensureInitialized();
    
    try {
      const [usage] = await db
        .select()
        .from(dailyApiUsage)
        .where(eq(dailyApiUsage.date, date))
        .limit(1);

      return usage || null;
    } catch (error) {
      console.error(`❌ Failed to get daily usage for ${date}:`, error);
      return null;
    }
  }

  async canProcessAnalysis(): Promise<{canProcess: boolean; remaining: number; resetTime: string}> {
    await this.ensureInitialized();
    
    try {
      const today = new Date().toISOString().split('T')[0];
      const usage = await this.getDailyUsage(today);
      
      // Gemini 2.5 Flash-lite free tier limits: 1,500 requests per day
      const DAILY_LIMIT = 1200; // Use 1200 to leave safety buffer
      const used = usage?.requestCount || 0;
      const remaining = Math.max(0, DAILY_LIMIT - used);
      
      // Calculate next reset time (midnight Pacific Time)
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      tomorrow.setUTCHours(8, 0, 0, 0); // 8 UTC = midnight Pacific (PST)
      
      return {
        canProcess: remaining > 0,
        remaining,
        resetTime: tomorrow.toISOString()
      };
    } catch (error) {
      console.error("❌ Failed to check daily quota:", error);
      // In case of error, allow processing to avoid blocking system
      return {
        canProcess: true,
        remaining: 1000,
        resetTime: new Date().toISOString()
      };
    }
  }

}

export const storage = new DatabaseStorage();

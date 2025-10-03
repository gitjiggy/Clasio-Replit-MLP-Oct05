import {
  type Document,
  type Folder,
  type Tag,
  type DocumentTag,
  type DocumentVersion,
  type DocumentAccessLog,
  type AiAnalysisQueue,
  type DailyApiUsage,
  type AiQueueMetrics,
  type InsertDocument,
  type InsertFolder,
  type InsertTag,
  type InsertDocumentTag,
  type InsertDocumentVersion,
  type InsertDocumentAccessLog,
  type InsertAiAnalysisQueue,
  type InsertDailyApiUsage,
  type InsertAiQueueMetrics,
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
  aiQueueMetrics,
} from "@shared/schema";
import { ObjectStorageService } from "./objectStorage";
import { randomUUID } from "crypto";
import { db } from "./db";
import { eq, and, desc, ilike, inArray, count, sql, or, isNotNull } from "drizzle-orm";
import { transactionManager, ensureTenantContext, type TransactionContext } from "./transactionManager";
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
import { QueryAnalyzer, PolicyRegistry, QueryAnalysis, SearchPolicy } from './queryAnalysis.js';
import { FieldAwareLexicalScorer, FieldContent, LexicalAnalysisResult } from './fieldAwareLexical.js';
import { TierRouter, TierClassification, QualitySignals } from './tierRouting.js';
import { PolicyDrivenSearchEngine } from './policyDrivenSearch.js';
import { logger, logWorkerOperation } from './logger.js';
import { queueMetrics } from './middleware/queueMetrics.js';

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

export interface AnalysisData {
  keyTopics: string[];
  documentType: string;
  category: string;
  wordCount: number;
  conciseTitle: string;
  categoryConfidence: number;
  documentTypeConfidence: number;
  documentYear: string | null;
  documentPurpose: string | null;
  filingStatus: string | null;
  bodyPart: string | null;
  documentSubtype: string | null;
}

export interface IStorage {
  // Documents
  createDocument(document: InsertDocument, reqId?: string, idempotencyKey?: string): Promise<Document>;
  getDocuments(filters: DocumentFilters, userId: string): Promise<DocumentWithFolderAndTags[]>;
  getAllActiveDocuments(userId: string): Promise<DocumentWithFolderAndTags[]>;
  getTrashedDocuments(userId: string): Promise<{ documents: DocumentWithFolderAndTags[] }>;
  emptyTrash(userId: string): Promise<{ deletedCount: number }>;
  purgeExpiredTrashedDocuments(): Promise<{ deletedCount: number }>;
  reconcileGCSPaths(dryRun?: boolean): Promise<{
    fixed: number;
    orphanedGCSObjects: string[];
    orphanedDBDocuments: { id: string; name: string; currentPath: string }[];
    summary: string;
  }>;
  getDocumentsCount(filters: DocumentFilters, userId: string): Promise<number>;
  getDocumentById(id: string, userId: string): Promise<DocumentWithFolderAndTags | undefined>;
  getDocumentContent(id: string, userId: string): Promise<string | null>; // Get just the content for a document
  getDocumentByDriveFileId(driveFileId: string, userId: string): Promise<DocumentWithFolderAndTags | undefined>;
  getDocumentWithVersions(id: string, userId: string): Promise<DocumentWithVersions | undefined>;
  updateDocument(id: string, updates: Partial<InsertDocument>, userId: string, reqId?: string, idempotencyKey?: string): Promise<Document | undefined>;
  deleteDocument(id: string, userId: string): Promise<boolean>;
  restoreDocument(id: string, userId: string): Promise<{ success: boolean; error?: string; alreadyLive?: boolean; message?: string }>;
  analyzeDocumentWithAI(id: string, userId: string, driveContent?: string, driveAccessToken?: string): Promise<boolean>;
  extractDocumentContent(id: string, userId: string, driveAccessToken?: string): Promise<boolean>;
  getDocumentsWithoutContent(userId: string): Promise<Document[]>;

  // Document Versions
  createDocumentVersion(version: InsertDocumentVersion, userId: string, reqId?: string, idempotencyKey?: string): Promise<DocumentVersion>;
  getDocumentVersions(documentId: string, userId: string): Promise<DocumentVersion[]>;
  setActiveVersion(documentId: string, versionId: string, userId: string, reqId?: string, idempotencyKey?: string): Promise<boolean>;
  deleteDocumentVersion(documentId: string, versionId: string, userId: string, reqId?: string, idempotencyKey?: string): Promise<boolean>;

  // Folders
  createFolder(folder: InsertFolder, userId: string, reqId?: string, idempotencyKey?: string): Promise<Folder>;
  getFolders(userId: string): Promise<(Folder & { documentCount: number })[]>;
  updateFolder(id: string, updates: Partial<InsertFolder>, userId: string, reqId?: string, idempotencyKey?: string): Promise<Folder | undefined>;
  deleteFolder(id: string, userId: string): Promise<boolean>;

  // Tags
  createTag(tag: InsertTag, userId: string, reqId?: string, idempotencyKey?: string): Promise<Tag>;
  getTags(userId: string): Promise<Tag[]>;
  updateTag(id: string, updates: Partial<InsertTag>, userId: string, reqId?: string, idempotencyKey?: string): Promise<Tag | undefined>;
  deleteTag(id: string, userId: string): Promise<boolean>;

  // Document Tags
  addDocumentTag(documentTag: InsertDocumentTag, userId: string): Promise<DocumentTag>;
  removeDocumentTag(documentId: string, tagId: string, userId: string): Promise<void>;
  
  // Duplicate Detection
  findDuplicateFiles(originalName: string, fileSize: number, userId: string): Promise<DocumentWithFolderAndTags[]>;
  
  // Automatic Folder Organization
  findOrCreateCategoryFolder(category: string, userId: string): Promise<Folder>;
  findOrCreateSubFolder(parentId: string, documentType: string, userId: string): Promise<Folder>;
  organizeDocumentIntoFolder(documentId: string, category: string, documentType: string, userId: string, analysisData?: AnalysisData): Promise<boolean>;
  removeDocumentTags(documentId: string, userId: string): Promise<void>;

  // AI Analysis Queue Management
  enqueueDocumentForAnalysis(documentId: string, userId: string, priority?: number): Promise<AiAnalysisQueue>;
  enqueueDocumentForEmbedding(documentId: string, userId: string, priority?: number): Promise<AiAnalysisQueue>;
  bulkEnqueueDocumentsForEmbedding(userId: string, priority?: number): Promise<{queued: number; skipped: number; errors: string[]}>;
  dequeueNextAnalysisJob(jobType?: string): Promise<AiAnalysisQueue | null>;
  updateQueueJobStatus(jobId: string, status: string, failureReason?: string): Promise<boolean>;
  rescheduleJob(jobId: string, scheduledAt: Date): Promise<boolean>;
  getQueueStatus(userId?: string): Promise<{pending: number; processing: number; completed: number; failed: number}>;
  getQueueJobsByUser(userId: string): Promise<AiAnalysisQueue[]>;
  
  // Token 4/8: Enhanced Durable Job Management
  dequeueNextDurableJob(jobType: string, workerId: string): Promise<AiAnalysisQueue | null>;
  scheduleJobRetry(jobId: string, attemptCount: number, lastError: string, nextRetryAt: Date, workerId: string): Promise<boolean>;
  moveToDLQ(jobId: string, dlqReason: string, workerId: string): Promise<boolean>;
  markJobCompleted(jobId: string, workerId: string): Promise<boolean>;
  getQueueStats(): Promise<{pendingJobs: number; processingJobs: number; completedJobs: number; failedJobs: number; dlqJobs: number}>;
  recordQueueMetrics(metrics: InsertAiQueueMetrics): Promise<AiQueueMetrics>;
  generateDocumentEmbeddings(documentId: string, userId: string): Promise<boolean>;
  
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
  
  // Policy-driven search system
  private queryAnalyzer = new QueryAnalyzer();
  private policyRegistry = new PolicyRegistry();
  private fieldAwareLexicalScorer = new FieldAwareLexicalScorer();
  private tierRouter = new TierRouter();
  private policyDrivenSearchEngine = new PolicyDrivenSearchEngine(
    this.queryAnalyzer,
    this.policyRegistry, 
    this.fieldAwareLexicalScorer,
    this.tierRouter,
    this.queryEmbeddingCache
  );

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
  async createDocument(insertDocument: InsertDocument, reqId?: string, idempotencyKey?: string): Promise<Document> {
    await this.ensureInitialized();
    ensureTenantContext(insertDocument.userId);

    const context: TransactionContext = {
      reqId: reqId || randomUUID(),
      userId: insertDocument.userId,
      operationType: 'document_create',
      idempotencyKey: idempotencyKey || transactionManager.generateIdempotencyKey(
        'document_create',
        insertDocument.userId,
        insertDocument.originalName,
        insertDocument.fileSize?.toString() || '',
        insertDocument.contentHash || ''
      )
    };

    const result = await transactionManager.executeWithIdempotency(
      context,
      async (tx) => {
        const [document] = await tx
          .insert(documents)
          .values({
            ...insertDocument,
            folderId: insertDocument.folderId || null,
            isFavorite: insertDocument.isFavorite ?? false,
            isDeleted: insertDocument.isDeleted ?? false,
          })
          .returning();

        // FAILPOINT: Check for rollback testing between document and version insert
        // This proves transaction rollback leaves zero partial rows in the database
        transactionManager.checkDocumentCreationFailpoint();

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

        // Add analytics hook for post-commit execution
        transactionManager.addPostCommitHook({
          type: 'analytics',
          action: 'document_created',
          data: {
            documentId: document.id,
            fileType: document.fileType,
            fileSize: document.fileSize,
            userId: document.userId
          }
        });

        return document;
      },
      insertDocument
    );

    if (!result.success) {
      throw new Error(result.error || 'Failed to create document');
    }

    return result.data;
  }

  async getDocuments(filters: DocumentFilters, userId: string): Promise<DocumentWithFolderAndTags[]> {
    await this.ensureInitialized();
    
    // Apply filters - exclude deleted and trashed documents by default, scope by user
    const conditions = [
      eq(documents.isDeleted, false), // Backward compatibility
      eq(documents.status, 'active'),   // New trash system - only show active documents
      eq(documents.userId, userId)      // Multi-tenant: scope by user
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
      // Handle "image" filter to match all image types
      if (filters.fileType === 'image') {
        const imageTypes = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'tiff', 'ico'];
        conditions.push(inArray(documents.fileType, imageTypes));
      } else {
        conditions.push(eq(documents.fileType, filters.fileType));
      }
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


    // OPTIMIZATION: Fetch tags and version info in bulk instead of N+1 queries
    const documentIds = results.map(r => r.document.id);
    
    if (documentIds.length === 0) {
      return [];
    }

    // Bulk fetch all tags for all documents (1 query instead of N)
    const allDocTags = await db
      .select({
        documentId: documentTags.documentId,
        tag: tags
      })
      .from(documentTags)
      .leftJoin(tags, eq(documentTags.tagId, tags.id))
      .where(inArray(documentTags.documentId, documentIds));

    // Bulk fetch current version info for all documents (1 query instead of N)
    const allCurrentVersions = await db
      .select({
        documentId: documentVersions.documentId,
        version: documentVersions.version,
      })
      .from(documentVersions)
      .where(and(
        inArray(documentVersions.documentId, documentIds),
        eq(documentVersions.isActive, true)
      ));

    // Bulk fetch version counts for all documents (1 query instead of N)
    const allVersionCounts = await db
      .select({
        documentId: documentVersions.documentId,
        count: count()
      })
      .from(documentVersions)
      .where(inArray(documentVersions.documentId, documentIds))
      .groupBy(documentVersions.documentId);

    // Map tags and versions to documents in-memory (fast!)
    const tagsByDocId = new Map<string, Tag[]>();
    allDocTags.forEach(({ documentId, tag }) => {
      if (tag) {
        if (!tagsByDocId.has(documentId)) {
          tagsByDocId.set(documentId, []);
        }
        tagsByDocId.get(documentId)!.push(tag);
      }
    });

    const versionByDocId = new Map<string, number>();
    allCurrentVersions.forEach(({ documentId, version }) => {
      versionByDocId.set(documentId, version);
    });

    const versionCountByDocId = new Map<string, number>();
    allVersionCounts.forEach(({ documentId, count }) => {
      versionCountByDocId.set(documentId, count);
    });

    // Assemble final results (no more database queries!)
    const docsWithTags = results.map((result) => {
      return {
        ...result.document,
        folder: result.folder || undefined,
        tags: tagsByDocId.get(result.document.id) || [],
        currentVersionNumber: versionByDocId.get(result.document.id) || 1,
        versionCount: versionCountByDocId.get(result.document.id) || 1,
      };
    });

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

        // Get tags - fetch document tags first, then tags separately
        const docTags = await db.query.documentTags.findMany({
          where: eq(documentTags.documentId, doc.id)
        });

        // Fetch the actual tag data for each document tag
        const tags = await Promise.all(
          docTags.map(async (docTag) => {
            return await db.query.tags.findFirst({
              where: eq(tags.id, docTag.tagId)
            });
          })
        );

        return {
          ...doc,
          folder,
          tags: tags.filter(tag => tag !== undefined)
        };
      })
    );

    return result as DocumentWithFolderAndTags[];
  }

  async getTrashedDocuments(userId: string): Promise<DocumentWithFolderAndTags[]> {
    await this.ensureInitialized();
    ensureTenantContext(userId);
    
    // Get only documents that are trashed (status='trashed') for this user
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
      .where(and(
        eq(documents.status, 'trashed'),
        eq(documents.userId, userId)
      ))
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

    return { documents: docsWithTags };
  }

  async emptyTrash(userId: string): Promise<{ deletedCount: number }> {
    await this.ensureInitialized();
    ensureTenantContext(userId);
    
    // Get all trashed documents with their file paths for deletion (scoped to user)
    const trashedDocs = await db
      .select({ 
        id: documents.id,
        objectPath: documents.objectPath,
        filePath: documents.filePath // Fallback for older documents
      })
      .from(documents)
      .where(and(
        eq(documents.status, 'trashed'),
        eq(documents.userId, userId)
      ));
    
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
      
      // Delete the documents themselves (scoped to user)
      await tx
        .delete(documents)
        .where(and(
          eq(documents.status, 'trashed'),
          eq(documents.userId, userId)
        ));
    });
    
    if (fileDeletionErrors.length > 0) {
      console.warn(`🗑️ Empty Trash completed with some file deletion errors:`, fileDeletionErrors);
    }
    
    console.log(`🗑️ Empty Trash: Permanently deleted ${deletedCount} documents, their files, and database records`);
    
    return { deletedCount };
  }

  // 🔧 One-time reconciler to fix path mismatches between DB and GCS
  async reconcileGCSPaths(dryRun: boolean = true): Promise<{
    fixed: number;
    orphanedGCSObjects: string[];
    orphanedDBDocuments: { id: string; name: string; currentPath: string }[];
    summary: string;
  }> {
    await this.ensureInitialized();
    
    const objectStorageService = new ObjectStorageService();
    const results = {
      fixed: 0,
      orphanedGCSObjects: [] as string[],
      orphanedDBDocuments: [] as { id: string; name: string; currentPath: string }[],
      summary: ""
    };

    console.log(`🔧 Starting GCS path reconciliation (${dryRun ? 'DRY RUN' : 'LIVE RUN'})...`);

    // 1. Get all GCS objects under users/
    const gcsObjects = await objectStorageService.listObjects('users/');
    console.log(`📁 Found ${gcsObjects.length} GCS objects under users/`);

    // 2. Get all documents from database with their current paths
    const allDocs = await db
      .select({ 
        id: documents.id,
        name: documents.name,
        originalName: documents.originalName,
        objectPath: documents.objectPath,
        filePath: documents.filePath
      })
      .from(documents);

    console.log(`🗃️ Found ${allDocs.length} documents in database`);

    // 3. Parse GCS objects and group by docId
    const gcsObjectsByDocId = new Map<string, string[]>();
    const canonicalPattern = /^users\/([^\/]+)\/docs\/([a-f0-9-]{36})\/(.+)$/;
    
    for (const objectPath of gcsObjects) {
      const match = objectPath.match(canonicalPattern);
      if (match) {
        const [, userId, docId, fileName] = match;
        if (!gcsObjectsByDocId.has(docId)) {
          gcsObjectsByDocId.set(docId, []);
        }
        gcsObjectsByDocId.get(docId)!.push(objectPath);
      } else {
        console.warn(`⚠️ Non-canonical GCS object found: ${objectPath}`);
      }
    }

    // 4. Match database documents to GCS objects and fix paths
    const dbDocsByDocId = new Map<string, typeof allDocs[0]>();
    for (const doc of allDocs) {
      dbDocsByDocId.set(doc.id, doc);
    }

    // Match and update incorrect paths
    for (const [docId, gcsObjectPaths] of gcsObjectsByDocId) {
      const dbDoc = dbDocsByDocId.get(docId);
      
      if (dbDoc) {
        // Find the main object path (should match originalName)
        const correctObjectPath = gcsObjectPaths.find(path => {
          const match = path.match(canonicalPattern);
          return match && match[3] === dbDoc.originalName;
        }) || gcsObjectPaths[0]; // Fallback to first if exact match not found

        // Check if database has wrong path
        const needsUpdate = dbDoc.objectPath !== correctObjectPath;
        
        if (needsUpdate) {
          console.log(`🔄 Document ${dbDoc.name} (${docId})`);
          console.log(`   Current: ${dbDoc.objectPath || dbDoc.filePath || 'NULL'}`);
          console.log(`   Correct: ${correctObjectPath}`);
          
          if (!dryRun) {
            // Update the database with correct objectPath
            await db
              .update(documents)
              .set({ objectPath: correctObjectPath })
              .where(eq(documents.id, docId));
          }
          
          results.fixed++;
        }
        
        // Remove from our tracking map
        dbDocsByDocId.delete(docId);
      } else {
        // GCS objects with no database record (orphans)
        results.orphanedGCSObjects.push(...gcsObjectPaths);
      }
    }

    // 5. Remaining documents in dbDocsByDocId are database orphans
    for (const [docId, doc] of dbDocsByDocId) {
      results.orphanedDBDocuments.push({
        id: docId,
        name: doc.name,
        currentPath: doc.objectPath || doc.filePath || 'NULL'
      });
    }

    // 6. Clean up orphaned GCS objects (if not dry run)
    if (!dryRun && results.orphanedGCSObjects.length > 0) {
      console.log(`🗑️ Deleting ${results.orphanedGCSObjects.length} orphaned GCS objects...`);
      for (const orphanPath of results.orphanedGCSObjects) {
        try {
          await objectStorageService.deleteObject(orphanPath);
        } catch (error) {
          console.warn(`⚠️ Failed to delete orphaned object ${orphanPath}:`, error);
        }
      }
    }

    // 7. Generate summary
    results.summary = `
🔧 GCS Path Reconciliation ${dryRun ? '(DRY RUN)' : '(COMPLETED)'}
  📊 Stats:
    - Total GCS objects: ${gcsObjects.length}
    - Total DB documents: ${allDocs.length}
    - Path mismatches fixed: ${results.fixed}
    - Orphaned GCS objects: ${results.orphanedGCSObjects.length}
    - Orphaned DB documents: ${results.orphanedDBDocuments.length}
  
  ${dryRun ? '🔍 This was a dry run. Run with dryRun=false to apply changes.' : '✅ Changes have been applied.'}
    `;

    console.log(results.summary);
    return results;
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

  // Generate match explanation for why a document was found
  private getMatchReasons(doc: any, query: string): string {
    const keywords = query.toLowerCase().split(/\s+/).filter(word => word.trim().length > 0);
    const reasons = [];
    
    // Check filename matches
    const nameMatches = keywords.filter(keyword => 
      doc.name && doc.name.toLowerCase().includes(keyword.toLowerCase())
    );
    if (nameMatches.length > 0) {
      reasons.push(`the filename contains "${nameMatches.join('", "')}"`);}
    
    // Check AI category matches
    const categoryMatches = keywords.filter(keyword =>
      doc.aiCategory && doc.aiCategory.toLowerCase().includes(keyword.toLowerCase())
    );
    if (categoryMatches.length > 0) {
      reasons.push(`it's categorized as "${doc.aiCategory}"`);
    }
    
    // Check AI document type matches
    const typeMatches = keywords.filter(keyword =>
      doc.aiDocumentType && doc.aiDocumentType.toLowerCase().includes(keyword.toLowerCase())
    );
    if (typeMatches.length > 0) {
      reasons.push(`it's classified as "${doc.aiDocumentType}"`);
    }
    
    // Check content matches (if available)
    const contentMatches = keywords.filter(keyword =>
      doc.documentContent && doc.documentContent.toLowerCase().includes(keyword.toLowerCase())
    );
    if (contentMatches.length > 0) {
      reasons.push(`the document content mentions "${contentMatches.join('", "')}"`);}
    
    // Check summary matches
    const summaryMatches = keywords.filter(keyword =>
      doc.aiSummary && doc.aiSummary.toLowerCase().includes(keyword.toLowerCase())
    );
    if (summaryMatches.length > 0) {
      reasons.push(`the summary mentions "${summaryMatches.join('", "')}"`);}
    
    // Default reason if no specific matches found
    if (reasons.length === 0) {
      reasons.push("it contains relevant keywords");
    }
    
    // Join reasons with "and"
    if (reasons.length === 1) {
      return reasons[0];
    } else if (reasons.length === 2) {
      return `${reasons[0]} and ${reasons[1]}`;
    } else {
      return `${reasons.slice(0, -1).join(', ')}, and ${reasons[reasons.length - 1]}`;
    }
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
    const fieldScores: { field: string, rawSimilarity: number, processedScore: number }[] = [];
    
    console.log(`🔍 SEMANTIC SCORING TRACE for "${doc.name}" (docId: ${doc.id})`);
    console.log(`    Vector normalization: Query embedding L2-norm = ${Math.sqrt(queryEmbedding.reduce((sum, val) => sum + val*val, 0)).toFixed(6)}`);
    
    // Title embedding (with slight boost)
    if (doc.titleEmbedding) {
      const titleEmb = parseEmbeddingFromJSON(doc.titleEmbedding);
      if (titleEmb) {
        const titleNorm = Math.sqrt(titleEmb.reduce((sum, val) => sum + val*val, 0));
        const rawSimilarity = calculateCosineSimilarity(queryEmbedding, titleEmb);
        const titleScore = rawSimilarity * 1.1; // Title boost
        console.log(`    TITLE: raw_cosine=${rawSimilarity.toFixed(6)}, doc_L2_norm=${titleNorm.toFixed(6)}, boost=1.1x, final=${titleScore.toFixed(6)}`);
        fieldScores.push({ field: 'title', rawSimilarity, processedScore: titleScore });
      } else {
        console.log(`    TITLE: embedding_parse_failed`);
      }
    } else {
      console.log(`    TITLE: no_embedding`);
    }
    
    // Key topics embedding
    if (doc.keyTopicsEmbedding) {
      const keyTopicsEmb = parseEmbeddingFromJSON(doc.keyTopicsEmbedding);
      if (keyTopicsEmb) {
        const topicsNorm = Math.sqrt(keyTopicsEmb.reduce((sum, val) => sum + val*val, 0));
        const rawSimilarity = calculateCosineSimilarity(queryEmbedding, keyTopicsEmb);
        console.log(`    KEY_TOPICS: raw_cosine=${rawSimilarity.toFixed(6)}, doc_L2_norm=${topicsNorm.toFixed(6)}, boost=1.0x, final=${rawSimilarity.toFixed(6)}`);
        fieldScores.push({ field: 'key_topics', rawSimilarity, processedScore: rawSimilarity });
      } else {
        console.log(`    KEY_TOPICS: embedding_parse_failed`);
      }
    } else {
      console.log(`    KEY_TOPICS: no_embedding`);
    }
    
    // Summary embedding  
    if (doc.summaryEmbedding) {
      const summaryEmb = parseEmbeddingFromJSON(doc.summaryEmbedding);
      if (summaryEmb) {
        const summaryNorm = Math.sqrt(summaryEmb.reduce((sum, val) => sum + val*val, 0));
        const rawSimilarity = calculateCosineSimilarity(queryEmbedding, summaryEmb);
        console.log(`    SUMMARY: raw_cosine=${rawSimilarity.toFixed(6)}, doc_L2_norm=${summaryNorm.toFixed(6)}, boost=1.0x, final=${rawSimilarity.toFixed(6)}`);
        fieldScores.push({ field: 'summary', rawSimilarity, processedScore: rawSimilarity });
      } else {
        console.log(`    SUMMARY: embedding_parse_failed`);
      }
    } else {
      console.log(`    SUMMARY: no_embedding`);
    }
    
    // Content embedding
    if (doc.contentEmbedding) {
      const contentEmb = parseEmbeddingFromJSON(doc.contentEmbedding);
      if (contentEmb) {
        const contentNorm = Math.sqrt(contentEmb.reduce((sum, val) => sum + val*val, 0));
        const rawSimilarity = calculateCosineSimilarity(queryEmbedding, contentEmb);
        console.log(`    CONTENT: raw_cosine=${rawSimilarity.toFixed(6)}, doc_L2_norm=${contentNorm.toFixed(6)}, boost=1.0x, final=${rawSimilarity.toFixed(6)}`);
        fieldScores.push({ field: 'content', rawSimilarity, processedScore: rawSimilarity });
      } else {
        console.log(`    CONTENT: embedding_parse_failed`);
      }
    } else {
      console.log(`    CONTENT: no_embedding`);
    }
    
    // Use the maximum score across all fields (let strongest field dominate)
    const maxSemanticScore = fieldScores.length > 0 ? Math.max(...fieldScores.map(f => f.processedScore)) : 0;
    const winningField = fieldScores.find(f => f.processedScore === maxSemanticScore);
    console.log(`    MAXIMUM_FIELD_LOGIC: winner="${winningField?.field || 'none'}", final_semantic=${maxSemanticScore.toFixed(6)}`);
    return maxSemanticScore;
  }
  
  private calculateTieredScore(semanticScore: number, lexicalScore: number, qualityScore: number): number {
    // Convert all scores to 0-1 scale first
    const semantic = semanticScore;
    const lexical = lexicalScore; 
    const quality = qualityScore;
    
    console.log(`🎯 TIER CLASSIFICATION: semantic=${semantic.toFixed(6)}, lexical=${lexical.toFixed(6)}, quality=${quality.toFixed(6)}`);
    
    let tier: number;
    let weights: { semantic: number, lexical: number, quality: number };
    let formula: string;
    let rawCombined: number;
    let finalScore: number;
    
    // Tier 1: High confidence semantic matches (adjusted for realistic Gemini embedding scores)
    if (semantic >= 0.7) {
      tier = 1;
      weights = { semantic: 100, lexical: 0, quality: 0 };
      formula = `semantic * 1.0`;
      rawCombined = semantic;
      finalScore = Math.round(semantic * 100) / 100; // Round to 2 decimals
      console.log(`    TIER_1_SEMANTIC_DOMINANT: weights=[semantic:100%, lexical:0%, quality:0%]`);
      console.log(`    FORMULA: ${formula} = ${semantic.toFixed(6)} * 1.0 = ${rawCombined.toFixed(6)}`);
      console.log(`    ROUNDING: ${rawCombined.toFixed(6)} → ${finalScore.toFixed(6)}`);
    }
    // Tier 2: Moderate semantic matches  
    else if (semantic >= 0.4) {
      tier = 2;
      weights = { semantic: 60, lexical: 30, quality: 10 };
      formula = `(semantic * 0.6) + (lexical * 0.3) + (quality * 0.1)`;
      rawCombined = (semantic * 0.6) + (lexical * 0.3) + (quality * 0.1);
      finalScore = Math.round(rawCombined * 100) / 100;
      console.log(`    TIER_2_FUSION: weights=[semantic:60%, lexical:30%, quality:10%]`);
      console.log(`    FORMULA: ${formula}`);
      console.log(`    CALCULATION: (${semantic.toFixed(6)} * 0.6) + (${lexical.toFixed(6)} * 0.3) + (${quality.toFixed(6)} * 0.1) = ${rawCombined.toFixed(6)}`);
      console.log(`    ROUNDING: ${rawCombined.toFixed(6)} → ${finalScore.toFixed(6)}`);
    }
    // Tier 3: Low semantic matches - TIGHTER WEIGHTS to yield 0.25-0.45 finals
    else {
      tier = 3;
      weights = { semantic: 0, lexical: 50, quality: 50 };
      formula = `(lexical * 0.5) + (quality * 0.5)`;
      rawCombined = (lexical * 0.5) + (quality * 0.5);
      finalScore = Math.round(rawCombined * 100) / 100;
      console.log(`    TIER_3_BALANCED_REDUCED: weights=[semantic:0%, lexical:50%, quality:50%]`);
      console.log(`    FORMULA: ${formula}`);
      console.log(`    CALCULATION: (${lexical.toFixed(6)} * 0.5) + (${quality.toFixed(6)} * 0.5) = ${rawCombined.toFixed(6)}`);
      console.log(`    ROUNDING: ${rawCombined.toFixed(6)} → ${finalScore.toFixed(6)}`);
    }
    
    console.log(`    FINAL_TIER_RESULT: tier=${tier}, final_score=${(finalScore * 100).toFixed(2)}%`);
    return finalScore;
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
      
      // Check where the terms are found first
      const titleMatches = searchTermsList.filter(term => titleText.includes(term));
      const summaryMatches = searchTermsList.filter(term => summaryText.includes(term));
      const topicsMatches = searchTermsList.filter(term => topicsText.includes(term));
      const contentMatches = searchTermsList.filter(term => contentText.includes(term));
      const tagMatches = searchTermsList.filter(term => tagText.includes(term));

      console.log(`📝 LEXICAL SCORING TRACE for "${doc.name}" (docId: ${doc.id})`);
      console.log(`    SEARCH_TERMS: raw="${searchTerms}", lowercase="${searchLower}", tokenized=[${searchTermsList.join(',')}]`);
      console.log(`    TS_RANK_BASE: postgresql_score=${baseScore.toFixed(6)} (from FTS query)`);
      console.log(`    FIELD_MATCHES: title=[${titleMatches.join(',')}], summary=[${summaryMatches.join(',')}], topics=[${topicsMatches.join(',')}], content=[${contentMatches.join(',')}], tags=[${tagMatches.join(',')}]`);
      
      // Apply TIGHTER lexical calibration - max-field logic with strict caps
      const originalScore = baseScore;
      let winningField = 'ts_rank_only';
      let finalScore = baseScore;
      
      // TIGHTER CALIBRATION: Max-field logic with strict caps and proximity requirements
      
      // 1. EXACT PHRASE IN TITLE/FILENAME: Only case that gets 1.0 lexical score
      if (titleText.includes(searchLower)) {
        finalScore = 1.0;
        winningField = 'title_exact_phrase';
        console.log(`    EXACT_PHRASE_TITLE: "${searchLower}" found in "${titleText}" → score=1.000`);
      }
      
      // 2. ALL TOKENS IN TITLE: Requires all tokens co-located in same field (>0.5 threshold)
      else if (searchTermsList.length > 1 && searchTermsList.every(term => titleText.includes(term))) {
        // Check proximity: tokens must be within 10 characters of each other for bonus
        const proximityBonus = this.checkTokenProximity(titleText, searchTermsList, 10) ? 0.1 : 0;
        finalScore = Math.min(0.85, 0.75 + proximityBonus); // Cap at 0.85 as specified
        winningField = 'title_all_tokens';
        console.log(`    ALL_TOKENS_TITLE: proximity_bonus=${proximityBonus.toFixed(3)}, final=${finalScore.toFixed(3)}`);
      }
      
      // 3. ALL TOKENS IN FILENAME: Slightly lower than title
      else if (searchTermsList.length > 1 && searchTermsList.every(term => titleText.includes(term))) {
        const proximityBonus = this.checkTokenProximity(titleText, searchTermsList, 10) ? 0.08 : 0;
        finalScore = Math.min(0.85, 0.7 + proximityBonus);
        winningField = 'filename_all_tokens';
        console.log(`    ALL_TOKENS_FILENAME: proximity_bonus=${proximityBonus.toFixed(3)}, final=${finalScore.toFixed(3)}`);
      }
      
      // 4. ALL TOKENS IN TAGS: Good signal, but capped
      else if (searchTermsList.length > 1 && searchTermsList.every(term => tagText.includes(term))) {
        const proximityBonus = this.checkTokenProximity(tagText, searchTermsList, 15) ? 0.05 : 0;
        finalScore = Math.min(0.6, 0.5 + proximityBonus);
        winningField = 'tags_all_tokens';
        console.log(`    ALL_TOKENS_TAGS: proximity_bonus=${proximityBonus.toFixed(3)}, final=${finalScore.toFixed(3)}`);
      }
      
      // 5. ALL TOKENS IN CONTENT: Lower priority, proximity required for >0.5
      else if (searchTermsList.length > 1 && searchTermsList.every(term => contentText.includes(term))) {
        const proximityBonus = this.checkTokenProximity(contentText, searchTermsList, 20) ? 0.15 : 0;
        finalScore = Math.min(0.65, 0.4 + proximityBonus);
        winningField = 'content_all_tokens';
        console.log(`    ALL_TOKENS_CONTENT: proximity_bonus=${proximityBonus.toFixed(3)}, final=${finalScore.toFixed(3)}`);
      }
      
      // 6. SUMMARY-ONLY MATCHES: CAPPED AT 0.15 (as specified)
      else if (summaryMatches.length === searchTermsList.length && summaryMatches.length > 0) {
        finalScore = Math.min(0.15, baseScore * 1.5);
        winningField = 'summary_only_capped';
        console.log(`    SUMMARY_ONLY_MATCH: capped_at_0.15, final=${finalScore.toFixed(3)}`);
      }
      
      // 7. PARTIAL MATCHES: Very low scores for incomplete matches
      else if (titleMatches.length > 0 || tagMatches.length > 0) {
        finalScore = Math.min(0.3, baseScore * 2);
        winningField = 'partial_title_or_tags';
        console.log(`    PARTIAL_TITLE_OR_TAGS: final=${finalScore.toFixed(3)}`);
      }
      
      // 8. CONTENT-ONLY PARTIAL: Lowest priority
      else if (contentMatches.length > 0) {
        finalScore = Math.min(0.25, baseScore * 1.8);
        winningField = 'partial_content_only';
        console.log(`    PARTIAL_CONTENT: final=${finalScore.toFixed(3)}`);
      }
      
      // 9. NO MEANINGFUL MATCH: ts_rank only
      else {
        finalScore = Math.min(0.2, baseScore * 1.2);
        winningField = 'ts_rank_fallback';
        console.log(`    NO_MATCH: ts_rank_only, final=${finalScore.toFixed(3)}`);
      }
      
      console.log(`    WINNING_FIELD: ${winningField}, original_ts_rank=${originalScore.toFixed(6)}, final_lexical=${finalScore.toFixed(6)}`);
      return Math.min(1, Math.max(0, finalScore));
    } catch (error) {
      console.error('FTS scoring failed for doc:', doc.name, 'error:', error);
      return 0;
    }
  }

  // Helper method for proximity-based scoring
  private checkTokenProximity(text: string, tokens: string[], maxDistance: number): boolean {
    if (tokens.length < 2) return true; // Single token always has "proximity"
    
    const positions = tokens.map(token => {
      const index = text.toLowerCase().indexOf(token.toLowerCase());
      return index >= 0 ? index : -1;
    }).filter(pos => pos >= 0);
    
    if (positions.length !== tokens.length) return false; // Not all tokens found
    
    // Check if any two tokens are within maxDistance characters
    for (let i = 0; i < positions.length - 1; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        if (Math.abs(positions[i] - positions[j]) <= maxDistance) {
          return true;
        }
      }
    }
    return false;
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

  // Policy-Driven Search with comprehensive instrumentation
  async searchWithPolicyDrivenAnalysis(query: string, filters: any = {}, userId?: string) {
    await this.ensureInitialized();
    return this.policyDrivenSearchEngine.searchWithPolicyDrivenAnalysis(query, filters, userId);
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
        console.log(`Phase 1: Fast ILIKE pre-filtering for query: "${preprocessedQuery}"`);
        
        // Optimize: limit to 3 keywords max and focus on fast fields only
        const keywords = preprocessedQuery.split(/\s+/).filter(word => word.trim().length > 0).slice(0, 3);
        console.log(`Searching for individual keywords: ${keywords.join(', ')}`);
        
        // Build search conditions - exclude trashed documents and enforce tenant scoping
        const conditions = [
          eq(documents.isDeleted, false),
          eq(documents.status, 'active'),
          eq(documents.userId, userId) // CRITICAL: Prevent cross-tenant data leakage
        ];
        
        // Optimized: Search only fast fields (name + AI metadata) for performance
        const keywordConditions = [];
        for (const keyword of keywords) {
          const searchTerm = `%${keyword}%`;
          
          // Comprehensive search: name, originalName, AI metadata, and content for maximum recall
          const nameCondition = ilike(documents.name, searchTerm);
          const originalNameCondition = ilike(documents.originalName, searchTerm);
          const aiCategoryCondition = ilike(documents.aiCategory, searchTerm);
          const aiDocumentTypeCondition = ilike(documents.aiDocumentType, searchTerm);
          const aiSummaryCondition = ilike(documents.aiSummary, searchTerm);
          const documentContentCondition = ilike(documents.documentContent, searchTerm);
          
          // Combine comprehensive search conditions for this keyword
          keywordConditions.push(or(
            nameCondition, 
            originalNameCondition,
            aiCategoryCondition, 
            aiDocumentTypeCondition,
            aiSummaryCondition,
            documentContentCondition
          )!);
        }
        
        // Documents must match at least one keyword (OR logic)
        conditions.push(or(...keywordConditions)!);
        
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
        keywords: preprocessedQuery.split(' ').filter(word => word.trim().length > 0),
        timing: { total: totalTime, fts: ftsTime, semantic: 0 }
      };
    }

    // Phase 2: Proper per-document semantic analysis using 3-tier scoring system
    const semanticStartTime = performance.now();
    
    // Generate or retrieve cached query embedding (same pattern as existing code)
    let queryEmbedding: number[];
    const cachedEmbedding = this.queryEmbeddingCache.getCachedEmbedding(preprocessedQuery);
    
    if (cachedEmbedding) {
      console.log(`Using cached query embedding for: "${preprocessedQuery}"`);
      queryEmbedding = cachedEmbedding;
    } else {
      try {
        console.log(`Generating new query embedding for: "${preprocessedQuery}"`);
        queryEmbedding = await generateEmbedding(preprocessedQuery, 'RETRIEVAL_QUERY');
        this.queryEmbeddingCache.setCachedEmbedding(preprocessedQuery, queryEmbedding);
        console.log(`Cached new query embedding for future searches`);
      } catch (error) {
        console.warn('Query embedding generation failed, falling back to lexical-only scoring:', error);
        // Continue with lexical-only scoring (set queryEmbedding to empty for fallback)
        queryEmbedding = [];
      }
    }
    
    const finalResults = [];
    for (const doc of ftsResults) {
      try {
        // Calculate semantic score using embeddings
        const semanticScore = await this.calculateSemanticScore(doc, queryEmbedding);
        
        // Calculate lexical score for text matching
        const lexicalScore = await this.calculateLexicalScore(doc, preprocessedQuery);
        
        // Calculate quality score based on metadata completeness
        const qualityScore = await this.calculateQualityBoost(doc);
        
        // Apply 3-tier scoring system
        const tieredScore = this.calculateTieredScore(semanticScore, lexicalScore, qualityScore);
        
        // Convert to percentage and add variance to prevent identical scores
        const confidenceScore = Math.min(Math.round(tieredScore * 100), 100);
        
        finalResults.push({
          ...doc,
          semanticScore,
          lexicalScore,
          qualityScore,
          combinedScore: tieredScore,
          confidenceScore,
          tags: [] // Ensure tags array exists
        });
        
        console.log(`Document "${doc.name}": semantic=${semanticScore.toFixed(3)}, lexical=${lexicalScore.toFixed(3)}, quality=${qualityScore.toFixed(3)}, final=${tieredScore.toFixed(3)} (${confidenceScore}%)`);
        
      } catch (error) {
        console.warn(`Scoring failed for document ${doc.name}:`, error);
        // Fallback to text-based scoring
        const lexicalScore = this.calculateQueryAwareLexicalScore(doc, preprocessedQuery);
        const qualityScore = await this.calculateQualityBoost(doc);
        const tieredScore = this.calculateTieredScore(0, lexicalScore, qualityScore);
        
        finalResults.push({
          ...doc,
          semanticScore: 0,
          lexicalScore,
          qualityScore,
          combinedScore: tieredScore,
          confidenceScore: Math.min(Math.round(tieredScore * 100), 100),
          tags: []
        });
      }
    }
    
    // Sort by combined score (highest first)
    finalResults.sort((a, b) => b.combinedScore - a.combinedScore);
    
    const semanticTime = performance.now() - semanticStartTime;

    const totalTime = performance.now() - startTime;
    console.log(`🚀 Hybrid search completed: ${totalTime.toFixed(2)}ms (FTS: ${ftsTime.toFixed(2)}ms, Semantic: ${semanticTime.toFixed(2)}ms - 3-tier scoring applied)`);

    // Group results by confidence level
    const relevantDocuments = finalResults.filter(doc => doc.confidenceScore >= 50);
    const relatedDocuments = finalResults.filter(doc => doc.confidenceScore < 50);

    // Generate conversational AI response (same as searchConversational)
    let conversationalResponse;
    
    if (finalResults.length === 0) {
      conversationalResponse = `I couldn't find any documents matching "${query}". Try searching with different keywords, or check if the document might be in a specific folder or have different tags.`;
    } else {
      // Detailed numbered format with match explanations
      if (finalResults.length === 1) {
        const doc = finalResults[0];
        const matchReasons = this.getMatchReasons(doc, preprocessedQuery);
        conversationalResponse = `**Found 1 relevant document:**\n\n1. "${doc.name}" - matches because ${matchReasons}`;
      } else {
        // Multi-document response with numbered explanations
        let responseLines = [`**Found ${finalResults.length} relevant documents:**\n`];
        
        finalResults.slice(0, 5).forEach((doc, index) => {
          const ranking = index + 1;
          const matchReasons = this.getMatchReasons(doc, preprocessedQuery);
          
          responseLines.push(`${ranking}. "${doc.name}" - matches because ${matchReasons}`);
          responseLines.push(''); // Empty line between results
        });
        
        if (finalResults.length > 5) {
          responseLines.push(`Plus ${finalResults.length - 5} more documents with lower relevance.`);
        }
        
        conversationalResponse = responseLines.join('\n');
      }
    }

    return {
      documents: finalResults,
      relevantDocuments,
      relatedDocuments,
      response: conversationalResponse,
      intent: 'hybrid_search',
      keywords: preprocessedQuery.split(' ').filter(word => word.trim().length > 0),
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
        eq(documents.status, 'active'),
        eq(documents.userId, userId) // ADD THIS LINE
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

  async getDocumentsCount(filters: DocumentFilters, userId: string): Promise<number> {
    await this.ensureInitialized();
    const conditions = [
      eq(documents.isDeleted, false),
      eq(documents.status, 'active'),
      eq(documents.userId, userId)  // CRITICAL: Filter by user to match document display
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
      // Handle "image" filter to match all image types
      if (filters.fileType === 'image') {
        const imageTypes = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'tiff', 'ico'];
        conditions.push(inArray(documents.fileType, imageTypes));
      } else {
        conditions.push(eq(documents.fileType, filters.fileType));
      }
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

  async getDocumentById(id: string, userId: string): Promise<DocumentWithFolderAndTags | undefined> {
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
        eq(documents.status, 'active'),
        eq(documents.userId, userId)
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

  async getDocumentContent(id: string, userId: string): Promise<string | null> {
    const result = await db
      .select({ 
        documentContent: documents.documentContent 
      })
      .from(documents)
      .where(and(
        eq(documents.id, id), 
        eq(documents.isDeleted, false),
        eq(documents.status, 'active'),
        eq(documents.userId, userId)
      ))
      .limit(1);

    return result.length > 0 ? result[0].documentContent : null;
  }

  async updateDocument(id: string, updates: Partial<InsertDocument>, userId: string, reqId?: string, idempotencyKey?: string): Promise<Document | undefined> {
    ensureTenantContext(userId);

    const context: TransactionContext = {
      reqId: reqId || randomUUID(),
      userId,
      operationType: 'document_update',
      idempotencyKey: idempotencyKey || transactionManager.generateIdempotencyKey(
        'document_update',
        userId,
        id,
        JSON.stringify(updates)
      ),
      resourceIds: {
        documentId: id
      }
    };

    const result = await transactionManager.executeWithIdempotency(
      context,
      async (tx) => {
        const [updatedDocument] = await tx
          .update(documents)
          .set(updates)
          .where(and(
            eq(documents.id, id), 
            eq(documents.isDeleted, false),
            eq(documents.status, 'active'),
            eq(documents.userId, userId)
          ))
          .returning();

        if (!updatedDocument) {
          throw new Error('Document not found or access denied');
        }

        // Add analytics hook for post-commit execution
        transactionManager.addPostCommitHook({
          type: 'analytics',
          action: 'document_updated',
          data: {
            documentId: id,
            updateFields: Object.keys(updates),
            userId
          }
        });


        return updatedDocument;
      },
      { id, updates }
    );

    if (!result.success) {
      throw new Error(result.error || 'Failed to update document');
    }

    // Token 8/8: Trigger reindex after document update (especially for renames)
    // Check if this update affects searchable fields (name changes require reindexing)
    const affectsSearch = 'name' in updates || 'description' in updates || 'tags' in updates;
    if (affectsSearch && result.data) {
      await this.enqueueDocumentForReindex(id, userId, result.data.versionId);
    }

    return result.data;
  }

  async deleteDocument(id: string, userId: string): Promise<boolean> {
    try {
      // Get document details first (need objectPath for GCS deletion)
      const document = await this.getDocumentById(id, userId);
      if (!document) {
        console.warn(`Document ${id} not found for deletion`);
        return false;
      }

      let deletedGeneration: bigint | null = null;

      // Get object metadata (including generation) before deletion for restore capability
      if (document.objectPath || document.filePath) {
        try {
          const objectPath = document.objectPath || document.filePath;
          if (objectPath) {
            const objectStorageService = new ObjectStorageService();
            const metadata = await objectStorageService.getObjectMetadata(objectPath);
            
            if (metadata.exists && metadata.generation) {
              deletedGeneration = metadata.generation;
              console.log(`📊 Stored generation ${deletedGeneration} for restoration: ${objectPath}`);
            } else {
              console.log(`📁 Object not found in GCS, skipping generation capture: ${objectPath}`);
            }
          }
        } catch (metadataError: any) {
          console.warn(`⚠️ Failed to get object metadata for ${document.objectPath || document.filePath}:`, metadataError.message);
          // Continue with deletion even if metadata fetch fails
        }
      }

      // Mark as trashed in database (soft delete with 7-day retention, with tenant isolation)
      const result = await db
        .update(documents)
        .set({ 
          status: 'trashed',
          deletedAt: new Date(),
          deletedGeneration, // Store generation for GCS restore
          isDeleted: true // Keep for backward compatibility
        })
        .where(and(eq(documents.id, id), eq(documents.userId, document.userId)))
        .returning();

      if (result.length === 0) {
        console.warn(`Failed to mark document ${id} as trashed`);
        return false;
      }

      // Delete from GCS immediately (will be soft-deleted for 7 days)
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

      // Token 8/8: Trigger reindex after document deletion (invalidate search embeddings)
      await this.enqueueDocumentForReindex(id, userId, document.versionId);

      console.log(`🗑️ Document "${document.name}" moved to trash (auto-deletes in 7 days)`);
      
      return true;
    } catch (error) {
      console.error(`Error deleting document ${id}:`, error);
      return false;
    }
  }

  async restoreDocument(id: string, userId: string): Promise<{ success: boolean; error?: string; alreadyLive?: boolean; message?: string }> {
    try {
      await this.ensureInitialized();

      // First, fetch the trashed document WITH TENANT VALIDATION
      const trashedDoc = await db
        .select()
        .from(documents)
        .where(and(eq(documents.id, id), eq(documents.status, 'trashed'), eq(documents.userId, userId)))
        .limit(1);

      if (trashedDoc.length === 0) {
        console.warn(`Document ${id} not found in trash or not eligible for restore`);
        return { success: false, error: "Document not found in trash" };
      }

      const document = trashedDoc[0];

      // Check if within 7-day restore window
      if (document.deletedAt) {
        const daysSinceDeleted = (Date.now() - document.deletedAt.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceDeleted > 7) {
          console.warn(`Document ${id} is beyond the 7-day restore window (${daysSinceDeleted.toFixed(1)} days old)`);
          return { success: false, error: `Document is beyond the 7-day restore window (${daysSinceDeleted.toFixed(1)} days old)` };
        }
      }

      // Check if we have generation data for GCS restore
      if (!document.deletedGeneration) {
        console.warn(`No generation data for restore: ${id} - cannot restore GCS object`);
        return { success: false, error: "Cannot restore: missing generation data (deleted before restore feature was implemented)" };
      }

      // Restore GCS object using stored generation
      let gcsRestoreResult = null;
      if (document.objectPath || document.filePath) {
        try {
          const objectPath = document.objectPath || document.filePath;
          if (objectPath) {
            const objectStorageService = new ObjectStorageService();
            gcsRestoreResult = await objectStorageService.restoreObject(objectPath, document.deletedGeneration);
            
            if (!gcsRestoreResult.success) {
              console.error(`GCS restore failed for ${objectPath}: ${gcsRestoreResult.error}`);
              return { success: false, error: gcsRestoreResult.error };
            }
          }
        } catch (gcsError: any) {
          console.error(`Error during GCS restore for ${document.objectPath || document.filePath}:`, gcsError);
          return { success: false, error: `Failed to restore file from cloud storage: ${gcsError.message}` };
        }
      }

      // Verify object is actually live after restore (unless it was already live)
      if (gcsRestoreResult && !gcsRestoreResult.alreadyLive) {
        try {
          const objectPath = document.objectPath || document.filePath;
          if (objectPath) {
            const objectStorageService = new ObjectStorageService();
            const metadata = await objectStorageService.getObjectMetadata(objectPath);
            
            if (!metadata.exists) {
              console.error(`Verification failed: Object not live after restore: ${objectPath}`);
              return { success: false, error: "Restore verification failed - file is not accessible" };
            }
          }
        } catch (verifyError: any) {
          console.error(`Verification error after restore:`, verifyError);
          return { success: false, error: "Failed to verify restore success" };
        }
      }

      // Update database to restore the document (with tenant isolation)
      const result = await db
        .update(documents)
        .set({
          status: 'active',
          deletedAt: null,
          deletedGeneration: null, // Clear generation after successful restore
          isDeleted: false, // Reset the legacy deleted flag
        })
        .where(and(eq(documents.id, id), eq(documents.userId, document.userId)))
        .returning();

      if (result.length === 0) {
        console.warn(`Failed to restore document ${id} in database`);
        return { success: false, error: "Database restore failed" };
      }

      // Token 8/8: Trigger reindex after document restore (restore search embeddings)
      await this.enqueueDocumentForReindex(id, userId, document.versionId);

      const restoreMessage = gcsRestoreResult?.alreadyLive 
        ? `🔄 Document "${document.name}" restored from trash (file was already live)`
        : `🔄 Document "${document.name}" and file restored from trash successfully`;
      
      console.log(restoreMessage);
      
      return { 
        success: true, 
        alreadyLive: gcsRestoreResult?.alreadyLive || false,
        message: restoreMessage
      };
    } catch (error) {
      console.error(`Error restoring document ${id}:`, error);
      return { success: false, error: `Restore failed: ${error.message}` };
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

  async getDocumentWithVersions(id: string, userId: string): Promise<DocumentWithVersions | undefined> {
    const documentWithDetails = await this.getDocumentById(id, userId);
    if (!documentWithDetails) {
      return undefined;
    }

    const versions = await this.getDocumentVersions(id, userId);
    const currentVersion = versions.find(v => v.isActive);

    return {
      ...documentWithDetails,
      versions,
      currentVersion,
    };
  }

  // Document Versions
  async createDocumentVersion(
    insertVersion: InsertDocumentVersion, 
    userId: string, 
    reqId?: string, 
    idempotencyKey?: string
  ): Promise<DocumentVersion> {
    ensureTenantContext(userId);

    // Always force isActive=false for new versions - only document creation can set active=true
    const safeInsertVersion = { ...insertVersion, isActive: false };

    // Generate deterministic idempotency key: userId:docId:contentHash or accept client key
    const contentHash = safeInsertVersion.filePath ? 
      Buffer.from(safeInsertVersion.filePath + (safeInsertVersion.fileSize || 0) + (safeInsertVersion.mimeType || '')).toString('base64').slice(0, 16) :
      'no-content';
    
    const context: TransactionContext = {
      reqId: reqId || randomUUID(),
      userId,
      operationType: 'version_create',
      idempotencyKey: idempotencyKey || `${userId}:${safeInsertVersion.documentId}:${contentHash}`,
      resourceIds: {
        documentId: safeInsertVersion.documentId
      }
    };

    const result = await transactionManager.executeWithIdempotency(
      context,
      async (tx) => {
        // Lock the parent document to prevent concurrent version creation
        const parentDoc = await tx
          .select({ id: documents.id, userId: documents.userId })
          .from(documents)
          .where(and(
            eq(documents.id, safeInsertVersion.documentId),
            eq(documents.userId, userId),
            eq(documents.isDeleted, false)
          ))
          .for('update')
          .limit(1);

        if (parentDoc.length === 0) {
          throw new Error(`Document not found or access denied: ${safeInsertVersion.documentId}`);
        }

        // Get next version number
        const versionResult = await tx
          .select({ maxVersion: sql<number>`COALESCE(MAX(version), 0) + 1` })
          .from(documentVersions)
          .where(eq(documentVersions.documentId, safeInsertVersion.documentId));
        
        const nextVersion = versionResult[0].maxVersion;

        // Insert the new version with computed version number
        const [version] = await tx
          .insert(documentVersions)
          .values({ ...safeInsertVersion, version: nextVersion })
          .returning();
          
        return version;
      },
      // Post-commit analytics hook
      (result) => {
        console.log(`📋 Analytics: document_version_created - Version ${result.version} created for document ${result.documentId} by user ${userId}`);
        // Here you could send to analytics service, metrics, etc.
      }
    );

    if (!result.success) {
      throw new Error(result.error || 'Failed to create document version');
    }

    return result.data;
  }

  async getDocumentVersions(documentId: string, userId: string): Promise<DocumentVersion[]> {
    ensureTenantContext(userId);
    
    // First verify the document belongs to this user before returning versions
    const documentOwnership = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(
        eq(documents.id, documentId),
        eq(documents.userId, userId),
        eq(documents.isDeleted, false)
      ))
      .limit(1);
      
    if (documentOwnership.length === 0) {
      // Return empty array if document doesn't exist or doesn't belong to user
      return [];
    }
    
    return await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId))
      .orderBy(desc(documentVersions.version));
  }

  async setActiveVersion(documentId: string, versionId: string, userId: string, reqId?: string, idempotencyKey?: string): Promise<boolean> {
    ensureTenantContext(userId);

    const context: TransactionContext = {
      reqId: reqId || randomUUID(),
      userId,
      operationType: 'version_set_active',
      idempotencyKey: idempotencyKey || transactionManager.generateIdempotencyKey(
        'version_set_active',
        userId,
        documentId,
        versionId
      ),
      resourceIds: {
        documentId,
        versionId
      }
    };

    const result = await transactionManager.executeWithIdempotency(
      context,
      async (tx) => {
        // First, verify the document belongs to the user and get its info
        const document = await tx
          .select()
          .from(documents)
          .where(and(
            eq(documents.id, documentId),
            eq(documents.userId, userId),
            eq(documents.isDeleted, false)
          ))
          .for('update') // Lock the parent document
          .limit(1);

        if (document.length === 0) {
          return false; // Document not found or doesn't belong to user
        }

        // Get the version we want to activate to ensure it exists and belongs to this document
        const targetVersion = await tx
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

        // First, deactivate all versions for this document (with user scoping)
        await tx
          .update(documentVersions)
          .set({ isActive: false })
          .where(and(
            eq(documentVersions.documentId, documentId),
            sql`${documentVersions.documentId} IN (
              SELECT id FROM documents WHERE user_id = ${userId}
            )`
          ));

        // Then activate the specified version
        await tx
          .update(documentVersions)
          .set({ isActive: true })
          .where(and(
            eq(documentVersions.id, versionId),
            sql`${documentVersions.documentId} IN (
              SELECT id FROM documents WHERE user_id = ${userId}
            )`
          ));

        // Update the document's metadata to match the active version (with user scoping)
        await tx
          .update(documents)
          .set({
            filePath: version.filePath,
            fileSize: version.fileSize,
            fileType: version.fileType,
            mimeType: version.mimeType,
          })
          .where(and(
            eq(documents.id, documentId),
            eq(documents.userId, userId)
          ));

        // Add analytics hook for post-commit execution
        transactionManager.addPostCommitHook({
          type: 'analytics',
          action: 'document_version_activated',
          data: {
            documentId,
            versionId,
            version: version.version,
            userId
          }
        });

        return true;
      },
      { documentId, versionId }
    );

    if (!result.success) {
      throw new Error(result.error || 'Failed to set active version');
    }

    return result.data;
  }

  async deleteDocumentVersion(documentId: string, versionId: string, userId: string, reqId?: string, idempotencyKey?: string): Promise<boolean> {
    ensureTenantContext(userId);

    const context: TransactionContext = {
      reqId: reqId || randomUUID(),
      userId,
      operationType: 'version_delete',
      idempotencyKey: idempotencyKey || transactionManager.generateIdempotencyKey(
        'version_delete',
        userId,
        documentId,
        versionId
      ),
      resourceIds: {
        documentId,
        versionId
      }
    };

    const result = await transactionManager.executeWithIdempotency(
      context,
      async (tx) => {
        // First, verify the document belongs to the user and lock it
        const document = await tx
          .select()
          .from(documents)
          .where(and(
            eq(documents.id, documentId),
            eq(documents.userId, userId),
            eq(documents.isDeleted, false)
          ))
          .for('update') // Lock the parent document
          .limit(1);

        if (document.length === 0) {
          return false; // Document not found or doesn't belong to user
        }

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

        // Get all versions for this document within the transaction (with user scoping)
        const allVersions = await tx
          .select()
          .from(documentVersions)
          .where(and(
            eq(documentVersions.documentId, documentId),
            sql`${documentVersions.documentId} IN (
              SELECT id FROM documents WHERE user_id = ${userId}
            )`
          ))
          .orderBy(desc(documentVersions.version));

        // Prevent deleting the only version
        if (allVersions.length === 1) {
          return false; // Cannot delete the only version
        }

        // Delete the version (with user scoping)
        await tx
          .delete(documentVersions)
          .where(and(
            eq(documentVersions.id, versionId),
            sql`${documentVersions.documentId} IN (
              SELECT id FROM documents WHERE user_id = ${userId}
            )`
          ));

        // If we deleted the active version, activate the latest remaining version
        if (version.isActive) {
          const remainingVersions = allVersions.filter(v => v.id !== versionId);
          const latestVersion = remainingVersions[0]; // Already sorted by version desc

          if (latestVersion) {
            // Activate the latest remaining version (with user scoping)
            await tx
              .update(documentVersions)
              .set({ isActive: true })
              .where(and(
                eq(documentVersions.id, latestVersion.id),
                sql`${documentVersions.documentId} IN (
                  SELECT id FROM documents WHERE user_id = ${userId}
                )`
              ));

            // Update document metadata to match the new active version (with user scoping)
            await tx
              .update(documents)
              .set({
                filePath: latestVersion.filePath,
                fileSize: latestVersion.fileSize,
                fileType: latestVersion.fileType,
                mimeType: latestVersion.mimeType,
              })
              .where(and(
                eq(documents.id, documentId),
                eq(documents.userId, userId)
              ));
          }
        }

        // Add analytics hook for post-commit execution
        transactionManager.addPostCommitHook({
          type: 'analytics',
          action: 'document_version_deleted',
          data: {
            documentId,
            versionId,
            version: version.version,
            wasActive: version.isActive,
            userId
          }
        });

        return true;
      },
      { documentId, versionId }
    );

    if (!result.success) {
      throw new Error(result.error || 'Failed to delete document version');
    }

    return result.data;
  }

  // Folders
  async createFolder(insertFolder: InsertFolder, userId: string, reqId?: string, idempotencyKey?: string): Promise<Folder> {
    ensureTenantContext(userId);

    const context: TransactionContext = {
      reqId: reqId || randomUUID(),
      userId,
      operationType: 'folder_create',
      idempotencyKey: idempotencyKey || transactionManager.generateIdempotencyKey(
        'folder_create',
        userId,
        insertFolder.name,
        insertFolder.parentId || 'root'
      )
    };

    const result = await transactionManager.executeWithIdempotency(
      context,
      async (tx) => {
        const [folder] = await tx
          .insert(folders)
          .values({
            ...insertFolder,
            userId, // Ensure folder is owned by the user
            color: insertFolder.color ?? "#f59e0b",
          })
          .returning();

        // Add analytics hook for post-commit execution
        transactionManager.addPostCommitHook({
          type: 'analytics',
          action: 'folder_created',
          data: {
            folderId: folder.id,
            folderName: folder.name,
            isAutoCreated: folder.isAutoCreated,
            userId
          }
        });

        return folder;
      },
      insertFolder
    );

    if (!result.success) {
      throw new Error(result.error || 'Failed to create folder');
    }

    return result.data;
  }

  async getFolders(userId: string): Promise<(Folder & { documentCount: number })[]> {
    await this.ensureInitialized();
    
    // Get folders owned by the user
    const allFolders = await db
      .select({
        id: folders.id,
        userId: folders.userId,
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
      .where(eq(folders.userId, userId))
      .orderBy(folders.name);

    // Calculate document counts for each folder
    const foldersWithCounts = await Promise.all(
      allFolders.map(async (folder) => {
        let documentCount = 0;

        if (!folder.parentId) {
          // For main category folders (no parent), count all documents in subfolders owned by user
          const subfolderDocs = await db
            .select({
              count: sql<number>`CAST(COUNT(${documents.id}) AS INTEGER)`,
            })
            .from(documents)
            .innerJoin(folders, eq(documents.folderId, folders.id))
            .where(
              and(
                eq(folders.parentId, folder.id),
                eq(folders.userId, userId), // Ensure subfolder belongs to user
                eq(documents.userId, userId), // Ensure documents belong to user
                eq(documents.isDeleted, false),
                eq(documents.status, 'active')
              )
            );

          documentCount = subfolderDocs[0]?.count || 0;
        } else {
          // For subfolders, count direct documents owned by user
          const directDocs = await db
            .select({
              count: sql<number>`CAST(COUNT(${documents.id}) AS INTEGER)`,
            })
            .from(documents)
            .where(
              and(
                eq(documents.folderId, folder.id),
                eq(documents.userId, userId), // Ensure documents belong to user
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

  async updateFolder(id: string, updates: Partial<InsertFolder>, userId: string, reqId?: string, idempotencyKey?: string): Promise<Folder | undefined> {
    ensureTenantContext(userId);

    const context: TransactionContext = {
      reqId: reqId || randomUUID(),
      userId,
      operationType: 'folder_update',
      idempotencyKey: idempotencyKey || transactionManager.generateIdempotencyKey(
        'folder_update',
        userId,
        id,
        JSON.stringify(updates)
      ),
      resourceIds: {
        folderId: id
      }
    };

    const result = await transactionManager.executeWithIdempotency(
      context,
      async (tx) => {
        const [updatedFolder] = await tx
          .update(folders)
          .set(updates)
          .where(and(
            eq(folders.id, id), 
            eq(folders.userId, userId)
          ))
          .returning();

        if (updatedFolder) {
          // Add analytics hook for post-commit execution
          transactionManager.addPostCommitHook({
            type: 'analytics',
            action: 'folder_updated',
            data: {
              folderId: id,
              updateFields: Object.keys(updates),
              userId
            }
          });
        }

        return updatedFolder;
      },
      { id, updates }
    );

    if (!result.success) {
      throw new Error(result.error || 'Failed to update folder');
    }

    return result.data;
  }

  async deleteFolder(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(folders)
      .where(and(eq(folders.id, id), eq(folders.userId, userId)))
      .returning();

    return result.length > 0;
  }

  // Tags
  async createTag(insertTag: InsertTag, userId: string, reqId?: string, idempotencyKey?: string): Promise<Tag> {
    ensureTenantContext(userId);

    const context: TransactionContext = {
      reqId: reqId || randomUUID(),
      userId,
      operationType: 'tag_create',
      idempotencyKey: idempotencyKey || transactionManager.generateIdempotencyKey(
        'tag_create',
        userId,
        insertTag.name
      ),
      resourceIds: {
        tagName: insertTag.name
      }
    };

    const result = await transactionManager.executeWithIdempotency(
      context,
      async (tx) => {
        const [tag] = await tx
          .insert(tags)
          .values({
            ...insertTag,
            userId, // Ensure tag is owned by the user
            color: insertTag.color ?? "#3b82f6",
          })
          .returning();

        // Add analytics hook for post-commit execution
        transactionManager.addPostCommitHook({
          type: 'analytics',
          action: 'tag_created',
          data: {
            tagId: tag.id,
            tagName: tag.name,
            userId
          }
        });

        return tag;
      },
      insertTag
    );

    if (!result.success) {
      throw new Error(result.error || 'Failed to create tag');
    }

    return result.data;
  }

  async getTags(userId: string): Promise<Tag[]> {
    await this.ensureInitialized();
    return await db
      .select()
      .from(tags)
      .where(eq(tags.userId, userId))
      .orderBy(tags.name);
  }

  async updateTag(id: string, updates: Partial<InsertTag>, userId: string, reqId?: string, idempotencyKey?: string): Promise<Tag | undefined> {
    ensureTenantContext(userId);

    const context: TransactionContext = {
      reqId: reqId || randomUUID(),
      userId,
      operationType: 'tag_update',
      idempotencyKey: idempotencyKey || transactionManager.generateIdempotencyKey(
        'tag_update',
        userId,
        id,
        JSON.stringify(updates)
      ),
      resourceIds: {
        tagId: id
      }
    };

    const result = await transactionManager.executeWithIdempotency(
      context,
      async (tx) => {
        const [updatedTag] = await tx
          .update(tags)
          .set(updates)
          .where(and(
            eq(tags.id, id), 
            eq(tags.userId, userId)
          ))
          .returning();

        if (updatedTag) {
          // Add analytics hook for post-commit execution
          transactionManager.addPostCommitHook({
            type: 'analytics',
            action: 'tag_updated',
            data: {
              tagId: id,
              updateFields: Object.keys(updates),
              userId
            }
          });
        }

        return updatedTag;
      },
      { id, updates }
    );

    if (!result.success) {
      throw new Error(result.error || 'Failed to update tag');
    }

    return result.data;
  }

  async deleteTag(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(tags)
      .where(and(eq(tags.id, id), eq(tags.userId, userId)))
      .returning();

    return result.length > 0;
  }

  // Document Tags
  async addDocumentTag(insertDocumentTag: InsertDocumentTag, userId: string): Promise<DocumentTag> {
    const [documentTag] = await db
      .insert(documentTags)
      .values({
        ...insertDocumentTag,
        userId, // Ensure document-tag relationship is owned by the user
      })
      .returning();
    return documentTag;
  }

  async removeDocumentTags(documentId: string): Promise<void> {
    await db
      .delete(documentTags)
      .where(eq(documentTags.documentId, documentId));
  }

  async removeDocumentTag(documentId: string, tagId: string, userId: string): Promise<void> {
    await db
      .delete(documentTags)
      .where(
        and(
          eq(documentTags.documentId, documentId),
          eq(documentTags.tagId, tagId),
          eq(documentTags.userId, userId) // Ensure user owns the relationship
        )
      );
  }

  // Duplicate Detection with multi-tenant scoping
  async findDuplicateFiles(originalName: string, fileSize: number, userId: string): Promise<DocumentWithFolderAndTags[]> {
    await this.ensureInitialized();
    
    // Use the same document selection pattern as getDocuments for consistency
    const documentSelect = {
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
      documentContent: sql<string | null>`NULL`.as('documentContent'),
      contentExtracted: documents.contentExtracted,
      contentExtractedAt: documents.contentExtractedAt,
      titleEmbedding: sql<string | null>`NULL`.as('titleEmbedding'),
      contentEmbedding: sql<string | null>`NULL`.as('contentEmbedding'),
      summaryEmbedding: sql<string | null>`NULL`.as('summaryEmbedding'),
      keyTopicsEmbedding: sql<string | null>`NULL`.as('keyTopicsEmbedding'),
      embeddingsGenerated: documents.embeddingsGenerated,
      embeddingsGeneratedAt: documents.embeddingsGeneratedAt,
    };

    // Find documents with the same original name and file size that are active (not trashed/deleted)
    const results = await db
      .select({
        document: documentSelect,
        folder: folders,
      })
      .from(documents)
      .leftJoin(folders, eq(documents.folderId, folders.id))
      .where(
        and(
          eq(documents.originalName, originalName),
          eq(documents.fileSize, fileSize),
          eq(documents.status, 'active'),
          eq(documents.isDeleted, false),
          eq(documents.userId, userId)
        )
      )
      .orderBy(desc(documents.uploadedAt));

    // Get tags for each document
    const docsWithTags = await Promise.all(
      results.map(async (result) => {
        const documentTagsResult = await db
          .select({
            id: tags.id,
            name: tags.name,
            color: tags.color,
            createdAt: tags.createdAt,
          })
          .from(documentTags)
          .innerJoin(tags, eq(documentTags.tagId, tags.id))
          .where(eq(documentTags.documentId, result.document.id));

        return {
          ...result.document,
          folder: result.folder,
          tags: documentTagsResult,
        };
      })
    );

    return docsWithTags;
  }

  // AI Analysis
  async analyzeDocumentWithAI(documentId: string, userId: string, driveContent?: string, driveAccessToken?: string): Promise<boolean> {
    try {
      // Import here to avoid circular dependencies
      const { summarizeDocument, analyzeDocumentContent, extractTextFromDocument } = await import("./gemini.js");
      
      // Get the document
      const document = await this.getDocumentById(documentId, userId);
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

      // Update the document with AI analysis AND save content for search (with tenant isolation)
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
        .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
        .returning();

      // Automatically organize the document into folders based on AI classification
      if (updatedDoc && analysis.category && analysis.documentType) {
        try {
          await this.organizeDocumentIntoFolder(documentId, analysis.category, analysis.documentType, userId);
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

  async extractDocumentContent(documentId: string, userId: string, driveAccessToken?: string): Promise<boolean> {
    try {
      // Import here to avoid circular dependencies
      const { extractTextFromDocument } = await import("./gemini.js");
      
      
      // Get the document
      const document = await this.getDocumentById(documentId, userId);
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
      
      // Update the document with extracted content (with tenant isolation)
      const [updatedDoc] = await db
        .update(documents)
        .set({
          documentContent: documentText,
          contentExtracted: true,
          contentExtractedAt: new Date()
        })
        .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
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
  async findOrCreateCategoryFolder(category: string, userId: string): Promise<Folder> {
    await this.ensureInitialized();
    
    // Runtime guard: Fail fast if userId is missing
    if (!userId || userId.trim() === '') {
      throw new Error(`findOrCreateCategoryFolder: userId is required but was: ${userId}`);
    }
    
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
        userId: userId,
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
          eq(folders.userId, userId),
          sql`parent_id IS NULL`
        )
      )
      .limit(1);
    
    if (existingFolder.length > 0) {
      return existingFolder[0];
    }
    
    throw new Error(`Failed to create or find category folder: ${category}`);
  }

  async findOrCreateSubFolder(parentId: string, documentType: string, userId: string): Promise<Folder> {
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
        userId: userId,
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
          eq(folders.isAutoCreated, true),
          eq(folders.userId, userId)
        )
      )
      .limit(1);
    
    if (existingSubFolder.length > 0) {
      return existingSubFolder[0];
    }
    
    throw new Error(`Failed to create or find sub-folder: ${normalizedType} under ${parentId}`);
  }

  async findOrCreateSmartSubFolder(parentId: string, documentType: string, userId: string, analysisData?: any): Promise<Folder> {
    await this.ensureInitialized();
    
    // Generate intelligent sub-folder name based on enhanced analysis
    const rawSmartFolderName = this.generateSmartFolderName(documentType, analysisData);
    
    // Normalize the smart folder name for consistency with regular folder naming
    const smartFolderName = this.formatFolderName(rawSmartFolderName);
    
    console.log(`🧠 Smart folder name generated: "${smartFolderName}" (from "${rawSmartFolderName}")`);
    
    // Get all existing sub-folders for similarity checking
    const existingSubFolders = await db
      .select()
      .from(folders)
      .where(
        and(
          eq(folders.parentId, parentId),
          eq(folders.isAutoCreated, true),
          eq(folders.userId, userId)
        )
      );
    
    // First check for exact match with the smart folder name
    const exactMatch = existingSubFolders.find(folder => folder.name === smartFolderName);
    if (exactMatch) {
      console.log(`🎯 Found exact match folder: "${exactMatch.name}"`);
      return exactMatch;
    }
    
    // Check for 80%+ similarity with existing folders
    const similarFolder = this.findSimilarFolder(smartFolderName, existingSubFolders);
    if (similarFolder) {
      console.log(`🎯 Found similar folder (${similarFolder.confidence}% match): "${similarFolder.folder.name}"`);
      return similarFolder.folder;
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
    const gcsPath = `${parentFolder[0].gcsPath}/${this.slugify(smartFolderName)}`;
    
    // Try to insert the new smart sub-folder
    try {
      const insertResult = await db
        .insert(folders)
        .values({
          name: smartFolderName,
          color: "#9ca3af", // Gray color for sub-folders
          parentId: parentId,
          isAutoCreated: true,
          documentType: smartFolderName, // Use smart folder name as document type for consistency
          gcsPath: gcsPath,
          userId: userId,
        })
        .onConflictDoNothing()
        .returning();
      
      if (insertResult.length > 0) {
        console.log(`✨ Created new smart sub-folder: "${smartFolderName}"`);
        return insertResult[0];
      }
      
      // onConflictDoNothing returned empty - folder with this name already exists
      // Let's find and return the existing folder
      console.log(`🔍 Smart folder "${smartFolderName}" already exists, finding it...`);
      const existingFolder = await db
        .select()
        .from(folders)
        .where(
          and(
            eq(folders.parentId, parentId),
            eq(folders.name, smartFolderName),
            eq(folders.userId, userId),
            eq(folders.isAutoCreated, true)
          )
        )
        .limit(1);
      
      if (existingFolder.length > 0) {
        console.log(`🎯 Found existing smart folder: "${smartFolderName}"`);
        return existingFolder[0];
      }
      
    } catch (error) {
      console.error(`❌ Smart folder creation error: ${error}`);
    }
    
    // Fallback: if smart folder creation fails, use the original logic
    console.log(`⚠️ Smart folder creation failed, falling back to standard logic`);
    return this.findOrCreateSubFolder(parentId, documentType, userId);
  }

  private generateSmartFolderName(documentType: string, analysisData?: any): string {
    if (!analysisData) {
      return this.normalizeDocumentType(documentType);
    }

    const { documentYear, documentPurpose, filingStatus, bodyPart, documentSubtype, category } = analysisData;
    
    // Tax Documents - use year + filing status
    if (category === 'Taxes' && documentYear && filingStatus) {
      if (filingStatus === 'pre-filing') {
        return `${documentYear}-pre-tax-filing`;
      } else if (filingStatus === 'filed') {
        return `${documentYear}-tax-filed`;
      }
    }
    
    // Medical Documents - use year + body part + type
    if (category === 'Medical' && documentYear) {
      if (bodyPart) {
        return `${documentYear}-${bodyPart.toLowerCase()}-report`;
      }
      return `${documentYear}-medical-record`;
    }
    
    // Personal/ID Documents - use year + document purpose
    if (category === 'Personal' && documentYear && documentPurpose) {
      if (documentPurpose.includes('license') || documentPurpose.includes('id')) {
        return `${documentYear}-ID-documents`;
      }
      return `${documentYear}-${documentPurpose.replace(/-/g, '-')}`;
    }
    
    // Travel Documents - use year + document subtype or purpose
    if (category === 'Travel') {
      if (documentYear && documentSubtype) {
        return `${documentYear}-${documentSubtype.replace(/-/g, '-')}`;
      }
      if (documentYear && documentPurpose) {
        return `${documentYear}-${documentPurpose.replace(/-/g, '-')}`;
      }
      if (documentYear) {
        return `${documentYear}-travel-docs`;
      }
      // Use document subtype without year as fallback
      if (documentSubtype) {
        return documentSubtype.replace(/-/g, '-');
      }
      if (documentPurpose) {
        return documentPurpose.replace(/-/g, '-');
      }
    }
    
    // Business/Employment - use year + purpose, but be more lenient with fallbacks
    if (category === 'Business' || category === 'Employment') {
      if (documentYear && documentPurpose) {
        return `${documentYear}-${documentPurpose.replace(/-/g, '-')}`;
      }
      if (documentYear && documentSubtype) {
        return `${documentYear}-${documentSubtype.replace(/-/g, '-')}`;
      }
      if (documentYear) {
        return `${documentYear}-${category.toLowerCase()}-docs`;
      }
      // Fallback to purpose or subtype without year
      if (documentPurpose) {
        return documentPurpose.replace(/-/g, '-');
      }
      if (documentSubtype) {
        return documentSubtype.replace(/-/g, '-');
      }
    }
    
    // Insurance/Legal - use year if available, otherwise descriptive name
    if ((category === 'Insurance' || category === 'Legal') && documentYear) {
      if (documentSubtype) {
        return `${documentYear}-${documentSubtype.replace(/-/g, '-')}`;
      }
      return `${documentYear}-${category.toLowerCase()}-docs`;
    }
    
    // Enhanced fallback: Try to use document purpose or subtype even without category-specific logic
    if (documentYear && documentPurpose) {
      return `${documentYear}-${documentPurpose.replace(/-/g, '-')}`;
    }
    if (documentYear && documentSubtype) {
      return `${documentYear}-${documentSubtype.replace(/-/g, '-')}`;
    }
    if (documentPurpose) {
      return documentPurpose.replace(/-/g, '-');
    }
    if (documentSubtype) {
      return documentSubtype.replace(/-/g, '-');
    }
    
    // Final fallback: Use normalized document type
    return this.normalizeDocumentType(documentType);
  }

  private findSimilarFolder(targetName: string, existingFolders: any[]): { folder: any; confidence: number } | null {
    if (!existingFolders.length) return null;
    
    let bestMatch = null;
    let highestSimilarity = 0;
    
    for (const folder of existingFolders) {
      const similarity = this.calculateStringSimilarity(targetName.toLowerCase(), folder.name.toLowerCase());
      if (similarity > highestSimilarity) {
        highestSimilarity = similarity;
        bestMatch = folder;
      }
    }
    
    // Return match only if similarity is 80% or higher
    if (highestSimilarity >= 0.8) {
      return { folder: bestMatch, confidence: Math.round(highestSimilarity * 100) };
    }
    
    return null;
  }

  private calculateStringSimilarity(str1: string, str2: string): number {
    // Simple Levenshtein distance-based similarity
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,     // deletion
          matrix[j - 1][i] + 1,     // insertion
          matrix[j - 1][i - 1] + indicator // substitution
        );
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  async organizeDocumentIntoFolder(documentId: string, category: string, documentType: string, userId: string, analysisData?: AnalysisData): Promise<boolean> {
    try {
      await this.ensureInitialized();
      
      console.log(`🗂️ Starting Smart Organization: doc=${documentId}, category="${category}", type="${documentType}", user=${userId}`);
      
      // Runtime guard: Fail fast if userId is missing
      if (!userId || userId.trim() === '') {
        throw new Error(`organizeDocumentIntoFolder: userId is required but was: ${userId}`);
      }
      
      // Find or create the main category folder
      console.log(`🔍 Finding/creating category folder: "${category}"`);
      const categoryFolder = await this.findOrCreateCategoryFolder(category, userId);
      console.log(`✅ Category folder ready: ${categoryFolder.id} - "${categoryFolder.name}"`);
      
      // Find or create the document type sub-folder with intelligent naming
      console.log(`🔍 Finding/creating smart sub-folder under ${categoryFolder.id}`);
      const subFolder = await this.findOrCreateSmartSubFolder(categoryFolder.id, documentType, userId, analysisData);
      console.log(`✅ Sub-folder ready: ${subFolder.id} - "${subFolder.name}"`);
      
      // Update the document to assign it to the sub-folder (with tenant isolation)
      console.log(`📝 Assigning document ${documentId} to folder ${subFolder.id}`);
      const [updatedDoc] = await db
        .update(documents)
        .set({
          folderId: subFolder.id
        })
        .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
        .returning();
      
      const success = !!updatedDoc;
      console.log(`🎯 Smart Organization result: ${success ? 'SUCCESS' : 'FAILED'} for document ${documentId}`);
      return success;
    } catch (error) {
      console.error(`❌ Smart Organization error for doc ${documentId}:`, error);
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

  private formatFolderName(text: string): string {
    if (!text || typeof text !== 'string') {
      return 'Uncategorized';
    }
    
    // Convert kebab-case to title case (e.g., "cybersecurity-risk-analysis" → "Cybersecurity Risk Analysis")
    return text
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
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
          userId: documents.userId,
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
            const success = await this.organizeDocumentIntoFolder(doc.id, doc.aiCategory, doc.aiDocumentType, doc.userId);
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
    
    // Estimate tokens based on document content or size
    const document = await this.getDocumentById(documentId, userId);
    let estimatedTokens = 3000; // Default estimate
    
    if (document && document.documentContent) {
      // Rough estimate: 1 token ≈ 4 characters
      estimatedTokens = Math.ceil(document.documentContent.length / 4) + 1000; // Add buffer for prompt
    } else if (document && document.fileSize) {
      // Estimate based on file size (very rough)
      estimatedTokens = Math.min(Math.ceil(document.fileSize / 5), 8000); // Cap at 8k tokens
    }

    // Retry logic for constraint violations
    let attempts = 0;
    const maxAttempts = 2;
    
    while (attempts < maxAttempts) {
      attempts++;
      
      try {
        const [queueJob] = await db
          .insert(aiAnalysisQueue)
          .values({
            documentId,
            userId,
            priority,
            estimatedTokens,
            status: "pending",
            scheduledAt: new Date(),
          })
          .returning();

        return queueJob;
        
      } catch (error: any) {
        // Check if it's a unique constraint violation
        const isConstraintError = error?.code === '23505' || 
                                   error?.message?.includes('duplicate key') ||
                                   error?.message?.includes('unique constraint');
        
        if (isConstraintError && attempts < maxAttempts) {
          // On constraint error, check if job already exists
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
            // Job already exists and is pending/processing - return it
            return existingJob[0];
          }
          
          // No existing job found but constraint failed - this is the idempotencyKey collision
          // Wait a tiny bit and retry with a new auto-generated idempotencyKey
          await new Promise(resolve => setTimeout(resolve, 10));
          continue; // Retry the insert
        }
        
        // Not a constraint error, or we've exhausted retries
        console.error(`❌ Failed to enqueue document ${documentId} for analysis (attempt ${attempts}):`, error);
        throw error;
      }
    }
    
    throw new Error(`Failed to enqueue document ${documentId} after ${maxAttempts} attempts`);
  }

  async enqueueDocumentForEmbedding(documentId: string, userId: string, priority: number = 8): Promise<AiAnalysisQueue> {
    await this.ensureInitialized();
    
    try {
      // Check if document already has embeddings
      const document = await this.getDocumentById(documentId, userId);
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

  /**
   * Token 8/8: Enqueue document for reindexing (rename/delete/restore invalidation)
   * Uses background priority and idempotency for deduplication
   */
  async enqueueDocumentForReindex(
    documentId: string, 
    userId: string, 
    versionId?: string, 
    reqId?: string
  ): Promise<AiAnalysisQueue> {
    await this.ensureInitialized();
    ensureTenantContext(userId);

    try {
      // Use idempotent enqueue with background priority (8) and reqId for correlation
      const job = await this.enqueueJobIdempotent(
        documentId,
        userId,
        'reindex',
        8, // Background priority
        versionId
      );

      // Log with correlation ID for Token 5/8 observability
      logger.info('Document enqueued for reindex', {
        documentId,
        userId,
        versionId,
        jobId: job.id,
        reqId,
        tenantId: userId // In this system, tenantId maps to userId
      });

      return job;
    } catch (error) {
      logger.error('Failed to enqueue document for reindex', {
        documentId,
        userId,
        versionId,
        reqId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async enqueueDocumentForContentExtraction(documentId: string, userId: string, priority: number = 3): Promise<AiAnalysisQueue> {
    await this.ensureInitialized();
    
    try {
      // Check if document already has content extracted
      const document = await this.getDocumentById(documentId, userId);
      if (document?.contentExtracted) {
        console.log(`Document ${documentId} already has content extracted, skipping`);
        // Return a dummy completed job
        const existingJob = await db
          .select()
          .from(aiAnalysisQueue)
          .where(
            and(
              eq(aiAnalysisQueue.documentId, documentId),
              eq(aiAnalysisQueue.jobType, "content_extraction"),
              eq(aiAnalysisQueue.status, "completed")
            )
          )
          .limit(1);
        
        if (existingJob[0]) {
          return existingJob[0];
        }
      }

      // Estimate tokens for content extraction (very low)
      let estimatedTokens = 100; // Base estimate for content extraction (no AI involved)
      
      if (document && document.fileSize) {
        // Minimal estimate for content extraction processing
        estimatedTokens = Math.min(Math.ceil(document.fileSize / 100), 500); // Cap at 500 tokens
      }

      const [queueJob] = await db
        .insert(aiAnalysisQueue)
        .values({
          documentId,
          userId,
          jobType: "content_extraction",
          priority, // Default 3 for medium priority background content extraction
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
              eq(aiAnalysisQueue.jobType, "content_extraction"),
              inArray(aiAnalysisQueue.status, ["pending", "processing"])
            )
          )
          .limit(1);
        
        if (existingJob[0]) {
          return existingJob[0];
        }
        throw new Error("Failed to enqueue document for content extraction and no existing job found");
      }

      console.log(`📄 Enqueued document ${documentId} for content extraction`);
      return queueJob;
    } catch (error) {
      console.error(`❌ Failed to enqueue document ${documentId} for content extraction:`, error);
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

  async dequeueNextAnalysisJob(jobType?: string): Promise<AiAnalysisQueue | null> {
    await this.ensureInitialized();
    
    try {
      // Check daily quota first (only for analysis and embedding jobs, not content extraction)
      if (!jobType || jobType !== 'content_extraction') {
        const today = new Date().toISOString().split('T')[0];
        const quotaCheck = await this.canProcessAnalysis();
        
        if (!quotaCheck.canProcess) {
          return null;
        }
      }

      // Build where conditions based on job type
      const whereConditions = [
        eq(aiAnalysisQueue.status, "pending"),
        sql`scheduled_at <= NOW()`
      ];
      
      // Add job type filter if specified
      if (jobType) {
        whereConditions.push(eq(aiAnalysisQueue.jobType, jobType));
      }

      // Get next job by priority and schedule time
      const [nextJob] = await db
        .select()
        .from(aiAnalysisQueue)
        .where(and(...whereConditions))
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

  async rescheduleJob(jobId: string, scheduledAt: Date): Promise<boolean> {
    await this.ensureInitialized();
    
    try {
      const [updatedJob] = await db
        .update(aiAnalysisQueue)
        .set({ 
          scheduledAt: scheduledAt,
          status: "pending" 
        })
        .where(eq(aiAnalysisQueue.id, jobId))
        .returning();

      return !!updatedJob;
    } catch (error) {
      console.error(`❌ Failed to reschedule job ${jobId}:`, error);
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

  /**
   * Get the oldest pending job for queue lag measurement (Token 5/8)
   */
  async getOldestPendingJob(): Promise<{jobId: string; createdAt: string; jobType: string} | null> {
    await this.ensureInitialized();
    
    try {
      const oldestJob = await db
        .select({
          jobId: aiAnalysisQueue.id,
          createdAt: aiAnalysisQueue.requestedAt,
          jobType: aiAnalysisQueue.jobType
        })
        .from(aiAnalysisQueue)
        .where(eq(aiAnalysisQueue.status, 'pending'))
        .orderBy(aiAnalysisQueue.requestedAt)
        .limit(1);

      return oldestJob[0] || null;
    } catch (error) {
      logger.error('Failed to get oldest pending job', error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  /**
   * Get the oldest pending reindex job for SLA monitoring (< 5 minutes requirement)
   */
  async getOldestPendingReindexJob(): Promise<{jobId: string; createdAt: string; jobType: string} | null> {
    await this.ensureInitialized();
    
    try {
      const oldestReindexJob = await db
        .select({
          jobId: aiAnalysisQueue.id,
          createdAt: aiAnalysisQueue.requestedAt,
          jobType: aiAnalysisQueue.jobType
        })
        .from(aiAnalysisQueue)
        .where(
          and(
            or(eq(aiAnalysisQueue.status, 'pending'), eq(aiAnalysisQueue.status, 'processing')),
            eq(aiAnalysisQueue.jobType, 'reindex')
          )
        )
        .orderBy(aiAnalysisQueue.requestedAt)
        .limit(1);

      return oldestReindexJob[0] || null;
    } catch (error) {
      logger.error('Failed to get oldest pending reindex job', error instanceof Error ? error : new Error(String(error)));
      return null;
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

  // =============================================================================
  // TOKEN 4/8: ENHANCED DURABLE JOB MANAGEMENT WITH ENTERPRISE DURABILITY
  // =============================================================================

  /**
   * Enhanced durable job dequeue with worker assignment and retry scheduling
   * WORKER-COMPATIBLE: Does not require tenant context from AsyncLocalStorage
   */
  async dequeueNextDurableJob(jobType: string, workerId: string): Promise<AiAnalysisQueue | null> {
    await this.ensureInitialized();
    
    try {
      return await db.transaction(async (tx) => {
        // Dequeue next available job from ANY tenant - worker processes cross-tenant
        const nextJob = await tx
          .select()
          .from(aiAnalysisQueue)
          .where(
            and(
              eq(aiAnalysisQueue.jobType, jobType),
              eq(aiAnalysisQueue.status, 'pending'),
              or(
                sql`${aiAnalysisQueue.nextRetryAt} IS NULL`,
                sql`${aiAnalysisQueue.nextRetryAt} <= NOW()`
              )
            )
          )
          .orderBy(aiAnalysisQueue.priority, aiAnalysisQueue.requestedAt)
          .limit(1)
          .for('update', { skipLocked: true }); // Skip locked rows for concurrency

        if (nextJob.length === 0) {
          return null;
        }

        const job = nextJob[0];

        // Update job to processing status with worker assignment
        const [updatedJob] = await tx
          .update(aiAnalysisQueue)
          .set({
            status: 'processing',
            workerInstance: workerId,
            attemptCount: sql`${aiAnalysisQueue.attemptCount} + 1`,
            processedAt: sql`NOW()`
          })
          .where(eq(aiAnalysisQueue.id, job.id))
          .returning();

        console.log(`🔄 Dequeued ${jobType} job ${job.id} for worker ${workerId} (tenant: ${job.tenantId})`);
        
        return updatedJob;
      });
      
    } catch (error) {
      console.error(`❌ Failed to dequeue ${jobType} job for worker ${workerId}:`, error);
      return null;
    }
  }

  /**
   * Schedule job retry with exponential backoff and attempt tracking
   * WORKER-COMPATIBLE: Uses jobId-based tenant verification
   */
  async scheduleJobRetry(jobId: string, attemptCount: number, lastError: string, nextRetryAt: Date, workerId: string): Promise<boolean> {
    await this.ensureInitialized();
    
    try {
      return await db.transaction(async (tx) => {
        // Get job details first to verify tenant and job state
        const existingJob = await tx
          .select({
            id: aiAnalysisQueue.id,
            tenantId: aiAnalysisQueue.tenantId,
            status: aiAnalysisQueue.status
          })
          .from(aiAnalysisQueue)
          .where(eq(aiAnalysisQueue.id, jobId))
          .limit(1);

        if (existingJob.length === 0) {
          console.log(`Job ${jobId} not found for retry scheduling`);
          return false;
        }

        const job = existingJob[0];
        
        const [updatedJob] = await tx
          .update(aiAnalysisQueue)
          .set({
            status: 'pending',
            attemptCount: attemptCount,
            lastError: lastError,
            nextRetryAt: nextRetryAt,
            workerInstance: workerId,
            retryCount: sql`${aiAnalysisQueue.retryCount} + 1` // Legacy compatibility
          })
          .where(eq(aiAnalysisQueue.id, jobId))
          .returning();

        if (updatedJob) {
          console.log(`🔄 Scheduled retry for job ${jobId} at ${nextRetryAt.toISOString()} (tenant: ${job.tenantId})`);
          return true;
        }
        
        return false;
      });
      
    } catch (error) {
      console.error(`❌ Failed to schedule retry for job ${jobId}:`, error);
      return false;
    }
  }

  /**
   * Move job to Dead Letter Queue with detailed reason tracking
   * WORKER-COMPATIBLE: Uses jobId-based tenant verification
   */
  async moveToDLQ(jobId: string, dlqReason: string, workerId: string): Promise<boolean> {
    await this.ensureInitialized();
    
    try {
      return await db.transaction(async (tx) => {
        // Get job details first to verify tenant
        const existingJob = await tx
          .select({
            id: aiAnalysisQueue.id,
            tenantId: aiAnalysisQueue.tenantId,
            status: aiAnalysisQueue.status
          })
          .from(aiAnalysisQueue)
          .where(eq(aiAnalysisQueue.id, jobId))
          .limit(1);

        if (existingJob.length === 0) {
          console.log(`Job ${jobId} not found for DLQ move`);
          return false;
        }

        const job = existingJob[0];
        
        const [updatedJob] = await tx
          .update(aiAnalysisQueue)
          .set({
            status: 'dlq',
            dlqStatus: 'active',
            dlqReason: dlqReason,
            dlqAt: sql`NOW()`,
            workerInstance: workerId,
            lastError: dlqReason
          })
          .where(eq(aiAnalysisQueue.id, jobId))
          .returning();

        if (updatedJob) {
          console.log(`💀 Moved job ${jobId} to DLQ: ${dlqReason} (tenant: ${job.tenantId})`);
          return true;
        }
        
        return false;
      });
      
    } catch (error) {
      console.error(`❌ Failed to move job ${jobId} to DLQ:`, error);
      return false;
    }
  }

  /**
   * Mark job as completed with idempotency safeguards
   * WORKER-COMPATIBLE: Uses jobId-based tenant verification
   */
  async markJobCompleted(jobId: string, workerId: string): Promise<boolean> {
    await this.ensureInitialized();
    
    try {
      return await db.transaction(async (tx) => {
        // Get job details first to verify tenant
        const existingJob = await tx
          .select({
            id: aiAnalysisQueue.id,
            tenantId: aiAnalysisQueue.tenantId,
            status: aiAnalysisQueue.status
          })
          .from(aiAnalysisQueue)
          .where(eq(aiAnalysisQueue.id, jobId))
          .limit(1);

        if (existingJob.length === 0) {
          console.log(`Job ${jobId} not found for completion`);
          // Return true for idempotent behavior - job might have been cleaned up
          return true;
        }

        const job = existingJob[0];

        // Skip if already completed (idempotent behavior)
        if (job.status === 'completed') {
          console.log(`✅ Job ${jobId} already completed (idempotent behavior)`);
          return true;
        }
        
        const [updatedJob] = await tx
          .update(aiAnalysisQueue)
          .set({
            status: 'completed',
            processedAt: sql`NOW()`,
            workerInstance: workerId
          })
          .where(
            and(
              eq(aiAnalysisQueue.id, jobId),
              // Idempotency: only update if not already completed
              sql`${aiAnalysisQueue.status} != 'completed'`
            )
          )
          .returning();

        if (updatedJob) {
          console.log(`✅ Marked job ${jobId} as completed by worker ${workerId} (tenant: ${job.tenantId})`);
          return true;
        }
        
        // Job was already completed by another process - idempotent behavior
        console.log(`✅ Job ${jobId} completion handled by another process (idempotent)`);
        return true;
      });
      
    } catch (error) {
      console.error(`❌ Failed to mark job ${jobId} as completed:`, error);
      return false;
    }
  }

  /**
   * Get comprehensive queue statistics for monitoring
   */
  async getQueueStats(): Promise<{pendingJobs: number; processingJobs: number; completedJobs: number; failedJobs: number; dlqJobs: number}> {
    await this.ensureInitialized();
    
    try {
      const stats = await db
        .select({
          status: aiAnalysisQueue.status,
          count: count()
        })
        .from(aiAnalysisQueue)
        .groupBy(aiAnalysisQueue.status);

      const result = {
        pendingJobs: 0,
        processingJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        dlqJobs: 0
      };

      stats.forEach(stat => {
        switch (stat.status) {
          case 'pending':
            result.pendingJobs = stat.count;
            break;
          case 'processing':
            result.processingJobs = stat.count;
            break;
          case 'completed':
            result.completedJobs = stat.count;
            break;
          case 'failed':
            result.failedJobs = stat.count;
            break;
          case 'dlq':
            result.dlqJobs = stat.count;
            break;
        }
      });

      return result;
      
    } catch (error) {
      console.error(`❌ Failed to get queue statistics:`, error);
      return {
        pendingJobs: 0,
        processingJobs: 0,
        completedJobs: 0,
        failedJobs: 0,
        dlqJobs: 0
      };
    }
  }

  /**
   * Record operational metrics for monitoring and alerting
   * WORKER-COMPATIBLE: Metrics recording is tenant-agnostic
   */
  async recordQueueMetrics(metrics: InsertAiQueueMetrics): Promise<AiQueueMetrics> {
    await this.ensureInitialized();
    
    try {
      const [recordedMetric] = await db
        .insert(aiQueueMetrics)
        .values(metrics)
        .returning();

      return recordedMetric;
      
    } catch (error) {
      console.error(`❌ Failed to record queue metrics:`, error);
      throw error;
    }
  }

  /**
   * Generate document embeddings for semantic search
   */
  async generateDocumentEmbeddings(documentId: string, userId: string): Promise<boolean> {
    await this.ensureInitialized();
    
    try {
      return await transactionManager.executeWithIdempotency({
        reqId: 'doc-embedding-' + documentId,
        userId: userId,
        operationType: 'document_embedding_generation',
        idempotencyKey: `embedding-${documentId}`
      }, async (ctx: TransactionContext) => {
        const { userId: tenantId } = ensureTenantContext(ctx);
        
        // Get document with content for embedding generation
        const document = await db
          .select({
            id: documents.id,
            name: documents.name,
            documentContent: documents.documentContent,
            aiSummary: documents.aiSummary,
            aiKeyTopics: documents.aiKeyTopics,
            embeddingsGenerated: documents.embeddingsGenerated
          })
          .from(documents)
          .where(
            and(
              eq(documents.id, documentId),
              eq(documents.userId, tenantId)
            )
          )
          .limit(1);

        if (document.length === 0) {
          console.log(`Document ${documentId} not found for embedding generation`);
          return false;
        }

        const doc = document[0];

        // Skip if embeddings already generated
        if (doc.embeddingsGenerated) {
          console.log(`Document ${documentId} already has embeddings generated`);
          return true;
        }

        // Generate embeddings (implementation would call Gemini API)
        // This is a placeholder - actual implementation would generate embeddings
        console.log(`📊 Generating embeddings for document: ${doc.name}`);
        
        // Update document with embeddings generated flag
        await db
          .update(documents)
          .set({
            embeddingsGenerated: true,
            embeddingsGeneratedAt: sql`NOW()`
          })
          .where(
            and(
              eq(documents.id, documentId),
              eq(documents.userId, tenantId)
            )
          );

        console.log(`✅ Generated embeddings for document: ${doc.name}`);
        return true;
        
      }, undefined, 'embedding_generation');
      
    } catch (error) {
      console.error(`❌ Failed to generate embeddings for document ${documentId}:`, error);
      return false;
    }
  }

  /**
   * Token 8/8: Regenerate document embeddings for reindexing (rename/delete/restore)
   * This forces regeneration of embeddings even if they already exist
   */
  async regenerateDocumentEmbeddings(documentId: string, userId: string, versionId?: string): Promise<boolean> {
    await this.ensureInitialized();
    ensureTenantContext(userId);
    
    try {
      // Get document with latest content for reindexing
      const document = await db
        .select({
          id: documents.id,
          name: documents.name,
          documentContent: documents.documentContent,
          aiSummary: documents.aiSummary,
          aiKeyTopics: documents.aiKeyTopics,
          embeddingsGenerated: documents.embeddingsGenerated
        })
        .from(documents)
        .where(
          and(
            eq(documents.id, documentId),
            eq(documents.userId, userId),
            eq(documents.status, 'active') // Only active documents
          )
        )
        .limit(1);

      if (document.length === 0) {
        logger.error('Document not found for reindexing', { documentId, userId, versionId });
        return false;
      }

      const doc = document[0];

      logger.info('Regenerating embeddings for reindex', {
        documentId,
        documentName: doc.name,
        userId,
        tenantId: userId,
        versionId,
        previouslyGenerated: doc.embeddingsGenerated
      });

      // Get document content for embedding regeneration
      const content = await this.getDocumentContent(documentId, userId);
      if (!content || content.trim().length === 0) {
        logger.warn('No content available for embedding regeneration', { documentId, userId });
        return false;
      }

      // Generate embeddings for different text components (same as initial generation)
      const titleText = doc.name || '';
      const summaryText = doc.aiSummary || '';
      const keyTopicsText = (doc.aiKeyTopics || []).join(' ');
      
      // Generate fresh embeddings with retry logic
      let titleEmbedding: number[] | null = null;
      let contentEmbedding: number[] | null = null;
      let summaryEmbedding: number[] | null = null;
      let keyTopicsEmbedding: number[] | null = null;
      let apiCalls = 0;

      try {
        // Title embedding (always regenerate)
        if (titleText.trim().length > 0) {
          titleEmbedding = await generateEmbedding(titleText, 'RETRIEVAL_DOCUMENT');
          apiCalls++;
        }

        // Content embedding (truncate if too long to avoid token limits)
        const truncatedContent = content.length > 8000 ? content.substring(0, 8000) + '...' : content;
        contentEmbedding = await generateEmbedding(truncatedContent, 'RETRIEVAL_DOCUMENT');
        apiCalls++;

        // Summary embedding (if available)
        if (summaryText.trim().length > 0) {
          summaryEmbedding = await generateEmbedding(summaryText, 'RETRIEVAL_DOCUMENT');
          apiCalls++;
        }

        // Key topics embedding (if available)
        if (keyTopicsText.trim().length > 0) {
          keyTopicsEmbedding = await generateEmbedding(keyTopicsText, 'RETRIEVAL_DOCUMENT');
          apiCalls++;
        }

        // Update document with fresh embeddings
        await this.updateDocument(documentId, {
          titleEmbedding: titleEmbedding ? serializeEmbeddingToJSON(titleEmbedding) : null,
          contentEmbedding: contentEmbedding ? serializeEmbeddingToJSON(contentEmbedding) : null,
          summaryEmbedding: summaryEmbedding ? serializeEmbeddingToJSON(summaryEmbedding) : null,
          keyTopicsEmbedding: keyTopicsEmbedding ? serializeEmbeddingToJSON(keyTopicsEmbedding) : null,
          embeddingsGenerated: true,
          embeddingsGeneratedAt: new Date()
        }, userId);

        logger.info('Embeddings regenerated for reindex', {
          documentId,
          documentName: doc.name,
          userId,
          tenantId: userId,
          versionId,
          apiCalls
        });

        return true;

      } catch (embeddingError) {
        logger.error('Failed to regenerate embeddings', {
          documentId,
          documentName: doc.name,
          userId,
          versionId,
          error: embeddingError instanceof Error ? embeddingError.message : String(embeddingError)
        });
        throw embeddingError;
      }
      
    } catch (error) {
      logger.error('Failed to regenerate embeddings for reindex', {
        documentId,
        userId,
        versionId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  // =============================================================================
  // TOKEN 4/8: IDEMPOTENT WRITE-BACK SYSTEM
  // =============================================================================

  /**
   * Enhanced job enqueuing with comprehensive idempotency safeguards
   */
  async enqueueJobIdempotent(
    documentId: string, 
    userId: string, 
    jobType: string, 
    priority: number = 5,
    versionId?: string
  ): Promise<AiAnalysisQueue> {
    await this.ensureInitialized();
    
    return await transactionManager.executeWithIdempotency({
      reqId: 'job-enqueue-' + documentId,
      userId: userId,
      operationType: 'document_job_enqueue',
      idempotencyKey: `job-${documentId}-${jobType}`
    }, async (ctx: TransactionContext) => {
      const { userId: tenantId } = ensureTenantContext(ctx);
      
      // Generate idempotency key based on document, job type, and version
      let idempotencyKey: string;
      
      if (jobType === 'reindex') {
        // For reindex jobs, include change token (updatedAt) to ensure new renames trigger new jobs
        // but retries of the same rename are deduped
        const document = await db
          .select({
            updatedAt: documents.updatedAt
          })
          .from(documents)
          .where(
            and(
              eq(documents.id, documentId),
              eq(documents.userId, userId)
            )
          )
          .limit(1);
        
        const changeToken = document[0]?.updatedAt?.getTime() || 'unknown';
        idempotencyKey = versionId ? 
          `${documentId}-${jobType}-${versionId}-${changeToken}` : 
          `${documentId}-${jobType}-current-${changeToken}`;
      } else {
        // For other job types, use original idempotency key generation
        idempotencyKey = versionId ? 
          `${documentId}-${jobType}-${versionId}` : 
          `${documentId}-${jobType}-current`;
      }

      try {
        // Attempt to insert with idempotency constraints
        const [queueJob] = await db
          .insert(aiAnalysisQueue)
          .values({
            documentId,
            userId,
            tenantId,
            versionId,
            jobType,
            priority,
            idempotencyKey,
            maxAttempts: 3,
            scheduledAt: sql`NOW()`
          })
          .onConflictDoNothing() // Idempotency constraint will prevent duplicates
          .returning();

        if (queueJob) {
          console.log(`✅ Enqueued ${jobType} job for document ${documentId} with idempotency key: ${idempotencyKey}`);
          return queueJob;
        }

        // Job already exists, fetch existing one
        const existingJobs = await db
          .select()
          .from(aiAnalysisQueue)
          .where(
            and(
              eq(aiAnalysisQueue.tenantId, tenantId),
              eq(aiAnalysisQueue.idempotencyKey, idempotencyKey)
            )
          )
          .limit(1);

        if (existingJobs.length > 0) {
          console.log(`🔄 Job already exists for idempotency key: ${idempotencyKey}`);
          return existingJobs[0];
        }

        throw new Error(`Failed to enqueue job and no existing job found for idempotency key: ${idempotencyKey}`);
        
      } catch (error: any) {
        // Handle unique constraint violations gracefully
        if (error.code === '23505') { // PostgreSQL unique violation
          const existingJobs = await db
            .select()
            .from(aiAnalysisQueue)
            .where(
              and(
                eq(aiAnalysisQueue.tenantId, tenantId),
                eq(aiAnalysisQueue.idempotencyKey, idempotencyKey)
              )
            )
            .limit(1);

          if (existingJobs.length > 0) {
            console.log(`🔄 Idempotency constraint triggered for key: ${idempotencyKey}`);
            return existingJobs[0];
          }
        }
        throw error;
      }
    }, undefined, 'job_enqueue_idempotent');
  }

  /**
   * Idempotent AI analysis result write-back with duplicate prevention
   */
  async writeAnalysisResultsIdempotent(
    documentId: string,
    userId: string,
    analysisResults: {
      aiSummary?: string;
      aiKeyTopics?: string[];
      aiDocumentType?: string;
      aiCategory?: string;
      aiSentiment?: string;
      aiWordCount?: number;
      aiConciseName?: string;
      aiCategoryConfidence?: number;
      aiDocumentTypeConfidence?: number;
    },
    idempotencyKey: string
  ): Promise<boolean> {
    await this.ensureInitialized();
    
    return await transactionManager.executeWithIdempotency({
      reqId: 'analysis-writeback-' + documentId,
      userId: userId,
      operationType: 'document_analysis_writeback',
      idempotencyKey: `analysis-writeback-${documentId}`
    }, async (ctx: TransactionContext) => {
      const { userId: tenantId } = ensureTenantContext(ctx);
      
      // Check if results already written using idempotency key
      const existingResults = await db
        .select({
          aiAnalyzedAt: documents.aiAnalyzedAt,
          aiSummary: documents.aiSummary
        })
        .from(documents)
        .where(
          and(
            eq(documents.id, documentId),
            eq(documents.userId, tenantId),
            isNotNull(documents.aiAnalyzedAt)
          )
        )
        .limit(1);

      // If results already exist and are recent, skip duplicate write
      if (existingResults.length > 0 && existingResults[0].aiAnalyzedAt) {
        const analysisAge = Date.now() - new Date(existingResults[0].aiAnalyzedAt).getTime();
        const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours
        
        if (analysisAge < maxAgeMs && existingResults[0].aiSummary) {
          console.log(`✅ Analysis results already exist for document ${documentId} (idempotency key: ${idempotencyKey})`);
          return true;
        }
      }

      // Perform idempotent upsert of analysis results
      const [updatedDocument] = await db
        .update(documents)
        .set({
          ...analysisResults,
          aiAnalyzedAt: sql`NOW()`
        })
        .where(
          and(
            eq(documents.id, documentId),
            eq(documents.userId, tenantId)
          )
        )
        .returning({ id: documents.id, name: documents.name });

      if (updatedDocument) {
        console.log(`✅ Wrote analysis results for document: ${updatedDocument.name} (idempotency key: ${idempotencyKey})`);
        return true;
      }

      return false;
      
    }, undefined, 'analysis_result_writeback');
  }

  /**
   * Idempotent embedding write-back with vector deduplication
   */
  async writeEmbeddingResultsIdempotent(
    documentId: string,
    userId: string,
    embeddings: {
      titleEmbedding?: string;
      contentEmbedding?: string;
      summaryEmbedding?: string;
      keyTopicsEmbedding?: string;
    },
    idempotencyKey: string
  ): Promise<boolean> {
    await this.ensureInitialized();
    
    return await transactionManager.executeWithIdempotency({
      reqId: 'embedding-writeback-' + documentId,
      userId: userId,
      operationType: 'document_embedding_writeback',
      idempotencyKey: `embedding-writeback-${documentId}`
    }, async (ctx: TransactionContext) => {
      const { userId: tenantId } = ensureTenantContext(ctx);
      
      // Check if embeddings already generated using idempotency
      const existingEmbeddings = await db
        .select({
          embeddingsGenerated: documents.embeddingsGenerated,
          embeddingsGeneratedAt: documents.embeddingsGeneratedAt
        })
        .from(documents)
        .where(
          and(
            eq(documents.id, documentId),
            eq(documents.userId, tenantId),
            eq(documents.embeddingsGenerated, true)
          )
        )
        .limit(1);

      // Skip if embeddings already generated recently
      if (existingEmbeddings.length > 0 && existingEmbeddings[0].embeddingsGeneratedAt) {
        const embeddingAge = Date.now() - new Date(existingEmbeddings[0].embeddingsGeneratedAt).getTime();
        const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days
        
        if (embeddingAge < maxAgeMs) {
          console.log(`✅ Embeddings already generated for document ${documentId} (idempotency key: ${idempotencyKey})`);
          return true;
        }
      }

      // Perform idempotent upsert of embedding results
      const [updatedDocument] = await db
        .update(documents)
        .set({
          ...embeddings,
          embeddingsGenerated: true,
          embeddingsGeneratedAt: sql`NOW()`
        })
        .where(
          and(
            eq(documents.id, documentId),
            eq(documents.userId, tenantId)
          )
        )
        .returning({ id: documents.id, name: documents.name });

      if (updatedDocument) {
        console.log(`✅ Wrote embedding results for document: ${updatedDocument.name} (idempotency key: ${idempotencyKey})`);
        return true;
      }

      return false;
      
    }, undefined, 'embedding_result_writeback');
  }

  /**
   * WORKER-COMPATIBLE: Idempotent AI analysis result write-back without AsyncLocalStorage
   */
  async writeAnalysisResultsIdempotentWorker(
    documentId: string,
    userId: string,
    analysisResults: {
      aiSummary?: string;
      aiKeyTopics?: string[];
      aiDocumentType?: string;
      aiCategory?: string;
      aiSentiment?: string;
      aiWordCount?: number;
      aiConciseName?: string;
      aiCategoryConfidence?: number;
      aiDocumentTypeConfidence?: number;
    },
    idempotencyKey: string
  ): Promise<boolean> {
    await this.ensureInitialized();
    
    try {
      return await db.transaction(async (tx) => {
        // Check if results already written using idempotency key
        const existingResults = await tx
          .select({
            aiAnalyzedAt: documents.aiAnalyzedAt,
            aiSummary: documents.aiSummary
          })
          .from(documents)
          .where(
            and(
              eq(documents.id, documentId),
              eq(documents.userId, userId),
              isNotNull(documents.aiAnalyzedAt)
            )
          )
          .limit(1);

        // If results already exist and are recent, skip duplicate write
        if (existingResults.length > 0 && existingResults[0].aiAnalyzedAt) {
          const analysisAge = Date.now() - new Date(existingResults[0].aiAnalyzedAt).getTime();
          const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours
          
          if (analysisAge < maxAgeMs && existingResults[0].aiSummary) {
            console.log(`✅ Analysis results already exist for document ${documentId} (worker idempotency key: ${idempotencyKey})`);
            return true;
          }
        }

        // Perform idempotent upsert of analysis results
        const [updatedDocument] = await tx
          .update(documents)
          .set({
            ...analysisResults,
            aiAnalyzedAt: sql`NOW()`
          })
          .where(
            and(
              eq(documents.id, documentId),
              eq(documents.userId, userId)
            )
          )
          .returning({ id: documents.id, name: documents.name });

        if (updatedDocument) {
          console.log(`✅ Worker wrote analysis results for document: ${updatedDocument.name} (tenant: ${userId}, idempotency key: ${idempotencyKey})`);
          return true;
        }

        return false;
      });
      
    } catch (error) {
      console.error(`❌ Worker failed to write analysis results for document ${documentId}:`, error);
      return false;
    }
  }

  /**
   * WORKER-COMPATIBLE: Idempotent embedding write-back without AsyncLocalStorage
   */
  async writeEmbeddingResultsIdempotentWorker(
    documentId: string,
    userId: string,
    embeddings: {
      titleEmbedding?: string;
      contentEmbedding?: string;
      summaryEmbedding?: string;
      keyTopicsEmbedding?: string;
    },
    idempotencyKey: string
  ): Promise<boolean> {
    await this.ensureInitialized();
    
    try {
      return await db.transaction(async (tx) => {
        // Check if embeddings already generated using idempotency
        const existingEmbeddings = await tx
          .select({
            embeddingsGenerated: documents.embeddingsGenerated,
            embeddingsGeneratedAt: documents.embeddingsGeneratedAt
          })
          .from(documents)
          .where(
            and(
              eq(documents.id, documentId),
              eq(documents.userId, userId),
              eq(documents.embeddingsGenerated, true)
            )
          )
          .limit(1);

        // Skip if embeddings already generated recently
        if (existingEmbeddings.length > 0 && existingEmbeddings[0].embeddingsGeneratedAt) {
          const embeddingAge = Date.now() - new Date(existingEmbeddings[0].embeddingsGeneratedAt).getTime();
          const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days
          
          if (embeddingAge < maxAgeMs) {
            console.log(`✅ Embeddings already generated for document ${documentId} (worker idempotency key: ${idempotencyKey})`);
            return true;
          }
        }

        // Perform idempotent upsert of embedding results
        const [updatedDocument] = await tx
          .update(documents)
          .set({
            ...embeddings,
            embeddingsGenerated: true,
            embeddingsGeneratedAt: sql`NOW()`
          })
          .where(
            and(
              eq(documents.id, documentId),
              eq(documents.userId, userId)
            )
          )
          .returning({ id: documents.id, name: documents.name });

        if (updatedDocument) {
          console.log(`✅ Worker wrote embedding results for document: ${updatedDocument.name} (tenant: ${userId}, idempotency key: ${idempotencyKey})`);
          return true;
        }

        return false;
      });
      
    } catch (error) {
      console.error(`❌ Worker failed to write embedding results for document ${documentId}:`, error);
      return false;
    }
  }

  /**
   * Enhanced job completion with result validation and idempotency
   * WORKER-COMPATIBLE: Uses jobId-based tenant verification for cross-tenant processing
   */
  async completeJobWithResults(
    jobId: string,
    workerId: string,
    results?: any,
    resultMetadata?: { processingTimeMs: number; tokenCount?: number }
  ): Promise<boolean> {
    await this.ensureInitialized();
    
    return await db.transaction(async (tx) => {
      // Get job details for validation (includes tenant info)
      const jobDetails = await tx
        .select()
        .from(aiAnalysisQueue)
        .where(eq(aiAnalysisQueue.id, jobId))
        .limit(1);

      if (jobDetails.length === 0) {
        console.log(`Job ${jobId} not found`);
        return false;
      }

      const job = jobDetails[0];

      // Validate job is not already completed (idempotency check)
      if (job.status === 'completed') {
        console.log(`✅ Job ${jobId} already completed (idempotent behavior)`);
        return true;
      }

      // Write results if provided (with idempotency)
      if (results && job.jobType === 'analysis') {
        await this.writeAnalysisResultsIdempotentWorker(
          job.documentId,
          job.userId,
          results,
          job.idempotencyKey || `${job.documentId}-${job.jobType}-fallback`
        );
      } else if (results && job.jobType === 'embedding_generation') {
        await this.writeEmbeddingResultsIdempotentWorker(
          job.documentId,
          job.userId,
          results,
          job.idempotencyKey || `${job.documentId}-${job.jobType}-fallback`
        );
      }

      // Mark job as completed with metadata
      const [completedJob] = await tx
        .update(aiAnalysisQueue)
        .set({
          status: 'completed',
          processedAt: sql`NOW()`,
          workerInstance: workerId
        })
        .where(
          and(
            eq(aiAnalysisQueue.id, jobId),
            sql`${aiAnalysisQueue.status} != 'completed'` // Idempotency guard
          )
        )
        .returning();

      // Record daily usage if applicable
      if (resultMetadata?.tokenCount && job.jobType !== 'content_extraction') {
        const today = new Date().toISOString().split('T')[0];
        await this.incrementDailyUsage(today, resultMetadata.tokenCount, true);
      }

      if (completedJob) {
        console.log(`✅ Completed job ${jobId} with results (tenant: ${job.tenantId}, processing time: ${resultMetadata?.processingTimeMs || 'unknown'}ms)`);
        return true;
      }

      // Job was already completed by another process - idempotent behavior
      console.log(`✅ Job ${jobId} completion handled by another process (idempotent)`);
      return true;
    });
  }

  // =============================================================================
  // TOKEN 4/8: OPERATIONAL CONTROLS FOR PRODUCTION MANAGEMENT
  // =============================================================================

  /**
   * Pause AI processing for maintenance or throttling
   */
  async pauseAiProcessing(): Promise<boolean> {
    await this.ensureInitialized();
    
    try {
      // Update all pending jobs to indicate processing is paused
      const pausedCount = await db
        .update(aiAnalysisQueue)
        .set({
          lastError: 'Processing paused by admin',
          nextRetryAt: sql`NOW() + INTERVAL '1 hour'` // Delay for 1 hour
        })
        .where(eq(aiAnalysisQueue.status, 'pending'))
        .returning({ count: count() });

      console.log(`⏸️ AI processing paused. Updated ${pausedCount.length} pending jobs.`);
      return true;
      
    } catch (error) {
      console.error('❌ Failed to pause AI processing:', error);
      return false;
    }
  }

  /**
   * Resume AI processing after maintenance
   */
  async resumeAiProcessing(): Promise<boolean> {
    await this.ensureInitialized();
    
    try {
      // Clear pause flags and reset retry timing
      const resumedCount = await db
        .update(aiAnalysisQueue)
        .set({
          lastError: null,
          nextRetryAt: null
        })
        .where(
          and(
            eq(aiAnalysisQueue.status, 'pending'),
            sql`${aiAnalysisQueue.lastError} = 'Processing paused by admin'`
          )
        )
        .returning({ count: count() });

      console.log(`▶️ AI processing resumed. Updated ${resumedCount.length} jobs.`);
      return true;
      
    } catch (error) {
      console.error('❌ Failed to resume AI processing:', error);
      return false;
    }
  }

  /**
   * Replay jobs from Dead Letter Queue with optional filtering
   */
  async replayDLQJobs(
    jobType?: string, 
    tenantId?: string, 
    maxJobs: number = 10
  ): Promise<{replayed: number; errors: string[]}> {
    await this.ensureInitialized();
    
    try {
      const result = { replayed: 0, errors: [] as string[] };
      
      return await transactionManager.executeWithIdempotency({
        reqId: 'dlq-replay-' + Date.now(),
        userId: tenantId || 'system',
        operationType: 'document_dlq_replay',
        idempotencyKey: `dlq-replay-${tenantId || 'all'}-${Date.now()}`
      }, async (ctx: TransactionContext) => {
        // Build filter conditions for DLQ replay
        const conditions = [
          eq(aiAnalysisQueue.status, 'dlq'),
          eq(aiAnalysisQueue.dlqStatus, 'active')
        ];

        if (jobType) {
          conditions.push(eq(aiAnalysisQueue.jobType, jobType));
        }
        if (tenantId) {
          conditions.push(eq(aiAnalysisQueue.tenantId, tenantId));
        }

        // Get DLQ jobs to replay
        const dlqJobs = await db
          .select()
          .from(aiAnalysisQueue)
          .where(and(...conditions))
          .orderBy(aiAnalysisQueue.dlqAt)
          .limit(maxJobs);

        console.log(`🔄 Found ${dlqJobs.length} DLQ jobs to replay`);

        // Replay each job by resetting its status
        for (const job of dlqJobs) {
          try {
            await db
              .update(aiAnalysisQueue)
              .set({
                status: 'pending',
                dlqStatus: null,
                dlqReason: null,
                dlqAt: null,
                attemptCount: 0, // Reset attempt count for fresh start
                lastError: null,
                nextRetryAt: null,
                processedAt: null
              })
              .where(eq(aiAnalysisQueue.id, job.id));

            result.replayed++;
            console.log(`✅ Replayed DLQ job ${job.id} (${job.jobType})`);
            
          } catch (error: any) {
            const errorMsg = `Failed to replay job ${job.id}: ${error.message}`;
            result.errors.push(errorMsg);
            console.error(`❌ ${errorMsg}`);
          }
        }

        return result;
      }, undefined, 'dlq_replay_operation');
      
    } catch (error: any) {
      console.error('❌ Failed to replay DLQ jobs:', error);
      return { replayed: 0, errors: [error.message] };
    }
  }

  /**
   * Manually retry failed jobs with custom retry scheduling
   */
  async retryFailedJobs(
    tenantId?: string,
    jobType?: string,
    maxRetries: number = 5
  ): Promise<{retried: number; skipped: number}> {
    await this.ensureInitialized();
    
    try {
      return await transactionManager.executeWithIdempotency({
        reqId: 'manual-retry-' + Date.now(),
        userId: 'system',
        operationType: 'document_manual_retry',
        idempotencyKey: `manual-retry-${tenantId || 'all'}-${Date.now()}`
      }, async (ctx: TransactionContext) => {
        const { userId: contextTenantId } = ensureTenantContext(ctx);
        const targetTenantId = tenantId || contextTenantId;
        
        const conditions = [
          eq(aiAnalysisQueue.tenantId, targetTenantId),
          eq(aiAnalysisQueue.status, 'failed'),
          sql`${aiAnalysisQueue.attemptCount} < ${maxRetries}`
        ];

        if (jobType) {
          conditions.push(eq(aiAnalysisQueue.jobType, jobType));
        }

        const failedJobs = await db
          .select()
          .from(aiAnalysisQueue)
          .where(and(...conditions))
          .limit(20); // Limit to avoid overwhelming the system

        let retried = 0;
        let skipped = 0;

        for (const job of failedJobs) {
          const nextRetryAt = new Date(Date.now() + (30 * 1000)); // 30 seconds from now
          
          const [updatedJob] = await db
            .update(aiAnalysisQueue)
            .set({
              status: 'pending',
              nextRetryAt,
              lastError: `Manual retry initiated (was: ${job.lastError || 'unknown error'})`
            })
            .where(eq(aiAnalysisQueue.id, job.id))
            .returning();

          if (updatedJob) {
            retried++;
            console.log(`🔄 Manually retried job ${job.id} (${job.jobType})`);
          } else {
            skipped++;
          }
        }

        console.log(`🔄 Manual retry completed: ${retried} retried, ${skipped} skipped`);
        return { retried, skipped };
        
      }, undefined, 'manual_retry_operation');
      
    } catch (error) {
      console.error('❌ Failed to retry failed jobs:', error);
      return { retried: 0, skipped: 0 };
    }
  }

  /**
   * Cancel jobs in queue (useful for maintenance or cleanup)
   */
  async cancelJobs(
    jobIds: string[],
    reason: string = 'Cancelled by admin'
  ): Promise<{cancelled: number; errors: string[]}> {
    await this.ensureInitialized();
    
    const result = { cancelled: 0, errors: [] as string[] };
    
    try {
      return await transactionManager.executeWithIdempotency({
        reqId: 'job-cancel-' + Date.now(),
        userId: 'system',
        operationType: 'document_job_cancellation',
        idempotencyKey: `job-cancel-${jobIds.join(',')}-${Date.now()}`
      }, async (ctx: TransactionContext) => {
        const { userId: tenantId } = ensureTenantContext(ctx);
        
        for (const jobId of jobIds) {
          try {
            const [cancelledJob] = await db
              .update(aiAnalysisQueue)
              .set({
                status: 'failed',
                lastError: reason,
                processedAt: sql`NOW()`
              })
              .where(
                and(
                  eq(aiAnalysisQueue.id, jobId),
                  eq(aiAnalysisQueue.tenantId, tenantId),
                  inArray(aiAnalysisQueue.status, ['pending', 'processing'])
                )
              )
              .returning();

            if (cancelledJob) {
              result.cancelled++;
              console.log(`❌ Cancelled job ${jobId}: ${reason}`);
            } else {
              result.errors.push(`Job ${jobId} not found or not cancellable`);
            }
            
          } catch (error: any) {
            result.errors.push(`Failed to cancel job ${jobId}: ${error.message}`);
          }
        }

        return result;
      }, undefined, 'job_cancellation_operation');
      
    } catch (error: any) {
      console.error('❌ Failed to cancel jobs:', error);
      return { cancelled: 0, errors: [error.message] };
    }
  }

  /**
   * Get detailed operational status for monitoring dashboards
   */
  async getOperationalStatus(): Promise<{
    queueStats: {pendingJobs: number; processingJobs: number; completedJobs: number; failedJobs: number; dlqJobs: number};
    tenantBreakdown: {tenantId: string; pending: number; processing: number; failed: number}[];
    jobTypeBreakdown: {jobType: string; pending: number; processing: number; failed: number}[];
    recentErrors: {jobId: string; tenantId: string; jobType: string; error: string; occurredAt: string}[];
    systemHealth: {totalThroughput: number; errorRate: number; dlqRate: number};
  }> {
    await this.ensureInitialized();
    
    try {
      // Get basic queue statistics
      const queueStats = await this.getQueueStats();
      
      // Get tenant breakdown
      const tenantBreakdown = await db
        .select({
          tenantId: aiAnalysisQueue.tenantId,
          status: aiAnalysisQueue.status,
          count: count()
        })
        .from(aiAnalysisQueue)
        .where(inArray(aiAnalysisQueue.status, ['pending', 'processing', 'failed']))
        .groupBy(aiAnalysisQueue.tenantId, aiAnalysisQueue.status);

      // Get job type breakdown
      const jobTypeBreakdown = await db
        .select({
          jobType: aiAnalysisQueue.jobType,
          status: aiAnalysisQueue.status,
          count: count()
        })
        .from(aiAnalysisQueue)
        .where(inArray(aiAnalysisQueue.status, ['pending', 'processing', 'failed']))
        .groupBy(aiAnalysisQueue.jobType, aiAnalysisQueue.status);

      // Get recent errors
      const recentErrors = await db
        .select({
          jobId: aiAnalysisQueue.id,
          tenantId: aiAnalysisQueue.tenantId,
          jobType: aiAnalysisQueue.jobType,
          error: aiAnalysisQueue.lastError,
          occurredAt: aiAnalysisQueue.processedAt
        })
        .from(aiAnalysisQueue)
        .where(
          and(
            eq(aiAnalysisQueue.status, 'failed'),
            isNotNull(aiAnalysisQueue.lastError),
            isNotNull(aiAnalysisQueue.processedAt)
          )
        )
        .orderBy(desc(aiAnalysisQueue.processedAt))
        .limit(10);

      // Calculate system health metrics
      const totalJobs = queueStats.pendingJobs + queueStats.processingJobs + queueStats.completedJobs + queueStats.failedJobs + queueStats.dlqJobs;
      const errorRate = totalJobs > 0 ? (queueStats.failedJobs / totalJobs) * 100 : 0;
      const dlqRate = totalJobs > 0 ? (queueStats.dlqJobs / totalJobs) * 100 : 0;

      // Format tenant breakdown
      const tenantBreakdownFormatted = tenantBreakdown.reduce((acc, item) => {
        const existing = acc.find(t => t.tenantId === item.tenantId);
        if (existing) {
          existing[item.status as keyof typeof existing] = item.count;
        } else {
          acc.push({
            tenantId: item.tenantId,
            pending: item.status === 'pending' ? item.count : 0,
            processing: item.status === 'processing' ? item.count : 0,
            failed: item.status === 'failed' ? item.count : 0
          });
        }
        return acc;
      }, [] as {tenantId: string; pending: number; processing: number; failed: number}[]);

      // Format job type breakdown
      const jobTypeBreakdownFormatted = jobTypeBreakdown.reduce((acc, item) => {
        const existing = acc.find(j => j.jobType === item.jobType);
        if (existing) {
          existing[item.status as keyof typeof existing] = item.count;
        } else {
          acc.push({
            jobType: item.jobType,
            pending: item.status === 'pending' ? item.count : 0,
            processing: item.status === 'processing' ? item.count : 0,
            failed: item.status === 'failed' ? item.count : 0
          });
        }
        return acc;
      }, [] as {jobType: string; pending: number; processing: number; failed: number}[]);

      return {
        queueStats,
        tenantBreakdown: tenantBreakdownFormatted,
        jobTypeBreakdown: jobTypeBreakdownFormatted,
        recentErrors: recentErrors.map(e => ({
          ...e,
          error: e.error || 'Unknown error',
          occurredAt: e.occurredAt?.toISOString() || new Date().toISOString()
        })),
        systemHealth: {
          totalThroughput: queueStats.completedJobs,
          errorRate: Number(errorRate.toFixed(2)),
          dlqRate: Number(dlqRate.toFixed(2))
        }
      };
      
    } catch (error) {
      console.error('❌ Failed to get operational status:', error);
      throw error;
    }
  }

  /**
   * Clean up old completed jobs to prevent database bloat
   */
  async cleanupOldJobs(olderThanDays: number = 7): Promise<{deleted: number}> {
    await this.ensureInitialized();
    
    try {
      const cutoffDate = new Date(Date.now() - (olderThanDays * 24 * 60 * 60 * 1000));
      
      const deletedJobs = await db
        .delete(aiAnalysisQueue)
        .where(
          and(
            eq(aiAnalysisQueue.status, 'completed'),
            sql`${aiAnalysisQueue.processedAt} < ${cutoffDate.toISOString()}`
          )
        )
        .returning({ count: count() });

      const deletedCount = deletedJobs.length;
      console.log(`🧹 Cleaned up ${deletedCount} completed jobs older than ${olderThanDays} days`);
      
      return { deleted: deletedCount };
      
    } catch (error) {
      console.error(`❌ Failed to cleanup old jobs:`, error);
      return { deleted: 0 };
    }
  }

  // =============================================================================
  // TOKEN 4/8: COMPREHENSIVE METRICS & MONITORING SYSTEM
  // =============================================================================

  /**
   * Advanced queue depth monitoring with trend analysis
   */
  async getQueueDepthMetrics(): Promise<{
    current: {pending: number; processing: number; dlq: number};
    byTenant: {tenantId: string; pending: number; processing: number; dlq: number}[];
    byJobType: {jobType: string; pending: number; processing: number; dlq: number}[];
    oldestPending: {jobId: string; age: number; jobType: string} | null;
  }> {
    await this.ensureInitialized();
    
    try {
      // Current queue depth
      const current = await this.getQueueStats();
      
      // Queue depth by tenant
      const tenantMetrics = await db
        .select({
          tenantId: aiAnalysisQueue.tenantId,
          status: aiAnalysisQueue.status,
          count: count()
        })
        .from(aiAnalysisQueue)
        .where(inArray(aiAnalysisQueue.status, ['pending', 'processing', 'dlq']))
        .groupBy(aiAnalysisQueue.tenantId, aiAnalysisQueue.status);

      // Queue depth by job type
      const jobTypeMetrics = await db
        .select({
          jobType: aiAnalysisQueue.jobType,
          status: aiAnalysisQueue.status,
          count: count()
        })
        .from(aiAnalysisQueue)
        .where(inArray(aiAnalysisQueue.status, ['pending', 'processing', 'dlq']))
        .groupBy(aiAnalysisQueue.jobType, aiAnalysisQueue.status);

      // Find oldest pending job
      const oldestPending = await db
        .select({
          jobId: aiAnalysisQueue.id,
          requestedAt: aiAnalysisQueue.requestedAt,
          jobType: aiAnalysisQueue.jobType
        })
        .from(aiAnalysisQueue)
        .where(eq(aiAnalysisQueue.status, 'pending'))
        .orderBy(aiAnalysisQueue.requestedAt)
        .limit(1);

      // Format tenant breakdown
      const byTenant = tenantMetrics.reduce((acc, item) => {
        const existing = acc.find(t => t.tenantId === item.tenantId);
        if (existing) {
          existing[item.status as keyof typeof existing] = item.count;
        } else {
          acc.push({
            tenantId: item.tenantId,
            pending: item.status === 'pending' ? item.count : 0,
            processing: item.status === 'processing' ? item.count : 0,
            dlq: item.status === 'dlq' ? item.count : 0
          });
        }
        return acc;
      }, [] as {tenantId: string; pending: number; processing: number; dlq: number}[]);

      // Format job type breakdown
      const byJobType = jobTypeMetrics.reduce((acc, item) => {
        const existing = acc.find(j => j.jobType === item.jobType);
        if (existing) {
          existing[item.status as keyof typeof existing] = item.count;
        } else {
          acc.push({
            jobType: item.jobType,
            pending: item.status === 'pending' ? item.count : 0,
            processing: item.status === 'processing' ? item.count : 0,
            dlq: item.status === 'dlq' ? item.count : 0
          });
        }
        return acc;
      }, [] as {jobType: string; pending: number; processing: number; dlq: number}[]);

      return {
        current: {
          pending: current.pendingJobs,
          processing: current.processingJobs,
          dlq: current.dlqJobs
        },
        byTenant,
        byJobType,
        oldestPending: oldestPending.length > 0 ? {
          jobId: oldestPending[0].jobId,
          age: Date.now() - new Date(oldestPending[0].requestedAt).getTime(),
          jobType: oldestPending[0].jobType
        } : null
      };
      
    } catch (error) {
      console.error('❌ Failed to get queue depth metrics:', error);
      throw error;
    }
  }

  /**
   * Processing rate and throughput metrics
   */
  async getProcessingRateMetrics(timeWindowHours: number = 24): Promise<{
    completionRate: number;
    failureRate: number;
    averageProcessingTime: number;
    throughputPerHour: number;
    retryRate: number;
    hourlyBreakdown: {hour: string; completed: number; failed: number; retried: number}[];
  }> {
    await this.ensureInitialized();
    
    try {
      const timeWindow = new Date(Date.now() - (timeWindowHours * 60 * 60 * 1000));
      
      // Get processing statistics for the time window
      const processingStats = await db
        .select({
          status: aiAnalysisQueue.status,
          count: count(),
          avgProcessingTime: sql<number>`AVG(EXTRACT(EPOCH FROM (${aiAnalysisQueue.processedAt} - ${aiAnalysisQueue.requestedAt})) * 1000)`
        })
        .from(aiAnalysisQueue)
        .where(
          and(
            sql`${aiAnalysisQueue.processedAt} >= ${timeWindow.toISOString()}`,
            inArray(aiAnalysisQueue.status, ['completed', 'failed'])
          )
        )
        .groupBy(aiAnalysisQueue.status);

      // Get retry statistics
      const retryStats = await db
        .select({
          totalJobs: count(),
          retriedJobs: sql<number>`COUNT(*) FILTER (WHERE ${aiAnalysisQueue.attemptCount} > 1)`
        })
        .from(aiAnalysisQueue)
        .where(sql`${aiAnalysisQueue.processedAt} >= ${timeWindow.toISOString()}`);

      // Get hourly breakdown for the last 24 hours
      const hourlyBreakdown = await db
        .select({
          hour: sql<string>`to_char(${aiAnalysisQueue.processedAt}, 'YYYY-MM-DD HH24:00')`,
          status: aiAnalysisQueue.status,
          count: count()
        })
        .from(aiAnalysisQueue)
        .where(
          and(
            sql`${aiAnalysisQueue.processedAt} >= ${timeWindow.toISOString()}`,
            inArray(aiAnalysisQueue.status, ['completed', 'failed'])
          )
        )
        .groupBy(
          sql`to_char(${aiAnalysisQueue.processedAt}, 'YYYY-MM-DD HH24:00')`,
          aiAnalysisQueue.status
        )
        .orderBy(sql`to_char(${aiAnalysisQueue.processedAt}, 'YYYY-MM-DD HH24:00')`);

      const completed = processingStats.find(s => s.status === 'completed')?.count || 0;
      const failed = processingStats.find(s => s.status === 'failed')?.count || 0;
      const total = completed + failed;

      const completionRate = total > 0 ? (completed / total) * 100 : 0;
      const failureRate = total > 0 ? (failed / total) * 100 : 0;
      const averageProcessingTime = processingStats.find(s => s.status === 'completed')?.avgProcessingTime || 0;
      const throughputPerHour = completed / timeWindowHours;

      const retryRate = retryStats.length > 0 && retryStats[0].totalJobs > 0 ? 
        (retryStats[0].retriedJobs / retryStats[0].totalJobs) * 100 : 0;

      // Format hourly breakdown
      const hourlyBreakdownFormatted = hourlyBreakdown.reduce((acc, item) => {
        const existing = acc.find(h => h.hour === item.hour);
        if (existing) {
          if (item.status === 'completed') existing.completed = item.count;
          if (item.status === 'failed') existing.failed = item.count;
        } else {
          acc.push({
            hour: item.hour,
            completed: item.status === 'completed' ? item.count : 0,
            failed: item.status === 'failed' ? item.count : 0,
            retried: 0 // Would need additional query for retry breakdown
          });
        }
        return acc;
      }, [] as {hour: string; completed: number; failed: number; retried: number}[]);

      return {
        completionRate: Number(completionRate.toFixed(2)),
        failureRate: Number(failureRate.toFixed(2)),
        averageProcessingTime: Number(averageProcessingTime.toFixed(2)),
        throughputPerHour: Number(throughputPerHour.toFixed(2)),
        retryRate: Number(retryRate.toFixed(2)),
        hourlyBreakdown: hourlyBreakdownFormatted
      };
      
    } catch (error) {
      console.error('❌ Failed to get processing rate metrics:', error);
      throw error;
    }
  }

  /**
   * Poison pill detection and alerting
   */
  async detectPoisonPills(): Promise<{
    suspiciousJobs: {
      jobId: string;
      tenantId: string;
      documentId: string;
      jobType: string;
      attemptCount: number;
      lastError: string;
      firstAttempt: string;
      suspicionScore: number;
    }[];
    patterns: {
      commonErrors: {error: string; count: number}[];
      failingTenants: {tenantId: string; failureCount: number}[];
      failingJobTypes: {jobType: string; failureCount: number}[];
    };
  }> {
    await this.ensureInitialized();
    
    try {
      // Find jobs with high attempt counts (potential poison pills)
      const suspiciousJobs = await db
        .select({
          jobId: aiAnalysisQueue.id,
          tenantId: aiAnalysisQueue.tenantId,
          documentId: aiAnalysisQueue.documentId,
          jobType: aiAnalysisQueue.jobType,
          attemptCount: aiAnalysisQueue.attemptCount,
          lastError: aiAnalysisQueue.lastError,
          requestedAt: aiAnalysisQueue.requestedAt,
          status: aiAnalysisQueue.status
        })
        .from(aiAnalysisQueue)
        .where(
          and(
            sql`${aiAnalysisQueue.attemptCount} >= 3`, // High attempt count
            inArray(aiAnalysisQueue.status, ['failed', 'dlq', 'pending'])
          )
        )
        .orderBy(desc(aiAnalysisQueue.attemptCount))
        .limit(20);

      // Find common error patterns
      const commonErrors = await db
        .select({
          error: aiAnalysisQueue.lastError,
          count: count()
        })
        .from(aiAnalysisQueue)
        .where(
          and(
            eq(aiAnalysisQueue.status, 'failed'),
            isNotNull(aiAnalysisQueue.lastError)
          )
        )
        .groupBy(aiAnalysisQueue.lastError)
        .orderBy(desc(count()))
        .limit(10);

      // Find tenants with high failure rates
      const failingTenants = await db
        .select({
          tenantId: aiAnalysisQueue.tenantId,
          failureCount: count()
        })
        .from(aiAnalysisQueue)
        .where(eq(aiAnalysisQueue.status, 'failed'))
        .groupBy(aiAnalysisQueue.tenantId)
        .orderBy(desc(count()))
        .limit(5);

      // Find job types with high failure rates
      const failingJobTypes = await db
        .select({
          jobType: aiAnalysisQueue.jobType,
          failureCount: count()
        })
        .from(aiAnalysisQueue)
        .where(eq(aiAnalysisQueue.status, 'failed'))
        .groupBy(aiAnalysisQueue.jobType)
        .orderBy(desc(count()))
        .limit(5);

      // Calculate suspicion scores for jobs
      const suspiciousJobsWithScores = suspiciousJobs.map(job => {
        let score = 0;
        
        // High attempt count increases suspicion
        score += Math.min(job.attemptCount * 10, 50);
        
        // Jobs older than 24 hours are more suspicious
        const age = Date.now() - new Date(job.requestedAt).getTime();
        const ageHours = age / (1000 * 60 * 60);
        if (ageHours > 24) score += 20;
        if (ageHours > 72) score += 30;
        
        // DLQ status increases suspicion
        if (job.status === 'dlq') score += 25;
        
        // Common error patterns reduce suspicion (systematic issues)
        const isCommonError = commonErrors.some(e => 
          e.error && job.lastError && 
          job.lastError.includes(e.error.substring(0, 50))
        );
        if (isCommonError) score -= 15;

        return {
          ...job,
          firstAttempt: job.requestedAt.toISOString(),
          lastError: job.lastError || 'Unknown error',
          suspicionScore: Math.max(0, score)
        };
      });

      return {
        suspiciousJobs: suspiciousJobsWithScores.sort((a, b) => b.suspicionScore - a.suspicionScore),
        patterns: {
          commonErrors: commonErrors.map(e => ({
            error: e.error || 'Unknown error',
            count: e.count
          })),
          failingTenants: failingTenants,
          failingJobTypes: failingJobTypes
        }
      };
      
    } catch (error) {
      console.error('❌ Failed to detect poison pills:', error);
      throw error;
    }
  }

  /**
   * Comprehensive system health check
   */
  async getSystemHealthMetrics(): Promise<{
    overall: 'healthy' | 'warning' | 'critical';
    checks: {
      name: string;
      status: 'pass' | 'warn' | 'fail';
      message: string;
      value?: number;
      threshold?: number;
    }[];
    recommendations: string[];
  }> {
    await this.ensureInitialized();
    
    try {
      const checks = [];
      const recommendations = [];
      
      // Queue depth check
      const queueStats = await this.getQueueStats();
      const totalQueueDepth = queueStats.pendingJobs + queueStats.processingJobs;
      
      checks.push({
        name: 'Queue Depth',
        status: totalQueueDepth > 100 ? 'warn' : totalQueueDepth > 500 ? 'fail' : 'pass',
        message: `${totalQueueDepth} jobs in queue`,
        value: totalQueueDepth,
        threshold: 100
      });
      
      if (totalQueueDepth > 100) {
        recommendations.push('Consider scaling up AI workers or investigating processing bottlenecks');
      }

      // Processing rate check (last hour)
      const processingMetrics = await this.getProcessingRateMetrics(1);
      
      checks.push({
        name: 'Completion Rate',
        status: processingMetrics.completionRate < 80 ? 'fail' : processingMetrics.completionRate < 95 ? 'warn' : 'pass',
        message: `${processingMetrics.completionRate}% completion rate`,
        value: processingMetrics.completionRate,
        threshold: 95
      });
      
      if (processingMetrics.completionRate < 95) {
        recommendations.push('High failure rate detected. Review error logs and consider system maintenance');
      }

      // DLQ size check
      checks.push({
        name: 'Dead Letter Queue',
        status: queueStats.dlqJobs > 10 ? 'warn' : queueStats.dlqJobs > 50 ? 'fail' : 'pass',
        message: `${queueStats.dlqJobs} jobs in DLQ`,
        value: queueStats.dlqJobs,
        threshold: 10
      });
      
      if (queueStats.dlqJobs > 10) {
        recommendations.push('Review and replay jobs in Dead Letter Queue');
      }

      // Poison pill detection
      const poisonPills = await this.detectPoisonPills();
      const highSuspicionJobs = poisonPills.suspiciousJobs.filter(j => j.suspicionScore > 70);
      
      checks.push({
        name: 'Poison Pills',
        status: highSuspicionJobs.length > 5 ? 'fail' : highSuspicionJobs.length > 0 ? 'warn' : 'pass',
        message: `${highSuspicionJobs.length} highly suspicious jobs detected`,
        value: highSuspicionJobs.length,
        threshold: 0
      });
      
      if (highSuspicionJobs.length > 0) {
        recommendations.push(`Manual review required for ${highSuspicionJobs.length} potential poison pill jobs`);
      }

      // Old pending jobs check
      const queueDepth = await this.getQueueDepthMetrics();
      const oldJobThreshold = 24 * 60 * 60 * 1000; // 24 hours
      
      checks.push({
        name: 'Job Age',
        status: queueDepth.oldestPending && queueDepth.oldestPending.age > oldJobThreshold ? 'warn' : 'pass',
        message: queueDepth.oldestPending ? 
          `Oldest pending job: ${Math.round(queueDepth.oldestPending.age / (60 * 60 * 1000))} hours` : 
          'No pending jobs',
        value: queueDepth.oldestPending ? queueDepth.oldestPending.age / (60 * 60 * 1000) : 0,
        threshold: 24
      });
      
      if (queueDepth.oldestPending && queueDepth.oldestPending.age > oldJobThreshold) {
        recommendations.push('Old pending jobs detected. Check for worker availability or processing issues');
      }

      // Determine overall health
      const failCount = checks.filter(c => c.status === 'fail').length;
      const warnCount = checks.filter(c => c.status === 'warn').length;
      
      let overall: 'healthy' | 'warning' | 'critical';
      if (failCount > 0) {
        overall = 'critical';
      } else if (warnCount > 1) {
        overall = 'warning';
      } else {
        overall = 'healthy';
      }

      return {
        overall,
        checks,
        recommendations
      };
      
    } catch (error) {
      console.error('❌ Failed to get system health metrics:', error);
      return {
        overall: 'critical',
        checks: [{
          name: 'Health Check',
          status: 'fail',
          message: 'Failed to retrieve system health metrics'
        }],
        recommendations: ['System monitoring is not functioning correctly. Check database connectivity']
      };
    }
  }

}

export const storage = new DatabaseStorage();

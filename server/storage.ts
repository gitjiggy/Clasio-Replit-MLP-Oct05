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
  getDocumentsCount(filters: DocumentFilters): Promise<number>;
  getDocumentById(id: string): Promise<DocumentWithFolderAndTags | undefined>;
  getDocumentContent(id: string): Promise<string | null>; // Get just the content for a document
  getDocumentByDriveFileId(driveFileId: string): Promise<DocumentWithFolderAndTags | undefined>;
  getDocumentWithVersions(id: string): Promise<DocumentWithVersions | undefined>;
  updateDocument(id: string, updates: Partial<InsertDocument>): Promise<Document | undefined>;
  deleteDocument(id: string): Promise<boolean>;
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
  dequeueNextAnalysisJob(): Promise<AiAnalysisQueue | null>;
  updateQueueJobStatus(jobId: string, status: string, failureReason?: string): Promise<boolean>;
  getQueueStatus(userId?: string): Promise<{pending: number; processing: number; completed: number; failed: number}>;
  getQueueJobsByUser(userId: string): Promise<AiAnalysisQueue[]>;
  
  // Daily API Usage Tracking  
  incrementDailyUsage(date: string, tokens: number, success: boolean): Promise<DailyApiUsage>;
  getDailyUsage(date: string): Promise<DailyApiUsage | null>;
  canProcessAnalysis(): Promise<{canProcess: boolean; remaining: number; resetTime: string}>;
}

export class DatabaseStorage implements IStorage {
  private isInitialized = false;

  private async ensureInitialized() {
    if (!this.isInitialized) {
      await this.initializeDefaults();
      this.isInitialized = true;
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
    
    // Apply filters
    const conditions = [eq(documents.isDeleted, false)];

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
    return allDocuments.filter(doc =>
      doc.aiWordCount > 50 && // AND condition for minimum quality
      (this.documentTypeMatches(doc.aiDocumentType, query) || 
       this.titleSummaryContainsKeywords(doc, query)) // OR for content relevance
    ).slice(0, 50); // Max 50 for cosine similarity calculations
  }
  
  private documentTypeMatches(documentType: string | null, query: string): boolean {
    if (!documentType) return false;
    const queryLower = query.toLowerCase();
    const docTypeLower = documentType.toLowerCase();
    return queryLower.includes(docTypeLower) || docTypeLower.includes(queryLower);
  }
  
  private titleSummaryContainsKeywords(doc: any, query: string): boolean {
    const searchText = `${doc.name || ''} ${doc.originalName || ''} ${doc.aiSummary || ''}`.toLowerCase();
    const queryWords = query.toLowerCase().split(/\s+/);
    return queryWords.some(word => word.length > 2 && searchText.includes(word));
  }
  
  private async calculateSemanticScore(doc: any, queryEmbedding: number[]): Promise<number> {
    // Field weights: title×0.15 + key_topics×0.35 + summary×0.20 + content×0.30
    let totalScore = 0;
    let totalWeight = 0;
    
    const fieldWeights = {
      title: 0.15,
      keyTopics: 0.35, 
      summary: 0.20,
      content: 0.30
    };
    
    // Title embedding
    if (doc.titleEmbedding) {
      const titleEmb = parseEmbeddingFromJSON(doc.titleEmbedding);
      if (titleEmb) {
        const similarity = calculateCosineSimilarity(queryEmbedding, titleEmb);
        totalScore += similarity * fieldWeights.title;
        totalWeight += fieldWeights.title;
      }
    }
    
    // Key topics embedding
    if (doc.keyTopicsEmbedding) {
      const keyTopicsEmb = parseEmbeddingFromJSON(doc.keyTopicsEmbedding);
      if (keyTopicsEmb) {
        const similarity = calculateCosineSimilarity(queryEmbedding, keyTopicsEmb);
        totalScore += similarity * fieldWeights.keyTopics;
        totalWeight += fieldWeights.keyTopics;
      }
    }
    
    // Summary embedding  
    if (doc.summaryEmbedding) {
      const summaryEmb = parseEmbeddingFromJSON(doc.summaryEmbedding);
      if (summaryEmb) {
        const similarity = calculateCosineSimilarity(queryEmbedding, summaryEmb);
        totalScore += similarity * fieldWeights.summary;
        totalWeight += fieldWeights.summary;
      }
    }
    
    // Content embedding
    if (doc.contentEmbedding) {
      const contentEmb = parseEmbeddingFromJSON(doc.contentEmbedding);
      if (contentEmb) {
        const similarity = calculateCosineSimilarity(queryEmbedding, contentEmb);
        totalScore += similarity * fieldWeights.content;
        totalWeight += fieldWeights.content;
      }
    }
    
    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }
  
  private async calculateLexicalScore(doc: any, searchTerms: string): Promise<number> {
    // Use PostgreSQL ts_rank on title + key_topics + summary only (skip full content for speed)
    try {
      const result = await db.execute(sql`
        SELECT ts_rank(
          to_tsvector('english', 
            coalesce(${doc.name || ''},'') || ' ' || 
            coalesce(${doc.aiSummary || ''},'') || ' ' || 
            array_to_string(coalesce(${doc.aiKeyTopics || []}::text[],'{}'), ' ')
          ), 
          plainto_tsquery('english', ${searchTerms})
        ) as score
      `);
      
      const score = (result.rows[0] as any)?.score || 0;
      return Math.min(1, Math.max(0, parseFloat(score.toString()))); // Normalize to 0-1
    } catch (error) {
      console.warn('FTS scoring failed:', error);
      return 0;
    }
  }
  
  private async calculateQualityBoost(doc: any, userId: string): Promise<number> {
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
    userId: string
  ): Promise<any[]> {
    console.log(`Starting new 3-stage scoring for ${candidates.length} candidates`);
    
    // Check feature flag
    const useNewScoring = process.env.USE_NEW_SCORING === 'true';
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
    
    // Generate query embedding
    let queryEmbedding: number[];
    try {
      queryEmbedding = await generateEmbedding(query, 'RETRIEVAL_QUERY');
    } catch (error) {
      console.warn('Query embedding generation failed:', error);
      return candidates; // Fallback to original candidates
    }
    
    const scoredDocuments = [];
    
    for (const doc of filteredCandidates) {
      try {
        // Stage 1: Semantic Scoring (50% weight)
        const semanticScore = await this.calculateSemanticScore(doc, queryEmbedding);
        
        // Stage 2: Lexical Scoring (35% weight) 
        const lexicalScore = await this.calculateLexicalScore(doc, query);
        
        // Stage 3: Quality Boost (15% weight)
        const qualityBoost = await this.calculateQualityBoost(doc, userId);
        
        // Final Score = (semantic × 50) + (lexical × 35) + (quality × 15)
        const finalScore = (semanticScore * 50) + (lexicalScore * 35) + (qualityBoost * 15);
        
        console.log(`Document "${doc.name}": semantic=${semanticScore.toFixed(3)}, lexical=${lexicalScore.toFixed(3)}, quality=${qualityBoost.toFixed(3)}, final=${finalScore.toFixed(1)}`);
        
        scoredDocuments.push({
          ...doc,
          newScore: finalScore,
          semanticScore,
          lexicalScore,
          qualityBoost,
          scoringMethod: 'new_3_stage'
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

  // Enhanced conversational search using AI metadata
  async searchConversational(query: string, filters: Partial<Omit<DocumentFilters, 'search'>> = {}): Promise<{
    documents: DocumentWithFolderAndTags[];
    response: string;
    intent: string;
    keywords: string[];
  }> {
    await this.ensureInitialized();
    
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
          // Process the conversational query using Flash-lite for complex queries
          queryAnalysis = await processConversationalQuery(query);
          console.log(`AI Query Analysis for "${query}":`, queryAnalysis);
        } catch (error) {
          console.warn("AI processing failed, using smart fallback:", error instanceof Error ? error.message : String(error));
          // Enhanced fallback: Extract keywords from conversational questions
          queryAnalysis = this.extractKeywordsFromConversationalQuery(query);
          console.log(`Fallback Query Analysis for "${query}":`, queryAnalysis);
        }
      }
      
      // Apply base filters
      const conditions = [eq(documents.isDeleted, false)];
      
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
        
        // Try searching for individual keywords more broadly
        const broadConditions = [eq(documents.isDeleted, false)];
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
      
      // Create search query for PostgreSQL FTS (space-separated for plainto_tsquery)
      const searchTerms = queryAnalysis.keywords.join(' ');
      console.log(`FTS search terms: "${searchTerms}"`);
      
      // Execute raw SQL for proper PostgreSQL FTS with parameterized queries
      const ftsQuery = `
        SELECT 
          id, name, original_name, file_path, file_size, file_type, mime_type, 
          folder_id, uploaded_at, is_favorite, is_deleted, drive_file_id, 
          drive_web_view_link, is_from_drive, drive_last_modified, drive_sync_status, 
          drive_synced_at, ai_summary, ai_key_topics, ai_document_type, ai_category, 
          ai_sentiment, ai_word_count, ai_analyzed_at, ai_concise_name, 
          ai_category_confidence, ai_document_type_confidence, override_category, 
          override_document_type, classification_overridden, document_content, 
          content_extracted, content_extracted_at, title_embedding, content_embedding, 
          summary_embedding, key_topics_embedding, embeddings_generated, embeddings_generated_at,
          ts_rank(
            to_tsvector('english', 
              coalesce(name,'') || ' ' || 
              coalesce(original_name,'') || ' ' || 
              coalesce(ai_summary,'') || ' ' || 
              array_to_string(coalesce(ai_key_topics,'{}'), ' ')
            ), 
            plainto_tsquery('english', $1)
          ) as fts_score
        FROM documents 
        WHERE 
          is_deleted = false 
          AND to_tsvector('english', 
            coalesce(name,'') || ' ' || 
            coalesce(original_name,'') || ' ' || 
            coalesce(ai_summary,'') || ' ' || 
            array_to_string(coalesce(ai_key_topics,'{}'), ' ')
          ) @@ plainto_tsquery('english', $1)
        ORDER BY fts_score DESC 
        LIMIT 8
      `;
      
      // Execute raw PostgreSQL FTS query with parameterized search terms
      const ftsResults = await db.execute(sql.raw(ftsQuery.replace('$1', `'${searchTerms.replace(/'/g, "''")}'`)));
      
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
      
      // STAGE 2: Selective AI Deep Analysis (only for top candidates)
      const documentsWithConfidenceScores = [];
      
      // Smart query routing: detect simple queries and skip AI analysis
      const isSimpleQuery = queryAnalysis.intent === "simple_search" || 
                           (queryAnalysis.keywords.length === 1 && queryAnalysis.keywords[0].length > 3);
      
      if (isSimpleQuery) {
        console.log(`Stage 2: Skipping AI analysis for simple query, using FTS scores`);
        // For simple queries, use FTS scores directly
        documentsWithConfidenceScores.push(...stage1Candidates.map(doc => ({
          ...doc,
          confidenceScore: Math.round((doc.ftsScore || 0) * 100), // Convert FTS score to percentage
          relevanceReason: `Full-text search match (FTS score: ${doc.ftsScore?.toFixed(4) || 0})`,
          isRelevant: (doc.ftsScore || 0) > 0.01
        })));
      } else {
        console.log(`Stage 2: Complex query detected, running AI analysis on ${stage1Candidates.length} candidates`);
        
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
      
      // Sort by confidence score (highest first)
      documentsWithConfidenceScores.sort((a, b) => b.confidenceScore - a.confidenceScore);
      
      console.log("Document confidence scores:");
      documentsWithConfidenceScores.forEach(doc => 
        console.log(`- ${doc.name}: ${doc.confidenceScore}% confidence`)
      );
      
      // Filter documents with confidence > 50% OR if no high-confidence matches, take top 3
      let filteredDocuments = documentsWithConfidenceScores.filter(doc => doc.confidenceScore >= 50);
      
      if (filteredDocuments.length === 0 && documentsWithConfidenceScores.length > 0) {
        // Take top 3 documents even if below 50% confidence
        filteredDocuments = documentsWithConfidenceScores.slice(0, 3);
        console.log("No high-confidence matches, showing top candidates with lower confidence");
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
      
      // Generate AI-powered conversational response
      const conversationalResponse = await generateConversationalResponse(
        query, 
        documentsWithFoldersAndTags,
        queryAnalysis.intent
      );
      
      return {
        documents: documentsWithFoldersAndTags,
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
      
      return {
        documents: fallbackResults,
        response: `Found ${fallbackResults.length} documents matching "${query}".`,
        intent: "general_search",
        keywords: smartFallback.keywords  // Use extracted keywords instead of entire query
      };
    }
  }

  async getDocumentsCount(filters: DocumentFilters): Promise<number> {
    await this.ensureInitialized();
    const conditions = [eq(documents.isDeleted, false)];

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
      .where(and(eq(documents.id, id), eq(documents.isDeleted, false)))
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
      .where(and(eq(documents.id, id), eq(documents.isDeleted, false)))
      .limit(1);

    return result.length > 0 ? result[0].documentContent : null;
  }

  async updateDocument(id: string, updates: Partial<InsertDocument>): Promise<Document | undefined> {
    const [updatedDocument] = await db
      .update(documents)
      .set(updates)
      .where(and(eq(documents.id, id), eq(documents.isDeleted, false)))
      .returning();

    return updatedDocument;
  }

  async deleteDocument(id: string): Promise<boolean> {
    const result = await db
      .update(documents)
      .set({ isDeleted: true })
      .where(eq(documents.id, id))
      .returning();

    return result.length > 0;
  }

  async getDocumentByDriveFileId(driveFileId: string): Promise<DocumentWithFolderAndTags | undefined> {
    const result = await db
      .select({
        document: documents,
        folder: folders,
      })
      .from(documents)
      .leftJoin(folders, eq(documents.folderId, folders.id))
      .where(and(eq(documents.driveFileId, driveFileId), eq(documents.isDeleted, false)))
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
                eq(documents.isDeleted, false)
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
                eq(documents.isDeleted, false)
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

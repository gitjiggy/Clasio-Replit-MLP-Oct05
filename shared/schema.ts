import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, unique, index, uniqueIndex, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const folders = pgTable("folders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(), // Firebase UID - owner of the folder
  name: text("name").notNull(),
  color: text("color").default("#f59e0b"),
  parentId: varchar("parent_id"),
  isAutoCreated: boolean("is_auto_created").default(false).notNull(),
  category: text("category"), // For main folders: "Taxes", "Medical", etc.
  documentType: text("document_type"), // For sub-folders: "Resume", "Contract", etc.
  gcsPath: text("gcs_path"), // Path in Google Cloud Storage
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
}, (table) => ({
  // Multi-tenant indexes
  userIdIndex: index("folders_user_id_idx").on(table.userId),
  // Ensure unique main category folders per user (no parent, auto-created, by category)
  uniqueMainCategoryFolder: uniqueIndex("folders_unique_main_category_idx")
    .on(table.userId, table.category)
    .where(sql`parent_id IS NULL AND is_auto_created = true`),
  // Ensure unique sub-folders under each parent per user
  uniqueSubFolderUnderParent: uniqueIndex("folders_unique_subfolder_idx")
    .on(table.userId, table.parentId, table.documentType)
    .where(sql`parent_id IS NOT NULL AND is_auto_created = true`),
}));

export const tags = pgTable("tags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(), // Firebase UID - owner of the tag
  name: text("name").notNull(),
  color: text("color").default("#3b82f6"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
}, (table) => ({
  // Multi-tenant indexes
  userIdIndex: index("tags_user_id_idx").on(table.userId),
  // Ensure unique tag names per user (not globally unique)
  uniqueTagPerUser: uniqueIndex("tags_unique_name_per_user_idx").on(table.userId, table.name),
}));

export const documents = pgTable("documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(), // Firebase UID - owner of the document
  name: text("name").notNull(),
  originalName: text("original_name").notNull(),
  filePath: text("file_path"),
  objectPath: text("object_path"), // GCS object path for deletion
  fileSize: integer("file_size"),
  fileType: text("file_type").notNull(),
  mimeType: text("mime_type").notNull(),
  contentHash: text("content_hash"), // MD5/ETag for content-based deduplication (optional)
  folderId: varchar("folder_id").references(() => folders.id, { onDelete: "set null" }),
  uploadedAt: timestamp("uploaded_at").default(sql`now()`).notNull(),
  isFavorite: boolean("is_favorite").default(false).notNull(),
  isDeleted: boolean("is_deleted").default(false).notNull(), // Keep for backward compatibility
  // Trash system with 7-day retention
  status: text("status").default("active").notNull(), // 'active', 'trashed', 'purged'
  deletedAt: timestamp("deleted_at"), // When moved to trash
  deletedGeneration: bigint("deleted_generation", { mode: "bigint" }), // GCS object generation for restore
  // Google Drive integration fields
  driveFileId: text("drive_file_id"), // Google Drive file ID
  driveWebViewLink: text("drive_web_view_link"), // Google Drive web view URL
  isFromDrive: boolean("is_from_drive").default(false).notNull(),
  driveLastModified: timestamp("drive_last_modified"), // Last modified time from Drive
  driveSyncStatus: text("drive_sync_status").default("synced"), // synced, pending, error
  driveSyncedAt: timestamp("drive_synced_at"), // Last sync timestamp
  // AI Analysis fields
  aiSummary: text("ai_summary"),
  aiKeyTopics: text("ai_key_topics").array(),
  aiDocumentType: text("ai_document_type"),
  aiCategory: text("ai_category"), // Store the AI-classified category
  aiSentiment: text("ai_sentiment"),
  aiWordCount: integer("ai_word_count"),
  aiAnalyzedAt: timestamp("ai_analyzed_at"),
  // Enhanced AI fields for improved UX
  aiConciseName: text("ai_concise_name"), // 4-7 word AI-generated title
  aiCategoryConfidence: integer("ai_category_confidence"), // 0-100 confidence score
  aiDocumentTypeConfidence: integer("ai_document_type_confidence"), // 0-100 confidence score
  // User override fields for classification edits
  overrideCategory: text("override_category"), // User-selected category override
  overrideDocumentType: text("override_document_type"), // User-selected document type override
  classificationOverridden: boolean("classification_overridden").default(false).notNull(),
  // Content Search fields
  documentContent: text("document_content"), // Full extracted text content
  contentExtracted: boolean("content_extracted").default(false).notNull(),
  contentExtractedAt: timestamp("content_extracted_at"),
  // Embedding vectors for semantic search (nullable during transition)
  titleEmbedding: text("title_embedding"), // JSON array of embedding for title
  contentEmbedding: text("content_embedding"), // JSON array of embedding for content
  summaryEmbedding: text("summary_embedding"), // JSON array of embedding for AI summary
  keyTopicsEmbedding: text("key_topics_embedding"), // JSON array of embedding for key topics
  embeddingsGenerated: boolean("embeddings_generated").default(false).notNull(),
  embeddingsGeneratedAt: timestamp("embeddings_generated_at"),
}, (table) => ({
  // Multi-tenant indexes
  userIdIndex: index("documents_user_id_idx").on(table.userId),
  userDuplicateCheckIndex: index("documents_user_duplicate_idx").on(table.userId, table.originalName, table.fileSize),
  userContentHashIndex: index("documents_user_content_hash_idx").on(table.userId, table.contentHash),
}));

export const documentVersions = pgTable("document_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").references(() => documents.id, { onDelete: "cascade" }).notNull(),
  version: integer("version").notNull(),
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size").notNull(),
  fileType: text("file_type").notNull(),
  mimeType: text("mime_type").notNull(),
  uploadedAt: timestamp("uploaded_at").default(sql`now()`).notNull(),
  uploadedBy: text("uploaded_by").default("system").notNull(),
  changeDescription: text("change_description"),
  isActive: boolean("is_active").default(false).notNull(),
}, (table) => ({
  // Ensure no duplicate version numbers per document
  uniqueDocumentVersion: unique().on(table.documentId, table.version),
  // Create an index to support the active version queries
  activeVersionIndex: index("document_active_version_idx").on(table.documentId, table.isActive),
  // Enforce single active version per document (partial unique index)
  uniqueActiveVersion: uniqueIndex("document_one_active_version_idx")
    .on(table.documentId)
    .where(sql`is_active = true`),
}));

export const documentTags = pgTable("document_tags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(), // Firebase UID for ownership validation
  documentId: varchar("document_id").references(() => documents.id, { onDelete: "cascade" }).notNull(),
  tagId: varchar("tag_id").references(() => tags.id, { onDelete: "cascade" }).notNull(),
}, (table) => ({
  // Multi-tenant indexes
  userIdIndex: index("document_tags_user_id_idx").on(table.userId),
  // Ensure unique document-tag pairs per user
  uniqueDocumentTag: uniqueIndex("document_tags_unique_per_user_idx").on(table.userId, table.documentId, table.tagId),
}));

// Document access log for quality boost scoring
export const documentAccessLog = pgTable("document_access_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(), // Firebase UID
  documentId: varchar("document_id").references(() => documents.id, { onDelete: "cascade" }).notNull(),
  accessedAt: timestamp("accessed_at").default(sql`now()`).notNull(),
  timeSpentSeconds: integer("time_spent_seconds"), // Optional tracking of engagement
}, (table) => ({
  // Index for efficient recent access queries
  userDocumentAccessIndex: index("document_access_user_doc_idx").on(table.userId, table.documentId, table.accessedAt),
  // Index for document-based access queries
  documentAccessIndex: index("document_access_doc_idx").on(table.documentId, table.accessedAt),
}));

// AI Analysis Queue for cost-controlled batch processing - Enhanced for Token 4/8 durability
export const aiAnalysisQueue = pgTable("ai_analysis_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").references(() => documents.id, { onDelete: "cascade" }).notNull(),
  userId: text("user_id").notNull(), // Firebase UID for tracking per-user queue
  tenantId: text("tenant_id"), // Tenant isolation (maps to userId for Firebase) - nullable during migration
  versionId: varchar("version_id").references(() => documentVersions.id), // Document version for analysis
  jobType: text("job_type").default("analysis").notNull(), // analysis, embedding_generation
  priority: integer("priority").default(5).notNull(), // 1=highest (user-requested), 5=bulk upload, 8=background
  idempotencyKey: text("idempotency_key").default(sql`gen_random_uuid()`).notNull(), // Prevent duplicate processing
  requestedAt: timestamp("requested_at").default(sql`now()`).notNull(),
  scheduledAt: timestamp("scheduled_at"), // When it should be processed
  processedAt: timestamp("processed_at"), // When it was actually processed
  status: text("status").default("pending").notNull(), // pending, processing, completed, failed, dlq
  // Enhanced retry and failure handling
  attemptCount: integer("attempt_count").default(0).notNull(), // Current attempt number
  maxAttempts: integer("max_attempts").default(3).notNull(), // Maximum retry attempts
  retryCount: integer("retry_count").default(0).notNull(), // Legacy field for compatibility
  lastError: text("last_error"), // Detailed error message from last attempt
  failureReason: text("failure_reason"), // Why it failed (for debugging) - legacy field
  // Dead Letter Queue (DLQ) fields
  dlqStatus: text("dlq_status"), // 'active', 'replaying' when moved to DLQ
  dlqReason: text("dlq_reason"), // Why it was moved to DLQ
  dlqAt: timestamp("dlq_at"), // When moved to DLQ
  // Metadata and tracking
  estimatedTokens: integer("estimated_tokens"), // Estimated token usage for cost tracking
  workerInstance: text("worker_instance"), // Which worker instance processed this
  nextRetryAt: timestamp("next_retry_at") // Scheduled retry time for exponential backoff
}, (table) => ({
  // Index for efficient queue processing with retry scheduling
  queueProcessingIndex: index("ai_queue_processing_idx").on(table.status, table.priority, table.nextRetryAt),
  // Index for tenant-scoped queue queries (Token 4/8 requirement)
  tenantQueueIndex: index("ai_queue_tenant_idx").on(table.tenantId, table.status),
  // Index for user queue status queries (legacy)
  userQueueIndex: index("ai_queue_user_idx").on(table.userId, table.status),
  // Index for DLQ operations and management
  dlqIndex: index("ai_queue_dlq_idx").on(table.status, table.dlqAt).where(sql`status = 'dlq'`),
  // Index for retry processing (exponential backoff scheduling)
  retryIndex: index("ai_queue_retry_idx").on(table.nextRetryAt, table.status).where(sql`next_retry_at IS NOT NULL`),
  // Prevent duplicate queue entries for same document and job type
  uniqueDocumentJobInQueue: uniqueIndex("ai_queue_unique_document_job_idx")
    .on(table.documentId, table.jobType)
    .where(sql`status IN ('pending', 'processing')`),
  // Ensure idempotency keys are unique within tenant for same job type
  uniqueIdempotencyKey: uniqueIndex("ai_queue_unique_idempotency_idx")
    .on(table.tenantId, table.idempotencyKey, table.jobType),
}));

// Daily API usage tracking for cost control
export const dailyApiUsage = pgTable("daily_api_usage", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: text("date").notNull(), // YYYY-MM-DD format
  requestCount: integer("request_count").default(0).notNull(), // Total requests made
  tokenCount: integer("token_count").default(0).notNull(), // Total tokens used
  successCount: integer("success_count").default(0).notNull(), // Successful requests
  failureCount: integer("failure_count").default(0).notNull(), // Failed requests
  lastUpdated: timestamp("last_updated").default(sql`now()`).notNull(),
}, (table) => ({
  // Ensure one record per date
  uniqueDateIndex: uniqueIndex("daily_usage_unique_date_idx").on(table.date),
}));

// AI Queue Metrics for Token 4/8 operational monitoring
export const aiQueueMetrics = pgTable("ai_queue_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timestamp: timestamp("timestamp").default(sql`now()`).notNull(),
  queueDepth: integer("queue_depth").default(0).notNull(), // Total pending jobs
  dlqDepth: integer("dlq_depth").default(0).notNull(), // Total DLQ jobs
  processingRate: integer("processing_rate").default(0).notNull(), // Jobs processed per minute
  successRate: integer("success_rate").default(0).notNull(), // Successful jobs per minute
  failureRate: integer("failure_rate").default(0).notNull(), // Failed jobs per minute
  retryRate: integer("retry_rate").default(0).notNull(), // Retried jobs per minute
  avgProcessingTimeMs: integer("avg_processing_time_ms"), // Average processing time
  activeWorkers: integer("active_workers").default(0).notNull(), // Number of active worker instances
  poisonPillCount: integer("poison_pill_count").default(0).notNull(), // Jobs fast-tracked to DLQ
}, (table) => ({
  // Index for time-series queries
  timestampIndex: index("ai_queue_metrics_timestamp_idx").on(table.timestamp),
}));

// Idempotency keys for operation deduplication and safe retries
export const idempotencyKeys = pgTable("idempotency_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull(), // Firebase UID - owner of the operation
  operationType: text("operation_type").notNull(), // document_create, document_update, tag_create, etc.
  idempotencyKey: text("idempotency_key").notNull(), // Client-provided or generated key
  requestPayload: text("request_payload"), // JSON of the original request for replay validation
  responsePayload: text("response_payload"), // JSON of the response for replay
  status: text("status").default("pending").notNull(), // pending, completed, failed
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  expiresAt: timestamp("expires_at").default(sql`now() + INTERVAL '24 hours'`).notNull(), // TTL cleanup
  // Results for completed operations
  resultDocumentId: varchar("result_document_id"), // For document operations
  resultVersionId: varchar("result_version_id"), // For version operations  
  resultTagId: varchar("result_tag_id"), // For tag operations
  resultFolderId: varchar("result_folder_id"), // For folder operations
}, (table) => ({
  // Multi-tenant indexes
  userIdIndex: index("idempotency_user_id_idx").on(table.userId),
  // Ensure unique idempotency key per user and operation type
  uniqueUserOperationKey: uniqueIndex("idempotency_unique_user_operation_idx")
    .on(table.userId, table.operationType, table.idempotencyKey),
  // Index for TTL cleanup
  expirationIndex: index("idempotency_expiration_idx").on(table.expiresAt),
  // Index for fast status lookups
  statusIndex: index("idempotency_status_idx").on(table.status, table.createdAt),
}));

// Conservative user quotas with 1GB storage limit
export const userQuotas = pgTable("user_quotas", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id").notNull().unique(), // Firebase UID
  storageLimit: bigint("storage_limit_bytes", { mode: "bigint" }).notNull().default(sql`'1073741824'::bigint`), // 1GB for everyone
  storageUsed: bigint("storage_used_bytes", { mode: "bigint" }).notNull().default(sql`'0'::bigint`),
  documentLimit: integer("document_limit").notNull().default(500), // 500 documents max
  documentCount: integer("document_count").notNull().default(0),
  quotaTier: text("quota_tier").notNull().default('standard'), // Single tier approach
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`now()`).notNull(),
}, (table) => ({
  // Indexes for efficient quota operations
  userIdIndex: index("user_quotas_user_id_idx").on(table.userId),
  storageUsageIndex: index("user_quotas_storage_usage_idx").on(table.storageUsed, table.storageLimit),
}));

export const insertFolderSchema = createInsertSchema(folders).omit({
  id: true,
  createdAt: true,
});

export const insertTagSchema = createInsertSchema(tags).omit({
  id: true,
  createdAt: true,
});

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  uploadedAt: true,
});

export const insertDocumentVersionSchema = createInsertSchema(documentVersions).omit({
  id: true,
  uploadedAt: true,
}).extend({
  version: z.number().optional(), // Version can be auto-generated
});

export const insertDocumentTagSchema = createInsertSchema(documentTags).omit({
  id: true,
});

export const insertDocumentAccessLogSchema = createInsertSchema(documentAccessLog).omit({
  id: true,
  accessedAt: true,
});

export const insertAiAnalysisQueueSchema = createInsertSchema(aiAnalysisQueue).omit({
  id: true,
  requestedAt: true,
});

export const insertDailyApiUsageSchema = createInsertSchema(dailyApiUsage).omit({
  id: true,
  lastUpdated: true,
});

export const insertAiQueueMetricsSchema = createInsertSchema(aiQueueMetrics).omit({
  id: true,
  timestamp: true,
});

export const insertIdempotencyKeySchema = createInsertSchema(idempotencyKeys).omit({
  id: true,
  createdAt: true,
  expiresAt: true,
});

export const insertUserQuotaSchema = createInsertSchema(userQuotas).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertFolder = z.infer<typeof insertFolderSchema>;
export type InsertTag = z.infer<typeof insertTagSchema>;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type InsertDocumentVersion = z.infer<typeof insertDocumentVersionSchema>;
export type InsertDocumentTag = z.infer<typeof insertDocumentTagSchema>;
export type InsertDocumentAccessLog = z.infer<typeof insertDocumentAccessLogSchema>;
export type InsertAiAnalysisQueue = z.infer<typeof insertAiAnalysisQueueSchema>;
export type InsertDailyApiUsage = z.infer<typeof insertDailyApiUsageSchema>;
export type InsertAiQueueMetrics = z.infer<typeof insertAiQueueMetricsSchema>;
export type InsertIdempotencyKey = z.infer<typeof insertIdempotencyKeySchema>;
export type InsertUserQuota = z.infer<typeof insertUserQuotaSchema>;

export type Folder = typeof folders.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type DocumentTag = typeof documentTags.$inferSelect;
export type DocumentAccessLog = typeof documentAccessLog.$inferSelect;
export type AiAnalysisQueue = typeof aiAnalysisQueue.$inferSelect;
export type DailyApiUsage = typeof dailyApiUsage.$inferSelect;
export type AiQueueMetrics = typeof aiQueueMetrics.$inferSelect;
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type UserQuota = typeof userQuotas.$inferSelect;

export type DocumentWithFolderAndTags = Document & {
  folder?: Folder;
  tags: Tag[];
  confidenceScore?: number; // For search confidence scoring
  relevanceReason?: string; // AI explanation of why document matches
  isRelevant?: boolean; // AI assessment of relevance
};

export type DocumentWithVersions = DocumentWithFolderAndTags & {
  versions: DocumentVersion[];
  currentVersion?: DocumentVersion;
};

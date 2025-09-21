import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, unique, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Import enterprise organization schema
export * from './organizationSchema';
import { organizations } from './organizationSchema';

export const folders = pgTable("folders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  color: text("color").default("#f59e0b"),
  parentId: varchar("parent_id"),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  isAutoCreated: boolean("is_auto_created").default(false).notNull(),
  category: text("category"), // For main folders: "Taxes", "Medical", etc.
  documentType: text("document_type"), // For sub-folders: "Resume", "Contract", etc.
  gcsPath: text("gcs_path"), // Path in Google Cloud Storage
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
}, (table) => ({
  // Ensure unique main category folders (no parent, auto-created, by category)
  uniqueMainCategoryFolder: uniqueIndex("folders_unique_main_category_idx")
    .on(table.category)
    .where(sql`parent_id IS NULL AND is_auto_created = true`),
  // Ensure unique sub-folders under each parent
  uniqueSubFolderUnderParent: uniqueIndex("folders_unique_subfolder_idx")
    .on(table.parentId, table.documentType)
    .where(sql`parent_id IS NOT NULL AND is_auto_created = true`),
}));

export const tags = pgTable("tags", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  color: text("color").default("#3b82f6"),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

export const documents = pgTable("documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  originalName: text("original_name").notNull(),
  filePath: text("file_path"),
  fileSize: integer("file_size"),
  fileType: text("file_type").notNull(),
  mimeType: text("mime_type").notNull(),
  folderId: varchar("folder_id").references(() => folders.id, { onDelete: "set null" }),
  
  // Multi-tenancy support
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  
  // SMB Data lifecycle - soft delete → 30-day purge
  softDeletedAt: timestamp("soft_deleted_at"),
  
  uploadedAt: timestamp("uploaded_at").default(sql`now()`).notNull(),
  isFavorite: boolean("is_favorite").default(false).notNull(),
  isDeleted: boolean("is_deleted").default(false).notNull(),
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
  
  // SMB features - simplified from enterprise
  lastAccessedAt: timestamp("last_accessed_at"),
}, (table) => ({
  // Add organization index for SMB multi-tenancy
  orgIdx: index('documents_org_idx').on(table.organizationId),
  lastAccessedIdx: index('documents_last_accessed_idx').on(table.lastAccessedAt),
}));

export const documentVersions = pgTable("document_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").references(() => documents.id, { onDelete: "cascade" }).notNull(),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
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
  documentId: varchar("document_id").references(() => documents.id, { onDelete: "cascade" }).notNull(),
  tagId: varchar("tag_id").references(() => tags.id, { onDelete: "cascade" }).notNull(),
});

// AI Analysis Queue for cost-controlled batch processing
export const aiAnalysisQueue = pgTable("ai_analysis_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").references(() => documents.id, { onDelete: "cascade" }).notNull(),
  organizationId: varchar("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(), // Firebase UID for tracking per-user queue
  priority: integer("priority").default(5).notNull(), // 1=highest (user-requested), 5=bulk upload, 8=background
  requestedAt: timestamp("requested_at").default(sql`now()`).notNull(),
  scheduledAt: timestamp("scheduled_at"), // When it should be processed
  processedAt: timestamp("processed_at"), // When it was actually processed
  status: text("status").default("pending").notNull(), // pending, processing, completed, failed
  retryCount: integer("retry_count").default(0).notNull(),
  failureReason: text("failure_reason"), // Why it failed (for debugging)
  estimatedTokens: integer("estimated_tokens"), // Estimated token usage for cost tracking
}, (table) => ({
  // Index for efficient queue processing
  queueProcessingIndex: index("ai_queue_processing_idx").on(table.status, table.priority, table.scheduledAt),
  // Index for user queue status queries
  userQueueIndex: index("ai_queue_user_idx").on(table.userId, table.status),
  // Prevent duplicate queue entries for same document
  uniqueDocumentInQueue: uniqueIndex("ai_queue_unique_document_idx")
    .on(table.documentId)
    .where(sql`status IN ('pending', 'processing')`),
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

export const insertAiAnalysisQueueSchema = createInsertSchema(aiAnalysisQueue).omit({
  id: true,
  requestedAt: true,
});

export const insertDailyApiUsageSchema = createInsertSchema(dailyApiUsage).omit({
  id: true,
  lastUpdated: true,
});

export type InsertFolder = z.infer<typeof insertFolderSchema>;
export type InsertTag = z.infer<typeof insertTagSchema>;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type InsertDocumentVersion = z.infer<typeof insertDocumentVersionSchema>;
export type InsertDocumentTag = z.infer<typeof insertDocumentTagSchema>;
export type InsertAiAnalysisQueue = z.infer<typeof insertAiAnalysisQueueSchema>;
export type InsertDailyApiUsage = z.infer<typeof insertDailyApiUsageSchema>;

export type Folder = typeof folders.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type DocumentTag = typeof documentTags.$inferSelect;
export type AiAnalysisQueue = typeof aiAnalysisQueue.$inferSelect;
export type DailyApiUsage = typeof dailyApiUsage.$inferSelect;

export type DocumentWithFolderAndTags = Document & {
  folder?: Folder;
  tags: Tag[];
};

export type DocumentWithVersions = DocumentWithFolderAndTags & {
  versions: DocumentVersion[];
  currentVersion?: DocumentVersion;
};

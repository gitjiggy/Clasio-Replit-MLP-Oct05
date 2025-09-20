import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, unique, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const folders = pgTable("folders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  color: text("color").default("#f59e0b"),
  parentId: varchar("parent_id"),
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
  aiSentiment: text("ai_sentiment"),
  aiWordCount: integer("ai_word_count"),
  aiAnalyzedAt: timestamp("ai_analyzed_at"),
  // Content Search fields
  documentContent: text("document_content"), // Full extracted text content
  contentExtracted: boolean("content_extracted").default(false).notNull(),
  contentExtractedAt: timestamp("content_extracted_at"),
});

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
  documentId: varchar("document_id").references(() => documents.id, { onDelete: "cascade" }).notNull(),
  tagId: varchar("tag_id").references(() => tags.id, { onDelete: "cascade" }).notNull(),
});

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

export type InsertFolder = z.infer<typeof insertFolderSchema>;
export type InsertTag = z.infer<typeof insertTagSchema>;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type InsertDocumentVersion = z.infer<typeof insertDocumentVersionSchema>;
export type InsertDocumentTag = z.infer<typeof insertDocumentTagSchema>;

export type Folder = typeof folders.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type DocumentTag = typeof documentTags.$inferSelect;

export type DocumentWithFolderAndTags = Document & {
  folder?: Folder;
  tags: Tag[];
};

export type DocumentWithVersions = DocumentWithFolderAndTags & {
  versions: DocumentVersion[];
  currentVersion?: DocumentVersion;
};

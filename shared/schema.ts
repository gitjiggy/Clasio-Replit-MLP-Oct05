import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const folders = pgTable("folders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  color: text("color").default("#f59e0b"),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
});

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
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size").notNull(),
  fileType: text("file_type").notNull(),
  mimeType: text("mime_type").notNull(),
  folderId: varchar("folder_id").references(() => folders.id, { onDelete: "set null" }),
  uploadedAt: timestamp("uploaded_at").default(sql`now()`).notNull(),
  isFavorite: boolean("is_favorite").default(false).notNull(),
  isDeleted: boolean("is_deleted").default(false).notNull(),
});

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

export const insertDocumentTagSchema = createInsertSchema(documentTags).omit({
  id: true,
});

export type InsertFolder = z.infer<typeof insertFolderSchema>;
export type InsertTag = z.infer<typeof insertTagSchema>;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type InsertDocumentTag = z.infer<typeof insertDocumentTagSchema>;

export type Folder = typeof folders.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type DocumentTag = typeof documentTags.$inferSelect;

export type DocumentWithFolderAndTags = Document & {
  folder?: Folder;
  tags: Tag[];
};

import {
  type Document,
  type Folder,
  type Tag,
  type DocumentTag,
  type InsertDocument,
  type InsertFolder,
  type InsertTag,
  type InsertDocumentTag,
  type DocumentWithFolderAndTags,
  documents,
  folders,
  tags,
  documentTags,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { db } from "./db";
import { eq, and, desc, ilike, inArray, count } from "drizzle-orm";

export interface DocumentFilters {
  search?: string;
  fileType?: string;
  folderId?: string;
  tagId?: string;
  page: number;
  limit: number;
}

export interface IStorage {
  // Documents
  createDocument(document: InsertDocument): Promise<Document>;
  getDocuments(filters: DocumentFilters): Promise<DocumentWithFolderAndTags[]>;
  getDocumentsCount(filters: DocumentFilters): Promise<number>;
  getDocumentById(id: string): Promise<DocumentWithFolderAndTags | undefined>;
  updateDocument(id: string, updates: Partial<InsertDocument>): Promise<Document | undefined>;
  deleteDocument(id: string): Promise<boolean>;

  // Folders
  createFolder(folder: InsertFolder): Promise<Folder>;
  getFolders(): Promise<Folder[]>;
  updateFolder(id: string, updates: Partial<InsertFolder>): Promise<Folder | undefined>;
  deleteFolder(id: string): Promise<boolean>;

  // Tags
  createTag(tag: InsertTag): Promise<Tag>;
  getTags(): Promise<Tag[]>;
  updateTag(id: string, updates: Partial<InsertTag>): Promise<Tag | undefined>;
  deleteTag(id: string): Promise<boolean>;

  // Document Tags
  addDocumentTag(documentTag: InsertDocumentTag): Promise<DocumentTag>;
  removeDocumentTags(documentId: string): Promise<void>;
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
          { name: "Important", color: "#ef4444" },
          { name: "Reviewed", color: "#10b981" },
          { name: "Pending", color: "#f59e0b" },
          { name: "Archive", color: "#8b5cf6" },
        ];
        
        await db.insert(tags).values(defaultTags);
      }
    } catch (error) {
      console.log("Database initialization skipped:", error);
    }
  }

  // Documents
  async createDocument(insertDocument: InsertDocument): Promise<Document> {
    await this.ensureInitialized();
    const [document] = await db
      .insert(documents)
      .values({
        ...insertDocument,
        folderId: insertDocument.folderId || null,
        isFavorite: insertDocument.isFavorite ?? false,
        isDeleted: insertDocument.isDeleted ?? false,
      })
      .returning();
    return document;
  }

  async getDocuments(filters: DocumentFilters): Promise<DocumentWithFolderAndTags[]> {
    await this.ensureInitialized();
    let query = db
      .select({
        document: documents,
        folder: folders,
      })
      .from(documents)
      .leftJoin(folders, eq(documents.folderId, folders.id))
      .where(eq(documents.isDeleted, false));

    // Apply filters
    const conditions = [eq(documents.isDeleted, false)];

    if (filters.search) {
      conditions.push(
        ilike(documents.name, `%${filters.search}%`)
      );
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

    const results = await db
      .select({
        document: documents,
        folder: folders,
      })
      .from(documents)
      .leftJoin(folders, eq(documents.folderId, folders.id))
      .where(and(...conditions))
      .orderBy(desc(documents.uploadedAt))
      .limit(filters.limit)
      .offset((filters.page - 1) * filters.limit);

    // Get tags for each document
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

  async getDocumentsCount(filters: DocumentFilters): Promise<number> {
    await this.ensureInitialized();
    const conditions = [eq(documents.isDeleted, false)];

    if (filters.search) {
      conditions.push(
        ilike(documents.name, `%${filters.search}%`)
      );
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

  async getFolders(): Promise<Folder[]> {
    await this.ensureInitialized();
    return await db
      .select()
      .from(folders)
      .orderBy(folders.name);
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

}

export const storage = new DatabaseStorage();

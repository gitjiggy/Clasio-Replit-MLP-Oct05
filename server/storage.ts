import {
  type Document,
  type Folder,
  type Tag,
  type DocumentTag,
  type DocumentVersion,
  type InsertDocument,
  type InsertFolder,
  type InsertTag,
  type InsertDocumentTag,
  type InsertDocumentVersion,
  type DocumentWithFolderAndTags,
  type DocumentWithVersions,
  documents,
  folders,
  tags,
  documentTags,
  documentVersions,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { db } from "./db";
import { eq, and, desc, ilike, inArray, count, sql } from "drizzle-orm";

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
  getDocumentByDriveFileId(driveFileId: string): Promise<DocumentWithFolderAndTags | undefined>;
  getDocumentWithVersions(id: string): Promise<DocumentWithVersions | undefined>;
  updateDocument(id: string, updates: Partial<InsertDocument>): Promise<Document | undefined>;
  deleteDocument(id: string): Promise<boolean>;
  analyzeDocumentWithAI(id: string): Promise<boolean>;

  // Document Versions
  createDocumentVersion(version: InsertDocumentVersion): Promise<DocumentVersion>;
  getDocumentVersions(documentId: string): Promise<DocumentVersion[]>;
  setActiveVersion(documentId: string, versionId: string): Promise<boolean>;
  deleteDocumentVersion(documentId: string, versionId: string): Promise<boolean>;

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

  // AI Analysis
  async analyzeDocumentWithAI(documentId: string, driveContent?: string): Promise<boolean> {
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
        documentText = await extractTextFromDocument(document.filePath, document.mimeType);
      }
      
      // Generate AI analysis
      const [summary, analysis] = await Promise.all([
        summarizeDocument(documentText),
        analyzeDocumentContent(documentText)
      ]);

      // Update the document with AI analysis
      const [updatedDoc] = await db
        .update(documents)
        .set({
          aiSummary: summary,
          aiKeyTopics: analysis.keyTopics,
          aiDocumentType: analysis.documentType,
          aiSentiment: analysis.sentiment,
          aiWordCount: analysis.wordCount,
          aiAnalyzedAt: new Date()
        })
        .where(eq(documents.id, documentId))
        .returning();

      return !!updatedDoc;
    } catch (error) {
      console.error("Error analyzing document with AI:", error);
      return false;
    }
  }

}

export const storage = new DatabaseStorage();

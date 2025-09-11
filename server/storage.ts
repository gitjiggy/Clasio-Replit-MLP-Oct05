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
} from "@shared/schema";
import { randomUUID } from "crypto";

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

export class MemStorage implements IStorage {
  private documents: Map<string, Document>;
  private folders: Map<string, Folder>;
  private tags: Map<string, Tag>;
  private documentTags: Map<string, DocumentTag>;

  constructor() {
    this.documents = new Map();
    this.folders = new Map();
    this.tags = new Map();
    this.documentTags = new Map();

    // Initialize with some default folders and tags
    this.initializeDefaults();
  }

  private initializeDefaults() {
    // Default folders
    const defaultFolders = [
      { name: "Contracts", color: "#f59e0b" },
      { name: "Reports", color: "#3b82f6" },
      { name: "Invoices", color: "#10b981" },
      { name: "Legal Documents", color: "#8b5cf6" },
    ];

    for (const folder of defaultFolders) {
      const id = randomUUID();
      this.folders.set(id, {
        id,
        ...folder,
        createdAt: new Date(),
      });
    }

    // Default tags
    const defaultTags = [
      { name: "Important", color: "#ef4444" },
      { name: "Reviewed", color: "#10b981" },
      { name: "Pending", color: "#f59e0b" },
      { name: "Archive", color: "#8b5cf6" },
    ];

    for (const tag of defaultTags) {
      const id = randomUUID();
      this.tags.set(id, {
        id,
        ...tag,
        createdAt: new Date(),
      });
    }
  }

  // Documents
  async createDocument(insertDocument: InsertDocument): Promise<Document> {
    const id = randomUUID();
    const document: Document = {
      ...insertDocument,
      id,
      uploadedAt: new Date(),
      folderId: insertDocument.folderId ?? null,
      isFavorite: insertDocument.isFavorite ?? false,
      isDeleted: insertDocument.isDeleted ?? false,
    };
    this.documents.set(id, document);
    return document;
  }

  async getDocuments(filters: DocumentFilters): Promise<DocumentWithFolderAndTags[]> {
    let docs = Array.from(this.documents.values()).filter(doc => !doc.isDeleted);

    // Apply filters
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      docs = docs.filter(doc => 
        doc.name.toLowerCase().includes(searchLower) ||
        doc.originalName.toLowerCase().includes(searchLower)
      );
    }

    if (filters.fileType) {
      docs = docs.filter(doc => doc.fileType === filters.fileType);
    }

    if (filters.folderId) {
      docs = docs.filter(doc => doc.folderId === filters.folderId);
    }

    if (filters.tagId) {
      const docsWithTag = Array.from(this.documentTags.values())
        .filter(dt => dt.tagId === filters.tagId)
        .map(dt => dt.documentId);
      docs = docs.filter(doc => docsWithTag.includes(doc.id));
    }

    // Sort by upload date (newest first)
    docs.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());

    // Apply pagination
    const start = (filters.page - 1) * filters.limit;
    const paginatedDocs = docs.slice(start, start + filters.limit);

    // Enrich with folder and tags
    return paginatedDocs.map(doc => this.enrichDocument(doc));
  }

  async getDocumentsCount(filters: DocumentFilters): Promise<number> {
    let docs = Array.from(this.documents.values()).filter(doc => !doc.isDeleted);

    // Apply same filters as getDocuments
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      docs = docs.filter(doc => 
        doc.name.toLowerCase().includes(searchLower) ||
        doc.originalName.toLowerCase().includes(searchLower)
      );
    }

    if (filters.fileType) {
      docs = docs.filter(doc => doc.fileType === filters.fileType);
    }

    if (filters.folderId) {
      docs = docs.filter(doc => doc.folderId === filters.folderId);
    }

    if (filters.tagId) {
      const docsWithTag = Array.from(this.documentTags.values())
        .filter(dt => dt.tagId === filters.tagId)
        .map(dt => dt.documentId);
      docs = docs.filter(doc => docsWithTag.includes(doc.id));
    }

    return docs.length;
  }

  async getDocumentById(id: string): Promise<DocumentWithFolderAndTags | undefined> {
    const document = this.documents.get(id);
    if (!document || document.isDeleted) {
      return undefined;
    }
    return this.enrichDocument(document);
  }

  async updateDocument(id: string, updates: Partial<InsertDocument>): Promise<Document | undefined> {
    const document = this.documents.get(id);
    if (!document || document.isDeleted) {
      return undefined;
    }

    const updatedDocument = { ...document, ...updates };
    this.documents.set(id, updatedDocument);
    return updatedDocument;
  }

  async deleteDocument(id: string): Promise<boolean> {
    const document = this.documents.get(id);
    if (!document) {
      return false;
    }

    // Soft delete
    const updatedDocument = { ...document, isDeleted: true };
    this.documents.set(id, updatedDocument);

    // Remove associated tags
    await this.removeDocumentTags(id);
    return true;
  }

  // Folders
  async createFolder(insertFolder: InsertFolder): Promise<Folder> {
    const id = randomUUID();
    const folder: Folder = {
      ...insertFolder,
      id,
      createdAt: new Date(),
      color: insertFolder.color ?? "#f59e0b",
    };
    this.folders.set(id, folder);
    return folder;
  }

  async getFolders(): Promise<Folder[]> {
    return Array.from(this.folders.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async updateFolder(id: string, updates: Partial<InsertFolder>): Promise<Folder | undefined> {
    const folder = this.folders.get(id);
    if (!folder) {
      return undefined;
    }

    const updatedFolder = { ...folder, ...updates };
    this.folders.set(id, updatedFolder);
    return updatedFolder;
  }

  async deleteFolder(id: string): Promise<boolean> {
    const deleted = this.folders.delete(id);
    if (deleted) {
      // Remove folder association from documents
      for (const [docId, document] of Array.from(this.documents.entries())) {
        if (document.folderId === id) {
          this.documents.set(docId, { ...document, folderId: null });
        }
      }
    }
    return deleted;
  }

  // Tags
  async createTag(insertTag: InsertTag): Promise<Tag> {
    const id = randomUUID();
    const tag: Tag = {
      ...insertTag,
      id,
      createdAt: new Date(),
      color: insertTag.color ?? "#3b82f6",
    };
    this.tags.set(id, tag);
    return tag;
  }

  async getTags(): Promise<Tag[]> {
    return Array.from(this.tags.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async updateTag(id: string, updates: Partial<InsertTag>): Promise<Tag | undefined> {
    const tag = this.tags.get(id);
    if (!tag) {
      return undefined;
    }

    const updatedTag = { ...tag, ...updates };
    this.tags.set(id, updatedTag);
    return updatedTag;
  }

  async deleteTag(id: string): Promise<boolean> {
    const deleted = this.tags.delete(id);
    if (deleted) {
      // Remove tag associations
      for (const [dtId, documentTag] of Array.from(this.documentTags.entries())) {
        if (documentTag.tagId === id) {
          this.documentTags.delete(dtId);
        }
      }
    }
    return deleted;
  }

  // Document Tags
  async addDocumentTag(insertDocumentTag: InsertDocumentTag): Promise<DocumentTag> {
    const id = randomUUID();
    const documentTag: DocumentTag = {
      ...insertDocumentTag,
      id,
    };
    this.documentTags.set(id, documentTag);
    return documentTag;
  }

  async removeDocumentTags(documentId: string): Promise<void> {
    for (const [id, documentTag] of Array.from(this.documentTags.entries())) {
      if (documentTag.documentId === documentId) {
        this.documentTags.delete(id);
      }
    }
  }

  // Helper method to enrich document with folder and tags
  private enrichDocument(document: Document): DocumentWithFolderAndTags {
    const folder = document.folderId ? this.folders.get(document.folderId) : undefined;
    const documentTagIds = Array.from(this.documentTags.values())
      .filter(dt => dt.documentId === document.id)
      .map(dt => dt.tagId);
    const tags = documentTagIds.map(tagId => this.tags.get(tagId)).filter(Boolean) as Tag[];

    return {
      ...document,
      folder,
      tags,
    };
  }
}

export const storage = new MemStorage();

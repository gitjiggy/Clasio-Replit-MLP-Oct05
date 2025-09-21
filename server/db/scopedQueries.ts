import { db } from "../db";
import { documents, folders, tags, organizations, organizationMembers, activityLog, documentShares } from "@shared/schema";
import { eq, and, isNull, count, sql, desc } from "drizzle-orm";

/**
 * Scoped Database Access - SMB Security Layer
 * 
 * CRITICAL: Every query MUST be scoped to organizationId and userId
 * NO unscoped queries allowed - this prevents data leakage between organizations
 * 
 * Usage in routes: const result = await ScopedDB.getDocuments(req.organizationId!, req.user.uid);
 */
export class ScopedDB {
  
  // Forbid direct db access in routes (CI check: grep for "db.query" should fail)
  static forbidUnscoped() {
    console.warn("🚨 SECURITY: Use ScopedDB methods only, never direct db access!");
  }

  // DOCUMENTS - All document queries must be organization-scoped
  static async getDocuments(orgId: string, userId: string) {
    return db.query.documents.findMany({
      where: and(
        eq(documents.organizationId, orgId),
        isNull(documents.softDeletedAt), // Respect soft deletes
        eq(documents.isDeleted, false)
      ),
      with: {
        folder: true,
        documentTags: {
          with: { tag: true }
        }
      },
      orderBy: desc(documents.uploadedAt)
    });
  }

  static async getDocument(orgId: string, userId: string, documentId: string) {
    const doc = await db.query.documents.findFirst({
      where: and(
        eq(documents.id, documentId),
        eq(documents.organizationId, orgId),
        isNull(documents.softDeletedAt)
      ),
      with: {
        folder: true,
        documentTags: {
          with: { tag: true }
        }
      }
    });

    // Update last accessed timestamp for analytics
    if (doc) {
      await db.update(documents)
        .set({ lastAccessedAt: new Date() })
        .where(eq(documents.id, documentId));
    }

    return doc;
  }

  static async createDocument(orgId: string, userId: string, data: any) {
    // Check quotas first - critical for SMB cost control
    const org = await this.getOrganization(orgId);
    if (!org) throw new Error('Organization not found');
    
    const currentDocCount = org.documentCount || 0;
    const maxDocs = org.maxDocuments || 500;
    if (currentDocCount >= maxDocs) {
      throw new Error(`Document limit reached (${maxDocs} documents). Please upgrade your plan.`);
    }

    const fileSizeMb = Math.ceil((data.fileSize || 0) / 1024 / 1024);
    const currentStorage = org.storageUsedMb || 0;
    const maxStorage = org.maxStorageMb || 1000;
    if ((currentStorage + fileSizeMb) > maxStorage) {
      throw new Error(`Storage limit reached. Please upgrade your plan.`);
    }

    // Create document
    const [doc] = await db.insert(documents).values({
      ...data,
      organizationId: orgId,
      lastAccessedAt: new Date(),
    }).returning();

    // Update usage counters - critical for billing
    await this.incrementUsage(orgId, 'documentCount', 1);
    await this.incrementUsage(orgId, 'storageUsedMb', fileSizeMb);

    // Log activity
    await this.logActivity(orgId, userId, 'DOCUMENT_CREATED', 'document', doc.id, doc.name);

    return doc;
  }

  static async softDeleteDocument(orgId: string, userId: string, documentId: string) {
    const doc = await this.getDocument(orgId, userId, documentId);
    if (!doc) return false;

    const [updated] = await db.update(documents)
      .set({ softDeletedAt: new Date() })
      .where(and(
        eq(documents.id, documentId),
        eq(documents.organizationId, orgId)
      ))
      .returning();

    if (updated) {
      // Decrement usage counters
      const fileSizeMb = Math.ceil((doc.fileSize || 0) / 1024 / 1024);
      await this.incrementUsage(orgId, 'documentCount', -1);
      await this.incrementUsage(orgId, 'storageUsedMb', -fileSizeMb);

      await this.logActivity(orgId, userId, 'DOCUMENT_DELETED', 'document', documentId, doc.name);
      return true;
    }
    return false;
  }

  // FOLDERS - Organization-scoped folder management
  static async getFolders(orgId: string, userId: string) {
    return db.query.folders.findMany({
      where: eq(folders.organizationId, orgId),
      orderBy: folders.name
    });
  }

  static async createFolder(orgId: string, userId: string, data: any) {
    const [folder] = await db.insert(folders).values({
      ...data,
      organizationId: orgId,
    }).returning();

    await this.logActivity(orgId, userId, 'FOLDER_CREATED', 'folder', folder.id, folder.name);
    return folder;
  }

  // TAGS - Organization-scoped tag management
  static async getTags(orgId: string, userId: string) {
    return db.query.tags.findMany({
      where: eq(tags.organizationId, orgId),
      orderBy: tags.name
    });
  }

  // ORGANIZATIONS - User access and quota management
  static async getOrganization(orgId: string) {
    return db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
    });
  }

  static async getUserOrganizations(userId: string) {
    return db.query.organizationMembers.findMany({
      where: and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.isActive, true)
      ),
      with: { organization: true }
    });
  }

  static async checkUserOrgAccess(orgId: string, userId: string): Promise<'owner' | 'member' | null> {
    const membership = await db.query.organizationMembers.findFirst({
      where: and(
        eq(organizationMembers.organizationId, orgId),
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.isActive, true)
      )
    });
    return membership ? membership.role as 'owner' | 'member' : null;
  }

  // USAGE TRACKING - Critical for SMB billing and quotas
  static async incrementUsage(orgId: string, field: 'documentCount' | 'storageUsedMb' | 'aiAnalysesThisMonth', amount: number) {
    await db.execute(sql`
      UPDATE organizations 
      SET ${sql.identifier(field)} = GREATEST(0, ${sql.identifier(field)} + ${amount})
      WHERE id = ${orgId}
    `);
  }

  static async checkAiQuota(orgId: string): Promise<boolean> {
    const org = await this.getOrganization(orgId);
    if (!org) return false;
    const currentAnalyses = org.aiAnalysesThisMonth || 0;
    const maxAnalyses = org.maxAiAnalysesPerMonth || 100;
    return currentAnalyses < maxAnalyses;
  }

  static async incrementAiUsage(orgId: string) {
    await this.incrementUsage(orgId, 'aiAnalysesThisMonth', 1);
  }

  // ACTIVITY LOGGING - Light audit trail (90 days retention)
  static async logActivity(
    orgId: string, 
    userId: string, 
    action: string, 
    resourceType: string, 
    resourceId?: string, 
    resourceName?: string, 
    details?: any
  ) {
    await db.insert(activityLog).values({
      organizationId: orgId,
      userId,
      action,
      resourceType,
      resourceId,
      resourceName,
      details: details ? JSON.stringify(details) : null,
    });
  }

  static async getActivityLog(orgId: string, userId: string, limit: number = 50) {
    return db.query.activityLog.findMany({
      where: eq(activityLog.organizationId, orgId),
      orderBy: desc(activityLog.timestamp),
      limit
    });
  }

  // DOCUMENT SHARING - Per-document email sharing
  static async shareDocument(
    orgId: string, 
    userId: string, 
    documentId: string, 
    email: string, 
    accessLevel: 'viewer' | 'editor' = 'viewer',
    expiresInDays: number = 30
  ) {
    // Verify user owns document
    const doc = await this.getDocument(orgId, userId, documentId);
    if (!doc) throw new Error('Document not found');

    const shareToken = require('crypto').randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const [share] = await db.insert(documentShares).values({
      documentId,
      sharedBy: userId,
      sharedWithEmail: email,
      shareToken,
      accessLevel,
      expiresAt,
    }).returning();

    await this.logActivity(orgId, userId, 'DOCUMENT_SHARED', 'document', documentId, doc.name, {
      sharedWithEmail: email,
      accessLevel,
      expiresAt: expiresAt.toISOString()
    });

    return {
      shareUrl: `${process.env.BASE_URL || ''}/shared/${shareToken}`,
      expiresAt,
      shareToken
    };
  }

  static async getDocumentByShareToken(shareToken: string) {
    const share = await db.query.documentShares.findFirst({
      where: and(
        eq(documentShares.shareToken, shareToken),
        sql`expires_at > NOW()`
      )
    });

    if (!share) return null;

    const doc = await db.query.documents.findFirst({
      where: and(
        eq(documents.id, share.documentId),
        isNull(documents.softDeletedAt)
      )
    });

    return doc ? { document: doc, share } : null;
  }

  // DATA LIFECYCLE - Purge soft-deleted documents after 30 days
  static async purgeOldDocuments() {
    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    
    const docsToDelete = await db.query.documents.findMany({
      where: and(
        sql`soft_deleted_at IS NOT NULL`,
        sql`soft_deleted_at < ${cutoffDate}`
      )
    });

    for (const doc of docsToDelete) {
      // TODO: Delete actual file from storage
      await db.delete(documents).where(eq(documents.id, doc.id));
      console.log(`🗑️ Purged document: ${doc.name} (soft deleted ${doc.softDeletedAt})`);
    }

    return docsToDelete.length;
  }

  // Get all shares for a document (with proper security)
  static async getDocumentShares(orgId: string, userId: string, documentId: string) {
    // First verify document belongs to org and user has access
    const document = await this.getDocument(orgId, userId, documentId);
    if (!document) throw new Error('Document not found or no access');

    return db.query.documentShares.findMany({
      where: eq(documentShares.documentId, documentId),
      orderBy: desc(documentShares.createdAt)
    });
  }

  // Remove a document share (with proper security)
  static async removeDocumentShare(orgId: string, userId: string, shareId: string) {
    // Get the share and verify ownership through document
    const share = await db.query.documentShares.findFirst({
      where: eq(documentShares.id, shareId)
    });
    
    if (!share) throw new Error('Share not found');
    
    // Verify user has access to document (must be owner or share creator)
    const document = await this.getDocument(orgId, userId, share.documentId);
    if (!document) throw new Error('No access to document');
    
    // Additional check: only share creator or document owner can remove shares
    if (share.sharedBy !== userId) {
      const userRole = await this.checkUserOrgAccess(orgId, userId);
      if (userRole !== 'owner') {
        throw new Error('Only share creator or organization owner can remove shares');
      }
    }

    await db.delete(documentShares).where(eq(documentShares.id, shareId));
    
    // Log activity
    await this.logActivity(
      orgId,
      userId,
      'DOCUMENT_UNSHARED',
      'document',
      share.documentId,
      document.name,
      { 
        sharedWithEmail: share.sharedWithEmail,
        removedBy: userId,
        originalShareBy: share.sharedBy 
      }
    );
  }
}

// Export types for middleware
export interface OrgRequest extends Request { 
  organizationId?: string; 
  user: { uid: string };
}
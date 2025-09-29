// Conservative quota management for 1GB storage limits
import { db } from './db.js';
import { userQuotas, documents } from '@shared/schema.js';
import { eq, and, sum, sql } from 'drizzle-orm';

export interface UserQuota {
  userId: string;
  storageLimit: bigint;
  storageUsed: bigint;
  documentLimit: number;
  documentCount: number;
  quotaTier: string;
}

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  details?: {
    currentUsage: string;
    limit: string;
    wouldExceed: string;
    overage?: string;
  };
}

// Conservative quota limits (all users get the same)
const QUOTA_LIMITS = {
  STORAGE_BYTES: BigInt(1073741824), // 1GB exactly
  DOCUMENT_COUNT: 200, // 200 documents maximum
  TIER: 'standard' // Single tier for everyone
};

// Fun quota exceeded messages
const QUOTA_EXCEEDED_MESSAGES = {
  storage: [
    "Whoa there, digital hoarder! 🗂️ Your storage vault is at capacity. Time for some spring cleaning! 🧹",
    "Your files are having a space party, but the venue is full! 🎉 Consider archiving some old documents to make room! 📦",
    "Houston, we have a storage problem! 🚀 You've hit your 1GB limit. Free up some space and try again! 🌌",
    "Your digital filing cabinet is bursting at the seams! 🗄️💥 Archive or delete some files to continue uploading! 📂",
    "Plot twist: You're out of storage space! 🎬 Time to be the hero and make some room! 🦸‍♂️",
    "Your storage is fuller than a thanksgiving dinner plate! 🦃🍽️ Clear some space for dessert (new files)! 🍰"
  ],
  documents: [
    "Document collector's achievement unlocked! 📋🏆 You've hit the 200 document limit. Time to organize! 📚",
    "Your document library is complete! 📖 You've reached the 200-file maximum. Consider archiving some older ones! 📦",
    "Document limit reached! 📄⚠️ You're at 200 files - time for some digital decluttering! 🧹",
    "Your file collection is maxed out! 🗃️ Archive some documents to make room for new ones! ✨",
    "200 documents achieved! 🎯 You're officially a power user. Now let's make some space! 🚀",
    "Document storage full! 📊 Time to archive the old to make way for the new! 🔄"
  ]
};

/**
 * Get or create user quota record
 */
export async function getUserQuota(userId: string): Promise<UserQuota | null> {
  try {
    // Try to get existing quota
    const existingQuota = await db
      .select()
      .from(userQuotas)
      .where(eq(userQuotas.userId, userId))
      .limit(1);

    if (existingQuota.length > 0) {
      return {
        userId: existingQuota[0].userId,
        storageLimit: existingQuota[0].storageLimit,
        storageUsed: existingQuota[0].storageUsed,
        documentLimit: existingQuota[0].documentLimit,
        documentCount: existingQuota[0].documentCount,
        quotaTier: existingQuota[0].quotaTier
      };
    }

    // Create new quota record with conservative defaults
    const [newQuota] = await db
      .insert(userQuotas)
      .values({
        userId,
        storageLimit: QUOTA_LIMITS.STORAGE_BYTES,
        storageUsed: BigInt(0),
        documentLimit: QUOTA_LIMITS.DOCUMENT_COUNT,
        documentCount: 0,
        quotaTier: QUOTA_LIMITS.TIER
      })
      .returning();

    return {
      userId: newQuota.userId,
      storageLimit: newQuota.storageLimit,
      storageUsed: newQuota.storageUsed,
      documentLimit: newQuota.documentLimit,
      documentCount: newQuota.documentCount,
      quotaTier: newQuota.quotaTier
    };
  } catch (error) {
    console.error('Failed to get/create user quota:', error);
    return null;
  }
}

/**
 * Check if user can upload a file of given size
 */
export async function checkStorageQuota(userId: string, fileSizeBytes: number): Promise<QuotaCheckResult> {
  try {
    const quota = await getUserQuota(userId);
    if (!quota) {
      return {
        allowed: false,
        reason: 'Unable to check quota limits 🤷‍♂️ Please try again!'
      };
    }

    const newStorageUsed = quota.storageUsed + BigInt(fileSizeBytes);
    const storageLimitMB = Number(quota.storageLimit) / (1024 * 1024);
    const currentUsageMB = Number(quota.storageUsed) / (1024 * 1024);
    const fileSizeMB = fileSizeBytes / (1024 * 1024);
    const newUsageMB = Number(newStorageUsed) / (1024 * 1024);

    if (newStorageUsed > quota.storageLimit) {
      const overageMB = newUsageMB - storageLimitMB;
      const randomMessage = QUOTA_EXCEEDED_MESSAGES.storage[
        Math.floor(Math.random() * QUOTA_EXCEEDED_MESSAGES.storage.length)
      ];

      return {
        allowed: false,
        reason: `${randomMessage}\n\n📊 Storage details:\n• Current usage: ${currentUsageMB.toFixed(1)}MB\n• Your limit: ${storageLimitMB.toFixed(0)}MB\n• This file: ${fileSizeMB.toFixed(1)}MB\n• Would exceed by: ${overageMB.toFixed(1)}MB\n\n💡 Free up ${Math.ceil(overageMB)}MB and try again!`,
        details: {
          currentUsage: `${currentUsageMB.toFixed(1)}MB`,
          limit: `${storageLimitMB.toFixed(0)}MB`,
          wouldExceed: `${newUsageMB.toFixed(1)}MB`,
          overage: `${overageMB.toFixed(1)}MB`
        }
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error('Storage quota check failed:', error);
    return {
      allowed: false,
      reason: 'Unable to check storage quota 😅 Please try again!'
    };
  }
}

/**
 * Check if user can add another document
 */
export async function checkDocumentQuota(userId: string): Promise<QuotaCheckResult> {
  try {
    const quota = await getUserQuota(userId);
    if (!quota) {
      return {
        allowed: false,
        reason: 'Unable to check quota limits 🤷‍♂️ Please try again!'
      };
    }

    if (quota.documentCount >= quota.documentLimit) {
      const randomMessage = QUOTA_EXCEEDED_MESSAGES.documents[
        Math.floor(Math.random() * QUOTA_EXCEEDED_MESSAGES.documents.length)
      ];

      return {
        allowed: false,
        reason: `${randomMessage}\n\n📊 Document details:\n• Current count: ${quota.documentCount}\n• Your limit: ${quota.documentLimit}\n• Space needed: 1 document\n\n💡 Archive or delete some documents and try again!`,
        details: {
          currentUsage: `${quota.documentCount} documents`,
          limit: `${quota.documentLimit} documents`,
          wouldExceed: `${quota.documentCount + 1} documents`
        }
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error('Document quota check failed:', error);
    return {
      allowed: false,
      reason: 'Unable to check document quota 😅 Please try again!'
    };
  }
}

/**
 * Update user storage usage after file upload
 */
export async function updateStorageUsage(userId: string, fileSizeBytes: number): Promise<boolean> {
  try {
    await db
      .update(userQuotas)
      .set({
        storageUsed: sql`${userQuotas.storageUsed} + ${BigInt(fileSizeBytes)}`,
        documentCount: sql`${userQuotas.documentCount} + 1`,
        updatedAt: sql`now()`
      })
      .where(eq(userQuotas.userId, userId));

    console.log(`📊 Updated quota for user ${userId}: +${(fileSizeBytes / 1024 / 1024).toFixed(1)}MB, +1 document`);
    return true;
  } catch (error) {
    console.error('Failed to update storage usage:', error);
    return false;
  }
}

/**
 * Update user storage usage after file deletion
 */
export async function decreaseStorageUsage(userId: string, fileSizeBytes: number): Promise<boolean> {
  try {
    await db
      .update(userQuotas)
      .set({
        storageUsed: sql`GREATEST(0, ${userQuotas.storageUsed} - ${BigInt(fileSizeBytes)})`,
        documentCount: sql`GREATEST(0, ${userQuotas.documentCount} - 1)`,
        updatedAt: sql`now()`
      })
      .where(eq(userQuotas.userId, userId));

    console.log(`📊 Decreased quota for user ${userId}: -${(fileSizeBytes / 1024 / 1024).toFixed(1)}MB, -1 document`);
    return true;
  } catch (error) {
    console.error('Failed to decrease storage usage:', error);
    return false;
  }
}

/**
 * Recalculate user storage usage from actual documents
 */
export async function recalculateStorageUsage(userId: string): Promise<boolean> {
  try {
    // Calculate actual storage and document count from documents table
    const result = await db
      .select({
        totalStorage: sum(documents.fileSize),
        documentCount: sql<number>`count(*)::int`
      })
      .from(documents)
      .where(
        and(
          eq(documents.userId, userId),
          eq(documents.status, 'active') // Only count active documents
        )
      );

    const actualStorage = BigInt(Number(result[0]?.totalStorage || 0));
    const actualCount = result[0]?.documentCount || 0;

    await db
      .update(userQuotas)
      .set({
        storageUsed: actualStorage,
        documentCount: actualCount,
        updatedAt: sql`now()`
      })
      .where(eq(userQuotas.userId, userId));

    console.log(`🔄 Recalculated quota for user ${userId}: ${(Number(actualStorage) / 1024 / 1024).toFixed(1)}MB, ${actualCount} documents`);
    return true;
  } catch (error) {
    console.error('Failed to recalculate storage usage:', error);
    return false;
  }
}

/**
 * Get quota usage summary for user dashboard
 */
export async function getQuotaUsageSummary(userId: string): Promise<{
  storage: {
    used: string;
    limit: string;
    percentage: number;
  };
  documents: {
    count: number;
    limit: number;
    percentage: number;
  };
  tier: string;
} | null> {
  try {
    const quota = await getUserQuota(userId);
    if (!quota) return null;

    const storageUsedMB = Number(quota.storageUsed) / (1024 * 1024);
    const storageLimitMB = Number(quota.storageLimit) / (1024 * 1024);
    const storagePercentage = Math.round((storageUsedMB / storageLimitMB) * 100);
    const documentsPercentage = Math.round((quota.documentCount / quota.documentLimit) * 100);

    return {
      storage: {
        used: `${storageUsedMB.toFixed(1)}MB`,
        limit: `${storageLimitMB.toFixed(0)}MB`,
        percentage: storagePercentage
      },
      documents: {
        count: quota.documentCount,
        limit: quota.documentLimit,
        percentage: documentsPercentage
      },
      tier: quota.quotaTier
    };
  } catch (error) {
    console.error('Failed to get quota usage summary:', error);
    return null;
  }
}
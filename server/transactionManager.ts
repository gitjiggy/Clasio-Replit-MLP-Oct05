import { randomUUID, createHash } from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import { db } from "./db";
import { 
  idempotencyKeys, 
  type InsertIdempotencyKey, 
  type IdempotencyKey 
} from "@shared/schema";
import { eq, and, lt, sql } from "drizzle-orm";

/**
 * Transaction Manager for database operations with idempotency support
 * Ensures data consistency and prevents duplicate operations
 */

export interface TransactionContext {
  reqId: string;
  userId: string;
  operationType: string;
  idempotencyKey?: string;
  resourceIds?: {
    documentId?: string;
    versionId?: string;
    folderId?: string;
    tagId?: string;
    [key: string]: string | undefined;
  };
}

export interface TransactionResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  isRetry?: boolean; // Indicates if this was a replayed operation
}

export interface PostCommitHook {
  type: 'analytics' | 'notification' | 'webhook';
  action: string;
  data: any;
}

// Context for post-commit hooks using AsyncLocalStorage for proper request isolation
interface TransactionLocalContext {
  hooks: PostCommitHook[];
}

const asyncLocalStorage = new AsyncLocalStorage<TransactionLocalContext>();

// Rollback testing configuration
interface FailpointConfig {
  operationType: string;
  failurePoint: 'before_operation' | 'after_operation' | 'before_idempotency_update';
  errorMessage?: string;
}

let activeFailpoints: FailpointConfig[] = [];

// Transaction boundary logging
interface TransactionBoundaryLog {
  event: 'TRANSACTION_BEGIN' | 'TRANSACTION_COMMIT' | 'TRANSACTION_ROLLBACK';
  reqId: string;
  tenantId: string; // Truncated userId for privacy
  operationType: string;
  resourceIds?: Record<string, string | undefined>;
  timestamp: string;
  executionTimeMs?: number;
  error?: string;
}

function logTransactionBoundary(log: TransactionBoundaryLog): void {
  console.log(JSON.stringify(log));
}

export class TransactionManager {
  private cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * Start the TTL cleanup job for expired idempotency keys
   */
  startTTLCleanup(): void {
    // Run cleanup every hour
    this.cleanupInterval = setInterval(async () => {
      await this.cleanupExpiredKeys();
    }, 60 * 60 * 1000); // 1 hour

    console.log('[IdempotencyTTL] Started TTL cleanup job (runs hourly)');
    
    // Run initial cleanup
    this.cleanupExpiredKeys().catch(error => {
      console.error('[IdempotencyTTL] Initial cleanup failed:', error);
    });
  }

  /**
   * Stop the TTL cleanup job
   */
  stopTTLCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('[IdempotencyTTL] Stopped TTL cleanup job');
    }
  }

  /**
   * Clean up expired idempotency keys (TTL enforcement)
   */
  async cleanupExpiredKeys(): Promise<number> {
    try {
      const deleted = await db
        .delete(idempotencyKeys)
        .where(lt(idempotencyKeys.expiresAt, sql`now()`))
        .returning({ id: idempotencyKeys.id });

      const deletedCount = deleted.length;
      if (deletedCount > 0) {
        console.log(`[IdempotencyTTL] Cleaned up ${deletedCount} expired idempotency keys`);
      }

      return deletedCount;
    } catch (error) {
      console.error('[IdempotencyTTL] Cleanup failed:', error);
      return 0;
    }
  }

  /**
   * Execute operation within a database transaction with idempotency support
   */
  async executeWithIdempotency<T>(
    context: TransactionContext,
    operation: (tx: any) => Promise<T>,
    requestPayload?: any
  ): Promise<TransactionResult<T>> {
    const { reqId, userId, operationType, idempotencyKey } = context;
    
    console.log(`[Transaction] Starting ${operationType}`, {
      reqId,
      userId: userId.substring(0, 8) + '...',
      operationType,
      hasIdempotencyKey: !!idempotencyKey
    });

    // Create isolated context for this transaction execution
    const localContext: TransactionLocalContext = {
      hooks: []
    };

    return asyncLocalStorage.run(localContext, async () => {
      // Initialize startTime before any operations that could throw
      const startTime = Date.now();
      
      try {
        // If idempotency key provided, check for existing operation
        if (idempotencyKey) {
          const existingOperation = await this.checkIdempotencyKey(
            userId, 
            operationType, 
            idempotencyKey,
            requestPayload
          );
          
          if (existingOperation) {
            console.log(`[Transaction] Replaying operation`, {
              reqId,
              operationType,
              isRetry: existingOperation.isRetry,
              success: existingOperation.success
            });
            return existingOperation;
          }
        }

        // Log transaction begin
        logTransactionBoundary({
          event: 'TRANSACTION_BEGIN',
          reqId,
          tenantId: userId.substring(0, 8) + '...',
          operationType,
          resourceIds: context.resourceIds,
          timestamp: new Date().toISOString()
        });

        // Execute operation within transaction
        const result = await db.transaction(async (tx) => {
          // Create idempotency record if key provided
          let idempotencyRecord: IdempotencyKey | null = null;
          if (idempotencyKey) {
            idempotencyRecord = await this.createIdempotencyRecord(
              tx,
              userId,
              operationType,
              idempotencyKey,
              requestPayload
            );
          }

          try {
            // Check for before_operation failpoints
            this.checkFailpoint(operationType, 'before_operation');
            
            // Execute the actual operation - hooks will be added to our isolated context
            const operationResult = await operation(tx);
            
            // Check for after_operation failpoints
            this.checkFailpoint(operationType, 'after_operation');
            
            // Check for before_idempotency_update failpoints
            this.checkFailpoint(operationType, 'before_idempotency_update');
            
            // Update idempotency record with success
            if (idempotencyRecord) {
              await this.updateIdempotencyRecord(
                tx,
                idempotencyRecord.id,
                'completed',
                operationResult
              );
            }

            console.log(`[Transaction] Operation completed successfully`, {
              reqId,
              operationType,
              hasResult: !!operationResult
            });

            return operationResult;
          } catch (error) {
            // Update idempotency record with failure
            if (idempotencyRecord) {
              await this.updateIdempotencyRecord(
                tx,
                idempotencyRecord.id,
                'failed',
                null,
                error instanceof Error ? error.message : 'Unknown error'
              );
            }
            throw error;
          }
        });

        // Log successful transaction commit
        const endTime = Date.now();
        logTransactionBoundary({
          event: 'TRANSACTION_COMMIT',
          reqId,
          tenantId: userId.substring(0, 8) + '...',
          operationType,
          resourceIds: context.resourceIds,
          timestamp: new Date().toISOString(),
          executionTimeMs: endTime - startTime
        });

        // Execute post-commit hooks only after successful commit (using isolated context hooks)
        await this.executePostCommitHooks(context, result, localContext.hooks);

        return {
          success: true,
          data: result,
          isRetry: false
        };

      } catch (error) {
        // Log transaction rollback
        const endTime = Date.now();
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logTransactionBoundary({
          event: 'TRANSACTION_ROLLBACK',
          reqId,
          tenantId: userId.substring(0, 8) + '...',
          operationType,
          resourceIds: context.resourceIds,
          timestamp: new Date().toISOString(),
          executionTimeMs: endTime - startTime,
          error: errorMessage
        });

        console.error(`[Transaction] Operation failed`, {
          reqId,
          operationType,
          error: errorMessage
        });

        return {
          success: false,
          error: errorMessage
        };
      }
    });
  }

  /**
   * Add a post-commit hook to be executed after transaction success
   */
  addPostCommitHook(hook: PostCommitHook): void {
    // Get the current transaction's context from AsyncLocalStorage
    const store = asyncLocalStorage.getStore();
    if (store) {
      store.hooks.push(hook);
    } else {
      console.warn('[TransactionManager] addPostCommitHook called outside of transaction context');
    }
  }

  /**
   * Generate a deterministic idempotency key for an operation
   */
  generateIdempotencyKey(operationType: string, ...identifiers: string[]): string {
    const combined = [operationType, ...identifiers].join(':');
    // Use a hash for consistent key generation
    return createHash('sha256').update(combined).digest('hex').substring(0, 32);
  }

  /**
   * Check if operation already exists based on idempotency key
   */
  private async checkIdempotencyKey(
    userId: string,
    operationType: string,
    idempotencyKey: string,
    requestPayload?: any
  ): Promise<TransactionResult | null> {
    const existing = await db
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.userId, userId),
          eq(idempotencyKeys.operationType, operationType),
          eq(idempotencyKeys.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      return null;
    }

    const record = existing[0];

    // Validate request payload matches (prevent replay attacks with different data)
    if (requestPayload && record.requestPayload) {
      const existingPayload = JSON.parse(record.requestPayload);
      if (JSON.stringify(requestPayload) !== JSON.stringify(existingPayload)) {
        throw new Error('Idempotency key conflict: different request payload');
      }
    }

    // Return result based on status
    switch (record.status) {
      case 'completed':
        return {
          success: true,
          data: record.responsePayload ? JSON.parse(record.responsePayload) : null,
          isRetry: true
        };
      case 'failed':
        return {
          success: false,
          error: 'Previous operation failed',
          isRetry: true
        };
      case 'pending':
        // Operation is still in progress, wait and retry
        throw new Error('Operation already in progress');
      default:
        return null;
    }
  }

  /**
   * Create idempotency record for operation tracking
   */
  private async createIdempotencyRecord(
    tx: any,
    userId: string,
    operationType: string,
    idempotencyKey: string,
    requestPayload?: any
  ): Promise<IdempotencyKey> {
    const record: InsertIdempotencyKey = {
      userId,
      operationType,
      idempotencyKey,
      requestPayload: requestPayload ? JSON.stringify(requestPayload) : null,
      status: 'pending'
    };

    const [created] = await tx.insert(idempotencyKeys).values(record).returning();
    return created;
  }

  /**
   * Update idempotency record with operation result
   */
  private async updateIdempotencyRecord(
    tx: any,
    id: string,
    status: 'completed' | 'failed',
    result?: any,
    error?: string
  ): Promise<void> {
    const updates: Partial<IdempotencyKey> = {
      status,
      responsePayload: result ? JSON.stringify(result) : null
    };

    // Store specific result IDs for reference
    if (result && status === 'completed') {
      if (result.id) {
        // Determine which result field to set based on the result structure
        if (result.name && result.filePath) {
          updates.resultDocumentId = result.id;
        } else if (result.version !== undefined) {
          updates.resultVersionId = result.id;
        } else if (result.color) {
          updates.resultTagId = result.id;
        } else if (result.gcsPath !== undefined) {
          updates.resultFolderId = result.id;
        }
      }
    }

    await tx
      .update(idempotencyKeys)
      .set(updates)
      .where(eq(idempotencyKeys.id, id));
  }

  /**
   * Execute all post-commit hooks after successful transaction
   */
  private async executePostCommitHooks(context: TransactionContext, result: any, hooks: PostCommitHook[]): Promise<void> {
    for (const hook of hooks) {
      try {
        await this.executeHook(hook, context, result);
      } catch (error) {
        console.error(`[PostCommit] Hook execution failed`, {
          hookType: hook.type,
          hookAction: hook.action,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        // Don't throw - post-commit hooks shouldn't fail the transaction
      }
    }
  }

  /**
   * Execute individual post-commit hook
   */
  private async executeHook(hook: PostCommitHook, context: TransactionContext, result: any): Promise<void> {
    const { reqId, userId, operationType } = context;
    
    console.log(`[PostCommit] Executing ${hook.type} hook`, {
      reqId,
      action: hook.action,
      operationType
    });

    switch (hook.type) {
      case 'analytics':
        // Analytics integration would go here
        // For now, just log the event
        console.log(`[Analytics] ${hook.action}`, {
          userId: userId.substring(0, 8) + '...',
          operationType,
          data: hook.data,
          timestamp: new Date().toISOString()
        });
        break;
        
      case 'notification':
        // Notification system integration
        console.log(`[Notification] ${hook.action}`, hook.data);
        break;
        
      case 'webhook':
        // Webhook delivery
        console.log(`[Webhook] ${hook.action}`, hook.data);
        break;
    }
  }


  /**
   * Clean up expired idempotency keys (TTL cleanup)
   */
  static async cleanupExpiredKeys(): Promise<number> {
    console.log('[Cleanup] Starting idempotency key cleanup');
    
    const result = await db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.expiresAt, sql`now()`));
    
    const deletedCount = result.rowCount || 0;
    console.log(`[Cleanup] Removed ${deletedCount} expired idempotency keys`);
    
    return deletedCount;
  }

  /**
   * Check if a failpoint should trigger and throw error if so
   */
  private checkFailpoint(operationType: string, failurePoint: string): void {
    const matchingFailpoint = activeFailpoints.find(
      fp => fp.operationType === operationType && fp.failurePoint === failurePoint
    );
    
    if (matchingFailpoint) {
      const errorMessage = matchingFailpoint.errorMessage || 
        `[Failpoint] Injected failure at ${failurePoint} for ${operationType}`;
      console.log(`[Failpoint] Triggering failpoint: ${errorMessage}`);
      throw new Error(errorMessage);
    }
  }

  /**
   * Add a temporary failpoint for rollback testing (TESTING ONLY)
   */
  static addFailpoint(config: FailpointConfig): void {
    console.warn(`[Failpoint] Adding test failpoint: ${config.operationType} at ${config.failurePoint}`);
    activeFailpoints.push(config);
  }

  /**
   * Remove a specific failpoint (TESTING ONLY)
   */
  static removeFailpoint(operationType: string, failurePoint: string): void {
    activeFailpoints = activeFailpoints.filter(
      fp => !(fp.operationType === operationType && fp.failurePoint === failurePoint)
    );
    console.warn(`[Failpoint] Removed failpoint: ${operationType} at ${failurePoint}`);
  }

  /**
   * Clear all failpoints (TESTING ONLY)
   */
  static clearAllFailpoints(): void {
    const count = activeFailpoints.length;
    activeFailpoints = [];
    console.warn(`[Failpoint] Cleared ${count} failpoints`);
  }

  /**
   * Get active failpoints for debugging (TESTING ONLY)
   */
  static getActiveFailpoints(): FailpointConfig[] {
    return [...activeFailpoints];
  }
}

// Export singleton instance
export const transactionManager = new TransactionManager();

// Helper function to ensure tenant context in all operations
export function ensureTenantContext(userId?: string): void {
  if (!userId) {
    throw new Error('Tenant context (userId) is required for all database operations');
  }
}

// Schedule periodic cleanup of expired idempotency keys
setInterval(async () => {
  try {
    await TransactionManager.cleanupExpiredKeys();
  } catch (error) {
    console.error('Failed to cleanup expired idempotency keys:', error);
  }
}, 60 * 60 * 1000); // Every hour
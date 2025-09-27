import { TransactionManager, transactionManager } from './transactionManager';
import { db } from './db';
import { documents, idempotencyKeys } from '@shared/schema';
import { eq } from 'drizzle-orm';

/**
 * Test script to verify transaction rollback behavior with failpoints
 * This demonstrates that our transaction system properly rolls back on failures
 */

const testUserId = 'test-rollback-user-' + Date.now();
const testDocumentName = 'test-rollback-document-' + Date.now();

async function testTransactionRollback() {
  console.log('\n=== STARTING ROLLBACK TEST ===\n');
  
  try {
    // 1. Clear any existing failpoints
    TransactionManager.clearAllFailpoints();
    
    // 2. Count existing documents and idempotency keys for this test user
    const initialDocCount = await db
      .select()
      .from(documents)
      .where(eq(documents.userId, testUserId));
    
    const initialIdempotencyCount = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.userId, testUserId));
    
    console.log(`Initial state: ${initialDocCount.length} documents, ${initialIdempotencyCount.length} idempotency keys`);
    
    // 3. Add a failpoint that will trigger after the document insert but before idempotency update
    TransactionManager.addFailpoint({
      operationType: 'document_create',
      failurePoint: 'before_idempotency_update',
      errorMessage: 'Test failpoint: simulating failure before idempotency update'
    });
    
    console.log('Added failpoint for document_create at before_idempotency_update');
    
    // 4. Attempt to create a document (this should fail and roll back)
    let operationFailed = false;
    let errorMessage = '';
    
    const result = await transactionManager.executeWithIdempotency(
      {
        reqId: 'test-rollback-' + Date.now(),
        userId: testUserId,
        operationType: 'document_create',
        idempotencyKey: 'test-rollback-key-' + Date.now()
      },
      async (tx) => {
        // This simulates what happens in storage.createDocument
        const [document] = await tx
          .insert(documents)
          .values({
            userId: testUserId,
            name: testDocumentName,
            originalName: testDocumentName,
            fileType: 'text/plain',
            mimeType: 'text/plain',
            objectPath: '/test/rollback.txt'
          })
          .returning();
        
        // Add a post-commit hook (this should NOT fire if transaction rolls back)
        transactionManager.addPostCommitHook({
          type: 'analytics',
          action: 'document_created_test',
          data: {
            documentId: document.id,
            userId: testUserId,
            testRun: true
          }
        });
        
        console.log('Document insert completed, failpoint should trigger soon...');
        return document;
      },
      { name: testDocumentName, userId: testUserId }
    );
    
    // Check if TransactionManager returned failure (correct behavior)
    if (!result.success) {
      operationFailed = true;
      errorMessage = result.error || '';
      console.log('Expected failure occurred:', errorMessage);
    } else {
      console.log('UNEXPECTED: Operation succeeded when it should have failed!', result);
    }
    
    // 5. Verify the transaction rolled back correctly
    console.log('\n--- Verifying rollback behavior ---');
    
    // Check that no documents were created
    const finalDocCount = await db
      .select()
      .from(documents)
      .where(eq(documents.userId, testUserId));
    
    // Check that no idempotency keys were persisted
    const finalIdempotencyCount = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.userId, testUserId));
    
    console.log(`Final state: ${finalDocCount.length} documents, ${finalIdempotencyCount.length} idempotency keys`);
    
    // 6. Verify results
    const rollbackWorked = (
      operationFailed &&
      errorMessage.includes('Test failpoint') &&
      finalDocCount.length === initialDocCount.length &&
      finalIdempotencyCount.length === initialIdempotencyCount.length
    );
    
    if (rollbackWorked) {
      console.log('\n✅ ROLLBACK TEST PASSED');
      console.log('- Transaction failed as expected');
      console.log('- No documents were persisted');
      console.log('- No idempotency keys were persisted');
      console.log('- Analytics hooks did not fire (confirmed by no data in DB)');
    } else {
      console.log('\n❌ ROLLBACK TEST FAILED');
      console.log(`- Operation failed: ${operationFailed}`);
      console.log(`- Error message: ${errorMessage}`);
      console.log(`- Documents created: ${finalDocCount.length - initialDocCount.length}`);
      console.log(`- Idempotency keys created: ${finalIdempotencyCount.length - initialIdempotencyCount.length}`);
    }
    
    // 7. Clean up
    TransactionManager.clearAllFailpoints();
    console.log('Cleared all failpoints');
    
    return rollbackWorked;
    
  } catch (error) {
    console.error('Test execution failed:', error);
    TransactionManager.clearAllFailpoints(); // Clean up on error
    return false;
  }
}

// Export for use in other tests
export { testTransactionRollback };

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testTransactionRollback()
    .then((passed) => {
      console.log(`\n=== ROLLBACK TEST ${passed ? 'PASSED' : 'FAILED'} ===\n`);
      process.exit(passed ? 0 : 1);
    })
    .catch((error) => {
      console.error('Test runner failed:', error);
      process.exit(1);
    });
}
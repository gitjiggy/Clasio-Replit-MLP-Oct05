// Quick test script to run the GCS reconciler
async function testReconciler() {
  try {
    console.log("🔧 Testing GCS Path Reconciler...");
    
    // Import the storage module (TypeScript)
    const { DatabaseStorage } = await import('./server/storage.ts');
    const storage = new DatabaseStorage();
    
    // Run reconciler in dry run mode
    console.log("Running reconciler in DRY RUN mode...");
    const result = await storage.reconcileGCSPaths(true);
    
    console.log("\n📊 Reconciler Results:");
    console.log("Fixed paths:", result.fixed);
    console.log("Orphaned GCS objects:", result.orphanedGCSObjects.length);
    console.log("Orphaned DB documents:", result.orphanedDBDocuments.length);
    console.log("\n📝 Summary:");
    console.log(result.summary);
    
    if (result.orphanedDBDocuments.length > 0) {
      console.log("\n📋 Sample Orphaned DB Documents:");
      result.orphanedDBDocuments.slice(0, 5).forEach(doc => {
        console.log(`  - ${doc.name} (${doc.id}): ${doc.currentPath}`);
      });
    }
    
    if (result.orphanedGCSObjects.length > 0) {
      console.log("\n📋 Sample Orphaned GCS Objects:");
      result.orphanedGCSObjects.slice(0, 5).forEach(obj => {
        console.log(`  - ${obj}`);
      });
    }
    
    console.log("\n✅ Test completed successfully!");
    
  } catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
  }
}

// Run the test
testReconciler().then(() => {
  console.log("Exiting...");
  process.exit(0);
});
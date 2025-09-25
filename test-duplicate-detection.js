import { DatabaseStorage } from './server/storage.js';

async function testDuplicateDetection() {
  console.log('🔍 Testing duplicate detection logic...');
  
  const storage = new DatabaseStorage();
  const testUserId = 'TGE7oyssfjgQK3vteYF17lk6p1o2';
  const testFileName = 'test-doc-A1.pdf';
  const testFileSize = 48;
  
  try {
    console.log(`\n📋 Parameters:`);
    console.log(`- User ID: ${testUserId}`);
    console.log(`- File name: ${testFileName}`);
    console.log(`- File size: ${testFileSize} bytes`);
    
    const duplicates = await storage.findDuplicateFiles(testFileName, testFileSize, testUserId);
    
    console.log(`\n🎯 Results:`);
    console.log(`- Found ${duplicates.length} duplicates`);
    
    if (duplicates.length > 0) {
      console.log(`\n📄 Duplicate files found:`);
      duplicates.forEach((doc, index) => {
        console.log(`  ${index + 1}. ID: ${doc.id}`);
        console.log(`     Name: ${doc.originalName}`);
        console.log(`     Size: ${doc.fileSize} bytes`);
        console.log(`     Uploaded: ${doc.uploadedAt}`);
        console.log(`     Status: ${doc.status}`);
        console.log(`     Deleted: ${doc.isDeleted}`);
        console.log('');
      });
      
      console.log('✅ Duplicate detection is working correctly!');
    } else {
      console.log('❌ No duplicates found - this indicates a problem with the detection logic');
    }
    
  } catch (error) {
    console.error('💥 Error testing duplicate detection:', error);
    console.error('Stack trace:', error.stack);
  }
}

testDuplicateDetection().catch(console.error);
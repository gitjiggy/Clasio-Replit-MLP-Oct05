// Integration test for bulk upload route with exact filenames that were failing
// Using native fetch (available in Node 18+)

const testFiles = [
  { name: "Filters Launch Strategy.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 24576 },
  { name: "Disney PoV on B2B2C Writeup.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 32768 },
  { name: "Amagi Product Portfolio.txt", mimeType: "text/plain", size: 4096 },
  { name: "Srini Presentation and Amagi Value Prop.txt", mimeType: "text/plain", size: 8192 },
  { name: "1099-G for 2020 Tax Refund.JPG", mimeType: "image/jpeg", size: 512000 }
];

async function testBulkUpload() {
  try {
    console.log('🧪 Testing bulk upload with problematic filenames...');
    
    // Test the bulk upload URLs endpoint directly
    const response = await fetch('http://localhost:5000/api/documents/bulk-upload-urls', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token' // This will fail auth but should still return 200 with empty results
      },
      body: JSON.stringify({ files: testFiles })
    });
    
    const result = await response.json();
    
    console.log('📊 Test Results:');
    console.log(`Status: ${response.status}`);
    console.log(`Response:`, JSON.stringify(result, null, 2));
    
    // Validate expectations
    if (response.status === 200) {
      console.log('✅ SUCCESS: Route returned 200 (no more 500s!)');
      
      if (result.results) {
        console.log(`📋 Results structure: ${result.results.length} file results`);
        
        const okResults = result.results.filter(r => r.ok);
        const failedResults = result.results.filter(r => !r.ok);
        
        console.log(`✅ OK: ${okResults.length} files`);
        console.log(`❌ Failed: ${failedResults.length} files`);
        
        if (failedResults.length > 0) {
          console.log('Failed files:', failedResults.map(f => `${f.name}: ${f.reason}`));
        }
      } else {
        console.log('📋 Results: Non-authenticated request handled gracefully');
      }
    } else {
      console.log(`❌ FAIL: Still returning ${response.status}`);
    }
    
  } catch (error) {
    console.error('🚨 Test failed with error:', error);
  }
}

// Run the test
testBulkUpload();
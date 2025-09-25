import { Octokit } from '@octokit/rest';
import fs from 'fs';
import path from 'path';

let connectionSettings;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('GitHub not connected');
  }
  return accessToken;
}

async function getUncachableGitHubClient() {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

// Function to get existing file SHA (if it exists)
async function getFileSha(octokit, owner, repo, path) {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path
    });
    return response.data.sha;
  } catch (error) {
    if (error.status === 404) {
      return null; // File doesn't exist
    }
    throw error;
  }
}

// Function to upload or update a file properly with SHA handling
async function uploadFileWithRetry(octokit, owner, repo, filePath, localPath, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const content = fs.readFileSync(localPath);
      const base64Content = content.toString('base64');
      
      // Get existing file SHA if it exists
      const existingSha = await getFileSha(octokit, owner, repo, filePath);
      
      const params = {
        owner,
        repo,
        path: filePath,
        message: existingSha ? `Update ${filePath}` : `Add ${filePath}`,
        content: base64Content
      };
      
      // Add SHA if file exists
      if (existingSha) {
        params.sha = existingSha;
      }
      
      await octokit.rest.repos.createOrUpdateFileContents(params);
      console.log(`✅ ${existingSha ? 'Updated' : 'Created'}: ${filePath}`);
      return true;
      
    } catch (error) {
      if (attempt < maxRetries) {
        console.log(`❌ Attempt ${attempt}/${maxRetries} failed for ${filePath}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      } else {
        console.error(`🚨 Final failure for ${filePath}: ${error.message}`);
        return false;
      }
    }
  }
  return false;
}

// Function to recursively get files from specific important directories
function getTargetedFiles() {
  const targetDirectories = [
    'client/src',
    'server',
    'shared', 
    'migrations'
  ];
  
  const targetRootFiles = [
    'README.md',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'vite.config.ts',
    'tailwind.config.ts',
    'postcss.config.js',
    'drizzle.config.ts',
    'components.json',
    'replit.md'
  ];
  
  let allFiles = [];
  
  // Add root files
  targetRootFiles.forEach(file => {
    if (fs.existsSync(file)) {
      allFiles.push({ path: file, fullPath: file });
    }
  });
  
  // Add files from target directories
  targetDirectories.forEach(dir => {
    if (fs.existsSync(dir)) {
      allFiles = allFiles.concat(getFilesFromDirectory(dir));
    }
  });
  
  return allFiles;
}

function getFilesFromDirectory(dirPath, arrayOfFiles = [], basePath = '') {
  if (!fs.existsSync(dirPath)) {
    return arrayOfFiles;
  }

  const files = fs.readdirSync(dirPath);

  files.forEach(file => {
    const fullPath = path.join(dirPath, file);
    const relativePath = path.join(basePath, file).replace(/\\/g, '/');
    
    // Skip certain files
    const skipFiles = ['.DS_Store', '.gitkeep', 'Thumbs.db'];
    
    if (skipFiles.includes(file)) {
      return;
    }

    if (fs.statSync(fullPath).isDirectory()) {
      getFilesFromDirectory(fullPath, arrayOfFiles, relativePath);
    } else {
      arrayOfFiles.push({
        path: relativePath,
        fullPath: fullPath
      });
    }
  });

  return arrayOfFiles;
}

async function uploadTargetedFiles() {
  try {
    console.log('🎯 Starting targeted GitHub upload for essential files...');
    
    const octokit = await getUncachableGitHubClient();
    const owner = 'gitjiggy';
    const repo = 'Clasio-Replit-MLP-Sep24';
    
    // Get targeted files
    const files = getTargetedFiles();
    console.log(`📂 Found ${files.length} essential files to upload`);
    
    let successCount = 0;
    let failureCount = 0;
    
    // Upload in small batches
    const batchSize = 3;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      
      console.log(`\n📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(files.length/batchSize)}...`);
      
      const promises = batch.map(async (file) => {
        const success = await uploadFileWithRetry(octokit, owner, repo, file.path, file.fullPath);
        if (success) {
          successCount++;
        } else {
          failureCount++;
        }
        return success;
      });
      
      await Promise.all(promises);
      
      // Short delay between batches
      if (i + batchSize < files.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`\n📊 Targeted Upload Summary:`);
    console.log(`✅ Successfully uploaded: ${successCount} files`);
    console.log(`❌ Failed uploads: ${failureCount} files`);
    console.log(`📈 Success rate: ${((successCount / files.length) * 100).toFixed(1)}%`);
    
    if (failureCount === 0) {
      console.log(`\n🎉 All essential files uploaded successfully!`);
      console.log(`🔗 Repository: https://github.com/${owner}/${repo}`);
    } else {
      console.log(`\n⚠️  ${failureCount} files failed. Repository may be incomplete.`);
    }
    
    return { successCount, failureCount, totalFiles: files.length };
    
  } catch (error) {
    console.error('🚨 Targeted upload failed:', error.message);
    throw error;
  }
}

async function verifyEssentialStructure() {
  try {
    console.log('\n🔍 Verifying essential repository structure...');
    
    const octokit = await getUncachableGitHubClient();
    const owner = 'gitjiggy';
    const repo = 'Clasio-Replit-MLP-Sep24';
    
    // Essential directories that must exist
    const essentialDirs = [
      'client/src/components/ui',
      'client/src/hooks',
      'client/src/lib',
      'client/src/pages',
      'server',
      'shared'
    ];
    
    // Essential files that must exist
    const essentialFiles = [
      'README.md',
      'package.json',
      'shared/schema.ts',
      'server/storage.ts',
      'server/routes.ts',
      'client/src/App.tsx',
      'client/src/components/ui/button.tsx'
    ];
    
    let allEssentialPresent = true;
    
    console.log('\n📁 Checking essential directories...');
    for (const dir of essentialDirs) {
      try {
        const response = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: dir
        });
        
        if (Array.isArray(response.data) && response.data.length > 0) {
          console.log(`✅ ${dir}/ - OK (${response.data.length} items)`);
        } else {
          console.log(`⚠️  ${dir}/ - Empty`);
        }
      } catch (error) {
        console.log(`❌ ${dir}/ - Missing`);
        allEssentialPresent = false;
      }
    }
    
    console.log('\n📄 Checking essential files...');
    for (const file of essentialFiles) {
      try {
        await octokit.rest.repos.getContent({
          owner,
          repo,
          path: file
        });
        console.log(`✅ ${file} - OK`);
      } catch (error) {
        console.log(`❌ ${file} - Missing`);
        allEssentialPresent = false;
      }
    }
    
    if (allEssentialPresent) {
      console.log('\n🎯 Essential structure verification PASSED!');
      console.log('🏗️  Repository contains all essential files and can be built.');
    } else {
      console.log('\n⚠️  Essential structure verification FAILED!');
      console.log('❌ Some critical files are missing.');
    }
    
    return allEssentialPresent;
    
  } catch (error) {
    console.error('Error verifying structure:', error.message);
    return false;
  }
}

async function main() {
  try {
    const uploadResults = await uploadTargetedFiles();
    const structureOK = await verifyEssentialStructure();
    
    console.log('\n✨ Targeted Upload Process Complete:');
    console.log(`📊 Files: ${uploadResults.successCount}/${uploadResults.totalFiles} uploaded successfully`);
    console.log(`🏗️  Structure: ${structureOK ? 'COMPLETE' : 'INCOMPLETE'}`);
    
    if (uploadResults.failureCount === 0 && structureOK) {
      console.log('\n🎉 SUCCESS! Complete working repository is now on GitHub.');
      console.log('🔗 https://github.com/gitjiggy/Clasio-Replit-MLP-Sep24');
      console.log('📋 The repository contains all essential files for building and running the application.');
    } else {
      console.log('\n⚠️  Upload completed with some issues.');
    }
    
  } catch (error) {
    console.error('💥 Targeted upload process failed:', error.message);
    process.exit(1);
  }
}

main();
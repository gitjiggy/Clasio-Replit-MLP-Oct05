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
      console.log(`❌ Attempt ${attempt}/${maxRetries} failed for ${filePath}: ${error.message}`);
      
      if (attempt === maxRetries) {
        console.error(`🚨 Final failure for ${filePath}: ${error.message}`);
        return false;
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
  return false;
}

// Function to recursively get all files in a directory
function getAllFilesRecursively(dirPath, arrayOfFiles = [], basePath = '') {
  if (!fs.existsSync(dirPath)) {
    return arrayOfFiles;
  }

  const files = fs.readdirSync(dirPath);

  files.forEach(file => {
    const fullPath = path.join(dirPath, file);
    const relativePath = path.join(basePath, file).replace(/\\/g, '/'); // Ensure forward slashes
    
    // Skip certain directories and files
    const skipDirs = [
      'node_modules', '.git', '.next', 'dist', 'build', '.replit', 
      'tmp', '.cache', 'logs', '.vscode', '.idea'
    ];
    const skipFiles = [
      '.env', '.env.local', '.env.production', '.DS_Store', 
      'yarn.lock', '.replit_config', '.replit_config.dev', '.gitignore'
    ];
    
    if (skipDirs.includes(file) || skipFiles.includes(file) || file.startsWith('.env') || file.endsWith('.log')) {
      return;
    }

    if (fs.statSync(fullPath).isDirectory()) {
      getAllFilesRecursively(fullPath, arrayOfFiles, relativePath);
    } else {
      arrayOfFiles.push({
        path: relativePath,
        fullPath: fullPath
      });
    }
  });

  return arrayOfFiles;
}

async function uploadCompleteRepository() {
  try {
    console.log('🚀 Starting COMPLETE repository upload to Clasio-Replit-MLP-Sep24...');
    
    const octokit = await getUncachableGitHubClient();
    const owner = 'gitjiggy';
    const repo = 'Clasio-Replit-MLP-Sep24';
    
    // Get ALL files in the project
    const allFiles = getAllFilesRecursively('.');
    console.log(`📂 Found ${allFiles.length} total files to upload/update`);
    
    // Group files by priority
    const priorityFiles = allFiles.filter(f => 
      f.path.includes('package.json') ||
      f.path.includes('schema.ts') ||
      f.path.includes('README.md') ||
      f.path.startsWith('shared/') ||
      f.path.startsWith('server/') && (f.path.includes('storage.ts') || f.path.includes('routes.ts'))
    );
    
    const componentFiles = allFiles.filter(f => 
      f.path.startsWith('client/src/components/') ||
      f.path.startsWith('client/src/hooks/') ||
      f.path.startsWith('client/src/lib/')
    );
    
    const otherFiles = allFiles.filter(f => 
      !priorityFiles.includes(f) && !componentFiles.includes(f)
    );
    
    console.log(`📋 Upload Plan:`);
    console.log(`  - Priority files: ${priorityFiles.length}`);
    console.log(`  - Component files: ${componentFiles.length}`);
    console.log(`  - Other files: ${otherFiles.length}`);
    
    let successCount = 0;
    let failureCount = 0;
    
    // Upload in batches with priorities
    const uploadBatch = async (files, batchName, batchSize = 5) => {
      console.log(`\n📦 Uploading ${batchName} (${files.length} files)...`);
      
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        
        console.log(`  Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(files.length/batchSize)}...`);
        
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
        
        // Add delay between batches to avoid rate limits
        if (i + batchSize < files.length) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
    };
    
    // Upload priority files first
    await uploadBatch(priorityFiles, 'Priority Files', 3);
    
    // Upload component files
    await uploadBatch(componentFiles, 'Component Files', 5);
    
    // Upload remaining files
    await uploadBatch(otherFiles, 'Remaining Files', 8);
    
    console.log(`\n📊 Complete Upload Summary:`);
    console.log(`✅ Successfully uploaded/updated: ${successCount} files`);
    console.log(`❌ Failed uploads: ${failureCount} files`);
    console.log(`📈 Success rate: ${((successCount / allFiles.length) * 100).toFixed(1)}%`);
    
    if (failureCount === 0) {
      console.log(`\n🎉 COMPLETE repository successfully uploaded!`);
      console.log(`🔗 Repository: https://github.com/${owner}/${repo}`);
      console.log(`📋 Total files: ${allFiles.length}`);
    } else {
      console.log(`\n⚠️  ${failureCount} files failed to upload. Repository may be incomplete.`);
    }
    
    return { successCount, failureCount, totalFiles: allFiles.length };
    
  } catch (error) {
    console.error('🚨 Fatal error during complete upload:', error.message);
    throw error;
  }
}

async function verifyRepositoryStructure() {
  try {
    console.log('\n🔍 Verifying repository structure...');
    
    const octokit = await getUncachableGitHubClient();
    const owner = 'gitjiggy';
    const repo = 'Clasio-Replit-MLP-Sep24';
    
    // Key directories that should exist
    const keyDirectories = [
      'client/src/components',
      'client/src/hooks',  
      'client/src/lib',
      'client/src/pages',
      'server',
      'shared',
      'migrations'
    ];
    
    // Key files that should exist
    const keyFiles = [
      'package.json',
      'README.md',
      'shared/schema.ts',
      'server/storage.ts',
      'server/routes.ts',
      'client/src/App.tsx',
      'client/src/components/ui/button.tsx',
      'client/src/hooks/use-toast.ts'
    ];
    
    let allPresent = true;
    
    console.log('\n📁 Checking key directories...');
    for (const dir of keyDirectories) {
      try {
        const response = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: dir
        });
        
        if (Array.isArray(response.data) && response.data.length > 0) {
          console.log(`✅ ${dir}/ - Present (${response.data.length} items)`);
        } else {
          console.log(`⚠️  ${dir}/ - Empty or missing`);
          allPresent = false;
        }
      } catch (error) {
        console.log(`❌ ${dir}/ - Missing or inaccessible`);
        allPresent = false;
      }
    }
    
    console.log('\n📄 Checking key files...');
    for (const file of keyFiles) {
      try {
        await octokit.rest.repos.getContent({
          owner,
          repo,
          path: file
        });
        console.log(`✅ ${file} - Present`);
      } catch (error) {
        console.log(`❌ ${file} - Missing or inaccessible`);
        allPresent = false;
      }
    }
    
    if (allPresent) {
      console.log('\n🎯 Repository structure verification PASSED!');
      console.log('🏗️  The repository contains all essential directories and files.');
    } else {
      console.log('\n⚠️  Repository structure verification FAILED!');
      console.log('❌ Some critical directories or files are missing.');
    }
    
    return allPresent;
    
  } catch (error) {
    console.error('Error verifying repository structure:', error.message);
    return false;
  }
}

async function main() {
  try {
    const uploadResults = await uploadCompleteRepository();
    const structureVerified = await verifyRepositoryStructure();
    
    console.log('\n✨ Complete Upload Process Summary:');
    console.log(`📊 Upload Results: ${uploadResults.successCount}/${uploadResults.totalFiles} files uploaded`);
    console.log(`🏗️  Structure Verification: ${structureVerified ? 'PASSED' : 'FAILED'}`);
    
    if (uploadResults.failureCount === 0 && structureVerified) {
      console.log('\n🎉 SUCCESS! Complete repository is now available on GitHub.');
      console.log('🔗 https://github.com/gitjiggy/Clasio-Replit-MLP-Sep24');
    } else {
      console.log('\n⚠️  Upload completed with issues. Manual verification recommended.');
    }
    
  } catch (error) {
    console.error('💥 Complete upload process failed:', error.message);
    process.exit(1);
  }
}

main();
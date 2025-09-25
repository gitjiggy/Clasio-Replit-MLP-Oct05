import { Octokit } from '@octokit/rest'
import fs from 'fs';

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

async function uploadMissingFiles() {
  try {
    const octokit = await getUncachableGitHubClient();
    const repoOwner = 'gitjiggy';
    const repoName = 'Clasio-Replit-MLP-Sep24';
    
    // List of critical files that MUST be in the repository
    const criticalFiles = [
      'README.md',
      'package.json',
      'package-lock.json', 
      'tsconfig.json',
      'drizzle.config.ts',
      'components.json',
      'postcss.config.js',
      'tailwind.config.ts',
      'vite.config.ts',
      'replit.md',
      'shared/schema.ts',
      'server/storage.ts',
      'server/routes.ts',
      'server/objectStorage.ts',
      'server/index.ts',
      'server/auth.ts',
      'server/db.ts',
      'server/gemini.ts',
      'server/aiQueueProcessor.ts',
      'server/driveService.ts',
      'server/objectAcl.ts',
      'server/rateLimit.ts',
      'server/vite.ts',
      'client/src/App.tsx',
      'client/src/main.tsx',
      'client/index.html',
      'migrations/0001_add_unique_active_version_constraint.sql'
    ];
    
    console.log('🔍 Uploading critical missing files...\n');
    
    let uploadedCount = 0;
    let failedCount = 0;
    
    // Upload critical files using retry logic
    for (const fileName of criticalFiles) {
      if (fs.existsSync(fileName)) {
        console.log(`📤 Processing ${fileName}...`);
        
        const success = await uploadFileWithRetry(octokit, repoOwner, repoName, fileName, fileName);
        if (success) {
          uploadedCount++;
        } else {
          failedCount++;
        }
      } else {
        console.log(`⚠️  File not found: ${fileName}`);
      }
    }
    
    console.log(`\n🎉 Critical Files Upload Summary:`);
    console.log(`✅ Successfully uploaded: ${uploadedCount} files`);
    console.log(`❌ Failed uploads: ${failedCount} files`);
    console.log(`\n🔗 Repository: https://github.com/gitjiggy/Clasio-Replit-MLP-Sep24`);
    
  } catch (error) {
    console.error('❌ Upload failed:', error.message);
    throw error;
  }
}

async function uploadDirectory(octokit, repoOwner, repoName, dirPath, basePath = '') {
  const items = fs.readdirSync(dirPath);
  
  for (const item of items) {
    const fullPath = `${dirPath}/${item}`;
    const relativePath = basePath ? `${basePath}/${item}` : `${dirPath}/${item}`;
    
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      await uploadDirectory(octokit, repoOwner, repoName, fullPath, relativePath);
    } else if (stat.isFile()) {
      try {
        const content = fs.readFileSync(fullPath);
        const base64Content = content.toString('base64');
        
        await octokit.rest.repos.createOrUpdateFileContents({
          owner: repoOwner,
          repo: repoName,
          path: relativePath,
          message: `Add ${relativePath}`,
          content: base64Content
        });
        
        console.log(`✅ ${relativePath}`);
      } catch (error) {
        console.log(`❌ Failed: ${relativePath} - ${error.message}`);
      }
    }
  }
}

async function main() {
  try {
    console.log('🚀 Fixing missing critical files in GitHub repository...\n');
    await uploadMissingFiles();
    console.log('\n🎉 CRITICAL FILES UPLOAD COMPLETE!');
    console.log('All essential project files should now be in the repository.');
  } catch (error) {
    console.error('💥 Upload failed:', error.message);
    process.exit(1);
  }
}

main();
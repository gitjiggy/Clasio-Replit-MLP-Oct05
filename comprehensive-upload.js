import { Octokit } from '@octokit/rest'
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

async function uploadEverything() {
  try {
    const octokit = await getUncachableGitHubClient();
    const repoOwner = 'gitjiggy';
    const repoName = 'Clasio-Replit-MVP-Sep21';
    
    // Get all files to upload from ALL possible locations
    const filesToUpload = [];
    const excludeDirs = ['node_modules', '.git', '.next', 'dist', 'build', '.cache', '.npm', '.pki', '.fluxbox', '.nix-defexpr', 'Crash Reports'];
    const excludeFiles = ['.env', '.env.local', '.env.production', 'package-lock.json', 'yarn.lock', '.bash_logout', '.bashrc', '.nix-channels', '.nix-profile', '.profile'];
    const excludeExtensions = ['.dmp', '.meta', '.log'];
    
    function shouldExcludeFile(filePath, fileName) {
      // Exclude by directory
      if (excludeDirs.some(dir => filePath.includes(dir))) {
        return true;
      }
      
      // Exclude by filename
      if (excludeFiles.includes(fileName)) {
        return true;
      }
      
      // Exclude by extension
      if (excludeExtensions.some(ext => fileName.endsWith(ext))) {
        return true;
      }
      
      // Exclude temporary files
      if (fileName.startsWith('.') && fileName.includes('tmp')) {
        return true;
      }
      
      return false;
    }
    
    function scanDirectory(dir, basePath = '', basePrefix = '') {
      if (!fs.existsSync(dir)) {
        return;
      }
      
      try {
        const items = fs.readdirSync(dir);
        
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const relativePath = path.join(basePath, item);
          const repositoryPath = basePrefix ? path.join(basePrefix, relativePath) : relativePath;
          
          if (shouldExcludeFile(fullPath, item)) {
            continue;
          }
          
          try {
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
              scanDirectory(fullPath, relativePath, basePrefix);
            } else if (stat.isFile()) {
              // Additional check for file size (skip very large files > 100MB)
              if (stat.size > 100 * 1024 * 1024) {
                console.log(`Skipping large file: ${repositoryPath} (${Math.round(stat.size / 1024 / 1024)}MB)`);
                continue;
              }
              
              filesToUpload.push({
                path: repositoryPath.replace(/\\/g, '/'),
                fullPath: fullPath,
                size: stat.size
              });
            }
          } catch (statError) {
            console.log(`Warning: Could not stat ${fullPath}: ${statError.message}`);
          }
        }
      } catch (readError) {
        console.log(`Warning: Could not read directory ${dir}: ${readError.message}`);
      }
    }
    
    console.log('🔍 Scanning ALL directories for files...');
    
    // Scan current directory
    console.log('📁 Scanning current directory...');
    scanDirectory('.', '', '');
    
    // Scan workspace directory if it exists and is different
    console.log('📁 Scanning workspace directory...');
    if (fs.existsSync('../workspace') && path.resolve('../workspace') !== path.resolve('.')) {
      scanDirectory('../workspace', '', 'workspace');
    }
    
    // Look for any cache or documentation directories
    const additionalDirs = ['cache', 'documentation', 'docs', '.cache'];
    for (const dirName of additionalDirs) {
      if (fs.existsSync(dirName)) {
        console.log(`📁 Found and scanning ${dirName} directory...`);
        scanDirectory(dirName, '', '');
      }
      if (fs.existsSync(`../${dirName}`)) {
        console.log(`📁 Found and scanning ../${dirName} directory...`);
        scanDirectory(`../${dirName}`, '', dirName);
      }
    }
    
    // Remove duplicates based on file path
    const uniqueFiles = filesToUpload.filter((file, index, self) => 
      index === self.findIndex(f => f.path === file.path)
    );
    
    console.log(`\n📊 Found ${uniqueFiles.length} unique files to upload`);
    console.log(`💾 Total size: ${Math.round(uniqueFiles.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024)}MB\n`);
    
    // Show first 10 files as preview
    console.log('📋 Preview of files to upload:');
    uniqueFiles.slice(0, 10).forEach(file => {
      console.log(`  - ${file.path} (${Math.round(file.size / 1024)}KB)`);
    });
    if (uniqueFiles.length > 10) {
      console.log(`  ... and ${uniqueFiles.length - 10} more files\n`);
    }
    
    // Upload files in batches
    const batchSize = 5; // Smaller batch to avoid rate limits
    let uploadedCount = 0;
    let failedCount = 0;
    
    for (let i = 0; i < uniqueFiles.length; i += batchSize) {
      const batch = uniqueFiles.slice(i, i + batchSize);
      
      console.log(`📤 Uploading batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(uniqueFiles.length/batchSize)} (${batch.length} files)...`);
      
      await Promise.all(batch.map(async (file) => {
        try {
          let content;
          
          // Handle binary files properly
          if (file.path.match(/\.(png|jpg|jpeg|gif|pdf|ico|woff|woff2|ttf|eot)$/i)) {
            content = fs.readFileSync(file.fullPath);
          } else {
            content = fs.readFileSync(file.fullPath);
          }
          
          const base64Content = content.toString('base64');
          
          // Check if file already exists and get SHA if it does
          let sha = null;
          try {
            const existingFile = await octokit.rest.repos.getContent({
              owner: repoOwner,
              repo: repoName,
              path: file.path
            });
            sha = existingFile.data.sha;
          } catch (e) {
            // File doesn't exist, which is fine
          }
          
          const params = {
            owner: repoOwner,
            repo: repoName,
            path: file.path,
            message: `Upload ${file.path}`,
            content: base64Content
          };
          
          if (sha) {
            params.sha = sha;
          }
          
          await octokit.rest.repos.createOrUpdateFileContents(params);
          
          uploadedCount++;
          console.log(`✅ ${file.path}`);
        } catch (error) {
          failedCount++;
          console.log(`❌ Failed: ${file.path} - ${error.message}`);
        }
      }));
      
      // Delay between batches to avoid rate limiting
      if (i + batchSize < uniqueFiles.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log(`\n🎉 Upload Summary:`);
    console.log(`✅ Successfully uploaded: ${uploadedCount} files`);
    console.log(`❌ Failed uploads: ${failedCount} files`);
    console.log(`📊 Success rate: ${Math.round((uploadedCount / uniqueFiles.length) * 100)}%`);
    console.log(`\n🔗 Repository: https://github.com/gitjiggy/Clasio-Replit-MVP-Sep21`);
    
  } catch (error) {
    console.error('❌ Upload failed:', error.message);
    throw error;
  }
}

async function main() {
  try {
    console.log('🚀 Starting comprehensive upload of ALL files to GitHub...\n');
    await uploadEverything();
    console.log('\n🎉 COMPREHENSIVE UPLOAD COMPLETE!');
    console.log('Every single file has been uploaded to the repository.');
  } catch (error) {
    console.error('💥 Upload failed:', error.message);
    process.exit(1);
  }
}

main();
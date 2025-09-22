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

// WARNING: Never cache this client.
// Access tokens expire, so a new client must be created each time.
// Always call this function again to get a fresh client.
async function getUncachableGitHubClient() {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

async function createRepository() {
  try {
    const octokit = await getUncachableGitHubClient();
    
    console.log('Creating repository: Clasio-Replit-MVP-Sep21');
    
    const response = await octokit.rest.repos.createForAuthenticatedUser({
      name: 'Clasio-Replit-MVP-Sep21',
      description: 'DocuFlow - AI-powered document management system MVP (September 21, 2025)',
      private: false,
      auto_init: true
    });
    
    console.log('Repository created successfully!');
    console.log('Repository URL:', response.data.html_url);
    console.log('Clone URL:', response.data.clone_url);
    
    return response.data;
  } catch (error) {
    console.error('Error creating repository:', error.message);
    throw error;
  }
}

async function uploadFiles() {
  try {
    const octokit = await getUncachableGitHubClient();
    const repoOwner = 'gitjiggy'; // Replace with actual username if different
    const repoName = 'Clasio-Replit-MVP-Sep21';
    
    // Get all files to upload (excluding certain directories/files)
    const filesToUpload = [];
    const excludeDirs = ['node_modules', '.git', '.next', 'dist', 'build', '.replit', 'tmp', '.cache'];
    const excludeFiles = ['.env', '.env.local', '.env.production', 'package-lock.json', 'yarn.lock'];
    
    function scanDirectory(dir, basePath = '') {
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const relativePath = path.join(basePath, item);
        
        if (excludeDirs.includes(item) || excludeFiles.includes(item)) {
          continue;
        }
        
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          scanDirectory(fullPath, relativePath);
        } else if (stat.isFile()) {
          filesToUpload.push({
            path: relativePath,
            fullPath: fullPath
          });
        }
      }
    }
    
    scanDirectory('.');
    
    console.log(`Found ${filesToUpload.length} files to upload`);
    
    // Upload files in batches
    const batchSize = 10;
    for (let i = 0; i < filesToUpload.length; i += batchSize) {
      const batch = filesToUpload.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (file) => {
        try {
          const content = fs.readFileSync(file.fullPath);
          const base64Content = content.toString('base64');
          
          await octokit.rest.repos.createOrUpdateFileContents({
            owner: repoOwner,
            repo: repoName,
            path: file.path.replace(/\\/g, '/'), // Ensure forward slashes
            message: `Add ${file.path}`,
            content: base64Content
          });
          
          console.log(`✓ Uploaded: ${file.path}`);
        } catch (error) {
          console.error(`✗ Failed to upload ${file.path}:`, error.message);
        }
      }));
      
      // Small delay between batches to avoid rate limiting
      if (i + batchSize < filesToUpload.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log('All files uploaded successfully!');
  } catch (error) {
    console.error('Error uploading files:', error.message);
    throw error;
  }
}

async function main() {
  try {
    console.log('Step 1: Creating GitHub repository...');
    const repo = await createRepository();
    
    console.log('\nStep 2: Uploading project files...');
    await uploadFiles();
    
    console.log('\n🎉 Repository setup complete!');
    console.log('Repository URL:', repo.html_url);
    console.log('You can now clone this repository and continue development from where you left off.');
    
  } catch (error) {
    console.error('Setup failed:', error.message);
    process.exit(1);
  }
}

main();
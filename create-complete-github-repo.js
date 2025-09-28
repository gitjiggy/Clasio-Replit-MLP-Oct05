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

// Essential files and directories to include
const includePatterns = [
  // Core project files
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'tailwind.config.ts',
  'postcss.config.js',
  'components.json',
  'drizzle.config.ts',
  
  // Source code directories
  'client/',
  'server/',
  'shared/',
  
  // Database and migrations
  'migrations/',
  
  // Documentation
  'replit.md',
  
  // Configuration
  '.gitignore'
];

// Files and patterns to exclude
const excludePatterns = [
  'node_modules/',
  'logs/',
  'attached_assets/',
  '*.log',
  '*.png',
  '*.tar.gz',
  'test/',
  'gz',
  '*.js', // Exclude temporary JS files, but we'll handle specific inclusions
  'worker_test.log',
  'tmp/',
  '.replit',
  '.upm/',
  '.breakpoints',
  'replit.nix'
];

function shouldIncludeFile(filePath) {
  // Check if file matches exclude patterns
  for (const pattern of excludePatterns) {
    if (pattern.endsWith('/')) {
      if (filePath.startsWith(pattern)) return false;
    } else if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      if (regex.test(filePath)) return false;
    } else if (filePath === pattern || filePath.endsWith(pattern)) {
      return false;
    }
  }
  
  // Check if file matches include patterns
  for (const pattern of includePatterns) {
    if (pattern.endsWith('/')) {
      if (filePath.startsWith(pattern)) return true;
    } else if (filePath === pattern) {
      return true;
    }
  }
  
  return false;
}

function getAllFiles(dir, baseDir = dir) {
  const files = [];
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    if (item.startsWith('.') && item !== '.gitignore') continue;
    
    const fullPath = path.join(dir, item);
    const relativePath = path.relative(baseDir, fullPath);
    
    if (fs.statSync(fullPath).isDirectory()) {
      files.push(...getAllFiles(fullPath, baseDir));
    } else {
      if (shouldIncludeFile(relativePath)) {
        files.push(relativePath);
      }
    }
  }
  
  return files;
}

async function createRepository() {
  const github = await getUncachableGitHubClient();
  
  console.log('Creating repository Clasio-Replit-MLP-Sep27...');
  
  try {
    const repo = await github.repos.createInOrg({
      org: 'gitjiggy',
      name: 'Clasio-Replit-MLP-Sep27',
      description: 'Clasio Document Management System - Multi-tenant Production Release (Sep 27, 2025)',
      private: false,
      auto_init: true
    });
    
    console.log('Repository created successfully:', repo.data.html_url);
    return repo.data;
  } catch (error) {
    if (error.status === 422) {
      console.log('Repository may already exist, continuing...');
      const existingRepo = await github.repos.get({
        owner: 'gitjiggy',
        repo: 'Clasio-Replit-MLP-Sep27'
      });
      return existingRepo.data;
    }
    throw error;
  }
}

async function uploadFiles() {
  const github = await getUncachableGitHubClient();
  const files = getAllFiles('.');
  
  console.log(`Found ${files.length} files to upload:`, files);
  
  // Get the default branch reference
  const { data: ref } = await github.git.getRef({
    owner: 'gitjiggy',
    repo: 'Clasio-Replit-MLP-Sep27',
    ref: 'heads/main'
  });
  
  const parentCommitSha = ref.object.sha;
  
  // Create tree entries for all files
  const tree = [];
  
  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath);
      const { data: blob } = await github.git.createBlob({
        owner: 'gitjiggy',
        repo: 'Clasio-Replit-MLP-Sep27',
        content: content.toString('base64'),
        encoding: 'base64'
      });
      
      tree.push({
        path: filePath,
        mode: '100644',
        type: 'blob',
        sha: blob.sha
      });
      
      console.log(`✓ Processed: ${filePath}`);
    } catch (error) {
      console.error(`✗ Failed to process ${filePath}:`, error.message);
    }
  }
  
  // Create tree
  const { data: newTree } = await github.git.createTree({
    owner: 'gitjiggy',
    repo: 'Clasio-Replit-MLP-Sep27',
    tree,
    base_tree: parentCommitSha
  });
  
  // Create commit
  const { data: commit } = await github.git.createCommit({
    owner: 'gitjiggy',
    repo: 'Clasio-Replit-MLP-Sep27',
    message: 'Initial upload: Complete Clasio codebase for Sep 27 MLP release',
    tree: newTree.sha,
    parents: [parentCommitSha]
  });
  
  // Update reference
  await github.git.updateRef({
    owner: 'gitjiggy',
    repo: 'Clasio-Replit-MLP-Sep27',
    ref: 'heads/main',
    sha: commit.sha
  });
  
  console.log(`✓ Successfully uploaded ${files.length} files!`);
  return files;
}

async function main() {
  try {
    console.log('Starting complete repository setup...');
    
    // Create repository
    const repo = await createRepository();
    
    // Upload all files
    const uploadedFiles = await uploadFiles();
    
    console.log('Repository setup complete!');
    console.log('Repository URL:', repo.html_url);
    console.log('Files uploaded:', uploadedFiles.length);
    
    return {
      success: true,
      repo: repo,
      filesUploaded: uploadedFiles.length,
      files: uploadedFiles
    };
    
  } catch (error) {
    console.error('Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

main().then(result => {
  console.log('Final result:', JSON.stringify(result, null, 2));
});
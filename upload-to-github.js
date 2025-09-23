import { Octokit } from '@octokit/rest'
import fs from 'fs/promises'
import path from 'path'
import { execSync } from 'child_process'

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

async function getAllFiles(dir = '.', baseDir = '.') {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);
    
    // Skip git directory, node_modules, cache files, and other system files
    if (entry.name.startsWith('.git') || 
        entry.name === 'node_modules' || 
        entry.name === 'dist' ||
        entry.name === 'build' ||
        entry.name === '.cache' ||
        entry.name === '.upm' ||
        entry.name.includes('.lock') ||
        entry.name === 'upload-to-github.js' ||
        relativePath.includes('/.cache/') ||
        relativePath.includes('/.upm/') ||
        relativePath.includes('/node_modules/') ||
        relativePath.endsWith('.lock')) {
      continue;
    }
    
    if (entry.isDirectory()) {
      const subFiles = await getAllFiles(fullPath, baseDir);
      files.push(...subFiles);
    } else {
      try {
        const content = await fs.readFile(fullPath, 'utf8');
        files.push({
          path: relativePath.replace(/\\/g, '/'), // Normalize path separators
          content: content
        });
      } catch (error) {
        // Skip binary files or files that can't be read as text
        console.log(`Skipping binary file: ${relativePath}`);
      }
    }
  }
  
  return files;
}

async function createRepositoryAndUpload() {
  try {
    console.log('🔧 Getting GitHub client...');
    const github = await getUncachableGitHubClient();
    
    console.log('📁 Creating new repository...');
    const timestamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const repoName = `Clasio-Replit-MVP-Sep22-${timestamp}`;
    
    // Create the repository with auto initialization
    const { data: repo } = await github.rest.repos.createForAuthenticatedUser({
      name: repoName,
      description: 'Document management system with AI-powered search capabilities - MVP built on Replit',
      private: false, // Set to true if you want it private
      auto_init: true // Initialize with README to avoid empty repo issue
    });
    
    console.log(`✅ Repository created: ${repo.html_url}`);
    
    console.log('📂 Getting all project files...');
    const files = await getAllFiles();
    console.log(`Found ${files.length} files to upload`);
    
    // Create blobs for all files
    console.log('📤 Creating file blobs...');
    const tree = [];
    
    for (const file of files) {
      console.log(`Processing: ${file.path}`);
      
      const { data: blob } = await github.rest.git.createBlob({
        owner: 'gitjiggy',
        repo: repoName,
        content: Buffer.from(file.content).toString('base64'),
        encoding: 'base64'
      });
      
      tree.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha
      });
    }
    
    // Get the current main branch reference
    console.log('🔍 Getting current main branch...');
    const { data: ref } = await github.rest.git.getRef({
      owner: 'gitjiggy',
      repo: repoName,
      ref: 'heads/main'
    });
    
    console.log('🌳 Creating tree...');
    const { data: treeData } = await github.rest.git.createTree({
      owner: 'gitjiggy',
      repo: repoName,
      tree: tree
    });
    
    console.log('💾 Creating commit...');
    const { data: commit } = await github.rest.git.createCommit({
      owner: 'gitjiggy',
      repo: repoName,
      message: 'Complete Clasio document management MVP with AI search capabilities',
      tree: treeData.sha,
      parents: [ref.object.sha] // Base on current main branch
    });
    
    console.log('🔗 Updating main branch...');
    await github.rest.git.updateRef({
      owner: 'gitjiggy',
      repo: repoName,
      ref: 'heads/main',
      sha: commit.sha
    });
    
    console.log('🎉 Successfully uploaded all files to GitHub!');
    console.log(`🔗 Repository URL: ${repo.html_url}`);
    console.log(`📊 Total files uploaded: ${files.length}`);
    
    return repo;
    
  } catch (error) {
    console.error('❌ Error uploading to GitHub:', error);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
}

// Run the upload
createRepositoryAndUpload()
  .then((repo) => {
    console.log('\n✅ Upload completed successfully!');
    console.log(`Visit your new repository: ${repo.html_url}`);
  })
  .catch((error) => {
    console.error('\n❌ Upload failed:', error.message);
    process.exit(1);
  });
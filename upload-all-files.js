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

// Essential files and directories to include - comprehensive list
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
  
  // Source code directories (all files within these)
  'client/src/',
  'client/index.html',
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
  'test/',
  '*.log',
  '*.png',
  '*.tar.gz',
  'gz',
  'worker_test.log',
  'tmp/',
  '.replit',
  '.upm/',
  '.breakpoints',
  'replit.nix',
  // Exclude all the temporary JS files
  'check-client-structure.js',
  'check-github-repo.js',
  'check-repo-structure.js',
  'commit-latest-changes.js',
  'complete-github-upload.js',
  'complete-repository-upload.js',
  'comprehensive-upload.js',
  'create-and-upload-github.js',
  'create-clasio-repo.js',
  'create-github-repo.js',
  'definitive-complete-upload.js',
  'final-github-upload.js',
  'fix-missing-files.js',
  'smart-github-upload.js',
  'targeted-github-upload.js',
  'thorough-repository-audit.js',
  'upload-to-github.js',
  'verify-repository-complete.js',
  'create-complete-github-repo.js',
  'check-github-permissions.js',
  'upload-all-files.js'
];

function shouldIncludeFile(filePath) {
  // Normalize path separators
  const normalizedPath = filePath.replace(/\\/g, '/');
  
  // Check if file matches exclude patterns first
  for (const pattern of excludePatterns) {
    if (pattern.endsWith('/')) {
      if (normalizedPath.startsWith(pattern)) return false;
    } else if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      if (regex.test(normalizedPath)) return false;
    } else if (normalizedPath === pattern || normalizedPath.endsWith('/' + pattern) || normalizedPath === pattern) {
      return false;
    }
  }
  
  // Check if file matches include patterns
  for (const pattern of includePatterns) {
    if (pattern.endsWith('/')) {
      if (normalizedPath.startsWith(pattern)) return true;
    } else if (normalizedPath === pattern) {
      return true;
    }
  }
  
  return false;
}

function getAllFiles(dir, baseDir = dir) {
  const files = [];
  
  try {
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      if (item.startsWith('.') && item !== '.gitignore') continue;
      
      const fullPath = path.join(dir, item);
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      
      try {
        if (fs.statSync(fullPath).isDirectory()) {
          files.push(...getAllFiles(fullPath, baseDir));
        } else {
          if (shouldIncludeFile(relativePath)) {
            files.push(relativePath);
          }
        }
      } catch (error) {
        console.log(`Skipping ${fullPath}: ${error.message}`);
      }
    }
  } catch (error) {
    console.log(`Cannot read directory ${dir}: ${error.message}`);
  }
  
  return files;
}

async function uploadFiles() {
  const github = await getUncachableGitHubClient();
  const files = getAllFiles('.');
  
  console.log(`Found ${files.length} files to upload:`);
  files.forEach(file => console.log(`  - ${file}`));
  
  if (files.length === 0) {
    console.log('No files to upload!');
    return [];
  }
  
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
      const fullPath = path.resolve(filePath);
      if (!fs.existsSync(fullPath)) {
        console.log(`⚠️  File does not exist: ${filePath}`);
        continue;
      }
      
      const content = fs.readFileSync(fullPath);
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
      
      console.log(`✓ Processed: ${filePath} (${content.length} bytes)`);
    } catch (error) {
      console.error(`✗ Failed to process ${filePath}:`, error.message);
    }
  }
  
  if (tree.length === 0) {
    console.log('No files were successfully processed!');
    return [];
  }
  
  // Create tree
  console.log(`Creating tree with ${tree.length} files...`);
  const { data: newTree } = await github.git.createTree({
    owner: 'gitjiggy',
    repo: 'Clasio-Replit-MLP-Sep27',
    tree,
    base_tree: parentCommitSha
  });
  
  // Create commit
  console.log('Creating commit...');
  const { data: commit } = await github.git.createCommit({
    owner: 'gitjiggy',
    repo: 'Clasio-Replit-MLP-Sep27',
    message: 'Upload complete Clasio codebase for Sep 27 MLP release\n\nIncludes:\n- Full-stack TypeScript application\n- React frontend with Vite\n- Express backend with advanced features\n- Multi-tenant architecture\n- AI-powered document analysis\n- Google Drive integration\n- Advanced search capabilities\n- Production-ready configurations',
    tree: newTree.sha,
    parents: [parentCommitSha]
  });
  
  // Update reference
  console.log('Updating main branch...');
  await github.git.updateRef({
    owner: 'gitjiggy',
    repo: 'Clasio-Replit-MLP-Sep27',
    ref: 'heads/main',
    sha: commit.sha
  });
  
  console.log(`✓ Successfully uploaded ${tree.length} files!`);
  return files;
}

async function main() {
  try {
    console.log('Starting file upload to Clasio-Replit-MLP-Sep27...');
    
    // Upload all files
    const uploadedFiles = await uploadFiles();
    
    console.log('\n=== UPLOAD COMPLETE ===');
    console.log('Repository: https://github.com/gitjiggy/Clasio-Replit-MLP-Sep27');
    console.log('Files uploaded:', uploadedFiles.length);
    console.log('\nUploaded files:');
    uploadedFiles.forEach(file => console.log(`  ✓ ${file}`));
    
    return {
      success: true,
      repo: 'https://github.com/gitjiggy/Clasio-Replit-MLP-Sep27',
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
  console.log('\nFinal result:', JSON.stringify(result, null, 2));
});
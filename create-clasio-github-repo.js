import { Octokit } from '@octokit/rest';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// GitHub integration auth
let connectionSettings;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
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

async function getGitHubClient() {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

// Get all files recursively
async function getAllFiles(dir, baseDir = dir) {
  const files = [];
  const items = await fs.readdir(dir, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    const relativePath = path.relative(baseDir, fullPath);
    
    // Skip directories and files to exclude
    const excludePatterns = [
      'node_modules',
      '.git',
      'dist',
      '.replit',
      'tmp',
      'logs',
      'attached_assets',
      'project-backup.tar.gz',
      '.log',
      '.png',
      '.jpg',
      '.jpeg',
      'create-',
      'upload-',
      'check-',
      'complete-',
      'fix-',
      'smart-',
      'targeted-',
      'thorough-',
      'verify-',
      'comprehensive-',
      'definitive-',
      'final-',
      'test-',
      'worker_test.log',
      'gz'
    ];
    
    const shouldExclude = excludePatterns.some(pattern => {
      if (pattern.startsWith('.')) {
        return item.name.endsWith(pattern) || item.name === pattern;
      }
      return item.name.includes(pattern) || relativePath.includes(pattern);
    });
    
    if (shouldExclude) {
      continue;
    }
    
    if (item.isDirectory()) {
      const subFiles = await getAllFiles(fullPath, baseDir);
      files.push(...subFiles);
    } else {
      files.push(relativePath);
    }
  }
  
  return files;
}

// Upload files to GitHub
async function uploadFiles(octokit, owner, repo, files) {
  console.log(`\nUploading ${files.length} files to ${owner}/${repo}...\n`);
  
  let uploaded = 0;
  let failed = 0;
  
  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf8');
      const encodedContent = Buffer.from(content).toString('base64');
      
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: file,
        message: `Add ${file}`,
        content: encodedContent,
        committer: {
          name: 'Replit Agent',
          email: 'agent@replit.com'
        },
        author: {
          name: 'Replit Agent',
          email: 'agent@replit.com'
        }
      });
      
      uploaded++;
      if (uploaded % 10 === 0) {
        console.log(`Uploaded ${uploaded}/${files.length} files...`);
      }
    } catch (error) {
      console.error(`Failed to upload ${file}:`, error.message);
      failed++;
    }
  }
  
  console.log(`\n✅ Upload complete: ${uploaded} succeeded, ${failed} failed`);
}

async function main() {
  try {
    console.log('🚀 Creating Clasio-Replit-MLP-Sep28 repository...\n');
    
    const octokit = await getGitHubClient();
    const repo = 'Clasio-Replit-MLP-Sep28';
    
    // Get authenticated user
    const { data: user } = await octokit.users.getAuthenticated();
    const owner = user.login;
    console.log(`Authenticated as: ${owner}\n`);
    
    // Check if repo exists
    let repoExists = false;
    try {
      await octokit.repos.get({ owner, repo });
      repoExists = true;
      console.log(`ℹ️  Repository ${owner}/${repo} already exists`);
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }
    }
    
    // Create repository if it doesn't exist
    if (!repoExists) {
      console.log(`Creating repository ${owner}/${repo}...`);
      
      await octokit.repos.createForAuthenticatedUser({
        name: repo,
        description: 'Clasio - Modern Document Management System with AI-powered analysis and Google Drive integration',
        private: false,
        auto_init: false
      });
      
      console.log('✅ Repository created successfully\n');
    }
    
    // Get all project files
    console.log('📁 Scanning project files...');
    const allFiles = await getAllFiles('.');
    
    // Essential files that must be included
    const essentialFiles = [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'vite.config.ts',
      'tailwind.config.ts',
      'drizzle.config.ts',
      'postcss.config.js',
      'components.json',
      'README.md',
      'replit.md'
    ];
    
    // Filter files to upload
    const filesToUpload = allFiles.filter(file => {
      // Include all essential files
      if (essentialFiles.includes(file)) return true;
      
      // Include all files in critical directories
      const criticalDirs = ['client/', 'server/', 'shared/', 'migrations/'];
      if (criticalDirs.some(dir => file.startsWith(dir))) return true;
      
      return false;
    });
    
    console.log(`Found ${filesToUpload.length} files to upload\n`);
    
    // Upload files
    await uploadFiles(octokit, owner, repo, filesToUpload);
    
    console.log(`\n✅ Repository setup complete!`);
    console.log(`🔗 View at: https://github.com/${owner}/${repo}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();

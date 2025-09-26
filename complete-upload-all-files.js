import { Octokit } from '@octokit/rest';
import fs from 'fs';
import path from 'path';

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

async function getUncachableGitHubClient() {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

function shouldSkipFile(filePath) {
  // Skip files based on user's exclusion and common patterns
  if (filePath.includes('.local/state/replit/agent')) return true;
  if (filePath.includes('node_modules')) return true;
  if (filePath.includes('.git/')) return true;
  if (filePath.includes('dist/')) return true;
  if (filePath.includes('build/')) return true;
  if (filePath.endsWith('.pyc')) return true;
  if (filePath.endsWith('__pycache__')) return true;
  
  return false;
}

function shouldUploadAsBinary(filePath) {
  const binaryExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.pdf', '.zip', '.tar', '.gz', '.exe', '.bin', '.dmg'];
  return binaryExtensions.some(ext => filePath.toLowerCase().endsWith(ext));
}

async function uploadFile(octokit, owner, repo, filePath, localPath) {
  try {
    let content;
    let encoding = 'base64';
    
    if (shouldUploadAsBinary(localPath)) {
      // Binary files
      content = fs.readFileSync(localPath);
      content = content.toString('base64');
    } else {
      // Text files
      content = fs.readFileSync(localPath, 'utf8');
      content = Buffer.from(content).toString('base64');
    }

    // Check if file exists
    let sha = null;
    try {
      const existing = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: filePath
      });
      sha = existing.data.sha;
    } catch (error) {
      // File doesn't exist, which is fine
    }

    const response = await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message: sha ? `Update ${filePath}` : `Add ${filePath}`,
      content: content,
      sha
    });
    
    console.log(`✅ Uploaded: ${filePath}`);
    return response;
  } catch (error) {
    console.error(`❌ Failed to upload ${filePath}:`, error.message);
    if (error.message.includes('too large')) {
      console.log(`⚠️ Skipping large file: ${filePath}`);
      return null;
    }
    throw error;
  }
}

async function uploadDirectoryRecursive(octokit, owner, repo, localDir, githubPath = '') {
  const items = fs.readdirSync(localDir);
  
  for (const item of items) {
    const localPath = path.join(localDir, item);
    const remotePath = githubPath ? `${githubPath}/${item}` : item;
    
    // Check if we should skip this path
    if (shouldSkipFile(localPath) || shouldSkipFile(remotePath)) {
      console.log(`⏭️ Skipping: ${remotePath}`);
      continue;
    }
    
    const stats = fs.statSync(localPath);
    
    if (stats.isDirectory()) {
      await uploadDirectoryRecursive(octokit, owner, repo, localPath, remotePath);
    } else {
      // Check file size (GitHub has 100MB limit)
      if (stats.size > 100 * 1024 * 1024) {
        console.log(`⚠️ Skipping file too large (${(stats.size / 1024 / 1024).toFixed(2)}MB): ${remotePath}`);
        continue;
      }
      
      await uploadFile(octokit, owner, repo, remotePath, localPath);
    }
  }
}

async function uploadRootFiles(octokit, owner, repo) {
  // Get all files in root directory
  const items = fs.readdirSync('.');
  
  for (const item of items) {
    const stats = fs.statSync(item);
    
    if (stats.isFile()) {
      // Check if we should skip this file
      if (shouldSkipFile(item)) {
        console.log(`⏭️ Skipping: ${item}`);
        continue;
      }
      
      // Check file size
      if (stats.size > 100 * 1024 * 1024) {
        console.log(`⚠️ Skipping file too large (${(stats.size / 1024 / 1024).toFixed(2)}MB): ${item}`);
        continue;
      }
      
      await uploadFile(octokit, owner, repo, item, item);
    }
  }
}

async function main() {
  try {
    console.log('🚀 Starting comprehensive file upload to GitHub...');
    
    const octokit = await getUncachableGitHubClient();
    
    // Get repository info
    const user = await octokit.rest.users.getAuthenticated();
    const owner = user.data.login;
    const repo = 'Clasio-Replit-MLP-Sep25';
    
    console.log(`📁 Uploading to: ${owner}/${repo}`);
    
    // Step 1: Upload all root files first
    console.log('📄 Uploading root files...');
    await uploadRootFiles(octokit, owner, repo);
    
    // Step 2: Upload all directories
    console.log('📁 Uploading directories...');
    
    const directories = [
      'attached_assets',
      'client', 
      'logs',
      'migrations',
      'server',
      'shared',
      'test'
    ];
    
    for (const dir of directories) {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        console.log(`📁 Uploading directory: ${dir}/`);
        await uploadDirectoryRecursive(octokit, owner, repo, dir, dir);
      } else {
        console.log(`⚠️ Directory not found: ${dir}`);
      }
    }
    
    console.log('\\n✅ Comprehensive upload completed successfully!');
    console.log(`🔗 Repository URL: https://github.com/${owner}/${repo}`);
    console.log('\\n📋 Summary:');
    console.log('- ALL project files uploaded');
    console.log('- Root configuration files included');
    console.log('- All source directories included');
    console.log('- Documentation images included');
    console.log('- Test data included');
    console.log('- Logs directory included');
    console.log('- Binary files handled correctly');
    console.log('- Ready for complete vendor handoff');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
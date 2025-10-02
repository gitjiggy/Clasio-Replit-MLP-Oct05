import { Octokit } from '@octokit/rest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

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

// Files/directories to exclude
const EXCLUDE_PATTERNS = [
  '.git',
  'node_modules',
  '.env',
  '.env.local',
  'dist',
  'build',
  '.next',
  'logs',
  'tmp',
  '.replit',
  '.upm',
  '.breakpoints',
  'replit.nix',
  '.DS_Store',
  '*.tar.gz',
  '*.log',
  'server/public',
  // Exclude all the upload scripts
  'check-client-structure.js',
  'check-github-permissions.js',
  'check-github-repo.js',
  'check-repo-structure.js',
  'commit-latest-changes.js',
  'complete-github-upload.js',
  'complete-repository-upload.js',
  'comprehensive-upload.js',
  'create-and-upload-github.js',
  'create-clasio-repo.js',
  'create-complete-github-repo.js',
  'create-github-repo.js',
  'definitive-complete-upload.js',
  'final-github-upload.js',
  'fix-missing-files.js',
  'smart-github-upload.js',
  'targeted-github-upload.js',
  'thorough-repository-audit.js',
  'upload-all-files.js',
  'upload-readme.js',
  'upload-to-github.js',
  'verify-repository-complete.js',
  'create-oct01-repo.js',
  // Exclude test/debug files
  'test-duplicate.txt',
  'worker_test.log',
  'gz',
  // Exclude screenshots
  '*.png',
  'project-backup.tar.gz'
];

function shouldExclude(filePath) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return EXCLUDE_PATTERNS.some(pattern => {
    if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      return regex.test(normalizedPath);
    }
    return normalizedPath.includes(pattern);
  });
}

function getAllFiles(dir, baseDir = dir) {
  const files = [];
  const items = readdirSync(dir);

  for (const item of items) {
    const fullPath = join(dir, item);
    const relativePath = relative(baseDir, fullPath);

    if (shouldExclude(relativePath)) {
      continue;
    }

    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getAllFiles(fullPath, baseDir));
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

async function createRepository(octokit, owner, repoName) {
  try {
    console.log(`Creating repository ${owner}/${repoName}...`);
    
    // Try creating as user repo first
    try {
      const { data } = await octokit.repos.createForAuthenticatedUser({
        name: repoName,
        description: 'Clasio - AI-Powered Document Management System (MLP Oct 01, 2025)',
        private: false,
        auto_init: false
      });
      console.log(`✅ Repository created: ${data.html_url}`);
      return data;
    } catch (userError) {
      // If that fails, try as org
      if (userError.status === 404 || userError.status === 403) {
        const { data } = await octokit.repos.createInOrg({
          org: owner,
          name: repoName,
          description: 'Clasio - AI-Powered Document Management System (MLP Oct 01, 2025)',
          private: false,
          auto_init: false
        });
        console.log(`✅ Repository created: ${data.html_url}`);
        return data;
      }
      throw userError;
    }
  } catch (error) {
    if (error.status === 422) {
      console.log('Repository already exists, using existing repo...');
      const { data } = await octokit.repos.get({
        owner,
        repo: repoName
      });
      return data;
    }
    throw error;
  }
}

async function uploadFilesToRepo(octokit, owner, repo, files) {
  console.log(`\nUploading ${files.length} files to ${owner}/${repo}...`);
  
  let uploaded = 0;
  let skipped = 0;
  
  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const contentBase64 = Buffer.from(content).toString('base64');
      
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: file,
        message: `Add ${file}`,
        content: contentBase64
      });
      
      uploaded++;
      if (uploaded % 10 === 0) {
        console.log(`  Uploaded ${uploaded}/${files.length} files...`);
      }
    } catch (error) {
      console.error(`  ❌ Failed to upload ${file}:`, error.message);
      skipped++;
    }
  }
  
  console.log(`\n✅ Upload complete: ${uploaded} files uploaded, ${skipped} skipped`);
}

async function main() {
  try {
    const octokit = await getUncachableGitHubClient();
    const owner = 'gitjiggy';
    const repoName = 'Clasio-Replit-MLP-Oct01';

    // Create repository
    await createRepository(octokit, owner, repoName);

    // Get all files
    console.log('\nGathering files...');
    const files = getAllFiles('.');
    console.log(`Found ${files.length} files to upload`);

    // Upload files
    await uploadFilesToRepo(octokit, owner, repoName, files);

    console.log(`\n🎉 Repository ready: https://github.com/${owner}/${repoName}`);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();

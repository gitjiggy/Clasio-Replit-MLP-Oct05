import { Octokit } from '@octokit/rest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
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

const EXCLUDE_PATTERNS = [
  '.git',
  'node_modules',
  '.env',
  '.env.local',
  '.env.production',
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
  '*.js', // Exclude all upload scripts  
  'attached_assets',
  'project-backup.tar.gz',
  '.config',
  '.cache',
  '.local',
  'gz',
  '*.png', // Exclude screenshots
  'test/',
  '.github/'
];

function shouldExclude(filePath) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  
  // Always include essential files even if they match exclude patterns
  const essentialFiles = ['package.json', 'tsconfig.json', 'package-lock.json'];
  if (essentialFiles.some(f => normalizedPath.endsWith(f))) {
    return false;
  }
  
  return EXCLUDE_PATTERNS.some(pattern => {
    if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      return regex.test(normalizedPath);
    }
    return normalizedPath.includes(pattern);
  });
}

function collectFiles(dir, baseDir = dir) {
  let files = [];
  const items = readdirSync(dir);

  for (const item of items) {
    const fullPath = join(dir, item);
    const relativePath = relative(baseDir, fullPath);

    if (shouldExclude(relativePath)) {
      continue;
    }

    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files = files.concat(collectFiles(fullPath, baseDir));
    } else {
      files.push({ path: relativePath, fullPath });
    }
  }

  return files;
}

async function uploadFile(octokit, owner, repo, filePath, content) {
  try {
    const contentBase64 = Buffer.from(content).toString('base64');
    
    // Try to get existing file SHA for updates
    let sha;
    try {
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path: filePath
      });
      sha = data.sha;
    } catch (e) {
      // File doesn't exist, that's fine
    }
    
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message: `Add ${filePath}`,
      content: contentBase64,
      ...(sha && { sha })
    });
    
    return true;
  } catch (error) {
    console.error(`  ❌ Failed: ${filePath} - ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Creating Clasio-Replit-MLP-Oct04 repository...\n');
  
  const octokit = await getUncachableGitHubClient();
  const repoName = 'Clasio-Replit-MLP-Oct04';
  
  // Get authenticated user
  const { data: user } = await octokit.users.getAuthenticated();
  const owner = user.login;
  console.log(`📝 Authenticated as: ${owner}\n`);
  
  // Create repository
  console.log('📦 Creating repository...');
  try {
    const { data: repo } = await octokit.repos.createForAuthenticatedUser({
      name: repoName,
      description: 'AI-powered document management system with mobile-first design - Oct 04, 2025 mobile viewport optimization',
      private: false,
      auto_init: true
    });
    console.log(`✅ Repository created: ${repo.html_url}\n`);
  } catch (error) {
    if (error.message.includes('already exists')) {
      console.log('⚠️  Repository already exists, proceeding with upload...\n');
    } else {
      throw error;
    }
  }

  // Wait for repo initialization
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Collect all files
  console.log('📂 Collecting files to upload...');
  const files = collectFiles('.');
  console.log(`Found ${files.length} files to upload\n`);

  // Priority upload order
  const priorityFiles = [
    'README.md',
    'replit.md',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'drizzle.config.ts',
    'tailwind.config.ts',
    'postcss.config.js',
    'components.json',
    '.gitignore'
  ];

  const regularFiles = files.filter(f => 
    !priorityFiles.includes(f.path)
  );

  const orderedFiles = [
    ...files.filter(f => priorityFiles.includes(f.path)),
    ...regularFiles
  ];

  // Upload files
  console.log('📤 Uploading files...\n');
  let uploaded = 0;
  let failed = 0;

  for (const file of orderedFiles) {
    try {
      const content = readFileSync(file.fullPath);
      const success = await uploadFile(octokit, owner, repoName, file.path, content);
      
      if (success) {
        uploaded++;
        console.log(`  ✅ ${file.path}`);
      } else {
        failed++;
      }
      
      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`  ❌ ${file.path}: ${error.message}`);
      failed++;
    }
  }

  console.log(`\n📊 Upload Summary:`);
  console.log(`  ✅ Uploaded: ${uploaded} files`);
  console.log(`  ❌ Failed: ${failed} files`);
  console.log(`\n🎉 Repository ready: https://github.com/${owner}/${repoName}`);
}

main().catch(console.error);

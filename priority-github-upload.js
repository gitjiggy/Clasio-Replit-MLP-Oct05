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
  '*.png',
  'attached_assets',
  'project-backup.tar.gz'
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

function getAllFilesInDirectory(dir, baseDir = dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  
  const items = readdirSync(dir);

  for (const item of items) {
    const fullPath = join(dir, item);
    const relativePath = relative(baseDir, fullPath);

    if (shouldExclude(relativePath)) {
      continue;
    }

    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getAllFilesInDirectory(fullPath, baseDir));
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

async function uploadFile(octokit, owner, repo, filePath, localPath) {
  try {
    const content = readFileSync(localPath, 'utf-8');
    const contentBase64 = Buffer.from(content).toString('base64');
    
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message: `Add ${filePath}`,
      content: contentBase64
    });
    return { success: true, file: filePath };
  } catch (error) {
    return { success: false, file: filePath, error: error.message };
  }
}

async function uploadBatch(octokit, owner, repo, files, batchName, baseDir = '.') {
  console.log(`\n📦 Uploading ${batchName} (${files.length} files)...`);
  let uploaded = 0;
  let failed = 0;

  for (const file of files) {
    const localPath = join(baseDir, file);
    const result = await uploadFile(octokit, owner, repo, file, localPath);
    if (result.success) {
      uploaded++;
      if (uploaded % 5 === 0) {
        console.log(`  ✓ ${uploaded}/${files.length} uploaded...`);
      }
    } else {
      failed++;
      console.log(`  ✗ Failed: ${file} - ${result.error}`);
    }
  }
  
  console.log(`✅ ${batchName} complete: ${uploaded} uploaded, ${failed} failed`);
  return { uploaded, failed };
}

async function main() {
  try {
    const octokit = await getUncachableGitHubClient();
    const owner = 'gitjiggy';
    const repoName = 'Clasio-Replit-MLP-Oct02';

    console.log(`🚀 Starting priority upload to ${owner}/${repoName}\n`);

    // Priority 1: Essential config files
    const essentialFiles = [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'README.md',
      'replit.md'
    ].filter(f => existsSync(f));

    await uploadBatch(octokit, owner, repoName, essentialFiles, 'Essential Config Files');

    // Priority 2: Essential folders
    const essentialFolders = [
      { name: 'server', path: 'server' },
      { name: 'client', path: 'client' },
      { name: 'shared', path: 'shared' },
      { name: 'migrations', path: 'migrations' }
    ];
    
    for (const folder of essentialFolders) {
      const files = getAllFilesInDirectory(folder.path);
      if (files.length > 0) {
        // For folder files, we need to pass the folder name and the relative files
        const folderFiles = files.map(f => join(folder.path, f));
        await uploadBatch(octokit, owner, repoName, folderFiles, `${folder.name}/ directory`, '.');
      }
    }

    // Priority 3: Remaining root files
    const rootFiles = readdirSync('.').filter(item => {
      const stat = statSync(item);
      return stat.isFile() && !shouldExclude(item) && !essentialFiles.includes(item);
    });

    if (rootFiles.length > 0) {
      await uploadBatch(octokit, owner, repoName, rootFiles, 'Remaining root files');
    }

    console.log(`\n🎉 Priority upload complete!`);
    console.log(`📍 Repository: https://github.com/${owner}/${repoName}`);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();

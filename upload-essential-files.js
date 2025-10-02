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
  return accessToken;
}

async function getGitHubClient() {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

// Only include these directories and files
const INCLUDE_PATTERNS = [
  'client/src',
  'server',
  'shared',
  'migrations',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'tailwind.config.ts',
  'postcss.config.js',
  'drizzle.config.ts',
  'components.json',
  'README.md',
  'replit.md',
  '.gitignore'
];

function shouldInclude(filePath) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return INCLUDE_PATTERNS.some(pattern => {
    return normalizedPath.startsWith(pattern) || normalizedPath === pattern;
  });
}

function getAllFiles(dir, baseDir = dir) {
  const files = [];
  const items = readdirSync(dir);

  for (const item of items) {
    const fullPath = join(dir, item);
    const relativePath = relative(baseDir, fullPath);

    // Skip hidden files and node_modules
    if (item.startsWith('.') && item !== '.gitignore') continue;
    if (item === 'node_modules') continue;

    if (!shouldInclude(relativePath)) continue;

    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getAllFiles(fullPath, baseDir));
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

async function uploadFile(octokit, owner, repo, filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const contentBase64 = Buffer.from(content).toString('base64');
    
    // Try to get existing file first
    let sha = null;
    try {
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path: filePath
      });
      sha = data.sha;
    } catch (error) {
      // File doesn't exist yet, which is fine
    }
    
    const params = {
      owner,
      repo,
      path: filePath,
      message: sha ? `Update ${filePath}` : `Add ${filePath}`,
      content: contentBase64
    };
    
    if (sha) {
      params.sha = sha;
    }
    
    await octokit.repos.createOrUpdateFileContents(params);
    return { success: true, path: filePath };
  } catch (error) {
    return { success: false, path: filePath, error: error.message };
  }
}

async function main() {
  try {
    const octokit = await getGitHubClient();
    const owner = 'gitjiggy';
    const repoName = 'Clasio-Replit-MLP-Oct01';

    console.log('Gathering essential files...');
    const files = getAllFiles('.');
    console.log(`Found ${files.length} essential files to upload\n`);

    console.log(`Uploading to ${owner}/${repoName}...\n`);
    
    let uploaded = 0;
    let failed = 0;
    
    for (const file of files) {
      const result = await uploadFile(octokit, owner, repoName, file);
      
      if (result.success) {
        uploaded++;
        if (uploaded % 10 === 0) {
          console.log(`  ✅ Uploaded ${uploaded}/${files.length} files...`);
        }
      } else {
        failed++;
        console.error(`  ❌ Failed: ${result.path} - ${result.error}`);
      }
    }
    
    console.log(`\n📊 Upload Summary:`);
    console.log(`  ✅ Uploaded: ${uploaded}`);
    console.log(`  ❌ Failed: ${failed}`);
    console.log(`\n🎉 Repository: https://github.com/${owner}/${repoName}`);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();

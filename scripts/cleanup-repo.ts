import { Octokit } from '@octokit/rest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let connectionSettings: any;

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

async function getGitHubClient() {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

const EXCLUDE_PATTERNS = [
  /^node_modules\//,
  /^\.git\//,
  /^dist\//,
  /^build\//,
  /^\.env/,
  /^attached_assets\//,
  /^\.replit$/,
  /^replit\.nix$/,
  /^\.upm\//,
  /^\.breakpoints$/,
  /^scripts\//,
  /^\.cache\//,
  /^\.local\//,
  /^tmp\//,
  /^temp\//,
  /^logs\//,
  /\.log$/,
  /^\.DS_Store$/,
  /^server\/public\//,
  /^\.config\//,
  /^package-lock\.json$/,
  /^\.npm\//,
  /^\.yarn\//,
  /worker_test\.log$/,
  /^after_.*\.png$/,
  /^check-.*\.js$/
];

function shouldExclude(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return EXCLUDE_PATTERNS.some(pattern => pattern.test(normalizedPath));
}

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    if (file.startsWith('.') && file !== '.gitignore' && file !== '.env.example') {
      return;
    }

    const filePath = path.join(dirPath, file);
    const relativePath = path.relative(process.cwd(), filePath);

    if (shouldExclude(relativePath)) {
      return;
    }

    if (fs.statSync(filePath).isDirectory()) {
      arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
    } else {
      arrayOfFiles.push(relativePath);
    }
  });

  return arrayOfFiles;
}

async function createTreeAndCommit(octokit: Octokit, owner: string, repo: string, files: string[]) {
  try {
    console.log('Getting latest commit SHA...');
    const { data: refData } = await octokit.git.getRef({
      owner,
      repo,
      ref: 'heads/main'
    });
    const latestCommitSha = refData.object.sha;
    
    const { data: latestCommit } = await octokit.git.getCommit({
      owner,
      repo,
      commit_sha: latestCommitSha
    });

    console.log('Creating blobs for all files...');
    const tree = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const { data: blob } = await octokit.git.createBlob({
        owner,
        repo,
        content: Buffer.from(content).toString('base64'),
        encoding: 'base64'
      });
      
      tree.push({
        path: file,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: blob.sha
      });

      if (tree.length % 10 === 0) {
        console.log(`  Created ${tree.length}/${files.length} blobs...`);
      }
    }

    console.log('Creating clean tree (without cache and logs)...');
    const { data: treeData } = await octokit.git.createTree({
      owner,
      repo,
      tree
    });

    console.log('Creating commit...');
    const { data: commitData } = await octokit.git.createCommit({
      owner,
      repo,
      message: 'Clean repository: Remove cache, logs, and unnecessary files\n\nRemoved:\n- .cache/ directory\n- logs/ directory\n- worker_test.log\n- Build artifacts\n\nReady for vendor handoff',
      tree: treeData.sha,
      parents: [latestCommitSha]
    });

    console.log('Force updating reference...');
    await octokit.git.updateRef({
      owner,
      repo,
      ref: 'heads/main',
      sha: commitData.sha,
      force: true
    });

    console.log('✓ Repository cleaned and updated successfully!');
  } catch (error: any) {
    console.error('Error:', error.message);
    throw error;
  }
}

async function main() {
  try {
    const octokit = await getGitHubClient();
    const repoName = 'Clasio-Replit-MLP-Oct03';
    const owner = 'gitjiggy';

    console.log('Cleaning up repository...');

    const projectRoot = path.resolve(__dirname, '..');
    process.chdir(projectRoot);
    
    const files = getAllFiles('.');
    console.log(`\nFound ${files.length} clean files to upload`);
    console.log('\nSample files:');
    files.slice(0, 30).forEach(f => console.log(`  - ${f}`));
    if (files.length > 30) {
      console.log('  ...\n');
    }

    await createTreeAndCommit(octokit, owner, repoName, files);

    console.log(`\n✓ Repository cleaned successfully!`);
    console.log(`Repository URL: https://github.com/${owner}/${repoName}`);
    console.log('\nNext: Verify the repository contains only source code and configuration files.');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();

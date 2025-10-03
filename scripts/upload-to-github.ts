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
  'node_modules',
  '.git',
  'dist',
  'build',
  '.env',
  'attached_assets',
  '.replit',
  'replit.nix',
  '.upm',
  '.breakpoints',
  'scripts/upload-to-github.ts',
  'scripts',
  '.cache',
  '.local',
  'tmp',
  'temp',
  'logs',
  '*.log',
  '.DS_Store',
  'server/public',
  '.config',
  'package-lock.json'
];

function shouldExclude(filePath: string): boolean {
  return EXCLUDE_PATTERNS.some(pattern => {
    if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace('*', '.*'));
      return regex.test(filePath);
    }
    return filePath.includes(pattern);
  });
}

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
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

async function createRepository(octokit: Octokit, repoName: string) {
  try {
    console.log(`Creating repository: ${repoName}...`);
    const { data } = await octokit.repos.createForAuthenticatedUser({
      name: repoName,
      description: 'Clasio - AI-Powered Document Management System',
      private: false,
      auto_init: false
    });
    console.log(`✓ Repository created: ${data.html_url}`);
    return data;
  } catch (error: any) {
    if (error.status === 422) {
      console.log('Repository already exists, using existing repository...');
      const { data } = await octokit.repos.get({
        owner: 'gitjiggy',
        repo: repoName
      });
      return data;
    }
    throw error;
  }
}

async function uploadFile(octokit: Octokit, owner: string, repo: string, filePath: string, content: string) {
  try {
    const base64Content = Buffer.from(content).toString('base64');
    
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message: `Add ${filePath}`,
      content: base64Content,
      branch: 'main'
    });
    
    console.log(`✓ Uploaded: ${filePath}`);
  } catch (error: any) {
    console.error(`✗ Failed to upload ${filePath}:`, error.message);
  }
}

async function main() {
  try {
    const octokit = await getGitHubClient();
    const repoName = 'Clasio-Replit-MLP-Oct03';
    const owner = 'gitjiggy';

    const repo = await createRepository(octokit, repoName);

    const projectRoot = path.resolve(__dirname, '..');
    process.chdir(projectRoot);
    
    const files = getAllFiles('.');
    
    console.log(`\nFound ${files.length} files to upload...`);
    
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      await uploadFile(octokit, owner, repoName, file, content);
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`\n✓ All files uploaded successfully!`);
    console.log(`Repository URL: https://github.com/${owner}/${repoName}`);
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();

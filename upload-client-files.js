import { Octokit } from '@octokit/rest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

let connectionSettings;

async function getAccessToken() {
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

function getAllFiles(dir, baseDir = dir) {
  const files = [];
  const items = readdirSync(dir);

  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);
    const relativePath = relative(baseDir, fullPath);

    // Skip hidden and node_modules
    if (item.startsWith('.')) continue;
    if (item === 'node_modules') continue;

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
    
    let sha = null;
    try {
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path: filePath
      });
      sha = data.sha;
    } catch (error) {
      // File doesn't exist
    }
    
    const params = {
      owner,
      repo,
      path: filePath,
      message: sha ? `Update ${filePath}` : `Add ${filePath}`,
      content: contentBase64
    };
    
    if (sha) params.sha = sha;
    
    await octokit.repos.createOrUpdateFileContents(params);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function main() {
  const accessToken = await getAccessToken();
  const octokit = new Octokit({ auth: accessToken });
  const owner = 'gitjiggy';
  const repo = 'Clasio-Replit-MLP-Oct01';

  console.log('Uploading client/src files...\n');
  
  const files = getAllFiles('client/src', 'client/src');
  console.log(`Found ${files.length} files in client/src\n`);
  
  let uploaded = 0;
  let failed = 0;
  
  for (const file of files) {
    const fullPath = join('client/src', file);
    const result = await uploadFile(octokit, owner, repo, fullPath);
    
    if (result.success) {
      uploaded++;
      if (uploaded % 25 === 0) {
        console.log(`  ✅ ${uploaded}/${files.length} files uploaded...`);
      }
    } else {
      failed++;
      console.error(`  ❌ Failed: ${fullPath}`);
    }
  }
  
  // Also upload client/index.html
  const htmlResult = await uploadFile(octokit, owner, repo, 'client/index.html');
  if (htmlResult.success) uploaded++;
  
  console.log(`\n📊 Client Upload Summary:`);
  console.log(`  ✅ Uploaded: ${uploaded}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`\n🎉 https://github.com/${owner}/${repo}`);
}

main();

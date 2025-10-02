import { Octokit } from '@octokit/rest';
import { readFileSync, existsSync } from 'fs';

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

async function updateFile(octokit, owner, repoName, filePath) {
  if (!existsSync(filePath)) {
    console.log(`  ⊘ Skipped: ${filePath} (doesn't exist locally)`);
    return { success: false, skipped: true };
  }

  try {
    // Get current file to retrieve SHA
    let sha;
    try {
      const { data } = await octokit.repos.getContent({
        owner,
        repo: repoName,
        path: filePath
      });
      sha = data.sha;
    } catch (error) {
      // File doesn't exist in repo, can upload without SHA
      sha = undefined;
    }

    const content = readFileSync(filePath, 'utf-8');
    const contentBase64 = Buffer.from(content).toString('base64');
    
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo: repoName,
      path: filePath,
      message: `Update ${filePath}`,
      content: contentBase64,
      ...(sha && { sha })
    });
    
    console.log(`  ✓ Updated: ${filePath}`);
    return { success: true };
  } catch (error) {
    console.log(`  ✗ Failed: ${filePath} - ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function main() {
  try {
    const octokit = await getUncachableGitHubClient();
    const owner = 'gitjiggy';
    const repoName = 'Clasio-Replit-MLP-Oct02';

    console.log(`🔄 Updating existing files in ${owner}/${repoName}\n`);

    const filesToUpdate = [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'README.md',
      'replit.md',
      'drizzle.config.ts',
      'tailwind.config.ts',
      'vite.config.ts'
    ];

    let updated = 0;
    let failed = 0;
    let skipped = 0;

    for (const file of filesToUpdate) {
      const result = await updateFile(octokit, owner, repoName, file);
      if (result.success) {
        updated++;
      } else if (result.skipped) {
        skipped++;
      } else {
        failed++;
      }
    }

    console.log(`\n✅ Update complete: ${updated} updated, ${failed} failed, ${skipped} skipped`);
    console.log(`📍 Repository: https://github.com/${owner}/${repoName}`);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();

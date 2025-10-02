import { Octokit } from '@octokit/rest';
import { readFileSync } from 'fs';

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

const CONFLICT_FILES = [
  'README.md',
  'client/src/App.tsx',
  'client/src/components/ObjectUploader.tsx',
  'client/src/components/ui/alert-dialog.tsx',
  'client/src/components/ui/calendar.tsx',
  'client/src/components/ui/dropdown-menu.tsx',
  'client/src/components/ui/form.tsx',
  'client/src/components/ui/table.tsx',
  'client/src/components/ui/tabs.tsx',
  'client/src/components/ui/toggle-group.tsx',
  'client/src/lib/queryClient.ts'
];

async function fixFile(octokit, owner, repo, filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const contentBase64 = Buffer.from(content).toString('base64');
    
    // Get the current SHA from GitHub
    const { data: existingFile } = await octokit.repos.getContent({
      owner,
      repo,
      path: filePath
    });
    
    // Update with correct SHA
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message: `Update ${filePath} to latest version`,
      content: contentBase64,
      sha: existingFile.sha
    });
    
    console.log(`  ✅ Updated: ${filePath}`);
    return true;
  } catch (error) {
    console.error(`  ❌ Failed: ${filePath} - ${error.message}`);
    return false;
  }
}

async function main() {
  const accessToken = await getAccessToken();
  const octokit = new Octokit({ auth: accessToken });
  const owner = 'gitjiggy';
  const repo = 'Clasio-Replit-MLP-Oct01';

  console.log('Fixing SHA conflict files...\n');
  
  let fixed = 0;
  for (const file of CONFLICT_FILES) {
    if (await fixFile(octokit, owner, repo, file)) {
      fixed++;
    }
  }
  
  console.log(`\n📊 Fixed ${fixed}/${CONFLICT_FILES.length} files`);
  console.log(`🎉 https://github.com/${owner}/${repo}`);
}

main();

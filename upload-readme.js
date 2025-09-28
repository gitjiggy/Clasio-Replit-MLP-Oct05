import { Octokit } from '@octokit/rest';
import fs from 'fs';

let connectionSettings;

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

async function getUncachableGitHubClient() {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

async function uploadReadme() {
  const github = await getUncachableGitHubClient();
  
  console.log('Uploading updated README.md...');
  
  // Read the README content
  const readmeContent = fs.readFileSync('README.md', 'utf8');
  
  // Get current file SHA (needed for updates)
  let currentSha;
  try {
    const { data: currentFile } = await github.repos.getContent({
      owner: 'gitjiggy',
      repo: 'Clasio-Replit-MLP-Sep27',
      path: 'README.md'
    });
    currentSha = currentFile.sha;
    console.log('Found existing README.md, will update it');
  } catch (error) {
    console.log('No existing README.md, will create new one');
  }
  
  // Upload/update the README
  const { data: result } = await github.repos.createOrUpdateFileContents({
    owner: 'gitjiggy',
    repo: 'Clasio-Replit-MLP-Sep27',
    path: 'README.md',
    message: 'Update README.md with comprehensive Sep 27, 2025 feature documentation\n\nAdded detailed documentation for:\n- Multi-tenant architecture conversion\n- Google Drive integration overhaul\n- Advanced search engine revolution\n- Performance and reliability enhancements\n- Production security and stability\n- Complete feature list for external vendors',
    content: Buffer.from(readmeContent).toString('base64'),
    ...(currentSha && { sha: currentSha })
  });
  
  console.log('✓ README.md uploaded successfully!');
  console.log('Commit URL:', result.commit.html_url);
  console.log('File URL:', `https://github.com/gitjiggy/Clasio-Replit-MLP-Sep27/blob/main/README.md`);
  
  return result;
}

async function main() {
  try {
    const result = await uploadReadme();
    return { success: true, result };
  } catch (error) {
    console.error('Error uploading README:', error);
    return { success: false, error: error.message };
  }
}

main().then(result => {
  console.log('Final result:', JSON.stringify(result, null, 2));
});
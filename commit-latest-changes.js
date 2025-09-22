import { Octokit } from '@octokit/rest'
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

async function updateDocumentsFile() {
  try {
    const octokit = await getUncachableGitHubClient();
    const repoOwner = 'gitjiggy';
    const repoName = 'Clasio-Replit-MVP-Sep21';
    const filePath = 'client/src/pages/documents.tsx';
    
    console.log('Updating documents.tsx with latest display order fix...');
    
    // Read the updated file content
    const content = fs.readFileSync('client/src/pages/documents.tsx');
    const base64Content = content.toString('base64');
    
    let sha = null;
    
    // Try to get existing file SHA
    try {
      const existingFile = await octokit.rest.repos.getContent({
        owner: repoOwner,
        repo: repoName,
        path: filePath
      });
      sha = existingFile.data.sha;
      console.log('Found existing file, updating...');
    } catch (error) {
      console.log('File does not exist, creating new file...');
    }
    
    // Create or update the file
    const params = {
      owner: repoOwner,
      repo: repoName,
      path: filePath,
      message: 'Fix display order: Show Folder before Sub-folder in document cards',
      content: base64Content
    };
    
    if (sha) {
      params.sha = sha;
    }
    
    await octokit.rest.repos.createOrUpdateFileContents(params);
    
    console.log('✅ Successfully updated:', filePath);
    console.log('📝 Commit message: Fix display order: Show Folder before Sub-folder in document cards');
    console.log('🔗 Repository: https://github.com/gitjiggy/Clasio-Replit-MVP-Sep21');
    
  } catch (error) {
    console.error('❌ Error updating file:', error.message);
    throw error;
  }
}

async function main() {
  try {
    await updateDocumentsFile();
    console.log('\n🎉 Repository successfully updated with latest display order fix!');
    console.log('The document cards now show Folder before Sub-folder correctly.');
  } catch (error) {
    console.error('Update failed:', error.message);
    process.exit(1);
  }
}

main();
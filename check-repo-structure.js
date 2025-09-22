import { Octokit } from '@octokit/rest'

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

async function checkRepoStructure() {
  try {
    const octokit = await getUncachableGitHubClient();
    const repoOwner = 'gitjiggy';
    const repoName = 'Clasio-Replit-MVP-Sep21';
    
    console.log('Checking repository structure...');
    
    // Check root directory
    const rootContents = await octokit.rest.repos.getContent({
      owner: repoOwner,
      repo: repoName,
      path: ''
    });
    
    console.log('Root directory contents:');
    rootContents.data.forEach(item => {
      console.log(`${item.type}: ${item.name}`);
    });
    
    // Check if client directory exists
    try {
      const clientContents = await octokit.rest.repos.getContent({
        owner: repoOwner,
        repo: repoName,
        path: 'client'
      });
      console.log('\nClient directory exists!');
    } catch (error) {
      console.log('\nClient directory not found, checking for individual files...');
    }
    
    // Try to find documents.tsx file
    console.log('\nSearching for documents.tsx file...');
    const searchResult = await octokit.rest.search.code({
      q: 'documents.tsx repo:gitjiggy/Clasio-Replit-MVP-Sep21'
    });
    
    if (searchResult.data.items.length > 0) {
      console.log('Found documents.tsx at:', searchResult.data.items[0].path);
    } else {
      console.log('documents.tsx not found in repository');
    }
    
  } catch (error) {
    console.error('Error checking repository:', error.message);
  }
}

checkRepoStructure();
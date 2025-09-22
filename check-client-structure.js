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

async function exploreClientDirectory() {
  try {
    const octokit = await getUncachableGitHubClient();
    const repoOwner = 'gitjiggy';
    const repoName = 'Clasio-Replit-MVP-Sep21';
    
    async function listDirectory(path, depth = 0) {
      const indent = '  '.repeat(depth);
      try {
        const contents = await octokit.rest.repos.getContent({
          owner: repoOwner,
          repo: repoName,
          path: path
        });
        
        if (Array.isArray(contents.data)) {
          for (const item of contents.data) {
            console.log(`${indent}${item.type}: ${item.name}`);
            if (item.type === 'dir' && depth < 3) {
              await listDirectory(item.path, depth + 1);
            }
          }
        } else {
          console.log(`${indent}file: ${contents.data.name}`);
        }
      } catch (error) {
        console.log(`${indent}Error accessing ${path}: ${error.message}`);
      }
    }
    
    console.log('Client directory structure:');
    await listDirectory('client');
    
  } catch (error) {
    console.error('Error exploring client directory:', error.message);
  }
}

exploreClientDirectory();
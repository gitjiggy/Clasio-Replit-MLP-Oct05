import { Octokit } from '@octokit/rest';

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

async function checkPermissions() {
  const github = await getUncachableGitHubClient();
  
  try {
    console.log('Checking current user...');
    const user = await github.users.getAuthenticated();
    console.log('Current user:', user.data.login);
    
    console.log('\nChecking organizations...');
    const orgs = await github.orgs.listForAuthenticatedUser();
    console.log('Organizations:', orgs.data.map(org => org.login));
    
    // Check if gitjiggy exists and permissions
    console.log('\nChecking gitjiggy organization...');
    try {
      const gitjiggy = await github.orgs.get({ org: 'gitjiggy' });
      console.log('gitjiggy exists:', gitjiggy.data.login);
      
      // Check membership
      try {
        const membership = await github.orgs.getMembershipForAuthenticatedUser({ org: 'gitjiggy' });
        console.log('Membership in gitjiggy:', membership.data.role);
      } catch (error) {
        console.log('No membership in gitjiggy or private membership');
      }
    } catch (error) {
      console.log('Cannot access gitjiggy organization:', error.message);
    }
    
    console.log('\nTrying to create repository under user account...');
    try {
      const repo = await github.repos.createForAuthenticatedUser({
        name: 'Clasio-Replit-MLP-Sep27',
        description: 'Clasio Document Management System - Multi-tenant Production Release (Sep 27, 2025)',
        private: false,
        auto_init: true
      });
      console.log('✓ Repository created under user account:', repo.data.html_url);
      return { success: true, repo: repo.data, type: 'user' };
    } catch (error) {
      if (error.status === 422) {
        console.log('Repository already exists under user account');
        const existingRepo = await github.repos.get({
          owner: user.data.login,
          repo: 'Clasio-Replit-MLP-Sep27'
        });
        return { success: true, repo: existingRepo.data, type: 'user' };
      }
      throw error;
    }
    
  } catch (error) {
    console.error('Error checking permissions:', error);
    return { success: false, error: error.message };
  }
}

checkPermissions().then(result => {
  console.log('\nFinal result:', JSON.stringify(result, null, 2));
});
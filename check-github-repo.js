import { Octokit } from '@octokit/rest';

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

async function checkRepository() {
  try {
    console.log('Checking GitHub repository status...');
    
    const octokit = await getUncachableGitHubClient();
    const owner = 'Clasio-ai';
    const repo = 'Clasio-Replit-MLP-Sep26';
    
    // Check if repository exists
    try {
      const { data: repoData } = await octokit.rest.repos.get({
        owner,
        repo
      });
      console.log('✅ Repository exists:', repoData.html_url);
      console.log('Repository default branch:', repoData.default_branch);
      console.log('Repository empty:', repoData.size === 0);
    } catch (error) {
      console.error('❌ Repository check failed:', error.message);
      return;
    }
    
    // Check repository contents
    try {
      const { data: contents } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: ''
      });
      console.log('Repository contents:', contents.length, 'items');
      if (Array.isArray(contents)) {
        contents.forEach(item => {
          console.log(`  - ${item.name} (${item.type})`);
        });
      }
    } catch (error) {
      console.log('Repository appears to be empty (expected for new repo)');
    }
    
    // Try to create a simple README to initialize the repository
    try {
      const readmeContent = `# Clasio Document Management System

A modern document management system built with React and Express, featuring AI-powered document analysis.

## Setup Instructions

1. Clone this repository
2. Install dependencies: \`npm install\`
3. Set up environment variables
4. Run the application: \`npm run dev\`

## Features

- Document upload and management
- AI-powered document analysis
- Google Drive integration
- Multi-tenant architecture
- Advanced search capabilities

This repository contains the latest updates from September 26, 2025.
`;

      await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: 'README.md',
        message: 'Initial commit: Add README',
        content: Buffer.from(readmeContent).toString('base64')
      });
      
      console.log('✅ Successfully created initial README file');
      
    } catch (error) {
      console.log('README creation result:', error.message);
    }
    
  } catch (error) {
    console.error('❌ Repository check failed:', error);
  }
}

checkRepository().catch(console.error);
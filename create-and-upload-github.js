import { Octokit } from '@octokit/rest';
import fs from 'fs';

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

// List of essential files to upload
const filesToUpload = [
  'client/index.html',
  'client/src/App.tsx',
  'client/src/main.tsx',
  'client/src/index.css',
  'client/src/components/DocumentModal.tsx',
  'client/src/components/LoginModal.tsx',
  'client/src/components/ObjectUploader.tsx',
  'client/src/components/QueueStatusDashboard.tsx',
  'client/src/components/UserMenu.tsx',
  'client/src/contexts/AuthContext.tsx',
  'client/src/hooks/use-analytics.tsx',
  'client/src/hooks/use-mobile.tsx',
  'client/src/hooks/use-toast.ts',
  'client/src/lib/analytics.ts',
  'client/src/lib/documentClassifications.ts',
  'client/src/lib/documentDisplay.ts',
  'client/src/lib/firebase.ts',
  'client/src/lib/queryClient.ts',
  'client/src/lib/utils.ts',
  'client/src/pages/auth-drive.tsx',
  'client/src/pages/documents.tsx',
  'client/src/pages/document-viewer.tsx',
  'client/src/pages/drive.tsx',
  'client/src/pages/not-found.tsx',
  'client/src/pages/trash.tsx',
  'server/aiQueueProcessor.ts',
  'server/auth.ts',
  'server/cookieAuth.ts',
  'server/db.ts',
  'server/driveService.ts',
  'server/fieldAwareLexical.ts',
  'server/gemini.ts',
  'server/index.ts',
  'server/objectAcl.ts',
  'server/objectStorage.ts',
  'server/policyDrivenSearch.ts',
  'server/queryAnalysis.ts',
  'server/rateLimit.ts',
  'server/routes.ts',
  'server/security.ts',
  'server/storage.ts',
  'server/tierRouting.ts',
  'server/vite.ts',
  'shared/schema.ts',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'tailwind.config.ts',
  'drizzle.config.ts',
  'postcss.config.js',
  'components.json',
  'README.md',
  'replit.md',
  'migrations/0001_add_unique_active_version_constraint.sql'
];

async function createRepositoryAndUpload() {
  try {
    console.log('Starting GitHub repository creation and upload...');
    
    const octokit = await getUncachableGitHubClient();
    const owner = 'Clasio-ai';
    const repo = 'Clasio-Replit-MLP-Sep26';
    
    // First, try to create the repository
    try {
      const { data: repoData } = await octokit.rest.repos.createForOrg({
        org: owner,
        name: repo,
        description: 'Clasio Document Management System - Multi-tenant React/Express application with AI-powered document analysis',
        private: false,
        auto_init: false
      });
      console.log('✅ Repository created:', repoData.html_url);
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('ℹ️  Repository already exists, proceeding with upload...');
      } else {
        console.error('❌ Failed to create repository:', error.message);
        return;
      }
    }
    
    // Wait a moment for repository to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    let uploadCount = 0;
    let skippedCount = 0;
    
    for (const filePath of filesToUpload) {
      try {
        // Check if file exists locally
        if (!fs.existsSync(filePath)) {
          console.log(`⚠️  File not found locally: ${filePath}`);
          skippedCount++;
          continue;
        }
        
        // Read file content
        const content = fs.readFileSync(filePath, 'utf8');
        const base64Content = Buffer.from(content).toString('base64');
        
        // Upload file
        await octokit.rest.repos.createOrUpdateFileContents({
          owner,
          repo,
          path: filePath,
          message: `Add ${filePath}`,
          content: base64Content
        });
        
        console.log(`✅ Uploaded: ${filePath}`);
        uploadCount++;
        
        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 150));
        
      } catch (error) {
        console.error(`❌ Failed to upload ${filePath}:`, error.message);
        skippedCount++;
      }
    }
    
    console.log(`\n🎉 Upload complete!`);
    console.log(`✅ Successfully uploaded: ${uploadCount} files`);
    console.log(`⚠️  Skipped: ${skippedCount} files`);
    console.log(`🔗 Repository URL: https://github.com/${owner}/${repo}`);
    
  } catch (error) {
    console.error('❌ Process failed:', error);
    throw error;
  }
}

// Run the process
createRepositoryAndUpload().catch(console.error);
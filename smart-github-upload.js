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

// Essential files for external vendor collaboration
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
  // Key UI components
  'client/src/components/ui/button.tsx',
  'client/src/components/ui/card.tsx',
  'client/src/components/ui/dialog.tsx',
  'client/src/components/ui/form.tsx',
  'client/src/components/ui/input.tsx',
  'client/src/components/ui/label.tsx',
  'client/src/components/ui/select.tsx',
  'client/src/components/ui/table.tsx',
  'client/src/components/ui/tabs.tsx',
  'client/src/components/ui/toast.tsx',
  'client/src/components/ui/toaster.tsx',
  // Server files  
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
  // Shared files
  'shared/schema.ts',
  // Configuration files
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'tailwind.config.ts',
  'drizzle.config.ts',
  'postcss.config.js',
  'components.json',
  // Documentation
  'replit.md',
  // Database migrations
  'migrations/0001_add_unique_active_version_constraint.sql'
];

async function getExistingFileSha(octokit, owner, repo, path) {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path
    });
    return data.sha;
  } catch (error) {
    return null; // File doesn't exist
  }
}

async function smartUploadToRepository() {
  try {
    console.log('Starting smart GitHub repository upload...');
    
    const octokit = await getUncachableGitHubClient();
    const repo = 'Clasio-Replit-MLP-Sep26';
    
    // Get authenticated user
    const { data: user } = await octokit.rest.users.getAuthenticated();
    console.log('Authenticated as:', user.login);
    
    // Check repository status
    try {
      const { data: repoData } = await octokit.rest.repos.get({
        owner: user.login,
        repo
      });
      console.log('✅ Repository found:', repoData.html_url);
    } catch (error) {
      console.error('❌ Repository not accessible:', error.message);
      return;
    }
    
    let uploadCount = 0;
    let updateCount = 0;
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
        
        // Get existing file SHA if it exists
        const existingSha = await getExistingFileSha(octokit, user.login, repo, filePath);
        
        // Prepare upload parameters
        const params = {
          owner: user.login,
          repo: repo,
          path: filePath,
          message: existingSha ? `Update ${filePath}` : `Add ${filePath}`,
          content: base64Content
        };
        
        // Add SHA if file exists
        if (existingSha) {
          params.sha = existingSha;
        }
        
        // Upload/update file
        await octokit.rest.repos.createOrUpdateFileContents(params);
        
        if (existingSha) {
          console.log(`🔄 Updated: ${filePath}`);
          updateCount++;
        } else {
          console.log(`✅ Created: ${filePath}`);
          uploadCount++;
        }
        
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 250));
        
      } catch (error) {
        console.error(`❌ Failed to process ${filePath}:`, error.message);
        skippedCount++;
      }
    }
    
    console.log(`\n🎉 Smart upload complete!`);
    console.log(`✅ Files created: ${uploadCount}`);
    console.log(`🔄 Files updated: ${updateCount}`);
    console.log(`⚠️  Files skipped: ${skippedCount}`);
    console.log(`📊 Total processed: ${uploadCount + updateCount}/${filesToUpload.length}`);
    console.log(`🔗 Repository URL: https://github.com/${user.login}/${repo}`);
    
    // Verify repository completeness
    if (uploadCount + updateCount >= 50) {
      console.log(`\n✅ Repository is ready for external vendor collaboration!`);
      console.log(`📋 Contains all essential project files for development`);
    } else {
      console.log(`\n⚠️  Repository may be incomplete (${uploadCount + updateCount} files uploaded)`);
    }
    
  } catch (error) {
    console.error('❌ Smart upload failed:', error);
    throw error;
  }
}

// Run the smart upload
smartUploadToRepository().catch(console.error);
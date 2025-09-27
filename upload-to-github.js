import { Octokit } from '@octokit/rest';
import fs from 'fs';
import path from 'path';

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

// WARNING: Never cache this client.
// Access tokens expire, so a new client must be created each time.
// Always call this function again to get a fresh client.
async function getUncachableGitHubClient() {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

// List of essential files to upload (excluding cache, logs, assets, etc.)
const filesToUpload = [
  // Client source files
  'client/index.html',
  'client/src/App.tsx',
  'client/src/main.tsx',
  'client/src/index.css',
  
  // Client components
  'client/src/components/DocumentModal.tsx',
  'client/src/components/LoginModal.tsx',
  'client/src/components/ObjectUploader.tsx',
  'client/src/components/QueueStatusDashboard.tsx',
  'client/src/components/UserMenu.tsx',
  
  // Client contexts and hooks
  'client/src/contexts/AuthContext.tsx',
  'client/src/hooks/use-analytics.tsx',
  'client/src/hooks/use-mobile.tsx',
  'client/src/hooks/use-toast.ts',
  
  // Client library files
  'client/src/lib/analytics.ts',
  'client/src/lib/documentClassifications.ts',
  'client/src/lib/documentDisplay.ts',
  'client/src/lib/firebase.ts',
  'client/src/lib/queryClient.ts',
  'client/src/lib/utils.ts',
  
  // Client pages
  'client/src/pages/auth-drive.tsx',
  'client/src/pages/documents.tsx',
  'client/src/pages/document-viewer.tsx',
  'client/src/pages/drive.tsx',
  'client/src/pages/not-found.tsx',
  'client/src/pages/trash.tsx',
  
  // All shadcn UI components
  'client/src/components/ui/accordion.tsx',
  'client/src/components/ui/alert-dialog.tsx',
  'client/src/components/ui/alert.tsx',
  'client/src/components/ui/aspect-ratio.tsx',
  'client/src/components/ui/autocomplete-combobox.tsx',
  'client/src/components/ui/avatar.tsx',
  'client/src/components/ui/badge.tsx',
  'client/src/components/ui/breadcrumb.tsx',
  'client/src/components/ui/button.tsx',
  'client/src/components/ui/calendar.tsx',
  'client/src/components/ui/card.tsx',
  'client/src/components/ui/carousel.tsx',
  'client/src/components/ui/chart.tsx',
  'client/src/components/ui/checkbox.tsx',
  'client/src/components/ui/collapsible.tsx',
  'client/src/components/ui/command.tsx',
  'client/src/components/ui/context-menu.tsx',
  'client/src/components/ui/dialog.tsx',
  'client/src/components/ui/drawer.tsx',
  'client/src/components/ui/dropdown-menu.tsx',
  'client/src/components/ui/form.tsx',
  'client/src/components/ui/hover-card.tsx',
  'client/src/components/ui/input-otp.tsx',
  'client/src/components/ui/input.tsx',
  'client/src/components/ui/label.tsx',
  'client/src/components/ui/menubar.tsx',
  'client/src/components/ui/navigation-menu.tsx',
  'client/src/components/ui/pagination.tsx',
  'client/src/components/ui/popover.tsx',
  'client/src/components/ui/progress.tsx',
  'client/src/components/ui/radio-group.tsx',
  'client/src/components/ui/resizable.tsx',
  'client/src/components/ui/scroll-area.tsx',
  'client/src/components/ui/select.tsx',
  'client/src/components/ui/separator.tsx',
  'client/src/components/ui/sheet.tsx',
  'client/src/components/ui/sidebar.tsx',
  'client/src/components/ui/skeleton.tsx',
  'client/src/components/ui/slider.tsx',
  'client/src/components/ui/switch.tsx',
  'client/src/components/ui/table.tsx',
  'client/src/components/ui/tabs.tsx',
  'client/src/components/ui/textarea.tsx',
  'client/src/components/ui/toaster.tsx',
  'client/src/components/ui/toast.tsx',
  'client/src/components/ui/toggle-group.tsx',
  'client/src/components/ui/toggle.tsx',
  'client/src/components/ui/tooltip.tsx',
  
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
  'README.md',
  'replit.md',
  
  // Database migrations
  'migrations/0001_add_unique_active_version_constraint.sql'
];

async function uploadFilesToGitHub() {
  try {
    console.log('Starting GitHub upload process...');
    
    const octokit = await getUncachableGitHubClient();
    const owner = 'Clasio-ai'; // Repository owner
    const repo = 'Clasio-Replit-MLP-Sep26'; // Repository name
    
    // Get current commit SHA for updates
    let masterRef;
    try {
      const { data: refData } = await octokit.rest.git.getRef({
        owner,
        repo,
        ref: 'heads/main'
      });
      masterRef = refData;
    } catch (error) {
      console.log('Main branch not found, will create initial commit');
    }
    
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
        
        // Try to get existing file to update rather than create
        let existingFile = null;
        try {
          const { data } = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: filePath
          });
          existingFile = data;
        } catch (error) {
          // File doesn't exist, will create new
        }
        
        // Upload or update file
        const params = {
          owner,
          repo,
          path: filePath,
          message: `Upload ${filePath}`,
          content: base64Content,
          ...(existingFile && { sha: existingFile.sha })
        };
        
        await octokit.rest.repos.createOrUpdateFileContents(params);
        
        console.log(`✅ Uploaded: ${filePath}`);
        uploadCount++;
        
        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`❌ Failed to upload ${filePath}:`, error.message);
        skippedCount++;
      }
    }
    
    console.log(`\n🎉 Upload complete!`);
    console.log(`✅ Successfully uploaded: ${uploadCount} files`);
    console.log(`⚠️  Skipped: ${skippedCount} files`);
    
  } catch (error) {
    console.error('❌ GitHub upload failed:', error);
    throw error;
  }
}

// Run the upload
uploadFilesToGitHub().catch(console.error);
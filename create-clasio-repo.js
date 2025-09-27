import { Octokit } from '@octokit/rest'
import fs from 'fs'
import path from 'path'

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

// WARNING: Never cache this client.
// Access tokens expire, so a new client must be created each time.
// Always call this function again to get a fresh client.
export async function getUncachableGitHubClient() {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

async function createRepository() {
  try {
    const octokit = await getUncachableGitHubClient();
    
    // First try to get user info to see organizations
    const user = await octokit.rest.users.getAuthenticated();
    console.log('🔑 Authenticated as:', user.data.login);
    
    // Try to create in gitjiggy org first, fallback to personal account
    let repo;
    try {
      repo = await octokit.rest.repos.createInOrg({
        org: 'gitjiggy',
        name: 'Clasio-Replit-MLP-Sep26',
        description: 'Clasio Document Management System - Multi-tenant production-ready version with advanced search and AI features',
        private: false,
        auto_init: false
      });
      console.log('✅ Repository created in gitjiggy organization:', repo.data.html_url);
    } catch (orgError) {
      console.warn('⚠️  Could not create in gitjiggy org, creating in personal account:', orgError.message);
      
      // Fallback to personal account
      repo = await octokit.rest.repos.createForAuthenticatedUser({
        name: 'Clasio-Replit-MLP-Sep26',
        description: 'Clasio Document Management System - Multi-tenant production-ready version with advanced search and AI features',
        private: false,
        auto_init: false
      });
      console.log('✅ Repository created in personal account:', repo.data.html_url);
    }
    
    return repo.data;
  } catch (error) {
    console.error('❌ Error creating repository:', error.message);
    throw error;
  }
}

// Function to get file contents as base64
function getFileContent(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return content.toString('base64');
  } catch (error) {
    console.error(`❌ Error reading file ${filePath}:`, error.message);
    return null;
  }
}

// Function to upload a single file
async function uploadFile(octokit, owner, repo, filePath, content, message) {
  try {
    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message,
      content,
      branch: 'main'
    });
    console.log(`✅ Uploaded: ${filePath}`);
  } catch (error) {
    console.error(`❌ Error uploading ${filePath}:`, error.message);
  }
}

// Main function to create repository and upload files
async function main() {
  try {
    console.log('🚀 Creating Clasio-Replit-MLP-Sep26 repository...');
    
    const repo = await createRepository();
    const octokit = await getUncachableGitHubClient();
    
    // Extract owner from the repository data
    const owner = repo.owner.login;
    const repoName = repo.name;
    
    // List of essential files to upload (excluding image assets and temp files)
    const filesToUpload = [
      // Root configuration files
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'vite.config.ts',
      'tailwind.config.ts',
      'postcss.config.js',
      'components.json',
      'drizzle.config.ts',
      'replit.md',
      
      // Client files
      'client/index.html',
      'client/src/main.tsx',
      'client/src/App.tsx',
      'client/src/index.css',
      
      // Client components
      'client/src/components/DocumentModal.tsx',
      'client/src/components/LoginModal.tsx',
      'client/src/components/ObjectUploader.tsx',
      'client/src/components/QueueStatusDashboard.tsx',
      'client/src/components/UserMenu.tsx',
      
      // Client UI components
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
      'client/src/components/ui/toast.tsx',
      'client/src/components/ui/toaster.tsx',
      'client/src/components/ui/toggle-group.tsx',
      'client/src/components/ui/toggle.tsx',
      'client/src/components/ui/tooltip.tsx',
      
      // Client contexts and hooks
      'client/src/contexts/AuthContext.tsx',
      'client/src/hooks/use-analytics.tsx',
      'client/src/hooks/use-mobile.tsx',
      'client/src/hooks/use-toast.ts',
      
      // Client lib
      'client/src/lib/analytics.ts',
      'client/src/lib/documentClassifications.ts',
      'client/src/lib/documentDisplay.ts',
      'client/src/lib/firebase.ts',
      'client/src/lib/queryClient.ts',
      'client/src/lib/utils.ts',
      
      // Client pages
      'client/src/pages/auth-drive.tsx',
      'client/src/pages/document-viewer.tsx',
      'client/src/pages/documents.tsx',
      'client/src/pages/drive.tsx',
      'client/src/pages/not-found.tsx',
      'client/src/pages/trash.tsx',
      
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
      
      // Shared schema
      'shared/schema.ts',
      
      // Database migrations
      'migrations/0001_add_unique_active_version_constraint.sql'
    ];
    
    console.log(`📤 Uploading ${filesToUpload.length} files...`);
    
    // Upload all files
    for (const filePath of filesToUpload) {
      if (fs.existsSync(filePath)) {
        const content = getFileContent(filePath);
        if (content) {
          await uploadFile(
            octokit,
            owner,
            repoName,
            filePath,
            content,
            `Add ${filePath}`
          );
        }
      } else {
        console.warn(`⚠️  File not found: ${filePath}`);
      }
    }
    
    console.log('🎉 Repository setup complete!');
    console.log('🔗 Repository URL:', repo.html_url);
    
  } catch (error) {
    console.error('💥 Error in main function:', error.message);
    process.exit(1);
  }
}

main();
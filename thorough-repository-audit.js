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

async function getRepositoryTree(octokit, owner, repo, path = '') {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path
    });
    
    const files = [];
    
    if (Array.isArray(response.data)) {
      for (const item of response.data) {
        if (item.type === 'file') {
          files.push(item.path);
        } else if (item.type === 'dir') {
          const subFiles = await getRepositoryTree(octokit, owner, repo, item.path);
          files.push(...subFiles);
        }
      }
    } else if (response.data.type === 'file') {
      files.push(response.data.path);
    }
    
    return files;
  } catch (error) {
    console.log(`Warning: Could not access ${path}: ${error.message}`);
    return [];
  }
}

async function getLocalFiles(dir = '.', basePath = '') {
  const files = [];
  const excludeDirs = ['node_modules', '.git', '.next', 'dist', 'build', '.cache', '.npm', '.local', '.upm', 'logs'];
  const excludeFiles = ['.env', '.env.local', '.env.production', '.bash_logout', '.bashrc', '.nix-channels', '.nix-profile', '.profile'];
  
  try {
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
      const fullPath = `${dir}/${item}`.replace(/^\.\//, '');
      const relativePath = basePath ? `${basePath}/${item}` : item;
      
      if (excludeDirs.includes(item) || excludeFiles.includes(item)) {
        continue;
      }
      
      if (item.startsWith('.') && !['gitignore', 'replit'].includes(item.replace('.', ''))) {
        continue;
      }
      
      try {
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          const subFiles = await getLocalFiles(fullPath, relativePath);
          files.push(...subFiles);
        } else if (stat.isFile()) {
          files.push(relativePath);
        }
      } catch (statError) {
        console.log(`Warning: Could not stat ${fullPath}`);
      }
    }
  } catch (readError) {
    console.log(`Warning: Could not read directory ${dir}`);
  }
  
  return files;
}

async function thoroughAudit() {
  try {
    const octokit = await getUncachableGitHubClient();
    const repoOwner = 'gitjiggy';
    const repoName = 'Clasio-Replit-MVP-Sep21';
    
    console.log('🔍 THOROUGH REPOSITORY AUDIT\n');
    console.log('Comparing LOCAL files vs REMOTE GitHub repository...\n');
    
    // Get all files from GitHub repository
    console.log('📥 Fetching REMOTE files from GitHub...');
    const remoteFiles = await getRepositoryTree(octokit, repoOwner, repoName);
    console.log(`Found ${remoteFiles.length} files in GitHub repository\n`);
    
    // Get all files from local directory
    console.log('📂 Scanning LOCAL files...');
    const localFiles = await getLocalFiles();
    console.log(`Found ${localFiles.length} files locally\n`);
    
    // CRITICAL FILES that MUST exist for the project to work
    const criticalFiles = [
      // Backend Critical
      'server/index.ts',
      'server/routes.ts',
      'server/storage.ts',
      'server/db.ts',
      'server/vite.ts',
      'server/auth.ts',
      'server/gemini.ts',
      'server/rateLimit.ts',
      'server/objectStorage.ts',
      'server/objectAcl.ts',
      'server/driveService.ts',
      'server/aiQueueProcessor.ts',
      
      // Frontend Critical
      'client/src/App.tsx',
      'client/src/main.tsx',
      'client/src/index.css',
      'client/index.html',
      'client/src/pages/documents.tsx',
      'client/src/pages/drive.tsx',
      'client/src/pages/auth-drive.tsx',
      'client/src/pages/not-found.tsx',
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
      
      // Config Critical
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'drizzle.config.ts',
      'vite.config.ts',
      'tailwind.config.ts',
      'postcss.config.js',
      'components.json',
      
      // Data Critical
      'shared/schema.ts',
      'migrations/0001_add_unique_active_version_constraint.sql',
      'test/data/05-versions-space.pdf'
    ];
    
    // Check CRITICAL files
    console.log('🚨 CRITICAL FILES AUDIT:');
    let missingCritical = [];
    let presentCritical = [];
    
    for (const file of criticalFiles) {
      if (remoteFiles.includes(file)) {
        presentCritical.push(file);
        console.log(`✅ ${file}`);
      } else {
        missingCritical.push(file);
        console.log(`❌ MISSING: ${file}`);
      }
    }
    
    console.log(`\n📊 CRITICAL FILES SUMMARY:`);
    console.log(`✅ Present: ${presentCritical.length}/${criticalFiles.length}`);
    console.log(`❌ Missing: ${missingCritical.length}/${criticalFiles.length}`);
    
    // Check for files in local but not in remote
    console.log(`\n🔍 LOCAL vs REMOTE COMPARISON:`);
    const localOnly = localFiles.filter(f => !remoteFiles.includes(f));
    const remoteOnly = remoteFiles.filter(f => !localFiles.includes(f));
    
    if (localOnly.length > 0) {
      console.log(`\n📤 Files in LOCAL but NOT in REMOTE (${localOnly.length}):`);
      localOnly.slice(0, 20).forEach(file => console.log(`  - ${file}`));
      if (localOnly.length > 20) {
        console.log(`  ... and ${localOnly.length - 20} more files`);
      }
    }
    
    if (remoteOnly.length > 0) {
      console.log(`\n📥 Files in REMOTE but NOT in LOCAL (${remoteOnly.length}):`);
      remoteOnly.slice(0, 20).forEach(file => console.log(`  - ${file}`));
      if (remoteOnly.length > 20) {
        console.log(`  ... and ${remoteOnly.length - 20} more files`);
      }
    }
    
    // FINAL VERDICT
    console.log(`\n🎯 FINAL AUDIT VERDICT:`);
    if (missingCritical.length === 0) {
      console.log(`🎉 REPOSITORY IS COMPLETE!`);
      console.log(`All ${criticalFiles.length} critical files are present in GitHub.`);
      console.log(`The project should be runnable from a fresh clone.`);
    } else {
      console.log(`❌ REPOSITORY IS INCOMPLETE!`);
      console.log(`${missingCritical.length} critical files are missing from GitHub:`);
      missingCritical.forEach(file => console.log(`  ❌ ${file}`));
      console.log(`\nThese files MUST be uploaded for the project to work.`);
    }
    
    console.log(`\n📈 OVERALL STATISTICS:`);
    console.log(`Local files: ${localFiles.length}`);
    console.log(`Remote files: ${remoteFiles.length}`);
    console.log(`Files only in local: ${localOnly.length}`);
    console.log(`Files only in remote: ${remoteOnly.length}`);
    console.log(`Critical files missing: ${missingCritical.length}`);
    
    console.log(`\n🔗 Repository: https://github.com/gitjiggy/Clasio-Replit-MVP-Sep21`);
    
    return {
      isComplete: missingCritical.length === 0,
      missingCritical,
      presentCritical,
      localOnly,
      remoteOnly
    };
    
  } catch (error) {
    console.error('❌ Audit failed:', error.message);
    throw error;
  }
}

async function main() {
  try {
    const result = await thoroughAudit();
    
    if (!result.isComplete) {
      console.log('\n⚠️  REPOSITORY VERIFICATION FAILED');
      console.log('The repository is missing critical files and will not work.');
      process.exit(1);
    } else {
      console.log('\n✅ REPOSITORY VERIFICATION PASSED');
      console.log('The repository appears complete and should be functional.');
    }
  } catch (error) {
    console.error('💥 Audit failed:', error.message);
    process.exit(1);
  }
}

main();
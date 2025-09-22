import { Octokit } from '@octokit/rest'
import fs from 'fs';
import path from 'path';

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

async function uploadFile(octokit, repoOwner, repoName, localPath, repoPath) {
  try {
    if (!fs.existsSync(localPath)) {
      console.log(`⚠️  File not found locally: ${localPath}`);
      return false;
    }

    const content = fs.readFileSync(localPath);
    const base64Content = content.toString('base64');
    
    // Try to get existing file SHA
    let sha = null;
    try {
      const existing = await octokit.rest.repos.getContent({
        owner: repoOwner,
        repo: repoName,
        path: repoPath
      });
      if (existing.data.sha) {
        sha = existing.data.sha;
      }
    } catch (e) {
      // File doesn't exist - that's fine
    }

    const params = {
      owner: repoOwner,
      repo: repoName,
      path: repoPath,
      message: `Upload ${repoPath}`,
      content: base64Content
    };

    if (sha) {
      params.sha = sha;
    }

    await octokit.rest.repos.createOrUpdateFileContents(params);
    console.log(`✅ ${repoPath}`);
    return true;
  } catch (error) {
    console.log(`❌ Failed: ${repoPath} - ${error.message}`);
    return false;
  }
}

async function uploadCompleteProject() {
  try {
    const octokit = await getUncachableGitHubClient();
    const repoOwner = 'gitjiggy';
    const repoName = 'Clasio-Replit-MVP-Sep21';
    
    console.log('🚀 DEFINITIVE COMPLETE UPLOAD - Every Single File\n');
    
    // CRITICAL BACKEND FILES (MUST EXIST)
    const backendFiles = [
      'server/index.ts',
      'server/routes.ts', 
      'server/storage.ts',
      'server/db.ts',
      'server/vite.ts',
      'server/objectStorage.ts',
      'server/objectAcl.ts', 
      'server/driveService.ts',
      'server/aiQueueProcessor.ts',
      'server/auth.ts',
      'server/gemini.ts',
      'server/rateLimit.ts'
    ];
    
    // CRITICAL FRONTEND FILES (MUST EXIST)
    const frontendFiles = [
      'client/src/App.tsx',
      'client/src/main.tsx',
      'client/src/index.css',
      'client/index.html'
    ];
    
    // FRONTEND PAGES
    const pageFiles = [
      'client/src/pages/documents.tsx',
      'client/src/pages/drive.tsx', 
      'client/src/pages/auth-drive.tsx',
      'client/src/pages/not-found.tsx'
    ];
    
    // FRONTEND COMPONENTS
    const componentFiles = [
      'client/src/components/DocumentModal.tsx',
      'client/src/components/LoginModal.tsx',
      'client/src/components/ObjectUploader.tsx',
      'client/src/components/QueueStatusDashboard.tsx',
      'client/src/components/UserMenu.tsx'
    ];
    
    // FRONTEND CONTEXTS, HOOKS, LIB
    const utilFiles = [
      'client/src/contexts/AuthContext.tsx',
      'client/src/hooks/use-analytics.tsx',
      'client/src/hooks/use-mobile.tsx', 
      'client/src/hooks/use-toast.ts',
      'client/src/lib/analytics.ts',
      'client/src/lib/documentClassifications.ts',
      'client/src/lib/documentDisplay.ts',
      'client/src/lib/firebase.ts',
      'client/src/lib/queryClient.ts',
      'client/src/lib/utils.ts'
    ];
    
    let successCount = 0;
    let failCount = 0;
    
    console.log('🔥 UPLOADING CRITICAL BACKEND FILES:');
    for (const file of backendFiles) {
      const success = await uploadFile(octokit, repoOwner, repoName, file, file);
      if (success) successCount++; else failCount++;
    }
    
    console.log('\n🖥️  UPLOADING CRITICAL FRONTEND FILES:');
    for (const file of frontendFiles) {
      const success = await uploadFile(octokit, repoOwner, repoName, file, file);
      if (success) successCount++; else failCount++;
    }
    
    console.log('\n📄 UPLOADING PAGE FILES:');
    for (const file of pageFiles) {
      const success = await uploadFile(octokit, repoOwner, repoName, file, file);
      if (success) successCount++; else failCount++;
    }
    
    console.log('\n🧩 UPLOADING COMPONENT FILES:');
    for (const file of componentFiles) {
      const success = await uploadFile(octokit, repoOwner, repoName, file, file);
      if (success) successCount++; else failCount++;
    }
    
    console.log('\n🔧 UPLOADING UTILITY FILES:');
    for (const file of utilFiles) {
      const success = await uploadFile(octokit, repoOwner, repoName, file, file);
      if (success) successCount++; else failCount++;
    }
    
    // UPLOAD ALL UI COMPONENTS
    console.log('\n🎨 UPLOADING UI COMPONENTS:');
    const uiDir = 'client/src/components/ui';
    if (fs.existsSync(uiDir)) {
      const uiFiles = fs.readdirSync(uiDir).filter(f => f.endsWith('.tsx'));
      for (const file of uiFiles) {
        const filePath = `${uiDir}/${file}`;
        const success = await uploadFile(octokit, repoOwner, repoName, filePath, filePath);
        if (success) successCount++; else failCount++;
      }
    }
    
    console.log(`\n📊 UPLOAD SUMMARY:`);
    console.log(`✅ Successful uploads: ${successCount}`);
    console.log(`❌ Failed uploads: ${failCount}`);
    console.log(`📈 Success rate: ${Math.round((successCount / (successCount + failCount)) * 100)}%`);
    
    if (failCount === 0) {
      console.log(`\n🎉 ALL CRITICAL FILES UPLOADED SUCCESSFULLY!`);
      console.log(`The repository should now be complete and functional.`);
    } else {
      console.log(`\n⚠️  ${failCount} files failed to upload. Repository may still be incomplete.`);
    }
    
    console.log(`\n🔗 Repository: https://github.com/gitjiggy/Clasio-Replit-MVP-Sep21`);
    
  } catch (error) {
    console.error('❌ Complete upload failed:', error.message);
    throw error;
  }
}

async function main() {
  try {
    await uploadCompleteProject();
    console.log('\n🏁 DEFINITIVE UPLOAD COMPLETE');
  } catch (error) {
    console.error('💥 Upload failed:', error.message);
    process.exit(1);
  }
}

main();
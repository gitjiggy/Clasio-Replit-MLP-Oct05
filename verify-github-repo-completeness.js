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

async function getUncachableGitHubClient() {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

async function getGitHubFileContent(octokit, owner, repo, filePath) {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath
    });
    
    if (response.data.type === 'file') {
      return Buffer.from(response.data.content, 'base64').toString('utf8');
    }
    return null;
  } catch (error) {
    if (error.status === 404) {
      return null; // File not found
    }
    throw error;
  }
}

async function verifyRepositoryCompleteness() {
  try {
    console.log('🔍 Verifying GitHub repository completeness...');
    
    const octokit = await getUncachableGitHubClient();
    
    // Get repository info
    const user = await octokit.rest.users.getAuthenticated();
    const owner = user.data.login;
    const repo = 'Clasio-Replit-MLP-Sep25';
    
    console.log(`📁 Checking repository: ${owner}/${repo}`);
    
    let issues = [];
    let verified = [];
    
    // Critical files to verify
    const criticalFiles = [
      'package.json',
      'tsconfig.json',
      'vite.config.ts',
      'client/src/pages/documents.tsx',
      'client/src/lib/queryClient.ts',
      'server/routes.ts',
      'server/storage.ts',
      'shared/schema.ts',
      'README.md'
    ];
    
    console.log('\\n📋 Verifying Critical Files:');
    
    for (const filePath of criticalFiles) {
      if (fs.existsSync(filePath)) {
        const localContent = fs.readFileSync(filePath, 'utf8');
        const githubContent = await getGitHubFileContent(octokit, owner, repo, filePath);
        
        if (githubContent === null) {
          issues.push(`❌ MISSING: ${filePath} not found in GitHub repository`);
        } else if (localContent.trim() === githubContent.trim()) {
          verified.push(`✅ VERIFIED: ${filePath} matches local file`);
        } else {
          issues.push(`⚠️ MISMATCH: ${filePath} differs from local version`);
          console.log(`   Local size: ${localContent.length} chars, GitHub size: ${githubContent.length} chars`);
        }
      } else {
        issues.push(`⚠️ LOCAL MISSING: ${filePath} not found locally`);
      }
    }
    
    console.log('\\n🔍 Checking Critical Code Fixes:');
    
    // Check React Query Cache Fix
    const documentsContent = await getGitHubFileContent(octokit, owner, repo, 'client/src/pages/documents.tsx');
    if (documentsContent && documentsContent.includes('exact: false')) {
      verified.push('✅ VERIFIED: React Query cache fix (exact: false) present in GitHub');
    } else {
      issues.push('❌ CRITICAL: React Query cache fix missing from GitHub repository');
    }
    
    // Check AI Search Middleware Fix  
    const routesContent = await getGitHubFileContent(octokit, owner, repo, 'server/routes.ts');
    if (routesContent && routesContent.includes('app.post("/api/search", express.json({ limit: \'10mb\' })')) {
      verified.push('✅ VERIFIED: AI Search middleware fix (express.json) present in GitHub');
    } else {
      issues.push('❌ CRITICAL: AI Search middleware fix missing from GitHub repository');
    }
    
    console.log('\\n📊 Verification Results:');
    console.log(`\\n✅ VERIFIED (${verified.length}):`);
    verified.forEach(item => console.log(`  ${item}`));
    
    if (issues.length > 0) {
      console.log(`\\n❌ ISSUES FOUND (${issues.length}):`);
      issues.forEach(item => console.log(`  ${item}`));
      
      console.log('\\n🚨 RECOMMENDATION:');
      console.log('The repository has issues that may prevent successful vendor collaboration.');
      console.log('Consider re-uploading affected files to ensure complete accuracy.');
    } else {
      console.log('\\n🎉 REPOSITORY VERIFIED:');
      console.log('All critical files and fixes are properly uploaded to GitHub.');
      console.log('Repository is ready for vendor handoff!');
    }
    
    // Check directory structure
    console.log('\\n📁 Checking Directory Structure:');
    const directories = ['client/src', 'server', 'shared', 'migrations'];
    
    for (const dir of directories) {
      try {
        const response = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: dir
        });
        
        if (Array.isArray(response.data)) {
          verified.push(`✅ DIRECTORY: ${dir}/ (${response.data.length} items)`);
        }
      } catch (error) {
        if (error.status === 404) {
          issues.push(`❌ MISSING DIRECTORY: ${dir}/ not found in GitHub`);
        }
      }
    }
    
    console.log(`\\n📈 Final Summary:`);
    console.log(`✅ Verified: ${verified.length} items`);
    console.log(`❌ Issues: ${issues.length} items`);
    console.log(`🔗 Repository: https://github.com/${owner}/${repo}`);
    
    if (issues.length === 0) {
      console.log('\\n🎯 STATUS: READY FOR VENDOR HANDOFF');
    } else {
      console.log('\\n⚠️ STATUS: REQUIRES ATTENTION BEFORE VENDOR HANDOFF');
    }
    
  } catch (error) {
    console.error('❌ Verification Error:', error.message);
    process.exit(1);
  }
}

verifyRepositoryCompleteness();
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

async function verifyRepository() {
  try {
    const octokit = await getUncachableGitHubClient();
    const repoOwner = 'gitjiggy';
    const repoName = 'Clasio-Replit-MVP-Sep21';
    
    console.log('🔍 Verifying repository completeness...\n');
    
    // Critical files that MUST exist
    const criticalFiles = [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'drizzle.config.ts',
      'components.json',
      'postcss.config.js',
      'tailwind.config.ts',
      'vite.config.ts',
      'popup.png',
      'replit.md',
      'shared/schema.ts',
      'migrations/0001_add_unique_active_version_constraint.sql',
      'test/data/05-versions-space.pdf'
    ];
    
    let foundCount = 0;
    let missingCount = 0;
    
    console.log('📋 Checking critical files:');
    
    for (const filePath of criticalFiles) {
      try {
        await octokit.rest.repos.getContent({
          owner: repoOwner,
          repo: repoName,
          path: filePath
        });
        foundCount++;
        console.log(`✅ ${filePath}`);
      } catch (error) {
        missingCount++;
        console.log(`❌ MISSING: ${filePath}`);
      }
    }
    
    // Check for critical directories
    const criticalDirs = ['client', 'server', 'shared', 'migrations', 'test'];
    
    console.log('\n📁 Checking critical directories:');
    
    for (const dirName of criticalDirs) {
      try {
        const contents = await octokit.rest.repos.getContent({
          owner: repoOwner,
          repo: repoName,
          path: dirName
        });
        console.log(`✅ ${dirName}/ (${contents.data.length} items)`);
      } catch (error) {
        console.log(`❌ MISSING: ${dirName}/`);
      }
    }
    
    // Get full repository structure
    console.log('\n📊 Full repository structure:');
    
    async function listContents(path = '', depth = 0) {
      const indent = '  '.repeat(depth);
      try {
        const contents = await octokit.rest.repos.getContent({
          owner: repoOwner,
          repo: repoName,
          path: path
        });
        
        if (Array.isArray(contents.data)) {
          for (const item of contents.data) {
            console.log(`${indent}${item.type === 'dir' ? '📁' : '📄'} ${item.name}`);
            if (item.type === 'dir' && depth < 2) {
              await listContents(item.path, depth + 1);
            }
          }
        }
      } catch (error) {
        console.log(`${indent}❌ Error accessing ${path}`);
      }
    }
    
    await listContents();
    
    console.log(`\n🎯 Verification Summary:`);
    console.log(`✅ Critical files found: ${foundCount}/${criticalFiles.length}`);
    console.log(`❌ Critical files missing: ${missingCount}/${criticalFiles.length}`);
    
    if (missingCount === 0) {
      console.log(`\n🎉 REPOSITORY IS COMPLETE! All critical files are present.`);
    } else {
      console.log(`\n⚠️  Repository is missing ${missingCount} critical files.`);
    }
    
    console.log(`\n🔗 Repository URL: https://github.com/gitjiggy/Clasio-Replit-MVP-Sep21`);
    
  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    throw error;
  }
}

async function main() {
  try {
    await verifyRepository();
  } catch (error) {
    console.error('💥 Verification failed:', error.message);
    process.exit(1);
  }
}

main();
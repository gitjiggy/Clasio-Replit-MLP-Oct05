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

async function uploadMissingFiles() {
  try {
    const octokit = await getUncachableGitHubClient();
    const repoOwner = 'gitjiggy';
    const repoName = 'Clasio-Replit-MVP-Sep21';
    
    // List of critical files that MUST be in the repository
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
      'after_load.png',
      'replit.md',
      '.gitignore',
      '.replit'
    ];
    
    // Critical directories with their files
    const criticalDirectories = [
      { dir: 'shared', files: ['schema.ts'] },
      { dir: 'migrations', files: ['0001_add_unique_active_version_constraint.sql'] },
      { dir: 'test/data', files: ['05-versions-space.pdf'] }
    ];
    
    console.log('🔍 Uploading critical missing files...\n');
    
    let uploadedCount = 0;
    let failedCount = 0;
    
    // Upload critical root files
    for (const fileName of criticalFiles) {
      if (fs.existsSync(fileName)) {
        try {
          console.log(`📤 Uploading ${fileName}...`);
          
          const content = fs.readFileSync(fileName);
          const base64Content = content.toString('base64');
          
          await octokit.rest.repos.createOrUpdateFileContents({
            owner: repoOwner,
            repo: repoName,
            path: fileName,
            message: `Add critical file: ${fileName}`,
            content: base64Content
          });
          
          uploadedCount++;
          console.log(`✅ Successfully uploaded: ${fileName}`);
        } catch (error) {
          failedCount++;
          console.log(`❌ Failed to upload ${fileName}: ${error.message}`);
        }
      } else {
        console.log(`⚠️  File not found: ${fileName}`);
      }
    }
    
    // Upload critical directories
    for (const { dir, files } of criticalDirectories) {
      console.log(`\n📁 Processing directory: ${dir}/`);
      
      for (const fileName of files) {
        const filePath = `${dir}/${fileName}`;
        
        if (fs.existsSync(filePath)) {
          try {
            console.log(`📤 Uploading ${filePath}...`);
            
            const content = fs.readFileSync(filePath);
            const base64Content = content.toString('base64');
            
            await octokit.rest.repos.createOrUpdateFileContents({
              owner: repoOwner,
              repo: repoName,
              path: filePath,
              message: `Add critical file: ${filePath}`,
              content: base64Content
            });
            
            uploadedCount++;
            console.log(`✅ Successfully uploaded: ${filePath}`);
          } catch (error) {
            failedCount++;
            console.log(`❌ Failed to upload ${filePath}: ${error.message}`);
          }
        } else {
          console.log(`⚠️  File not found: ${filePath}`);
        }
      }
    }
    
    // Also upload entire directories if they exist
    const additionalDirs = ['shared', 'migrations', 'test'];
    
    for (const dirName of additionalDirs) {
      if (fs.existsSync(dirName)) {
        console.log(`\n📁 Uploading entire directory: ${dirName}/`);
        await uploadDirectory(octokit, repoOwner, repoName, dirName);
      }
    }
    
    console.log(`\n🎉 Critical Files Upload Summary:`);
    console.log(`✅ Successfully uploaded: ${uploadedCount} files`);
    console.log(`❌ Failed uploads: ${failedCount} files`);
    console.log(`\n🔗 Repository: https://github.com/gitjiggy/Clasio-Replit-MVP-Sep21`);
    
  } catch (error) {
    console.error('❌ Upload failed:', error.message);
    throw error;
  }
}

async function uploadDirectory(octokit, repoOwner, repoName, dirPath, basePath = '') {
  const items = fs.readdirSync(dirPath);
  
  for (const item of items) {
    const fullPath = `${dirPath}/${item}`;
    const relativePath = basePath ? `${basePath}/${item}` : `${dirPath}/${item}`;
    
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      await uploadDirectory(octokit, repoOwner, repoName, fullPath, relativePath);
    } else if (stat.isFile()) {
      try {
        const content = fs.readFileSync(fullPath);
        const base64Content = content.toString('base64');
        
        await octokit.rest.repos.createOrUpdateFileContents({
          owner: repoOwner,
          repo: repoName,
          path: relativePath,
          message: `Add ${relativePath}`,
          content: base64Content
        });
        
        console.log(`✅ ${relativePath}`);
      } catch (error) {
        console.log(`❌ Failed: ${relativePath} - ${error.message}`);
      }
    }
  }
}

async function main() {
  try {
    console.log('🚀 Fixing missing critical files in GitHub repository...\n');
    await uploadMissingFiles();
    console.log('\n🎉 CRITICAL FILES UPLOAD COMPLETE!');
    console.log('All essential project files should now be in the repository.');
  } catch (error) {
    console.error('💥 Upload failed:', error.message);
    process.exit(1);
  }
}

main();
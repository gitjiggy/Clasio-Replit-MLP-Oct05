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

async function createRepository() {
  const octokit = await getUncachableGitHubClient();
  
  try {
    const response = await octokit.rest.repos.createForAuthenticatedUser({
      name: 'Clasio-Replit-MLP-Sep25',
      description: 'Clasio Document Management System - Multi-tenant version with AI-powered Smart Organization',
      private: false,
      auto_init: false
    });
    
    console.log('✅ Repository created successfully:', response.data.html_url);
    return response.data;
  } catch (error) {
    if (error.status === 422 && error.message.includes('already exists')) {
      console.log('⚠️ Repository already exists, continuing with file uploads...');
      // Get existing repo info
      const user = await octokit.rest.users.getAuthenticated();
      return { 
        owner: { login: user.data.login }, 
        name: 'Clasio-Replit-MLP-Sep25',
        html_url: `https://github.com/${user.data.login}/Clasio-Replit-MLP-Sep25`
      };
    }
    throw error;
  }
}

async function uploadFile(octokit, owner, repo, filePath, content) {
  try {
    // Check if file exists
    let sha = null;
    try {
      const existing = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: filePath
      });
      sha = existing.data.sha;
    } catch (error) {
      // File doesn't exist, which is fine
    }

    const response = await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message: sha ? `Update ${filePath}` : `Add ${filePath}`,
      content: Buffer.from(content).toString('base64'),
      sha
    });
    
    console.log(`✅ Uploaded: ${filePath}`);
    return response;
  } catch (error) {
    console.error(`❌ Failed to upload ${filePath}:`, error.message);
    throw error;
  }
}

async function uploadDirectory(octokit, owner, repo, localDir, githubPath = '') {
  const items = fs.readdirSync(localDir);
  
  for (const item of items) {
    const localPath = path.join(localDir, item);
    const remotePath = githubPath ? `${githubPath}/${item}` : item;
    
    const stats = fs.statSync(localPath);
    
    if (stats.isDirectory()) {
      // Skip certain directories
      if (item === 'node_modules' || item === '.git' || item === 'dist' || item === 'build') {
        continue;
      }
      await uploadDirectory(octokit, owner, repo, localPath, remotePath);
    } else {
      // Skip certain files
      if (item.endsWith('.log') || item.includes('.png') || item.includes('.jpg') || item.includes('.jpeg')) {
        continue;
      }
      
      const content = fs.readFileSync(localPath, 'utf8');
      await uploadFile(octokit, owner, repo, remotePath, content);
    }
  }
}

async function createReadme() {
  const readmeContent = `# Clasio Document Management System

## Overview

Clasio is a modern, multi-tenant document management system built with React and Express.js, featuring AI-powered document analysis using Google's Gemini AI. The application allows users to upload, organize, and analyze documents with features like folders, tags, version control, and automatic AI summarization.

## 🌟 Key Features

### Core Document Management
- **Multi-file Upload**: Advanced drag-and-drop interface with progress tracking
- **File Organization**: Hierarchical folder structure with unlimited nesting
- **Tagging System**: Flexible document categorization and filtering
- **Version Control**: Complete document revision history
- **Document Viewer**: In-browser preview for multiple file types
- **Search & Filter**: Comprehensive search with type, folder, and tag filters

### AI-Powered Features
- **Smart Organization**: AI automatically suggests folder organization and creates descriptive folder names
- **Document Analysis**: Automatic summarization and key topic extraction using Google Gemini 2.5 Flash
- **AI Search**: Intelligent document search with relevance scoring
- **Content Classification**: Automatic document type detection and categorization
- **Duplicate Detection**: Smart identification of duplicate files across the system

### Multi-Tenant Architecture
- **User Isolation**: Complete data separation between users using Firebase Authentication
- **Secure File Storage**: Google Cloud Storage with custom ACL (Access Control List) system
- **Role-Based Access**: Granular permissions system for document access control

### Advanced Upload System
- **Bulk Upload**: Process multiple files simultaneously with real-time progress
- **Direct Cloud Upload**: Files upload directly to Google Cloud Storage with presigned URLs
- **Smart Processing**: Automatic file type detection and validation
- **Upload Recovery**: Resilient upload system with retry capabilities

## 🎯 What's New for Sep 25, 2025

### Critical Bug Fixes & Performance Improvements
- **✅ FIXED: React Query Cache Invalidation**: Resolved critical issue where document cards weren't showing updated Smart Organization folder assignments
- **✅ FIXED: AI Search JSON Middleware**: Added missing Express.json middleware to \`/api/search\` endpoint, restoring AI search functionality
- **✅ PERFECT 1:1 CORRESPONDENCE**: Achieved perfect synchronization between Smart Organization panel and document cards using \`exact: false\` parameter in cache invalidation

### Smart Organization Enhancements
- **Descriptive Folder Names**: AI now creates perfect descriptive folder names like "Cybersecurity Risk Analysis", "Property Viewing List", "2023 Knee Report"
- **Real-time Updates**: Document cards now immediately reflect Smart Organization changes without page refresh
- **Enhanced AI Analysis**: Improved accuracy and speed of document categorization

### Frontend Cache Management
- **Intelligent Cache Strategy**: Implemented sophisticated React Query cache invalidation that matches all document queries regardless of filter parameters
- **Seamless UX**: Users now see instant updates when Smart Organization processes complete
- **Performance Optimization**: Reduced unnecessary API calls while maintaining data freshness

### GitHub Repository Preparation
- **Vendor Handoff Ready**: Complete repository structure prepared for external frontend vendor collaboration
- **Comprehensive Documentation**: Full feature documentation and setup instructions
- **Architecture Validation**: Architect-reviewed codebase ensuring all essential files are included

## 🏗️ Architecture

### Frontend Stack
- **React 18** with TypeScript
- **Vite** for build tooling and development server
- **Tailwind CSS** + **Shadcn/UI** for styling and components
- **TanStack Query** (React Query) for server state management
- **Wouter** for lightweight client-side routing
- **Uppy.js** for advanced file upload functionality

### Backend Stack
- **Express.js** with TypeScript
- **Drizzle ORM** for type-safe database operations
- **PostgreSQL** (Neon serverless) for data persistence
- **Google Cloud Storage** for file storage
- **Firebase Authentication** for user management
- **Google Gemini AI** for document analysis

### Database Schema
- \`users\`: User profiles and preferences
- \`documents\`: Document metadata with AI analysis results
- \`document_versions\`: Complete version control system
- \`folders\`: Hierarchical organization structure
- \`tags\`: Flexible tagging system
- \`document_tags\`: Many-to-many document-tag relationships

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- PostgreSQL database
- Google Cloud Storage bucket
- Firebase project
- Google Gemini AI API access

### Environment Variables
Create a \`.env\` file in the project root:

\`\`\`env
# Database
DATABASE_URL=your_postgresql_connection_string

# Google Cloud Storage
GCP_PROJECT_ID=your_gcp_project_id
GCP_SERVICE_ACCOUNT_KEY=your_service_account_json_key
GCS_BUCKET_NAME=your_bucket_name

# Firebase
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_firebase_auth_domain
VITE_FIREBASE_PROJECT_ID=your_firebase_project_id

# Google AI
GEMINI_API_KEY=your_gemini_api_key

# Optional
TRASH_RETENTION_DAYS=7
\`\`\`

### Installation & Setup

1. **Clone the repository**
   \`\`\`bash
   git clone https://github.com/gitjiggy/Clasio-Replit-MLP-Sep25.git
   cd Clasio-Replit-MLP-Sep25
   \`\`\`

2. **Install dependencies**
   \`\`\`bash
   npm install
   \`\`\`

3. **Setup database**
   \`\`\`bash
   npm run db:push
   \`\`\`

4. **Start development server**
   \`\`\`bash
   npm run dev
   \`\`\`

The application will be available at \`http://localhost:5000\`

## 📁 Project Structure

\`\`\`
├── client/                 # Frontend React application
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/         # Application pages/routes
│   │   ├── lib/           # Utilities and helpers
│   │   ├── hooks/         # Custom React hooks
│   │   └── contexts/      # React contexts
│   └── index.html
├── server/                # Backend Express application
│   ├── routes.ts          # API route definitions
│   ├── storage.ts         # Database layer
│   ├── gemini.ts          # AI integration
│   ├── objectStorage.ts   # File storage handling
│   └── aiQueueProcessor.ts # Background AI processing
├── shared/                # Shared types and schemas
│   └── schema.ts          # Database schema definitions
├── migrations/            # Database migrations
└── package.json           # Dependencies and scripts
\`\`\`

## 🔧 Development Commands

- \`npm run dev\` - Start development server
- \`npm run build\` - Build for production
- \`npm run db:push\` - Push schema changes to database
- \`npm run db:push --force\` - Force push schema changes

## 🔒 Security Features

- **Firebase Authentication**: Secure user authentication and session management
- **Custom ACL System**: Fine-grained file access control
- **Input Validation**: Comprehensive request validation using Zod schemas
- **File Type Validation**: Server-side MIME type verification
- **Rate Limiting**: API rate limiting to prevent abuse
- **Secure File Storage**: Direct-to-cloud uploads with presigned URLs

## 🤖 AI Integration

### Document Analysis Pipeline
1. **Upload Processing**: Files uploaded to Google Cloud Storage
2. **Queue Processing**: Documents added to AI analysis queue
3. **Content Extraction**: Text extraction from various file types
4. **AI Analysis**: Google Gemini analyzes content for:
   - Document summarization
   - Key topic extraction
   - Document classification
   - Smart folder suggestions
5. **Database Storage**: Analysis results stored for instant retrieval

### Smart Organization
- **Automatic Categorization**: AI suggests optimal folder structures
- **Descriptive Naming**: Creates meaningful folder names based on content
- **Real-time Processing**: Background processing with live UI updates
- **User Override**: Users can accept, modify, or reject AI suggestions

## 🌐 Deployment

The application is designed to run on modern cloud platforms with:
- Node.js runtime support
- PostgreSQL database
- Environment variable configuration
- Static file serving capabilities

## 📄 License

This project is proprietary software developed for Clasio Document Management System.

## 🤝 Contributing

This repository is prepared for external vendor collaboration. For development guidelines and contribution protocols, please refer to the project documentation and coordinate with the project maintainers.

---

**Built with ❤️ for modern document management**
`;

  return readmeContent;
}

async function main() {
  try {
    console.log('🚀 Starting GitHub repository creation and upload...');
    
    // Step 1: Create repository
    console.log('📁 Creating GitHub repository...');
    const repo = await createRepository();
    
    // Step 2: Create README
    console.log('📝 Creating README.md...');
    const readmeContent = await createReadme();
    
    const octokit = await getUncachableGitHubClient();
    const owner = repo.owner.login;
    const repoName = repo.name;
    
    // Step 3: Upload README first
    await uploadFile(octokit, owner, repoName, 'README.md', readmeContent);
    
    // Step 4: Upload essential configuration files
    console.log('⚙️ Uploading configuration files...');
    const configFiles = [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'vite.config.ts',
      'drizzle.config.ts',
      'tailwind.config.ts',
      'postcss.config.js',
      'components.json',
      'replit.md'
    ];
    
    for (const file of configFiles) {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf8');
        await uploadFile(octokit, owner, repoName, file, content);
      }
    }
    
    // Step 5: Upload source directories
    console.log('📦 Uploading source code...');
    const sourceDirs = ['client', 'server', 'shared'];
    
    for (const dir of sourceDirs) {
      if (fs.existsSync(dir)) {
        console.log(`📁 Uploading ${dir}/...`);
        await uploadDirectory(octokit, owner, repoName, dir);
      }
    }
    
    // Step 6: Upload migrations
    if (fs.existsSync('migrations')) {
      console.log('🗃️ Uploading database migrations...');
      await uploadDirectory(octokit, owner, repoName, 'migrations');
    }
    
    console.log('\\n✅ Repository creation and upload completed successfully!');
    console.log(`🔗 Repository URL: ${repo.html_url}`);
    console.log('\\n📋 Summary:');
    console.log('- Repository created: Clasio-Replit-MLP-Sep25');
    console.log('- All source code uploaded (client, server, shared)');
    console.log('- Configuration files uploaded');
    console.log('- Comprehensive README.md with Sep 25 updates');
    console.log('- Database migrations included');
    console.log('- Ready for vendor collaboration');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
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
  // Add UI components
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

async function recreateAndUploadRepository() {
  try {
    console.log('Starting complete GitHub repository upload...');
    
    const octokit = await getUncachableGitHubClient();
    const repo = 'Clasio-Replit-MLP-Sep26';
    
    // Get authenticated user
    const { data: user } = await octokit.rest.users.getAuthenticated();
    console.log('Authenticated as:', user.login);
    
    // Delete existing repository to start fresh
    try {
      await octokit.rest.repos.delete({
        owner: user.login,
        repo: repo
      });
      console.log('✅ Existing repository deleted');
      // Wait for deletion to complete
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (error) {
      console.log('ℹ️  Repository deletion not needed (might not exist)');
    }
    
    // Create fresh repository
    try {
      const { data: repoData } = await octokit.rest.repos.createForAuthenticatedUser({
        name: repo,
        description: 'Clasio Document Management System - Multi-tenant React/Express application with AI-powered document analysis. Updated Sep 26, 2025 with Drive Sync and AI features.',
        private: false,
        auto_init: false
      });
      console.log('✅ Fresh repository created:', repoData.html_url);
    } catch (error) {
      console.error('❌ Failed to create repository:', error.message);
      return;
    }
    
    // Wait for repository to be ready
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
        
        // Upload file (no SHA needed for new files)
        await octokit.rest.repos.createOrUpdateFileContents({
          owner: user.login,
          repo: repo,
          path: filePath,
          message: `Add ${filePath}`,
          content: base64Content
        });
        
        console.log(`✅ Uploaded: ${filePath}`);
        uploadCount++;
        
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        console.error(`❌ Failed to upload ${filePath}:`, error.message);
        skippedCount++;
      }
    }
    
    // Create a comprehensive README
    const readmeContent = `# Clasio Document Management System

A modern, multi-tenant document management system built with React and Express, featuring AI-powered document analysis using Google's Gemini AI.

## 🚀 Features

### Core Functionality
- **Document Upload & Management**: Drag-and-drop file uploads with comprehensive metadata storage
- **AI-Powered Analysis**: Automatic document summarization, topic extraction, and sentiment analysis
- **Google Drive Integration**: Seamless sync with Google Drive accounts including real-time analysis
- **Multi-Tenant Architecture**: Secure user isolation with role-based access control
- **Advanced Search**: Policy-driven search with field-aware scoring and tier routing
- **Smart Organization**: AI-suggested folder organization and automatic tagging

### Technical Highlights
- **Modern Stack**: React 18 + TypeScript + Express + PostgreSQL
- **Real-time UI**: TanStack Query for optimal state management
- **Scalable Storage**: Google Cloud Storage integration for reliable file hosting  
- **Security-First**: Comprehensive input validation and sanitization
- **Production-Ready**: Rate limiting, error handling, and monitoring

## 🛠️ Technology Stack

### Frontend
- **React 18** with TypeScript for type-safe development
- **Vite** for fast development and optimized builds
- **TanStack Query** for server state management
- **Shadcn/ui** + **Tailwind CSS** for modern, accessible UI components
- **Wouter** for lightweight routing

### Backend
- **Express.js** with TypeScript
- **Drizzle ORM** for type-safe database operations
- **PostgreSQL** via Neon serverless for scalable data storage
- **Google Cloud Storage** for file hosting
- **Google Gemini AI** for document analysis

### Infrastructure
- **Multi-tenant database design** with proper user isolation
- **Policy-driven search engine** with query classification
- **Comprehensive error handling** and logging
- **Rate limiting** and security middleware

## 📁 Project Structure

\`\`\`
├── client/                 # React frontend application
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/         # Route-based page components
│   │   ├── lib/           # Utility libraries and configurations
│   │   └── hooks/         # Custom React hooks
├── server/                # Express backend application  
│   ├── routes.ts          # API route definitions
│   ├── storage.ts         # Database abstraction layer
│   ├── aiQueueProcessor.ts # Background AI analysis
│   └── driveService.ts    # Google Drive integration
├── shared/                # Shared types and schemas
│   └── schema.ts          # Database schema definitions
├── migrations/            # Database migration files
└── README.md             # This file
\`\`\`

## 🔧 Setup & Installation

### Prerequisites
- Node.js 18+ 
- PostgreSQL database
- Google Cloud Storage bucket
- Google Gemini AI API access
- Google Drive API credentials (for Drive sync)

### Environment Variables
Create a \`.env\` file with:

\`\`\`bash
# Database
DATABASE_URL=postgresql://username:password@host:port/database

# Google Cloud Storage  
GCP_PROJECT_ID=your-project-id
GCP_SERVICE_ACCOUNT_KEY=your-service-account-key
GCS_BUCKET_NAME=your-bucket-name

# Google Gemini AI
GOOGLE_AI_API_KEY=your-gemini-api-key

# Google Drive API (for sync feature)
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret

# App Configuration
NODE_ENV=development
VITE_APP_URL=http://localhost:5000
\`\`\`

### Installation Steps

1. **Clone the repository**
   \`\`\`bash
   git clone https://github.com/${user.login}/Clasio-Replit-MLP-Sep26.git
   cd Clasio-Replit-MLP-Sep26
   \`\`\`

2. **Install dependencies**
   \`\`\`bash
   npm install
   \`\`\`

3. **Set up the database**
   \`\`\`bash
   npm run db:push
   \`\`\`

4. **Start the development server**
   \`\`\`bash
   npm run dev
   \`\`\`

   The application will be available at \`http://localhost:5000\`

## 🚦 Development Commands

- \`npm run dev\` - Start development server
- \`npm run build\` - Build for production  
- \`npm run db:push\` - Push database schema changes
- \`npm run db:studio\` - Open database studio

## 🔄 Recent Updates (September 26, 2025)

### Major Enhancements
1. **Google Drive Sync Integration**
   - Complete OAuth2 authentication flow
   - Real-time document synchronization
   - AI analysis integration for Drive documents
   - Smart Organization for synced files

2. **Multi-Tenant Architecture Implementation**
   - User-based document isolation
   - Secure access control throughout the application
   - Database schema updates with proper foreign key relationships

3. **Advanced Search System**
   - Policy-driven search with query classification
   - Field-aware lexical scoring
   - Tier-based routing for optimal performance
   - Comprehensive search instrumentation

4. **Production Readiness Improvements**
   - Enhanced error handling and logging
   - Rate limiting implementation
   - Security hardening
   - Performance optimizations

### Technical Improvements
- Fixed Drive sync content storage for AI analysis
- Implemented proper middleware exclusion patterns
- Enhanced file upload reliability
- Improved toast notification system
- Streamlined authentication flows

## 🤝 Contributing

This repository is configured for external vendor collaboration. Key areas for contribution:

1. **Frontend Enhancements**: UI/UX improvements, new features
2. **Backend Optimizations**: Performance improvements, new integrations  
3. **AI/ML Features**: Enhanced document analysis capabilities
4. **Security Auditing**: Security improvements and compliance
5. **Testing**: Comprehensive test coverage

## 📄 License

This project is proprietary software developed for Clasio. All rights reserved.

## 🆘 Support

For technical support or questions about this repository, please contact the development team.

---

**Last Updated**: September 26, 2025
**Repository Version**: v2.0.0 - Multi-tenant with Drive Sync
`;

    try {
      await octokit.rest.repos.createOrUpdateFileContents({
        owner: user.login,
        repo: repo,
        path: 'README.md',
        message: 'Add comprehensive README with setup instructions and feature documentation',
        content: Buffer.from(readmeContent).toString('base64')
      });
      console.log('✅ Updated comprehensive README');
    } catch (error) {
      console.error('❌ Failed to update README:', error.message);
    }
    
    console.log(`\n🎉 Repository upload complete!`);
    console.log(`✅ Successfully uploaded: ${uploadCount} files`);
    console.log(`⚠️  Skipped: ${skippedCount} files`);
    console.log(`🔗 Repository URL: https://github.com/${user.login}/${repo}`);
    console.log(`📋 Ready for external vendor collaboration`);
    
  } catch (error) {
    console.error('❌ Process failed:', error);
    throw error;
  }
}

// Run the complete upload process
recreateAndUploadRepository().catch(console.error);
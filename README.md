# Clasio - Modern Document Management System

A powerful, AI-enhanced document management platform built for modern organizations. Clasio combines intelligent document organization, advanced search capabilities, Google Drive integration, and AI-powered analysis in a secure, multi-tenant architecture.

## 🌟 Overview

Clasio transforms how teams manage, search, and analyze documents. With cutting-edge AI integration using Google Gemini, advanced policy-driven search, and seamless Google Drive connectivity, Clasio makes document management intelligent and effortless.

**Key Capabilities:**
- **Smart Document Organization** with folders, tags, and AI categorization
- **Advanced Search Engine** with policy-driven query classification and tier routing
- **AI-Powered Analysis** using Google Gemini for summarization and insights
- **Secure Google Drive Integration** with enterprise-grade authentication
- **Multi-Tenant Architecture** with complete user data isolation
- **Real-Time Processing** with queue-based AI analysis and background jobs

## 🚀 Core Features

### 📁 Document Management
- **Multi-Format Support**: Handle PDFs, Word documents, Excel files, PowerPoint presentations, images, and more
- **Intelligent Organization**: Create hierarchical folder structures and flexible tagging systems
- **Version Control**: Automatic document versioning with complete revision history
- **Bulk Operations**: Upload and manage multiple documents simultaneously with progress tracking
- **Advanced Metadata**: Rich document properties with AI-enhanced categorization

### 🔍 Advanced Search Technology
- **Policy-Driven Search Engine**: Intelligent query classification with 7 distinct query types
- **Multi-Tier Architecture**: Optimized performance with T1/T2/T3 tier routing
- **Field-Aware Scoring**: Context-sensitive relevance calculations with proximity bonuses
- **Query Intelligence**: Automatic classification of entities, dates, codes, phrases, and topics
- **Search Analytics**: Comprehensive instrumentation with performance metrics and anomaly detection

### 🤖 AI-Powered Intelligence
- **Document Summarization**: Automatic content summaries using Google Gemini 2.5 Flash
- **Topic Extraction**: Intelligent identification of key themes and subjects
- **Content Classification**: Automatic document type and category detection
- **Sentiment Analysis**: Understanding document tone and emotional context
- **Smart Recommendations**: AI-driven suggestions for organization and discovery

### 🔗 Google Drive Integration
- **Seamless Connectivity**: Direct import and synchronization with Google Drive
- **Real-Time Access**: Live viewing and management of Drive documents
- **Permission Preservation**: Maintain Google Drive sharing and access controls
- **Automatic Sync**: Background synchronization of changes and updates
- **Collaborative Features**: Support for shared drives and team collaboration

### 🛡️ Enterprise Security
- **Multi-Tenant Architecture**: Complete data isolation between organizations
- **Advanced Authentication**: Firebase integration with custom session management
- **Access Control**: Granular permissions with custom ACL system
- **Secure File Storage**: Google Cloud Storage with proper access controls
- **Rate Limiting**: Protection against abuse with intelligent throttling

## 🏗️ Technology Stack

### Frontend
- **React 18** with TypeScript for type-safe component development
- **Vite** for lightning-fast development and optimized production builds
- **Shadcn/ui + Radix UI** for accessible, customizable component library
- **Tailwind CSS** with custom design system and dark/light mode support
- **TanStack Query** for efficient server state management and caching
- **Wouter** for lightweight client-side routing

### Backend
- **Express.js** with TypeScript for robust API development
- **Drizzle ORM** for type-safe database operations with PostgreSQL
- **Firebase Authentication** with custom token validation middleware
- **Google Cloud Storage** for scalable file storage and CDN delivery
- **Google Gemini AI** for intelligent document analysis
- **Advanced Security** with Helmet.js, CORS, rate limiting, and CSRF protection

### Infrastructure
- **PostgreSQL** database with Neon serverless hosting
- **Google Cloud Platform** for storage and AI services
- **Comprehensive Logging** with structured JSON and correlation tracking
- **Queue Processing** for background AI analysis and file operations
- **Environment-Based Configuration** for development, staging, and production

## ⚡ Quick Start

### Prerequisites
- Node.js 18 or higher
- PostgreSQL database (Neon recommended)
- Google Cloud Platform account with Storage API
- Firebase project with Authentication enabled
- Google Gemini API key (optional, for AI features)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/gitjiggy/Clasio-Replit-MLP-Sep27.git
   cd Clasio-Replit-MLP-Sep27
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment configuration**
   Create a `.env` file with:
   ```env
   # Database
   DATABASE_URL=postgresql://user:password@host:port/database
   
   # Firebase
   VITE_FIREBASE_PROJECT_ID=your-firebase-project-id
   
   # Google Cloud Storage
   GCP_PROJECT_ID=your-gcp-project-id
   GCP_SERVICE_ACCOUNT_KEY=your-service-account-key-json
   GCS_BUCKET_NAME=your-storage-bucket-name
   
   # AI Integration (Optional)
   GEMINI_API_KEY=your-gemini-api-key
   
   # Configuration
   PORT=5000
   NODE_ENV=development
   TRASH_RETENTION_DAYS=7
   ```

4. **Database setup**
   ```bash
   npm run db:push
   ```

5. **Start development server**
   ```bash
   npm run dev
   ```

   Access the application at `http://localhost:5000`

## 📂 Project Architecture

```
Clasio-Replit-MLP-Sep27/
├── client/                     # React frontend application
│   ├── src/
│   │   ├── components/         # Reusable UI components
│   │   │   ├── ui/            # Shadcn/ui component library
│   │   │   ├── DocumentModal.tsx
│   │   │   ├── ObjectUploader.tsx
│   │   │   ├── QueueStatusDashboard.tsx
│   │   │   └── UserMenu.tsx
│   │   ├── contexts/          # React context providers
│   │   │   └── AuthContext.tsx
│   │   ├── hooks/             # Custom React hooks
│   │   ├── lib/               # Utility libraries and configurations
│   │   │   ├── firebase.ts
│   │   │   ├── queryClient.ts
│   │   │   └── analytics.ts
│   │   ├── pages/             # Application pages and routes
│   │   │   ├── documents.tsx
│   │   │   ├── drive.tsx
│   │   │   ├── auth-drive.tsx
│   │   │   └── trash.tsx
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── index.html
├── server/                     # Express backend application
│   ├── aiQueueProcessor.ts     # AI analysis queue management
│   ├── auth.ts                 # Firebase authentication middleware
│   ├── cookieAuth.ts           # Secure cookie authentication
│   ├── driveService.ts         # Google Drive API integration
│   ├── fieldAwareLexical.ts    # Advanced search lexical analysis
│   ├── gemini.ts               # Google Gemini AI integration
│   ├── policyDrivenSearch.ts   # Advanced search engine
│   ├── queryAnalysis.ts        # Search query classification
│   ├── routes.ts               # API route definitions
│   ├── security.ts             # Security configuration
│   ├── storage.ts              # Database abstraction layer
│   └── index.ts                # Server entry point
├── shared/
│   └── schema.ts               # Shared database schema definitions
├── migrations/                 # Database migration files
├── package.json               # Dependencies and scripts
├── tsconfig.json              # TypeScript configuration
├── vite.config.ts             # Vite build configuration
├── tailwind.config.ts         # Tailwind CSS configuration
└── drizzle.config.ts          # Database ORM configuration
```

## 🔧 Key Features in Detail

### Advanced Search Engine
The policy-driven search system automatically classifies queries and routes them through optimized tiers:

- **Entity Proper**: People, organizations, locations ("Apple Inc.", "John Smith")
- **ID/Code**: Identifiers and reference codes ("DOC-2024-001", "1099-INT")
- **Date/Range**: Temporal queries ("last month", "Q4 2024")
- **Short Keyword**: Simple searches (1-3 words)
- **Phrase**: Exact phrase matching ("quarterly financial report")
- **Question**: Natural language questions ("What are the budget projections?")
- **Topic Freeform**: Complex topical searches with multiple concepts

### AI Document Analysis
Powered by Google Gemini 2.5 Flash for:
- **Intelligent Summarization**: Contextual document summaries
- **Topic Extraction**: Key themes and subject identification
- **Classification**: Automatic document type and category detection
- **Content Understanding**: Deep analysis of document structure and meaning
- **Queue Processing**: Background analysis with priority management

### Google Drive Integration
Enterprise-grade integration featuring:
- **Secure Authentication**: httpOnly cookies with CSRF protection
- **Real-Time Sync**: Automatic synchronization of changes
- **Permission Mapping**: Preserve Google Drive access controls
- **Bulk Import**: Efficient mass document import from Drive
- **Collaborative Access**: Support for shared drives and team folders

## 🔥 What's New for September 27, 2025

### 🏢 **Multi-Tenant Architecture Conversion**

Today we completed the complete transformation from single-user to enterprise-grade multi-tenant architecture, making Clasio production-ready for enterprise deployment.

#### **🔄 Complete Multi-Tenant Infrastructure**
**Major Achievement**: Successfully converted entire application architecture from single-user to full multi-tenant system.

**Implementation Details**:
- **Tenant Isolation**: Complete data isolation between tenants with secure user access controls
- **User Context**: All operations now scoped to authenticated user context
- **Database Architecture**: Updated all queries to include tenant/user filtering
- **File Storage**: Multi-tenant file organization in Google Cloud Storage (`users/{userId}/docs/`)
- **Security**: Enhanced authentication and authorization for multi-tenant access

#### **🛠️ Enterprise-Grade Durability & Security**
**System Reliability**: Implemented advanced transaction management and error handling for production stability.

**Key Enhancements**:
- **Drive-Aware Idempotency**: Time-based expiration system (1-hour for Drive operations vs permanent for regular operations)
- **Transaction Management**: Robust transaction handling with rollback capabilities
- **Enhanced Error Handling**: User-friendly error messages with actionable guidance
- **Security Hardening**: Advanced authentication, authorization, and data protection measures

#### **📊 Observability & Monitoring Infrastructure**
**Production Monitoring**: Comprehensive monitoring and observability for enterprise operations.

**Monitoring Features**:
- **Request Tracking**: Unique request IDs with latency monitoring and error correlation
- **Health Check System**: Advanced health monitoring for all system components
- **Queue Metrics**: Real-time AI processing queue monitoring and performance tracking
- **Search Analytics**: Complete search instrumentation with query analysis and performance metrics
- **Error Correlation**: Comprehensive logging with structured JSON and correlation tracking

### 🚀 **Google Drive Integration Overhaul**

#### **🔧 Critical Storage Architecture Fix**
**Problem Resolved**: Drive documents were previously stored only in database without proper file storage.

**Solution Implemented**:
- **Unified Storage**: Drive documents now properly upload to Google Cloud Storage with consistent `objectPath` values
- **File Consistency**: Both computer-based and Drive-based uploads use identical GCS storage pattern
- **Storage Verification**: All upload methods confirmed working with proper file storage in GCS
- **Data Integrity**: Fixed critical issue where Drive sync wasn't creating actual files in storage

#### **🔄 Enhanced Drive Sync System**
**User Experience**: Dramatically improved Drive synchronization with better error handling and responsiveness.

**Key Improvements**:
- **Fixed Refresh Functionality**: Refresh button now properly refreshes both connection status AND drive documents
- **Auto-Refresh Enhancement**: 5-second connection status refresh and 10-second document refresh intervals
- **Visual Feedback**: Enhanced refresh button with loading states and visual indicators
- **Better Error Messages**: Specific user-friendly error messages with actionable guidance
- **Sync Status**: Real-time sync status with comprehensive feedback

#### **⚡ Bulk Upload System Restoration**
**Critical Fix**: Resolved complete failure of bulk upload functionality that was preventing multi-document uploads.

**Technical Resolution**:
- **Root Cause**: Missing `express.json()` middleware on critical bulk upload routes
- **Routes Fixed**: 
  - `/api/upload/bulk-upload-urls` (presigned URL generation)
  - `/api/documents/bulk` (bulk document creation)
- **Verification**: Both computer-based and Drive-based bulk uploads now working correctly
- **User Impact**: Users can now upload multiple documents simultaneously without failures

### 🔍 **Advanced Search Engine Revolution**

#### **🎯 Policy-Driven Search Implementation**
**Search Evolution**: Complete replacement of hardcoded search logic with intelligent policy-based system.

**Advanced Features**:
- **7-Class Query Analyzer**: Intelligent classification of query types
  - `entity.proper` (people, organizations, places)
  - `id/code` (identifiers like "1099-INT")
  - `date/range` (temporal queries)
  - `short.keyword` (1-3 common tokens)
  - `phrase` (quoted or exact phrases)
  - `question` (question-like queries)
  - `topic.freeform` (complex multi-concept searches)

#### **⚡ Smart Performance Optimization**
**Search Performance**: Multi-tier routing system with performance-based optimization.

**Technical Implementation**:
- **Field-Aware Scoring**: Per-field lexical signals with max-field logic and proximity bonuses
- **Tier Routing**: Policy-driven tier selection with performance caps (T1: 0.99, T2: 0.70, T3: 0.45)
- **Exact Phrase Detection**: High-signal field matching for proper noun routing
- **Search Instrumentation**: Comprehensive logging with QueryAnalysis traces and anomaly detection

### ⚡ **Performance & Reliability Enhancements**

#### **🔄 Embedding/Search Invalidation System**
**Search Consistency**: Sub-5-minute SLA for reindex operations ensuring consistent search results.

**Key Features**:
- **Fast Reindexing**: Automated reindex operations with <5 minute completion SLA
- **Search Consistency**: Ensures all upload methods maintain consistent search index
- **Background Processing**: Non-blocking reindex operations for better user experience
- **Monitoring**: Real-time monitoring of reindex operations and performance metrics

#### **📁 Unified File Storage Architecture**
**Storage Consistency**: All upload methods now use consistent Google Cloud Storage patterns.

**Architectural Improvements**:
- **Computer Uploads**: `users/${uid}/docs/${docId}/${originalname}`
- **Drive Uploads**: `users/${userId}/docs/${docId}/${driveFile.name}`
- **Consistent Paths**: Identical folder structure for all upload sources
- **Multi-Tenant Support**: Proper user isolation in storage hierarchy

### 🛡️ **Production Security & Stability**

#### **🔒 Enhanced Authentication System**
**Security Foundation**: Building on Sep 26 security improvements with additional hardening.

**Additional Security Measures**:
- **Multi-Tenant Security**: Enhanced user context validation and data isolation
- **Session Management**: Improved session handling for multi-user environments
- **API Security**: Enhanced rate limiting and request validation
- **Data Protection**: Additional layers of data protection for enterprise deployment

#### **📈 Enterprise Monitoring**
**Production Readiness**: Comprehensive monitoring and alerting for enterprise operations.

**Monitoring Capabilities**:
- **Performance Metrics**: Real-time performance tracking across all system components
- **Error Tracking**: Comprehensive error tracking with correlation and alerting
- **Usage Analytics**: Detailed usage analytics for capacity planning
- **Health Dashboards**: Real-time health dashboards for system monitoring

### 🎯 **Production Launch Readiness**

#### **✅ Verification & Testing**
**End-to-End Validation**: Comprehensive testing of all systems for production readiness.

**Validated Systems**:
- ✅ Multi-tenant data isolation and security
- ✅ Google Drive integration with proper file storage
- ✅ Bulk upload functionality for all upload methods
- ✅ Advanced search with policy-driven routing
- ✅ AI processing queue with monitoring
- ✅ File storage consistency across all upload methods
- ✅ Real-time monitoring and observability
- ✅ Enterprise security and authentication

#### **🚀 Enterprise Features Ready**
**Production Capabilities**: Full enterprise feature set ready for deployment.

**Ready for Production**:
- **Multi-Tenant Architecture**: Complete tenant isolation and data security
- **Scalable Infrastructure**: Google Cloud Storage and PostgreSQL with Neon
- **AI Processing**: Background AI analysis with queue management
- **Advanced Search**: Policy-driven search with performance optimization
- **Monitoring**: Comprehensive observability and alerting
- **Security**: Enterprise-grade authentication and authorization

**Developer Impact**: External vendors now have access to a complete, production-ready multi-tenant document management system with enterprise-grade features, comprehensive monitoring, and robust security.

## 🚀 Production Deployment

### Environment Requirements
- Node.js 18+ with npm
- PostgreSQL database (Neon serverless recommended)
- Google Cloud Storage bucket with proper IAM
- Firebase project with Authentication enabled
- SSL certificate for HTTPS (required for secure cookies)

### Production Configuration
```env
NODE_ENV=production
DATABASE_URL=postgresql://...
VITE_FIREBASE_PROJECT_ID=your-project-id
GCP_PROJECT_ID=your-gcp-project
GCP_SERVICE_ACCOUNT_KEY=your-service-account-key
GCS_BUCKET_NAME=your-bucket-name
GEMINI_API_KEY=your-gemini-key
PORT=5000
TRASH_RETENTION_DAYS=30
```

### Build and Deploy
```bash
# Production build
npm ci --production
npm run build

# Database migration
npm run db:push

# Start production server
npm start
```

## 📊 API Endpoints

### Document Management
- `GET /api/documents` - List user documents with filtering
- `POST /api/documents` - Upload new documents
- `GET /api/documents/:id` - Get document details
- `PUT /api/documents/:id` - Update document metadata
- `DELETE /api/documents/:id` - Move document to trash

### Search and Discovery
- `POST /api/search/policy-driven` - Advanced search with instrumentation
- `GET /api/documents/recent` - Recently accessed documents
- `GET /api/documents/favorites` - User's favorite documents

### Google Drive Integration
- `GET /api/drive/connect` - Check Drive connection status
- `POST /api/drive/oauth-callback` - Handle OAuth authentication
- `GET /api/drive/documents` - List Drive documents
- `POST /api/drive/import` - Import documents from Drive

### AI and Analytics
- `GET /api/queue/status` - AI processing queue status
- `POST /api/documents/:id/analyze` - Trigger AI analysis
- `GET /api/analytics/usage` - System usage analytics

## 🤝 Contributing

### Development Setup
1. Fork and clone the repository
2. Install dependencies with `npm install`
3. Configure environment variables
4. Set up database with `npm run db:push`
5. Start development server with `npm run dev`

### Code Standards
- TypeScript for all new code
- Drizzle ORM for database operations
- React Query for state management
- Comprehensive error handling
- Security-first development practices

### Pull Request Guidelines
1. Create feature branch from main
2. Implement changes with proper testing
3. Update documentation as needed
4. Submit PR with clear description
5. Address review feedback promptly

## 📞 Support

- **Issues**: GitHub Issues for bug reports and feature requests
- **Documentation**: Inline code documentation and API references
- **Security**: Report security vulnerabilities privately
- **Community**: Discussions for questions and community support

## 📄 License

MIT License - see LICENSE file for details.

---

**Clasio - Intelligent Document Management for Modern Teams**

*Built with cutting-edge technology for the future of document management*
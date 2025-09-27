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
   git clone https://github.com/gitjiggy/Clasio-Replit-MLP-Sep26.git
   cd Clasio-Replit-MLP-Sep26
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
Clasio-Replit-MLP-Sep26/
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

## 🔥 What's New for Sep 26, 2025

### 🛡️ Major Security Enhancement: Google Drive Authentication Overhaul

Today we completed a comprehensive security upgrade for Google Drive authentication, implementing enterprise-grade security practices that eliminate vulnerabilities and ensure production readiness.

#### **🔐 Secure httpOnly Cookie Implementation**
**Problem Solved**: Previously, Google Drive access tokens were stored in browser localStorage, making them vulnerable to XSS attacks and client-side script access.

**Solution Implemented**:
- **Complete Migration**: Moved all Drive tokens from localStorage to secure httpOnly cookies
- **Server-Side Storage**: Tokens now stored exclusively on the server, inaccessible to client JavaScript
- **Automatic Expiry**: Implemented 50-minute token lifetime with automatic cleanup
- **Environment Scoping**: Production cookies use `.clasio.ai` domain, development uses local host
- **SameSite Protection**: Strict SameSite policies in production, Lax in development

#### **🛡️ CSRF Protection Framework**
**Security Enhancement**: Added comprehensive protection against Cross-Site Request Forgery attacks.

**Implementation Details**:
- **Mandatory Headers**: All Drive API requests must include `X-Requested-With: XMLHttpRequest`
- **Server Validation**: Middleware validates CSRF headers on all state-changing operations
- **Legacy Rejection**: Explicit 400 errors for deprecated `x-drive-access-token` headers
- **Request Verification**: Enhanced OAuth callback validation with proper content-type enforcement

#### **🔧 Technical Implementation Improvements**
**Authentication Flow Enhancements**:
- **JSON Parsing**: Fixed OAuth callback with proper `express.json()` middleware scoping
- **Content-Type Validation**: Strict enforcement of `application/json` for API requests
- **Cookie Parser**: Added `cookie-parser` middleware for proper server-side cookie reading
- **Direct Fetch**: Eliminated vulnerable API request patterns, implemented direct fetch with proper headers

**Code Changes Made**:
```typescript
// Before: Vulnerable localStorage storage
localStorage.setItem('drive_token', token);

// After: Secure httpOnly cookie
res.cookie('drive_access_token', token, {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'strict' : 'lax',
  domain: isProduction ? '.clasio.ai' : undefined,
  maxAge: 50 * 60 * 1000 // 50 minutes
});
```

#### **📋 Security Benefits Achieved**
1. **XSS Protection**: httpOnly cookies prevent JavaScript access to authentication tokens
2. **CSRF Mitigation**: Header-based validation stops cross-site request forgery
3. **Token Security**: Server-side token management with automatic expiration
4. **Production Hardening**: Environment-specific security configurations
5. **Standards Compliance**: Follows OAuth 2.0 and modern web security best practices
6. **Audit Trail**: Comprehensive telemetry and logging for security monitoring

#### **🧪 Verification and Testing**
**End-to-End Validation**:
- ✅ OAuth callback processing with proper JSON parsing
- ✅ Cookie setting and reading functionality confirmed
- ✅ Drive API operations working with cookie authentication
- ✅ Legacy authentication paths completely removed
- ✅ CSRF protection active and functional
- ✅ Production-ready cookie configuration tested

**Server Logs Confirmation**:
```
[Auth] Drive authentication via httpOnly cookie
GET /api/drive/connect 200 - Drive connection successful
GET /api/drive/documents 200 - Document list retrieved
[Telemetry] OAuth callback: Token stored in httpOnly cookie
```

#### **🎯 Production Readiness Impact**
This security enhancement represents a major milestone in Clasio's production launch readiness:

- **Enterprise Security**: Now meets enterprise security standards for authentication
- **Zero Breaking Changes**: Seamless transition for existing users
- **Developer Experience**: Enhanced debugging with comprehensive logging
- **Compliance Ready**: Meets modern security audit requirements
- **Scalability**: Secure foundation for multi-tenant production deployment

**Developer Notes**: External vendors working on the frontend can now rely on a secure, production-ready authentication system that follows industry best practices for OAuth token management and CSRF protection.

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
# Clasio - Enterprise Document Management System

**Modern AI-Powered Document Management Platform with Multi-Tenant Architecture**

[![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)](https://reactjs.org/)
[![Express.js](https://img.shields.io/badge/express.js-%23404d59.svg?style=for-the-badge&logo=express&logoColor=%2361DAFB)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/postgresql-%23316192.svg?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Google Cloud](https://img.shields.io/badge/GoogleCloud-%234285F4.svg?style=for-the-badge&logo=google-cloud&logoColor=white)](https://cloud.google.com/)

---

## 📖 Table of Contents

- [Overview](#overview)
- [🚀 Key Features](#-key-features)
- [🏗️ System Architecture](#️-system-architecture)
- [🔧 Technology Stack](#-technology-stack)
- [⚡ Getting Started](#-getting-started)
- [📁 Project Structure](#-project-structure)
- [🔐 Authentication & Security](#-authentication--security)
- [🤖 AI Features](#-ai-features)
- [🔍 Advanced Search](#-advanced-search)
- [📊 Google Drive Integration](#-google-drive-integration)
- [🗃️ Database Schema](#️-database-schema)
- [🌐 API Endpoints](#-api-endpoints)
- [🔥 What's New for Sep 26, 2025](#-whats-new-for-sep-26-2025)
- [🚀 Deployment](#-deployment)
- [🤝 Contributing](#-contributing)

---

## Overview

Clasio is a production-ready, enterprise-grade document management system designed for modern organizations. Built with a multi-tenant architecture, it provides powerful document organization, AI-powered analysis, advanced search capabilities, and seamless Google Drive integration.

The system handles document uploads, version control, tagging, folder organization, and automatic AI summarization while maintaining the highest security standards and performance optimization.

---

## 🚀 Key Features

### 📄 Document Management
- **Multi-format Support**: PDF, Word, Excel, PowerPoint, images, and more
- **Version Control**: Track document changes with automatic versioning
- **Folder Hierarchies**: Organize documents in nested folder structures
- **Tagging System**: Flexible tagging for improved categorization
- **Bulk Operations**: Upload and manage multiple documents simultaneously
- **Document Preview**: Built-in document viewer with download capabilities

### 🤖 AI-Powered Analysis
- **Automatic Summarization**: AI-generated document summaries using Google Gemini
- **Content Extraction**: Intelligent text extraction from documents
- **Document Classification**: Automatic categorization by content type
- **Sentiment Analysis**: Understand document tone and sentiment
- **Key Topic Extraction**: Identify main themes and subjects
- **Smart Recommendations**: AI-driven document suggestions

### 🔍 Advanced Search Engine
- **Policy-Driven Search**: Intelligent query classification and routing
- **Field-Aware Scoring**: Context-aware relevance scoring
- **Multi-Tier Architecture**: Optimized search performance (T1/T2/T3 tiers)
- **Query Classification**: 7 distinct query types (entity, code, date, keyword, phrase, question, topic)
- **Real-time Search**: Instant results with comprehensive instrumentation
- **Search Analytics**: Detailed search performance metrics and anomaly detection

### 🔗 Google Drive Integration
- **Secure Authentication**: httpOnly cookie-based authentication with CSRF protection
- **Document Sync**: Import documents directly from Google Drive
- **Real-time Access**: Live access to Google Drive files and folders
- **Permission Mapping**: Maintain Google Drive permissions in Clasio
- **Automatic Updates**: Sync changes from Google Drive automatically

### 🔐 Enterprise Security
- **Multi-Tenant Architecture**: Complete data isolation between organizations
- **Custom ACL System**: Fine-grained access control for documents and folders
- **Object Storage Security**: Secure Google Cloud Storage with proper access controls
- **Rate Limiting**: Protection against abuse and DoS attacks
- **CSRF Protection**: Comprehensive cross-site request forgery protection
- **Environment-Based Configuration**: Different security profiles for dev/staging/production

### 📊 Analytics & Monitoring
- **Queue Management**: Real-time document processing queue status
- **Performance Metrics**: Comprehensive system performance monitoring
- **User Analytics**: Track user interactions and system usage
- **Error Tracking**: Centralized error logging and monitoring
- **Search Instrumentation**: Detailed search performance and accuracy metrics

---

## 🏗️ System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite for fast development and optimized production builds
- **UI Library**: Shadcn/ui components built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design system
- **State Management**: TanStack Query (React Query) for server state
- **Routing**: Wouter for lightweight client-side routing
- **File Uploads**: Uppy.js with drag-and-drop and progress tracking

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **API Design**: RESTful API with proper HTTP status codes
- **Database ORM**: Drizzle ORM for type-safe database operations
- **File Processing**: Multer middleware for multipart uploads
- **Authentication**: Firebase Authentication with custom token validation
- **Security**: Helmet.js, CORS, rate limiting, and CSRF protection

### Infrastructure
- **Database**: PostgreSQL with Neon serverless hosting
- **File Storage**: Google Cloud Storage with CDN
- **AI Service**: Google Gemini 2.5 Flash API
- **Deployment**: Production-ready with automatic scaling
- **Monitoring**: Comprehensive logging and error tracking

---

## 🔧 Technology Stack

### Core Technologies
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **Backend**: Node.js, Express.js, TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Storage**: Google Cloud Storage
- **Authentication**: Firebase Auth + Custom session management
- **AI**: Google Gemini 2.5 Flash

### Key Libraries
- **UI Components**: Radix UI, Shadcn/ui
- **State Management**: TanStack Query, Zustand
- **File Handling**: Uppy.js, Multer
- **Security**: Helmet.js, express-rate-limit, cookie-parser
- **Development**: ESLint, Prettier, Drizzle Kit
- **Testing**: Comprehensive error handling and validation

### Development Tools
- **Build**: Vite, TypeScript compiler
- **Database**: Drizzle Kit for migrations
- **Code Quality**: ESLint, Prettier
- **Type Safety**: TypeScript throughout the stack

---

## ⚡ Getting Started

### Prerequisites
- Node.js 18+ and npm
- PostgreSQL database (or Neon account)
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

3. **Environment Setup**
   Create a `.env` file with the following variables:
   ```env
   # Database
   DATABASE_URL=postgresql://username:password@hostname:port/database
   
   # Firebase Configuration
   VITE_FIREBASE_PROJECT_ID=your-firebase-project-id
   
   # Google Cloud Storage
   GCP_PROJECT_ID=your-gcp-project-id
   GCP_SERVICE_ACCOUNT_KEY=your-service-account-key-json
   GCS_BUCKET_NAME=your-storage-bucket-name
   
   # Optional: AI Features
   GEMINI_API_KEY=your-gemini-api-key
   
   # Optional: Configuration
   PORT=5000
   NODE_ENV=development
   TRASH_RETENTION_DAYS=7
   ```

4. **Database Setup**
   ```bash
   # Push database schema
   npm run db:push
   
   # Optional: Generate migrations
   npm run db:generate
   ```

5. **Start Development Server**
   ```bash
   npm run dev
   ```

   The application will be available at `http://localhost:5000`

### Quick Start Guide

1. **User Registration**: Create an account using Firebase Authentication
2. **Upload Documents**: Drag and drop files or use the upload button
3. **Organize Content**: Create folders and add tags to your documents
4. **AI Analysis**: Enable automatic AI summarization for uploaded documents
5. **Search & Discover**: Use the advanced search to find documents quickly
6. **Google Drive**: Connect your Google Drive for seamless integration

---

## 📁 Project Structure

```
Clasio-Replit-MLP-Sep26/
├── client/                          # Frontend React application
│   ├── src/
│   │   ├── components/              # React components
│   │   │   ├── ui/                  # Shadcn/ui component library
│   │   │   ├── DocumentModal.tsx   # Document management modals
│   │   │   ├── ObjectUploader.tsx  # File upload component
│   │   │   ├── QueueStatusDashboard.tsx  # Processing queue UI
│   │   │   └── UserMenu.tsx        # User authentication menu
│   │   ├── contexts/               # React contexts
│   │   │   └── AuthContext.tsx     # Authentication state management
│   │   ├── hooks/                  # Custom React hooks
│   │   ├── lib/                    # Utility libraries
│   │   │   ├── firebase.ts         # Firebase configuration
│   │   │   ├── queryClient.ts      # TanStack Query setup
│   │   │   └── analytics.ts        # Analytics utilities
│   │   ├── pages/                  # Application pages
│   │   │   ├── documents.tsx       # Main document management
│   │   │   ├── drive.tsx           # Google Drive integration
│   │   │   ├── auth-drive.tsx      # Drive authentication
│   │   │   ├── document-viewer.tsx # Document preview
│   │   │   └── trash.tsx           # Deleted documents
│   │   ├── App.tsx                 # Main application component
│   │   └── main.tsx                # Application entry point
│   └── index.html                  # HTML template
├── server/                         # Backend Express application
│   ├── aiQueueProcessor.ts         # AI document analysis queue
│   ├── auth.ts                     # Firebase authentication middleware
│   ├── cookieAuth.ts               # Secure cookie authentication
│   ├── db.ts                       # Database connection
│   ├── driveService.ts             # Google Drive API integration
│   ├── fieldAwareLexical.ts        # Advanced search lexical analysis
│   ├── gemini.ts                   # Google Gemini AI integration
│   ├── index.ts                    # Server entry point
│   ├── objectAcl.ts                # Access control for objects
│   ├── objectStorage.ts            # Google Cloud Storage service
│   ├── policyDrivenSearch.ts       # Advanced search engine
│   ├── queryAnalysis.ts            # Search query analysis
│   ├── rateLimit.ts                # Rate limiting middleware
│   ├── routes.ts                   # API route definitions
│   ├── security.ts                 # Security configuration
│   ├── storage.ts                  # Database storage layer
│   ├── tierRouting.ts              # Search tier routing
│   └── vite.ts                     # Vite integration for development
├── shared/                         # Shared types and schemas
│   └── schema.ts                   # Database schema definitions
├── migrations/                     # Database migrations
│   └── 0001_add_unique_active_version_constraint.sql
├── package.json                    # Node.js dependencies and scripts
├── tsconfig.json                   # TypeScript configuration
├── vite.config.ts                  # Vite build configuration
├── tailwind.config.ts              # Tailwind CSS configuration
├── drizzle.config.ts               # Drizzle ORM configuration
└── README.md                       # This file
```

---

## 🔐 Authentication & Security

### Multi-Layered Security Architecture

**Firebase Authentication Integration**
- Secure user registration and login
- JWT token validation on all API requests
- Automatic token refresh and session management
- Multi-factor authentication support

**Google Drive Security (Enhanced Sep 26, 2025)**
- **httpOnly Cookies**: Secure token storage preventing XSS attacks
- **CSRF Protection**: X-Requested-With header validation
- **Token Expiration**: Automatic 50-minute token expiry
- **Domain Scoping**: Environment-appropriate cookie domains
- **Legacy Path Removal**: Complete migration from localStorage

**Object-Level Security**
- Custom ACL system for granular permissions
- User-specific file access controls
- Secure presigned URL generation
- MIME type validation and file size limits

**API Security**
- Rate limiting to prevent abuse
- CORS configuration for cross-origin requests
- Helmet.js for security headers
- Input validation using Zod schemas

### Security Configuration

The system implements environment-based security profiles:

- **Development**: Relaxed CORS, detailed error messages, debug logging
- **Production**: Strict CORS, minimal error exposure, security headers

---

## 🤖 AI Features

### Google Gemini Integration

**Automatic Document Analysis**
- Document summarization with configurable length
- Key topic and theme extraction
- Document type classification
- Sentiment analysis for content tone
- Word count and reading time estimation

**AI Queue Processing**
- Asynchronous processing for large documents
- Priority queue management (immediate vs. background)
- Real-time processing status tracking
- Batch processing for bulk uploads
- Error handling and retry mechanisms

**Smart Features**
- Content-based document suggestions
- Automatic tag recommendations
- Duplicate document detection
- Language detection and translation support

### AI Configuration

```typescript
// Enable AI analysis for new uploads
const analyzeDocument = async (documentId: string) => {
  await storage.enqueueDocumentForAnalysis(
    documentId, 
    userId, 
    priority // 1 = immediate, 5 = background
  );
};
```

---

## 🔍 Advanced Search

### Policy-Driven Search Engine

**Query Classification System**
The search engine automatically classifies queries into 7 distinct types:

1. **Entity Proper**: People, organizations, places ("John Smith", "Apple Inc.")
2. **ID/Code**: Identifiers and codes ("1099-INT", "DOC-2024-001")
3. **Date/Range**: Temporal queries ("last month", "2024-01-15")
4. **Short Keyword**: 1-3 common tokens ("tax", "meeting notes")
5. **Phrase**: Exact phrases ("quarterly financial report")
6. **Question**: Question-like queries ("What is the budget for Q4?")
7. **Topic Freeform**: Complex topical searches (4+ mixed-case tokens)

**Tier Routing System**
- **Tier 1** (0.99 ceiling): High-precision results for entities and exact matches
- **Tier 2** (0.70 ceiling): Balanced relevance for general queries
- **Tier 3** (0.45 ceiling): Broad discovery for exploratory searches

**Field-Aware Scoring**
- Document title: Higher weight for relevance
- Content body: Contextual matching with proximity bonuses
- Tags and metadata: Exact match prioritization
- File type and properties: Technical attribute matching

### Search API

```javascript
// Advanced search with instrumentation
const searchResults = await fetch('/api/search/policy-driven', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: "quarterly financial reports 2024",
    limit: 20,
    include_instrumentation: true
  })
});
```

**Search Response**
```json
{
  "results": [...],
  "total": 156,
  "instrumentation": {
    "query_class": "topic.freeform",
    "tier_selected": "T2",
    "processing_time_ms": 23,
    "policy_dump": {...},
    "top_documents": [...]
  }
}
```

---

## 📊 Google Drive Integration

### Secure Authentication Flow (Enhanced Sep 26, 2025)

**Security-First Implementation**
- **httpOnly Cookies**: Tokens stored in secure, httpOnly cookies
- **CSRF Protection**: Mandatory X-Requested-With headers
- **Domain Scoping**: Environment-appropriate cookie domains
- **Automatic Expiry**: 50-minute token lifetime with refresh

**Integration Features**
- Import documents directly from Google Drive
- Real-time access to Drive files and folders
- Maintain Google Drive permissions in Clasio
- Automatic sync of Drive changes
- Support for shared drives and collaboration

### Google Drive API Usage

```typescript
// Secure Drive authentication
const authenticateGoogleDrive = async () => {
  const result = await signInWithPopup(auth, driveProvider);
  const token = credential?.accessToken;
  
  // Token securely stored in httpOnly cookie
  await fetch('/api/drive/oauth-callback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest', // CSRF protection
    },
    credentials: 'include',
    body: JSON.stringify({ accessToken: token })
  });
};
```

**Drive Operations**
- List files and folders with permissions
- Download files for local processing
- Sync metadata and updates
- Handle shared drive access
- Manage collaborative permissions

---

## 🗃️ Database Schema

### Core Tables

**Documents**
```sql
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  original_name VARCHAR NOT NULL,
  file_path VARCHAR NOT NULL,
  file_size INTEGER NOT NULL,
  file_type VARCHAR NOT NULL,
  mime_type VARCHAR NOT NULL,
  folder_id UUID REFERENCES folders(id),
  user_id VARCHAR NOT NULL,
  is_favorite BOOLEAN DEFAULT false,
  is_deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- AI Analysis Fields
  ai_summary TEXT,
  ai_key_topics TEXT[],
  ai_sentiment VARCHAR,
  ai_classification VARCHAR,
  word_count INTEGER,
  analysis_status VARCHAR DEFAULT 'pending'
);
```

**Document Versions**
```sql
CREATE TABLE document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  file_path VARCHAR NOT NULL,
  file_size INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by VARCHAR NOT NULL,
  
  UNIQUE(document_id, version_number),
  UNIQUE(document_id, is_active) WHERE is_active = true
);
```

**Folders & Tags**
```sql
-- Hierarchical folder structure
CREATE TABLE folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  parent_id UUID REFERENCES folders(id),
  user_id VARCHAR NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Flexible tagging system
CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  color VARCHAR,
  user_id VARCHAR NOT NULL,
  UNIQUE(name, user_id)
);

-- Many-to-many document-tag relationships
CREATE TABLE document_tags (
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, tag_id)
);
```

### Database Operations

```typescript
// Type-safe database operations with Drizzle ORM
const createDocument = async (documentData: InsertDocument) => {
  const [document] = await db
    .insert(documents)
    .values(documentData)
    .returning();
  
  return document;
};

const searchDocuments = async (query: string, userId: string) => {
  return await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.userId, userId),
        eq(documents.isDeleted, false),
        or(
          ilike(documents.name, `%${query}%`),
          ilike(documents.aiSummary, `%${query}%`)
        )
      )
    )
    .orderBy(desc(documents.updatedAt));
};
```

---

## 🌐 API Endpoints

### Document Management

```
GET    /api/documents              # List user documents
POST   /api/documents              # Upload new document
GET    /api/documents/:id          # Get document details
PUT    /api/documents/:id          # Update document metadata
DELETE /api/documents/:id          # Delete document (move to trash)

GET    /api/documents/:id/versions # Get document versions
POST   /api/documents/:id/versions # Create new version
GET    /api/documents/:id/download # Download document
```

### Folder Management

```
GET    /api/folders                # List user folders
POST   /api/folders                # Create new folder
PUT    /api/folders/:id            # Update folder
DELETE /api/folders/:id            # Delete folder
```

### Search & Discovery

```
POST   /api/search/policy-driven   # Advanced policy-driven search
GET    /api/search/suggestions     # Search suggestions
GET    /api/documents/recent       # Recently accessed documents
GET    /api/documents/favorites    # User's favorite documents
```

### Google Drive Integration

```
GET    /api/drive/connect          # Check Drive connection status
POST   /api/drive/oauth-callback   # Handle OAuth callback
POST   /api/drive/signout          # Sign out from Drive
GET    /api/drive/documents        # List Drive documents
POST   /api/drive/import           # Import from Drive
```

### AI & Analytics

```
GET    /api/queue/status           # AI processing queue status
POST   /api/documents/:id/analyze  # Trigger AI analysis
GET    /api/analytics/usage        # Usage analytics
GET    /api/analytics/search       # Search analytics
```

### Authentication & User Management

```
POST   /api/auth/verify            # Verify Firebase token
GET    /api/user/profile           # Get user profile
PUT    /api/user/profile           # Update user profile
GET    /api/user/preferences       # Get user preferences
```

---

## 🔥 What's New for Sep 26, 2025

### 🔐 Major Security Enhancement: Google Drive Authentication Migration

**Complete Security Overhaul**
We've implemented a comprehensive security upgrade for Google Drive authentication, migrating from vulnerable localStorage to enterprise-grade security:

#### **1. Secure httpOnly Cookie Implementation**
- **Migrated from localStorage**: Eliminated client-side token exposure
- **httpOnly Cookies**: Tokens now stored in secure, server-only accessible cookies
- **Automatic Expiry**: 50-minute token lifetime with proper cleanup
- **Domain Scoping**: Environment-appropriate cookie domains (.clasio.ai for production)
- **SameSite Protection**: Configurable SameSite policies (Strict for production, Lax for development)

#### **2. CSRF Protection Framework**
- **Mandatory Headers**: All Drive API requests require `X-Requested-With: XMLHttpRequest`
- **Request Validation**: Server-side CSRF header validation on all non-idempotent operations
- **Legacy Path Rejection**: Explicit 400 errors for deprecated `x-drive-access-token` headers
- **CORS Configuration**: Updated CORS policies to support secure authentication flow

#### **3. Production-Ready Security Architecture**
- **Environment-Based Configuration**: Different security profiles for development vs production
- **Secure Flag Management**: HTTPS-only cookies in production, development-friendly in dev
- **Token Validation**: Enhanced server-side token verification with Google OAuth2 API
- **Access Control**: Complete removal of dual authentication paths - cookie-only access

#### **4. Enhanced Authentication Flow**
- **OAuth Callback Security**: Secure token exchange with proper JSON parsing and validation
- **Content-Type Enforcement**: Strict `application/json` requirement for API calls
- **Cookie Parser Integration**: Added `cookie-parser` middleware for proper cookie handling
- **Debug Instrumentation**: Comprehensive logging for authentication troubleshooting

#### **5. Client-Side Security Improvements**
- **Direct Fetch Implementation**: Eliminated vulnerable API request patterns
- **Proper Header Management**: Explicit Content-Type and CSRF headers
- **Credential Handling**: Automatic cookie inclusion with `credentials: 'include'`
- **Legacy Code Removal**: Complete elimination of localStorage authentication functions

### **Security Benefits**
- **XSS Protection**: httpOnly cookies prevent JavaScript access to tokens
- **CSRF Mitigation**: Header-based protection against cross-site request forgery
- **Token Security**: Server-side token management with automatic expiration
- **Production Hardening**: Environment-specific security configurations
- **Audit Trail**: Comprehensive telemetry and logging for security monitoring

### **Developer Impact**
- **Zero Breaking Changes**: Seamless transition for existing users
- **Enhanced Debugging**: Detailed logging and error messages for development
- **Production Ready**: Enterprise-grade security suitable for production deployment
- **Standards Compliance**: Follows OAuth 2.0 and web security best practices

This security enhancement represents a major milestone in Clasio's production readiness, implementing enterprise-grade authentication security that meets modern web application security standards.

---

## 🚀 Deployment

### Production Deployment

**Environment Requirements**
- Node.js 18+ runtime
- PostgreSQL database (recommended: Neon serverless)
- Google Cloud Storage bucket
- Firebase project with Authentication
- SSL certificate for HTTPS (required for secure cookies)

**Environment Variables (Production)**
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

**Build and Deploy**
```bash
# Install dependencies
npm ci --production

# Build the application
npm run build

# Run database migrations
npm run db:push

# Start production server
npm start
```

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --production

COPY . .
RUN npm run build

EXPOSE 5000
CMD ["npm", "start"]
```

### Performance Optimization

- **Database Connection Pooling**: Optimized PostgreSQL connections
- **CDN Integration**: Google Cloud Storage CDN for file delivery
- **Compression**: Gzip compression for API responses
- **Caching**: Strategic caching for frequently accessed data
- **Rate Limiting**: Protection against abuse and resource exhaustion

---

## 🤝 Contributing

### Development Setup

1. **Fork and Clone**
   ```bash
   git clone https://github.com/your-username/Clasio-Replit-MLP-Sep26.git
   cd Clasio-Replit-MLP-Sep26
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   Copy `.env.example` to `.env` and configure your development environment

4. **Database Setup**
   ```bash
   npm run db:push
   ```

5. **Start Development**
   ```bash
   npm run dev
   ```

### Code Standards

- **TypeScript**: Full type safety throughout the stack
- **ESLint**: Code linting and formatting
- **Prettier**: Code formatting
- **Commit Messages**: Conventional commit format
- **Testing**: Comprehensive error handling and validation

### Architecture Guidelines

- **API Design**: RESTful principles with proper HTTP status codes
- **Database**: Use Drizzle ORM for all database operations
- **Security**: Follow security best practices for all new features
- **Performance**: Optimize for scalability and responsiveness
- **Documentation**: Update README and code comments for new features

### Pull Request Process

1. Create a feature branch from `main`
2. Implement your changes with proper tests
3. Update documentation as needed
4. Submit a pull request with a clear description
5. Address review feedback promptly

---

## 📞 Support & Documentation

**Technical Documentation**
- API documentation available at `/api/docs` (when running)
- Database schema documentation in `/migrations`
- Component documentation in Storybook (development)

**Community**
- GitHub Issues for bug reports and feature requests
- Discussions for questions and community support
- Wiki for extended documentation and guides

**Security**
- Report security vulnerabilities privately via email
- Security policy available in `SECURITY.md`
- Regular security updates and patches

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🏆 Acknowledgments

- **Google Gemini AI** for intelligent document analysis
- **Shadcn/ui** for the beautiful component library
- **Drizzle ORM** for type-safe database operations
- **TanStack Query** for efficient state management
- **Firebase** for reliable authentication services
- **The open source community** for the amazing tools and libraries

---

**Built with ❤️ for modern document management**

*Clasio - Where documents meet intelligence*
# Overview

This is a modern document management system built with React and Express, featuring AI-powered document analysis using Google's Gemini AI. The application allows users to upload, organize, and analyze documents with features like folders, tags, version control, and automatic AI summarization. It uses PostgreSQL for data persistence and Google Cloud Storage for file storage.

# Recent Changes

## October 1, 2025 - Final Authentication Configuration (LOCKED - DO NOT CHANGE)

**⚠️ CRITICAL: This configuration is FINAL and must NOT be changed**

**Authentication Setup for Custom Domain (`clasio.ai`) NOT on Firebase Hosting:**
- **authDomain**: `documentorganizerclean-b629f.firebaseapp.com` (LOCKED - NEVER change to clasio.ai)
- **Method**: Redirect-based authentication (`signInWithRedirect`) ONLY
- **Why popup doesn't work**: Third-party cookie protections and postMessage restrictions prevent popup auth from working reliably on custom domains not hosted on Firebase
- **Why this authDomain**: Firebase Auth only provisions OAuth from its managed domain unless deployed via Firebase Hosting

**Implementation Details**:
1. `client/src/lib/firebase.ts`:
   - authDomain = `documentorganizerclean-b629f.firebaseapp.com` (NEVER toggle)
   - Persistence set at module load (browserLocalPersistence with inMemoryPersistence fallback)

2. `client/src/components/LoginModal.tsx`:
   - Uses `signInWithRedirect(auth, basicGoogleProvider)`
   - Redirects user to Firebase's domain for OAuth
   - Page navigation happens automatically

3. `client/src/contexts/AuthContext.tsx`:
   - Calls `getRedirectResult(auth)` ONCE on app boot
   - Sets up `onAuthStateChanged` listener for ongoing auth state
   - Properly handles cleanup on unmount

**Authentication Flow**:
1. User clicks "Continue with Google" on `clasio.ai`
2. Page redirects to `documentorganizerclean-b629f.firebaseapp.com/__/auth/handler`
3. Google OAuth completes on Firebase's domain
4. User redirects back to `clasio.ai`
5. `getRedirectResult` captures the auth result
6. `onAuthStateChanged` maintains auth state

**Firebase Console Requirements**:
- ✅ Google provider enabled
- ✅ Authorized domains: `clasio.ai`, `www.clasio.ai`, `documentorganizerclean-b629f.firebaseapp.com`
- ✅ OAuth consent screen configured
- ✅ Web client ID matches the one in code

**DO NOT**:
- ❌ Change authDomain to `clasio.ai` (breaks OAuth)
- ❌ Use popup authentication (unreliable on custom domains)
- ❌ Call getRedirectResult multiple times (causes race conditions)
- ❌ Toggle between popup and redirect flows

## September 30, 2025 - Authentication Fix & Rebranding to Clasio

**Authentication Loading Screen Fix**:
- Fixed critical bug where app would hang on "Loading..." screen after Google OAuth redirect
- Root cause: Auth state observer wasn't reliably setting loading state to false
- Solution: Ensured loading state is set to false after redirect check completes, with fallback in auth observer
- Authentication now works reliably with redirect-based flow (better for PWA/mobile support)

**Complete Rebranding to Clasio**:
- Changed all "DocuFlow" references to "Clasio" throughout the application
- Updated app header, loading screens, welcome messages, and login modal
- Added proper page title: "Clasio - AI-Powered Document Management"
- Brand name now consistent across all user-facing surfaces

**Technical Details**:
- Auth Context now properly handles redirect results asynchronously
- Both redirect result handler and auth state observer set loading to false
- Eliminates race conditions that caused infinite loading states

## September 28, 2025 - GitHub Repository for External Vendor Collaboration

**Created Comprehensive GitHub Repository**:
- **Repository**: https://github.com/gitjiggy/Clasio-Replit-MLP-Sep28
- **Purpose**: Enable external vendor collaboration on frontend development
- **Files Uploaded**: 111 essential project files including all client, server, and shared code

**Documentation Updates**:
- **Comprehensive README.md**: Complete feature documentation with September 28 updates
- **OAuth Debugging Documentation**: Detailed Token 1-4 analysis and root cause identification
- **Setup Instructions**: Complete environment configuration and deployment guide
- **Architecture Overview**: Full technology stack and project structure documentation

**Key Documentation Sections**:
- Complete OAuth 2.0 implementation and debugging trail
- Security enhancements (quotas, file size limits)
- Production-ready infrastructure details
- API endpoints and integration guides
- Monitoring and observability features

**Repository Contents**:
- All frontend React components and pages
- Complete backend Express API and services
- Database schemas and migration files
- Configuration files (tsconfig, vite, tailwind, drizzle)
- Project documentation and setup guides

**Vendor Onboarding Ready**:
- Clear prerequisite requirements documented
- Step-by-step installation instructions
- Environment variable configuration guide
- Development and deployment workflows
- Architecture and feature deep dives

**OAuth Status**:
- Root cause confirmed: Google OAuth client configuration issue in Google Cloud Console
- All code infrastructure production-ready
- Requires Google Cloud Console OAuth client verification/recreation
- Complete debugging trail documented for reference

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React with TypeScript using Vite as the build tool
- **UI Library**: Shadcn/ui components built on top of Radix UI primitives
- **Styling**: Tailwind CSS with custom CSS variables for theming
- **State Management**: TanStack Query (React Query) for server state management
- **Routing**: Wouter for lightweight client-side routing
- **File Uploads**: Uppy.js for advanced file upload functionality with drag-and-drop support

## Backend Architecture
- **Framework**: Express.js with TypeScript
- **API Design**: RESTful API endpoints for document management operations
- **File Processing**: Multer middleware for handling multipart file uploads
- **Database ORM**: Drizzle ORM for type-safe database operations
- **Error Handling**: Centralized error handling middleware with proper HTTP status codes

## Database Design
- **Primary Database**: PostgreSQL with connection pooling via Neon serverless
- **Schema Management**: Drizzle Kit for migrations and schema management
- **Core Tables**:
  - `documents`: Main document metadata with AI analysis fields
  - `document_versions`: Version control for document revisions
  - `folders`: Hierarchical organization structure
  - `tags`: Flexible tagging system for categorization
  - `document_tags`: Many-to-many relationship between documents and tags

## File Storage Strategy
- **Storage Provider**: Google Cloud Storage for scalable object storage
- **Upload Strategy**: Direct-to-cloud uploads using presigned URLs
- **File Organization**: Structured file paths with version management
- **Access Control**: Custom ACL (Access Control List) system for fine-grained permissions
- **File Type Support**: Comprehensive support for documents, images, and office files with MIME type validation

## AI Integration
- **AI Provider**: Google Gemini 2.5 Flash for document analysis
- **Analysis Features**:
  - Automatic document summarization
  - Key topic extraction
  - Document type classification
  - Sentiment analysis
  - Word count statistics
- **Processing**: Asynchronous AI analysis with database storage of results

## Policy-Driven Search Architecture
- **Search Engine**: Comprehensive policy-driven search system replacing hardcoded logic
- **Query Classification**: Lightweight analyzer with 7 query classes:
  - `entity.proper` (people, organizations, places)
  - `id/code` (identifiers like "1099-INT")
  - `date/range` (date queries)
  - `short.keyword` (1-3 common tokens)
  - `phrase` (quoted or long exact phrase)
  - `question` (question-like queries) 
  - `topic.freeform` (≥4 tokens, mixed case)
- **Field-Aware Scoring**: Per-field lexical signals with max-field logic, policy caps, proximity bonuses
- **Tier Routing**: Policy-driven tier selection with absolute ceilings (T1: 0.99, T2: 0.70, T3: 0.45)
- **Instrumentation**: Comprehensive logging with QueryAnalysis traces, PolicyDump, Top-5 document traces, anomaly detection
- **API Endpoint**: `/api/search/policy-driven` with full instrumentation exposure
- **Exact Phrase Detection**: High-signal field matching for proper noun routing to Tier-1

## Authentication & Security
- **File Access**: Custom object ACL system with group-based permissions
- **File Validation**: Server-side MIME type and file size validation
- **Upload Security**: 50MB file size limits with type restrictions
- **Error Boundaries**: Client-side error handling with user-friendly messages

# External Dependencies

## Core Services
- **Database**: PostgreSQL via Neon serverless platform for scalable database hosting
- **File Storage**: Google Cloud Storage for reliable object storage with global CDN
- **AI Service**: Google Gemini AI API for document analysis and summarization

## Development Tools
- **Build System**: Vite for fast development and optimized production builds
- **Type Safety**: TypeScript throughout the entire stack for better developer experience
- **Code Quality**: ESBuild for server-side bundling and optimization

## Third-Party Libraries
- **UI Components**: Extensive Radix UI component library for accessible, unstyled components
- **File Uploads**: Uppy ecosystem including AWS S3 plugin for direct cloud uploads
- **Database**: Drizzle ORM with PostgreSQL adapter for type-safe database operations
- **Styling**: Tailwind CSS with custom configuration for design system consistency
- **State Management**: TanStack Query for efficient server state caching and synchronization
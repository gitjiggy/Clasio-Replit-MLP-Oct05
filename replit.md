# Overview

This is a modern document management system built with React and Express, featuring AI-powered document analysis using Google's Gemini AI. The application allows users to upload, organize, and analyze documents with features like folders, tags, version control, and automatic AI summarization. It uses PostgreSQL for data persistence and Google Cloud Storage for file storage.

# Recent Changes

## October 1, 2025 - Redirect-Only Authentication with Default Firebase Domain

**Authentication Flow Fix**:
- **Issue**: Authentication redirect was hanging at `/__/auth/handler` page
- **Root Cause**: Custom domain `authDomain: "clasio.ai"` requires special Firebase Hosting configuration. OAuth redirect URLs in Google Cloud Console are configured for default Firebase domain.
- **Solution**: Changed `authDomain` back to `"documentorganizerclean-b629f.firebaseapp.com"` (Firebase default)
- **Files Modified**:
  - `client/src/lib/firebase.ts`: Changed authDomain to Firebase default domain
  - `client/src/pages/auth-drive.tsx`: Changed authDomain to Firebase default domain
  - `client/src/components/LoginModal.tsx`: Simplified to single "Continue with Google" button using `signInWithRedirect`

**How It Works**:
- User clicks "Continue with Google" on `clasio.ai`
- Browser redirects to `documentorganizerclean-b629f.firebaseapp.com/__/auth/handler`
- Google OAuth completes authentication (recognizes Firebase domain)
- User returns to `clasio.ai` fully authenticated
- Main app domain (`clasio.ai`) stays the same for users

**Benefits**:
- Authentication works reliably out of the box
- No custom domain configuration needed for Firebase Auth
- Cleaner single-button interface
- Works across all browsers with redirect flow

## October 1, 2025 - Cookie-Resilient Authentication Architecture

**Production-Ready Authentication Flow**:
- **Module-Level Persistence**: Persistence (browserLocalPersistence → inMemoryPersistence fallback) now initializes at module load via top-level async IIFE, eliminating all awaits between user click and popup
- **Zero-Latency Popup**: signInWithGoogle() calls signInWithPopup() immediately without any preceding awaits, preserving user activation chain critical for popup success
- **Awaited Redirect Completion**: App.tsx properly awaits completeRedirectIfAny() in async IIFE on boot to prevent auth state races
- **900ms Detection Threshold**: Reduced from 1.5s to 900ms using performance.now() for faster popup-block detection
- **Fallback Chain**: browserLocalPersistence (ideal) → inMemoryPersistence (Safari/Incognito with 3P cookie blocking) → redirect flow (popup blocked)

**Cross-Browser Resilience**:
- Safari/Incognito strict cookie policies: inMemoryPersistence fallback ensures popup succeeds despite blocked storage
- Popup blockers: Auto-detects blocks via timing heuristic (<900ms + specific error codes), falls back to redirect
- No user activation loss: All persistence setup happens at module import, no awaits in click handler

**Technical Implementation Details**:
- firebase.ts: Top-level initPersistence() IIFE runs immediately on module load
- LoginModal: handleGoogleSignIn calls signInWithGoogle() with zero awaits before popup
- App.tsx: Awaits completeRedirectIfAny() in useEffect async IIFE before GA init
- Analytics tracking moved after popup/redirect attempts (preserves user activation)
- Error detection includes auth/cancelled-popup-request for comprehensive blocking detection

**Architecture Review Status**: ✅ Passed
- No awaits between click and popup
- Persistence set at module load (no user click required)
- Redirect completion properly awaited on app boot
- Manual redirect inherits module-level persistence
- All changes align with Safari/Incognito/strict cookie policy requirements

**Recommended Next Steps**:
1. Gate sign-in buttons until initPersistence resolves (export readiness flag from firebase.ts)
2. Add telemetry for popup timing and fallback rates (track elapsed ms, error codes in analytics)
3. Implement automated E2E tests for Chrome Incognito and Safari popup/redirect flows

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
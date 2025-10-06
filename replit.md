# Overview

This project is an AI-powered document management system built with React and Express. It enables users to upload, organize, and analyze documents using features like folders, tags, and version control. A key capability is automatic AI summarization and analysis powered by Google's Gemini AI. The system uses PostgreSQL for data persistence and Google Cloud Storage for file storage. The business vision is to provide a comprehensive, intelligent platform for document handling, offering significant market potential through enhanced productivity and insightful document analysis.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React with TypeScript (Vite)
- **UI Library**: Shadcn/ui (built on Radix UI)
- **Styling**: Tailwind CSS
- **State Management**: TanStack Query
- **Routing**: Wouter
- **File Uploads**: Uppy.js

## Backend Architecture
- **Framework**: Express.js with TypeScript
- **API Design**: RESTful API
- **File Processing**: Multer middleware
- **Database ORM**: Drizzle ORM
- **Error Handling**: Centralized middleware

## Database Design
- **Primary Database**: PostgreSQL (Neon serverless)
- **Schema Management**: Drizzle Kit
- **Core Tables**: `documents`, `document_versions`, `folders`, `tags`, `document_tags`

## File Storage Strategy
- **Storage Provider**: Google Cloud Storage
- **Upload Strategy**: Direct-to-cloud via presigned URLs
- **File Organization**: Structured paths with versioning
- **Access Control**: Custom ACL system
- **Validation**: Server-side MIME type and file size validation (50MB limit)

## AI Integration
- **AI Provider**: Google Gemini 2.5 Flash-Lite
- **Current Analysis**: Summarization, topic extraction, classification, sentiment analysis, word count statistics
- **Processing**: Asynchronous queue-based processing via aiQueueProcessor
- **Rate Limits**: 60 requests/minute, 5,000 requests/day (MVP phase)

### Document Consciousness Strategy (In Development)
**Vision**: Transform documents from passive files into "living sources of knowledge, data, and information" that proactively surface relevant information.

**Core Principle**: Documents should answer questions ("What's my EIN?") not just be searchable files.

**Implementation Approach**:
- **Single Comprehensive Extraction**: Replace dual Gemini calls with one 6-layer extraction (50% cost reduction)
- **6 Intelligence Layers**:
  1. Identity Layer: Core document understanding (type, purpose, stakeholders, sensitivity)
  2. Extraction Layer: Critical data (identifiers, dates, amounts, obligations)
  3. Intelligence Layer: Insights (key Q&A pairs, warnings, opportunities)
  4. Temporal Layer: Time-based relevance (deadlines, expiration, seasonal triggers)
  5. Computation Layer: Numeric values for calculations (aggregatable fields, baselines)
  6. Search Optimization: Instant answers (trigger phrases, common queries, semantic tags)

**Storage Strategy**:
- New table: `document_consciousness` with JSONB columns for flexible schema
- Dual-write: Maintain existing `aiSummary` field + new consciousness data
- Zero breaking changes to current document card UI

**Search Revolution**:
- Answer-based search: Return INFORMATION not just documents
- Inference engine: Perform calculations, trends, comparisons from extracted data
- Source tracking: Every answer includes source documents with confidence scores
- Target: >90% of queries return direct answers

**Success Metrics**:
- Extraction completes in single Gemini call (<2 seconds)
- Search returns answers, not documents (>90% of queries)
- Calculations are accurate (100% accuracy on sums/averages)
- Users get "How did it know?!" moments

**Technical Details**:
- Use Gemini Flash-lite 2.5 for cost-effective extraction
- Temperature 0.1 for deterministic extraction, 0.3 for natural language responses
- Cache consciousness data to avoid re-extraction
- Gradual rollout without breaking existing document upload flow

**Current Status**: Schema created, extraction function implemented, storage layer in progress.

## Policy-Driven Search Architecture
- **Search Engine**: Comprehensive policy-driven system
- **Query Classification**: 7 query classes (e.g., `entity.proper`, `id/code`, `topic.freeform`)
- **Scoring**: Per-field lexical signals, max-field logic, proximity bonuses
- **Tier Routing**: Policy-driven tier selection with absolute ceilings
- **Instrumentation**: Comprehensive logging and anomaly detection
- **API Endpoint**: `/api/search/policy-driven`

## Authentication & Security
- **Authentication**: Firebase Authentication (redirect-based flow for custom domains)
- **Firebase Configuration**: `authDomain` set to `documentorganizerclean-b629f.firebaseapp.com` (Firebase handles custom domain redirects internally)
- **Auth Proxy**: Previously used proxy middleware for /__/auth routes; **REMOVED** after identifying it caused 500 errors on first load
- **File Access**: Custom object ACL system with group-based permissions
- **Security**: 50MB file size limits with type restrictions, client-side error boundaries

## Production Error Diagnostics
- **Error Code System** (`server/errorCodes.ts`): Standardized error codes with categories (AUTH-1xxx, CLIENT-2xxx, DB-3xxx, etc.), user-friendly messages, and unique error ID generation
- **Error Boundary** (`client/src/components/ErrorBoundary.tsx`): React error boundary with copy-to-clipboard functionality, error IDs, timestamps, and reload/go-home actions
- **Critical Path Logging**: Structured logging for server startup, environment validation, Firebase initialization, and database connections
- **Health Checks**: Enhanced `/health` (liveness) and `/readiness` endpoints with Firebase Admin SDK verification, database connectivity tests, and queue lag monitoring
- **Request Tracking**: Comprehensive request/response logging with request IDs, latency metrics, and error correlation

## UI/UX Decisions
- **Design Theme**: Near-pastel aesthetic with lighter color palettes (e.g., slate-600/indigo-500/purple-500 gradients).
- **Spacing**: Optimized for conciseness and premium look (reduced padding/margins).
- **Typography**: Increased header logo and button sizes for readability.
- **Branding**: Rebranded as "Clasio - AI-Powered Document Management".
- **Voice Search Icon**: Custom PNG microphone (ClasioMic_noborder_1759626117703.png) with neural network visualization; features pseudo-element glow layer (radial gradient purple-to-indigo) to avoid PNG edge artifacts; glow pulses on active state with opacity/scale animations; clean border-free rendering in all states.
- **Text Readability**: Document cards use deep charcoal (#1E1E1E) in light mode and slate-100 in dark mode for improved readability; applies to AI results, summaries, and metadata across desktop and mobile views.
- **Document Titles**: Use traditional blue hyperlink colors (text-blue-600 light mode, text-blue-400 dark mode) with font-medium weight for clarity and clickability; hover states show darker blue with underline on desktop.

## Feature Specifications
- **Analytics Dashboard**: `/analytics` route displaying total documents, unique users, average documents per user, and storage used.
- **Contact Form**: Integrated with Resend API (currently in testing mode, requires domain verification for production).

# External Dependencies

## Core Services
- **Database**: PostgreSQL (via Neon serverless)
- **File Storage**: Google Cloud Storage
- **AI Service**: Google Gemini AI API
- **Email Service**: Resend API (for contact form)

## Development Tools
- **Build System**: Vite
- **Type Safety**: TypeScript
- **Code Quality**: ESBuild

## Third-Party Libraries
- **UI Components**: Radix UI
- **File Uploads**: Uppy ecosystem (with AWS S3 plugin)
- **Database**: Drizzle ORM
- **Styling**: Tailwind CSS
- **State Management**: TanStack Query
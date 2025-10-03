# Clasio - AI-Powered Document Management System

<div align="center">
  <h3>🚀 Intelligent Document Organization & Analysis Platform</h3>
  <p>Built with React, Express, PostgreSQL, and Google Gemini AI</p>
</div>

---

## 📋 Table of Contents

- [Overview](#overview)
- [What's New for October 01, 2025](#whats-new-for-october-01-2025)
- [Core Features](#core-features)
- [Technology Stack](#technology-stack)
- [Getting Started](#getting-started)
- [Environment Configuration](#environment-configuration)
- [Architecture](#architecture)
- [API Documentation](#api-documentation)
- [Deployment](#deployment)

---

## Overview

Clasio is a comprehensive document management system that leverages AI to automatically organize, analyze, and retrieve documents. The platform features intelligent categorization, Smart Organization folders, advanced search capabilities, and seamless cloud storage integration.

**Live Demo:** [clasio.ai](https://clasio.ai)
**Latest Repository:** [Clasio-Replit-MLP-Oct03](https://github.com/gitjiggy/Clasio-Replit-MLP-Oct03)

---

## What's New for October 03, 2025

### 🎨 Premium UI/UX Refinement - Mobile & Desktop Optimization

#### **Mobile Smart Organization Section**
- **Enhanced Visibility**: Redesigned mobile Smart Organization for premium look and feel
  - Increased section height from 16vh → 28vh to show ~2 subfolders by default
  - Changed cards from fixed 896px to flexible `h-full` for responsive layout
  - Added vertical scrolling within cards to access all subfolders
  - Removed container borders to eliminate visual artifacts

- **Subfolder Design Overhaul**: Complete visual redesign for better readability
  - Changed from barely-visible transparent backgrounds to solid white/gray backgrounds
  - Upgraded text from xs to sm size for better legibility
  - Changed color indicators from small squares to prominent circular dots (h-3 w-3)
  - Added white borders to color indicators for depth and definition
  - Implemented solid count badges with dark backgrounds for contrast
  - Applied subtle shadows and borders for card-like appearance
  - Enhanced hover states with purple tint transitions

- **Spacing Optimizations**: Refined vertical spacing throughout mobile layout
  - Added 48px margin (`mt-12`) between filters and Smart Organization
  - Reduced gap from Smart Organization to documents from 48px → 24px (`mt-6`)
  - Removed unnecessary scrollbar from header section
  - Eliminated horizontal dividing line for cleaner appearance

#### **Desktop Sidebar Refinement**
- **Logo Section**: Applied solid black background for optimal white logo contrast
  - Replaced gradient background with `bg-black` for premium appearance
  - Ensures Clasio logo is always clearly visible

- **Sidebar Width**: Expanded from 256px (w-64) to 320px (w-80)
  - Prevents subfolder name overflow with longer titles
  - Provides more breathing room for content

- **Subfolder Display**: Implemented premium 3-word truncation system
  - Smart truncation: Shows first 3 words + ellipsis for long names
  - Full subfolder name visible on hover via title attribute
  - Example: "Product Development And Launch Analysis" → "Product Development And..."
  - Maintains clean, uncluttered sidebar appearance

- **Typography & Spacing**: Enhanced for classy, sophisticated feel
  - Changed indicators from rounded squares to small circular dots (h-2 w-2 rounded-full)
  - Applied light font weights with wider tracking for elegance
  - Implemented pill-shaped count badges with muted backgrounds
  - Refined spacing (ml-7, space-y-0.5) for polished look
  - Softer hover states (accent/50) with smooth transitions

- **Category Button Enhancement**: Improved main folder buttons
  - Increased padding (py-2.5) for better touch targets
  - Applied matching pill-shaped badges for document counts
  - Better gap spacing between icons and text (gap-3)
  - Consistent styling with subfolder design

#### **Document Cards Optimization**
- **Vertical Spacing Reduction**: Tightened gaps throughout cards
  - Reduced AI Analysis → buttons gap by 70% (mt-auto → mt-2)
  - Reduced buttons → card bottom gap by 75% (pb-[3px] → pb-0, added -mb-2)
  - Decreased card height from 420px → 390px for compact display
  - Result: More documents visible per screen, less scrolling required

- **AI Analysis Text Visibility**: Improved readability of AI summaries
  - Removed text truncation (`line-clamp-3`) to show complete summaries
  - No "..." truncation - full text always visible
  - Maintained scrollable overflow for very long summaries
  - Enhanced contrast and legibility

#### **Design Philosophy Applied**
- **Premium & Classy**: Light font weights, refined spacing, sophisticated color palettes
- **High Contrast**: Ensuring visibility of all UI elements (white text on dark, dark text on light)
- **Optimal Spacing**: Strategic use of margins and padding for visual hierarchy
- **Performance**: Efficient viewport usage - more content, less scrolling
- **Consistency**: Unified design language across mobile and desktop

---

## What's New for October 02, 2025

### 🎨 Landing Page Visual Refinement

#### **Lighter, Near-Pastel Color Palette**
- **Hero Gradient**: Updated from darker tones to refined slate-600/indigo-500/purple-500
- **Icon Circles**: Softer purple-400/violet-500 and indigo-400/purple-500 gradient fills
- **Mesh Effects**: Lighter indigo-300/purple-300/violet-300 at 25% opacity for subtle depth
- **Trust Strip**: Matching lighter gradient for visual consistency
- **Overall Aesthetic**: More approachable, premium feel with near-pastel tones

#### **Consistent Color System Across All Pages**
- **Documents Page**: Updated all UI elements to match landing page palette
  - Purple-600/700 → Purple-400/500 for icons and text
  - Dark mode backgrounds: Gray-900/800 instead of purple for consistency
  - Borders: Lighter purple-500/600 for better visual hierarchy
- **Legal Pages**: Maintained neutral gray tones with consistent typography
- **Complete Color Audit**: Removed all darker purple tones (7/8/9 range) except hover states

#### **Contact Form Email Integration**
- **Resend API Integration**: `/api/contact` endpoint for handling contact form submissions
- **Email Validation**: Zod schema validation with proper error handling
- **Rate Limiting**: Prevents spam with Express rate limiter
- **Current Status**: ⚠️ Testing mode - requires domain verification at resend.com/domains
  - Production setup: Must verify custom domain and update sender email
  - Current limitation: Can only send emails in testing mode (both from/to must be account owner)
  - Contact emails route to niraj.desai@gmail.com in testing mode

### 📋 Documentation Updates
- **replit.md**: Comprehensive project history and architecture documentation
- **Legal Pages**: Privacy Policy, Terms & Conditions, and Proof of Claims pages complete
- **Mobile-First Design**: All public pages optimized for mobile devices

---

## What's New for October 01, 2025

### 🚀 Performance Optimizations

#### **Real-Time UI Updates (2.5x Faster)**
- **Reduced polling interval from 5s → 2s** for folders and documents during AI analysis
- Documents and Smart Organization folders now update every 2 seconds instead of 5 seconds
- Users see classification results appear almost instantly as AI analysis completes
- Immediate UI refresh when AI processing finishes

#### **Parallel AI Processing (67% Faster)**
- **Increased concurrent AI workers from 3 → 5** for parallel document analysis
- Can now process 5 documents simultaneously instead of 3
- Token bucket rate limiting ensures compliance with Gemini API limits (15 req/min)
- Multiple documents in batch uploads process in parallel for faster completion
- Smart worker management prevents API rate limit violations

#### **Cost-Efficient AI Model**
- Maintained **gemini-2.5-flash-lite** for optimal cost/performance balance
- Fast AI analysis while keeping API costs minimal for scalability
- Supports free tier with intelligent 15 RPM rate limiting
- Production-ready model with GA support and reliability

### 📊 Architecture Improvements

#### **Database Query Optimization (6-12x Faster)**
- **Eliminated N+1 Query Problem**: Reduced document loading from 151 → 4 queries
- **Bulk Query Strategy**: Uses `inArray()` and `Promise.all()` for tags/versions loading
- **Smart Batching**: Groups related queries for single database round-trips
- **Dramatic Performance Gain**: Document list page loads 6-12x faster

#### **Smart Polling Strategy**
- **Conditional Polling**: Frontend only polls during active AI processing
- **Resource Efficient**: Reduces unnecessary backend load when no analysis is running
- **Automatic Detection**: Detects when AI analysis is complete and stops polling
- **Battery Friendly**: Minimizes polling for mobile/laptop battery life

#### **Production Health Checks**
- **Fast Readiness Endpoint**: `/ready` responds in <1ms for deployment monitoring
- **Deployment Integration**: Works seamlessly with Replit deployments
- **Database Verification**: Health checks validate database connectivity
- **Zero Downtime**: Proper health checks enable smooth deployments

### 🔒 Security & Reliability

#### **Firebase Auth Custom Domain (Production Ready)**
- **Fully Resolved**: Custom domain OAuth working at clasio.ai
- **Streaming Reverse Proxy**: Proper Firebase auth routing without buffering
- **Path Rewrite Middleware**: Correctly handles `/__/auth/*` routes for OAuth flows
- **Redirect-Based Auth**: Reliable authentication using `signInWithRedirect`
- **Domain Configuration**: Proper authDomain setup for custom domain compatibility

#### **OAuth Flow Stability**
- **One-Time Redirect Check**: `getRedirectResult` called once on app boot
- **State Management**: Proper auth state tracking with `onAuthStateChanged`
- **No Race Conditions**: Fixed infinite loading states from competing auth checks
- **Production Tested**: Verified working on clasio.ai deployment

### 📈 Smart Organization Enhancements

- **Real-Time Folder Creation**: Auto-created folders appear immediately during analysis
- **Live Document Counts**: Folder counts update in real-time as documents are classified
- **Faster Classification**: Documents routed to correct folders 2-3x faster
- **Visual Feedback**: Users see Smart Organization working in real-time

---

## Core Features

### 🤖 AI-Powered Analysis

- **Automatic Document Summarization**: Gemini AI generates concise, professional summaries
- **Intelligent Classification**: Auto-categorizes documents (Legal, Medical, Financial, Taxes, Travel, Education, Employment, Personal, Business)
- **Key Topic Extraction**: Identifies and extracts main topics and themes
- **Document Type Detection**: Recognizes specific document types (W-2, 1099, Medical Records, Contracts, etc.)
- **Metadata Extraction**: Extracts year, filing status, body part (medical), document purpose, and subtypes
- **Confidence Scoring**: Provides classification confidence scores for transparency

### 📁 Smart Organization

- **Auto-Created Folders**: Documents automatically organized into category folders
- **Hierarchical Structure**: Main categories with detailed subcategories
  - Example: `Medical` → `Medical Records`, `Lab Results`, `Prescriptions`
- **Real-Time Updates**: Folders appear and populate automatically as AI analysis completes
- **Document Counts**: Live counts showing documents in each folder
- **Visual Indicators**: Color-coded badges and confidence indicators

### 🔍 Advanced Search

- **Full-Text Search**: Search across document names, content, and AI-generated summaries
- **Filter by Category**: Quick filter by document category/type
- **Filter by File Type**: Filter by PDF, Word, Excel, Images, etc.
- **Filter by Folder**: Browse documents within specific folders
- **Tag-Based Search**: Find documents by tags
- **Combined Filters**: Stack multiple filters for precise results

### 📤 File Upload & Storage

- **Multi-File Upload**: Drag-and-drop or browse to upload multiple files
- **Cloud Storage**: Google Cloud Storage integration for scalable file hosting
- **Supported Formats**:
  - **Documents**: PDF, DOCX, DOC, TXT
  - **Spreadsheets**: XLSX, XLS, CSV
  - **Images**: PNG, JPG, JPEG, GIF, WEBP
- **File Size Limits**: 50MB per file with server-side validation
- **Security**: MIME type validation and access control
- **Progress Tracking**: Real-time upload progress with AI analysis queue visibility

### 🗂️ Document Management

- **Version Control**: Track document revisions with full version history
- **Tag System**: Add custom tags for flexible organization
- **Document Preview**: In-app preview for supported file types
- **Download & Share**: Easy download with sharing capabilities
- **Bulk Operations**: Select multiple documents for batch actions
- **Trash & Recovery**: Soft delete with recovery option

### 📊 AI Analysis Queue

- **Queue Dashboard**: Real-time visibility into AI processing pipeline
- **Three-Stage Processing**:
  1. **Content Extraction**: Extract text from documents
  2. **AI Analysis**: Gemini analyzes content for classification
  3. **Embedding Generation**: Create vector embeddings for semantic search
- **Status Tracking**: See pending, processing, completed, and failed jobs
- **Rate Limiting**: Visual indicators for API quota usage (15 req/min)
- **Retry Logic**: Automatic retry with exponential backoff for failed jobs
- **Parallel Workers**: 5 concurrent workers for faster batch processing

### 🔐 Authentication & Security

- **Firebase Authentication**: Google OAuth integration
- **Custom Domain Support**: Full OAuth support on clasio.ai
- **Redirect-Based Auth**: Reliable authentication flow with redirect handling
- **Session Persistence**: Browser-based session management
- **Tenant Isolation**: Multi-tenant architecture with user data separation
- **Access Control**: Fine-grained permissions for document access

---

## Technology Stack

### Frontend
- **React 18** with TypeScript
- **Vite** - Lightning-fast build tool
- **TanStack Query** - Server state management
- **Wouter** - Lightweight routing
- **Shadcn/ui** - Beautiful, accessible components
- **Tailwind CSS** - Utility-first styling
- **Uppy.js** - Advanced file uploads

### Backend
- **Express.js** - Node.js web framework
- **TypeScript** - Type-safe backend code
- **Drizzle ORM** - Type-safe database queries
- **PostgreSQL** - Primary database (Neon serverless)
- **Google Cloud Storage** - File storage
- **Firebase Admin** - Authentication verification

### AI & Analytics
- **Google Gemini 2.5 Flash Lite** - Document analysis (cost-efficient)
- **Google Gemini Embedding** - Vector embeddings
- **Custom AI Queue System** - Rate-limited processing with 5 parallel workers

### Infrastructure
- **Replit Deployments** - Production hosting
- **Custom Domain** - clasio.ai
- **Environment Secrets** - Secure credential management

---

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL database
- Google Cloud Platform account (for GCS)
- Firebase project (for authentication)
- Gemini API key

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/gitjiggy/Clasio-Replit-MLP-Oct03.git
   cd Clasio-Replit-MLP-Oct03
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables** (see [Environment Configuration](#environment-configuration))

4. **Set up database**
   ```bash
   npm run db:push
   ```

5. **Start development server**
   ```bash
   npm run dev
   ```

6. **Access the application**
   - Frontend: http://localhost:5000
   - Backend API: http://localhost:5000/api

---

## Environment Configuration

### Required Environment Variables

Create a `.env` file in the root directory:

```bash
# Database
DATABASE_URL=postgresql://user:password@host:5432/database

# Google Cloud Storage
GCP_PROJECT_ID=your-project-id
GCS_BUCKET_NAME=your-bucket-name
GCP_SERVICE_ACCOUNT_KEY={"type":"service_account",...}

# Firebase Authentication
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret

# Gemini AI
GEMINI_API_KEY=your-gemini-api-key

# Session Secret
SESSION_SECRET=your-random-session-secret
```

### Frontend Environment Variables

Create a `.env` file in the `client/` directory:

```bash
# Firebase Config
VITE_FIREBASE_API_KEY=your-firebase-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-auth-domain  # For custom domain: your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abcdef
```

---

## Architecture

### Project Structure

```
Clasio-Replit-MLP-Oct03/
├── client/                # Frontend React application
│   ├── src/
│   │   ├── components/    # Reusable UI components
│   │   ├── contexts/      # React contexts (Auth, Theme)
│   │   ├── hooks/         # Custom React hooks
│   │   ├── lib/           # Utilities and helpers
│   │   ├── pages/         # Page components
│   │   └── App.tsx        # Root component
│   └── public/            # Static assets
├── server/                # Backend Express application
│   ├── routes.ts          # API routes
│   ├── storage.ts         # Database abstraction layer
│   ├── gemini.ts          # AI integration
│   ├── aiQueueProcessor.ts # AI job queue processor
│   └── index.ts           # Server entry point
├── shared/                # Shared TypeScript definitions
│   └── schema.ts          # Database schema (Drizzle)
└── migrations/            # Database migrations
```

### Database Schema

#### Core Tables

- **documents**: Document metadata, AI analysis results
- **document_versions**: Version history
- **folders**: Hierarchical folder structure
- **tags**: Tag definitions
- **document_tags**: Many-to-many document-tag relationships
- **ai_analysis_queue**: AI processing job queue

#### Key Relationships

- Documents → Folders (many-to-one)
- Documents → Tags (many-to-many via document_tags)
- Documents → Versions (one-to-many)
- Folders → Subfolders (self-referential hierarchy)

---

## API Documentation

### Authentication

All API endpoints require Firebase authentication via `Authorization: Bearer <token>` header.

### Core Endpoints

#### Documents

- `GET /api/documents` - List documents with pagination & filters
- `GET /api/documents/:id` - Get single document
- `POST /api/documents` - Create new document
- `PATCH /api/documents/:id` - Update document
- `DELETE /api/documents/:id` - Soft delete document

#### Folders

- `GET /api/folders` - List all folders with document counts
- `POST /api/folders` - Create folder
- `PATCH /api/folders/:id` - Update folder
- `DELETE /api/folders/:id` - Delete folder

#### Tags

- `GET /api/tags` - List all tags
- `POST /api/tags` - Create tag
- `DELETE /api/tags/:id` - Delete tag

#### AI Queue

- `GET /api/queue/status` - Get queue statistics
- `GET /api/queue/jobs` - List active jobs
- `POST /api/queue/retry/:documentId` - Retry failed job

#### File Upload

- `POST /api/upload/signed-url` - Get signed upload URL
- `POST /api/upload/complete` - Complete upload & trigger AI analysis

---

## Deployment

### Replit Deployment

1. **Environment Variables**: Set all required secrets in Replit
2. **Database**: Use built-in PostgreSQL or Neon connection
3. **Deploy**: Click "Deploy" in Replit
4. **Custom Domain**: Configure DNS for custom domain (e.g., clasio.ai)

### Production Checklist

- ✅ All environment variables configured
- ✅ Firebase OAuth authorized domains set
- ✅ GCS bucket CORS configured
- ✅ Database migrations applied
- ✅ Health check endpoint responding
- ✅ AI queue processor running with 5 workers
- ✅ Rate limits configured (15 req/min)
- ✅ Custom domain OAuth verified

---

## Development Workflow

### Running Locally

```bash
npm run dev          # Start both frontend and backend
npm run db:push      # Push schema changes to database
```

### Database Operations

```bash
npm run db:push      # Push schema changes (no migrations)
npm run db:push --force  # Force push (data loss warning)
```

### Code Quality

- TypeScript for type safety
- ESLint for code quality
- Automatic formatting with Prettier (via Vite)

---

## Monitoring & Observability

### Health Checks

- `GET /ready` - Fast readiness check (<1ms)
- `GET /health` - Detailed health status

### Logging

- Structured JSON logging with Winston
- Request/response logging with correlation IDs
- AI queue processing logs
- Error tracking and alerting

### Metrics

- API response times
- AI processing queue depth (5 parallel workers)
- Upload success/failure rates
- Authentication metrics
- Database query performance

---

## Performance Benchmarks (October 01, 2025)

### Before Optimization
- Document list load: 151 database queries
- UI polling interval: 5 seconds
- AI worker concurrency: 3 workers
- Smart Organization update: 5-10 second delay

### After Optimization
- Document list load: 4 database queries (97% reduction)
- UI polling interval: 2 seconds (2.5x faster)
- AI worker concurrency: 5 workers (67% increase)
- Smart Organization update: Real-time (<2 seconds)

### Performance Gains
- **6-12x faster** document loading
- **2.5x faster** UI updates during AI analysis
- **67% more** parallel processing capacity
- **Real-time** Smart Organization updates

---

## Roadmap

### Planned Features

- 📱 **PWA Support**: Camera capture, voice search, offline mode
- 🔍 **Semantic Search**: Vector-based similarity search
- 📊 **Analytics Dashboard**: Usage insights and trends
- 🔔 **Notifications**: Real-time alerts for document events
- 🌐 **Multi-language Support**: Internationalization
- 💰 **Freemium Model**: 200 docs + 1GB free, $1/GB additional

---

## Contributing

This is a proprietary project. For vendor collaboration, please contact the repository maintainers.

---

## License

Proprietary - All Rights Reserved

---

## Support

For technical support or questions:
- **Email**: support@clasio.ai
- **Documentation**: [Internal Wiki]
- **Issues**: GitHub Issues (for authorized collaborators)

---

## Acknowledgments

- Google Gemini AI for document analysis
- Replit for hosting infrastructure
- Open source community for amazing tools and libraries

---

<div align="center">
  <p>Built with ❤️ by the Clasio Team</p>
  <p>© 2025 Clasio. All rights reserved.</p>
</div>

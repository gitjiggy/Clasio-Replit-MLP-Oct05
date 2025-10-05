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
- **AI Provider**: Google Gemini 2.5 Flash
- **Analysis Features**: Summarization, topic extraction, classification, sentiment analysis, word count statistics.
- **Processing**: Asynchronous analysis with database storage.

## Policy-Driven Search Architecture
- **Search Engine**: Comprehensive policy-driven system
- **Query Classification**: 7 query classes (e.g., `entity.proper`, `id/code`, `topic.freeform`)
- **Scoring**: Per-field lexical signals, max-field logic, proximity bonuses
- **Tier Routing**: Policy-driven tier selection with absolute ceilings
- **Instrumentation**: Comprehensive logging and anomaly detection
- **API Endpoint**: `/api/search/policy-driven`

## Authentication & Security
- **Authentication**: Firebase Authentication (redirect-based flow for custom domains)
- **Firebase Configuration**: `authDomain` locked to `documentorganizerclean-b629f.firebaseapp.com`
- **File Access**: Custom object ACL system with group-based permissions
- **Security**: 50MB file size limits with type restrictions, client-side error boundaries.

## UI/UX Decisions
- **Design Theme**: Near-pastel aesthetic with lighter color palettes (e.g., slate-600/indigo-500/purple-500 gradients).
- **Spacing**: Optimized for conciseness and premium look (reduced padding/margins).
- **Typography**: Increased header logo and button sizes for readability.
- **Branding**: Rebranded as "Clasio - AI-Powered Document Management".
- **Voice Search Icon**: Custom SVG microphone with neural network visualization; features dual-circle glow pattern (soft/strong filters) and pulse animations on active state; purple-to-indigo gradients match brand palette.

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
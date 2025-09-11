# Overview

This is a modern document management system built with React and Express, featuring AI-powered document analysis using Google's Gemini AI. The application allows users to upload, organize, and analyze documents with features like folders, tags, version control, and automatic AI summarization. It uses PostgreSQL for data persistence and Google Cloud Storage for file storage.

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
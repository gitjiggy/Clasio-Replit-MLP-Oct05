# Clasio - AI-Powered Document Management System

A comprehensive document management platform built with React, Express, and AI integration that helps users organize, search, and analyze documents with intelligent automation.

## 🚀 Key Features

### 📁 **Document Management**
- **Upload Documents**: Support for PDFs, Word docs, Excel files, images, and more
- **Folder Organization**: Create custom folder hierarchies for logical document organization
- **Tag System**: Add multiple tags to documents for flexible categorization
- **Version Control**: Automatic versioning when documents are updated
- **Bulk Operations**: Select and manage multiple documents simultaneously

### 🔍 **Intelligent Search**
- **Simple Search**: Fast text-based search across document names, content, and tags
- **AI Search**: Natural language search with semantic understanding
  - Ask questions like "find my tax documents from last year"
  - Search by document content, topics, and AI-generated summaries
- **Advanced Filters**: Filter by file type, folder, date range, and tags
- **Search Confidence Scoring**: Visual indicators showing search result relevance

### 🤖 **AI-Powered Analysis**
- **Automatic Document Analysis**: AI extracts key information from uploaded documents
- **Smart Categorization**: Auto-classification into business categories (Legal, Financial, Medical, etc.)
- **Document Type Detection**: Automatically identifies document types (Invoice, Contract, Report, etc.)
- **Key Topic Extraction**: Identifies and highlights main topics and themes
- **Content Summarization**: Generates concise summaries of document content
- **Sentiment Analysis**: Analyzes document tone and sentiment

### 🔗 **Google Drive Integration**
- **Seamless Sync**: Connect your Google Drive account for two-way synchronization
- **Import Existing Files**: Bulk import documents from Google Drive
- **Real-time Updates**: Changes in Drive automatically sync to Clasio
- **Dual Access**: View and edit documents in both Clasio and Google Drive

### 👤 **User Experience**
- **Firebase Authentication**: Secure login with Google accounts
- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile devices
- **Dark/Light Mode**: Toggle between themes for comfortable viewing
- **Real-time Updates**: Live status updates for document processing
- **Intuitive Interface**: Clean, modern UI with familiar document management patterns

## 🎯 **User Workflows**

### **Document Upload & Organization**
1. **Upload**: Drag & drop files or click to browse
2. **Auto-Analysis**: AI automatically processes documents in the background
3. **Organization**: Move to folders, add tags, or let AI suggest categories
4. **Access**: View, download, or share documents instantly

### **Smart Search Experience**
1. **Choose Search Mode**: 
   - Simple search for quick text matches
   - AI search for conversational queries
2. **Get Results**: View documents with confidence scores and relevance indicators
3. **Preview**: Click any document to see detailed preview with AI insights
4. **Refine**: Use filters to narrow down results

### **Document Editing & Management**
1. **Document Modal**: Click any document to open detailed view
2. **Edit Properties**: Update name, folder, tags, and AI classifications
3. **Version History**: View and manage document versions
4. **Actions**: Download, view in new tab, or delete documents

### **AI Insights Dashboard**
1. **Analysis Status**: Monitor AI processing queue and completion status
2. **Document Intelligence**: View AI-generated summaries, topics, and classifications
3. **Search Analytics**: See which documents match your queries and why
4. **Confidence Indicators**: Purple gradient bars show AI confidence levels

## 🛠 **Technical Setup**

### **Prerequisites**
- Node.js 18+ 
- PostgreSQL database
- Google Cloud Storage bucket
- Firebase project
- Google Gemini AI API key (optional, for AI features)

### **Environment Variables**
Create a `.env` file with the following variables:

```env
# Database
DATABASE_URL=postgresql://username:password@host:port/database

# Firebase Configuration
VITE_FIREBASE_PROJECT_ID=your-firebase-project-id
VITE_FIREBASE_API_KEY=your-firebase-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id

# Google Cloud Storage
GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account-key.json
GOOGLE_CLOUD_STORAGE_BUCKET=your-storage-bucket

# AI Integration (Optional)
GEMINI_API_KEY=your-gemini-api-key

# Session Security
SESSION_SECRET=your-secure-session-secret

# Development
NODE_ENV=development
```

### **Installation & Setup**

1. **Clone the Repository**
   ```bash
   git clone https://github.com/gitjiggy/Clasio-Replit-MVP-Sep22-20250923-0944.git
   cd Clasio-Replit-MVP-Sep22-20250923-0944
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Database Setup**
   ```bash
   # Push database schema
   npm run db:push
   
   # For fresh setup, use force if needed
   npm run db:push --force
   ```

4. **Start Development Server**
   ```bash
   npm run dev
   ```

5. **Access the Application**
   - Open http://localhost:5000
   - Sign in with your Google account
   - Start uploading and managing documents!

## 📊 **System Architecture**

### **Frontend (React + TypeScript)**
- **Pages**: Documents dashboard, Drive integration, document viewer
- **Components**: Modern UI with Radix UI primitives and Tailwind CSS
- **State Management**: TanStack Query for server state, React Context for auth
- **Routing**: Wouter for lightweight client-side routing

### **Backend (Express + TypeScript)**
- **API Routes**: RESTful endpoints for documents, folders, tags, and search
- **Authentication**: Firebase Admin SDK for secure token verification
- **File Processing**: Multer for uploads, Google Cloud Storage for persistence
- **AI Integration**: Google Gemini API for document analysis
- **Queue Processing**: Background jobs for AI analysis and Drive sync

### **Database (PostgreSQL + Drizzle ORM)**
- **Documents**: Core document metadata and AI analysis results
- **Folders**: Hierarchical organization structure
- **Tags**: Flexible tagging system with many-to-many relationships
- **Versions**: Complete version history for document revisions
- **Queue**: Background job processing for AI and sync operations

### **Storage & AI**
- **Google Cloud Storage**: Scalable file storage with public/private access control
- **Google Gemini AI**: Document analysis, summarization, and semantic search
- **Firebase Auth**: Secure user authentication and session management

## 🔧 **Advanced Features**

### **AI Search Capabilities**
- **Semantic Understanding**: Ask natural language questions
- **Multi-modal Search**: Search across text, topics, and document metadata
- **Confidence Scoring**: 3-tier scoring system (High: 80%+, Medium: 40-79%, Low: <40%)
- **Query Intelligence**: Automatically extracts keywords and intent from conversational queries

### **Document Intelligence**
- **Content Extraction**: Full text extraction from PDFs, Word docs, and images
- **Topic Modeling**: Identifies key themes and subjects
- **Classification**: Business category and document type detection
- **Quality Scoring**: Assesses document completeness and relevance

### **Integration Features**
- **Google Drive Sync**: Bi-directional synchronization with real-time updates
- **Embedding Generation**: Vector embeddings for semantic similarity search
- **Batch Processing**: Queue-based system for handling multiple documents
- **Rate Limiting**: API protection with intelligent request throttling

## 📱 **User Interface Highlights**

### **Main Dashboard**
- Grid/list view toggle for document browsing
- Real-time search with instant results
- Folder navigation with breadcrumbs
- Tag filtering and management
- Batch selection and operations

### **Document Modal**
- Full document preview with AI insights
- Editable properties (name, folder, tags)
- AI-generated summaries and key topics
- Confidence indicators for AI classifications
- Version history and download options

### **Search Interface**
- Toggle between Simple and AI search modes
- Auto-complete for tags and folders
- Visual confidence indicators with purple gradients
- Grouped results (Relevant vs Related)
- Advanced filtering options

## 🔒 **Security & Privacy**

- **Secure Authentication**: Firebase-based Google OAuth integration
- **Private File Storage**: User-isolated document storage
- **Session Management**: Secure session handling with proper tokens
- **API Protection**: Rate limiting and input validation
- **Data Encryption**: All data encrypted in transit and at rest

## 🚀 **Deployment**

The application is designed to run on modern cloud platforms:
- **Development**: `npm run dev` (includes both frontend and backend)
- **Production**: Build optimized bundles with `npm run build`
- **Database**: Automated schema management with Drizzle Kit
- **Scaling**: Stateless design supports horizontal scaling

## 📈 **Performance Features**

- **Lazy Loading**: Documents load progressively for large collections
- **Caching**: Intelligent caching of AI results and frequent queries
- **Optimization**: Compressed assets and optimized bundle sizes
- **Background Processing**: Non-blocking AI analysis and file processing

## 🎨 **Customization**

- **Theming**: Built-in dark/light mode support
- **Categories**: Customizable document categories and types
- **Tags**: User-defined tagging system
- **Workflows**: Configurable folder structures and organization patterns

---

## 🆘 **Support & Troubleshooting**

### **Common Issues**
1. **Upload Failures**: Check file size limits (50MB max) and supported formats
2. **AI Analysis Delayed**: Monitor queue status in the dashboard
3. **Search Not Working**: Ensure documents have been processed and indexed
4. **Drive Sync Issues**: Verify Google Drive permissions and API quotas

### **Getting Help**
- Check console logs for detailed error messages
- Verify all environment variables are properly configured
- Ensure database schema is up to date with `npm run db:push`
- Monitor the AI processing queue for background job status

---

**Built with ❤️ for efficient document management and AI-powered insights**
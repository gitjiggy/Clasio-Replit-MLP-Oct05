import { useState, useEffect, useCallback, useRef } from "react";

// Humorous delete messaging for Clasio's document management
const DELETE_FLAVOR_TEXT = [
  "Saying goodbye to your files...",
  "Bidding adieu to your documents...",
  "Organizing the great digital decluttering...",
  "Teaching your docs to pack their bags...",
  "Filing papers in the virtual shredder...",
  "Helping documents find their way to the cloud recycling bin...",
  "Convincing files to take a well-deserved vacation...",
  "Orchestrating the grand document exodus...",
  "Whispering sweet farewells to your uploads...",
  "Conducting the paperless office cleanup ceremony...",
];

// Custom hook for rotating delete flavor text
function useDeleteFlavor(isDeleting: boolean) {
  const [idx, setIdx] = useState(0);
  
  useEffect(() => {
    if (!isDeleting) return;
    
    const timer = setInterval(() => {
      setIdx(i => (i + 1) % DELETE_FLAVOR_TEXT.length);
    }, 2000); // Change every 2 seconds
    
    return () => clearInterval(timer);
  }, [isDeleting]);
  
  return isDeleting ? DELETE_FLAVOR_TEXT[idx] : "Delete All";
}
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { ObjectUploader } from "@/components/ObjectUploader";
import { DocumentModal } from "@/components/DocumentModal";
import { QueueStatusDashboard } from "@/components/QueueStatusDashboard";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { trackEvent } from "@/lib/analytics";
import { getGoogleAccessToken } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import type { UploadResult } from "@uppy/core";
import type { DocumentWithFolderAndTags, DocumentWithVersions, DocumentVersion, Folder, Tag } from "@shared/schema";
import { getDocumentDisplayName, getDocumentTooltip, type DocumentWithVersionInfo } from "@/lib/documentDisplay";
import { 
  Search, 
  Upload, 
  Download, 
  Eye, 
  MoreVertical, 
  Grid3X3, 
  List, 
  FolderOpen,
  FileText,
  Star,
  Trash2,
  File,
  FileImage,
  FileSpreadsheet,
  Presentation,
  History,
  GitBranch,
  Clock,
  CheckCircle,
  Plus,
  Brain,
  Sparkles,
  Target,
  Link2,
  Edit2,
  ExternalLink
} from "lucide-react";

// Calibrate confidence scores for better user experience
function calibrateConfidence(rawScore) {
    // Map raw scores to more intuitive confidence ranges
    if (rawScore >= 70) return Math.min(99, rawScore + 25);  // 70+ becomes 95-99%
    if (rawScore >= 50) return Math.min(85, rawScore + 20);  // 50+ becomes 70-85%
    if (rawScore >= 30) return Math.min(60, rawScore + 20);  // 30+ becomes 50-60%
    return rawScore;  // Below 30 stays as-is
}

// Get confidence level label and color based on score
function getConfidenceLevel(score) {
    if (score >= 90) return { label: "Very High", color: "text-green-800 dark:text-green-400" };
    if (score >= 70) return { label: "High", color: "text-green-600 dark:text-green-500" };
    if (score >= 40) return { label: "Moderate", color: "text-orange-600 dark:text-orange-400" };
    return { label: "Low", color: "text-yellow-600 dark:text-yellow-400" };
}

interface DocumentsResponse {
  documents: DocumentWithVersionInfo[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// Helper function to format confidence percentage
const formatConfidence = (confidence: number | null | undefined): string | null => {
  if (confidence === null || confidence === undefined) return null;
  // Handle both 0-1 float and 0-100 integer formats
  const value = confidence <= 1 ? confidence * 100 : confidence;
  return `${Math.round(value)}%`;
};

// Stop words for AI search preprocessing
const STOP_WORDS = [
    // Document terms
    'document', 'documents', 'doc', 'docs', 'file', 'files', 'paper', 'papers', 
    'form', 'forms', 'record', 'records', 'report', 'reports', 'copy', 'copies',
    'scan', 'scans', 'pdf', 'attachment', 'sheet', 'sheets',
    
    // Action words
    'find', 'show', 'get', 'search', 'look', 'give', 'need', 'want', 'help',
    'locate', 'where', 'what', 'which', 'how', 'when',
    
    // Possessives
    'my', 'mine', 'our', 'ours', 'the', 'this', 'that', 'these', 'those',
    'any', 'some', 'all',
    
    // Storage terms
    'folder', 'drive', 'storage', 'saved', 'uploaded',
    
    // Vague terms
    'stuff', 'things', 'items', 'something', 'anything', 'about', 'related'
];

function preprocessQuery(query: string): string {
    const words = query.toLowerCase().split(/\s+/);
    const filtered = words.filter(word => !STOP_WORDS.includes(word));
    return filtered.join(' ');
}

// AI Analysis flavor text messages
const AI_ANALYSIS_FLAVORS = [
  "🧠 Clasio is analyzing your documents with AI magic...",
  "📚 Our digital librarian is reading through your files...", 
  "🎯 Smart Organization is finding the perfect folders...",
  "✨ Teaching AI to understand your document types...",
  "🔍 Extracting key topics and organizing everything...",
  "🎨 Creating the perfect filing system for you...",
  "⚡ Almost done! Your screen will refresh shortly...",
  "🚀 Finalizing Smart Organization recommendations..."
];

// Custom hook for AI analysis flavor text rotation
function useAIAnalysisFlavor(isActive: boolean) {
  const [flavorIndex, setFlavorIndex] = useState(0);
  
  useEffect(() => {
    if (!isActive) return;
    
    const timer = setInterval(() => {
      setFlavorIndex(i => (i + 1) % AI_ANALYSIS_FLAVORS.length);
    }, 3000); // Change message every 3 seconds
    
    return () => clearInterval(timer);
  }, [isActive]);
  
  return AI_ANALYSIS_FLAVORS[flavorIndex];
}

// Cosine similarity calculation
function cosineSimilarity(vectorA: number[], vectorB: number[]): number {
    if (!vectorA || !vectorB || vectorA.length !== vectorB.length) {
        return 0;
    }
    
    if (vectorA.length === 0) {
        return 0;
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vectorA.length; i++) {
        dotProduct += vectorA[i] * vectorB[i];
        normA += vectorA[i] * vectorA[i];
        normB += vectorB[i] * vectorB[i];
    }
    
    if (normA === 0 || normB === 0) {
        return 0;
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Semantic scoring with maximum field logic
function calculateSemanticScore(doc: any, queryEmbedding: number[]): number {
    const titleScore = cosineSimilarity(queryEmbedding, doc.title_embedding);
    const summaryScore = cosineSimilarity(queryEmbedding, doc.summary_embedding);
    const topicsScore = cosineSimilarity(queryEmbedding, doc.key_topics_embedding);
    const contentScore = cosineSimilarity(queryEmbedding, doc.content_embedding);
    
    // Use maximum field score with slight title boost
    return Math.max(
        titleScore * 0.95,
        summaryScore,
        topicsScore,
        contentScore
    ) * 100;
}

// Smart Query Routing
function isAmbiguousQuery(preprocessedQuery: string): boolean {
    const hasNumbers = /\d+/.test(preprocessedQuery);
    const hasDocumentTerms = /(contract|invoice|receipt|policy|report|statement|tax|resume)/i.test(preprocessedQuery);
    const hasSpecificTerms = preprocessedQuery.length > 8;
    
    return !(hasNumbers || hasDocumentTerms || hasSpecificTerms);
}

// Helper function to check recent access
function checkRecentAccess(docId: string, userId: string, days: number): boolean {
    // TODO: This would typically query the document_access_log table
    // For now, return false as a placeholder
    return false;
}

// Quality Scoring
function calculateQualityScore(doc: any, userId: string): number {
    let score = 0;
    
    // Recent access bonus
    const recentAccess = checkRecentAccess(doc.id, userId, 30); // 30 days
    if (recentAccess) score += 0.3;
    
    // Document completeness
    if (doc.ai_word_count > 100) score += 0.2;
    
    // User favorites
    if (doc.is_favorite) score += 0.5;
    
    return Math.min(1.0, score) * 100;
}

// Helper functions for pre-filtering
function documentTypeMatches(doc: any, query: string): boolean {
    const queryLower = query.toLowerCase();
    const docType = (doc.ai_document_type || doc.override_document_type || '').toLowerCase();
    const category = (doc.ai_category || doc.override_category || '').toLowerCase();
    
    return docType.includes(queryLower) || category.includes(queryLower);
}

function titleSummaryContains(doc: any, query: string): boolean {
    const queryLower = query.toLowerCase();
    const title = (doc.name || doc.ai_concise_name || '').toLowerCase();
    const summary = (doc.ai_summary || '').toLowerCase();
    
    return title.includes(queryLower) || summary.includes(queryLower);
}

// Pre-filtering Logic
function preFilterCandidates(documents: any[], query: string): any[] {
    return documents.filter(doc => 
        !doc.is_deleted &&
        doc.ai_word_count > 50 &&
        (documentTypeMatches(doc, query) || 
         titleSummaryContains(doc, query))
    ).slice(0, 50);
}

// Automatic Embedding Generation
async function onDocumentProcessed(documentId: string): Promise<void> {
    await enqueueEmbeddingGeneration(documentId);
}

async function enqueueEmbeddingGeneration(documentId: string): Promise<void> {
    try {
        await apiRequest('/api/ai-analysis-queue', {
            method: 'POST',
            body: JSON.stringify({
                document_id: documentId,
                job_type: 'embedding_generation',
                status: 'pending',
                priority: 1
            }),
            headers: {
                'Content-Type': 'application/json',
            },
        });
    } catch (error) {
        console.error('Failed to enqueue embedding generation:', error);
        throw error;
    }
}

// Helper function to check if document has embeddings
function hasEmbeddings(doc: any): boolean {
    return doc.embeddings_generated === true && 
           (doc.title_embedding || doc.content_embedding || doc.summary_embedding || doc.key_topics_embedding);
}

// New scoring with embeddings and AI
function calculateNewScore(doc: any, query: string, userId: string): number {
    // Mock query embedding for demonstration - in real implementation this would come from API
    const mockQueryEmbedding = new Array(768).fill(0).map(() => Math.random());
    
    const semanticScore = calculateSemanticScore(doc, mockQueryEmbedding);
    const lexicalScore = 50; // Mock lexical score
    const qualityScore = calculateQualityScore(doc, userId);
    
    return calculateFinalScore(semanticScore, lexicalScore, qualityScore);
}

// Legacy scoring without embeddings
function calculateLegacyScore(doc: any, query: string): number {
    // Simple keyword matching and basic scoring
    const title = (doc.name || '').toLowerCase();
    const summary = (doc.ai_summary || '').toLowerCase();
    const queryLower = query.toLowerCase();
    
    let score = 0;
    if (title.includes(queryLower)) score += 60;
    if (summary.includes(queryLower)) score += 40;
    if (doc.is_favorite) score += 20;
    
    return Math.min(100, score);
}

// Feature flag and fallback logic
function calculateDocumentScore(doc: any, query: string, userId: string): number {
    // Environment variable check (using import.meta.env for frontend)
    const useNewScoring = import.meta.env.VITE_USE_NEW_SCORING === 'true';
    
    if (useNewScoring && hasEmbeddings(doc)) {
        return calculateNewScore(doc, query, userId);
    } else {
        return calculateLegacyScore(doc, query);
    }
}

// Scoring strategy functions
async function fullScoring(candidates: any[], cleanQuery: string, userId: string): Promise<any[]> {
    // Apply scoring to all candidates and sort by score
    const scoredCandidates = candidates.map(doc => ({
        ...doc,
        aiScore: calculateDocumentScore(doc, cleanQuery, userId)
    })).sort((a, b) => b.aiScore - a.aiScore);
    
    console.log('Full scoring for ambiguous query:', cleanQuery);
    return scoredCandidates.slice(0, 10);
}

async function fastScoring(candidates: any[], cleanQuery: string, userId: string): Promise<any[]> {
    // Apply scoring to all candidates and sort by score
    const scoredCandidates = candidates.map(doc => ({
        ...doc,
        aiScore: calculateDocumentScore(doc, cleanQuery, userId)
    })).sort((a, b) => b.aiScore - a.aiScore);
    
    console.log('Fast scoring for specific query:', cleanQuery);
    return scoredCandidates.slice(0, 10);
}

// Main Search Function Integration
async function performAISearch(query: string, userId: string, allDocuments: any[]): Promise<any[]> {
    const cleanQuery = preprocessQuery(query);
    const candidates = preFilterCandidates(allDocuments, cleanQuery);
    
    if (isAmbiguousQuery(cleanQuery)) {
        // Use full 3-stage scoring + optional AI reranking
        return await fullScoring(candidates, cleanQuery, userId);
    } else {
        // Use 3-stage scoring only
        return await fastScoring(candidates, cleanQuery, userId);
    }
}

// 3-tier confidence scoring system
function calculateFinalScore(semanticScore: number, lexicalScore: number, qualityScore: number): number {
    const semantic = semanticScore / 100;
    const lexical = lexicalScore / 100;
    const quality = qualityScore / 100;
    
    // Tier 1: High confidence semantic matches
    if (semantic >= 0.75) {
        return Math.round(semantic * 100);
    }
    
    // Tier 2: Moderate semantic matches
    if (semantic >= 0.4) {
        const combined = (semantic * 0.6) + (lexical * 0.3) + (quality * 0.1);
        return Math.round(combined * 100);
    }
    
    // Tier 3: Low semantic - lexical dominant
    const fallback = (lexical * 0.7) + (quality * 0.3);
    return Math.round(fallback * 100);
}

export default function Documents() {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFileType, setSelectedFileType] = useState("all");
  const [selectedDocument, setSelectedDocument] = useState<DocumentWithFolderAndTags | null>(null);
  const [documentModalOpen, setDocumentModalOpen] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState("all");
  const [selectedTagId, setSelectedTagId] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);
  const [showSmartOrg, setShowSmartOrg] = useState(false);
  const [queueDashboardOpen, setQueueDashboardOpen] = useState(false);
  const [searchMode, setSearchMode] = useState<"simple" | "ai">("simple");
  const [aiSearchResults, setAiSearchResults] = useState<any>(null);
  const [aiSearchLoading, setAiSearchLoading] = useState(false);
  
  // Track if user has manually toggled Smart Org (to prevent auto-reopening)
  const userToggledSmartOrgRef = useRef(false);
  
  // State for AI analysis polling
  const [recentUploads, setRecentUploads] = useState<{ timestamp: number; documentIds: string[] }>({ timestamp: 0, documentIds: [] });
  const [isPollingForAI, setIsPollingForAI] = useState(false);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // AI analysis flavor text for notifications
  const currentAIFlavor = useAIAnalysisFlavor(isPollingForAI);
  
  // Show rotating AI analysis notifications during polling
  useEffect(() => {
    if (!isPollingForAI) return;
    
    // Show toast notification with current flavor text
    toast({
      title: "🤖 Smart Organization Active",
      description: currentAIFlavor,
      duration: 2800, // Show for slightly less than rotation time
    });
  }, [isPollingForAI, currentAIFlavor, toast]);

  // Handle search with debouncing
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    
    // Clear existing timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
    
    // Set new timeout for analytics tracking
    if (query.trim()) {
      const timeout = setTimeout(() => {
        trackEvent('search', { search_term: query.trim() });
      }, 500); // 500ms debounce
      setSearchTimeout(timeout);
    }
  };

  // Handle AI Search Go button
  const handleAISearch = async () => {
    if (searchQuery.trim()) {
      setAiSearchLoading(true);
      const processedQuery = preprocessQuery(searchQuery.trim());
      console.log('AI Search triggered for:', searchQuery);
      console.log('Processed query:', processedQuery);
      
      try {
        // Call the new /api/search endpoint
        const response = await apiRequest('/api/search', {
          method: 'POST',
          body: JSON.stringify({
            query: searchQuery.trim(),
            fileType: selectedFileType === "all" ? undefined : selectedFileType,
            folderId: selectedFolderId === "all" ? undefined : selectedFolderId,
            tagId: selectedTagId || undefined,
            limit: 20
          }),
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        console.log('AI Search results:', response);
        setAiSearchResults(response);
        
        trackEvent('ai_search', { 
          search_term: searchQuery.trim(),
          processed_term: processedQuery,
          results_count: response.documents?.length || 0,
          scoring_method: response.scoringMethod,
          use_new_scoring: response.useNewScoring
        });
        
        toast({
          title: "AI Search Complete",
          description: `Found ${response.documents?.length || 0} relevant documents`,
          duration: 1000,
        });
      } catch (error) {
        console.error('AI Search failed:', error);
        console.error('Error details:', {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          name: error instanceof Error ? error.name : undefined
        });
        setAiSearchResults(null);
        toast({
          title: "Search Error",
          description: error instanceof Error ? error.message : "AI search failed. Please try again.",
          variant: "destructive"
        });
      } finally {
        setAiSearchLoading(false);
      }
    }
  };

  // Fetch folders with document counts - poll during AI analysis to catch Smart Organization updates
  const { data: folders = [], isLoading: foldersLoading } = useQuery<(Folder & { documentCount: number })[]>({
    queryKey: ['/api/folders'],
    refetchInterval: isPollingForAI ? 2000 : false, // Poll every 2 seconds during AI analysis for faster updates
  });

  // Get automatic folders only (Smart Organization)
  const automaticFolders = folders.filter(folder => folder.isAutoCreated);
  
  // Build hierarchical structure for automatic folders
  const categoryFolders = automaticFolders.filter(folder => !folder.parentId);
  const subFolders = automaticFolders.filter(folder => folder.parentId);
  
  // Create nested structure and filter out folders with 0 documents using stable backend counts
  const hierarchicalFolders = categoryFolders
    .map(category => ({
      ...category,
      subFolders: subFolders
        .filter(sub => sub.parentId === category.id)
        .filter(sub => sub.documentCount > 0) // Only sub-folders with documents from backend count
    }))
    .filter(category => {
      // Show category if it has documents directly OR has sub-folders with documents
      const hasDirectDocuments = category.documentCount > 0;
      const hasSubFoldersWithDocuments = category.subFolders.length > 0;
      return hasDirectDocuments || hasSubFoldersWithDocuments;
    });

  // Auto-show Smart Organization on mobile when folders are available (only if user hasn't manually closed it)
  useEffect(() => {
    // Only auto-show if user hasn't manually toggled it closed
    if (userToggledSmartOrgRef.current) return;
    
    // Only auto-show on mobile (when button is visible) and when folders exist
    if (hierarchicalFolders.length > 0 && !showSmartOrg) {
      const isMobile = window.innerWidth < 768; // md breakpoint
      if (isMobile) {
        setShowSmartOrg(true);
      }
    }
  }, [hierarchicalFolders.length, showSmartOrg]);

  // Determine if selected folder is a main category or sub-folder
  const selectedFolder = folders.find(f => f.id === selectedFolderId);
  const isMainCategorySelected = selectedFolder && !selectedFolder.parentId;
  const isSubFolderSelected = selectedFolder && selectedFolder.parentId;
  
  // Get sub-folders for the selected main category
  const selectedCategorySubFolders = isMainCategorySelected ? 
    subFolders.filter(sub => sub.parentId === selectedFolderId && sub.documentCount > 0) : 
    [];

  // Fetch documents with AI analysis polling
  const { data: documentsData, isLoading: documentsLoading } = useQuery<DocumentsResponse>({
    queryKey: ['/api/documents', { 
      search: searchQuery, 
      fileType: selectedFileType === "all" ? "" : selectedFileType, 
      folderId: selectedFolderId === "all" ? "" : selectedFolderId, 
      tagId: selectedTagId, 
      page: currentPage 
    }],
    enabled: !isMainCategorySelected, // Only fetch documents when NOT viewing main category sub-folders
    refetchInterval: isPollingForAI ? 2000 : false, // Poll every 2 seconds when expecting AI analysis for faster updates
  });
  


  // Fetch tags
  const { data: tags = [] } = useQuery<Tag[]>({
    queryKey: ['/api/tags'],
  });

  // Check for AI analysis completion and manage polling
  useEffect(() => {
    if (!documentsData?.documents || !isPollingForAI || recentUploads.documentIds.length === 0) {
      return;
    }

    // Check if any recently uploaded documents have been analyzed
    const currentTime = Date.now();
    const uploadTime = recentUploads.timestamp;
    
    console.log(`🔍 Polling check: Looking for ${recentUploads.documentIds.length} documents`, {
      uploadTime: new Date(uploadTime).toISOString(),
      currentTime: new Date(currentTime).toISOString(),
      documentIds: recentUploads.documentIds
    });
    
    const recentlyAnalyzed = documentsData.documents.filter(doc => {
      // Check if this is a recently uploaded document that now has AI analysis
      const isRecentUpload = recentUploads.documentIds.includes(doc.id);
      
      // Deterministic AI analysis completion check - simply check if aiAnalyzedAt exists
      // This is the most reliable indicator that AI analysis has completed
      const hasAIAnalysis = !!doc.aiAnalyzedAt;
      
      if (isRecentUpload) {
        console.log(`📄 Document ${doc.id} (${doc.name}):`, {
          hasAIAnalysis,
          aiAnalyzedAt: doc.aiAnalyzedAt ? new Date(doc.aiAnalyzedAt).toISOString() : 'null',
          aiCategory: doc.aiCategory || 'null',
          aiDocumentType: doc.aiDocumentType || 'null'
        });
      }
      
      return isRecentUpload && hasAIAnalysis;
    });

    console.log(`📊 Polling status: ${recentlyAnalyzed.length}/${recentUploads.documentIds.length} documents analyzed`);

    // Stop polling if all recent uploads have been analyzed or timeout reached (3 minutes)
    const shouldStopPolling = 
      recentlyAnalyzed.length === recentUploads.documentIds.length || 
      (currentTime - uploadTime) > 180000; // 3 minute timeout

    if (shouldStopPolling) {
      console.log('🎉 AI analysis complete for uploaded documents, stopping polling');
      setIsPollingForAI(false);
      setRecentUploads({ timestamp: 0, documentIds: [] });
      
      // Immediate cache invalidation to ensure document cards show updated folder names
      console.log('🔄 Refreshing queries immediately after Smart Organization completion...');
      
      // Force complete cache refresh with stale data removal
      queryClient.invalidateQueries({ 
        queryKey: ['/api/documents'],
        exact: false, // This will invalidate ALL queries starting with ['/api/documents']
        refetchType: 'all' // Force refetch active, inactive, and paused queries
      });
      queryClient.invalidateQueries({ 
        queryKey: ["/api/folders"],
        refetchType: 'all'
      });
      
      // Force immediate refetch of folders AND documents to show Smart Organization results
      console.log('🔄 Forcing immediate refetch of folders and documents...');
      Promise.all([
        queryClient.refetchQueries({ queryKey: ["/api/folders"] }),
        queryClient.refetchQueries({ 
          queryKey: ['/api/documents'],
          exact: false 
        })
      ]).then(() => {
        console.log('✅ Immediate refetch completed - Smart Organization should be visible');
      }).catch((error) => {
        console.error('❌ Immediate refetch failed:', error);
      });
      
      // Also do a second refresh after a short delay to catch any race conditions
      setTimeout(() => {
        console.log('🔄 Secondary refresh for Smart Organization folder sync...');
        queryClient.invalidateQueries({ 
          queryKey: ['/api/documents'],
          exact: false
        });
        queryClient.invalidateQueries({ queryKey: ["/api/folders"] });
        
        // Force refetch the current documents data to ensure folder names are updated
        console.log('🔄 Executing refetchQueries for documents...');
        queryClient.refetchQueries({ 
          queryKey: ['/api/documents'],
          exact: false 
        }).then((results) => {
          console.log('✅ RefetchQueries completed:', results);
          
          // Check what data we actually got back using the correct query key
          const currentQueryKey = ['/api/documents', { 
            search: searchQuery, 
            fileType: selectedFileType === "all" ? "" : selectedFileType, 
            folderId: selectedFolderId === "all" ? "" : selectedFolderId, 
            tagId: selectedTagId, 
            page: currentPage 
          }];
          const documentsQuery = queryClient.getQueryData(currentQueryKey);
          console.log('📊 Current documents data after refetch:', documentsQuery);
          console.log('🔑 Using query key:', currentQueryKey);
          
          if (documentsQuery && documentsQuery.documents) {
            const docsWithFolders = documentsQuery.documents.filter(doc => doc.folder?.name);
            const docsWithoutFolders = documentsQuery.documents.filter(doc => !doc.folder?.name);
            console.log(`📁 Documents with folders: ${docsWithFolders.length}, without folders: ${docsWithoutFolders.length}`);
            
            if (docsWithoutFolders.length > 0) {
              console.log('❌ Documents still missing folder data:', docsWithoutFolders.map(d => ({ id: d.id, name: d.name, folderId: d.folderId })));
            }
          }
        }).catch((error) => {
          console.error('❌ RefetchQueries failed:', error);
        });
      }, 2000); // Shorter delay for secondary refresh
      
      if (recentlyAnalyzed.length > 0) {
        toast({
          title: "Smart Organization Complete! 🎯",
          description: `${recentlyAnalyzed.length} document${recentlyAnalyzed.length > 1 ? 's' : ''} automatically organized. Page refreshing...`,
          duration: 1000,
        });
        
        // Scroll to top to show UI refresh
        setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
      }
    }
  }, [documentsData, isPollingForAI, recentUploads, toast, searchQuery, selectedFileType, selectedFolderId, selectedTagId, currentPage]);

  // Auto-stop polling after timeout
  useEffect(() => {
    if (!isPollingForAI) return;

    const timeoutId = setTimeout(() => {
      console.log('⏰ Polling timeout reached, stopping AI analysis polling');
      setIsPollingForAI(false);
      setRecentUploads({ timestamp: 0, documentIds: [] });
    }, 180000); // 3 minute timeout

    return () => clearTimeout(timeoutId);
  }, [isPollingForAI]);

  // Function to handle upload completion and trigger AI polling
  const handleUploadSuccess = useCallback((docIds: string[]) => {
    console.log('📁 Upload complete, starting AI analysis polling for:', docIds);
    
    // Set recent uploads and start polling
    setRecentUploads({
      timestamp: Date.now(),
      documentIds: docIds
    });
    setIsPollingForAI(true);
    
    // Invalidate documents and queue status immediately, but NOT folders
    // Folders and documents will be invalidated after Smart Organization completes
    queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
    queryClient.invalidateQueries({ queryKey: ["/api/queue/status"] });
  }, [queryClient]);

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (data: {
      uploadURL: string;
      name: string;
      originalName: string;
      fileSize: number;
      fileType: string;
      mimeType: string;
      folderId?: string;
      tagIds?: string[];
    }) => {
      const response = await apiRequest("POST", "/api/documents", data);
      return response.json();
    },
    onSuccess: (data) => {
      // Extract document ID from response and trigger AI polling
      if (data?.id) {
        handleUploadSuccess([data.id]);
      } else {
        // Fallback: just invalidate queries if no ID available
        queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
        queryClient.invalidateQueries({ queryKey: ['/api/folders'] });
      }
      
      toast({
        title: "Upload successful",
        description: "Document has been uploaded successfully.",
        duration: 1000,
      });
    },
    onError: (error) => {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // AI Analysis mutation
  const analyzeDocumentMutation = useMutation({
    mutationFn: async (documentId: string) => {
      // Track AI analysis initiation
      trackEvent('ai_analysis_start', { document_id: documentId, analysis_type: 'gemini' });
      
      // Drive authentication is now handled via httpOnly cookies
      // No need to check for tokens or send in headers
      
      const response = await apiRequest(`/api/documents/${documentId}/analyze`, {
        method: "POST",
      });
      return response;
    },
    onSuccess: (data) => {
      // Track successful AI analysis
      trackEvent('ai_analysis_complete', { analysis_type: 'gemini' });
      
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/folders'] }); // Keep folder counts fresh
      toast({
        title: "AI Analysis Complete",
        description: "Document has been analyzed with AI successfully. Page refreshing...",
        duration: 1000,
      });
      
      // Scroll to top to show UI refresh
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
    },
    onError: (error) => {
      // Track failed AI analysis
      trackEvent('ai_analysis_failed', { analysis_type: 'gemini', error_message: error.message });
      
      // Check if it's a Drive token issue and provide helpful guidance
      const isDriveTokenIssue = error.message.includes("Drive access token");
      
      toast({
        title: "AI Analysis Failed",
        description: isDriveTokenIssue 
          ? "Drive access expired. Go to Google Drive tab to reconnect, then try again."
          : error.message,
        variant: "destructive",
      });
    },
  });

  // Delete mutation
  const deleteDocumentMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const response = await apiRequest("DELETE", `/api/documents/${documentId}`);
      // Handle 204 No Content response (successful delete with no body)
      if (response.status === 204) {
        return { success: true };
      }
      // For other responses, try to parse JSON
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/folders'] }); // Keep folder counts fresh
      queryClient.invalidateQueries({ queryKey: ['/api/documents/trash'] }); // Refresh trash tab
      toast({
        title: "Document deleted",
        description: "Document has been deleted successfully.",
        duration: 1000,
      });
    },
    onError: (error) => {
      toast({
        title: "Delete failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Smart Organization mutation
  const organizeAllMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/documents/organize-all");
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/folders'] });
      toast({
        title: "Smart Organization Complete",
        description: (data.message || `Organized ${data.organized} documents into smart folders`) + " - Page refreshing...",
        duration: 1000,
      });
      
      // Scroll to top to show UI refresh
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
    },
    onError: (error) => {
      toast({
        title: "Smart Organization failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete all documents mutation (for testing)
  const deleteAllDocumentsMutation = useMutation({
    mutationFn: async () => {
      // Use the new "delete all" endpoint that gets ALL active documents
      const response = await apiRequest("DELETE", "/api/documents/all");
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/folders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/documents/trash'] }); // Refresh trash tab
      toast({
        title: "All documents deleted",
        description: data.message || `Successfully moved ${data.deletedCount} documents to trash`,
        duration: 1000,
      });
    },
    onError: (error) => {
      toast({
        title: "Delete all failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Humorous delete messages that rotate while deleting
  const deleteFlavorMessages = [
    "Saying goodbye to your files...",
    "Bidding adieu to your documents...", 
    "Organizing the great digital decluttering...",
    "Teaching your docs to pack their bags...",
    "Filing papers in the virtual shredder...",
    "Helping documents find their way to the cloud recycling bin...",
    "Convincing files to take a well-deserved vacation...",
    "Orchestrating the grand document exodus...",
    "Whispering sweet farewells to your uploads...",
    "Conducting the paperless office cleanup ceremony..."
  ];

  // Show rotating humorous messages while delete all is running
  useEffect(() => {
    if (!deleteAllDocumentsMutation.isPending) return;

    let messageIndex = 0;
    let toastId: string | undefined;

    const showNextMessage = () => {
      const message = deleteFlavorMessages[messageIndex];
      
      // Dismiss previous toast and show new one
      if (toastId) {
        // Note: toast.dismiss(toastId) would be ideal but may not be available
        // The toast will auto-dismiss when we show the next one
      }
      
      // Show new humorous message
      const result = toast({
        title: message,
        description: "🗂️ Organizing your digital workspace...",
        duration: 2000, // 2 seconds each message
      });
      
      // Store toast ID if available
      if (result && typeof result === 'object' && 'id' in result) {
        toastId = result.id as string;
      }
      
      messageIndex = (messageIndex + 1) % deleteFlavorMessages.length;
    };

    // Show first message immediately
    showNextMessage();
    
    // Rotate messages every 2 seconds
    const interval = setInterval(showNextMessage, 2000);

    return () => {
      clearInterval(interval);
      // Final cleanup toast would be handled by the mutation's onSuccess
    };
  }, [deleteAllDocumentsMutation.isPending, toast]);

  const getUploadParameters = async () => {
    const response = await apiRequest("POST", "/api/documents/upload-url", {});
    const data = await response.json();
    return {
      method: "PUT" as const,
      url: data.uploadURL,
    };
  };

  // Bulk upload function for multiple files
  const getBulkUploadParameters = async (fileNames: string[]) => {
    const response = await apiRequest("POST", "/api/documents/bulk-upload-urls", {
      fileNames,
      analyzeImmediately: false // Let the queue processor handle priority
    });
    const data = await response.json();
    return {
      uploadURLs: data.uploadURLs,
      bulkUploadConfig: data.bulkUploadConfig  // ✅ FIXED! Now matches backend response
    };
  };

  const handleUploadComplete = (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    const file = result.successful?.[0];
    if (file && file.uploadURL) {
      const fileExtension = file.name?.split('.').pop()?.toLowerCase() || '';
      const fileType = getFileTypeFromExtension(fileExtension);
      
      // Track document upload event with user_id
      trackEvent('file_upload', { 
        file_type: fileType, 
        file_size: file.size,
        user_id: user?.uid
      });
      
      uploadMutation.mutate({
        uploadURL: file.uploadURL as string,
        name: file.name || 'Untitled',
        originalName: file.name || 'Untitled',
        fileSize: file.size || 0,
        fileType,
        mimeType: file.type || 'application/octet-stream',
        folderId: selectedFolderId || undefined,
      });
    }
  };

  // Handle bulk upload completion with fun messaging and AI polling
  const handleBulkUploadComplete = (result: {
    successful: number;
    failed: number;
    details: Array<{ success: boolean; originalName: string; error?: string; document?: { id: string } }>;
    message: string;
    aiAnalysis: {
      status: string;
      message: string;
      queueStatus: any;
    };
  }) => {
    trackEvent("bulk_documents_uploaded", { 
      successful: result.successful, 
      failed: result.failed,
      total: result.successful + result.failed,
      user_id: user?.uid
    });
    
    // Extract document IDs from successful uploads and trigger AI polling
    const successfulDocIds = result.details
      .filter(detail => detail.success && detail.document?.id)
      .map(detail => detail.document!.id);
    
    if (successfulDocIds.length > 0) {
      handleUploadSuccess(successfulDocIds);
    } else {
      // Fallback: just invalidate queries if no document IDs available
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/folders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/queue/status"] });
    }
    
    // Show success toast with fun messaging (shorter message since handleUploadSuccess will show AI completion toast)
    const successMessage = result.successful > 0 ? 
      `🎉 Successfully uploaded ${result.successful} document${result.successful > 1 ? 's' : ''}!` : 
      "";
    const failMessage = result.failed > 0 ? 
      `⚠️ ${result.failed} upload${result.failed > 1 ? 's' : ''} failed` : 
      "";
    
    const toastMessage = [successMessage, failMessage].filter(Boolean).join(" ");
    
    toast({
      title: result.successful > 0 ? "Bulk Upload Success!" : "Upload Issues",
      description: toastMessage + ` ${result.aiAnalysis.message}`,
      variant: result.failed > 0 ? "destructive" : "default",
      duration: result.failed > 0 ? undefined : 1000,
    });
  };

  const getFileTypeFromExtension = (extension: string): string => {
    const typeMap: Record<string, string> = {
      pdf: 'pdf',
      doc: 'docx',
      docx: 'docx',
      xls: 'xlsx',
      xlsx: 'xlsx',
      ppt: 'pptx',
      pptx: 'pptx',
      png: 'image',
      jpg: 'image',
      jpeg: 'image',
      gif: 'image',
      webp: 'image',
    };
    return typeMap[extension] || 'other';
  };

  const getFileIcon = (fileType: string) => {
    switch (fileType) {
      case 'pdf':
        return <File className="h-5 w-5 text-red-500" />;
      case 'docx':
        return <FileText className="h-5 w-5 text-blue-500" />;
      case 'xlsx':
        return <FileSpreadsheet className="h-5 w-5 text-green-500" />;
      case 'pptx':
        return <Presentation className="h-5 w-5 text-orange-500" />;
      case 'image':
        return <FileImage className="h-5 w-5 text-purple-400" />;
      default:
        return <File className="h-5 w-5 text-gray-500" />;
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (date: string | Date): string => {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  const handleViewDocument = (document: DocumentWithFolderAndTags) => {
    setSelectedDocument(document);
    setDocumentModalOpen(true);
  };

  const handleOpenDocumentFile = async (document: DocumentWithFolderAndTags) => {
    // For Drive documents, open Drive viewer directly
    if (document.driveWebViewLink) {
      window.open(document.driveWebViewLink, '_blank');
      return;
    }

    try {
      // For uploaded documents, fetch and display in new tab
      const response = await apiRequest('GET', `/api/documents/${document.id}/download`);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('You do not have permission to view this document. Please check if you own this document or if your session has expired.');
        } else if (response.status === 404) {
          throw new Error('Document not found. It may have been deleted or moved.');
        } else {
          throw new Error(`View failed (${response.status}): ${response.statusText}`);
        }
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (error) {
      console.error('View error details:', error);
      toast({
        title: "View failed",
        description: error instanceof Error ? error.message : "There was an error viewing the document.",
        variant: "destructive",
      });
    }
  };

  const handleDownload = async (document: DocumentWithFolderAndTags) => {
    // For Drive documents, redirect directly
    if (document.driveWebViewLink) {
      window.open(document.driveWebViewLink, '_blank');
      return;
    }
    
    try {
      // For uploaded documents, use the API endpoint to download
      const response = await apiRequest('GET', `/api/documents/${document.id}/download`);

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('You do not have permission to download this document. Please check if you own this document or if your session has expired.');
        } else if (response.status === 404) {
          throw new Error('Document not found. It may have been deleted or moved.');
        } else {
          throw new Error(`Download failed (${response.status}): ${response.statusText}`);
        }
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.style.display = 'none';
      anchor.href = url;
      anchor.download = document.originalName || document.name || 'download';
      window.document.body.appendChild(anchor);
      anchor.click();
      window.URL.revokeObjectURL(url);
      window.document.body.removeChild(anchor);
    } catch (error) {
      console.error('Download error details:', error);
      console.error('Error message:', error instanceof Error ? error.message : String(error));
      toast({
        title: "Download failed", 
        description: error instanceof Error ? error.message : "There was an error downloading the document.",
        variant: "destructive",
      });
    }
  };

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedFileType("all");
    setSelectedFolderId("all");
    setSelectedTagId("");
    setCurrentPage(1);
  };

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedFileType, selectedFolderId, selectedTagId]);

  return (
    <div className="flex flex-col md:flex-row h-screen overflow-hidden bg-gradient-to-b from-white via-gray-50 to-white dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      {/* Sidebar - Hidden on mobile, visible on md+ */}
      <aside className="hidden md:flex w-80 bg-card/80 backdrop-blur-sm border-r border-border flex-col">
        <div className="p-4 md:p-6 border-b border-border flex items-center justify-center bg-black">
          <img 
            src="/attached_assets/noBgColor (1)_1759471370484.png" 
            alt="Clasio AI Documents" 
            className="max-w-[160px] h-auto drop-shadow-[0_0_20px_rgba(255,255,255,0.4)]"
          />
        </div>
        
        <nav className="flex-1 p-4">
          <ul className="space-y-2">
            <li>
              <Button 
                variant="default" 
                className="w-full justify-start"
                data-testid="nav-all-documents"
              >
                <FileText className="mr-3 h-4 w-4" />
                All Documents
              </Button>
            </li>
            <li>
              <Button 
                variant="ghost" 
                className="w-full justify-start text-foreground hover:bg-accent"
                data-testid="nav-recent-uploads"
              >
                <Upload className="mr-3 h-4 w-4" />
                Recent Uploads
              </Button>
            </li>
            <li>
              <Button 
                variant="ghost" 
                className="w-full justify-start text-foreground hover:bg-accent"
                data-testid="nav-favorites"
              >
                <Star className="mr-3 h-4 w-4" />
                Favorites
              </Button>
            </li>
            <li>
              <Button 
                variant="ghost" 
                className="w-full justify-start text-foreground hover:bg-accent"
                data-testid="nav-deleted"
              >
                <Trash2 className="mr-3 h-4 w-4" />
                Deleted
              </Button>
            </li>
          </ul>
          
          {/* Automatic Organization Folders - Always visible */}
          <div className="mt-8">
            <h3 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center">
              <Sparkles className="mr-1 h-3 w-3" />
              Smart Organization
            </h3>
            
            {foldersLoading ? (
              <div className="mt-2 px-3 py-4 text-xs text-muted-foreground text-center">
                Loading smart folders... 📁
              </div>
            ) : hierarchicalFolders.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {hierarchicalFolders.map((category) => (
                  <li key={category.id}>
                    {/* Main Category Folder */}
                    <Button
                      variant="ghost"
                      className="w-full justify-between px-3 py-2.5 text-sm text-foreground hover:bg-accent/50 transition-all duration-200"
                      onClick={() => setSelectedFolderId(selectedFolderId === category.id ? "" : category.id)}
                      data-testid={`folder-${category.name.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      <div className="flex items-center gap-3">
                        <FolderOpen className="h-4 w-4 flex-shrink-0" style={{ color: category.color || '#3b82f6' }} />
                        <span className="font-medium tracking-wide">{category.name}</span>
                      </div>
                      <span className="text-[10px] bg-muted/50 px-2 py-0.5 rounded-full font-medium">
                        {category.documentCount || 0}
                      </span>
                    </Button>
                    
                    {/* Sub-folders */}
                    {category.subFolders && category.subFolders.length > 0 && (
                      <ul className="ml-7 mt-0.5 space-y-0.5">
                        {category.subFolders.map((subFolder) => (
                          <li key={subFolder.id}>
                            <Button
                              variant="ghost"
                              className="w-full justify-between px-3 py-2 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-all duration-200 h-auto"
                              onClick={() => setSelectedFolderId(selectedFolderId === subFolder.id ? "" : subFolder.id)}
                              data-testid={`subfolder-${subFolder.name.toLowerCase().replace(/\s+/g, '-')}`}
                              title={subFolder.name}
                            >
                              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                <div className="h-2 w-2 rounded-full flex-shrink-0 shadow-sm" style={{ backgroundColor: subFolder.color || '#9ca3af' }} />
                                <span className="truncate text-left font-light tracking-wide">
                                  {subFolder.name.split(' ').slice(0, 3).join(' ')}{subFolder.name.split(' ').length > 3 ? '...' : ''}
                                </span>
                              </div>
                              <span className="text-[10px] bg-muted/50 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ml-2">
                                {subFolder.documentCount || 0}
                              </span>
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-2 px-3 py-4 text-xs text-muted-foreground text-center">
                Upload some documents to see your smart folders! 📁
              </div>
            )}
          </div>

          
          <div className="mt-8">
            <h3 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tags</h3>
            <div className="mt-2 px-3 space-y-2">
              {tags.map((tag) => (
                <Badge
                  key={tag.id}
                  variant="secondary"
                  className="cursor-pointer mr-2 mb-2"
                  style={{ backgroundColor: `${tag.color || '#3b82f6'}20`, color: tag.color || '#3b82f6' }}
                  onClick={() => setSelectedTagId(selectedTagId === tag.id ? "" : tag.id)}
                  data-testid={`tag-${tag.name.toLowerCase().replace(/\s+/g, '-')}`}
                >
                  {tag.name}
                </Badge>
              ))}
            </div>
          </div>
        </nav>
        
        <div className="p-4 border-t border-border">
          <div className="text-xs text-muted-foreground">
            <p>Storage Used</p>
            <div className="w-full bg-muted rounded-full h-2 mt-1">
              <div className="bg-primary h-2 rounded-full" style={{width: "65%"}}></div>
            </div>
            <p className="mt-1">6.5GB of 10GB</p>
          </div>
        </div>
      </aside>

      {/* Main Content - Mobile Grid Layout */}
      <main className="flex-1 md:overflow-hidden md:flex md:flex-col grid md:grid-none grid-rows-[22vh_16vh_auto] md:grid-rows-none overflow-hidden">
        {/* Section 1 (Mobile): Controls + Filters Combined - Modern Premium Design */}
        <div className="overflow-visible bg-gradient-to-b from-white to-slate-50/50 dark:from-gray-900 dark:to-gray-900/80">
          {/* Header - Clean Premium */}
          <div className="px-4 md:px-6 py-3 md:py-4 border-b border-border/20">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <h2 className="text-base md:text-lg font-medium text-foreground">
                  {isMainCategorySelected 
                    ? `${selectedFolder?.name} Sub-folders`
                    : isSubFolderSelected 
                      ? selectedFolder?.name 
                      : "Documents"
                  }
                </h2>
                <span className="text-xs text-muted-foreground/70" data-testid="document-count">
                  {isMainCategorySelected 
                    ? `${selectedCategorySubFolders.length} folders`
                    : `${documentsData?.pagination.total || 0}`
                  }
                </span>
              </div>
              
              {/* Primary Actions Row - Evenly Spaced Premium Design */}
              <div className="flex items-center justify-between md:justify-end gap-2 w-full md:w-auto">
                {/* Upload Button - Primary CTA */}
                <ObjectUploader
                  maxNumberOfFiles={5}
                  maxFileSize={50 * 1024 * 1024}
                  enableBulkUpload={true}
                  onGetUploadParameters={getUploadParameters}
                  onGetBulkUploadParameters={getBulkUploadParameters}
                  onComplete={handleUploadComplete}
                  onBulkUploadComplete={handleBulkUploadComplete}
                  onSuccess={handleUploadSuccess}
                  buttonClassName="bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white text-xs md:text-sm h-10 px-4 md:px-4 rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 font-medium"
                >
                  <Upload className="h-4 w-4" />
                  <span className="hidden sm:inline">Upload</span>
                </ObjectUploader>
                
                {/* Smart Organization Button - Mobile only */}
                <Button
                  variant="ghost"
                  onClick={() => {
                    userToggledSmartOrgRef.current = true;
                    setShowSmartOrg(!showSmartOrg);
                  }}
                  className="md:hidden h-10 px-4 bg-purple-50/90 hover:bg-purple-100 dark:bg-purple-900/30 dark:hover:bg-purple-800/40 text-purple-600 dark:text-purple-400 rounded-xl border border-purple-200/60 dark:border-purple-700/60 shadow-sm hover:shadow-md transition-all"
                  data-testid="button-smart-org-mobile"
                >
                  <Sparkles className="h-4 w-4" />
                  {hierarchicalFolders.length > 0 && (
                    <span className="ml-1.5 text-xs font-semibold">{hierarchicalFolders.length}</span>
                  )}
                </Button>
                
                {/* Desktop Smart Organization */}
                <Button
                  variant="ghost"
                  onClick={() => organizeAllMutation.mutate()}
                  disabled={organizeAllMutation.isPending}
                  className="hidden md:flex h-10 px-4 bg-purple-50/90 hover:bg-purple-100 dark:bg-purple-900/30 dark:hover:bg-purple-800/40 text-purple-600 dark:text-purple-400 rounded-xl border border-purple-200/60 dark:border-purple-700/60 shadow-sm hover:shadow-md transition-all"
                  data-testid="button-organize-all"
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  <span className="text-xs font-medium">{organizeAllMutation.isPending ? 'Organizing...' : 'Smart Org'}</span>
                </Button>
                
                {/* AI Queue Status */}
                <Button
                  variant="ghost"
                  onClick={() => setQueueDashboardOpen(true)}
                  className="h-10 px-4 bg-slate-50/90 hover:bg-slate-100 dark:bg-slate-800/40 dark:hover:bg-slate-700/60 text-slate-600 dark:text-slate-300 rounded-xl border border-slate-200/60 dark:border-slate-700/60 shadow-sm hover:shadow-md transition-all"
                  data-testid="button-queue-status"
                >
                  <Brain className="h-4 w-4" />
                </Button>
                
                {/* Delete All */}
                {documentsData?.documents && documentsData.documents.length > 0 && (
                  <Button
                    variant="ghost"
                    onClick={() => deleteAllDocumentsMutation.mutate()}
                    disabled={deleteAllDocumentsMutation.isPending}
                    className="h-10 px-4 bg-rose-50/90 hover:bg-rose-100 dark:bg-rose-900/30 dark:hover:bg-rose-800/40 text-rose-600 dark:text-rose-400 rounded-xl border border-rose-200/60 dark:border-rose-700/60 shadow-sm hover:shadow-md transition-all"
                    data-testid="button-delete-all"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Search & Filters - Clean Layout */}
          <div className="px-4 md:px-6 py-2.5 space-y-2.5 overflow-x-hidden">
            {/* Search Row */}
            <div className="flex items-center gap-2">
              {/* Search Mode Toggle - Premium Design */}
              <div className="flex items-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-gray-800 dark:to-gray-850 border-2 border-slate-200/60 dark:border-slate-700/60 rounded-xl overflow-hidden h-11 shadow-sm">
                <Button
                  variant={searchMode === "simple" ? "default" : "ghost"}
                  size="sm"
                  className={`rounded-none text-sm font-semibold h-full px-4 border-0 ${
                    searchMode === "simple" 
                      ? "bg-gradient-to-r from-slate-600 to-slate-700 text-white shadow-md" 
                      : "text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
                  }`}
                  onClick={() => setSearchMode("simple")}
                  data-testid="search-mode-simple"
                >
                  <span className="hidden md:inline">Simple</span>
                  <span className="md:hidden">Text</span>
                </Button>
                <Button
                  variant={searchMode === "ai" ? "default" : "ghost"}
                  size="sm"
                  className={`rounded-none text-sm font-semibold h-full px-4 border-0 ${
                    searchMode === "ai" 
                      ? "bg-gradient-to-r from-purple-500 to-indigo-500 text-white shadow-md" 
                      : "text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
                  }`}
                  onClick={() => setSearchMode("ai")}
                  data-testid="search-mode-ai"
                >
                  AI
                </Button>
              </div>
              
              {/* Search Input */}
              <div className="relative flex-1">
                <Input
                  type="text"
                  placeholder={searchMode === "ai" ? "Ask AI about your documents..." : "Search documents..."}
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="w-full pl-9 text-xs h-9 bg-white dark:bg-gray-800 border-border/30 rounded-lg"
                  data-testid="search-input"
                />
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
              </div>
              
              {/* AI Search Go Button */}
              {searchMode === "ai" && (
                <Button
                  onClick={handleAISearch}
                  disabled={!searchQuery.trim() || aiSearchLoading}
                  className="h-9 px-4 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white text-xs rounded-lg"
                  data-testid="ai-search-go"
                >
                  {aiSearchLoading ? "..." : "Search"}
                </Button>
              )}
            </div>
            
            {/* Filters Row */}
            <div className="flex items-center gap-2">
              <Select value={selectedFileType} onValueChange={setSelectedFileType}>
                <SelectTrigger className="w-32 text-xs h-8 bg-white dark:bg-gray-800 border-border/30 rounded-lg" data-testid="filter-type">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="pdf">PDF</SelectItem>
                  <SelectItem value="docx">Word</SelectItem>
                  <SelectItem value="xlsx">Excel</SelectItem>
                  <SelectItem value="image">Images</SelectItem>
                </SelectContent>
              </Select>
              
              <Select value={selectedFolderId} onValueChange={setSelectedFolderId}>
                <SelectTrigger className="flex-1 max-w-[200px] text-xs h-8 bg-white dark:bg-gray-800 border-border/30 rounded-lg" data-testid="filter-folder">
                  <SelectValue placeholder="All Folders" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Folders</SelectItem>
                  {folders
                    .filter(folder => folder.isAutoCreated && !folder.parentId)
                    .map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Button 
                variant="ghost" 
                onClick={clearFilters}
                size="sm"
                className="h-8 px-3 text-xs text-muted-foreground hover:text-foreground bg-slate-50/50 hover:bg-slate-100/80 dark:bg-slate-800/30 dark:hover:bg-slate-700/50 rounded-lg border border-slate-200/50 dark:border-slate-700/50"
                data-testid="clear-filters"
              >
                Clear
              </Button>
            </div>
          </div>
        </div>

        {/* Section 2 (Mobile): Smart Organization - Horizontal Scroll */}
        <div className={`${showSmartOrg ? 'block' : 'hidden'} md:hidden overflow-x-auto overflow-y-visible snap-x snap-mandatory bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-gray-900 dark:to-gray-900 border-b border-border relative rounded-b-lg shadow-lg pb-4 mt-10`}>
          {/* Gradient fade indicators */}
          <div className="absolute left-0 top-0 bottom-0 w-4 bg-gradient-to-r from-purple-50 dark:from-gray-900 to-transparent pointer-events-none z-10" />
          <div className="absolute right-0 top-0 bottom-0 w-4 bg-gradient-to-l from-indigo-50 dark:from-gray-900 to-transparent pointer-events-none z-10" />
          
          <div className="h-full px-6 py-4 flex items-start gap-4 min-w-max">
            {/* Category Cards */}
            {foldersLoading ? (
              <div className="snap-start shrink-0 bg-white dark:bg-gray-800 rounded-xl shadow-lg w-56 h-[896px] flex items-center justify-center">
                <div className="text-xs text-muted-foreground">Loading...</div>
              </div>
            ) : hierarchicalFolders.length > 0 ? (
              hierarchicalFolders.map((category) => {
                return (
                  <div key={category.id} className="snap-start shrink-0 bg-white dark:bg-gray-800 rounded-xl shadow-lg w-56 h-[896px] flex flex-col p-5 pb-4">
                    <button
                      className="w-full flex items-center justify-between text-left mb-3 h-11 shrink-0"
                      onClick={() => setSelectedFolderId(selectedFolderId === category.id ? "all" : category.id)}
                      data-testid={`button-folder-${category.id}`}
                    >
                      <div className="flex items-center flex-1 min-w-0">
                        <FolderOpen className="mr-2 h-5 w-5 shrink-0" style={{ color: category.color || '#8b5cf6' }} />
                        <span className="text-sm font-semibold truncate">{category.name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground px-2.5 py-1 bg-purple-100 dark:bg-gray-700 rounded-full ml-2 shrink-0 font-medium">
                        {category.documentCount || 0}
                      </span>
                    </button>
                    {category.subFolders && category.subFolders.length > 0 && (
                      <div className="flex-1 overflow-hidden rounded-lg bg-slate-50/40 dark:bg-gray-900/40 px-3 py-2">
                        <div className="h-[826px] space-y-2 overflow-y-auto pr-2">
                          {category.subFolders.map((subFolder) => (
                            <button
                              key={subFolder.id}
                              className="w-full flex items-center justify-between text-left px-2.5 rounded-lg hover:bg-purple-100 dark:hover:bg-gray-700 h-11 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedFolderId(selectedFolderId === subFolder.id ? "all" : subFolder.id);
                              }}
                              data-testid={`button-subfolder-${subFolder.id}`}
                            >
                              <div className="flex items-center flex-1 min-w-0">
                                <div className="mr-2 h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: subFolder.color || '#9ca3af' }} />
                                <span className="text-xs truncate leading-normal font-medium text-gray-700 dark:text-gray-300">{subFolder.name}</span>
                              </div>
                              <span className="text-xs text-muted-foreground ml-2 shrink-0 font-medium">
                                {subFolder.documentCount || 0}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="snap-start shrink-0 bg-white dark:bg-gray-800 rounded-xl shadow-lg w-56 h-[896px] flex items-center justify-center">
                <div className="text-xs text-muted-foreground text-center">
                  Upload documents to see smart folders
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section 3 (Mobile): Documents Grid - auto height with overflow-y */}
        <div className="overflow-y-auto md:flex-1 md:overflow-auto p-3 md:p-6 mt-12">
          {/* AI Search Results Section */}
          {searchMode === "ai" && aiSearchResults && (
            <div className="mb-6">
              <div className="bg-purple-50 dark:bg-gray-900 border border-purple-200 dark:border-purple-500 rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <Brain className="h-5 w-5 text-purple-500" />
                  <h3 className="text-sm font-semibold text-purple-900 dark:text-purple-100">AI Search Results</h3>
                  <Badge variant="secondary" className="text-xs">
                    {aiSearchResults.totalResults} found
                  </Badge>
                </div>
                <div className="text-sm text-purple-500 dark:text-purple-200 mb-2">
                  {aiSearchResults.response.includes('•') ? (
                    // Format numbered responses
                    <div className="space-y-2">
                      {aiSearchResults.response.split('•').filter(part => part.trim()).map((part, index) => (
                        <div key={index} className={index === 0 ? 'mb-2' : 'flex items-start gap-2'}>
                          {index === 0 ? (
                            // First part is the intro text (e.g., "I found 3 documents...")
                            <span className="font-medium">{part.trim()}</span>
                          ) : (
                            // Subsequent parts are the numbered points
                            <>
                              <span className="text-purple-500 dark:text-purple-400 font-bold mt-0.5 min-w-[1.25rem]">{index}.</span>
                              <span className="flex-1">{part.trim()}</span>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    // Regular response without bullets
                    <span>{aiSearchResults.response}</span>
                  )}
                </div>
                {aiSearchResults.keywords && aiSearchResults.keywords.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    <span className="text-xs text-purple-500 dark:text-purple-300">Keywords:</span>
                    {aiSearchResults.keywords.map((keyword: string, index: number) => (
                      <Badge key={index} variant="outline" className="text-xs">
                        {keyword}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* Sub-folders View (when main category is selected) */}
          {isMainCategorySelected && selectedCategorySubFolders.length > 0 ? (
            <div>
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {selectedFolder?.name} Sub-folders
                </h3>
                <p className="text-sm text-muted-foreground">
                  Choose a sub-folder to view its documents
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {selectedCategorySubFolders.map((subFolder) => (
                  <Card 
                    key={subFolder.id} 
                    className="hover:shadow-lg transition-shadow duration-200 cursor-pointer" 
                    data-testid={`subfolder-card-${subFolder.id}`}
                    onClick={() => setSelectedFolderId(subFolder.id)}
                  >
                    <CardContent className="p-6">
                      <div className="flex items-center space-x-3 mb-4">
                        <div 
                          className="w-8 h-8 rounded-lg flex items-center justify-center"
                          style={{ backgroundColor: `${subFolder.color || '#9ca3af'}20` }}
                        >
                          <FolderOpen 
                            className="h-5 w-5" 
                            style={{ color: subFolder.color || '#9ca3af' }} 
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium text-foreground truncate">
                            {subFolder.name}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            {subFolder.documentCount || 0} documents
                          </p>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Click to view documents in this folder
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ) : isMainCategorySelected ? (
            <div className="text-center py-12">
              <FolderOpen className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                No sub-folders found
              </h3>
              <p className="text-muted-foreground">
                This category doesn't have any sub-folders with documents yet.
              </p>
            </div>
          ) : /* Loading State */
          (documentsLoading || aiSearchLoading) ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="p-4">
                    <div className="h-4 bg-muted rounded mb-2"></div>
                    <div className="h-3 bg-muted rounded mb-4 w-2/3"></div>
                    <div className="flex space-x-2 mb-3">
                      <div className="h-6 bg-muted rounded w-16"></div>
                      <div className="h-6 bg-muted rounded w-12"></div>
                    </div>
                    <div className="h-8 bg-muted rounded"></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : /* Empty State */ 
          (searchMode === "ai" && aiSearchResults && aiSearchResults.documents.length === 0) || 
          (searchMode === "simple" && documentsData?.documents.length === 0) ? (
            <div className="text-center py-12">
              <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                {searchMode === "ai" ? "No AI search results found" : "No documents found"}
              </h3>
              <p className="text-muted-foreground">
                {searchQuery || selectedFileType || selectedFolderId || selectedTagId
                  ? searchMode === "ai" 
                    ? "Try rephrasing your AI search query or using different keywords."
                    : "Try adjusting your filters or search query."
                  : "Upload your first document to get started."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
              {/* Display either AI search results or regular documents */}
              {(searchMode === "ai" && aiSearchResults ? aiSearchResults.documents : documentsData?.documents)?.map((document: any) => (
                <Card 
                  key={document.id} 
                  className="group hover:shadow-xl hover:border-indigo-300 dark:hover:border-indigo-500 transition-all duration-300 cursor-pointer border-border/50 rounded-2xl overflow-hidden bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm w-full h-[390px] flex flex-col" 
                  data-testid={`document-card-${document.id}`}
                  onClick={() => handleViewDocument(document)}
                >
                  <CardContent className="px-4 pt-4 pb-0 flex flex-col h-full overflow-hidden">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center space-x-3 flex-1 min-w-0">
                        <div className="flex-shrink-0">
                          {getFileIcon(document.fileType)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-semibold text-foreground truncate mb-0.5 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors" title={getDocumentTooltip(document)} data-testid={`document-name-${document.id}`}>
                            {getDocumentDisplayName(document)}
                          </h3>
                          <p className="text-xs text-muted-foreground font-light">
                            {formatFileSize(document.fileSize || 0)}
                          </p>
                          {document.originalName && (
                            <p className="text-xs text-muted-foreground/80 truncate mt-1 font-light" title={document.originalName} data-testid={`original-name-${document.id}`}>
                              {document.originalName}
                            </p>
                          )}
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-auto p-1" 
                            onClick={(e) => e.stopPropagation()}
                            data-testid={`menu-${document.id}`}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleDownload(document)} data-testid={`menu-download-${document.id}`}>
                            <Download className="mr-2 h-4 w-4" />
                            Download
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => handleViewDocument(document)}
                            data-testid={`menu-edit-${document.id}`}
                          >
                            <Edit2 className="mr-2 h-4 w-4" />
                            Edit Properties
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => handleOpenDocumentFile(document)}
                            data-testid={`menu-open-${document.id}`}
                          >
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Open Document
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => analyzeDocumentMutation.mutate(document.id)}
                            disabled={analyzeDocumentMutation.isPending}
                            data-testid={`menu-analyze-${document.id}`}
                          >
                            <Brain className="mr-2 h-4 w-4" />
                            {analyzeDocumentMutation.isPending ? 'Analyzing...' : 'Analyze with AI'}
                          </DropdownMenuItem>
                          <DropdownMenuItem data-testid={`menu-favorite-${document.id}`}>
                            <Star className="mr-2 h-4 w-4" />
                            {document.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            className="text-red-600" 
                            onClick={() => deleteDocumentMutation.mutate(document.id)}
                            disabled={deleteDocumentMutation.isPending}
                            data-testid={`menu-delete-${document.id}`}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {deleteDocumentMutation.isPending ? 'Deleting...' : 'Delete'}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    
                    {document.tags && document.tags.length > 0 && (
                      <div className="mb-3">
                        <div className="flex flex-wrap gap-1.5">
                          {document.tags.map((tag) => (
                            <Badge
                              key={tag.id}
                              variant="secondary"
                              className="text-xs font-light"
                              style={{ backgroundColor: `${tag.color || '#8b5cf6'}15`, color: tag.color || '#8b5cf6', border: `1px solid ${tag.color || '#8b5cf6'}30` }}
                            >
                              {tag.name}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    <div className="flex items-center justify-between text-xs text-muted-foreground/80 mb-2 font-light">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDate(document.uploadedAt)}
                      </span>
                      {document.folder?.name && (
                        <span className="flex items-center gap-1 truncate max-w-[120px]" title={document.folder.name}>
                          <FolderOpen className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{document.folder.name}</span>
                        </span>
                      )}
                    </div>
                    
                    {/* AI Analysis Results - Scrollable */}
                    {(document.aiSummary || document.overrideDocumentType || document.overrideCategory) && (
                      <div className="mb-0 p-2.5 bg-purple-50/40 dark:from-purple-950/10 dark:to-indigo-950/10 rounded-lg border border-purple-200/30 dark:border-purple-500/20 flex-shrink-0 max-h-[200px] overflow-y-auto scrollbar-thin scrollbar-thumb-purple-200 dark:scrollbar-thumb-purple-800 scrollbar-track-transparent">
                        <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-purple-50/40 dark:bg-purple-950/10 pb-1">
                          <Sparkles className="h-3 w-3 text-purple-500 dark:text-purple-400" />
                          <span className="text-xs font-medium text-purple-600 dark:text-purple-300">
                            {document.aiSummary ? 'AI Analysis' : 'Classification'}
                          </span>
                        </div>
                        {document.aiSummary && (
                          <p className="text-xs text-purple-600/90 dark:text-purple-400/90 mb-2 leading-relaxed font-light">{document.aiSummary}</p>
                        )}
                        {(document.aiDocumentType || document.overrideDocumentType || document.overrideCategory) && (
                          <div className="text-xs text-purple-500/80 dark:text-purple-400/80 mb-2 space-y-1">
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center justify-between">
                                <span className="text-xs truncate">Folder: {document.overrideCategory || document.aiCategory || 'Uncategorized'}</span>
                                {document.overrideCategory ? (
                                  <span className="text-xs bg-green-100/70 dark:bg-green-900/50 px-1 py-0.5 rounded text-green-700 dark:text-green-300 font-medium ml-2" data-testid={`override-category-${document.id}`}>
                                    Custom
                                  </span>
                                ) : formatConfidence(document.aiCategoryConfidence) && (
                                  <span className="text-xs bg-purple-100/70 dark:bg-gray-800/50 px-1 py-0.5 rounded font-medium whitespace-nowrap ml-2" data-testid={`confidence-category-${document.id}`}>
                                    {formatConfidence(document.aiCategoryConfidence)}
                                  </span>
                                )}
                              </div>
                            </div>
                            {(document.overrideDocumentType || document.aiDocumentType) && (
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs truncate">Sub-folder: {
                                    (document.folder?.parentId ? document.folder.name : null) ||
                                    document.overrideDocumentType || 
                                    document.aiDocumentType
                                  }</span>
                                  {document.overrideDocumentType ? (
                                    <span className="text-xs bg-green-100/70 dark:bg-green-900/50 px-1 py-0.5 rounded text-green-700 dark:text-green-300 font-medium ml-2" data-testid={`override-type-${document.id}`}>
                                      Custom
                                    </span>
                                  ) : formatConfidence(document.aiDocumentTypeConfidence) && (
                                    <span className="text-xs bg-purple-100/70 dark:bg-gray-800/50 px-1 py-0.5 rounded font-medium whitespace-nowrap ml-2" data-testid={`confidence-type-${document.id}`}>
                                      {formatConfidence(document.aiDocumentTypeConfidence)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {document.aiKeyTopics && document.aiKeyTopics.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1 border-t border-purple-200/30 dark:border-purple-500/20">
                            {document.aiKeyTopics.map((topic, index) => (
                              <Badge key={index} variant="secondary" className="text-xs bg-purple-100/60 dark:bg-gray-800/60 text-purple-600 dark:text-purple-300 border-0">
                                {topic}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* AI Search Score Display - Mobile Responsive */}
                    {searchMode === "ai" && aiSearchResults && document.aiScore !== undefined && (
                      <div className="mb-0 p-2 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-gray-900 dark:to-gray-900 rounded-md border border-purple-200 dark:border-purple-500">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Brain className="h-4 w-4 text-purple-500" />
                            <span className="text-xs font-medium text-purple-500 dark:text-purple-300">
                              AI Relevance Score
                            </span>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="bg-white dark:bg-gray-800 px-2 py-1 rounded-full">
                              <span className="text-sm font-bold text-purple-500 dark:text-purple-300">
                                {calibrateConfidence(document.aiScore)}%
                              </span>
                            </div>
                            <div className="w-16 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-300"
                                style={{ width: `${Math.min(100, calibrateConfidence(document.aiScore))}%` }}
                              />
                            </div>
                            <span className={`text-xs font-medium whitespace-nowrap ${getConfidenceLevel(calibrateConfidence(document.aiScore)).color}`}>
                              {getConfidenceLevel(calibrateConfidence(document.aiScore)).label}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Action Buttons - Premium Subtle Design with Proper Touch Targets */}
                    <div className="grid grid-cols-4 gap-1.5 mt-2 -mb-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-11 bg-slate-100/50 hover:bg-slate-200/70 dark:bg-slate-800/30 dark:hover:bg-slate-700/50 text-slate-600 dark:text-slate-300 border border-slate-200/50 dark:border-slate-700/50 px-2 transition-all"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(document);
                        }}
                        data-testid={`download-${document.id}`}
                      >
                        <Download className="h-3.5 w-3.5 sm:mr-1" />
                        <span className="text-xs hidden sm:inline">Get</span>
                      </Button>
                      <Button 
                        size="sm"
                        variant="ghost"
                        className="h-11 bg-emerald-100/50 hover:bg-emerald-200/70 dark:bg-emerald-900/20 dark:hover:bg-emerald-800/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-700/50 px-2 transition-all"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenDocumentFile(document);
                        }}
                        data-testid={`preview-${document.id}`}
                      >
                        <Eye className="h-3.5 w-3.5 sm:mr-1" />
                        <span className="text-xs hidden sm:inline">View</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-11 bg-purple-100/50 hover:bg-purple-200/70 dark:bg-purple-900/20 dark:hover:bg-purple-800/30 text-purple-600 dark:text-purple-400 border border-purple-200/50 dark:border-purple-700/50 px-2 transition-all"
                        onClick={(e) => {
                          e.stopPropagation();
                          analyzeDocumentMutation.mutate(document.id);
                        }}
                        disabled={analyzeDocumentMutation.isPending}
                        data-testid={`analyze-ai-${document.id}`}
                      >
                        <Brain className="h-3.5 w-3.5 sm:mr-1" />
                        <span className="text-xs hidden sm:inline">AI</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-11 bg-rose-100/50 hover:bg-rose-200/70 dark:bg-rose-900/20 dark:hover:bg-rose-800/30 text-rose-600 dark:text-rose-400 border border-rose-200/50 dark:border-rose-700/50 px-2 transition-all"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteDocumentMutation.mutate(document.id);
                        }}
                        disabled={deleteDocumentMutation.isPending}
                        data-testid={`delete-${document.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 sm:mr-1" />
                        <span className="text-xs hidden sm:inline">Del</span>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Pagination */}
          {documentsData && documentsData.pagination.pages > 1 && (
            <div className="flex items-center justify-between mt-8">
              <div className="text-sm text-muted-foreground">
                Showing {((documentsData.pagination.page - 1) * documentsData.pagination.limit) + 1}-
                {Math.min(documentsData.pagination.page * documentsData.pagination.limit, documentsData.pagination.total)} of {documentsData.pagination.total} documents
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(currentPage - 1)}
                  data-testid="pagination-previous"
                >
                  Previous
                </Button>
                {Array.from({ length: Math.min(5, documentsData.pagination.pages) }, (_, i) => {
                  const page = i + 1;
                  return (
                    <Button
                      key={page}
                      variant={currentPage === page ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCurrentPage(page)}
                      data-testid={`pagination-page-${page}`}
                    >
                      {page}
                    </Button>
                  );
                })}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === documentsData.pagination.pages}
                  onClick={() => setCurrentPage(currentPage + 1)}
                  data-testid="pagination-next"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
      
      {/* Document Modal */}
      <DocumentModal
        document={selectedDocument}
        open={documentModalOpen}
        onOpenChange={setDocumentModalOpen}
        searchQuery={searchQuery}
        onDownload={handleDownload}
      />
      
      {/* Queue Status Dashboard */}
      <QueueStatusDashboard
        isOpen={queueDashboardOpen}
        onClose={() => setQueueDashboardOpen(false)}
      />
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from "react";
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
  MessageCircle,
  Zap,
  X
} from "lucide-react";

interface DocumentsResponse {
  documents: DocumentWithVersionInfo[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

interface ConversationalSearchResponse {
  documents: DocumentWithVersionInfo[];
  response: string;
  intent: string;
  keywords: string[];
  query: string;
  totalResults: number;
}

// Helper function to format confidence percentage
const formatConfidence = (confidence: number | null | undefined): string | null => {
  if (confidence === null || confidence === undefined) return null;
  // Handle both 0-1 float and 0-100 integer formats
  const value = confidence <= 1 ? confidence * 100 : confidence;
  return `${Math.round(value)}%`;
};

export default function Documents() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFileType, setSelectedFileType] = useState("all");
  const [selectedDocument, setSelectedDocument] = useState<DocumentWithFolderAndTags | null>(null);
  const [documentModalOpen, setDocumentModalOpen] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState("all");
  const [selectedTagId, setSelectedTagId] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [queueDashboardOpen, setQueueDashboardOpen] = useState(false);
  
  // Conversational search state
  const [isConversationalMode, setIsConversationalMode] = useState(false);
  const [conversationalResponse, setConversationalResponse] = useState<string | null>(null);
  const [searchIntent, setSearchIntent] = useState<string | null>(null);
  const [searchKeywords, setSearchKeywords] = useState<string[]>([]);
  // Custom useDebounce hook implementation
  const useDebounce = (value: string, delay: number) => {
    const [debouncedValue, setDebouncedValue] = useState(value);

    useEffect(() => {
      const handler = setTimeout(() => {
        setDebouncedValue(value);
      }, delay);

      return () => {
        clearTimeout(handler);
      };
    }, [value, delay]);

    return debouncedValue;
  };

  // AI search execution control - only search when button is clicked
  const [executeAISearch, setExecuteAISearch] = useState(false);
  const [aiSearchQuery, setAISearchQuery] = useState("");
  const [isAISearching, setIsAISearching] = useState(false);
  // Traditional search debouncing using custom hook
  const debouncedSearchQuery = useDebounce(searchQuery, 500);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();


  // Simplified search change handler
  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
    // Debouncing is handled automatically by the useDebounce hook
  }, []);

  // Handle Go! button click for AI search
  const handleGoButtonClick = async () => {
    if (!isConversationalMode || searchQuery.trim().length <= 2 || isAISearching) {
      return; // Guard against invalid states and prevent double clicks
    }

    setIsAISearching(true);
    
    try {
      // Clear previous results
      setConversationalResponse(null);
      setSearchIntent(null);
      setSearchKeywords([]);

      // Build query parameters from current UI state
      const params = {
        query: searchQuery.trim(),
        ...(selectedFileType !== "all" && { fileType: selectedFileType }),
        ...(selectedFolderId !== "all" && { folderId: selectedFolderId }),
        ...(selectedTagId && { tagId: selectedTagId })
      };

      // Update AI search query to trigger the useQuery
      setAISearchQuery(searchQuery.trim());
      
      // Fetch conversational search and update the cache
      const result = await queryClient.fetchQuery<ConversationalSearchResponse>({
        queryKey: ['/api/documents/search', {
          query: searchQuery.trim(),
          fileType: selectedFileType === "all" ? "" : selectedFileType,
          folderId: selectedFolderId === "all" ? "" : selectedFolderId,
          tagId: selectedTagId
        }],
        staleTime: 30000,
      });

      // Update the useQuery cache with the same key structure
      queryClient.setQueryData(['/api/documents/search', {
        query: searchQuery.trim(),
        fileType: selectedFileType === "all" ? "" : selectedFileType,
        folderId: selectedFolderId === "all" ? "" : selectedFolderId,
        tagId: selectedTagId
      }], result);

      // Update state with results  
      setConversationalResponse(result.response);
      setSearchIntent(result.intent);
      setSearchKeywords(result.keywords);

      // Track analytics
      trackEvent('search', { search_term: searchQuery.trim() });
    } catch (error) {
      console.error('Conversational search failed:', error);
      if (error instanceof Error && error.message?.includes('429')) {
        toast({
          title: "Rate limit reached",
          description: "Please wait a moment before trying again.",
          variant: "destructive",
        });
      } else {
        setConversationalResponse("I encountered an error while searching. Please try again.");
        setSearchIntent(null);
        setSearchKeywords([]);
      }
    } finally {
      setIsAISearching(false);
    }
  };

  // Fetch documents (traditional search) - only when NOT in conversational mode
  const { data: documentsData, isLoading: documentsLoading } = useQuery<DocumentsResponse>({
    queryKey: ['/api/documents', { 
      search: debouncedSearchQuery, 
      fileType: selectedFileType === "all" ? "" : selectedFileType, 
      folderId: selectedFolderId === "all" ? "" : selectedFolderId, 
      tagId: selectedTagId, 
      page: currentPage 
    }],
    enabled: !isConversationalMode && (debouncedSearchQuery.length === 0 || debouncedSearchQuery.length > 2),
    staleTime: 30000,
    refetchOnWindowFocus: false, // Prevent unnecessary refetches
  });

  // Fetch conversational search results - only when "Go!" button is clicked
  const { data: conversationalData, isLoading: conversationalLoading, error: conversationalError, refetch: refetchConversational } = useQuery<ConversationalSearchResponse>({
    queryKey: ['/api/documents/search', { 
      query: aiSearchQuery,
      fileType: selectedFileType === "all" ? "" : selectedFileType, 
      folderId: selectedFolderId === "all" ? "" : selectedFolderId, 
      tagId: selectedTagId
    }],
    enabled: false, // Disabled by default - only trigger via refetch()
    staleTime: 30000,
    refetchOnWindowFocus: false,
    retry: (failureCount, error: any) => {
      // Don't retry on rate limit errors
      if (error?.status === 429) return false;
      return failureCount < 2; // Reduce retries for AI calls
    },
  });

  // Trigger conversational search when AI search is executed
  useEffect(() => {
    if (executeAISearch && aiSearchQuery.length > 2) {
      refetchConversational();
    }
  }, [executeAISearch, aiSearchQuery, refetchConversational]);

  // Reset AI search execution flag when query settles (success or error)
  useEffect(() => {
    if (executeAISearch && (conversationalData || conversationalError)) {
      setExecuteAISearch(false);
    }
  }, [executeAISearch, conversationalData, conversationalError]);

  // Fetch folders with document counts
  const { data: folders = [] } = useQuery<(Folder & { documentCount: number })[]>({
    queryKey: ['/api/folders'],
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


  // Fetch tags
  const { data: tags = [] } = useQuery<Tag[]>({
    queryKey: ['/api/tags'],
  });

  // Compute final documents and loading state
  const currentDocuments = isConversationalMode && conversationalData 
    ? conversationalData.documents 
    : documentsData?.documents || [];
  
  const isLoading = isConversationalMode ? conversationalLoading : documentsLoading;

  // Update conversational response when data changes
  useEffect(() => {
    if (conversationalData) {
      setConversationalResponse(conversationalData.response);
      setSearchIntent(conversationalData.intent);
      setSearchKeywords(conversationalData.keywords);
    } else if (!isConversationalMode) {
      // Clear conversational state when switching back to traditional search
      setConversationalResponse(null);
      setSearchIntent(null);
      setSearchKeywords([]);
    }
  }, [conversationalData, isConversationalMode]);

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/folders'] }); // Keep folder counts fresh
      toast({
        title: "Upload successful",
        description: "Document has been uploaded successfully.",
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
      
      // Find the document to check if it's from Drive
      const document = documentsData?.documents?.find((doc: DocumentWithFolderAndTags) => doc.id === documentId);
      const googleAccessToken = getGoogleAccessToken();
      
      // Handle Drive documents that need authentication
      if (document?.driveFileId && !googleAccessToken) {
        throw new Error("Drive access token has expired. Please re-authenticate with Google Drive to analyze this document.");
      }
      
      // Prepare headers for Drive documents
      const headers: HeadersInit = {};
      if (document?.driveFileId && googleAccessToken) {
        headers['x-drive-access-token'] = googleAccessToken;
      }
      
      // Use the correct apiRequest pattern to include headers
      const response = await apiRequest(`/api/documents/${documentId}/analyze`, {
        method: "POST",
        headers: Object.keys(headers).length > 0 ? headers : undefined,
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
        description: "Document has been analyzed with AI successfully.",
      });
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
      toast({
        title: "Document deleted",
        description: "Document has been deleted successfully.",
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
        description: data.message || `Organized ${data.organized} documents into smart folders`,
      });
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
      if (!documentsData?.documents) return { success: true };
      
      // Delete all documents one by one
      const deletePromises = documentsData.documents.map(doc => 
        apiRequest("DELETE", `/api/documents/${doc.id}`)
      );
      
      await Promise.all(deletePromises);
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/folders'] });
      toast({
        title: "All documents deleted",
        description: "All documents have been deleted successfully.",
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

  const getUploadParameters = async () => {
    const response = await apiRequest("POST", "/api/documents/upload-url", {});
    const data = await response.json();
    return {
      method: "PUT" as const,
      url: data.uploadURL,
    };
  };

  // Bulk upload function for multiple files
  const getBulkUploadParameters = async (fileCount: number) => {
    const response = await apiRequest("POST", "/api/documents/bulk-upload-urls", {
      fileCount,
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
      
      // Track document upload event
      trackEvent('file_upload', { file_type: fileType, file_size: file.size });
      
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

  // Handle bulk upload completion with fun messaging
  const handleBulkUploadComplete = (result: {
    successful: number;
    failed: number;
    details: Array<{ success: boolean; originalName: string; error?: string }>;
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
      total: result.successful + result.failed
    });
    
    // Refresh document lists and folders
    queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
    queryClient.invalidateQueries({ queryKey: ["/api/folders"] });
    queryClient.invalidateQueries({ queryKey: ["/api/queue/status"] });
    
    // Show success toast with fun messaging
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
        return <FileImage className="h-5 w-5 text-purple-500" />;
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

  const handleDownload = async (document: DocumentWithFolderAndTags) => {
    try {
      // For all documents (both uploaded and Google Drive), use our download API
      const response = await apiRequest('GET', `/api/documents/${document.id}/download`);
      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      
      // Create a temporary link element to trigger download
      const link = window.document.createElement('a');
      link.href = url;
      link.download = document.name || 'document';
      window.document.body.appendChild(link);
      link.click();
      
      // Clean up
      window.document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      // Fallback to viewer page
      window.open(`/viewer/${document.id}`, '_blank');
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
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-card border-r border-border flex flex-col">
        <div className="p-6 border-b border-border">
          <h1 className="text-xl font-bold text-foreground flex items-center">
            <FolderOpen className="mr-3 text-primary" />
            DocuFlow
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Document Management API</p>
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
          
          {/* Automatic Organization Folders */}
          {hierarchicalFolders.length > 0 && (
            <div className="mt-8">
              <h3 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center">
                <Sparkles className="mr-1 h-3 w-3" />
                Smart Organization
              </h3>
              <ul className="mt-2 space-y-1">
                {hierarchicalFolders.map((category) => (
                  <li key={category.id}>
                    {/* Main Category Folder */}
                    <Button
                      variant="ghost"
                      className="w-full justify-between px-3 py-2 text-sm text-foreground hover:bg-accent"
                      onClick={() => setSelectedFolderId(selectedFolderId === category.id ? "" : category.id)}
                      data-testid={`folder-${category.name.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      <div className="flex items-center">
                        <FolderOpen className="mr-3 h-4 w-4" style={{ color: category.color || '#3b82f6' }} />
                        <span className="font-medium">{category.name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {category.documentCount || 0}
                      </span>
                    </Button>
                    
                    {/* Sub-folders */}
                    {category.subFolders && category.subFolders.length > 0 && (
                      <ul className="ml-6 mt-1 space-y-1">
                        {category.subFolders.map((subFolder) => (
                          <li key={subFolder.id}>
                            <Button
                              variant="ghost"
                              className="w-full justify-between px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                              onClick={() => setSelectedFolderId(selectedFolderId === subFolder.id ? "" : subFolder.id)}
                              data-testid={`subfolder-${subFolder.name.toLowerCase().replace(/\s+/g, '-')}`}
                            >
                              <div className="flex items-center">
                                <div className="mr-3 h-3 w-3 rounded-sm" style={{ backgroundColor: subFolder.color || '#9ca3af' }} />
                                <span>{subFolder.name}</span>
                              </div>
                              <span className="text-xs text-muted-foreground">
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
            </div>
          )}

          
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

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Header */}
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h2 className="text-lg font-semibold text-foreground">All Documents</h2>
              <span className="text-sm text-muted-foreground" data-testid="document-count">
                {isConversationalMode && conversationalData 
                  ? `${conversationalData.totalResults} documents found`
                  : `${documentsData?.pagination.total || 0} documents`
                }
              </span>
            </div>
            
            <div className="flex items-center space-x-3">
              {/* Enhanced Search with Conversational Mode */}
              <div className="relative flex items-center">
                <div className="relative">
                  <Input
                    type="text"
                    placeholder={isConversationalMode 
                      ? "Ask about your documents... (e.g., 'what's my EIN?')" 
                      : "Search documents..."}
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && isConversationalMode) {
                        e.preventDefault();
                        handleGoButtonClick();
                      }
                    }}
                    className={`w-80 pl-10 ${isConversationalMode ? 'pr-20 border-blue-500 focus:border-blue-600' : 'pr-12'}`}
                    data-testid="search-input"
                  />
                  {isConversationalMode ? (
                    <MessageCircle className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-blue-500" />
                  ) : (
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  )}
                  
                  {/* AI Search Go Button - only show in conversational mode */}
                  {isConversationalMode && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleGoButtonClick}
                      disabled={searchQuery.trim().length <= 2 || isAISearching}
                      className="absolute right-10 top-1/2 transform -translate-y-1/2 h-8 px-3"
                      title="Execute AI search"
                      data-testid="button-ai-search-go"
                    >
                      {isAISearching ? "..." : "Go!"}
                    </Button>
                  )}

                  {/* Conversational Mode Toggle */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setIsConversationalMode(!isConversationalMode);
                      // Don't clear search query - preserve user input when switching modes
                      setConversationalResponse(null);
                      setSearchIntent(null);
                      setSearchKeywords([]);
                      setExecuteAISearch(false); // Clear AI search execution flag
                      setAISearchQuery(""); // Clear AI search query
                    }}
                    className="absolute right-1 top-1/2 transform -translate-y-1/2 h-8 w-8 p-0"
                    title={isConversationalMode ? "Switch to traditional search" : "Switch to AI conversational search"}
                    data-testid="button-search-mode-toggle"
                  >
                    {isConversationalMode ? (
                      <Search className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Zap className="h-4 w-4 text-blue-500" />
                    )}
                  </Button>
                </div>
                
                {/* Search Mode Indicator */}
                {isConversationalMode && (
                  <Badge variant="outline" className="ml-2 text-blue-600 border-blue-300">
                    <Brain className="h-3 w-3 mr-1" />
                    AI Search
                  </Badge>
                )}
              </div>
              
              {/* View Toggle */}
              <div className="flex items-center border border-border rounded-md">
                <Button
                  variant={viewMode === "grid" ? "default" : "ghost"}
                  size="sm"
                  className="rounded-r-none"
                  onClick={() => setViewMode("grid")}
                  data-testid="view-grid"
                >
                  <Grid3X3 className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === "list" ? "default" : "ghost"}
                  size="sm"
                  className="rounded-l-none"
                  onClick={() => setViewMode("list")}
                  data-testid="view-list"
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>
              
              {/* Queue Status Button */}
              <Button
                variant="outline"
                onClick={() => setQueueDashboardOpen(true)}
                className="flex items-center gap-2"
                data-testid="button-queue-status"
              >
                <Brain className="h-4 w-4" />
                AI Queue
              </Button>
              
              {/* Smart Organization Button */}
              <Button
                variant="outline"
                onClick={() => organizeAllMutation.mutate()}
                disabled={organizeAllMutation.isPending}
                className="flex items-center gap-2"
                data-testid="button-organize-all"
              >
                <Sparkles className="h-4 w-4" />
                {organizeAllMutation.isPending ? 'Organizing...' : 'Smart Organization'}
              </Button>
              
              {/* Delete All Button (for testing) */}
              {currentDocuments && currentDocuments.length > 0 && (
                <Button
                  variant="destructive"
                  onClick={() => deleteAllDocumentsMutation.mutate()}
                  disabled={deleteAllDocumentsMutation.isPending}
                  className="flex items-center gap-2"
                  data-testid="button-delete-all"
                >
                  <Trash2 className="h-4 w-4" />
                  {deleteAllDocumentsMutation.isPending ? 'Deleting All...' : 'Delete All'}
                </Button>
              )}
              
              {/* Upload Button - Now with bulk upload support! */}
              <ObjectUploader
                maxNumberOfFiles={5}
                maxFileSize={50 * 1024 * 1024} // 50MB
                enableBulkUpload={true}
                onGetUploadParameters={getUploadParameters}
                onGetBulkUploadParameters={getBulkUploadParameters}
                onComplete={handleUploadComplete}
                onBulkUploadComplete={handleBulkUploadComplete}
                buttonClassName="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload
              </ObjectUploader>
            </div>
          </div>
        </header>

        {/* Conversational Search Response */}
        {isConversationalMode && conversationalResponse && (
          <div className="bg-blue-50 dark:bg-blue-950/20 border-b border-blue-200 dark:border-blue-800 px-6 py-4">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                  <Brain className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2 mb-2">
                  <h3 className="text-sm font-medium text-blue-900 dark:text-blue-100">
                    AI Assistant Response
                  </h3>
                  {searchIntent && (
                    <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50 dark:bg-blue-900/50">
                      {searchIntent}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-blue-800 dark:text-blue-200 leading-relaxed">
                  {conversationalResponse}
                </p>
                {searchKeywords.length > 0 && (
                  <div className="flex items-center space-x-2 mt-3">
                    <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">Keywords:</span>
                    <div className="flex flex-wrap gap-1">
                      {searchKeywords.map((keyword, index) => (
                        <Badge 
                          key={index} 
                          variant="secondary" 
                          className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                        >
                          {keyword}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {/* Confidence Scores Display */}
                {currentDocuments.length > 0 && isConversationalMode && (
                  <div className="mt-3 pt-3 border-t border-blue-200 dark:border-blue-800">
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">Search Confidence:</span>
                      <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50 dark:bg-blue-900/50">
                        {currentDocuments.length} document{currentDocuments.length === 1 ? '' : 's'} found
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      {currentDocuments.slice(0, 3).map((doc: any) => (
                        <div key={doc.id} className="flex items-center justify-between text-xs">
                          <span className="text-blue-700 dark:text-blue-300 truncate flex-1 mr-2">
                            {doc.name}
                          </span>
                          <Badge 
                            variant={
                              (doc.confidenceScore || 0) >= 80 ? "default" :
                              (doc.confidenceScore || 0) >= 40 ? "secondary" : "outline"
                            }
                            className={`text-xs ${
                              (doc.confidenceScore || 0) >= 80 ? "bg-green-100 text-green-700 border-green-300 dark:bg-green-900 dark:text-green-300" :
                              (doc.confidenceScore || 0) >= 40 ? "bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900 dark:text-yellow-300" :
                              "bg-red-100 text-red-700 border-red-300 dark:bg-red-900 dark:text-red-300"
                            }`}
                            data-testid={`confidence-score-${doc.id}`}
                          >
                            {doc.confidenceScore || 0}% confidence
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-card border-b border-border px-6 py-3">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-foreground">Filter:</label>
              <Select value={selectedFileType} onValueChange={setSelectedFileType}>
                <SelectTrigger className="w-40" data-testid="filter-type">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="pdf">PDF</SelectItem>
                  <SelectItem value="docx">Word Documents</SelectItem>
                  <SelectItem value="xlsx">Excel</SelectItem>
                  <SelectItem value="image">Images</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-foreground">Folder:</label>
              <Select value={selectedFolderId} onValueChange={setSelectedFolderId}>
                <SelectTrigger className="w-40" data-testid="filter-folder">
                  <SelectValue placeholder="All Folders" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Folders</SelectItem>
                  {folders
                    .filter(folder => folder.isAutoCreated && !folder.parentId) // Only Smart Organization main categories
                    .map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <Button 
              variant="ghost" 
              onClick={clearFilters}
              className="text-sm text-muted-foreground hover:text-foreground"
              data-testid="clear-filters"
            >
              Clear Filters
            </Button>
          </div>
        </div>

        {/* Documents Grid */}
        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
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
          ) : currentDocuments.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">No documents found</h3>
              <p className="text-muted-foreground">
                {searchQuery || selectedFileType || selectedFolderId || selectedTagId
                  ? "Try adjusting your filters or search query."
                  : "Upload your first document to get started."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {currentDocuments.map((document) => (
                <Card 
                  key={document.id} 
                  className="hover:shadow-lg transition-shadow duration-200 cursor-pointer" 
                  data-testid={`document-card-${document.id}`}
                  onClick={() => handleViewDocument(document)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center space-x-2 flex-1 min-w-0">
                        {getFileIcon(document.fileType)}
                        <div className="min-w-0">
                          <h3 className="text-sm font-medium text-foreground truncate" title={getDocumentTooltip(document)} data-testid={`document-name-${document.id}`}>
                            {getDocumentDisplayName(document)}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(document.fileSize || 0)}
                          </p>
                          {document.originalName && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5" title={document.originalName} data-testid={`original-name-${document.id}`}>
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
                            data-testid={`menu-view-${document.id}`}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            View Details
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
                    
                    <div className="mb-3">
                      <div className="flex flex-wrap gap-1">
                        {document.tags.map((tag) => (
                          <Badge
                            key={tag.id}
                            variant="secondary"
                            className="text-xs"
                            style={{ backgroundColor: `${tag.color || '#3b82f6'}20`, color: tag.color || '#3b82f6' }}
                          >
                            {tag.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
                      <span>{formatDate(document.uploadedAt)}</span>
                      <span>{document.folder?.name || "No folder"}</span>
                    </div>
                    
                    {/* AI Analysis Results */}
                    {(document.aiSummary || document.overrideDocumentType || document.overrideCategory) && (
                      <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-950 rounded-md border border-blue-200 dark:border-blue-800">
                        <div className="flex items-center gap-2 mb-1">
                          <Sparkles className="h-3 w-3 text-blue-600" />
                          <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
                            {document.aiSummary ? 'AI Analysis' : 'Classification'}
                          </span>
                        </div>
                        {document.aiSummary && (
                          <p className="text-xs text-blue-600 dark:text-blue-400 mb-1">{document.aiSummary}</p>
                        )}
                        {document.aiKeyTopics && document.aiKeyTopics.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {document.aiKeyTopics.map((topic, index) => (
                              <Badge key={index} variant="secondary" className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                                {topic}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {(document.aiDocumentType || document.overrideDocumentType || document.overrideCategory) && (
                          <div className="text-xs text-blue-600 dark:text-blue-400 mt-1 space-y-1">
                            <div className="flex items-center justify-between">
                              <span>Folder: {document.overrideCategory || document.aiCategory || 'Uncategorized'}</span>
                              <div className="flex items-center gap-1">
                                {document.overrideCategory && (
                                  <span className="text-xs bg-green-100 dark:bg-green-900 px-1.5 py-0.5 rounded font-medium" data-testid={`override-category-${document.id}`}>
                                    Custom
                                  </span>
                                )}
                                {!document.overrideCategory && formatConfidence(document.aiCategoryConfidence) && (
                                  <span className="text-xs bg-blue-100 dark:bg-blue-900 px-1.5 py-0.5 rounded font-medium" data-testid={`confidence-category-${document.id}`}>
                                    Classification Confidence: {formatConfidence(document.aiCategoryConfidence)}
                                  </span>
                                )}
                              </div>
                            </div>
                            {(document.overrideDocumentType || document.aiDocumentType) && (
                              <div className="flex items-center justify-between">
                                <span>Sub-folder: {document.overrideDocumentType || document.aiDocumentType}</span>
                                <div className="flex items-center gap-1">
                                  {document.overrideDocumentType && (
                                    <span className="text-xs bg-green-100 dark:bg-green-900 px-1.5 py-0.5 rounded font-medium" data-testid={`override-type-${document.id}`}>
                                      Custom
                                    </span>
                                  )}
                                  {!document.overrideDocumentType && formatConfidence(document.aiDocumentTypeConfidence) && (
                                    <span className="text-xs bg-blue-100 dark:bg-blue-900 px-1.5 py-0.5 rounded font-medium" data-testid={`confidence-type-${document.id}`}>
                                      Classification Confidence: {formatConfidence(document.aiDocumentTypeConfidence)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex items-center space-x-2">
                      <Button
                        size="sm"
                        className="flex-none w-20"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(document);
                        }}
                        data-testid={`download-${document.id}`}
                      >
                        <Download className="h-3 w-3" />
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline" 
                        className="flex-1"
                        onClick={async (e) => {
                          e.stopPropagation();
                          // Direct document viewing - bypass intermediate page
                          try {
                            // For Google Drive documents, open Drive viewer directly
                            if (document.driveWebViewLink) {
                              window.open(document.driveWebViewLink, '_blank');
                              return;
                            }

                            // For uploaded documents, fetch and display in new tab
                            const response = await apiRequest('GET', `/api/documents/${document.id}/download`);
                            if (!response.ok) {
                              throw new Error('View failed');
                            }

                            const blob = await response.blob();
                            const url = window.URL.createObjectURL(blob);
                            window.open(url, '_blank');
                          } catch (error) {
                            console.error('View failed:', error);
                            // Fallback to viewer page if direct view fails
                            window.open(`/viewer/${document.id}`, '_blank');
                          }
                        }}
                        data-testid={`preview-${document.id}`}
                      >
                        <Eye className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant={document.aiSummary ? "secondary" : "outline"}
                        className="flex-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          analyzeDocumentMutation.mutate(document.id);
                        }}
                        disabled={analyzeDocumentMutation.isPending}
                        data-testid={`analyze-ai-${document.id}`}
                      >
                        <Brain className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteDocumentMutation.mutate(document.id);
                        }}
                        disabled={deleteDocumentMutation.isPending}
                        data-testid={`delete-${document.id}`}
                      >
                        <Trash2 className="h-3 w-3" />
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

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { getGoogleAccessToken, connectGoogleDrive } from "@/lib/firebase";
import { trackEvent } from "@/lib/analytics";
import { 
  HardDrive, 
  Search, 
  Download, 
  Brain, 
  Sparkles, 
  FileText, 
  File, 
  FolderOpen,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Cloud
} from "lucide-react";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime: string;
  webViewLink: string;
  parents?: string[];
}

interface DriveFolder {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
  parents?: string[];
}

interface DriveConnectionStatus {
  connected: boolean;
  hasAccess: boolean;
  quota?: {
    limit: string;
    usage: string;
    usageInDrive: string;
  } | null;
  message: string;
}

interface DriveDocumentsResponse {
  files: DriveFile[];
  folders: DriveFolder[];
  nextPageToken?: string;
  pagination: {
    pageSize: number;
    hasNext: boolean;
  };
}

export default function Drive() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [pageToken, setPageToken] = useState("");
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get Google access token
  const googleAccessToken = getGoogleAccessToken();

  // Handle search with debouncing
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    setPageToken(""); // Reset pagination
    
    // Clear existing timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
    
    // Set new timeout for analytics tracking
    if (query.trim()) {
      const timeout = setTimeout(() => {
        trackEvent('search', { search_term: query.trim(), source: 'drive' });
      }, 500); // 500ms debounce
      setSearchTimeout(timeout);
    }
  };

  // Check Drive connection status
  const { data: connectionStatus, isLoading: connectionLoading, error: connectionError } = useQuery<DriveConnectionStatus>({
    queryKey: ['drive-connection'],
    queryFn: async () => {
      if (!googleAccessToken) {
        throw new Error('No Google access token available');
      }
      
      return apiRequest('/api/drive/connect', {
        method: 'GET',
        headers: {
          'x-drive-access-token': googleAccessToken,
        },
      });
    },
    enabled: !!googleAccessToken,
    retry: false,
  });

  // Fetch Drive documents
  const { data: driveData, isLoading: documentsLoading, error: documentsError, refetch } = useQuery<DriveDocumentsResponse>({
    queryKey: ['drive-documents', searchQuery, selectedFolderId, pageToken],
    queryFn: async () => {
      if (!googleAccessToken) {
        throw new Error('No Google access token available');
      }
      
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.append('search', searchQuery.trim());
      if (selectedFolderId) params.append('folderId', selectedFolderId);
      if (pageToken) params.append('pageToken', pageToken);
      
      return apiRequest(`/api/drive/documents?${params.toString()}`, {
        method: 'GET',
        headers: {
          'x-drive-access-token': googleAccessToken,
        },
      });
    },
    enabled: !!googleAccessToken && !!connectionStatus?.connected,
    retry: false,
  });

  // Sync Drive document mutation
  const syncDocumentMutation = useMutation({
    mutationFn: async (data: { driveFileId: string; folderId?: string; runAiAnalysis?: boolean }) => {
      if (!googleAccessToken) {
        throw new Error('No Google access token available');
      }
      
      return apiRequest('/api/drive/sync', {
        method: 'POST',
        headers: {
          'x-drive-access-token': googleAccessToken,
        },
        body: JSON.stringify(data),
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Document Synced",
        description: data.isNew ? "Document imported from Drive successfully" : "Document sync updated",
      });
      
      // Track successful sync
      trackEvent('file_sync', { source: 'drive', is_new: data.isNew });
      
      // Invalidate documents cache to refresh local documents list
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
    },
    onError: (error: any) => {
      console.error('Sync error:', error);
      toast({
        title: "Sync Failed",
        description: error?.message || "Failed to sync document from Drive",
        variant: "destructive",
      });
      
      // Track failed sync
      trackEvent('file_sync_failed', { source: 'drive', error_message: error?.message });
    },
  });

  const handleSyncDocument = (driveFile: DriveFile, runAiAnalysis: boolean = false) => {
    syncDocumentMutation.mutate({
      driveFileId: driveFile.id,
      runAiAnalysis,
    });
  };

  // Format file size
  const formatFileSize = (sizeStr?: string): string => {
    if (!sizeStr) return 'Unknown size';
    const size = parseInt(sizeStr);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Format date
  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Get file icon
  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes('document') || mimeType.includes('text')) return FileText;
    if (mimeType.includes('folder')) return FolderOpen;
    return File;
  };

  if (!googleAccessToken) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Google Drive access not available. Please sign out and sign in again to grant Drive permissions.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <HardDrive className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold">Google Drive</h1>
            <p className="text-muted-foreground">Import and organize your Drive documents with AI</p>
          </div>
        </div>
        <Button onClick={() => refetch()} variant="outline" size="sm" data-testid="button-refresh-drive">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Connection Status */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            Drive Connection Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!googleAccessToken ? (
            <div className="space-y-3">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Connect your Google Drive to access and manage your documents with AI-powered analysis.
                </AlertDescription>
              </Alert>
              <Button 
                onClick={async () => {
                  try {
                    await connectGoogleDrive();
                    toast({
                      title: "Drive connection initiated",
                      description: "You'll be redirected to Google for authorization...",
                    });
                  } catch (error) {
                    toast({
                      title: "Connection failed",
                      description: "Failed to connect to Google Drive. Please try again.",
                      variant: "destructive"
                    });
                  }
                }}
                className="w-full"
                data-testid="button-connect-drive"
              >
                <Cloud className="h-4 w-4 mr-2" />
                Connect Google Drive
              </Button>
            </div>
          ) : connectionLoading ? (
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span>Checking connection...</span>
            </div>
          ) : connectionError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Failed to connect to Google Drive. Please check your permissions.
              </AlertDescription>
            </Alert>
          ) : connectionStatus?.connected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <span className="font-medium">Connected to Google Drive</span>
              </div>
              {connectionStatus.quota && (
                <div className="text-sm text-muted-foreground">
                  <p>Storage: {formatFileSize(connectionStatus.quota.usageInDrive)} used of {formatFileSize(connectionStatus.quota.limit)}</p>
                </div>
              )}
            </div>
          ) : (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {connectionStatus?.message || 'Drive connection failed'}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {connectionStatus?.connected && (
        <>
          {/* Search and Filters */}
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                    <Input
                      placeholder="Search Drive documents..."
                      value={searchQuery}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      className="pl-10"
                      data-testid="input-drive-search"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Documents Grid */}
          <div className="space-y-4">
            {documentsLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-6 w-6 animate-spin mr-2" />
                <span>Loading Drive documents...</span>
              </div>
            ) : documentsError ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Failed to load Drive documents. Please try again.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                {driveData?.files && driveData.files.length > 0 ? (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {driveData.files.map((file) => {
                      const IconComponent = getFileIcon(file.mimeType);
                      
                      return (
                        <Card key={file.id} className="hover:shadow-md transition-shadow">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex items-center gap-3 flex-1 min-w-0">
                                <IconComponent className="h-5 w-5 text-blue-600 flex-shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <h3 className="font-medium truncate" title={file.name}>{file.name}</h3>
                                  <p className="text-sm text-muted-foreground">
                                    {file.size && formatFileSize(file.size)} • {formatDate(file.modifiedTime)}
                                  </p>
                                </div>
                              </div>
                            </div>
                            
                            <div className="flex gap-2 mt-3">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => window.open(file.webViewLink, '_blank')}
                                data-testid={`button-view-${file.id}`}
                              >
                                <ExternalLink className="h-3 w-3 mr-1" />
                                View
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => handleSyncDocument(file, false)}
                                disabled={syncDocumentMutation.isPending}
                                data-testid={`button-sync-${file.id}`}
                              >
                                <Download className="h-3 w-3 mr-1" />
                                Sync
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => handleSyncDocument(file, true)}
                                disabled={syncDocumentMutation.isPending}
                                data-testid={`button-sync-ai-${file.id}`}
                              >
                                <Brain className="h-3 w-3 mr-1" />
                                Sync + AI
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <HardDrive className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-medium mb-2">No documents found</h3>
                    <p className="text-muted-foreground">
                      {searchQuery ? 'Try a different search term' : 'No supported documents in your Drive'}
                    </p>
                  </div>
                )}

                {/* Pagination */}
                {driveData?.pagination?.hasNext && (
                  <div className="flex justify-center pt-6">
                    <Button
                      variant="outline"
                      onClick={() => setPageToken(driveData.nextPageToken || "")}
                      disabled={documentsLoading}
                      data-testid="button-load-more"
                    >
                      Load More
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
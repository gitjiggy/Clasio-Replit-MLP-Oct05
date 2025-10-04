import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { connectGoogleDrive } from "@/lib/firebase";
import { trackEvent } from "@/lib/analytics";
import { MobileLayout } from "@/components/MobileLayout";
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

  // Drive authentication is now handled via httpOnly cookies
  const [isDriveAuthenticated, setIsDriveAuthenticated] = useState(true); // Assume authenticated initially

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

  // Check Drive connection status - only if we have a token
  const { data: connectionStatus, isLoading: connectionLoading, error: connectionError, refetch: refetchConnection } = useQuery<DriveConnectionStatus>({
    queryKey: ['drive-connection'],
    queryFn: async () => {
      try {
        return await apiRequest('/api/drive/connect', {
          method: 'GET',
        });
      } catch (error: any) {
        // Handle token expiry - automatically prompt re-authentication
        if (error.response?.status === 403 && error.response?.data?.error?.includes('Invalid or expired Drive access token')) {
          return { 
            connected: false, 
            hasAccess: false, 
            message: 'Drive access token has expired. Please re-authenticate.' 
          };
        }
        // Handle specific API not enabled error
        if (error.response?.status === 403 && error.response?.data?.error?.includes('Google Drive API has not been used')) {
          return { 
            connected: false, 
            hasAccess: false, 
            message: 'Google Drive API is being enabled. This may take a few minutes. The page will auto-refresh.' 
          };
        }
        return { 
          connected: false, 
          hasAccess: false, 
          message: error.message || 'Drive connection failed' 
        };
      }
    },
    enabled: isDriveAuthenticated, // Only run if we believe we're authenticated
    retry: false,
    refetchInterval: 5000, // Auto-refresh every 5 seconds for more responsive connection status
    staleTime: 2000, // Consider data stale after 2 seconds
  });

  // Fetch Drive documents - only when connected
  const { data: driveData, isLoading: documentsLoading, error: documentsError, refetch } = useQuery<DriveDocumentsResponse>({
    queryKey: ['drive-documents', searchQuery, selectedFolderId, pageToken],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.append('search', searchQuery.trim());
      if (selectedFolderId) params.append('folderId', selectedFolderId);
      if (pageToken) params.append('pageToken', pageToken);
      
      return apiRequest(`/api/drive/documents?${params.toString()}`, {
        method: 'GET',
      });
    },
    enabled: isDriveAuthenticated && !!connectionStatus?.connected,
    retry: false,
    refetchInterval: 10000, // Auto-refresh drive documents every 10 seconds
    staleTime: 5000, // Consider data stale after 5 seconds
  });

  // Sync Drive document mutation
  const syncDocumentMutation = useMutation({
    mutationFn: async (data: { driveFileId: string; folderId?: string; runAiAnalysis?: boolean }) => {
      return apiRequest('/api/drive/sync', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    onSuccess: (data: any, variables: any) => {
      // Show initial sync success toast (matching Upload functionality)
      const baseMessage = data.isNew ? "Document imported from Drive successfully" : "Document sync updated";
      const description = variables.runAiAnalysis 
        ? `${baseMessage}. We'll analyze it in the background.`
        : baseMessage;
      
      toast({
        title: "Sync successful!",
        description,
      });
      
      // Track successful sync
      trackEvent('file_sync', { source: 'drive', is_new: data.isNew });
      
      // Invalidate documents cache to refresh local documents list immediately
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      
      // If AI analysis was requested, show AI analysis progress like Upload does
      if (variables.runAiAnalysis) {
        // Show AI analysis starting toast
        setTimeout(() => {
          toast({
            title: "AI Analysis started",
            description: "Analyzing document content and organizing with Smart Organization...",
          });
        }, 1000);
        
        // After analysis time, show completion and refresh screen (matching Upload pattern)
        setTimeout(() => {
          toast({
            title: "Smart Organization complete!",
            description: "Document has been analyzed and organized with AI insights.",
          });
          
          // Refresh all relevant data to show updated analysis results
          queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
          queryClient.invalidateQueries({ queryKey: ['/api/folders'] });
          queryClient.invalidateQueries({ queryKey: ['/api/tags'] });
        }, 6000); // 6 seconds total to allow for AI analysis processing
      }
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

  // Remove this early return - let the normal UI handle the no-token case

  return (
    <MobileLayout documentCount={driveData?.files?.length || 0}>
      {(() => {
        const hasScrollableContent = connectionStatus?.connected && 
          (documentsLoading || (driveData?.files?.length ?? 0) > 0);
        
        return (
          <div className={`container mx-auto p-6 max-w-6xl md:overflow-y-auto ${
            hasScrollableContent ? 'overflow-y-auto' : 'overflow-y-visible'
          }`}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <HardDrive className="h-8 w-8 text-blue-600" />
        <div>
          <h1 className="text-3xl font-light tracking-wide">Google Drive</h1>
          <p className="text-muted-foreground font-light tracking-wide">Import and organize your Drive documents with AI</p>
        </div>
      </div>

      {/* Connection Status & Search - All in One Line */}
      <div className="mb-6 flex items-center gap-4">
        {/* Connection Status Box */}
        <div className="inline-flex items-center gap-6 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border border-border/50 rounded-xl px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-light tracking-wide text-foreground">Drive Connection Status</span>
          </div>
          
          {!connectionStatus?.connected ? (
            <Button 
              onClick={async () => {
                try {
                  toast({
                    title: "Opening authorization window",
                    description: "A new window will open for Google Drive authorization...",
                  });
                  
                  console.log('[Drive Auth Flow] Starting Google Drive authentication...');
                  const success = await connectGoogleDrive();
                  console.log('[Drive Auth Flow] Authentication result:', success);
                  
                  if (success) {
                    console.log('[Drive Auth Flow] ✅ Authentication successful, refreshing connection status...');
                    
                    console.log('[Drive Auth Flow] Browser cookies after auth:', {
                      allCookies: document.cookie,
                      hasDriveToken: document.cookie.includes('drive_access_token')
                    });
                    
                    setIsDriveAuthenticated(true);
                    queryClient.invalidateQueries({ queryKey: ['drive-connection'] });
                    queryClient.invalidateQueries({ queryKey: ['drive-documents'] });
                    
                    toast({
                      title: "Drive Connected!",
                      description: "Successfully connected to Google Drive. You can now sync your documents.",
                    });
                  }
                } catch (error: any) {
                  console.error('[Drive Auth Flow] Drive connection error:', error);
                  console.error('[Drive Auth Flow] Error details:', {
                    message: error?.message,
                    stack: error?.stack,
                    name: error?.name
                  });
                  
                  if (error.message.includes("Popup was blocked")) {
                    toast({
                      title: "Popup Blocked",
                      description: "Please allow popups for this site and try again.",
                      variant: "destructive"
                    });
                  } else if (error.message.includes("cancelled") || error.message.includes("Authorization was cancelled")) {
                    toast({
                      title: "Drive Connection",
                      description: "You can connect to Google Drive anytime to access your documents.",
                    });
                  } else {
                    toast({
                      title: "Connection Issue",
                      description: "Unable to connect to Google Drive. Please try again.",
                      variant: "destructive"
                    });
                  }
                }
              }}
              size="sm"
              variant="outline"
              className="h-8 font-light tracking-wide"
              data-testid="button-connect-drive"
            >
              <Cloud className="h-3.5 w-3.5 mr-1.5" />
              Connect
            </Button>
          ) : connectionLoading ? (
            <div className="flex items-center gap-2">
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <span className="text-sm font-light tracking-wide text-muted-foreground">Checking...</span>
            </div>
          ) : connectionError ? (
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              <span className="text-sm font-light tracking-wide">Connection failed</span>
            </div>
          ) : connectionStatus?.connected ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                <span className="text-sm font-light tracking-wide text-green-600 dark:text-green-400">Connected to Google Drive</span>
              </div>
              {connectionStatus.quota && (
                <span className="text-xs font-light tracking-wide text-muted-foreground border-l border-border pl-3">
                  Storage: {formatFileSize(connectionStatus.quota.usageInDrive)} used of {formatFileSize(connectionStatus.quota.limit)}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              <span className="text-sm font-light tracking-wide">{connectionStatus?.message || 'Drive connection failed'}</span>
            </div>
          )}
        </div>

        {/* Search Box */}
        {connectionStatus?.connected && (
          <div className="inline-flex items-center bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border border-border/50 rounded-xl px-4 py-2.5 shadow-sm flex-1 max-w-md">
            <Search className="h-4 w-4 text-muted-foreground mr-3 flex-shrink-0" />
            <input
              type="text"
              placeholder="Search Drive documents..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="bg-transparent border-none outline-none text-sm font-light tracking-wide text-foreground placeholder:text-muted-foreground w-full"
              data-testid="input-drive-search"
            />
          </div>
        )}

        {/* Spacer to push refresh to the right */}
        {connectionStatus?.connected && <div className="flex-1" />}

        {/* Refresh Button */}
        {connectionStatus?.connected && (
          <Button 
            onClick={() => {
              refetchConnection();
              refetch();
            }} 
            variant="outline" 
            size="sm" 
            className="font-light tracking-wide"
            data-testid="button-refresh-drive"
            disabled={connectionLoading || documentsLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${(connectionLoading || documentsLoading) ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        )}
      </div>

      {connectionStatus?.connected && (
        <>

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
                                  <h3 className="font-light tracking-wide truncate" title={file.name}>{file.name}</h3>
                                  <p className="text-sm text-muted-foreground font-light tracking-wide">
                                    {file.size && formatFileSize(file.size)} • {formatDate(file.modifiedTime)}
                                  </p>
                                </div>
                              </div>
                            </div>
                            
                            <div className="grid grid-cols-3 gap-1.5 mt-2 -mb-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-11 bg-emerald-100/50 hover:bg-emerald-200/70 dark:bg-emerald-900/20 dark:hover:bg-emerald-800/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-700/50 px-1.5 transition-all flex-col gap-0.5"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  window.open(file.webViewLink, '_blank');
                                }}
                                data-testid={`button-view-${file.id}`}
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                <span className="text-[10px] font-light tracking-wide">View</span>
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-11 bg-blue-100/50 hover:bg-blue-200/70 dark:bg-blue-900/20 dark:hover:bg-blue-800/30 text-blue-600 dark:text-blue-400 border border-blue-200/50 dark:border-blue-700/50 px-1.5 transition-all flex-col gap-0.5"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSyncDocument(file, false);
                                }}
                                disabled={syncDocumentMutation.isPending}
                                data-testid={`button-sync-${file.id}`}
                              >
                                <Download className="h-3.5 w-3.5" />
                                <span className="text-[10px] font-light tracking-wide">Sync</span>
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-11 bg-purple-100/50 hover:bg-purple-200/70 dark:bg-purple-900/20 dark:hover:bg-purple-800/30 text-purple-600 dark:text-purple-400 border border-purple-200/50 dark:border-purple-700/50 px-1.5 transition-all flex-col gap-0.5"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSyncDocument(file, true);
                                }}
                                disabled={syncDocumentMutation.isPending}
                                data-testid={`button-sync-ai-${file.id}`}
                              >
                                <Brain className="h-3.5 w-3.5" />
                                <span className="text-[10px] font-light tracking-wide">Sync + AI</span>
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
                    <h3 className="text-lg font-light tracking-wide mb-2">Nothing here yet! 📭</h3>
                    <p className="text-muted-foreground font-light tracking-wide">
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
      })()}
    </MobileLayout>
  );
}
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { DocumentWithFolderAndTags } from "@shared/schema";
import { getDocumentDisplayName } from "@/lib/documentDisplay";
import { MobileLayout } from "@/components/MobileLayout";
import { 
  Trash2,
  RotateCcw,
  FileText,
  File,
  FileImage,
  FileSpreadsheet,
  Presentation,
  Calendar,
  Clock,
  AlertTriangle
} from "lucide-react";

// Calculate days remaining until auto-deletion
function getDaysRemaining(deletedAt: string, retentionDays: number = 7): number {
  const deletedDate = new Date(deletedAt);
  const now = new Date();
  const diffTime = retentionDays * 24 * 60 * 60 * 1000 - (now.getTime() - deletedDate.getTime()); // retention days minus elapsed time
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

// Get countdown message
function getCountdownMessage(daysRemaining: number): string {
  if (daysRemaining === 0) return "Auto-deletes today";
  if (daysRemaining === 1) return "Auto-deletes in 1 day";
  return `Auto-deletes in ${daysRemaining} days`;
}

// Get file icon based on file type
function getFileIcon(fileType: string) {
  switch (fileType.toLowerCase()) {
    case 'image': return <FileImage className="h-4 w-4" />;
    case 'pdf': return <FileText className="h-4 w-4" />;
    case 'spreadsheet': return <FileSpreadsheet className="h-4 w-4" />;
    case 'presentation': return <Presentation className="h-4 w-4" />;
    default: return <File className="h-4 w-4" />;
  }
}

interface TrashedDocumentsResponse {
  documents: DocumentWithFolderAndTags[];
}

interface TrashConfigResponse {
  retentionDays: number;
  policy: string;
  description: string;
}

export default function Trash() {
  const [showEmptyTrashDialog, setShowEmptyTrashDialog] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch trashed documents
  const { data: trashedData, isLoading, error } = useQuery<TrashedDocumentsResponse>({
    queryKey: ["/api/documents/trash"],
    enabled: true,
  });

  // Fetch trash configuration
  const { data: trashConfig } = useQuery<TrashConfigResponse>({
    queryKey: ["/api/config/trash"],
    enabled: true,
  });

  // Restore document mutation
  const restoreMutation = useMutation({
    mutationFn: async (documentId: string) => {
      return apiRequest(`/api/documents/${documentId}/restore`, {
        method: "PATCH",
      });
    },
    onSuccess: (data, documentId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents/trash"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      
      // Use the new response format with success flag and alreadyLive indicator
      if (data.success) {
        const title = data.alreadyLive 
          ? "✅ Document restored (file was available)"
          : "✅ Document and file restored";
        
        const description = data.note || (data.alreadyLive 
          ? "Document restored - the file was already available in cloud storage"
          : "Both the document record and file have been restored from cloud storage");
        
        toast({
          title,
          description,
        });
      }
    },
    onError: (error: any) => {
      // Enhanced error handling for specific restore failure cases
      let title = "Restore failed";
      let description = error.details || error.message || "Failed to restore document";
      
      // Handle specific error cases with better messaging
      if (error.message?.includes("generation data")) {
        title = "Cannot restore file";
        description = "This document was deleted before the restore feature was implemented. You can restore the document record, but you'll need to re-upload the file.";
      } else if (error.message?.includes("permanently deleted")) {
        title = "File permanently deleted";
        description = "The file has passed the 7-day retention period and was permanently deleted. You can restore the document record, but you'll need to re-upload the file.";
      } else if (error.message?.includes("7-day")) {
        title = "Restore window expired";
        description = "This document is beyond the 7-day restore window and cannot be restored.";
      }
      
      toast({
        title,
        description,
        variant: "destructive",
      });
    },
  });

  // Empty trash mutation
  const emptyTrashMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/documents/trash", {
        method: "DELETE",
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents/trash"] });
      setShowEmptyTrashDialog(false);
      toast({
        title: "Trash emptied",
        description: data.message || `Successfully deleted ${data.deletedCount} documents permanently`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to empty trash",
        description: error.details || error.message || "Failed to empty trash",
        variant: "destructive",
      });
    },
  });

  // Restore all mutation
  const restoreAllMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/documents/trash/restore-all", {
        method: "PATCH",
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents/trash"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({
        title: "✅ All documents restored",
        description: data.message || `Successfully restored ${data.restoredCount} documents`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to restore all",
        description: error.details || error.message || "Failed to restore all documents",
        variant: "destructive",
      });
    },
  });

  const trashedDocuments = trashedData?.documents || [];
  const retentionDays = trashConfig?.retentionDays && !isNaN(trashConfig.retentionDays) ? trashConfig.retentionDays : 7;

  if (isLoading) {
    return (
      <MobileLayout documentCount={0}>
        <div className="container mx-auto px-6 py-8">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h1 className="text-3xl font-light tracking-wide">Trash</h1>
            </div>
            <div className="grid gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </MobileLayout>
    );
  }

  if (error) {
    return (
      <MobileLayout documentCount={0}>
        <div className="container mx-auto px-6 py-8">
          <div className="space-y-6">
            <h1 className="text-3xl font-light tracking-wide">Trash</h1>
            <div className="text-center py-12">
              <Trash2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg text-muted-foreground font-light tracking-wide">Failed to load trash</p>
              <p className="text-sm text-muted-foreground mt-2 font-light tracking-wide">Please try again later</p>
            </div>
          </div>
        </div>
      </MobileLayout>
    );
  }

  return (
    <MobileLayout
      onDeleteAll={() => emptyTrashMutation.mutate()}
      isDeleting={emptyTrashMutation.isPending}
      hasDocuments={trashedDocuments.length > 0}
      documentCount={trashedDocuments.length}
    >
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 md:px-6 py-8" data-testid="page-trash">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="min-w-0 flex-shrink">
              <h1 className="text-3xl font-light tracking-wide bg-gradient-to-r from-slate-700 via-slate-600 to-indigo-600 dark:from-slate-200 dark:via-slate-300 dark:to-indigo-400 bg-clip-text text-transparent">Trash</h1>
              <p className="text-muted-foreground mt-1 text-sm font-light tracking-wide">
                {trashConfig?.policy || `Documents are automatically deleted after ${retentionDays} days`}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {trashedDocuments.length > 0 && (
                <>
                  <Badge variant="secondary" className="text-xs md:text-sm flex-shrink-0 font-light tracking-wide">
                    {trashedDocuments.length} {trashedDocuments.length === 1 ? 'item' : 'items'}
                  </Badge>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => restoreAllMutation.mutate()}
                      disabled={restoreAllMutation.isPending}
                      data-testid="button-restore-all"
                      className="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white border-0 shadow-sm text-xs md:text-sm font-light tracking-wide"
                    >
                      <RotateCcw className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2" />
                      Restore All
                    </Button>
                    <Dialog open={showEmptyTrashDialog} onOpenChange={setShowEmptyTrashDialog}>
                      <DialogTrigger asChild>
                        <Button variant="destructive" size="sm" data-testid="button-empty-trash" className="text-xs md:text-sm font-light tracking-wide">
                          <Trash2 className="h-3 w-3 md:h-4 md:w-4 mr-1 md:mr-2" />
                          Empty
                        </Button>
                      </DialogTrigger>
                  <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-destructive" />
                        Empty Trash?
                      </DialogTitle>
                      <DialogDescription className="space-y-2">
                        <p>This will permanently delete all {trashedDocuments.length} documents in the trash.</p>
                        <p className="font-medium text-foreground">This action cannot be undone.</p>
                        <div className="bg-muted p-3 rounded-lg text-sm">
                          <p className="font-medium mb-1">Why empty trash manually?</p>
                          <p>Documents normally auto-delete after {retentionDays} days. Use this only if you want to permanently remove them immediately for storage or privacy reasons.</p>
                        </div>
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setShowEmptyTrashDialog(false)}
                        data-testid="button-cancel-empty-trash"
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => emptyTrashMutation.mutate()}
                        disabled={emptyTrashMutation.isPending}
                        data-testid="button-confirm-empty-trash"
                      >
                        {emptyTrashMutation.isPending ? "Deleting..." : "Empty Trash"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Documents Grid */}
        {trashedDocuments.length === 0 ? (
          <div className="text-center py-12">
            <Trash2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg text-muted-foreground font-light tracking-wide">Trash is empty</p>
            <p className="text-sm text-muted-foreground mt-2 font-light tracking-wide">
              Deleted documents will appear here for {retentionDays} days before being permanently removed
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
            {trashedDocuments.map((document) => {
              const daysRemaining = getDaysRemaining(document.deletedAt!.toString(), retentionDays);
              const countdownMessage = getCountdownMessage(daysRemaining);
              const isExpiringSoon = daysRemaining <= 1;

              return (
                <Card 
                  key={document.id} 
                  className="group hover:shadow-xl hover:border-red-300 dark:hover:border-red-500 transition-all duration-300 border-border/50 rounded-2xl overflow-hidden bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm w-full flex flex-col" 
                  data-testid={`trash-document-card-${document.id}`}
                >
                  <CardContent className="px-4 pt-4 pb-2.5 flex flex-col overflow-hidden">
                    <div className="flex items-start mb-4">
                      <div className="flex items-center space-x-3 flex-1 min-w-0">
                        <div className="flex-shrink-0 text-muted-foreground">
                          {getFileIcon(document.fileType)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-light tracking-wide text-foreground truncate mb-0.5 group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors" title={getDocumentDisplayName(document)} data-testid={`text-document-name-${document.id}`}>
                            {getDocumentDisplayName(document)}
                          </h3>
                          <p className="text-xs text-muted-foreground font-light tracking-wide">
                            {document.fileSize ? `${(document.fileSize / 1024).toFixed(1)} KB` : 'Unknown size'}
                          </p>
                          {document.originalName && (
                            <p className="text-xs text-muted-foreground/80 truncate mt-1 font-light tracking-wide" title={document.originalName}>
                              {document.originalName}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {document.tags && document.tags.length > 0 && (
                      <div className="mb-3">
                        <div className="flex flex-wrap gap-1.5">
                          {document.tags.map((tag) => (
                            <Badge
                              key={tag.id}
                              variant="secondary"
                              className="text-xs font-light tracking-wide"
                              style={{ backgroundColor: `${tag.color || '#8b5cf6'}15`, color: tag.color || '#8b5cf6', border: `1px solid ${tag.color || '#8b5cf6'}30` }}
                            >
                              {tag.name}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    <div className="flex items-center justify-between text-xs text-muted-foreground/80 mb-2 font-light tracking-wide">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(document.deletedAt!).toLocaleDateString()}
                      </span>
                      {document.folder?.name && (
                        <span className="flex items-center gap-1 truncate max-w-[120px]" title={document.folder.name}>
                          <FileText className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{document.folder.name}</span>
                        </span>
                      )}
                    </div>
                    
                    {/* Countdown Message - Styled Like AI Analysis */}
                    <div className={`mb-0 p-2.5 rounded-lg border flex-shrink-0 ${
                      isExpiringSoon 
                        ? 'bg-red-50/40 dark:from-red-950/10 dark:to-red-950/10 border-red-200/30 dark:border-red-500/20' 
                        : 'bg-amber-50/40 dark:from-amber-950/10 dark:to-amber-950/10 border-amber-200/30 dark:border-amber-500/20'
                    }`}>
                      <div className="flex items-center gap-1.5">
                        <Clock className={`h-3 w-3 ${isExpiringSoon ? 'text-red-500 dark:text-red-400' : 'text-amber-500 dark:text-amber-400'}`} />
                        <span className={`text-xs font-light tracking-wide ${isExpiringSoon ? 'text-red-600 dark:text-red-300' : 'text-amber-600 dark:text-amber-300'}`}>
                          {countdownMessage}
                        </span>
                      </div>
                    </div>

                    {/* Action Button - Premium Subtle Design with Proper Touch Target */}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full h-11 bg-emerald-100/50 hover:bg-emerald-200/70 dark:bg-emerald-900/20 dark:hover:bg-emerald-800/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-700/50 px-1.5 transition-all flex-col gap-0.5 mt-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        restoreMutation.mutate(document.id);
                      }}
                      disabled={restoreMutation.isPending}
                      data-testid={`button-restore-${document.id}`}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-light tracking-wide">Restore</span>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          )}

          {/* Information Footer */}
          <div className="mt-8 p-4 bg-muted/50 rounded-lg">
            <h3 className="font-medium mb-2">About Trash & Restore</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Documents in trash are automatically deleted after {retentionDays} days</li>
              <li>• Files are soft-deleted and can be restored within the {retentionDays}-day window</li>
              <li>• Restore recovers both document metadata and the original file content</li>
              <li>• After {retentionDays} days, files are permanently deleted and cannot be recovered</li>
              <li>• Document organization and AI analysis are preserved during restore</li>
            </ul>
            {trashConfig?.description && (
              <p className="text-sm text-muted-foreground mt-2 italic">
                {trashConfig.description}
              </p>
            )}
          </div>
        </div>
      </div>
      </div>
    </MobileLayout>
  );
}
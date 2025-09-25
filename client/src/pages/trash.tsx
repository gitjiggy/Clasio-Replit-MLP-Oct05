import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { DocumentWithFolderAndTags } from "@shared/schema";
import { getDocumentDisplayName } from "@/lib/documentDisplay";
import { 
  MoreVertical,
  Trash2,
  RotateCcw,
  FileText,
  File,
  FileImage,
  FileSpreadsheet,
  Presentation,
  Calendar,
  Clock
} from "lucide-react";

// Calculate days remaining until auto-deletion
function getDaysRemaining(deletedAt: string): number {
  const deletedDate = new Date(deletedAt);
  const now = new Date();
  const diffTime = 7 * 24 * 60 * 60 * 1000 - (now.getTime() - deletedDate.getTime()); // 7 days minus elapsed time
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

export default function Trash() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch trashed documents
  const { data: trashedData, isLoading, error } = useQuery<TrashedDocumentsResponse>({
    queryKey: ["/api/documents/trash"],
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
      toast({
        title: "Document restored",
        description: data.message || "Document has been restored successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Restore failed",
        description: error.details || error.message || "Failed to restore document",
        variant: "destructive",
      });
    },
  });

  const trashedDocuments = trashedData?.documents || [];

  if (isLoading) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold tracking-tight">Trash</h1>
          </div>
          <div className="grid gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="space-y-6">
          <h1 className="text-3xl font-bold tracking-tight">Trash</h1>
          <div className="text-center py-12">
            <Trash2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg text-muted-foreground">Failed to load trash</p>
            <p className="text-sm text-muted-foreground mt-2">Please try again later</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-8" data-testid="page-trash">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Trash</h1>
            <p className="text-muted-foreground mt-1">
              Documents are automatically deleted after 7 days
            </p>
          </div>
          {trashedDocuments.length > 0 && (
            <Badge variant="secondary" className="text-sm">
              {trashedDocuments.length} {trashedDocuments.length === 1 ? 'item' : 'items'}
            </Badge>
          )}
        </div>

        {/* Documents Grid */}
        {trashedDocuments.length === 0 ? (
          <div className="text-center py-12">
            <Trash2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg text-muted-foreground">Trash is empty</p>
            <p className="text-sm text-muted-foreground mt-2">
              Deleted documents will appear here for 7 days before being permanently removed
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {trashedDocuments.map((document) => {
              const daysRemaining = getDaysRemaining(document.deletedAt!);
              const countdownMessage = getCountdownMessage(daysRemaining);
              const isExpiringSoon = daysRemaining <= 1;

              return (
                <Card key={document.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3 flex-1 min-w-0">
                        {/* File Icon */}
                        <div className="text-muted-foreground">
                          {getFileIcon(document.fileType)}
                        </div>

                        {/* Document Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium truncate" data-testid={`text-document-name-${document.id}`}>
                              {getDocumentDisplayName(document)}
                            </h3>
                            {document.folder && (
                              <Badge variant="outline" className="text-xs">
                                {document.folder.name}
                              </Badge>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              Deleted {new Date(document.deletedAt!).toLocaleDateString()}
                            </div>
                            <div className={`flex items-center gap-1 ${isExpiringSoon ? 'text-red-600 dark:text-red-400' : ''}`}>
                              <Clock className="h-3 w-3" />
                              {countdownMessage}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        {/* Restore Button */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => restoreMutation.mutate(document.id)}
                          disabled={restoreMutation.isPending}
                          data-testid={`button-restore-${document.id}`}
                          className="flex items-center gap-1"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Restore
                        </Button>

                        {/* More Actions Menu */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" data-testid={`button-menu-${document.id}`}>
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => restoreMutation.mutate(document.id)}
                              disabled={restoreMutation.isPending}
                              data-testid={`menu-restore-${document.id}`}
                            >
                              <RotateCcw className="mr-2 h-4 w-4" />
                              Restore Document
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Information Footer */}
        <div className="mt-8 p-4 bg-muted/50 rounded-lg">
          <h3 className="font-medium mb-2">About Trash</h3>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• Documents in trash are automatically deleted after 7 days</li>
            <li>• File content is immediately removed to save storage costs</li>
            <li>• Restored documents will need their files re-uploaded</li>
            <li>• Document metadata and organization are preserved during restore</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
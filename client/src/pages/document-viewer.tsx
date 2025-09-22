import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Eye, Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import type { DocumentWithFolderAndTags } from "@shared/schema";

export default function DocumentViewer() {
  const { id } = useParams<{ id: string }>();
  const [isDownloading, setIsDownloading] = useState(false);

  // Fetch document metadata using proper API request pattern
  const { data: doc, isLoading, error } = useQuery<DocumentWithFolderAndTags>({
    queryKey: ['/api/documents', { id }],
    queryFn: async () => {
      const response = await apiRequest('GET', `/api/documents/${id}`);
      return response.json();
    },
    enabled: !!id,
  });

  const handleDownload = async () => {
    if (!doc || !id) return;
    
    // For Google Drive documents, open Drive viewer directly (no download needed)
    if (doc.driveWebViewLink) {
      window.open(doc.driveWebViewLink, '_blank');
      return;
    }
    
    setIsDownloading(true);
    try {
      const response = await apiRequest('GET', `/api/documents/${id}/download`);

      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.style.display = 'none';
      anchor.href = url;
      anchor.download = doc.originalName;
      window.document.body.appendChild(anchor);
      anchor.click();
      window.URL.revokeObjectURL(url);
      window.document.body.removeChild(anchor);
    } catch (error) {
      console.error('Download failed:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleView = async () => {
    if (!doc || !id) return;

    // For Google Drive documents, open Drive viewer directly
    if (doc.driveWebViewLink) {
      window.open(doc.driveWebViewLink, '_blank');
      return;
    }

    // For uploaded documents, fetch and display in new tab
    try {
      const response = await apiRequest('GET', `/api/documents/${id}/download`);

      if (!response.ok) {
        throw new Error('View failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (error) {
      console.error('View failed:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p>Loading document...</p>
        </div>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="h-8 w-8 mx-auto mb-4 text-destructive" />
            <h2 className="text-lg font-semibold mb-2">Document Not Found</h2>
            <p className="text-muted-foreground mb-4">
              The document you're looking for could not be found or you don't have permission to access it.
            </p>
            <Button onClick={() => window.close()}>Close</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8">
        <Card className="w-full max-w-2xl mx-auto">
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="mb-6">
                <h1 className="text-2xl font-bold mb-2" data-testid="document-viewer-title">
                  {doc.name}
                </h1>
                <p className="text-muted-foreground">
                  {doc.originalName} • {doc.fileType.toUpperCase()}
                </p>
              </div>

              <div className="flex gap-4 justify-center">
                <Button 
                  onClick={handleView}
                  className="flex items-center gap-2"
                  data-testid="button-view-document"
                >
                  <Eye className="h-4 w-4" />
                  View Document
                </Button>
                
                <Button 
                  onClick={handleDownload}
                  variant="outline"
                  disabled={isDownloading}
                  className="flex items-center gap-2"
                  data-testid="button-download-document"
                >
                  {isDownloading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {isDownloading ? 'Downloading...' : 'Download'}
                </Button>
              </div>

              {doc.isFromDrive && (
                <p className="text-sm text-muted-foreground mt-4">
                  This document is stored in Google Drive
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
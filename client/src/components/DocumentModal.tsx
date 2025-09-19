import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  FileText,
  Calendar,
  Folder,
  Tag,
  Download,
  ExternalLink,
  Search,
  FileX
} from "lucide-react";
import type { DocumentWithFolderAndTags } from "@shared/schema";

interface DocumentModalProps {
  document: DocumentWithFolderAndTags | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchQuery?: string;
  onDownload?: (document: DocumentWithFolderAndTags) => void;
}

// Component to highlight search terms in text
function HighlightedText({ text, searchQuery }: { text: string; searchQuery?: string }) {
  const highlightedText = useMemo(() => {
    if (!searchQuery || !text || searchQuery.trim().length === 0) {
      return text;
    }

    const regex = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);

    return parts.map((part, index) => 
      regex.test(part) ? 
        <mark key={index} className="bg-yellow-200 dark:bg-yellow-800 px-1 rounded">
          {part}
        </mark> : 
        part
    );
  }, [text, searchQuery]);

  return <span>{highlightedText}</span>;
}

export function DocumentModal({ 
  document, 
  open, 
  onOpenChange, 
  searchQuery,
  onDownload 
}: DocumentModalProps) {
  const [contentExpanded, setContentExpanded] = useState(false);

  if (!document) return null;

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return 'Unknown size';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  const getPreviewContent = () => {
    if (!document.documentContent) {
      return (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <FileX className="h-8 w-8 mr-2" />
          <span>Content not available for preview</span>
        </div>
      );
    }

    const content = document.documentContent;
    const maxLength = 2000;
    const shouldTruncate = content.length > maxLength && !contentExpanded;
    const displayContent = shouldTruncate ? content.substring(0, maxLength) + '...' : content;

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium flex items-center">
            <FileText className="h-4 w-4 mr-2" />
            Document Content
            {searchQuery && (
              <Badge variant="secondary" className="ml-2">
                <Search className="h-3 w-3 mr-1" />
                Searching: "{searchQuery}"
              </Badge>
            )}
          </h4>
          {content.length > maxLength && (
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => setContentExpanded(!contentExpanded)}
              data-testid="toggle-content-expansion"
            >
              {contentExpanded ? 'Show Less' : 'Show More'}
            </Button>
          )}
        </div>
        
        <ScrollArea className="h-64 w-full border rounded-lg p-4 bg-muted/50">
          <div className="text-sm leading-relaxed whitespace-pre-wrap font-mono">
            <HighlightedText text={displayContent} searchQuery={searchQuery} />
          </div>
        </ScrollArea>
        
        <div className="text-xs text-muted-foreground">
          Content length: {content.length.toLocaleString()} characters
          {document.contentExtractedAt && (
            <> • Extracted: {formatDate(document.contentExtractedAt)}</>
          )}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center text-lg">
            <FileText className="h-5 w-5 mr-2" />
            <HighlightedText text={document.name} searchQuery={searchQuery} />
          </DialogTitle>
          <DialogDescription>
            Document details and content preview
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-6">
          <div className="space-y-6">
            {/* Basic Information */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">File Name</div>
                <div className="text-sm font-medium">
                  <HighlightedText text={document.originalName} searchQuery={searchQuery} />
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">File Size</div>
                <div className="text-sm">{formatFileSize(document.fileSize)}</div>
              </div>

              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">File Type</div>
                <Badge variant="outline">{document.fileType}</Badge>
              </div>

              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">Uploaded</div>
                <div className="text-sm flex items-center">
                  <Calendar className="h-4 w-4 mr-1" />
                  {formatDate(document.uploadedAt)}
                </div>
              </div>
            </div>

            <Separator />

            {/* Organization */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Organization</h4>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground flex items-center">
                    <Folder className="h-4 w-4 mr-1" />
                    Folder
                  </div>
                  <div className="text-sm">
                    {document.folder ? (
                      <Badge 
                        variant="secondary" 
                        style={{ backgroundColor: `${document.folder.color}20`, color: document.folder.color }}
                      >
                        {document.folder.name}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">No folder</span>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground flex items-center">
                    <Tag className="h-4 w-4 mr-1" />
                    Tags
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {document.tags.length > 0 ? (
                      document.tags.map((tag) => (
                        <Badge 
                          key={tag.id} 
                          variant="secondary"
                          style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                          data-testid={`tag-${tag.id}`}
                        >
                          {tag.name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">No tags</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* AI Analysis */}
            {(document.aiSummary || document.aiKeyTopics?.length) && (
              <>
                <div className="space-y-4">
                  <h4 className="text-sm font-medium">AI Analysis</h4>
                  
                  {document.aiSummary && (
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">Summary</div>
                      <div className="text-sm p-3 bg-muted/50 rounded-lg">
                        <HighlightedText text={document.aiSummary} searchQuery={searchQuery} />
                      </div>
                    </div>
                  )}

                  {document.aiKeyTopics?.length && (
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">Key Topics</div>
                      <div className="flex flex-wrap gap-1">
                        {document.aiKeyTopics.map((topic, index) => (
                          <Badge key={index} variant="outline" className="text-xs">
                            <HighlightedText text={topic} searchQuery={searchQuery} />
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-4 text-sm">
                    {document.aiDocumentType && (
                      <div>
                        <div className="text-muted-foreground">Document Type</div>
                        <div className="font-medium">{document.aiDocumentType}</div>
                      </div>
                    )}
                    {document.aiSentiment && (
                      <div>
                        <div className="text-muted-foreground">Category</div>
                        <div className="font-medium">{document.aiSentiment}</div>
                      </div>
                    )}
                    {document.aiWordCount && (
                      <div>
                        <div className="text-muted-foreground">Word Count</div>
                        <div className="font-medium">{document.aiWordCount.toLocaleString()}</div>
                      </div>
                    )}
                  </div>
                </div>
                <Separator />
              </>
            )}

            {/* Content Preview */}
            {getPreviewContent()}
          </div>
        </ScrollArea>

        {/* Actions */}
        <div className="flex justify-between items-center pt-4 border-t">
          <div className="flex items-center space-x-2 text-xs text-muted-foreground">
            {document.isFromDrive && (
              <Badge variant="outline" className="text-xs">
                Google Drive
              </Badge>
            )}
            {document.contentExtracted && (
              <Badge variant="secondary" className="text-xs">
                ✓ Content Indexed
              </Badge>
            )}
          </div>
          
          <div className="flex space-x-2">
            {document.driveWebViewLink && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open(document.driveWebViewLink!, '_blank')}
                data-testid="open-in-drive"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open in Drive
              </Button>
            )}
            
            {onDownload && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDownload(document)}
                data-testid="download-document"
              >
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
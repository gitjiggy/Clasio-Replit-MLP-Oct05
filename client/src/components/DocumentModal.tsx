import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { AutocompleteCombobox } from "@/components/ui/autocomplete-combobox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { trackEvent } from "@/lib/analytics";
import {
  FileText,
  Calendar,
  Folder,
  Tag,
  Download,
  ExternalLink,
  Search,
  FileX,
  ChevronUp,
  ChevronDown,
  Edit2,
  Check,
  X
} from "lucide-react";
import type { DocumentWithFolderAndTags, Folder as FolderType, Tag as TagType } from "@shared/schema";
import { getDocumentDisplayName, getDocumentTooltip, type DocumentWithVersionInfo } from "@/lib/documentDisplay";
import { searchCategories, searchDocumentTypes } from "@/lib/documentClassifications";

// Helper function to format confidence percentage
const formatConfidence = (confidence: number | null | undefined): string | null => {
  if (confidence === null || confidence === undefined) return null;
  // Handle both 0-1 float and 0-100 integer formats
  const value = confidence <= 1 ? confidence * 100 : confidence;
  return `${Math.round(value)}%`;
};

interface DocumentModalProps {
  document: DocumentWithVersionInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchQuery?: string;
  onDownload?: (document: DocumentWithVersionInfo) => void;
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
      // Parts at odd indices are the captured groups (matches)
      index % 2 === 1 ? 
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
  // Early return BEFORE any hooks are called to prevent hooks order violations
  if (!document) return null;

  const [contentExpanded, setContentExpanded] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [isEditingClassification, setIsEditingClassification] = useState(false);
  const [editCategory, setEditCategory] = useState<string>("");
  const [editDocumentType, setEditDocumentType] = useState<string>("");
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState<string>("");
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch document content on-demand when modal opens
  const { data: contentData, isLoading: isLoadingContent } = useQuery({
    queryKey: [`/api/documents/${document.id}/content`],
    enabled: open && !document.documentContent, // Only fetch if modal is open and content is not already available
  });
  
  // Fetch folders for classification editing
  const { data: folders = [] } = useQuery<FolderType[]>({
    queryKey: ['/api/folders'],
    enabled: open, // Only fetch when modal is open
  });
  
  // Fetch available tags for tagging
  const { data: availableTags = [] } = useQuery<TagType[]>({
    queryKey: ['/api/tags'],
    enabled: open, // Only fetch when modal is open
  });
  
  // Update classification mutation
  const updateClassificationMutation = useMutation({
    mutationFn: async (data: { category: string; documentType: string }) => {
      const response = await apiRequest(`/api/documents/${document.id}/classification`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return response;
    },
    onSuccess: (data, variables) => {
      // Track custom classification creation
      trackEvent('custom_classification_created', {
        category: variables.category,
        document_type: variables.documentType,
        timestamp: new Date().toISOString(),
        document_id: document.id,
        document_name: document.name,
        was_ai_classified: !!(document.aiCategory || document.aiDocumentType)
      });
      
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/folders'] });
      setIsEditingClassification(false);
      toast({
        title: "Classification Updated",
        description: "Document classification has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed", 
        description: error.message || "Failed to update document classification.",
        variant: "destructive",
      });
    },
  });

  // Create new tag mutation
  const createTagMutation = useMutation({
    mutationFn: async (tagName: string) => {
      const response = await apiRequest('/api/tags', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tagName }),
      });
      return response;
    },
    onSuccess: (newTag) => {
      queryClient.invalidateQueries({ queryKey: ['/api/tags'] });
      // Automatically add the new tag to the document
      addTagToDocumentMutation.mutate(newTag.id);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Create Tag",
        description: error.message || "Failed to create new tag.",
        variant: "destructive",
      });
    },
  });

  // Add tag to document mutation
  const addTagToDocumentMutation = useMutation({
    mutationFn: async (tagId: string) => {
      const response = await apiRequest('/api/document-tags', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: document.id, tagId }),
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tags'] });
      setIsAddingTag(false);
      setNewTagName("");
      toast({
        title: "Tag Added",
        description: "Tag has been added to the document successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Add Tag",
        description: error.message || "Failed to add tag to document.",
        variant: "destructive",
      });
    },
  });

  // Remove tag from document mutation
  const removeTagFromDocumentMutation = useMutation({
    mutationFn: async (tagId: string) => {
      const response = await apiRequest(`/api/document-tags/${document.id}/${tagId}`, {
        method: "DELETE",
      });
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tags'] });
      toast({
        title: "Tag Removed",
        description: "Tag has been removed from the document successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Remove Tag",
        description: error.message || "Failed to remove tag from document.",
        variant: "destructive",
      });
    },
  });

  // Initialize edit values when starting to edit
  useEffect(() => {
    if (isEditingClassification) {
      setEditCategory(document.overrideCategory || document.aiCategory || '');
      setEditDocumentType(document.overrideDocumentType || document.aiDocumentType || '');
    }
  }, [isEditingClassification, document]);

  // Get comprehensive category and document type options for autocomplete
  const categoryOptions = searchCategories("");
  const documentTypeOptions = searchDocumentTypes("", editCategory);

  const handleStartEdit = () => {
    setIsEditingClassification(true);
  };

  const handleCancelEdit = () => {
    setIsEditingClassification(false);
    setEditCategory(document.overrideCategory || document.aiCategory || '');
    setEditDocumentType(document.overrideDocumentType || document.aiDocumentType || '');
  };

  const handleCategoryChange = (newCategory: string) => {
    setEditCategory(newCategory);
    // Clear document type when category changes to force user to select a valid type
    setEditDocumentType('');
  };

  const handleSaveEdit = () => {
    if (editCategory && editDocumentType) {
      updateClassificationMutation.mutate({
        category: editCategory,
        documentType: editDocumentType,
      });
    }
  };

  // Tag management handlers
  const handleAddTag = (tagName: string) => {
    const existingTag = availableTags.find(tag => tag.name.toLowerCase() === tagName.toLowerCase());
    
    if (existingTag) {
      // Check if document already has this tag
      const hasTag = document.tags.some(tag => tag.id === existingTag.id);
      if (hasTag) {
        toast({
          title: "Tag Already Added",
          description: "This document already has this tag.",
          variant: "destructive",
        });
        return;
      }
      // Add existing tag to document
      addTagToDocumentMutation.mutate(existingTag.id);
    } else {
      // Create new tag and add to document
      createTagMutation.mutate(tagName);
    }
  };

  const handleRemoveTag = (tagId: string) => {
    removeTagFromDocumentMutation.mutate(tagId);
  };

  const getTagOptions = () => {
    return availableTags.map(tag => tag.name);
  };

  // Use existing content or fetched content (API returns { content })
  const documentContent = document.documentContent || contentData?.content;

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

  // Find all matches and their positions
  const matches = useMemo(() => {
    if (!documentContent || !searchQuery?.trim()) return [];
    
    const regex = new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const found: { index: number; match: string }[] = [];
    let match;
    
    while ((match = regex.exec(documentContent)) !== null) {
      found.push({ index: match.index, match: match[0] });
      if (regex.lastIndex === match.index) break; // Prevent infinite loop
    }
    
    return found;
  }, [documentContent, searchQuery]);

  // Reset current match index when search changes
  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [searchQuery, documentContent]);

  // Auto-scroll to current match when it changes
  useEffect(() => {
    if (!scrollAreaRef.current || !searchQuery?.trim() || matches.length === 0) return;
    
    const timeout = setTimeout(() => {
      const markElements = scrollAreaRef.current?.querySelectorAll('mark');
      if (markElements && markElements[currentMatchIndex]) {
        markElements[currentMatchIndex].scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest'
        });
      }
    }, 100); // Small delay to ensure DOM is updated
    
    return () => clearTimeout(timeout);
  }, [currentMatchIndex, matches, searchQuery, isLoadingContent]);

  const getPreviewContent = () => {
    if (isLoadingContent) {
      return (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <div className="animate-pulse flex items-center">
            <FileText className="h-8 w-8 mr-2" />
            <span>Loading content...</span>
          </div>
        </div>
      );
    }

    if (!documentContent) {
      return (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <FileX className="h-8 w-8 mr-2" />
          <span>Content not available for preview</span>
        </div>
      );
    }

    const content = documentContent;
    let displayContent = content;
    let showingSnippet = false;
    
    // If there's a search query and matches, show snippet around current match
    if (searchQuery?.trim() && matches.length > 0) {
      const currentMatch = matches[currentMatchIndex] || matches[0];
      if (currentMatch && !contentExpanded) {
        const snippetLength = 500; // Characters to show before/after match
        const start = Math.max(0, currentMatch.index - snippetLength);
        const end = Math.min(content.length, currentMatch.index + currentMatch.match.length + snippetLength);
        
        displayContent = (start > 0 ? '...' : '') + 
                        content.substring(start, end) + 
                        (end < content.length ? '...' : '');
        showingSnippet = true;
      }
    } else if (!contentExpanded) {
      // Fallback to original truncation logic when no search
      const maxLength = 2000;
      if (content.length > maxLength) {
        displayContent = content.substring(0, maxLength) + '...';
        showingSnippet = true;
      }
    }

    const navigateToMatch = (direction: 'prev' | 'next') => {
      if (matches.length === 0) return;
      
      const newIndex = direction === 'next' 
        ? (currentMatchIndex + 1) % matches.length
        : (currentMatchIndex - 1 + matches.length) % matches.length;
        
      setCurrentMatchIndex(newIndex);
    };

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium flex items-center">
            <FileText className="h-4 w-4 mr-2" />
            Document Content
            {searchQuery && matches.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                <Search className="h-3 w-3 mr-1" />
                {matches.length} matches found
              </Badge>
            )}
            {searchQuery && matches.length === 0 && (
              <Badge variant="outline" className="ml-2">
                <Search className="h-3 w-3 mr-1" />
                No matches for "{searchQuery}"
              </Badge>
            )}
          </h4>
          <div className="flex items-center space-x-2">
            {matches.length > 1 && (
              <div className="flex items-center space-x-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigateToMatch('prev')}
                  data-testid="prev-match"
                  className="h-7 w-7 p-0"
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground px-2">
                  {currentMatchIndex + 1}/{matches.length}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigateToMatch('next')}
                  data-testid="next-match"
                  className="h-7 w-7 p-0"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </div>
            )}
            {(showingSnippet || content.length > 2000) && (
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
        </div>
        
        <ScrollArea ref={scrollAreaRef} className="h-64 w-full border rounded-lg p-4 bg-muted/50">
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
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center text-lg" title={getDocumentTooltip(document)} data-testid={`document-name-modal-${document.id}`}>
            <FileText className="h-5 w-5 mr-2" />
            <HighlightedText text={getDocumentDisplayName(document)} searchQuery={searchQuery} />
          </DialogTitle>
          <DialogDescription>
            Document details and content preview
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 pr-6">
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
                  <div className="space-y-2">
                    {/* Existing Tags */}
                    <div className="flex flex-wrap gap-1">
                      {document.tags.length > 0 ? (
                        document.tags.map((tag) => (
                          <Badge 
                            key={tag.id} 
                            variant="secondary"
                            className="flex items-center gap-1"
                            style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
                            data-testid={`tag-${tag.id}`}
                          >
                            <span>{tag.name}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveTag(tag.id);
                              }}
                              disabled={removeTagFromDocumentMutation.isPending}
                              className="hover:bg-black/10 dark:hover:bg-white/10 rounded-full p-0.5 transition-colors disabled:opacity-50"
                              title="Remove tag"
                              data-testid={`remove-tag-${tag.id}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))
                      ) : (
                        <span className="text-sm text-muted-foreground">No tags</span>
                      )}
                    </div>
                    
                    {/* Add Tag Section */}
                    <div className="flex items-center space-x-2">
                      {!isAddingTag ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setIsAddingTag(true)}
                          disabled={createTagMutation.isPending || addTagToDocumentMutation.isPending}
                          className="text-xs h-7"
                          data-testid="add-tag-button"
                        >
                          {(createTagMutation.isPending || addTagToDocumentMutation.isPending) ? 'Adding...' : '+ Add Tag'}
                        </Button>
                      ) : (
                        <div className="flex items-center space-x-2 flex-1">
                          <AutocompleteCombobox
                            value={newTagName}
                            onValueChange={setNewTagName}
                            options={getTagOptions()}
                            placeholder="Select or create tag..."
                            searchPlaceholder="Search tags..."
                            allowCustom={true}
                            className="flex-1 h-7 text-xs"
                            disabled={createTagMutation.isPending || addTagToDocumentMutation.isPending}
                            testId="tag-combobox"
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (newTagName.trim()) {
                                handleAddTag(newTagName.trim());
                              }
                            }}
                            disabled={!newTagName.trim() || createTagMutation.isPending || addTagToDocumentMutation.isPending}
                            className="h-7 px-3 text-xs"
                            data-testid="confirm-add-tag"
                          >
                            {(createTagMutation.isPending || addTagToDocumentMutation.isPending) ? 'Adding...' : 'Add'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setIsAddingTag(false);
                              setNewTagName("");
                            }}
                            disabled={createTagMutation.isPending || addTagToDocumentMutation.isPending}
                            className="h-7 px-2"
                            data-testid="cancel-add-tag"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* AI Analysis */}
            {(document.aiSummary || document.aiKeyTopics?.length || document.aiCategory || document.aiDocumentType) && (
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

                  {/* Classification Section with Edit Functionality */}
                  {(document.aiDocumentType || document.aiCategory) && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-muted-foreground">Classification</div>
                        {!isEditingClassification && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleStartEdit}
                            className="h-7 px-2 text-xs"
                            data-testid="edit-classification"
                          >
                            <Edit2 className="h-3 w-3 mr-1" />
                            Edit
                          </Button>
                        )}
                      </div>

                      {!isEditingClassification ? (
                        /* Display Mode */
                        <div className="space-y-2">
                          {document.aiDocumentType && (
                            <div className="flex items-center justify-between">
                              <span className="text-sm">
                                <span className="text-muted-foreground">Type:</span> {document.overrideDocumentType || document.aiDocumentType}
                                {document.classificationOverridden && document.overrideDocumentType && (
                                  <Badge variant="secondary" className="ml-2 text-xs">Edited</Badge>
                                )}
                              </span>
                              {formatConfidence(document.aiDocumentTypeConfidence) && (
                                <span className="text-xs bg-blue-100 dark:bg-blue-900 px-1.5 py-0.5 rounded font-medium" data-testid={`modal-confidence-type-${document.id}`}>
                                  Classification Confidence: {formatConfidence(document.aiDocumentTypeConfidence)}
                                </span>
                              )}
                            </div>
                          )}
                          {document.aiCategory && (
                            <div className="flex items-center justify-between">
                              <span className="text-sm">
                                <span className="text-muted-foreground">Category:</span> {document.overrideCategory || document.aiCategory}
                                {document.classificationOverridden && document.overrideCategory && (
                                  <Badge variant="secondary" className="ml-2 text-xs">Edited</Badge>
                                )}
                              </span>
                              {formatConfidence(document.aiCategoryConfidence) && (
                                <span className="text-xs bg-blue-100 dark:bg-blue-900 px-1.5 py-0.5 rounded font-medium" data-testid={`modal-confidence-category-${document.id}`}>
                                  Classification Confidence: {formatConfidence(document.aiCategoryConfidence)}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        /* Edit Mode */
                        <div className="space-y-3">
                          <div className="space-y-2">
                            <label className="text-sm text-muted-foreground">Category</label>
                            <AutocompleteCombobox
                              value={editCategory}
                              onValueChange={handleCategoryChange}
                              options={categoryOptions}
                              placeholder="Select or type category..."
                              searchPlaceholder="Search categories..."
                              emptyMessage="No category found."
                              className="h-8"
                              allowCustom={true}
                              testId="category"
                            />
                          </div>
                          
                          <div className="space-y-2">
                            <label className="text-sm text-muted-foreground">Document Type</label>
                            <AutocompleteCombobox
                              value={editDocumentType}
                              onValueChange={setEditDocumentType}
                              options={documentTypeOptions}
                              placeholder="Select or type document type..."
                              searchPlaceholder="Search document types..."
                              emptyMessage="No document type found."
                              className="h-8"
                              allowCustom={true}
                              disabled={!editCategory}
                              testId="document-type"
                            />
                          </div>

                          <div className="flex gap-2 pt-2">
                            <Button
                              size="sm"
                              onClick={handleSaveEdit}
                              disabled={!editCategory || !editDocumentType || updateClassificationMutation.isPending}
                              className="h-7 px-3 text-xs"
                              data-testid="save-classification"
                            >
                              <Check className="h-3 w-3 mr-1" />
                              {updateClassificationMutation.isPending ? 'Saving...' : 'Save'}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleCancelEdit}
                              disabled={updateClassificationMutation.isPending}
                              className="h-7 px-3 text-xs"
                              data-testid="cancel-classification"
                            >
                              <X className="h-3 w-3 mr-1" />
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Word Count */}
                  {document.aiWordCount && (
                    <div className="pt-2">
                      <div className="text-sm text-muted-foreground">Word Count</div>
                      <div className="text-sm font-medium">{document.aiWordCount.toLocaleString()}</div>
                    </div>
                  )}
                </div>
                <Separator />
              </>
            )}

            {/* Content Preview */}
            {getPreviewContent()}
          </div>
        </ScrollArea>

        {/* Actions */}
        <div className="flex justify-between items-center pt-4 border-t flex-shrink-0">
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
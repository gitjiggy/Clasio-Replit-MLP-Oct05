import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ObjectUploader } from "@/components/ObjectUploader";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { UploadResult } from "@uppy/core";
import type { DocumentWithFolderAndTags, DocumentWithVersions, DocumentVersion, Folder, Tag } from "@shared/schema";
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
  Plus
} from "lucide-react";

interface DocumentsResponse {
  documents: DocumentWithFolderAndTags[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export default function Documents() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFileType, setSelectedFileType] = useState("all");
  const [selectedFolderId, setSelectedFolderId] = useState("all");
  const [selectedTagId, setSelectedTagId] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch documents
  const { data: documentsData, isLoading: documentsLoading } = useQuery<DocumentsResponse>({
    queryKey: ['/api/documents', { 
      search: searchQuery, 
      fileType: selectedFileType === "all" ? "" : selectedFileType, 
      folderId: selectedFolderId === "all" ? "" : selectedFolderId, 
      tagId: selectedTagId, 
      page: currentPage 
    }],
  });

  // Fetch folders
  const { data: folders = [] } = useQuery<Folder[]>({
    queryKey: ['/api/folders'],
  });

  // Fetch tags
  const { data: tags = [] } = useQuery<Tag[]>({
    queryKey: ['/api/tags'],
  });

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

  const getUploadParameters = async () => {
    const response = await apiRequest("POST", "/api/documents/upload-url", {});
    const data = await response.json();
    return {
      method: "PUT" as const,
      url: data.uploadURL,
    };
  };

  const handleUploadComplete = (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    const file = result.successful?.[0];
    if (file && file.uploadURL) {
      const fileExtension = file.name?.split('.').pop()?.toLowerCase() || '';
      const fileType = getFileTypeFromExtension(fileExtension);
      
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

  const handleDownload = (document: DocumentWithFolderAndTags) => {
    if (document.filePath) {
      window.open(document.filePath, '_blank');
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
          
          <div className="mt-8">
            <h3 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Folders</h3>
            <ul className="mt-2 space-y-1">
              {folders.map((folder) => (
                <li key={folder.id}>
                  <Button
                    variant="ghost"
                    className="w-full justify-between px-3 py-2 text-sm text-foreground hover:bg-accent"
                    onClick={() => setSelectedFolderId(selectedFolderId === folder.id ? "" : folder.id)}
                    data-testid={`folder-${folder.name.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <div className="flex items-center">
                      <FolderOpen className="mr-3 h-4 w-4 text-yellow-500" />
                      <span>{folder.name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {documentsData?.documents.filter(doc => doc.folderId === folder.id).length || 0}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
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

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Header */}
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <h2 className="text-lg font-semibold text-foreground">All Documents</h2>
              <span className="text-sm text-muted-foreground" data-testid="document-count">
                {documentsData?.pagination.total || 0} documents
              </span>
            </div>
            
            <div className="flex items-center space-x-3">
              {/* Search */}
              <div className="relative">
                <Input
                  type="text"
                  placeholder="Search documents..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-64 pl-10"
                  data-testid="search-input"
                />
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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
              
              {/* Upload Button */}
              <ObjectUploader
                maxNumberOfFiles={5}
                maxFileSize={50 * 1024 * 1024} // 50MB
                onGetUploadParameters={getUploadParameters}
                onComplete={handleUploadComplete}
                buttonClassName="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload
              </ObjectUploader>
            </div>
          </div>
        </header>

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
                  {folders.map((folder) => (
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
          {documentsLoading ? (
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
          ) : documentsData?.documents.length === 0 ? (
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
              {documentsData?.documents.map((document) => (
                <Card key={document.id} className="hover:shadow-lg transition-shadow duration-200" data-testid={`document-card-${document.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center space-x-2 flex-1 min-w-0">
                        {getFileIcon(document.fileType)}
                        <div className="min-w-0">
                          <h3 className="text-sm font-medium text-foreground truncate" title={document.name}>
                            {document.name}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(document.fileSize)}
                          </p>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" className="h-auto p-1">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
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
                    
                    <div className="flex items-center space-x-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => handleDownload(document)}
                        data-testid={`download-${document.id}`}
                      >
                        <Download className="mr-1 h-3 w-3" />
                        Download
                      </Button>
                      <Button size="sm" variant="outline" data-testid={`preview-${document.id}`}>
                        <Eye className="h-3 w-3" />
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
    </div>
  );
}

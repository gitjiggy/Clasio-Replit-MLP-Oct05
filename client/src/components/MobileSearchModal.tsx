import { useState } from "react";
import { X, Search, FileText, Folder, Tag, Brain, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";

interface MobileSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchMode: "simple" | "ai";
  onSearchModeChange: (mode: "simple" | "ai") => void;
  onAISearch: () => void;
  aiSearchLoading?: boolean;
  aiSearchResults?: any;
  selectedFileType?: string;
  onFileTypeChange: (type: string) => void;
  selectedFolderId?: string;
  onFolderChange: (id: string) => void;
  selectedTagId?: string;
  onTagChange: (id: string) => void;
  folders?: Array<{ id: string; name: string }>;
  tags?: Array<{ id: string; name: string }>;
  availableFileTypes?: Array<{ value: string; label: string }>;
}

export function MobileSearchModal({
  isOpen,
  onClose,
  searchQuery,
  onSearchChange,
  searchMode,
  onSearchModeChange,
  onAISearch,
  aiSearchLoading = false,
  aiSearchResults,
  selectedFileType = "all",
  onFileTypeChange,
  selectedFolderId = "all",
  onFolderChange,
  selectedTagId,
  onTagChange,
  folders = [],
  tags = [],
  availableFileTypes = [],
}: MobileSearchModalProps) {
  const [showFilters, setShowFilters] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="lg:hidden fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm">
      {/* Full-screen Search Modal */}
      <div className="absolute inset-0 bg-white dark:bg-gray-900 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-gradient-to-r from-purple-500 to-indigo-500">
          <h2 className="text-lg font-semibold text-white">Search Documents</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-white hover:bg-white/20 rounded-full"
            data-testid="mobile-search-close"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Search Mode Toggle */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-gray-800 dark:to-gray-850 border-2 border-slate-200/60 dark:border-slate-700/60 rounded-xl overflow-hidden h-12 shadow-lg">
              <Button
                variant={searchMode === "simple" ? "default" : "ghost"}
                size="sm"
                className={`rounded-none text-sm font-semibold h-full border-0 gap-2 flex flex-row items-center justify-center flex-1 ${
                  searchMode === "simple"
                    ? "bg-gradient-to-r from-slate-600 to-slate-700 text-white shadow-md"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
                }`}
                onClick={() => onSearchModeChange("simple")}
                data-testid="mobile-search-mode-simple"
              >
                <Search className="h-4 w-4" />
                <span>Simple</span>
              </Button>
              <Button
                variant={searchMode === "ai" ? "default" : "ghost"}
                size="sm"
                className={`rounded-none text-sm font-semibold h-full border-0 gap-2 flex items-center justify-center flex-1 ${
                  searchMode === "ai"
                    ? "bg-gradient-to-r from-purple-500 to-indigo-500 text-white shadow-md"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-700/50"
                }`}
                onClick={() => onSearchModeChange("ai")}
                data-testid="mobile-search-mode-ai"
              >
                <Brain className="h-4 w-4" />
                <span>AI</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Search Input */}
        <div className="p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder={searchMode === "ai" ? "Ask AI anything about your documents..." : "Search documents..."}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchMode === "ai" && searchQuery.trim()) {
                  onAISearch();
                }
              }}
              className="pl-10 pr-4 h-12 text-base bg-white dark:bg-gray-800 border-2 border-slate-200/60 dark:border-slate-700/60 rounded-xl shadow-lg focus:ring-2 focus:ring-purple-500/50"
              data-testid="mobile-search-input"
            />
          </div>

          {/* Search Action Buttons */}
          {searchMode === "ai" ? (
            <Button
              onClick={onAISearch}
              disabled={!searchQuery.trim() || aiSearchLoading}
              className="w-full h-12 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white rounded-xl shadow-lg font-semibold"
              data-testid="mobile-ai-search-button"
            >
              {aiSearchLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Searching...
                </>
              ) : (
                <>
                  <Brain className="h-5 w-5 mr-2" />
                  Search with AI
                </>
              )}
            </Button>
          ) : (
            <Button
              onClick={onClose}
              className="w-full h-12 bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-700 hover:to-slate-800 text-white rounded-xl shadow-lg font-semibold"
              data-testid="mobile-simple-search-button"
            >
              <Search className="h-5 w-5 mr-2" />
              {searchQuery.trim() ? 'Show Results' : 'Close'}
            </Button>
          )}

          {/* Filters Toggle */}
          <Button
            variant="outline"
            onClick={() => setShowFilters(!showFilters)}
            className="w-full h-12 rounded-xl border-2 border-slate-200/60 dark:border-slate-700/60 shadow-lg font-semibold"
            data-testid="mobile-filters-toggle"
          >
            <ChevronDown className={`h-5 w-5 mr-2 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            {showFilters ? 'Hide Filters' : 'Show Filters'}
          </Button>

          {/* Filter Section */}
          {showFilters && (
            <div className="space-y-3 pt-2">
              {/* File Type Filter */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  File Type
                </label>
                <Select value={selectedFileType} onValueChange={onFileTypeChange}>
                  <SelectTrigger className="h-12 rounded-xl border-2 border-slate-200/60 dark:border-slate-700/60" data-testid="mobile-filter-filetype">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {availableFileTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Folder Filter */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                  <Folder className="h-4 w-4" />
                  Folder
                </label>
                <Select value={selectedFolderId} onValueChange={onFolderChange}>
                  <SelectTrigger className="h-12 rounded-xl border-2 border-slate-200/60 dark:border-slate-700/60" data-testid="mobile-filter-folder">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Folders</SelectItem>
                    {folders
                      .filter(folder => folder.isAutoCreated && !folder.parentId && folder.documentCount > 0)
                      .map((folder) => (
                        <SelectItem key={folder.id} value={folder.id}>
                          {folder.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Tag Filter */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                  <Tag className="h-4 w-4" />
                  Tag
                </label>
                <Select 
                  value={selectedTagId || "___all___"} 
                  onValueChange={(value) => onTagChange(value === "___all___" ? "" : value)}
                >
                  <SelectTrigger className="h-12 rounded-xl border-2 border-slate-200/60 dark:border-slate-700/60" data-testid="mobile-filter-tag">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="___all___">All Tags</SelectItem>
                    {tags.map((tag) => (
                      <SelectItem key={tag.id} value={tag.id}>
                        {tag.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        {/* AI Search Results */}
        {searchMode === "ai" && aiSearchResults && (
          <ScrollArea className="flex-1 px-4 pb-4">
            <div className="bg-purple-50 dark:bg-gray-900 border border-purple-200 dark:border-purple-500 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="h-5 w-5 text-purple-500" />
                <h3 className="text-base font-semibold text-purple-900 dark:text-purple-100">AI Results</h3>
                <Badge variant="secondary" className="text-xs">
                  {aiSearchResults.totalResults} found
                </Badge>
              </div>
              <div className="text-sm text-purple-500 dark:text-purple-200 mb-3">
                {aiSearchResults.response.includes('•') ? (
                  <div className="space-y-2">
                    {aiSearchResults.response.split('•').filter((part: string) => part.trim()).map((part: string, index: number) => (
                      <div key={index} className={index === 0 ? 'mb-2' : 'flex items-start gap-2'}>
                        {index === 0 ? (
                          <span className="font-medium">{part.trim()}</span>
                        ) : (
                          <>
                            <span className="text-purple-500 dark:text-purple-400 font-bold mt-0.5 min-w-[1.25rem]">{index}.</span>
                            <span className="flex-1">{part.trim()}</span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
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
          </ScrollArea>
        )}

        {/* Instructions */}
        {!aiSearchResults && (
          <div className="flex-1 flex items-center justify-center p-4">
            <div className="text-center space-y-3 max-w-md">
              <div className="w-16 h-16 mx-auto bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full flex items-center justify-center">
                {searchMode === "ai" ? (
                  <Brain className="h-8 w-8 text-white" />
                ) : (
                  <Search className="h-8 w-8 text-white" />
                )}
              </div>
              <h3 className="text-lg font-semibold">
                {searchMode === "ai" ? "Ask AI Anything" : "Search Your Documents"}
              </h3>
              <p className="text-sm text-muted-foreground">
                {searchMode === "ai"
                  ? "Ask questions about your documents and get intelligent answers powered by AI."
                  : "Type your search query and tap 'Show Results' to see matching documents in your library."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

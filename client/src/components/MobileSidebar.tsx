import { X, FileText, Upload, Star, FolderOpen, Sparkles, Target, Trash2, Clock, Brain, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

interface Folder {
  id: string;
  name: string;
  documentCount?: number;
  isAutoCreated?: boolean;
  parentId?: string | null;
}

interface MobileSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  viewMode: string;
  onViewModeChange: (mode: string) => void;
  selectedFolderId: string;
  onFolderSelect: (id: string) => void;
  folders: Folder[];
  onSmartOrganize?: () => void;
  isOrganizing?: boolean;
  onSmartOrganizationCheck?: () => void;
  isCheckingOrganization?: boolean;
  onFunFactsClick?: () => void;
  onDeleteAll?: () => void;
  isDeleting?: boolean;
  hasDocuments?: boolean;
}

export function MobileSidebar({
  isOpen,
  onClose,
  viewMode,
  onViewModeChange,
  selectedFolderId,
  onFolderSelect,
  folders,
  onSmartOrganize,
  isOrganizing = false,
  onSmartOrganizationCheck,
  isCheckingOrganization = false,
  onFunFactsClick,
  onDeleteAll,
  isDeleting = false,
  hasDocuments = false,
}: MobileSidebarProps) {
  // Get automatic folders only (Smart Organization)
  const automaticFolders = folders.filter(folder => folder.isAutoCreated);
  
  // Build hierarchical structure for automatic folders
  const categoryFolders = automaticFolders.filter(folder => !folder.parentId);
  const subFolders = automaticFolders.filter(folder => folder.parentId);
  
  // Filter to show only folders with documents
  const mainCategories = categoryFolders.filter(category => {
    // Show category if it has documents directly OR has sub-folders with documents
    const hasDirectDocuments = (category.documentCount || 0) > 0;
    const categorySubFolders = subFolders.filter(sub => sub.parentId === category.id && (sub.documentCount || 0) > 0);
    const hasSubFoldersWithDocuments = categorySubFolders.length > 0;
    return hasDirectDocuments || hasSubFoldersWithDocuments;
  });
  
  // Get custom folders (user-created)
  const customFolders = folders.filter(folder => !folder.isAutoCreated);
  const customCategoryFolders = customFolders.filter(folder => !folder.parentId);
  const customSubFolders = customFolders.filter(folder => folder.parentId);
  
  // Filter to show only custom folders with documents
  const customMainCategories = customCategoryFolders.filter(category => {
    const hasDirectDocuments = (category.documentCount || 0) > 0;
    const categorySubFolders = customSubFolders.filter(sub => sub.parentId === category.id && (sub.documentCount || 0) > 0);
    const hasSubFoldersWithDocuments = categorySubFolders.length > 0;
    return hasDirectDocuments || hasSubFoldersWithDocuments;
  });
  
  const selectedFolder = folders.find(f => f.id === selectedFolderId);
  const isMainCategorySelected = selectedFolder?.isAutoCreated && !selectedFolder?.parentId;
  
  // Only show sub-folders with documents
  const selectedCategorySubFolders = folders.filter(
    f => f.parentId === selectedFolderId && f.isAutoCreated && (f.documentCount || 0) > 0
  );

  return (
    <>
      {/* Backdrop */}
      <div 
        className={`lg:hidden fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        data-testid="mobile-sidebar-backdrop"
      />

      {/* Sidebar Drawer */}
      <div className={`lg:hidden fixed top-0 left-0 bottom-0 z-[100] w-80 bg-white dark:bg-gray-900 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-gradient-to-r from-purple-500 to-indigo-500">
          <h2 className="text-lg font-semibold text-white">Menu</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="text-white hover:bg-white/20 rounded-full"
            data-testid="mobile-sidebar-close"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Content */}
        <ScrollArea className="flex-1 p-4">
          {/* Main Navigation */}
          <nav className="space-y-2">
            <Button 
              variant="ghost" 
              className={`w-full justify-start font-light tracking-wide text-base h-12 ${
                viewMode === "all" 
                  ? "bg-blue-100/50 hover:bg-blue-200/70 dark:bg-blue-900/20 dark:hover:bg-blue-800/30 text-blue-600 dark:text-blue-400 border border-blue-200/50 dark:border-blue-700/50"
                  : "text-foreground hover:bg-accent"
              }`}
              onClick={() => {
                onViewModeChange("all");
                onClose();
              }}
              data-testid="mobile-nav-all-documents"
            >
              <FileText className="mr-3 h-5 w-5" />
              All Documents
            </Button>

            <Button 
              variant="ghost" 
              className={`w-full justify-start font-light tracking-wide text-base h-12 ${
                viewMode === "recent" 
                  ? "bg-blue-100/50 hover:bg-blue-200/70 dark:bg-blue-900/20 dark:hover:bg-blue-800/30 text-blue-600 dark:text-blue-400 border border-blue-200/50 dark:border-blue-700/50"
                  : "text-foreground hover:bg-accent"
              }`}
              onClick={() => {
                onViewModeChange("recent");
                onClose();
              }}
              data-testid="mobile-nav-recent-uploads"
            >
              <Upload className="mr-3 h-5 w-5" />
              Recent Uploads
            </Button>

            <Button 
              variant="ghost" 
              className={`w-full justify-start font-light tracking-wide text-base h-12 ${
                viewMode === "favorites" 
                  ? "bg-blue-100/50 hover:bg-blue-200/70 dark:bg-blue-900/20 dark:hover:bg-blue-800/30 text-blue-600 dark:text-blue-400 border border-blue-200/50 dark:border-blue-700/50"
                  : "text-foreground hover:bg-accent"
              }`}
              onClick={() => {
                onViewModeChange("favorites");
                onClose();
              }}
              data-testid="mobile-nav-favorites"
            >
              <Star className="mr-3 h-5 w-5" />
              Favorites
            </Button>
          </nav>

          <Separator className="my-6" />

          {/* Smart Organization Check Card */}
          {onSmartOrganizationCheck && (
            <div className="mb-6">
              <div className="bg-gradient-to-br from-purple-50 via-indigo-50 to-purple-50 dark:from-purple-950/30 dark:via-indigo-950/30 dark:to-purple-950/30 rounded-xl p-4 border-2 border-purple-200/50 dark:border-purple-800/50 shadow-lg">
                <div className="flex items-start gap-3 mb-3">
                  <div className="bg-gradient-to-br from-purple-500 to-indigo-500 p-2 rounded-lg">
                    <Brain className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-sm font-semibold text-purple-900 dark:text-purple-100 mb-1 tracking-wide">
                      Smart Organization Check
                    </h4>
                    <p className="text-xs font-light text-purple-700 dark:text-purple-300 leading-relaxed tracking-wide">
                      Automatically finds and fixes documents with missing data or incomplete AI analysis
                    </p>
                  </div>
                </div>
                <Button
                  onClick={() => {
                    onSmartOrganizationCheck();
                    onClose();
                  }}
                  disabled={isCheckingOrganization}
                  className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-light tracking-wide rounded-lg shadow-md hover:shadow-xl transition-all flex items-center justify-center gap-2"
                  data-testid="smart-organization-check-button"
                >
                  {isCheckingOrganization ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                      Checking...
                    </>
                  ) : (
                    <>
                      Check & Fix
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Smart Organization Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Smart Organization
              </h3>
              {onSmartOrganize && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onSmartOrganize();
                    onClose();
                  }}
                  disabled={isOrganizing}
                  className="h-8 px-2 text-xs"
                  data-testid="mobile-smart-organize-button"
                >
                  <Target className="h-3.5 w-3.5 mr-1" />
                  {isOrganizing ? "Organizing..." : "Organize"}
                </Button>
              )}
            </div>

            {/* Folders */}
            {mainCategories.length > 0 ? (
              <div className="space-y-1">
                {mainCategories.map((category) => {
                  const categorySubFolders = subFolders.filter(
                    sub => sub.parentId === category.id && (sub.documentCount || 0) > 0
                  );
                  const isExpanded = selectedFolderId === category.id;
                  
                  return (
                    <div key={category.id}>
                      {/* Main Category */}
                      <Button
                        variant="ghost"
                        className={`w-full justify-start text-sm font-light h-10 ${
                          selectedFolderId === category.id
                            ? "bg-purple-100/50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400"
                            : ""
                        }`}
                        onClick={() => {
                          onFolderSelect(category.id);
                          // Don't close if it has sub-folders - let user see them
                          if (categorySubFolders.length === 0) {
                            onClose();
                          }
                        }}
                        data-testid={`mobile-folder-${category.id}`}
                      >
                        <FolderOpen className="mr-2 h-4 w-4 text-muted-foreground" />
                        <span className="flex-1 text-left truncate">{category.name}</span>
                        {category.documentCount !== undefined && (
                          <span className="text-xs text-muted-foreground ml-2">
                            {category.documentCount}
                          </span>
                        )}
                      </Button>
                      
                      {/* Sub-folders - shown when category is selected/expanded */}
                      {isExpanded && categorySubFolders.length > 0 && (
                        <div className="ml-4 mt-1 space-y-1">
                          {categorySubFolders.map((subFolder) => (
                            <Button
                              key={subFolder.id}
                              variant="ghost"
                              className={`w-full justify-start text-xs font-light h-9 pl-6 ${
                                selectedFolderId === subFolder.id
                                  ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                                  : "text-muted-foreground"
                              }`}
                              onClick={() => {
                                onFolderSelect(subFolder.id);
                                onClose();
                              }}
                              data-testid={`mobile-subfolder-${subFolder.id}`}
                            >
                              <span className="mr-2">•</span>
                              <span className="flex-1 text-left truncate">{subFolder.name}</span>
                              {subFolder.documentCount !== undefined && (
                                <span className="text-xs ml-2">
                                  {subFolder.documentCount}
                                </span>
                              )}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-lg">
                Upload documents to see smart folders! 📁
              </div>
            )}
          </div>
          
          {/* Custom Folders Section */}
          {customMainCategories.length > 0 && (
            <>
              <Separator className="my-6" />
              
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Custom Folders
                </h3>
                
                <div className="space-y-1">
                  {customMainCategories.map((category) => {
                    const categorySubFolders = customSubFolders.filter(
                      sub => sub.parentId === category.id && (sub.documentCount || 0) > 0
                    );
                    const isExpanded = selectedFolderId === category.id;
                    
                    return (
                      <div key={category.id}>
                        {/* Main Category */}
                        <Button
                          variant="ghost"
                          className={`w-full justify-start text-sm font-light h-10 ${
                            selectedFolderId === category.id
                              ? "bg-blue-100/50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                              : ""
                          }`}
                          onClick={() => {
                            onFolderSelect(category.id);
                            // Don't close if it has sub-folders - let user see them
                            if (categorySubFolders.length === 0) {
                              onClose();
                            }
                          }}
                          data-testid={`mobile-custom-folder-${category.id}`}
                        >
                          <FolderOpen className="mr-2 h-4 w-4 text-muted-foreground" />
                          <span className="flex-1 text-left truncate">{category.name}</span>
                          {category.documentCount !== undefined && (
                            <span className="text-xs text-muted-foreground ml-2">
                              {category.documentCount}
                            </span>
                          )}
                        </Button>
                        
                        {/* Sub-folders - shown when category is selected/expanded */}
                        {isExpanded && categorySubFolders.length > 0 && (
                          <div className="ml-4 mt-1 space-y-1">
                            {categorySubFolders.map((subFolder) => (
                              <Button
                                key={subFolder.id}
                                variant="ghost"
                                className={`w-full justify-start text-xs font-light h-9 pl-6 ${
                                  selectedFolderId === subFolder.id
                                    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                                    : "text-muted-foreground"
                                }`}
                                onClick={() => {
                                  onFolderSelect(subFolder.id);
                                  onClose();
                                }}
                                data-testid={`mobile-custom-subfolder-${subFolder.id}`}
                              >
                                <span className="mr-2">•</span>
                                <span className="flex-1 text-left truncate">{subFolder.name}</span>
                                {subFolder.documentCount !== undefined && (
                                  <span className="text-xs ml-2">
                                    {subFolder.documentCount}
                                  </span>
                                )}
                              </Button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </ScrollArea>

        {/* Delete All Button - Fixed at Bottom */}
        {hasDocuments && onDeleteAll && (
          <div className="p-4 border-t border-border bg-white dark:bg-gray-900">
            <Button
              variant="outline"
              onClick={() => {
                if (!isDeleting && onDeleteAll) {
                  onDeleteAll();
                  onClose();
                }
              }}
              disabled={isDeleting}
              className="w-full h-12 border-2 border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-900/10 hover:bg-rose-100 dark:hover:bg-rose-900/20 text-rose-700 dark:text-rose-400 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="mobile-sidebar-delete-all"
            >
              <Trash2 className="mr-2 h-5 w-5" />
              {isDeleting ? "Deleting..." : "Delete All"}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

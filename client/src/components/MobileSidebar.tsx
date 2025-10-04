import { X, FileText, Upload, Star, FolderOpen, Sparkles, Target, Trash2, Clock } from "lucide-react";
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
                {isMainCategorySelected && selectedCategorySubFolders.length > 0 ? (
                  <>
                    {/* Back Button */}
                    <Button
                      variant="ghost"
                      className="w-full justify-start text-sm font-light h-10"
                      onClick={() => onFolderSelect("all")}
                      data-testid="mobile-folder-back"
                    >
                      <span className="mr-2">←</span>
                      Back to Categories
                    </Button>

                    {/* Sub-folders */}
                    {selectedCategorySubFolders.map((folder) => (
                      <Button
                        key={folder.id}
                        variant="ghost"
                        className="w-full justify-start text-sm font-light pl-8 h-10"
                        onClick={() => {
                          onFolderSelect(folder.id);
                          onClose();
                        }}
                        data-testid={`mobile-folder-${folder.id}`}
                      >
                        <FolderOpen className="mr-2 h-4 w-4 text-muted-foreground" />
                        <span className="flex-1 text-left truncate">{folder.name}</span>
                        {folder.documentCount !== undefined && (
                          <span className="text-xs text-muted-foreground ml-2">
                            {folder.documentCount}
                          </span>
                        )}
                      </Button>
                    ))}
                  </>
                ) : (
                  <>
                    {/* Main Categories */}
                    {mainCategories.map((folder) => (
                      <Button
                        key={folder.id}
                        variant="ghost"
                        className={`w-full justify-start text-sm font-light h-10 ${
                          selectedFolderId === folder.id
                            ? "bg-purple-100/50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400"
                            : ""
                        }`}
                        onClick={() => {
                          onFolderSelect(folder.id);
                          // Don't close if it's a main category (has sub-folders)
                          const subFolders = folders.filter(
                            f => f.parentId === folder.id && f.isAutoCreated
                          );
                          if (subFolders.length === 0) {
                            onClose();
                          }
                        }}
                        data-testid={`mobile-folder-${folder.id}`}
                      >
                        <FolderOpen className="mr-2 h-4 w-4 text-muted-foreground" />
                        <span className="flex-1 text-left truncate">{folder.name}</span>
                        {folder.documentCount !== undefined && (
                          <span className="text-xs text-muted-foreground ml-2">
                            {folder.documentCount}
                          </span>
                        )}
                      </Button>
                    ))}
                  </>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-lg">
                Upload documents to see smart folders! 📁
              </div>
            )}
          </div>
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

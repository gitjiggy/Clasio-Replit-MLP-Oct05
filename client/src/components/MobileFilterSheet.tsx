import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Folder {
  id: string;
  name: string;
  documentCount?: number;
  isAutoCreated?: boolean;
  parentId?: string | null;
}

interface MobileFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  selectedFileType: string;
  onFileTypeChange: (type: string) => void;
  selectedFolderId: string;
  onFolderChange: (id: string) => void;
  folders: Folder[];
  availableFileTypes: Array<{ value: string; label: string }>;
  onClearFilters: () => void;
}

export function MobileFilterSheet({
  isOpen,
  onClose,
  selectedFileType,
  onFileTypeChange,
  selectedFolderId,
  onFolderChange,
  folders,
  availableFileTypes,
  onClearFilters
}: MobileFilterSheetProps) {
  if (!isOpen) return null;

  const hasActiveFilters = selectedFileType !== "all" || selectedFolderId !== "all";

  return (
    <>
      {/* Backdrop */}
      <div className="lg:hidden fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm" onClick={onClose} />
      
      {/* Bottom Sheet */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-[100] bg-white dark:bg-gray-900 rounded-t-3xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Filters</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="rounded-full"
            data-testid="filter-sheet-close"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Content */}
        <ScrollArea className="max-h-[60vh]">
          <div className="p-4 space-y-4">
            {/* File Type Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">File Type</label>
              <Select value={selectedFileType} onValueChange={onFileTypeChange}>
                <SelectTrigger className="w-full h-12 bg-white dark:bg-gray-800 border-border rounded-lg" data-testid="filter-type">
                  <SelectValue placeholder="All Types" />
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
              <label className="text-sm font-medium text-foreground">Folder</label>
              <Select value={selectedFolderId} onValueChange={onFolderChange}>
                <SelectTrigger className="w-full h-12 bg-white dark:bg-gray-800 border-border rounded-lg" data-testid="filter-folder">
                  <SelectValue placeholder="All Folders" />
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
          </div>
        </ScrollArea>

        {/* Footer Actions */}
        <div className="p-4 border-t border-border flex gap-3">
          {hasActiveFilters && (
            <Button
              variant="outline"
              onClick={() => {
                onClearFilters();
                onClose();
              }}
              className="flex-1 h-12"
              data-testid="clear-filters"
            >
              Clear Filters
            </Button>
          )}
          <Button
            onClick={onClose}
            className="flex-1 h-12 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white"
            data-testid="apply-filters"
          >
            Apply
          </Button>
        </div>
      </div>
    </>
  );
}

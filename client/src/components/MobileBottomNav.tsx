import { FileText, Upload, Search } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MobileBottomNavProps {
  onDocumentsClick: () => void;
  onUploadClick: () => void;
  onSearchClick: () => void;
  activeTab?: "documents" | "upload" | "search";
}

export function MobileBottomNav({ 
  onDocumentsClick, 
  onUploadClick, 
  onSearchClick,
  activeTab = "documents"
}: MobileBottomNavProps) {
  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 border-t border-border shadow-2xl">
      <div className="grid grid-cols-3 gap-1 px-2 py-2 pb-[env(safe-area-inset-bottom)]">
        {/* Documents Tab */}
        <Button
          variant="ghost"
          onClick={onDocumentsClick}
          className={`flex flex-col items-center justify-center h-16 gap-1 rounded-xl transition-all ${
            activeTab === "documents"
              ? "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
              : "text-muted-foreground hover:bg-accent"
          }`}
          data-testid="mobile-nav-documents"
        >
          <FileText className="h-6 w-6" />
          <span className="text-[10px] font-light tracking-wide">Documents</span>
        </Button>

        {/* Upload FAB (Center, elevated) */}
        <Button
          onClick={onUploadClick}
          className="flex flex-col items-center justify-center h-16 gap-1 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white rounded-xl shadow-lg hover:shadow-xl transition-all transform hover:scale-105"
          data-testid="mobile-nav-upload"
        >
          <Upload className="h-6 w-6" />
          <span className="text-[10px] font-light tracking-wide">Upload</span>
        </Button>

        {/* Search Tab */}
        <Button
          variant="ghost"
          onClick={onSearchClick}
          className={`flex flex-col items-center justify-center h-16 gap-1 rounded-xl transition-all ${
            activeTab === "search"
              ? "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
              : "text-muted-foreground hover:bg-accent"
          }`}
          data-testid="mobile-nav-search"
        >
          <Search className="h-6 w-6" />
          <span className="text-[10px] font-light tracking-wide">Search</span>
        </Button>
      </div>
    </div>
  );
}

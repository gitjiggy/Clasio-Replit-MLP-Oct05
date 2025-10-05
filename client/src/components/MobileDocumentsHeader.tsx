import { Sparkles, Menu, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MobileDocumentsHeaderProps {
  currentView: "documents" | "drive" | "trash";
  onViewChange: (view: "documents" | "drive" | "trash") => void;
  onFunFactsClick: () => void;
  onMenuClick: () => void;
  documentCount: number;
  isScrolling?: boolean;
  onFilterClick?: () => void;
  hasActiveFilters?: boolean;
}

export function MobileDocumentsHeader({
  currentView,
  onViewChange,
  onFunFactsClick,
  onMenuClick,
  documentCount,
  isScrolling = false,
  onFilterClick,
  hasActiveFilters = false
}: MobileDocumentsHeaderProps) {
  return (
    <div className={`lg:hidden sticky top-0 z-40 bg-white dark:bg-gray-900 border-b border-border shadow-sm transition-all duration-300 ease-in-out overflow-hidden ${
      isScrolling ? 'max-h-0 opacity-0' : 'max-h-[200px] opacity-100'
    }`}>
      {/* Top Row: Logo and Action Icons */}
      <div className="flex items-center justify-between px-4 py-3">
        {/* Hamburger Menu - 25% Bigger */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onMenuClick}
          className="h-11 w-11 p-0"
          data-testid="mobile-menu-button"
        >
          <Menu className="h-6 w-6" />
        </Button>

        {/* Spacer */}
        <div className="flex-1"></div>

        {/* Stats Button with Icon + Text - 25% Bigger */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onFunFactsClick}
          className="h-11 px-3 py-2 text-purple-600 dark:text-purple-400 flex items-center gap-1.5"
          data-testid="mobile-fun-facts-button"
        >
          <Sparkles className="h-6 w-6" />
          <span className="text-sm font-medium tracking-wide">Stats</span>
        </Button>
      </div>

      {/* Segmented Control Row: Filter + My Docs / Drive / Trash */}
      <div className="px-4 pb-3 flex items-center gap-2">
        {/* Filter Button - Only show on documents view */}
        {currentView === "documents" && onFilterClick && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onFilterClick}
            className="h-10 w-10 flex-shrink-0 relative"
            data-testid="mobile-filter-button"
          >
            <Filter className="h-5 w-5 text-foreground" />
            {hasActiveFilters && (
              <div className="absolute top-1 right-1 h-2 w-2 bg-purple-500 rounded-full" />
            )}
          </Button>
        )}
        
        {/* Segmented Control */}
        <div className="flex-1 flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
          <button
            onClick={() => onViewChange("documents")}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-light tracking-wide transition-all ${
              currentView === "documents"
                ? "bg-white dark:bg-gray-700 text-purple-600 dark:text-purple-400 shadow-sm"
                : "text-muted-foreground"
            }`}
            data-testid="mobile-view-documents"
          >
            My Docs
            {currentView === "documents" && (
              <span className="ml-2 text-xs">({documentCount})</span>
            )}
          </button>
          <button
            onClick={() => onViewChange("drive")}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-light tracking-wide transition-all ${
              currentView === "drive"
                ? "bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm"
                : "text-muted-foreground"
            }`}
            data-testid="mobile-view-drive"
          >
            Drive
          </button>
          <button
            onClick={() => onViewChange("trash")}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-light tracking-wide transition-all ${
              currentView === "trash"
                ? "bg-white dark:bg-gray-700 text-slate-600 dark:text-slate-400 shadow-sm"
                : "text-muted-foreground"
            }`}
            data-testid="mobile-view-trash"
          >
            Trash
          </button>
        </div>
      </div>
    </div>
  );
}

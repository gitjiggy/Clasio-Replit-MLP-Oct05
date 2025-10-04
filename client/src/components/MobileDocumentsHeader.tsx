import { Sparkles, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MobileDocumentsHeaderProps {
  currentView: "documents" | "drive" | "trash";
  onViewChange: (view: "documents" | "drive" | "trash") => void;
  onFunFactsClick: () => void;
  onMenuClick: () => void;
  documentCount: number;
}

export function MobileDocumentsHeader({
  currentView,
  onViewChange,
  onFunFactsClick,
  onMenuClick,
  documentCount
}: MobileDocumentsHeaderProps) {
  return (
    <div className="lg:hidden sticky top-0 z-40 bg-white dark:bg-gray-900 border-b border-border shadow-sm">
      {/* Top Row: Logo and Action Icons */}
      <div className="flex items-center justify-between px-4 py-3">
        {/* Hamburger Menu */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onMenuClick}
          className="h-9 w-9 p-0"
          data-testid="mobile-menu-button"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Logo/Title */}
        <div className="flex-1 flex justify-center">
          <img 
            src="/attached_assets/noBgColor (1)_1759471370484.png" 
            alt="Clasio" 
            className="h-8 w-auto"
          />
        </div>

        {/* Fun Facts Sparkles */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onFunFactsClick}
          className="h-9 w-9 p-0 text-purple-600 dark:text-purple-400"
          data-testid="mobile-fun-facts-button"
        >
          <Sparkles className="h-5 w-5" />
        </Button>
      </div>

      {/* Segmented Control Row: My Docs / Drive / Trash */}
      <div className="px-4 pb-3">
        <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
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

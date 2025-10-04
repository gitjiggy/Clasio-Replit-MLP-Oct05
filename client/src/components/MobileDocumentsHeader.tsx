import { Sparkles, Menu, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface MobileDocumentsHeaderProps {
  currentView: "documents" | "drive" | "trash";
  onViewChange: (view: "documents" | "drive" | "trash") => void;
  onFunFactsClick: () => void;
  onMenuClick: () => void;
  onSmartOrganizationClick?: () => void;
  documentCount: number;
  isScrolling?: boolean;
}

export function MobileDocumentsHeader({
  currentView,
  onViewChange,
  onFunFactsClick,
  onMenuClick,
  onSmartOrganizationClick,
  documentCount,
  isScrolling = false
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

        {/* Magic Wand - Smart Organization Check */}
        {onSmartOrganizationClick && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onSmartOrganizationClick}
                  className="h-11 w-11 p-0 text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/20 transition-all hover:scale-110"
                  data-testid="mobile-smart-organization-wand"
                >
                  <Wand2 className="h-6 w-6" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[250px] text-center">
                <p className="text-sm">Automatically finds and fixes documents with missing data or incomplete AI analysis</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

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

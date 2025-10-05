import { useState } from "react";
import { Search, Brain } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NeuralMicIcon } from "@/components/NeuralMicIcon";
import { UserMenu } from "@/components/UserMenu";
import { MobileBottomNav } from "@/components/MobileBottomNav";

interface MobileSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  aiSearchLoading?: boolean;
  aiSearchResults?: any;
  documentCount?: number;
  onDocumentsClick?: () => void;
  onUploadClick?: () => void;
}

export function MobileSearchModal({
  isOpen,
  onClose,
  searchQuery,
  onSearchChange,
  aiSearchLoading = false,
  aiSearchResults,
  documentCount = 0,
  onDocumentsClick,
  onUploadClick,
}: MobileSearchModalProps) {
  const [voiceActive, setVoiceActive] = useState(false);

  if (!isOpen) return null;

  const handleVoiceClick = () => {
    setVoiceActive(true);
    // Voice functionality will be implemented tomorrow
    setTimeout(() => setVoiceActive(false), 2000); // Reset after animation
  };

  return (
    <div className="lg:hidden fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm" onClick={onClose}>
      {/* Full-screen Search Modal */}
      <div className="absolute inset-0 bg-white dark:bg-gray-900 flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Purple Gradient Header with Branding */}
        <header className="border-b bg-gradient-to-r from-slate-600 via-indigo-500 to-purple-500 dark:from-slate-700 dark:via-indigo-600 dark:to-purple-600">
          <div className="flex h-24 items-center justify-between px-4">
            <div className="flex-1 flex items-center justify-center ml-8">
              <img 
                src="/attached_assets/noBgColor (1)_1759471370484.png" 
                alt="Clasio - AI-Powered Document Management" 
                className="h-[76px] w-auto drop-shadow-[0_0_30px_rgba(255,255,255,0.5)]"
              />
            </div>
            
            <div className="flex items-center ml-auto">
              <UserMenu />
            </div>
          </div>
        </header>

        {/* Search Bar */}
        <div className="p-4 border-b border-border/20">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/50" />
            <Input
              type="text"
              placeholder={`Search your ${documentCount} document${documentCount !== 1 ? 's' : ''}...`}
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10 pr-4 h-12 text-base bg-white dark:bg-gray-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500/30 transition-all shadow-sm"
              data-testid="mobile-search-input"
            />
          </div>
        </div>

        {/* AI Search Results or Hero Voice Icon */}
        {aiSearchResults ? (
          <ScrollArea className="flex-1 px-4 pb-24">
            <div className="bg-purple-50 dark:bg-gray-900 border border-purple-200 dark:border-purple-500 rounded-xl p-4 mb-4 mt-4">
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
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 pb-24">
            {/* Hero Voice Icon */}
            <div 
              onClick={handleVoiceClick}
              className="cursor-pointer transform transition-transform hover:scale-105 active:scale-95"
              data-testid="mobile-voice-search-hero"
            >
              <NeuralMicIcon active={voiceActive} className="w-48 h-48" />
            </div>
            
            {/* Instruction Text */}
            <div className="text-center space-y-2 mt-8 max-w-sm">
              <h3 className="text-xl font-light text-slate-800 dark:text-slate-200">
                Voice Search Your Documents
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                Tap the mic to search with your voice, or type in the search bar above
              </p>
            </div>

            {/* Loading State */}
            {aiSearchLoading && (
              <div className="mt-6 flex items-center gap-2 text-purple-500">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-500" />
                <span className="text-sm font-medium">Searching...</span>
              </div>
            )}
          </div>
        )}

        {/* Bottom Navigation */}
        <MobileBottomNav
          onDocumentsClick={() => {
            if (onDocumentsClick) onDocumentsClick();
            onClose();
          }}
          onUploadClick={() => {
            if (onUploadClick) onUploadClick();
          }}
          onSearchClick={() => {}} 
          activeTab="search"
        />
      </div>
    </div>
  );
}

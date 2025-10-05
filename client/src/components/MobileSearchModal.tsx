import { useState, useEffect } from "react";
import { Search, Brain, FileText, Clock, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { NeuralMicIcon } from "@/components/NeuralMicIcon";
import { UserMenu } from "@/components/UserMenu";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { useVoiceSearch } from "@/hooks/use-voice-search";

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
  onDocumentClick?: (doc: any) => void;
}

// Helper functions
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
  
  if (diffInDays === 0) return 'Today';
  if (diffInDays === 1) return 'Yesterday';
  if (diffInDays < 7) return `${diffInDays} days ago`;
  if (diffInDays < 30) return `${Math.floor(diffInDays / 7)} weeks ago`;
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getFileIcon(fileType: string) {
  return <FileText className="h-5 w-5 text-purple-500" />;
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
  onDocumentClick,
}: MobileSearchModalProps) {
  const {
    isListening,
    transcript,
    interimTranscript,
    error: voiceError,
    isSupported,
    startListening,
    stopListening,
    resetTranscript,
  } = useVoiceSearch();

  // Update search query when voice transcript changes
  useEffect(() => {
    if (transcript) {
      onSearchChange(transcript);
    }
  }, [transcript, onSearchChange]);

  // Reset transcript when modal closes
  useEffect(() => {
    if (!isOpen) {
      resetTranscript();
    }
  }, [isOpen, resetTranscript]);

  if (!isOpen) return null;

  const handleVoiceClick = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
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
                <h3 className="text-base font-semibold text-[#1E1E1E] dark:text-slate-100">AI Results</h3>
                <Badge variant="secondary" className="text-xs">
                  {aiSearchResults.totalResults} found
                </Badge>
              </div>
              <div className="text-sm text-[#1E1E1E] dark:text-slate-100 mb-3">
                {aiSearchResults.response.includes('•') ? (
                  <div className="space-y-2">
                    {aiSearchResults.response.split('•').filter((part: string) => part.trim()).map((part: string, index: number) => (
                      <div key={index} className={index === 0 ? 'mb-2' : 'flex items-start gap-2'}>
                        {index === 0 ? (
                          <span className="font-medium">{part.trim()}</span>
                        ) : (
                          <>
                            <span className="text-[#1E1E1E] dark:text-slate-100 font-bold mt-0.5 min-w-[1.25rem]">{index}.</span>
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
                  <span className="text-xs text-[#1E1E1E] dark:text-slate-100">Keywords:</span>
                  {aiSearchResults.keywords.map((keyword: string, index: number) => (
                    <Badge key={index} variant="outline" className="text-xs">
                      {keyword}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Document Cards */}
            {aiSearchResults.documents && aiSearchResults.documents.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Matched Documents</h4>
                {aiSearchResults.documents.map((doc: any) => (
                  <Card 
                    key={doc.id}
                    className="cursor-pointer hover:shadow-lg transition-all border-slate-200 dark:border-slate-700"
                    onClick={() => {
                      if (onDocumentClick) {
                        onDocumentClick(doc);
                      }
                    }}
                    data-testid={`search-result-${doc.id}`}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 mt-0.5">
                          {getFileIcon(doc.fileType)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate mb-1">
                            {doc.name}
                          </h3>
                          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-2">
                            <span>{formatFileSize(doc.fileSize || 0)}</span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDate(doc.uploadedAt)}
                            </span>
                          </div>
                          {doc.aiSummary && (
                            <p className="text-xs text-[#1E1E1E] dark:text-slate-100 line-clamp-2 leading-relaxed">
                              {doc.aiSummary}
                            </p>
                          )}
                          {doc.aiScore !== undefined && (
                            <div className="mt-2 flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                                <div 
                                  className="h-full bg-gradient-to-r from-purple-500 to-indigo-500"
                                  style={{ width: `${Math.min(100, doc.aiScore)}%` }}
                                />
                              </div>
                              <span className="text-xs font-medium text-[#1E1E1E] dark:text-slate-100">
                                {Math.round(doc.aiScore)}%
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 pb-24">
            {/* Hero Voice Icon */}
            <div 
              onClick={handleVoiceClick}
              className={`cursor-pointer transform transition-transform ${
                isSupported ? 'hover:scale-105 active:scale-95' : 'opacity-50 cursor-not-allowed'
              }`}
              data-testid="mobile-voice-search-hero"
            >
              <NeuralMicIcon active={isListening} className="w-48 h-48" />
            </div>
            
            {/* Listening State & Interim Transcript */}
            {isListening && (
              <div className="text-center space-y-2 mt-8 max-w-sm">
                <div className="flex items-center justify-center gap-2 text-[#1E1E1E] dark:text-slate-100">
                  <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" />
                  <span className="text-sm font-medium">Listening...</span>
                </div>
                {interimTranscript && (
                  <p className="text-base text-slate-700 dark:text-slate-300 italic">
                    "{interimTranscript}"
                  </p>
                )}
              </div>
            )}
            
            {/* Instruction Text */}
            {!isListening && !voiceError && (
              <div className="text-center space-y-2 mt-8 max-w-sm">
                <h3 className="text-xl font-light text-slate-800 dark:text-slate-200">
                  Voice Search Your Documents
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                  {isSupported 
                    ? "Tap the mic to search with your voice, or type in the search bar above"
                    : "Voice search is not supported in this browser. Please type your search above."}
                </p>
              </div>
            )}

            {/* Error State */}
            {voiceError && (
              <div className="mt-8 p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-500/30 rounded-lg max-w-sm">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-rose-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-medium text-rose-900 dark:text-rose-100 mb-1">
                      Voice Search Error
                    </h4>
                    <p className="text-xs text-rose-700 dark:text-rose-300">
                      {voiceError}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Loading State */}
            {aiSearchLoading && (
              <div className="mt-6 flex items-center gap-2 text-[#1E1E1E] dark:text-slate-100">
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

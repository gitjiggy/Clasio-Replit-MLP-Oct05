import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { MobileBottomNav } from "./MobileBottomNav";
import { MobileDocumentsHeader } from "./MobileDocumentsHeader";
import { MobileSearchModal } from "./MobileSearchModal";

interface MobileLayoutProps {
  children: React.ReactNode;
  onDeleteAll?: () => void;
  isDeleting?: boolean;
  hasDocuments?: boolean;
  documentCount?: number;
  onQueueDashboardOpen?: () => void;
  uploadButtonRef?: React.RefObject<HTMLDivElement>;
  // Search props
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchMode?: "simple" | "ai";
  onSearchModeChange?: (mode: "simple" | "ai") => void;
  onAISearch?: () => void;
  aiSearchLoading?: boolean;
  aiSearchResults?: any;
  selectedFileType?: string;
  onFileTypeChange?: (type: string) => void;
  selectedFolderId?: string;
  onFolderChange?: (id: string) => void;
  selectedTagId?: string;
  onTagChange?: (id: string) => void;
  folders?: Array<{ id: string; name: string }>;
  tags?: Array<{ id: string; name: string }>;
}

export function MobileLayout({
  children,
  onDeleteAll,
  isDeleting = false,
  hasDocuments = false,
  documentCount = 0,
  onQueueDashboardOpen,
  uploadButtonRef,
  // Search props with defaults
  searchQuery = "",
  onSearchChange = () => {},
  searchMode = "simple",
  onSearchModeChange = () => {},
  onAISearch = () => {},
  aiSearchLoading = false,
  aiSearchResults,
  selectedFileType = "all",
  onFileTypeChange = () => {},
  selectedFolderId = "all",
  onFolderChange = () => {},
  selectedTagId,
  onTagChange = () => {},
  folders = [],
  tags = [],
}: MobileLayoutProps) {
  const [location, setLocation] = useLocation();
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const currentView = location === "/drive" ? "drive" : location === "/trash" ? "trash" : "documents";
  const activeTab = mobileSearchOpen ? "search" : "documents";

  return (
    <>
      {/* Mobile Documents Header - Only visible on mobile */}
      <MobileDocumentsHeader
        currentView={currentView}
        onViewChange={(view) => {
          const routes = { documents: "/documents", drive: "/drive", trash: "/trash" };
          setLocation(routes[view]);
        }}
        onFunFactsClick={() => {
          if (onQueueDashboardOpen) {
            onQueueDashboardOpen();
          }
        }}
        onMenuClick={() => {
          // TODO: Implement mobile sidebar (Task 7)
          console.log('Mobile sidebar not yet implemented');
        }}
        onDeleteAllClick={() => {
          if (onDeleteAll) {
            onDeleteAll();
          }
        }}
        documentCount={documentCount}
      />

      {/* Page Content */}
      {children}

      {/* Mobile Search Modal - Only visible on mobile */}
      <MobileSearchModal
        isOpen={mobileSearchOpen}
        onClose={() => setMobileSearchOpen(false)}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        searchMode={searchMode}
        onSearchModeChange={onSearchModeChange}
        onAISearch={onAISearch}
        aiSearchLoading={aiSearchLoading}
        aiSearchResults={aiSearchResults}
        selectedFileType={selectedFileType}
        onFileTypeChange={onFileTypeChange}
        selectedFolderId={selectedFolderId}
        onFolderChange={onFolderChange}
        selectedTagId={selectedTagId}
        onTagChange={onTagChange}
        folders={folders}
        tags={tags}
      />

      {/* Mobile Bottom Navigation - Only visible on mobile */}
      <MobileBottomNav
        onDocumentsClick={() => {
          if (location !== "/documents") {
            setLocation("/documents");
          }
          setMobileSearchOpen(false);
        }}
        onUploadClick={() => {
          // Trigger upload button click
          if (uploadButtonRef?.current) {
            const button = uploadButtonRef.current.querySelector('button');
            if (button) button.click();
          }
        }}
        onSearchClick={() => setMobileSearchOpen(true)}
        activeTab={activeTab}
      />
    </>
  );
}

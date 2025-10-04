import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { MobileBottomNav } from "./MobileBottomNav";
import { MobileDocumentsHeader } from "./MobileDocumentsHeader";
import { MobileSearchModal } from "./MobileSearchModal";
import { MobileSidebar } from "./MobileSidebar";
import { ObjectUploader } from "./ObjectUploader";
import { Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

interface Folder {
  id: string;
  name: string;
  documentCount?: number;
  isAutoCreated?: boolean;
  parentId?: string | null;
}

interface MobileLayoutProps {
  children: React.ReactNode;
  onDeleteAll?: () => void;
  isDeleting?: boolean;
  hasDocuments?: boolean;
  documentCount?: number;
  onQueueDashboardOpen?: () => void;
  uploadButtonRef?: React.RefObject<HTMLDivElement>;
  // Upload callbacks
  onUploadSuccess?: (docIds: string[]) => void;
  onViewExistingDocument?: (documentId: string) => void;
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
  folders?: Folder[];
  tags?: Array<{ id: string; name: string }>;
  availableFileTypes?: Array<{ value: string; label: string }>;
  // Sidebar props
  viewMode?: string;
  onViewModeChange?: (mode: string) => void;
  onSmartOrganize?: () => void;
  isOrganizing?: boolean;
  onSmartOrganizationCheck?: () => void;
  isCheckingOrganization?: boolean;
  // Scroll-to-hide
  isScrolling?: boolean;
}

export function MobileLayout({
  children,
  onDeleteAll,
  isDeleting = false,
  hasDocuments = false,
  documentCount = 0,
  onQueueDashboardOpen,
  uploadButtonRef,
  onUploadSuccess,
  onViewExistingDocument,
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
  availableFileTypes = [],
  // Sidebar props with defaults
  viewMode = "all",
  onViewModeChange = () => {},
  onSmartOrganize,
  isOrganizing = false,
  onSmartOrganizationCheck,
  isCheckingOrganization = false,
  // Scroll-to-hide
  isScrolling = false,
}: MobileLayoutProps) {
  const [location, setLocation] = useLocation();
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const currentView = location === "/drive" ? "drive" : location === "/trash" ? "trash" : "documents";
  const activeTab = mobileSearchOpen ? "search" : "documents";
  
  // Default upload success handler for tabs that don't provide their own
  const defaultUploadSuccess = (docIds: string[]) => {
    queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
    queryClient.invalidateQueries({ queryKey: ['/api/folders'] });
    queryClient.invalidateQueries({ queryKey: ['/api/queue/status'] });
    toast({
      title: "Upload successful",
      description: `${docIds.length} document${docIds.length > 1 ? 's' : ''} uploaded successfully.`,
    });
  };
  
  // Default view existing document handler (does nothing for Drive/Trash)
  const defaultViewExistingDocument = () => {
    // No-op for tabs without this functionality
  };
  
  const handleUploadSuccess = onUploadSuccess || defaultUploadSuccess;
  const handleViewExistingDocument = onViewExistingDocument || defaultViewExistingDocument;

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
        onMenuClick={() => setMobileSidebarOpen(true)}
        onSmartOrganizationClick={onSmartOrganizationCheck}
        documentCount={documentCount}
        isScrolling={isScrolling}
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
        availableFileTypes={availableFileTypes}
      />

      {/* Mobile Sidebar - Only visible on mobile */}
      <MobileSidebar
        isOpen={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        selectedFolderId={selectedFolderId}
        onFolderSelect={onFolderChange}
        folders={folders}
        onSmartOrganize={onSmartOrganize}
        isOrganizing={isOrganizing}
        onFunFactsClick={onQueueDashboardOpen}
        onDeleteAll={onDeleteAll}
        isDeleting={isDeleting}
        hasDocuments={hasDocuments}
      />

      {/* Mobile Upload Button - Hidden but functional, triggered by bottom nav, works across all tabs */}
      <div ref={uploadButtonRef} className="lg:hidden">
        <ObjectUploader
          maxNumberOfFiles={5}
          maxFileSize={50 * 1024 * 1024}
          onSuccess={handleUploadSuccess}
          onViewExistingDocument={handleViewExistingDocument}
          buttonClassName="hidden"
        >
          <Upload className="h-5 w-5" />
          <span>Upload</span>
        </ObjectUploader>
      </div>

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

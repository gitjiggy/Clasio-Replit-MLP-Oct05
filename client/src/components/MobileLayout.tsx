import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { MobileBottomNav } from "./MobileBottomNav";
import { MobileDocumentsHeader } from "./MobileDocumentsHeader";

interface MobileLayoutProps {
  children: React.ReactNode;
  onDeleteAll?: () => void;
  isDeleting?: boolean;
  hasDocuments?: boolean;
  documentCount?: number;
  onQueueDashboardOpen?: () => void;
  uploadButtonRef?: React.RefObject<HTMLDivElement>;
}

export function MobileLayout({
  children,
  onDeleteAll,
  isDeleting = false,
  hasDocuments = false,
  documentCount = 0,
  onQueueDashboardOpen,
  uploadButtonRef
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

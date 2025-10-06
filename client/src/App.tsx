import { Switch, Route, Link, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { LoginModal } from "@/components/LoginModal";
import { UserMenu } from "@/components/UserMenu";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Landing from "@/pages/landing";
import Privacy from "@/pages/privacy";
import Legal from "@/pages/legal";
import Proof from "@/pages/proof";
import Documents from "@/pages/documents";
import Trash from "@/pages/trash";
import Drive from "@/pages/drive";
import AuthDrive from "@/pages/auth-drive";
import DocumentViewer from "@/pages/document-viewer";
import Analytics from "@/pages/analytics";
import NotFound from "@/pages/not-found";
import { useState, useEffect } from "react";
import { initGA } from "./lib/analytics";
import { useAnalytics } from "./hooks/use-analytics";
import { FileText, HardDrive, Trash2 } from "lucide-react";

interface AppHeaderProps {
  onSignInClick: () => void;
}

function AppHeader({ onSignInClick }: AppHeaderProps) {
  const { user, initializing } = useAuth();
  
  return (
    <header className="border-b bg-gradient-to-r from-slate-600 via-indigo-500 to-purple-500 dark:from-slate-700 dark:via-indigo-600 dark:to-purple-600 sticky top-0 z-50">
      <div className="container flex h-24 md:h-28 items-center justify-between px-4">
        <div className="flex-1 flex items-center justify-center md:justify-start ml-8 md:ml-0">
          <img 
            src="/attached_assets/noBgColor (1)_1759471370484.png" 
            alt="Clasio - AI-Powered Document Management" 
            className="h-[76px] md:h-24 w-auto drop-shadow-[0_0_30px_rgba(255,255,255,0.5)]"
          />
        </div>
        
        {!initializing && (
          <div className="flex items-center gap-4 ml-auto">
            {user ? (
              <UserMenu />
            ) : (
              <>
                <div className="text-sm text-muted-foreground hidden md:block">
                  Sign in to access your documents
                </div>
                <Button onClick={onSignInClick} size="sm" data-testid="button-header-signin">
                  Sign In
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

function Navigation() {
  const [location] = useLocation();
  let currentTab = "documents";
  if (location === "/drive") currentTab = "drive";
  else if (location === "/trash") currentTab = "trash";
  
  return (
    <div className="hidden lg:block border-b bg-gradient-to-r from-slate-50 via-white to-slate-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 shadow-sm">
      <div className="container mx-auto px-6 py-3">
        <Tabs value={currentTab} className="w-full">
          <TabsList className="grid w-full max-w-[700px] grid-cols-3 bg-transparent gap-3 p-0 h-auto">
            <TabsTrigger 
              value="documents" 
              asChild
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-500 data-[state=active]:to-indigo-500 data-[state=active]:text-white data-[state=active]:shadow-md font-light tracking-wide rounded-lg transition-all hover:scale-[1.02] text-base md:text-lg"
            >
              <Link href="/documents" className="flex items-center gap-3 px-6 py-3" data-testid="tab-documents">
                <FileText className="h-5 w-5" />
                <span className="hidden sm:inline">Documents</span>
                <span className="sm:hidden">Docs</span>
              </Link>
            </TabsTrigger>
            <TabsTrigger 
              value="drive" 
              asChild
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-cyan-500 data-[state=active]:text-white data-[state=active]:shadow-md font-light tracking-wide rounded-lg transition-all hover:scale-[1.02] text-base md:text-lg"
            >
              <Link href="/drive" className="flex items-center gap-3 px-6 py-3" data-testid="tab-drive">
                <HardDrive className="h-5 w-5" />
                <span className="hidden sm:inline">Google Drive</span>
                <span className="sm:hidden">Drive</span>
              </Link>
            </TabsTrigger>
            <TabsTrigger 
              value="trash" 
              asChild
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-slate-600 data-[state=active]:to-slate-700 data-[state=active]:text-white data-[state=active]:shadow-md font-light tracking-wide rounded-lg transition-all hover:scale-[1.02] text-base md:text-lg"
            >
              <Link href="/trash" className="flex items-center gap-3 px-6 py-3" data-testid="tab-trash">
                <Trash2 className="h-5 w-5" />
                Trash
              </Link>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}

function Router() {
  // Track page views when routes change
  useAnalytics();
  
  return (
    <>
      <Navigation />
      <Switch>
        <Route path="/documents" component={Documents} />
        <Route path="/trash" component={Trash} />
        <Route path="/drive" component={Drive} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/viewer/:id" component={DocumentViewer} />
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

function AuthenticatedApp() {
  const { user, initializing } = useAuth();
  const [location, setLocation] = useLocation();

  // Redirect authenticated users from landing to documents
  useEffect(() => {
    if (user && location === "/") {
      setLocation("/documents");
    }
  }, [user, location, setLocation]);

  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-sm text-muted-foreground">Loading Clasio...</p>
        </div>
      </div>
    );
  }

  // Public routes accessible to all
  if (location === "/privacy") return <Privacy />;
  if (location === "/legal") return <Legal />;
  if (location === "/proof") return <Proof />;

  // Show landing page for non-authenticated users
  if (!user) {
    return <Landing />;
  }

  // Show authenticated app for logged-in users
  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader onSignInClick={() => {}} />
      <main className="flex-1">
        <Router />
      </main>
    </div>
  );
}

function App() {
  // Initialize Google Analytics on mount
  useEffect(() => {
    if (!import.meta.env.VITE_GA_MEASUREMENT_ID) {
      console.warn('Missing required Google Analytics key: VITE_GA_MEASUREMENT_ID');
    } else {
      initGA();
    }
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <AuthProvider>
            <Switch>
              <Route path="/auth/drive" component={AuthDrive} />
              <Route path="/*" component={AuthenticatedApp} />
            </Switch>
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;

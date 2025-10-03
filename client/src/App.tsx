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
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="container flex h-20 items-center justify-between px-4">
        <div className="flex-1 flex items-center justify-center md:justify-start">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-purple-300/20 to-pink-300/10 blur-2xl transform scale-110"></div>
            <img 
              src="/attached_assets/noBgColor (1)_1759471370484.png" 
              alt="Clasio - AI-Powered Document Management" 
              className="relative h-12 md:h-14 w-auto drop-shadow-[0_0_40px_rgba(255,255,255,0.3)]"
              style={{
                filter: 'drop-shadow(0 0 30px rgba(167, 139, 250, 0.4))'
              }}
            />
          </div>
        </div>
        
        {!initializing && (
          <div className="flex items-center gap-4">
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
    <div className="border-b bg-gradient-to-r from-slate-50 via-white to-slate-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 shadow-sm">
      <div className="container mx-auto px-6 py-2">
        <Tabs value={currentTab} className="w-full">
          <TabsList className="grid w-full max-w-[600px] grid-cols-3 bg-transparent gap-2 p-0 h-auto">
            <TabsTrigger 
              value="documents" 
              asChild
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-500 data-[state=active]:to-indigo-500 data-[state=active]:text-white data-[state=active]:shadow-md font-semibold rounded-lg transition-all hover:scale-[1.02]"
            >
              <Link href="/documents" className="flex items-center gap-2 px-4 py-2" data-testid="tab-documents">
                <FileText className="h-4 w-4" />
                <span className="hidden sm:inline">Documents</span>
                <span className="sm:hidden">Docs</span>
              </Link>
            </TabsTrigger>
            <TabsTrigger 
              value="drive" 
              asChild
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-cyan-500 data-[state=active]:text-white data-[state=active]:shadow-md font-semibold rounded-lg transition-all hover:scale-[1.02]"
            >
              <Link href="/drive" className="flex items-center gap-2 px-4 py-2" data-testid="tab-drive">
                <HardDrive className="h-4 w-4" />
                <span className="hidden sm:inline">Google Drive</span>
                <span className="sm:hidden">Drive</span>
              </Link>
            </TabsTrigger>
            <TabsTrigger 
              value="trash" 
              asChild
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-slate-600 data-[state=active]:to-slate-700 data-[state=active]:text-white data-[state=active]:shadow-md font-semibold rounded-lg transition-all hover:scale-[1.02]"
            >
              <Link href="/trash" className="flex items-center gap-2 px-4 py-2" data-testid="tab-trash">
                <Trash2 className="h-4 w-4" />
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
  );
}

export default App;

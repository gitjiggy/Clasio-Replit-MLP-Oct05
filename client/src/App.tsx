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
import Documents from "@/pages/documents";
import Drive from "@/pages/drive";
import AuthDrive from "@/pages/auth-drive";
import NotFound from "@/pages/not-found";
import { useState, useEffect } from "react";
import { initGA } from "./lib/analytics";
import { useAnalytics } from "./hooks/use-analytics";
import { FileText, HardDrive } from "lucide-react";

interface AppHeaderProps {
  onSignInClick: () => void;
}

function AppHeader({ onSignInClick }: AppHeaderProps) {
  const { user, loading } = useAuth();
  
  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold">DocuFlow</h1>
          <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-1 rounded">
            AI-Powered
          </span>
        </div>
        
        {!loading && (
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
  const currentTab = location === "/drive" ? "drive" : "documents";
  
  return (
    <div className="border-b bg-background">
      <div className="container mx-auto px-6">
        <Tabs value={currentTab} className="w-full">
          <TabsList className="grid w-full max-w-[400px] grid-cols-2">
            <TabsTrigger value="documents" asChild>
              <Link href="/documents" className="flex items-center gap-2" data-testid="tab-documents">
                <FileText className="h-4 w-4" />
                Documents
              </Link>
            </TabsTrigger>
            <TabsTrigger value="drive" asChild>
              <Link href="/drive" className="flex items-center gap-2" data-testid="tab-drive">
                <HardDrive className="h-4 w-4" />
                Google Drive
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
        <Route path="/" component={Documents} />
        <Route path="/documents" component={Documents} />
        <Route path="/drive" component={Drive} />
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

function AuthenticatedApp() {
  const { user, loading } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);

  useEffect(() => {
    // Show login modal if user is not authenticated after loading completes
    if (!loading && !user) {
      setShowLoginModal(true);
    }
  }, [user, loading]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-sm text-muted-foreground">Loading DocuFlow...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader onSignInClick={() => setShowLoginModal(true)} />
      <main className="flex-1">
        {user ? (
          <Router />
        ) : (
          <div className="container mx-auto py-8 text-center">
            <h2 className="text-2xl font-bold mb-4">Welcome to DocuFlow</h2>
            <p className="text-muted-foreground mb-6">
              Your AI-powered document management system. Sign in to get started.
            </p>
          </div>
        )}
      </main>
      
      <LoginModal open={showLoginModal} onOpenChange={setShowLoginModal} />
    </div>
  );
}

function App() {
  // Initialize Google Analytics when app loads
  useEffect(() => {
    // Verify required environment variable is present
    if (!import.meta.env.VITE_GA_MEASUREMENT_ID) {
      console.warn('Missing required Google Analytics key: VITE_GA_MEASUREMENT_ID');
    } else {
      initGA();
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Switch>
            <Route path="/auth/drive" component={AuthDrive} />
            <Route path="/*" component={AuthenticatedApp} />
          </Switch>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;

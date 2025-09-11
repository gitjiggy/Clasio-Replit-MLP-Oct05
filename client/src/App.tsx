import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { LoginModal } from "@/components/LoginModal";
import { UserMenu } from "@/components/UserMenu";
import Documents from "@/pages/documents";
import NotFound from "@/pages/not-found";
import { useState, useEffect } from "react";

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
          <Switch>
            <Route path="/" component={Documents} />
            <Route component={NotFound} />
          </Switch>
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
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <AuthenticatedApp />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;

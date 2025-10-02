import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Shield, FileText, Brain } from "lucide-react";
import { persistenceReady } from "@/lib/firebase";
import { trackEvent } from "@/lib/analytics";
import { useToast } from "@/hooks/use-toast";
import { signInWithPopup, signInWithRedirect } from "firebase/auth";
import { auth, basicGoogleProvider } from "@/lib/firebase";

interface LoginModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LoginModal({ open, onOpenChange }: LoginModalProps) {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isPersistenceReady, setIsPersistenceReady] = useState(false);
  const { toast } = useToast();

  // Wait for persistence to be ready before allowing sign-in
  useEffect(() => {
    persistenceReady.then(() => {
      setIsPersistenceReady(true);
    });
  }, []);

  const handleGoogleSignIn = async () => {
    console.log("🔘 Button clicked - starting Google sign-in");
    setIsSigningIn(true);
    
    // In dev, use popup only (no redirect fallback)
    // In production, use redirect
    const isDev = import.meta.env.DEV;
    
    try {
      // Wait for persistence to be ready
      await persistenceReady;
      console.log("✅ Persistence ready");
      
      if (isDev) {
        // DEV: Popup only (better debugging, immediate feedback)
        console.log("🚀 DEV MODE: Using popup sign-in...");
        try {
          const result = await signInWithPopup(auth, basicGoogleProvider);
          console.log("✅ Popup sign-in successful:", result.user.email);
          
          toast({
            title: "Signed in successfully",
            description: `Welcome, ${result.user.displayName || result.user.email}!`
          });
          
          trackEvent("auth_signin_success", { 
            method: "google_popup",
            user_id: result.user.uid
          });
          
          onOpenChange(false);
          setIsSigningIn(false);
        } catch (popupError: any) {
          console.error("❌ Popup sign-in failed:", popupError);
          console.error("Full error details:", {
            name: popupError?.name,
            code: popupError?.code,
            message: popupError?.message,
            customData: popupError?.customData
          });
          
          // In dev, show detailed error
          toast({
            title: "Popup sign-in failed",
            description: popupError?.message || "Please allow popups for this site, or check console for details.",
            variant: "destructive"
          });
          
          trackEvent("auth_signin_error", { 
            method: "google_popup",
            error: popupError?.code || "unknown"
          });
          
          setIsSigningIn(false);
        }
      } else {
        // PRODUCTION: Redirect (more reliable across devices)
        console.log("🚀 PRODUCTION MODE: Using redirect sign-in...");
        await signInWithRedirect(auth, basicGoogleProvider);
        // This line won't execute as page will redirect
      }
    } catch (error) {
      console.error("❌ Sign-in failed:", error);
      console.error("Error details:", {
        code: (error as any)?.code,
        message: (error as any)?.message,
        stack: (error as any)?.stack
      });
      
      toast({
        title: "Sign-in failed",
        description: (error as any)?.message || "Failed to sign in. Please try again.",
        variant: "destructive"
      });
      
      trackEvent("auth_signin_error", { 
        method: "google_auth",
        error: (error as any)?.code || "unknown"
      });
      
      setIsSigningIn(false);
    }
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center text-2xl font-semibold bg-gradient-to-r from-slate-700 via-indigo-600 to-purple-600 bg-clip-text text-transparent">
            Welcome to Clasio
          </DialogTitle>
          <DialogDescription className="text-center text-base pt-1">
            Your smart, secure home for documents.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Features showcase */}
          <div className="grid gap-3">
            <div className="flex items-start gap-3 p-4 bg-gradient-to-br from-slate-50 to-indigo-50 dark:from-slate-900/50 dark:to-indigo-900/20 rounded-lg border border-slate-200/50 dark:border-slate-700/50">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-slate-500 to-indigo-500 flex items-center justify-center">
                <FileText className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">Document Management</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Upload, organize, and stay in control.</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3 p-4 bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-lg border border-indigo-200/50 dark:border-indigo-700/50">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
                <Brain className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">AI Analysis</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Instant insights and smarter summaries.</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3 p-4 bg-gradient-to-br from-purple-50 to-violet-50 dark:from-purple-900/20 dark:to-violet-900/20 rounded-lg border border-purple-200/50 dark:border-purple-700/50">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-violet-500 flex items-center justify-center">
                <Shield className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">Secure Access</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Protected with Google authentication.</p>
              </div>
            </div>
          </div>

          {/* Sign in buttons */}
          <div className="space-y-2">
            <Button
              onClick={handleGoogleSignIn}
              disabled={isSigningIn}
              className="w-full"
              size="lg"
              data-testid="button-google-signin"
            >
              {isSigningIn ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285f4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34a853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#fbbc05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#ea4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Continue with Google
                </>
              )}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            By signing in, you agree to our Terms of Service and Privacy Policy
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Shield, FileText, Brain, ExternalLink } from "lucide-react";
import { signInWithGoogle, PopupBlockedError } from "@/lib/firebase";
import { trackEvent } from "@/lib/analytics";
import { useToast } from "@/hooks/use-toast";
import { signInWithRedirect } from "firebase/auth";
import { auth, basicGoogleProvider } from "@/lib/firebase";

interface LoginModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LoginModal({ open, onOpenChange }: LoginModalProps) {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const { toast } = useToast();

  const handleGoogleSignIn = async () => {
    // CRITICAL: Call signInWithGoogle() immediately with no awaits before it
    // This ensures popup opens in direct response to user click
    setIsSigningIn(true);
    
    try {
      await signInWithGoogle();
      // Success - auth state observer will handle the rest
      trackEvent('login_success', { method: 'google_popup' });
    } catch (error: any) {
      // Handle popup blocked - redirect fallback in progress
      if (error instanceof PopupBlockedError) {
        toast({
          title: "Redirecting to sign-in",
          description: "Your browser blocked the popup. Redirecting to full-page sign-in...",
        });
        trackEvent('login_fallback_redirect', { method: 'google_popup_blocked' });
        // Keep loading state - redirect will happen
        return;
      }
      
      // Handle user cancelled popup
      if (error?.code === "auth/popup-closed-by-user") {
        console.warn("Sign-in cancelled by user");
        toast({
          title: "Sign-in cancelled",
          description: "You closed the popup. Try again or use full-page sign-in below.",
          variant: "destructive"
        });
        trackEvent('login_cancelled', { method: 'google_popup' });
      } else if (error?.code === "auth/popup-blocked") {
        // Shouldn't reach here, but handle just in case
        console.error("Popup blocked:", error);
        toast({
          title: "Popup blocked",
          description: "Your browser blocked the popup. Try using full-page sign-in below.",
          variant: "destructive"
        });
        trackEvent('login_failed', { method: 'google_popup', reason: 'popup_blocked' });
      } else {
        // Other errors
        console.error("Sign-in error:", error);
        trackEvent('login_failed', { method: 'google_popup', error_message: error?.message });
      }
      
      setIsSigningIn(false);
    }
  };

  const handleFullPageSignIn = async () => {
    // CRITICAL: Call signInWithRedirect() immediately with no awaits before it
    setIsSigningIn(true);
    
    try {
      await signInWithRedirect(auth, basicGoogleProvider);
      // Keep loading state - redirect will happen
      trackEvent('login_redirect_initiated', { method: 'google_redirect_manual' });
    } catch (error) {
      console.error("Redirect sign-in error:", error);
      toast({
        title: "Sign-in error",
        description: "Failed to redirect to sign-in. Please try again.",
        variant: "destructive"
      });
      trackEvent('login_failed', { method: 'google_redirect_manual', error_message: String(error) });
      setIsSigningIn(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center">Welcome to Clasio</DialogTitle>
          <DialogDescription className="text-center">
            Sign in to access your document management system with AI-powered features
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Features showcase */}
          <div className="grid gap-3">
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <FileText className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium">Document Management</p>
                <p className="text-xs text-muted-foreground">Upload, organize, and version control</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <Brain className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium">AI Analysis</p>
                <p className="text-xs text-muted-foreground">Smart summaries and content insights</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <Shield className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium">Secure Access</p>
                <p className="text-xs text-muted-foreground">Protected by Google authentication</p>
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

            <Button
              onClick={handleFullPageSignIn}
              disabled={isSigningIn}
              variant="outline"
              className="w-full"
              size="lg"
              data-testid="button-google-redirect"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Use full-page sign-in
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
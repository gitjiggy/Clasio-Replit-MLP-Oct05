import { useEffect, useState } from 'react';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

export default function AuthDrive() {
  const [status, setStatus] = useState<'preparing' | 'authenticating' | 'success' | 'error'>('preparing');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    console.log('[DRIVE AUTH] AuthDrive component mounted');
    console.log('[DRIVE AUTH] Current URL:', window.location.href);
    console.log('[DRIVE AUTH] Window opener exists:', !!window.opener);
    
    // Auto-start authentication process
    startAuthentication();
  }, []);

  const startAuthentication = async () => {
    try {
      console.log('[DRIVE AUTH] Starting Google Drive authentication...');
      setStatus('authenticating');
      setError('');

      // Configure Google Auth Provider with Drive scopes
      const provider = new GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/drive.readonly');
      provider.addScope('https://www.googleapis.com/auth/drive.file');
      
      // Force account selection to ensure proper scope consent
      provider.setCustomParameters({
        prompt: 'consent',
        access_type: 'offline'
      });

      console.log('[DRIVE AUTH] Configured provider with Drive scopes');

      // Sign in with popup
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      
      if (!credential) {
        throw new Error('No credential received from Google');
      }

      console.log('[DRIVE AUTH] Authentication successful');
      console.log('[DRIVE AUTH] User:', result.user.email);
      console.log('[DRIVE AUTH] Has access token:', !!credential.accessToken);

      setStatus('success');

      // Send success message to parent window
      if (window.opener) {
        console.log('[DRIVE AUTH] Sending success message to parent');
        window.opener.postMessage({
          type: 'DRIVE_AUTH_SUCCESS',
          user: {
            uid: result.user.uid,
            email: result.user.email,
            displayName: result.user.displayName
          },
          accessToken: credential.accessToken,
          idToken: credential.idToken,
          authenticated: true
        }, '*');
      }

      // Auto-close after 2 seconds
      setTimeout(() => {
        if (window.opener) {
          window.close();
        }
      }, 2000);

    } catch (error: any) {
      console.error('[DRIVE AUTH] Authentication failed:', error);
      
      let errorMessage = 'Authentication failed. Please try again.';
      
      if (error.code === 'auth/popup-closed-by-user') {
        errorMessage = 'Authentication was cancelled. Please try again.';
      } else if (error.code === 'auth/popup-blocked') {
        errorMessage = 'Popup was blocked. Please allow popups and try again.';
      } else if (error.code === 'auth/unauthorized-domain') {
        errorMessage = 'This domain is not authorized for Google authentication.';
      } else if (error.message) {
        errorMessage = error.message;
      }

      setError(errorMessage);
      setStatus('error');

      // Send error message to parent window
      if (window.opener) {
        window.opener.postMessage({
          type: 'DRIVE_AUTH_ERROR',
          error: errorMessage,
          authenticated: false
        }, '*');
      }
    }
  };

  const retryAuthentication = () => {
    console.log('[DRIVE AUTH] Retrying authentication...');
    startAuthentication();
  };

  const closeWindow = () => {
    console.log('[DRIVE AUTH] Closing window...');
    if (window.opener) {
      window.close();
    } else {
      // Fallback: redirect to drive page
      window.location.href = '/drive';
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">Google Drive Authorization</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {status === 'preparing' && (
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">Setting up Google Drive connection...</p>
            </div>
          )}
          
          {status === 'authenticating' && (
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">
                Connecting to Google Drive...
              </p>
              <p className="text-sm text-muted-foreground">
                You'll be redirected to Google to grant access to your Drive files.
              </p>
            </div>
          )}
          
          {status === 'success' && (
            <div className="text-center">
              <CheckCircle className="h-8 w-8 text-green-600 mx-auto mb-4" />
              <h3 className="font-semibold mb-2">Drive Connected Successfully!</h3>
              <p className="text-muted-foreground mb-4">
                Google Drive access has been granted. You can now sync your documents.
              </p>
              <p className="text-sm text-muted-foreground">
                This window will close automatically...
              </p>
              <Button onClick={closeWindow} className="w-full mt-2" data-testid="button-close">
                Close Window
              </Button>
            </div>
          )}
          
          {status === 'error' && (
            <div className="text-center">
              <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-4" />
              <h3 className="font-semibold mb-2 text-destructive">Authentication Failed</h3>
              <p className="text-muted-foreground mb-4 text-sm">
                {error}
              </p>
              <div className="space-y-2">
                <Button onClick={retryAuthentication} className="w-full" data-testid="button-retry">
                  Try Again
                </Button>
                <Button onClick={closeWindow} variant="outline" className="w-full" data-testid="button-close">
                  Close
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
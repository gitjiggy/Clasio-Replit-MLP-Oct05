import { useEffect, useState } from 'react';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth, storeGoogleAccessToken } from '@/lib/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

// Drive Provider for new tab authentication
const driveGoogleProvider = new GoogleAuthProvider();
driveGoogleProvider.addScope('https://www.googleapis.com/auth/drive.readonly');
driveGoogleProvider.addScope('https://www.googleapis.com/auth/drive.file');
driveGoogleProvider.setCustomParameters({
  'prompt': 'consent',
  'include_granted_scopes': 'true',
  'access_type': 'offline'
});

export default function AuthDrive() {
  const [status, setStatus] = useState<'preparing' | 'authenticating' | 'success' | 'error'>('preparing');
  const [error, setError] = useState<string>('');
  const [isFirstAttempt, setIsFirstAttempt] = useState(true);

  const handleDriveAuth = async () => {
    setStatus('authenticating');
    setError('');
    
    try {
      
      const result = await signInWithPopup(auth, driveGoogleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const googleAccessToken = credential?.accessToken;
      
      
      if (googleAccessToken) {
        // Store the token with timestamp
        storeGoogleAccessToken(googleAccessToken);
        
        // Send token back to parent window if opened as popup
        if (window.opener) {
          window.opener.postMessage({
            type: 'DRIVE_AUTH_SUCCESS',
            token: googleAccessToken,
            user: {
              email: result.user.email,
              displayName: result.user.displayName
            }
          }, '*');
        }
        
        setStatus('success');
      } else {
        throw new Error('No access token received from Google');
      }
      
    } catch (error: any) {
      console.error('Drive auth failed:', error);
      setStatus('error');
      setIsFirstAttempt(false); // Mark that we've had a failure
      
      // Provide user-friendly error messages
      let userFriendlyError = 'Authentication was cancelled or failed';
      if (error.code === 'auth/popup-closed-by-user') {
        userFriendlyError = 'Authorization was cancelled. Please try again to connect Google Drive.';
      } else if (error.code === 'auth/popup-blocked') {
        userFriendlyError = 'Popup was blocked. Please allow popups and try again.';
      } else if (error.message?.includes('cancelled')) {
        userFriendlyError = 'Authorization was cancelled. Please try again to connect Google Drive.';
      }
      
      setError(userFriendlyError);
      
      // Send error back to parent window
      if (window.opener) {
        window.opener.postMessage({
          type: 'DRIVE_AUTH_ERROR',
          error: userFriendlyError
        }, '*');
      }
    }
  };

  useEffect(() => {
    // Small delay to show preparing state briefly, then auto-start authentication
    const timer = setTimeout(() => {
      handleDriveAuth();
    }, 500);
    
    return () => clearTimeout(timer);
  }, []);

  const closeWindow = () => {
    if (window.opener) {
      window.close();
    } else {
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
              {isFirstAttempt ? (
                <>
                  <p className="text-muted-foreground mb-4">
                    Please complete the Google authorization in the popup window to connect your Drive.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    You'll be asked to grant permission to access your Google Drive files.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-muted-foreground mb-4">
                    Attempting to reconnect to Google Drive...
                  </p>
                  <p className="text-sm text-muted-foreground">
                    If no popup appeared, click the button below to try again.
                  </p>
                  <Button 
                    onClick={handleDriveAuth} 
                    className="mt-4"
                    data-testid="button-retry-auth"
                  >
                    Retry Authorization
                  </Button>
                </>
              )}
            </div>
          )}
          
          {status === 'success' && (
            <div className="text-center">
              <CheckCircle className="h-8 w-8 text-green-600 mx-auto mb-4" />
              <h3 className="font-semibold mb-2">Drive Connected Successfully!</h3>
              <p className="text-muted-foreground mb-4">
                Google Drive access has been granted. You can now sync your documents.
              </p>
              <Button onClick={closeWindow} className="w-full" data-testid="button-close">
                {window.opener ? 'Close Window' : 'Go to Drive'}
              </Button>
            </div>
          )}
          
          {status === 'error' && (
            <div className="text-center">
              <AlertCircle className="h-8 w-8 text-orange-500 mx-auto mb-4" />
              <h3 className="font-semibold mb-2">Connection Interrupted</h3>
              <p className="text-sm text-muted-foreground mb-4">{error}</p>
              <div className="space-y-2">
                <Button onClick={handleDriveAuth} variant="outline" className="w-full" data-testid="button-try-again">
                  Try Again
                </Button>
                <Button onClick={closeWindow} variant="ghost" className="w-full" data-testid="button-close-window">
                  {window.opener ? 'Close Window' : 'Go Back'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
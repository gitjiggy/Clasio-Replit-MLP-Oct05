import { useEffect, useState } from 'react';
import { signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

// Drive Provider for new tab authentication (using existing Firebase config)
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

  const handleDriveAuth = async () => {
    console.log('[DEBUG] Starting Firebase Google Drive authentication...');
    console.log('[DEBUG] Auth object:', auth);
    console.log('[DEBUG] Provider:', driveGoogleProvider);
    console.log('[DEBUG] Current domain:', window.location.hostname);
    
    setStatus('authenticating');
    setError('');
    
    try {
      console.log('[DEBUG] Attempting Firebase signInWithPopup...');
      
      // Use Firebase authentication with Drive scopes
      const result = await signInWithPopup(auth, driveGoogleProvider);
      console.log('[DEBUG] Firebase signInWithPopup successful:', result);
      
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const googleAccessToken = credential?.accessToken;
      console.log('[DEBUG] Access token received:', !!googleAccessToken);
      
      if (!googleAccessToken) {
        throw new Error('No access token received from Google');
      }
      
      console.log('[DEBUG] Sending token to server...');
      
      // Send token to server to set httpOnly cookie
      const response = await fetch('/api/drive/oauth-callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'Authorization': `Bearer ${await auth.currentUser?.getIdToken()}`
        },
        credentials: 'include',
        body: JSON.stringify({ accessToken: googleAccessToken })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('[DEBUG] Server response error:', errorData);
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const responseData = await response.json();
      console.log('[DEBUG] Server response:', responseData);
      
      if (!responseData.success) {
        throw new Error('Failed to store authentication');
      }
      
      setStatus('success');
      
      // Send success message back to parent window
      if (window.opener) {
        window.opener.postMessage({
          type: 'DRIVE_AUTH_SUCCESS',
          authenticated: true,
          user: {
            email: result.user.email,
            displayName: result.user.displayName
          }
        }, '*');
      }
      
    } catch (error: any) {
      console.error('[DEBUG] Drive auth failed - Full error:', error);
      console.error('[DEBUG] Error code:', error.code);
      console.error('[DEBUG] Error message:', error.message);
      console.error('[DEBUG] Error stack:', error.stack);
      
      setStatus('error');
      
      // Provide detailed error messages
      let userFriendlyError = 'Authentication failed';
      if (error.code === 'auth/popup-closed-by-user') {
        userFriendlyError = 'Authorization was cancelled. Please try again to connect Google Drive.';
      } else if (error.code === 'auth/popup-blocked') {
        userFriendlyError = 'Popup was blocked. Please allow popups and try again.';
      } else if (error.code === 'auth/unauthorized-domain') {
        userFriendlyError = 'This domain is not authorized for Google authentication. Please contact support.';
      } else if (error.message?.includes('cancelled')) {
        userFriendlyError = 'Authorization was cancelled. Please try again to connect Google Drive.';
      } else if (error.message?.includes('domain')) {
        userFriendlyError = 'Domain authorization issue. Please contact support.';
      } else {
        userFriendlyError = `Authentication failed: ${error.message}`;
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
    console.log('[DEBUG] AuthDrive component mounted');
    
    // Check for any redirect results from Firebase
    const checkRedirectResult = async () => {
      try {
        console.log('[DEBUG] Checking for Firebase redirect result...');
        const result = await getRedirectResult(auth);
        if (result) {
          console.log('[DEBUG] Firebase redirect result found:', result);
          // Handle the redirect result same as popup result
          const credential = GoogleAuthProvider.credentialFromResult(result);
          const googleAccessToken = credential?.accessToken;
          
          if (googleAccessToken) {
            // Process the token (same logic as in handleDriveAuth)
            setStatus('authenticating');
            
            const response = await fetch('/api/drive/oauth-callback', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'Authorization': `Bearer ${await auth.currentUser?.getIdToken()}`
              },
              credentials: 'include',
              body: JSON.stringify({ accessToken: googleAccessToken })
            });

            if (response.ok) {
              setStatus('success');
              if (window.opener) {
                window.opener.postMessage({
                  type: 'DRIVE_AUTH_SUCCESS',
                  authenticated: true
                }, '*');
              }
            } else {
              throw new Error('Failed to store authentication');
            }
          }
          return;
        }
      } catch (error) {
        console.error('[DEBUG] Firebase redirect error:', error);
        setStatus('error');
        setError('Authentication failed');
        return;
      }
      
      // No redirect result, start normal authentication flow
      console.log('[DEBUG] No redirect result, starting auth flow...');
      const timer = setTimeout(() => {
        handleDriveAuth();
      }, 500);
      
      return () => clearTimeout(timer);
    };

    checkRedirectResult();
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
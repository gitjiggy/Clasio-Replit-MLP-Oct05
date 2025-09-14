import { useEffect, useState } from 'react';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '@/lib/firebase';
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
  const [status, setStatus] = useState<'idle' | 'authenticating' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string>('');

  const handleDriveAuth = async () => {
    setStatus('authenticating');
    setError('');
    
    try {
      console.log('=== NEW TAB: Drive consent flow ===');
      console.log('Running in top-level window:', window.top === window.self);
      
      const result = await signInWithPopup(auth, driveGoogleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const googleAccessToken = credential?.accessToken;
      
      console.log('✅ Drive consent successful');
      console.log('✅ Access token received:', !!googleAccessToken);
      
      if (googleAccessToken) {
        // Store the token
        localStorage.setItem('google_access_token', googleAccessToken);
        
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
        throw new Error('No access token received');
      }
      
    } catch (error: any) {
      console.error('❌ Drive auth failed:', error);
      setStatus('error');
      setError(error.message || 'Authentication failed');
      
      // Send error back to parent window
      if (window.opener) {
        window.opener.postMessage({
          type: 'DRIVE_AUTH_ERROR',
          error: error.message
        }, '*');
      }
    }
  };

  useEffect(() => {
    // Auto-start authentication when page loads
    handleDriveAuth();
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
          {status === 'idle' && (
            <div className="text-center">
              <p className="text-muted-foreground mb-4">Preparing Drive authorization...</p>
            </div>
          )}
          
          {status === 'authenticating' && (
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">
                Please complete the Google authorization in the popup window...
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
            </div>
          )}
          
          {status === 'success' && (
            <div className="text-center">
              <CheckCircle className="h-8 w-8 text-green-600 mx-auto mb-4" />
              <h3 className="font-semibold mb-2">Authorization Successful!</h3>
              <p className="text-muted-foreground mb-4">
                Google Drive access has been granted successfully.
              </p>
              <Button onClick={closeWindow} className="w-full" data-testid="button-close">
                {window.opener ? 'Close Window' : 'Go to Drive'}
              </Button>
            </div>
          )}
          
          {status === 'error' && (
            <div className="text-center">
              <AlertCircle className="h-8 w-8 text-red-600 mx-auto mb-4" />
              <h3 className="font-semibold mb-2">Authorization Failed</h3>
              <p className="text-sm text-muted-foreground mb-4">{error}</p>
              <div className="space-y-2">
                <Button onClick={handleDriveAuth} variant="outline" className="w-full">
                  Try Again
                </Button>
                <Button onClick={closeWindow} variant="ghost" className="w-full">
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
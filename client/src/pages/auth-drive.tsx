import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

// Direct Google OAuth configuration
const GOOGLE_OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_CLIENT_ID = '132633576574-a7vcobrs9m4mhpb0bh8rlgnbhc1jn9le.apps.googleusercontent.com';
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file'
].join(' ');

export default function AuthDrive() {
  const [status, setStatus] = useState<'preparing' | 'authenticating' | 'success' | 'error'>('preparing');
  const [error, setError] = useState<string>('');

  const handleDriveAuth = () => {
    console.log('[DEBUG] Starting Google Drive authentication...');
    console.log('[DEBUG] Current domain:', window.location.hostname);
    console.log('[DEBUG] Redirect URI:', window.location.origin + '/auth/drive');
    
    setStatus('authenticating');
    setError('');
    
    try {
      // Create OAuth URL parameters
      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: window.location.origin + '/auth/drive',
        scope: SCOPES,
        response_type: 'code',
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state: 'drive-auth'  // Security parameter
      });

      const authUrl = `${GOOGLE_OAUTH_URL}?${params.toString()}`;
      console.log('[DEBUG] Redirecting to OAuth URL:', authUrl);
      
      // Redirect to Google OAuth
      window.location.href = authUrl;
      
    } catch (error: any) {
      console.error('[DEBUG] OAuth redirect failed:', error);
      setStatus('error');
      setError('Failed to start authentication');
      
      if (window.opener) {
        window.opener.postMessage({
          type: 'DRIVE_AUTH_ERROR',
          error: 'Failed to start authentication'
        }, '*');
      }
    }
  };

  const handleAuthCode = async (code: string) => {
    console.log('[DEBUG] Processing authorization code...');
    setStatus('authenticating');
    
    try {
      // Send the authorization code to our backend
      const response = await fetch('/api/drive/oauth-callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        credentials: 'include',
        body: JSON.stringify({ 
          code,
          redirectUri: window.location.origin + '/auth/drive'
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const responseData = await response.json();
      
      if (!responseData.success) {
        throw new Error('Failed to store authentication');
      }
      
      setStatus('success');
      
      // Send success message back to parent window
      if (window.opener) {
        window.opener.postMessage({
          type: 'DRIVE_AUTH_SUCCESS',
          authenticated: true
        }, '*');
      }
      
    } catch (error: any) {
      console.error('[DEBUG] Failed to process auth code:', error);
      setStatus('error');
      setError('Failed to complete authentication');
      
      if (window.opener) {
        window.opener.postMessage({
          type: 'DRIVE_AUTH_ERROR',
          error: 'Failed to complete authentication'
        }, '*');
      }
    }
  };

  useEffect(() => {
    console.log('[DEBUG] AuthDrive component mounted');
    
    // Check for authorization code in URL (OAuth callback)
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const error = urlParams.get('error');
    
    console.log('[DEBUG] URL params:', { code: !!code, state, error });
    
    if (error) {
      console.error('[DEBUG] OAuth error:', error);
      setStatus('error');
      setError('Authorization was denied or failed');
      if (window.opener) {
        window.opener.postMessage({
          type: 'DRIVE_AUTH_ERROR',
          error: 'Authorization was denied or failed'
        }, '*');
      }
      return;
    }
    
    if (code && state === 'drive-auth') {
      console.log('[DEBUG] Authorization code found, processing...');
      handleAuthCode(code);
      return;
    }
    
    // No code, start authentication flow
    console.log('[DEBUG] No authorization code, starting auth flow...');
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
// Firebase configuration and authentication setup
// Based on blueprint:firebase_barebones_javascript

import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, signOut, User, setPersistence, browserLocalPersistence } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebasestorage.app`,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Initialize Firebase (only if not already initialized)
let app;
try {
  app = initializeApp(firebaseConfig);
} catch (error: any) {
  if (error.code === 'app/duplicate-app') {
    // Firebase has already been initialized, which is fine
    app = initializeApp(firebaseConfig, 'secondary');
  } else {
    throw error;
  }
}

// Initialize Auth
export const auth = getAuth(app);

// Set persistence BEFORE any sign-in/redirect (critical for redirect flows)
setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error("Failed to set auth persistence:", error);
});

// Basic Google Auth Provider for initial Firebase login (NO Drive scopes)
const basicGoogleProvider = new GoogleAuthProvider();
basicGoogleProvider.setCustomParameters({
  'prompt': 'select_account'  // Always show account selector
});

// Separate Drive Provider for incremental consent (redirect-only)
const driveGoogleProvider = new GoogleAuthProvider();
driveGoogleProvider.addScope('https://www.googleapis.com/auth/drive.readonly');
driveGoogleProvider.addScope('https://www.googleapis.com/auth/drive.file');
driveGoogleProvider.setCustomParameters({
  'prompt': 'consent'  // Force consent screen for Drive scopes
});

// Basic Firebase authentication (NO Drive scopes) - Using redirect for better reliability
export const signInWithGoogle = async () => {
  try {
    // Use redirect instead of popup for better reliability across all browsers/devices
    await signInWithRedirect(auth, basicGoogleProvider);
    // Note: This function will redirect away from the page
    // The result will be handled by handleAuthRedirect() on return
  } catch (error: any) {
    console.error("Basic authentication failed:", error);
    throw new Error("Authentication failed: " + error.message);
  }
};

// NEW TAB WORKAROUND: Drive consent flow - Opens in new tab to avoid iframe issues
// Now returns boolean success instead of token (token is stored in httpOnly cookie)
export const connectGoogleDrive = async (): Promise<boolean> => {
  
  return new Promise((resolve, reject) => {
    // Open auth page in new tab/window with cache busting
    const authWindow = window.open(
      `/api/auth/drive-redirect?t=${Date.now()}`, 
      'driveAuth', 
      'width=500,height=600,scrollbars=yes,resizable=yes'
    );
    
    if (!authWindow) {
      console.error("Popup blocked");
      reject(new Error("Popup was blocked. Please allow popups and try again."));
      return;
    }
    
    // Listen for messages from the auth window
    const messageListener = (event: MessageEvent) => {
      // Verify origin for security
      if (event.origin !== window.location.origin) {
        return;
      }
      
      if (event.data.success === true) {
        console.log('[Drive Auth] ✅ Authentication successful from OAuth callback:', event.data);
        
        // Clean up
        window.removeEventListener('message', messageListener);
        authWindow.close();
        
        resolve(true);
        
      } else if (event.data.success === false) {
        console.error('[Drive Auth] ❌ Authentication failed from OAuth callback:', event.data.error);
        
        // Clean up
        window.removeEventListener('message', messageListener);
        authWindow.close();
        
        reject(new Error(event.data.error || 'Authentication failed'));
        
      } else if (event.data.type === 'DRIVE_AUTH_SUCCESS') {
        // Fallback for old message format (if needed)
        console.log('[Drive Auth] ✅ Authentication successful (legacy format)');
        
        // Clean up
        window.removeEventListener('message', messageListener);
        authWindow.close();
        
        resolve(true);
        
      } else if (event.data.type === 'DRIVE_AUTH_ERROR') {
        console.error('[Drive Auth] ❌ Authentication failed (legacy format):', event.data.error);
        
        // Clean up
        window.removeEventListener('message', messageListener);
        authWindow.close();
        
        reject(new Error(event.data.error));
      }
    };
    
    // Set up message listener
    window.addEventListener('message', messageListener);
    
    // Check if the window was closed manually
    const checkClosed = setInterval(() => {
      if (authWindow.closed) {
        clearInterval(checkClosed);
        window.removeEventListener('message', messageListener);
        reject(new Error("Authentication was cancelled"));
      }
    }, 1000);
    
  });
};

export const signOutUser = async () => {
  // Sign out from Drive (clears httpOnly cookie on server)
  try {
    const response = await fetch('/api/drive/signout', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest' // CSRF protection
      }
    });
    if (!response.ok) {
      console.error('Failed to sign out from Drive');
    }
  } catch (error) {
    console.error('Drive sign-out error:', error);
  }
  
  return signOut(auth);
};

// Handle redirect result once, then rely on the subscriber
export const initAuthOnce = async () => {
  try {
    // This resolves to a credential *if* the page just returned from Google.
    await getRedirectResult(auth);
  } catch (e) {
    console.error('Redirect result error', e);
  }
  // From here on, UI should rely on onAuthStateChanged subscription.
};

// Legacy token storage functions removed - all authentication is now via httpOnly cookies

// Auth state observer
export const onAuthStateChange = (callback: (user: User | null) => void) => {
  return onAuthStateChanged(auth, callback);
};
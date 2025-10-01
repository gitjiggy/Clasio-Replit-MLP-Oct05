// Firebase configuration and authentication setup
// Based on blueprint:firebase_barebones_javascript

import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth, signInWithPopup, signInWithRedirect, GoogleAuthProvider, onAuthStateChanged, signOut, User, setPersistence, browserLocalPersistence } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebasestorage.app`,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Initialize Firebase - Ensure singleton to prevent instance mismatch
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Initialize Auth - Export singleton instance
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

// Basic Firebase authentication (NO Drive scopes) - Using popup with redirect fallback
export const signInWithGoogle = async () => {
  await setPersistence(auth, browserLocalPersistence);
  try {
    // Prefer popup: avoids third-party cookie issues
    await signInWithPopup(auth, basicGoogleProvider);
    // success → onAuthStateChanged will fire and close the modal
  } catch (err: any) {
    // Popup blocked or not available? Fall back to redirect.
    const popupBlocked =
      err?.code === "auth/popup-blocked" ||
      err?.code === "auth/popup-closed-by-user" ||
      err?.code === "auth/cancelled-popup-request";

    if (popupBlocked) {
      await signInWithRedirect(auth, basicGoogleProvider);
      return;
    }
    throw err; // surface real errors
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

// Auth state observer - SDK handles redirect result automatically
export const onAuthStateChange = (callback: (user: User | null) => void) => {
  return onAuthStateChanged(auth, callback);
};
// Firebase configuration and authentication setup
// Based on blueprint:firebase_barebones_javascript

import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User } from "firebase/auth";

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

// Basic Firebase authentication (NO Drive scopes) - Popup only, no redirect fallback
export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, basicGoogleProvider);
    
    // Firebase gives back user + tokens
    const user = result.user;
    
    // (Optional) Store user info for your app state
    console.log("✅ Signed in user:", user);
    
    return user;
  } catch (err: any) {
    if (err.code === "auth/popup-closed-by-user") {
      console.warn("Popup closed before completing sign-in.");
    } else if (err.code === "auth/cancelled-popup-request") {
      console.warn("Another popup request was cancelled.");
    } else {
      console.error("Google sign-in error:", err);
    }
    throw err;
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
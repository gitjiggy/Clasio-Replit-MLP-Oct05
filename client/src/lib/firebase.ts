// Firebase configuration and authentication setup
// Based on blueprint:firebase_barebones_javascript

import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, signOut, User } from "firebase/auth";

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

// Basic Firebase authentication (NO Drive scopes) - Works reliably with popup
export const signInWithGoogle = async () => {
  
  try {
    const result = await signInWithPopup(auth, basicGoogleProvider);
    
    return { user: result.user };
  } catch (error: any) {
    console.error("Basic authentication failed:", error);
    throw new Error("Authentication failed: " + error.message);
  }
};

// NEW TAB WORKAROUND: Drive consent flow - Opens in new tab to avoid iframe issues
export const connectGoogleDrive = async (): Promise<string> => {
  
  return new Promise((resolve, reject) => {
    // Open auth page in new tab/window
    const authWindow = window.open(
      '/auth/drive', 
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
      
      if (event.data.type === 'DRIVE_AUTH_SUCCESS') {
        
        // Store the token with timestamp in the main window
        if (event.data.token) {
          storeGoogleAccessToken(event.data.token);
        }
        
        // Clean up
        window.removeEventListener('message', messageListener);
        authWindow.close();
        
        resolve(event.data.token);
        
      } else if (event.data.type === 'DRIVE_AUTH_ERROR') {
        console.error("Drive auth failed:", event.data.error);
        
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
  // Clear stored Google access token
  clearGoogleAccessToken();
  return signOut(auth);
};

// Handle redirect result after Google sign-in (fallback method)
export const handleAuthRedirect = async () => {
  
  try {
    const result = await getRedirectResult(auth);
    
    if (result) {
      // This gives you a Google Access Token. You can use it to access Google APIs.
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const googleAccessToken = credential?.accessToken;

      // The signed-in user info.
      const user = result.user;
      
      // Store the Google access token for Drive API calls
      if (googleAccessToken) {
        storeGoogleAccessToken(googleAccessToken);
      }
      
      return { user, googleAccessToken };
    }
    return null;
  } catch (error: any) {
    console.error("Auth redirect error:", error.code, error.message);
    throw new Error(error.message || "Authentication failed");
  }
};

// Get stored Google access token for Drive API calls
export const getGoogleAccessToken = (): string | null => {
  const token = localStorage.getItem('google_access_token');
  const tokenTime = localStorage.getItem('google_access_token_time');
  
  // Check if token is older than 50 minutes (tokens expire in 60 minutes)
  if (token && tokenTime) {
    const tokenAge = Date.now() - parseInt(tokenTime);
    const fiftyMinutes = 50 * 60 * 1000; // 50 minutes in milliseconds
    
    if (tokenAge > fiftyMinutes) {
      clearGoogleAccessToken();
      return null;
    }
  }
  
  return token;
};

// Store Google access token with timestamp
export const storeGoogleAccessToken = (token: string) => {
  localStorage.setItem('google_access_token', token);
  localStorage.setItem('google_access_token_time', Date.now().toString());
};

// Clear stored Google access token on sign out
export const clearGoogleAccessToken = () => {
  localStorage.removeItem('google_access_token');
  localStorage.removeItem('google_access_token_time');
};

// Auth state observer
export const onAuthStateChange = (callback: (user: User | null) => void) => {
  return onAuthStateChanged(auth, callback);
};
// Firebase configuration and authentication setup
// Based on blueprint:firebase_barebones_javascript

import { initializeApp } from "firebase/app";
import { getAuth, signInWithRedirect, GoogleAuthProvider, getRedirectResult, onAuthStateChanged, signOut, User } from "firebase/auth";

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

// Google Auth Provider with Drive scopes
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/drive.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/drive.file');

// Auth functions with debugging
export const signInWithGoogle = () => {
  console.log("=== DEBUG: Starting Google OAuth with CORRECTED Firebase config ===");
  console.log("Firebase config:", {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ? "✅ Present" : "❌ Missing",
    authDomain: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    currentDomain: window.location.origin
  });
  console.log("GoogleAuthProvider scopes:", googleProvider.getScopes());
  console.log("Expected OAuth redirect domain:", `https://${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com/__/auth/handler`);
  console.log("About to redirect to Google OAuth...");
  
  return signInWithRedirect(auth, googleProvider);
};

export const signOutUser = async () => {
  // Clear stored Google access token
  clearGoogleAccessToken();
  return signOut(auth);
};

// Handle redirect result after Google sign-in
export const handleAuthRedirect = async () => {
  console.log("=== DEBUG: Handling auth redirect ===");
  console.log("Current URL:", window.location.href);
  console.log("Current domain:", window.location.origin);
  
  try {
    const result = await getRedirectResult(auth);
    console.log("getRedirectResult:", result);
    
    if (result) {
      // This gives you a Google Access Token. You can use it to access Google APIs.
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const googleAccessToken = credential?.accessToken;

      // The signed-in user info.
      const user = result.user;
      console.log("✅ User signed in successfully:", user.displayName);
      console.log("✅ Google access token:", googleAccessToken ? "received" : "missing");
      
      // Store the Google access token for Drive API calls
      if (googleAccessToken) {
        localStorage.setItem('google_access_token', googleAccessToken);
      }
      
      return { user, googleAccessToken };
    }
    console.log("No redirect result found");
    return null;
  } catch (error: any) {
    console.error("❌ Auth redirect error details:", {
      code: error.code,
      message: error.message,
      customData: error.customData,
      credential: error.credential,
      stack: error.stack
    });
    throw new Error(error.message || "Authentication failed");
  }
};

// Get stored Google access token for Drive API calls
export const getGoogleAccessToken = (): string | null => {
  return localStorage.getItem('google_access_token');
};

// Clear stored Google access token on sign out
export const clearGoogleAccessToken = () => {
  localStorage.removeItem('google_access_token');
};

// Auth state observer
export const onAuthStateChange = (callback: (user: User | null) => void) => {
  return onAuthStateChanged(auth, callback);
};
// Firebase configuration and authentication setup
// Based on blueprint:firebase_barebones_javascript

import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, User } from "firebase/auth";

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

// Auth functions with debugging - Using popup instead of redirect
export const signInWithGoogle = async () => {
  console.log("=== DEBUG: Starting Google OAuth POPUP with Firebase ===");
  console.log("Firebase config:", {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ? "✅ Present" : "❌ Missing",
    authDomain: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    currentDomain: window.location.origin
  });
  console.log("GoogleAuthProvider scopes:", googleProvider.getScopes());
  console.log("About to open Google OAuth popup...");
  
  try {
    const result = await signInWithPopup(auth, googleProvider);
    
    // Get the Google access token from the credential
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const googleAccessToken = credential?.accessToken;

    console.log("✅ User signed in via POPUP:", result.user.displayName);
    console.log("✅ Google access token:", googleAccessToken ? "received" : "missing");
    
    // Store the Google access token for Drive API calls
    if (googleAccessToken) {
      localStorage.setItem('google_access_token', googleAccessToken);
    }
    
    return { user: result.user, googleAccessToken };
  } catch (error: any) {
    console.error("❌ Popup sign-in error:", {
      code: error.code,
      message: error.message,
      customData: error.customData,
      credential: error.credential
    });
    throw new Error(error.message || "Authentication failed");
  }
};

export const signOutUser = async () => {
  // Clear stored Google access token
  clearGoogleAccessToken();
  return signOut(auth);
};

// No redirect handling needed with popup authentication

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
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
  console.log("=== DEBUG: Basic Firebase authentication (NO Drive scopes) ===");
  console.log("Firebase config:", {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY ? "✅ Present" : "❌ Missing",
    authDomain: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    currentDomain: window.location.origin
  });
  console.log("Basic scopes only (no Drive)");
  
  try {
    const result = await signInWithPopup(auth, basicGoogleProvider);
    console.log("✅ User signed in via POPUP:", result.user.displayName);
    console.log("📝 Note: Drive access requires separate consent");
    
    return { user: result.user };
  } catch (error: any) {
    console.error("❌ Basic authentication failed:", error);
    throw new Error("Authentication failed: " + error.message);
  }
};

// Separate Drive consent flow - Uses redirect to handle consent screen
export const connectGoogleDrive = async () => {
  console.log("=== DEBUG: Drive consent flow (redirect method) ===");
  console.log("Requesting Drive scopes with forced consent...");
  
  // Check if running in iframe (Replit environment)
  if (window.top !== window.self) {
    console.warn("⚠️ Running in iframe - Drive consent may fail");
    console.log("Consider opening in new tab for better compatibility");
  }
  
  try {
    // Force redirect for Drive consent (no popup option)
    await signInWithRedirect(auth, driveGoogleProvider);
    console.log("🔄 Drive consent redirect initiated...");
    // Note: will complete on page reload via handleAuthRedirect
  } catch (error: any) {
    console.error("❌ Drive consent failed:", error);
    throw new Error("Drive connection failed: " + error.message);
  }
};

export const signOutUser = async () => {
  // Clear stored Google access token
  clearGoogleAccessToken();
  return signOut(auth);
};

// Handle redirect result after Google sign-in (fallback method)
export const handleAuthRedirect = async () => {
  console.log("=== DEBUG: Handling auth redirect (fallback method) ===");
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
      console.log("✅ User signed in successfully via REDIRECT:", user.displayName);
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
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, getRedirectResult } from 'firebase/auth';
import { auth, onAuthStateChange, persistenceReady } from '@/lib/firebase';
import { trackEvent } from '@/lib/analytics';

interface AuthContextType {
  user: User | null;
  initializing: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    // DEVELOPMENT ONLY: Auto-enable test authentication for Replit dev
    const checkTestAuth = () => {
      // Auto-detect Replit dev environment
      const isReplitDev = window.location.hostname.includes('.replit.dev');
      
      if (import.meta.env.DEV || isReplitDev) {
        // Create fake Firebase user for test authentication
        const testUser: User = {
          uid: 'test-user-uid',
          email: 'dev@replit.test',
          displayName: 'Dev Test User',
          emailVerified: true,
          isAnonymous: false,
          metadata: {
            creationTime: new Date().toISOString(),
            lastSignInTime: new Date().toISOString()
          },
          providerData: [],
          refreshToken: 'test-refresh-token',
          tenantId: null,
          delete: async () => {},
          getIdToken: async () => 'test-token-for-automated-testing-only',
          getIdTokenResult: async () => ({
            token: 'test-token-for-automated-testing-only',
            authTime: new Date().toISOString(),
            issuedAtTime: new Date().toISOString(),
            expirationTime: new Date(Date.now() + 3600000).toISOString(),
            signInProvider: 'test',
            signInSecondFactor: null,
            claims: {}
          }),
          reload: async () => {},
          toJSON: () => ({}),
          phoneNumber: null,
          photoURL: null,
          providerId: 'test'
        } as User;
        
        console.log('🔧 DEV MODE: Auto-authenticating with test user (Replit dev bypass)');
        setUser(testUser);
        setInitializing(false);
        return true; // Indicate test auth was used
      }
      return false; // No test auth
    };

    // Try test auth first in development/Replit
    if (checkTestAuth()) {
      return; // Skip Firebase auth if test auth was successful
    }

    // Check for redirect result first, then set up listener
    let unsubscribe: (() => void) | undefined;
    
    (async () => {
      try {
        await persistenceReady;
        const result = await getRedirectResult(auth);
        
        if (result) {
          setUser(result.user);
          setInitializing(false);
          
          trackEvent('auth_signin_success', { 
            method: 'google_redirect',
            user_id: result.user.uid
          });
        }
      } catch (error) {
        console.error("Redirect sign-in error:", error);
        setInitializing(false);
      }
      
      // Always set up auth state subscriber (handles sign-out, token refresh, etc.)
      unsubscribe = onAuthStateChange((u) => {
        setUser(u ?? null);
        setInitializing(false);
      });
    })();

    // Cleanup function
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  const value = {
    user,
    initializing,
    isAuthenticated: !!user,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

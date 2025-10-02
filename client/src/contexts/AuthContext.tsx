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
    // DEVELOPMENT ONLY: Check for test authentication
    const checkTestAuth = () => {
      if (import.meta.env.DEV) {
        const testToken = document.cookie
          .split('; ')
          .find(row => row.startsWith('test_auth='))
          ?.split('=')[1];
        
        if (testToken === 'test-token-for-automated-testing-only') {
          // Create fake Firebase user for test authentication
          const testUser: User = {
            uid: 'test-user-uid',
            email: 'test@example.com',
            displayName: 'Test User',
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
            getIdToken: async () => 'test-id-token',
            getIdTokenResult: async () => ({
              token: 'test-id-token',
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
          
          console.log('✅ Test authentication detected, setting test user');
          setUser(testUser);
          setInitializing(false);
          return true; // Indicate test auth was used
        }
      }
      return false; // No test auth
    };

    // Try test auth first in development
    if (checkTestAuth()) {
      return; // Skip Firebase auth if test auth was successful
    }

    // Check for redirect result first, then set up listener
    let unsubscribe: (() => void) | undefined;
    
    (async () => {
      try {
        // CRITICAL: Wait for persistence to be ready before checking redirect result
        // Firebase clears redirect state when persistence changes, so we must wait
        console.log("⏳ Waiting for persistence to be ready...");
        await persistenceReady;
        console.log("✅ Persistence ready, checking for redirect result...");
        
        const result = await getRedirectResult(auth);
        if (result) {
          console.log("✅ Redirect sign-in successful:", result.user.email);
          setUser(result.user);
          setInitializing(false);
          
          // Track successful sign-in for conversion rate analytics
          trackEvent('auth_signin_success', { 
            method: 'google_redirect',
            user_id: result.user.uid
          });
        } else {
          console.log("ℹ️ No redirect result found");
        }
      } catch (error) {
        console.error("❌ Redirect result error:", error);
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

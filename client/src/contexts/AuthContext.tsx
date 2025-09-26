import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User } from 'firebase/auth';
import { onAuthStateChange, handleAuthRedirect } from '@/lib/firebase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
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
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

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
          setLoading(false);
          return true; // Indicate test auth was used
        }
      }
      return false; // No test auth
    };

    // Try test auth first in development
    if (checkTestAuth()) {
      return; // Skip Firebase auth if test auth was successful
    }

    // Handle auth redirect on app load (fallback method)
    const handleAuth = async () => {
      try {
        const authResult = await handleAuthRedirect();
        if (authResult) {
          setUser(authResult.user);
        }
      } catch (error) {
        console.error("Auth redirect failed:", error);
      }
    };

    handleAuth();

    // Set up auth state observer for both popup and redirect authentication
    const unsubscribe = onAuthStateChange((user) => {
      setUser(user);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const value = {
    user,
    loading,
    isAuthenticated: !!user,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
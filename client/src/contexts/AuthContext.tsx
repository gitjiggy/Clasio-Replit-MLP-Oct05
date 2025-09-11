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
    // Handle auth redirect on app load
    const handleAuth = async () => {
      try {
        const authResult = await handleAuthRedirect();
        if (authResult) {
          console.log("✅ Auth redirect handled successfully");
          console.log("✅ Google access token saved:", authResult.googleAccessToken ? "YES" : "NO");
          console.log("✅ Token in localStorage:", localStorage.getItem('google_access_token') ? "YES" : "NO");
          setUser(authResult.user);
        }
      } catch (error) {
        console.error("❌ Auth redirect failed:", error);
      }
    };

    handleAuth();

    // Set up auth state observer
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
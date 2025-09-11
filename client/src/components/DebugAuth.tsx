// Minimal OAuth test component for debugging
import { useState } from "react";
import { getAuth, signInWithRedirect, GoogleAuthProvider, getRedirectResult } from "firebase/auth";
import { Button } from "@/components/ui/button";

const auth = getAuth();

// Create a minimal provider without Drive scopes for testing
const minimalProvider = new GoogleAuthProvider();
// Don't add any extra scopes for this test

export function DebugAuth() {
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const testMinimalAuth = async () => {
    console.log("=== MINIMAL AUTH TEST ===");
    console.log("Testing basic Google auth without Drive scopes...");
    console.log("Current domain:", window.location.origin);
    console.log("Firebase authDomain:", `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`);
    
    setLoading(true);
    try {
      await signInWithRedirect(auth, minimalProvider);
    } catch (error: any) {
      console.error("❌ Minimal auth failed:", error);
      setDebugInfo({ error: error.message, code: error.code });
      setLoading(false);
    }
  };

  const checkRedirectResult = async () => {
    console.log("=== CHECKING REDIRECT RESULT ===");
    try {
      const result = await getRedirectResult(auth);
      console.log("Redirect result:", result);
      setDebugInfo({ 
        success: !!result, 
        user: result?.user?.email,
        domain: window.location.origin 
      });
    } catch (error: any) {
      console.error("❌ Redirect check failed:", error);
      setDebugInfo({ 
        error: error.message, 
        code: error.code,
        domain: window.location.origin 
      });
    }
    setLoading(false);
  };

  // Check for redirect result on component mount
  useState(() => {
    checkRedirectResult();
  });

  return (
    <div className="p-4 border rounded-lg bg-muted" data-testid="debug-auth">
      <h3 className="text-lg font-semibold mb-4">OAuth Debug Test</h3>
      
      <div className="space-y-2 mb-4">
        <Button 
          onClick={testMinimalAuth} 
          disabled={loading}
          data-testid="button-test-minimal-auth"
        >
          {loading ? "Testing..." : "Test Minimal Google Auth"}
        </Button>
        
        <Button 
          onClick={checkRedirectResult} 
          variant="outline"
          data-testid="button-check-redirect"
        >
          Check Redirect Result
        </Button>
      </div>

      {debugInfo && (
        <div className="bg-background p-3 rounded border">
          <h4 className="font-medium mb-2">Debug Info:</h4>
          <pre className="text-sm overflow-auto">
            {JSON.stringify(debugInfo, null, 2)}
          </pre>
        </div>
      )}

      <div className="text-sm text-muted-foreground mt-4">
        <p><strong>Current Domain:</strong> {window.location.origin}</p>
        <p><strong>Firebase Auth Domain:</strong> {import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com</p>
        <p><strong>Expected Issue:</strong> Domain mismatch causing OAuth redirect failure</p>
      </div>
    </div>
  );
}
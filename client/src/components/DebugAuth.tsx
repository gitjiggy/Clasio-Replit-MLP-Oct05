// Minimal OAuth test component for debugging
import { useState } from "react";
import { getAuth, signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { Button } from "@/components/ui/button";

const auth = getAuth();

// Create a minimal provider without Drive scopes for testing
const minimalProvider = new GoogleAuthProvider();
// Configure for popup mode to prevent redirects
minimalProvider.setCustomParameters({
  'prompt': 'select_account',  // Always show account selector
  'access_type': 'offline'     // Get refresh token
});

export function DebugAuth() {
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const testMinimalAuth = async () => {
    console.log("=== MINIMAL AUTH POPUP TEST ===");
    console.log("Testing basic Google auth POPUP without Drive scopes...");
    console.log("Current domain:", window.location.origin);
    console.log("Firebase authDomain:", `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`);
    
    setLoading(true);
    try {
      const result = await signInWithPopup(auth, minimalProvider);
      console.log("✅ Minimal popup auth successful:", result.user?.email);
      setDebugInfo({ 
        success: true, 
        user: result.user?.email,
        domain: window.location.origin,
        method: "popup"
      });
    } catch (error: any) {
      console.error("❌ Minimal popup auth failed:", error);
      setDebugInfo({ error: error.message, code: error.code, method: "popup" });
    }
    setLoading(false);
  };

  const clearDebugInfo = () => {
    setDebugInfo(null);
  };

  return (
    <div className="p-4 border rounded-lg bg-muted" data-testid="debug-auth">
      <h3 className="text-lg font-semibold mb-4">OAuth Debug Test</h3>
      
      <div className="space-y-2 mb-4">
        <Button 
          onClick={testMinimalAuth} 
          disabled={loading}
          data-testid="button-test-minimal-auth"
        >
          {loading ? "Testing..." : "Test Minimal Google Auth (Popup)"}
        </Button>
        
        <Button 
          onClick={clearDebugInfo} 
          variant="outline"
          data-testid="button-clear-debug"
        >
          Clear Debug Info
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
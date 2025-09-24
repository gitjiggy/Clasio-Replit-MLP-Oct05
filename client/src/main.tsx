import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// DEV-only: Suppress Replit's runtime error overlay for expected CORS fetch failures
if (import.meta.env.DEV) {
  window.addEventListener('unhandledrejection', (event) => {
    // Suppress "Failed to fetch" errors during upload (expected CORS failures)
    if (event.reason instanceof TypeError && 
        event.reason.message === 'Failed to fetch' &&
        event.reason.stack?.includes('ObjectUploader.tsx')) {
      console.warn('🛑 Suppressed expected CORS fetch error to prevent runtime overlay popup');
      event.preventDefault();
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);

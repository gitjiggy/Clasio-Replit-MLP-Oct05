import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// DEV-only: Aggressively suppress Replit's runtime error overlay for fetch failures
if (import.meta.env.DEV) {
  // Multiple event listeners to catch at different stages
  window.addEventListener('unhandledrejection', (event) => {
    // Suppress any "Failed to fetch" errors (they're expected during CORS upload failures)
    if (event.reason instanceof TypeError && event.reason.message === 'Failed to fetch') {
      console.warn('🛑 AGGRESSIVE: Suppressed fetch error to prevent runtime overlay popup:', event.reason.message);
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  }, { capture: true }); // Use capture phase to catch even earlier
  
  // Also try to intercept at error level
  window.addEventListener('error', (event) => {
    if (event.error instanceof TypeError && event.error.message === 'Failed to fetch') {
      console.warn('🛑 AGGRESSIVE: Suppressed error event for fetch failure');
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  }, { capture: true });
  
  // Nuclear option: Override console.error for runtime overlay suppression
  const originalConsoleError = console.error;
  console.error = (...args) => {
    const message = args.join(' ');
    if (message.includes('Failed to fetch') && message.includes('ObjectUploader.tsx')) {
      console.warn('🛑 NUCLEAR: Blocked console.error that would trigger runtime overlay');
      return;
    }
    originalConsoleError.apply(console, args);
  };
}

createRoot(document.getElementById("root")!).render(<App />);

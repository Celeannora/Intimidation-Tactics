import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { registerServiceWorker } from "./pwa";
import { requestPersistentStorage } from "./lib/persistence";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);

registerServiceWorker(() => {
  // Notify App via a custom DOM event so the banner can render
  window.dispatchEvent(new CustomEvent("sw-update-ready"));
});

void requestPersistentStorage().then((status) => {
  window.dispatchEvent(new CustomEvent("storage-persistence", { detail: status }));
  if (status !== "persisted") {
    console.warn(
      `[storage] IndexedDB persistence: ${status}. ` +
        "The browser may evict the card database under storage pressure. " +
        "Install as a PWA or grant persistent storage permission to keep it."
    );
  }
});

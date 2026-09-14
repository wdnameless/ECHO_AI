import React from "react";
import ReactDOM from "react-dom/client";
import Overlay from "./components/Overlay";
import { AppProvider, ThemeProvider } from "./contexts";
import "./global.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import AppRoutes from "./routes";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorLayout } from "./layouts";
const currentWindow = getCurrentWindow();
const windowLabel = currentWindow.label;

window.addEventListener("error", (e) => {
  console.error("[CRITICAL WINDOW ERROR]", windowLabel, e.error || e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[UNHANDLED REJECTION]", windowLabel, e.reason);
});
// Render different components based on window label
if (windowLabel.startsWith("capture-overlay-")) {
  const monitorIndex = parseInt(windowLabel.split("-")[2], 10) || 0;
  // Render overlay without providers
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <Overlay monitorIndex={monitorIndex} />
    </React.StrictMode>
  );
} else {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary fallbackRender={() => <ErrorLayout />}>
        <ThemeProvider>
          <AppProvider>
            <AppRoutes />
          </AppProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}

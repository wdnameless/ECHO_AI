import React from "react";
import ReactDOM from "react-dom/client";
import Overlay from "./components/Overlay";
import { AppProvider, ThemeProvider } from "./contexts";
import "./global.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import AppRoutes from "./routes";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorLayout } from "./layouts";
import { HostTrustProvider } from "./components";
const currentWindow = getCurrentWindow();
const windowLabel = currentWindow.label;

if (windowLabel === "main") {
  document.documentElement.style.backgroundColor = "transparent";
  document.body.style.backgroundColor = "transparent";
} else {
  document.documentElement.style.backgroundColor = "hsl(var(--background))";
  document.body.style.backgroundColor = "hsl(var(--background))";
  document.body.classList.add("bg-background");
}
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
            <HostTrustProvider />
            <AppRoutes />
          </AppProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}

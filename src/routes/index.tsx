import { lazy, Suspense } from "react";
import {
  HashRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Loader2Icon } from "lucide-react";
import App from "@/pages/app";
import { DashboardLayout } from "@/layouts";

/**
 * Every page is loaded on demand.
 *
 * The overlay window needs only `App`, but importing the pages eagerly pulled
 * the whole set — and with them the markdown renderer, which drags in shiki
 * (9 MB), mermaid, cytoscape and katex. That made the first paint of a small
 * floating bar depend on the heaviest dependencies in the project.
 *
 * The overlay stays a static import: it is the window that shows first, so a
 * dynamic import there would trade startup latency for nothing.
 */
// Each page barrel has a default export, so the dynamic imports can be handed
// straight to `lazy` without a mapping wrapper.
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Chats = lazy(() => import("@/pages/chats"));
const ViewChat = lazy(() => import("@/pages/chats/components/View"));
const SystemPrompts = lazy(() => import("@/pages/system-prompts"));
const Settings = lazy(() => import("@/pages/settings"));
const DevSpace = lazy(() => import("@/pages/dev"));
const Shortcuts = lazy(() => import("@/pages/shortcuts"));
const Audio = lazy(() => import("@/pages/audio"));
const Screenshot = lazy(() => import("@/pages/screenshot"));
const Responses = lazy(() => import("@/pages/responses"));
const MockInterview = lazy(() => import("@/pages/mock-interview"));

/** Shown while a page chunk loads. Deliberately minimal and non-blocking. */
const RouteFallback = () => (
  <div className="flex h-full w-full items-center justify-center p-8">
    <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
  </div>
);

export default function AppRoutes() {
  const currentWindow = getCurrentWindow();
  const isDashboard = currentWindow.label === "dashboard";

  return (
    <Router>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route
            path="/"
            element={isDashboard ? <Navigate to="/chats" replace /> : <App />}
          />
          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/chats" element={<Chats />} />
            <Route path="/system-prompts" element={<SystemPrompts />} />
            <Route path="/chats/view/:conversationId" element={<ViewChat />} />
            <Route path="/shortcuts" element={<Shortcuts />} />
            <Route path="/screenshot" element={<Screenshot />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/audio" element={<Audio />} />
            <Route path="/responses" element={<Responses />} />
            <Route path="/dev-space" element={<DevSpace />} />
            <Route path="/mock-interview" element={<MockInterview />} />
          </Route>
        </Routes>
      </Suspense>
    </Router>
  );
}

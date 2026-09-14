import { HashRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Dashboard,
  App,
  SystemPrompts,
  ViewChat,
  Settings,
  DevSpace,
  Shortcuts,
  Audio,
  Screenshot,
  Chats,
  Responses,
  MockInterview,
} from "@/pages";
import { DashboardLayout } from "@/layouts";

export default function AppRoutes() {
  const currentWindow = getCurrentWindow();
  const isDashboard = currentWindow.label === "dashboard";

  return (
    <Router>
      <Routes>
        <Route path="/" element={isDashboard ? <Navigate to="/chats" replace /> : <App />} />
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
    </Router>
  );
}

import { useState, useEffect } from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { Shield, MessageSquare } from "lucide-react";
import { useAuth } from "./hooks/useAuth";
import { DashboardPage } from "./components/DashboardPage";
import { AgentDetailPage } from "./components/AgentDetailPage";
import { AdminPage } from "./components/AdminPage";
import { AgentChat } from "./components/AgentChat";
import { AppV2 } from "./v2/AppV2";
import { checkIsAdmin } from "./lib/api";

function AdminLink() {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate("/admin")} className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-red-400 transition hover:bg-zinc-800 hover:text-red-300">
      <Shield size={14} /> Admin
    </button>
  );
}

function ChatLink() {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate("/chat")} className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-cyan-400 transition hover:bg-zinc-800 hover:text-cyan-300">
      <MessageSquare size={14} /> Chat
    </button>
  );
}

export function App() {
  const auth = useAuth();
  const location = useLocation();
  const [isAdmin, setIsAdmin] = useState(false);

  // Pass /v2/* straight through — AppV2 owns its own full-screen layout
  if (location.pathname.startsWith("/v2")) {
    return <AppV2 />;
  }

  useEffect(() => {
    if (auth.status === "authenticated") {
      checkIsAdmin(auth.user.id).then(setIsAdmin).catch(() => {});
    }
  }, [auth.status, auth.status === "authenticated" ? auth.user.id : ""]);

  if (auth.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <p className="text-zinc-400">Loading…</p>
      </div>
    );
  }

  if (auth.status === "unauthenticated") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-zinc-950 text-zinc-100">
        <h1 className="text-2xl font-semibold">XyneClaw Auth</h1>
        <p className="text-zinc-400">Sign in with your Xyne Spaces account to manage MCP integrations.</p>
        <button
          onClick={auth.login}
          className="rounded-lg bg-white px-6 py-2.5 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <h1 className="text-lg font-semibold">XyneClaw Auth</h1>
          <div className="flex items-center gap-4">
            <ChatLink />
            {isAdmin && <AdminLink />}
            <span className="text-sm text-zinc-400">{auth.user.email}</span>
            <button
              onClick={auth.logout}
              className="rounded-md px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <Routes>
          <Route path="/" element={<DashboardPage userId={auth.user.id} isAdmin={isAdmin} />} />
          <Route path="/agents/:slug" element={<AgentDetailPage userId={auth.user.id} isAdmin={isAdmin} />} />
          <Route path="/chat" element={<AgentChat userId={auth.user.id} />} />
          {isAdmin && <Route path="/admin" element={<AdminPage userId={auth.user.id} />} />}
        </Routes>
      </main>
    </div>
  );
}
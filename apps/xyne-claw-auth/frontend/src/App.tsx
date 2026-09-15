import { useState, useEffect } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { Shield, MessageSquare, BarChart2, Brain } from "lucide-react";
import { useAuth } from "./hooks/useAuth";
import { DashboardPage } from "./components/DashboardPage";
import { AgentDetailPage } from "./components/AgentDetailPage";
import { SubagentDetailPage } from "./components/SubagentDetailPage";
import { AdminPage } from "./components/AdminPage";
import { AgentChat } from "./components/AgentChat";
import { DigitalTwinPage } from "./components/DigitalTwinPage";
import { AppV2 } from "./v2/AppV2";
import { AppV3 } from "./v3/AppV3";
import { PublicDesignSharePage } from "./v3/components/PublicDesignSharePage";
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

function DashboardLink() {
  const navigate = useNavigate();
  // Dashboard now lives in V3 only — navigating here drops you into the V3
  // shell (sidebar + theme toggle). The old /dashboard URL still works as a
  // redirect (see route below) so deep links don't break.
  return (
    <button onClick={() => navigate("/v3/dashboard")} className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-emerald-400 transition hover:bg-zinc-800 hover:text-emerald-300">
      <BarChart2 size={14} /> Dashboard
    </button>
  );
}

function DigitalTwinLink() {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate("/digital-twin")} className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-indigo-400 transition hover:bg-zinc-800 hover:text-indigo-300">
      <Brain size={14} /> Digital Twin
    </button>
  );
}

export function App() {
  const auth = useAuth();
  const location = useLocation();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (auth.status === "authenticated") {
      checkIsAdmin(auth.user.id).then(setIsAdmin).catch(() => {});
    }
  }, [auth.status, auth.status === "authenticated" ? auth.user.id : ""]);

  // Public Design links deliberately bypass every auth shell. The bearer is
  // kept in the URL fragment and validated by claw-auth's public share API.
  if (location.pathname === "/v3/design/shared") {
    return <PublicDesignSharePage />;
  }

  // Pass /v2/* straight through — AppV2 owns its own full-screen layout
  if (location.pathname.startsWith("/v2")) {
    return <AppV2 />;
  }

  // Pass /v3/* straight through — AppV3 owns its own full-screen layout
  if (location.pathname.startsWith("/v3")) {
    return <AppV3 />;
  }

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
            <DashboardLink />
            <DigitalTwinLink />
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
          {/* V3 is the main surface — root drops users into the V3 home. */}
          <Route path="/" element={<Navigate to="/v3/home" replace />} />
          {/* V1 dashboard kept reachable for the "Switch to v1" affordance
              in the V3 top nav. Other V1 sub-routes below are unchanged. */}
          <Route path="/v1" element={<DashboardPage userId={auth.user.id} isAdmin={isAdmin} />} />
          <Route path="/agents/:slug" element={<AgentDetailPage userId={auth.user.id} isAdmin={isAdmin} />} />
          <Route path="/subagents/new" element={<SubagentDetailPage userId={auth.user.id} isAdmin={isAdmin} mode="create" />} />
          <Route path="/subagents/:name" element={<SubagentDetailPage userId={auth.user.id} isAdmin={isAdmin} mode="edit" />} />
          <Route path="/chat" element={<AgentChat userId={auth.user.id} />} />
          <Route path="/digital-twin" element={<DigitalTwinPage userId={auth.user.id} />} />
          {/* Dashboard moved to V3. Keep the old URL working via redirect so
              any deep link / bookmark still resolves. `replace` so the V1
              `/dashboard` URL doesn't sit in the history stack. */}
          <Route path="/dashboard" element={<Navigate to="/v3/dashboard" replace />} />
          {isAdmin && <Route path="/admin" element={<AdminPage userId={auth.user.id} />} />}
        </Routes>
      </main>
    </div>
  );
}

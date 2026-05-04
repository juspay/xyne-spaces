/**
 * AppV2 — full-screen app shell for /v2/* (v2 frontend testing)
 *
 * Owns its own auth handling and layout (sidebar + content).
 * Passed `auth` from App.tsx to avoid double-fetching /api/auth/validate.
 */
import { useState, useEffect } from "react";
import { Routes, Route, NavLink, useNavigate } from "react-router-dom";
import {
  Bot,
  Sparkles,
  Network,
  Plug,
  BarChart2,
  CheckSquare,
  Settings,
  MessageSquare,
  ChevronsUpDown,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { checkIsAdmin } from "../lib/api";
import { DashboardPageV2 } from "./components/DashboardPageV2";
import { AgentDetailPageV2 } from "./components/AgentDetailPageV2";
import { AgentChatV2 } from "./components/AgentChatV2";
import { AdminPageV2 } from "./components/AdminPageV2";
import { SkillsPageV2 } from "./components/SkillsPageV2";
import { GatewaysPageV2 } from "./components/GatewaysPageV2";
import { MCPPageV2 } from "./components/MCPPageV2";
import { SettingsPageV2 } from "./components/SettingsPageV2";

// ── Nav config ────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { label: "Agents",    to: "/v2",           icon: Bot,         exact: true },
  { label: "Skills",    to: "/v2/skills",    icon: Sparkles,    exact: false },
  { label: "Gateways",  to: "/v2/gateways",  icon: Network,     exact: false },
  { label: "MCP",       to: "/v2/mcp",       icon: Plug,        exact: false },
  { label: "Analytics", to: "/v2/analytics", icon: BarChart2,   exact: false },
  { label: "Approvals", to: "/v2/approvals", icon: CheckSquare, exact: false },
  { label: "Settings",  to: "/v2/settings",  icon: Settings,    exact: false },
  { label: "Chat",      to: "/v2/chat",      icon: MessageSquare, exact: false },
] as const;

// ── Avatar helpers ────────────────────────────────────────────────────
function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

// ── Sidebar ───────────────────────────────────────────────────────────
function Sidebar({ userName }: { userName: string }) {
  const navigate = useNavigate();

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 text-xs font-bold text-white">
          X
        </div>
        <span className="text-sm font-semibold text-zinc-900">XyneClaw</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 px-2 py-2">
        {NAV_ITEMS.map(({ label, to, icon: Icon, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-zinc-100 font-medium text-zinc-900"
                  : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
              }`
            }
          >
            <Icon size={15} strokeWidth={1.6} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User */}
      <button
        onClick={() => navigate("/v2/settings")}
        className="flex items-center gap-2.5 px-4 py-3 text-left transition hover:bg-zinc-50"
      >
        <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-300 text-xs font-medium text-zinc-700">
          {initials(userName)}
          <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full border border-white bg-green-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-zinc-800">{userName}</p>
        </div>
        <ChevronsUpDown size={13} className="shrink-0 text-zinc-400" />
      </button>
    </aside>
  );
}

// ── AppV2 ─────────────────────────────────────────────────────────────
export function AppV2() {
  const auth = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (auth.status === "authenticated") {
      checkIsAdmin(auth.user.id).then(setIsAdmin).catch(() => {});
    }
  }, [auth.status, auth.status === "authenticated" ? auth.user.id : ""]);

  if (auth.status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-white text-zinc-400 text-sm">
        Loading…
      </div>
    );
  }

  if (auth.status === "unauthenticated") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-5 bg-white">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-900 text-sm font-bold text-white">X</div>
          <span className="text-lg font-semibold text-zinc-900">XyneClaw</span>
        </div>
        <p className="text-sm text-zinc-400">Sign in with your Xyne Spaces account.</p>
        <button
          onClick={auth.login}
          className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
        >
          Sign in with Google
        </button>
      </div>
    );
  }

  const userId = auth.user.id;

  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar userName={auth.user.name} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6">
          <Routes>
            <Route path="/v2" element={<DashboardPageV2 userId={userId} isAdmin={isAdmin} />} />
            <Route path="/v2/agents/:slug" element={<AgentDetailPageV2 userId={userId} isAdmin={isAdmin} />} />
            <Route path="/v2/chat" element={<AgentChatV2 userId={userId} />} />
            <Route path="/v2/skills" element={<SkillsPageV2 userId={userId} isAdmin={isAdmin} />} />
            <Route path="/v2/gateways" element={<GatewaysPageV2 userId={userId} />} />
            <Route path="/v2/mcp" element={<MCPPageV2 userId={userId} />} />
            <Route path="/v2/analytics" element={<PlaceholderPage title="Analytics" />} />
            <Route path="/v2/approvals" element={<PlaceholderPage title="Approvals" />} />
            <Route path="/v2/settings" element={<SettingsPageV2 userId={userId} />} />
            {isAdmin && <Route path="/v2/admin" element={<AdminPageV2 userId={userId} />} />}
          </Routes>
        </div>
      </div>
    </div>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-zinc-800">{title}</h2>
      <div className="rounded-xl border border-dashed border-zinc-300 p-16 text-center">
        <p className="text-sm text-zinc-400">{title} — under construction</p>
      </div>
    </div>
  );
}

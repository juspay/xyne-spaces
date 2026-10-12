import { Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { AppV3 } from "./v3/AppV3";
import { PublicDesignSharePage } from "./v3/components/PublicDesignSharePage";
import { LinkChannelPage } from "./v3/components/LinkChannelPage";

/**
 * Redirect that keeps the query string and hash, so links carrying state
 * (OAuth `?<type>_connected=`, `?agent=` on chat, etc.) still work after the
 * hop. `to` may contain `:param` placeholders, filled from the matched route.
 */
function RedirectTo({ to }: { to: string }) {
  const location = useLocation();
  const params = useParams();
  const pathname = to.replace(/:([A-Za-z_]+)/g, (_, key: string) =>
    encodeURIComponent(params[key] ?? ""),
  );
  return <Navigate to={{ pathname, search: location.search, hash: location.hash }} replace />;
}

/**
 * Pre-V3 URLs (the old V1 pages and the /v2 tree) were retired in XYNE-65902.
 * Every old path now redirects to its V3 equivalent so bookmarks, emailed
 * links and OAuth returns keep resolving.
 */
const LEGACY_REDIRECTS: Array<[from: string, to: string]> = [
  // V1
  ["/v1", "/v3/home"],
  ["/agents/:slug", "/v3/agents/:slug"],
  ["/subagents/new", "/v3/subagents"],
  ["/subagents/:name", "/v3/subagents/:name"],
  ["/chat", "/v3/chat"],
  ["/digital-twin", "/v3/digital-twin"],
  ["/dashboard", "/v3/dashboard"],
  ["/admin", "/v3/admin"],
  // V2
  ["/v2", "/v3/home"],
  ["/v2/agents/:slug", "/v3/agents/:slug"],
  ["/v2/chat", "/v3/chat"],
  ["/v2/skills", "/v3/skills"],
  ["/v2/gateways", "/v3/gateways"],
  ["/v2/mcp", "/v3/mcp"],
  ["/v2/analytics", "/v3/metrics"],
  ["/v2/approvals", "/v3/approval"],
  ["/v2/settings", "/v3/settings"],
  ["/v2/admin", "/v3/admin"],
  ["/v2/*", "/v3/home"],
];

function LinkChannelRoute() {
  const auth = useAuth();

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
        <p className="text-zinc-400">Sign in with your Xyne Spaces account to link this channel.</p>
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
      <main className="mx-auto max-w-6xl px-6 py-8">
        <LinkChannelPage userEmail={auth.user.email} />
      </main>
    </div>
  );
}

export function App() {
  const location = useLocation();

  // Public Design links deliberately bypass every auth shell. The bearer is
  // kept in the URL fragment and validated by claw-auth's public share API.
  if (location.pathname === "/v3/design/shared") {
    return <PublicDesignSharePage />;
  }

  // Pass /v3/* straight through — AppV3 owns its own full-screen layout and auth.
  if (location.pathname.startsWith("/v3")) {
    return <AppV3 />;
  }

  return (
    <Routes>
      {/* V3 is the only surface — root drops users into the V3 home. */}
      <Route path="/" element={<RedirectTo to="/v3/home" />} />
      {/* Landing page for the "connect your account" link a messaging
          channel sends to an unknown sender. Sits outside /v3 because it
          is the first page such a person ever opens. */}
      <Route path="/link" element={<LinkChannelRoute />} />
      {LEGACY_REDIRECTS.map(([from, to]) => (
        <Route key={from} path={from} element={<RedirectTo to={to} />} />
      ))}
      <Route path="*" element={<RedirectTo to="/v3/home" />} />
    </Routes>
  );
}

/**
 * AppV3 — routing-only entry for /v3/*
 *
 * Layout has been extracted to ShellV3.tsx.
 * This file owns: auth gates, route table, and icon context.
 */
import { useState, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import clawLoginImage from "../assets/claw-login.png";
import { IconContext } from "@phosphor-icons/react";
import { useAuth } from "../hooks/useAuth";
import { checkAccess } from "../lib/api";
import { AdminStatusContext } from "./hooks/useAdminStatus";
import { SnackbarProvider } from "./components/ui/Snackbar";
import { TooltipProvider } from "./components/ui/Tooltip";
import { ShellV3 } from "./ShellV3";
import { MCPPageV3 } from "./components/MCPPageV3";
import { AgentsPageV3 } from "./components/AgentsPageV3";
import { AgentDetailPageV3 } from "./components/AgentDetailPageV3";
import { SubagentsPageV3 } from "./components/SubagentsPageV3";
import { SubagentEditPageV3 } from "./components/SubagentEditPageV3";
import { SkillsPageV3 } from "./components/SkillsPageV3";
import { GatewaysPageV3 } from "./components/GatewaysPageV3";
import { SettingsPageV3 } from "./components/SettingsPageV3";
import { OrganizationsPageV3 } from "./components/OrganizationsPageV3";
import { ChatPageV3 } from "./components/ChatPageV3";
import { HomePageV3 } from "./components/home/HomePageV3";
import { AgentsDashboardPageV3 } from "./components/AgentsDashboardPageV3";
import { WorkflowsPageV3 } from "./components/WorkflowsPageV3";
import { DigitalTwinPageV3 } from "./components/digital-twin/DigitalTwinPageV3";
import { AdminPageV3 } from "./components/AdminPageV3";
import { MetricsPageV3 } from "./components/MetricsPageV3";
import { RunsPageV3 } from "./components/RunsPageV3";
import { EvalsPageV3 } from "./components/EvalsPageV3";
import { SearchEvalsPageV3 } from "./components/SearchEvalsPageV3";
import { EntityTypesPageV3 } from "./components/EntityTypesPageV3";
import { ErrorPipelinePageV3 } from "./components/ErrorPipelinePageV3";
import { CliLoginPageV3 } from "./components/CliLoginPageV3";
import { DigitalTwinUserControlsPageV3 } from "./components/DigitalTwinUserControlsPageV3";
import { ChatProvider } from "./hooks/useChat";


export function AppV3() {
  const auth = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [hasSearchEvalAccess, setHasSearchEvalAccess] = useState(false);
  const [isAdminLoading, setIsAdminLoading] = useState(true);
  const authUserId = auth.status === "authenticated" ? auth.user.id : null;

  useEffect(() => {
    if (!authUserId) return;
    setIsAdminLoading(true);
    checkAccess(authUserId)
      .then(({ isAdmin, hasSearchEvalAccess }) => {
        setIsAdmin(isAdmin);
        setHasSearchEvalAccess(hasSearchEvalAccess);
      })
      .catch(() => {
        setIsAdmin(false);
        setHasSearchEvalAccess(false);
      })
      .finally(() => setIsAdminLoading(false));
  }, [authUserId]);

  if (auth.status === "loading") {
    return (
      <div data-id="app-loading-screen" className="flex h-screen items-center justify-center bg-xyne-surface text-sm text-xyne-fg-tertiary">
        Loading…
      </div>
    );
  }

  if (auth.status === "unauthenticated") {
    return (
      <div data-id="app-login-screen" className="flex h-screen overflow-hidden">

        <div data-id="login-left" className="hidden w-1/2 shrink-0 bg-xyne-surface p-[56px] md:flex">
          <div data-id="login-left-image" className="flex-1 overflow-hidden rounded-[40px]">
            <img src={clawLoginImage} alt="" className="h-full w-full object-cover" />
          </div>
        </div>

        <div data-id="login-right" className="flex w-full flex-col bg-xyne-surface md:w-1/2">

          <div data-id="login-right-body" className="flex flex-1 flex-col px-10 py-[56px]">

            <div data-id="login-body-top" className="flex flex-1 flex-col items-center justify-center">
              <div data-id="login-brand-block" className="flex flex-col items-center gap-3 py-[40px] text-center">
                <div className="flex items-center gap-2">
                  <img src="/claw/assets/xyne-text-logo.svg" alt="Xyne" className="h-7 w-auto" />
                  <span className="text-[26px] font-semibold text-xyne-fg-primary">Claw</span>
                </div>
                <p className="text-[14px] text-xyne-fg-muted">AI agent workspace for your team</p>
              </div>
            </div>

            <div data-id="login-body-bottom" className="flex flex-1 flex-col items-center justify-start gap-[56px]">

              <div data-id="login-welcome-block" className="flex flex-col items-center gap-1 text-center">
                <h2 className="text-[20px] font-semibold text-xyne-fg-primary">Welcome back</h2>
                <p className="text-[14px] text-xyne-fg-muted">Sign in and continue using your Xyne login account</p>
              </div>

              <div data-id="login-signin-block" className="flex w-full max-w-[320px] flex-col items-center gap-3">
              <button
                data-id="app-login-google-btn"
                onClick={auth.login}
                className="flex h-14 w-full items-center justify-center gap-3 rounded-full bg-xyne-fg-primary px-5 text-[14px] font-medium text-xyne-fg-inverse shadow-sm transition-colors hover:opacity-90 dark:border dark:border-white dark:bg-white dark:text-xyne-surface dark:hover:bg-white/90"
              >
                <svg width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M47.532 24.552c0-1.636-.132-3.2-.388-4.698H24.48v8.882h12.954c-.558 3.006-2.252 5.554-4.8 7.262v6.036h7.768c4.546-4.184 7.13-10.348 7.13-17.482z" fill="#4285F4"/>
                  <path d="M24.48 48c6.502 0 11.954-2.156 15.938-5.836l-7.768-6.036c-2.156 1.444-4.912 2.296-8.17 2.296-6.282 0-11.6-4.242-13.504-9.942H2.94v6.234C6.906 42.86 15.1 48 24.48 48z" fill="#34A853"/>
                  <path d="M10.976 28.482A14.44 14.44 0 0 1 10.224 24c0-1.558.268-3.072.752-4.482v-6.234H2.94A23.934 23.934 0 0 0 .48 24c0 3.87.928 7.532 2.46 10.716l8.036-6.234z" fill="#FBBC05"/>
                  <path d="M24.48 9.576c3.54 0 6.718 1.216 9.218 3.606l6.914-6.914C36.424 2.376 30.972 0 24.48 0 15.1 0 6.906 5.14 2.94 13.284l8.036 6.234c1.904-5.7 7.222-9.942 13.504-9.942z" fill="#EA4335"/>
                </svg>
                Sign in with Google
              </button>
              </div>

            </div>
          </div>

          <div data-id="login-right-footer" className="shrink-0 px-10 py-5">
            <p className="text-center text-[12px] text-xyne-fg-muted">
              © {new Date().getFullYear()} Xyne · By signing in you agree to our Terms of Service
            </p>
          </div>

        </div>
      </div>
    );
  }

  const userId = auth.user.id;

  return (
    <AdminStatusContext.Provider value={{ isAdmin, isAdminLoading, hasSearchEvalAccess }}>
    <SnackbarProvider>
      <TooltipProvider>
        <IconContext.Provider value={{ weight: "regular" }}>
          <ChatProvider>
          {/* Standalone OAuth-approve page — rendered OUTSIDE the app shell so
              the card centers on a clean full-viewport page (no sidebar/nav),
              matching device-authorization UX (GitHub/Vercel style). */}
          <Routes>
            <Route path="/v3/cli-login" element={<CliLoginPageV3 />} />
            <Route path="*" element={
          <ShellV3 isAdmin={isAdmin} hasSearchEvalAccess={hasSearchEvalAccess}>
          <Routes>
            <Route path="/v3" element={<Navigate to="/v3/home" replace />} />
            <Route path="/v3/home" element={
              <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                <HomePageV3 userId={userId} />
              </div>
            } />
            {/* MCP manages its own two-panel card layout */}
            <Route path="/v3/mcp" element={<MCPPageV3 userId={userId} />} />
            {/* All other routes get a single full card */}
            <Route path="/v3/agents" element={
              <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                <AgentsPageV3 userId={userId} isAdmin={isAdmin} />
              </div>
            } />
            <Route path="/v3/agents/:slug" element={
              <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                <AgentDetailPageV3 userId={userId} isAdmin={isAdmin} />
              </div>
            } />
            <Route path="/v3/subagents" element={
              <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                <SubagentsPageV3 userId={userId} />
              </div>
            } />
            <Route path="/v3/subagents/:name" element={
              <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                <SubagentEditPageV3 userId={userId} isAdmin={isAdmin} />
              </div>
            } />
            <Route path="/v3/skills" element={
              <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                <SkillsPageV3 isAdmin={isAdmin} />
              </div>
            } />
            <Route path="/v3/gateways" element={
              <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                <GatewaysPageV3 />
              </div>
            } />
            <Route path="/v3/settings" element={
              <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                <SettingsPageV3 />
              </div>
            } />
            <Route path="/v3/organizations" element={
              <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                <OrganizationsPageV3 userId={userId} />
              </div>
            } />
            <Route
              path="/v3/configurations/digital-twin"
              element={
                isAdmin ? (
                  <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                    <DigitalTwinUserControlsPageV3 userId={userId} />
                  </div>
                ) : isAdminLoading ? null : (
                  <Navigate to="/v3/home" replace />
                )
              }
            />
            {/* Ungated: a non-admin gets their own runs, which is the point of
                the page. The only elevated control ("All users") is hidden by
                isAdmin in the component and re-checked server-side. */}
            <Route path="/v3/runs" element={
              <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                <RunsPageV3 userId={userId} />
              </div>
            } />
            <Route path="/v3/metrics" element={
              <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                <MetricsPageV3 userId={userId} />
              </div>
            } />
            <Route path="/v3/evals" element={
              isAdmin ? (
                <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                  <EvalsPageV3 userId={userId} />
                </div>
              ) : isAdminLoading ? null : (
                <Navigate to="/v3/home" replace />
              )
            } />
            <Route path="/v3/search-evals" element={
              hasSearchEvalAccess ? (
                <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                  <SearchEvalsPageV3 userId={userId} />
                </div>
              ) : isAdminLoading ? null : (
                <Navigate to="/v3/home" replace />
              )
            } />
            <Route path="/v3/entity-types" element={
              isAdmin ? (
                <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                  <EntityTypesPageV3 userId={userId} />
                </div>
              ) : isAdminLoading ? null : (
                <Navigate to="/v3/home" replace />
              )
            } />
            {/* Viewable by everyone (shareable error links); bucket controls
                inside the page are disabled for non-admins. */}
            <Route path="/v3/error-pipeline" element={
              <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                <ErrorPipelinePageV3 userId={userId} />
              </div>
            } />
            <Route path="/v3/digital-twin" element={
              <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                <DigitalTwinPageV3 userId={userId} />
              </div>
            } />
            <Route path="/v3/chat" element={
              <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                <ChatPageV3 />
              </div>
            } />
            <Route path="/v3/design" element={
              <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                {/* Keep Design's active draft separate from the normal Chat
                    destination while reusing the same chat runtime/API. */}
                <ChatProvider>
                  <ChatPageV3 mode="design" />
                </ChatProvider>
              </div>
            } />
            <Route path="/v3/workflows" element={
              <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                <WorkflowsPageV3 userId={userId} />
              </div>
            } />
            <Route path="/v3/approval" element={<Navigate to="/v3/dashboard" replace />} />

            <Route
              path="/v3/admin"
              element={
                isAdmin ? (
                  <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                    <AdminPageV3 userId={userId} />
                  </div>
                ) : (
                  <Navigate to="/v3/home" replace />
                )
              }
            />

            <Route
              path="/v3/dashboard"
              element={
                <div className="flex flex-1 flex-col overflow-hidden rounded-xl bg-xyne-surface shadow-sm">
                  <AgentsDashboardPageV3 userId={userId} />
                </div>
              }
            />
            {/* /v3/projects merged into /v3/dashboard — kept as a
                redirect for back-compat with existing bookmarks. */}
            <Route path="/v3/projects" element={<Navigate to="/v3/dashboard" replace />} />
          </Routes>
        </ShellV3>
            } />
          </Routes>
          </ChatProvider>
        </IconContext.Provider>
      </TooltipProvider>
    </SnackbarProvider>
    </AdminStatusContext.Provider>
  );
}

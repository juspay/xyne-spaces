import { useCallback, useEffect, useState } from "react";
import { SlackLogoIcon } from "@phosphor-icons/react";

import {
  listOrgSurfaces,
  storeSlackConfigToken,
  type ConnectedSurface,
  type OrgDetail,
} from "../../lib/api";
import { Button } from "./ui/Button";
import { TextField } from "./ui/TextField";
import { useSnackbar } from "./ui/Snackbar";

function teamName(connection: ConnectedSurface | undefined): string | null {
  const value = connection?.config?.["teamName"];
  return typeof value === "string" && value.trim() ? value : null;
}

export function SurfacesCard({ userId, org }: { userId: string; org: OrgDetail }) {
  const { show } = useSnackbar();
  const [surfaces, setSurfaces] = useState<ConnectedSurface[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [saving, setSaving] = useState(false);

  const loadSurfaces = useCallback(async () => {
    setLoading(true);
    try {
      setSurfaces(await listOrgSurfaces(userId, org.id));
    } catch (error) {
      show({ variant: "error", title: error instanceof Error ? error.message : "Failed to load surfaces" });
    } finally {
      setLoading(false);
    }
  }, [org.id, show, userId]);

  useEffect(() => { void loadSurfaces(); }, [loadSurfaces]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("slack_connected");
    const error = params.get("slack_error");
    if (!connected && !error) return;

    if (connected === "true") {
      show({ variant: "success", title: "Slack workspace connected" });
    } else if (error) {
      show({
        variant: "error",
        title: `Slack connection failed: ${error.replaceAll("_", " ")}`,
      });
    }
    params.delete("slack_connected");
    params.delete("slack_error");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }, [show]);

  const slackConfig = surfaces.find((connection) => connection.surface.key === "slack" && connection.surfaceTenantId === "");
  const slackWorkspace = surfaces.find((connection) => connection.surface.key === "slack" && connection.surfaceTenantId !== "");
  const slackTeam = teamName(slackWorkspace);
  const tokenStatus = slackConfig?.config?.["configTokenStatus"];
  const status = tokenStatus === "valid" || tokenStatus === "expired" || tokenStatus === "present"
    ? tokenStatus
    : null;

  const connectSlack = async () => {
    if (!accessToken.trim() || !refreshToken.trim()) return;
    setSaving(true);
    try {
      await storeSlackConfigToken(org.id, accessToken.trim(), refreshToken.trim());
      setAccessToken("");
      setRefreshToken("");
      show({ variant: "success", title: "Slack configuration token connected" });
      await loadSurfaces();
    } catch (error) {
      show({ variant: "error", title: error instanceof Error ? error.message : "Failed to connect Slack" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-6 rounded-lg border border-xyne-border-subtle p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-2">
          <SlackLogoIcon size={17} className="mt-0.5 shrink-0 text-xyne-fg-secondary" />
          <div>
            <h2 className="text-[13px] font-semibold text-xyne-fg-primary">Surfaces</h2>
            <p className="mt-1 text-[12px] text-xyne-fg-muted">
              Connect your organization to Slack for agent mentions and direct messages.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <TextField
          label="Configuration access token"
          type="password"
          autoComplete="off"
          placeholder="xoxe.xoxp-…"
          value={accessToken}
          onChange={(event) => setAccessToken(event.target.value)}
        />
        <TextField
          label="Configuration refresh token"
          type="password"
          autoComplete="off"
          placeholder="xoxe-1-…"
          value={refreshToken}
          onChange={(event) => setRefreshToken(event.target.value)}
        />
        <Button
          variant="primary"
          size="sm"
          disabled={loading || saving || !accessToken.trim() || !refreshToken.trim()}
          onClick={() => { void connectSlack(); }}
        >
          {saving ? "Connecting…" : status ? "Replace token" : "Connect Slack"}
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-xyne-fg-muted">
        Paste the pair from api.slack.com/apps → Your App Configuration Tokens. The refresh token is rotated immediately.
      </p>

      <div className="mt-4 rounded-lg border border-xyne-border-subtle px-4 py-3">
        {loading ? (
          <p className="text-[13px] text-xyne-fg-muted">Loading…</p>
        ) : status ? (
          <div>
            <p className="text-[13px] font-medium text-xyne-fg-primary">Slack</p>
            <p className="mt-1 text-[12px] text-xyne-fg-muted">
              Configuration token: {status}{slackTeam ? ` · Installed in ${slackTeam}` : ""}
            </p>
          </div>
        ) : (
          <div>
            <p className="text-[13px] font-medium text-xyne-fg-primary">Slack</p>
            <p className="mt-1 text-[12px] text-xyne-fg-muted">Not connected</p>
          </div>
        )}
      </div>
    </section>
  );
}

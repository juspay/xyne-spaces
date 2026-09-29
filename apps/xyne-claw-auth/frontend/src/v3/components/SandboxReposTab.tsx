import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deleteSandboxRepoConfig,
  listSandboxRepoConfigs,
  saveSandboxRepoConfig,
  type SandboxRepoConfigRow,
} from "../../lib/api";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { Switch } from "./ui/Switch";
import { TextField } from "./ui/TextField";
import { useSnackbar } from "./ui/Snackbar";

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const NEW_REPO_TEMPLATE = {
  slug: "sandbox-my-repo-setup",
  name: "My Repo Sandbox Setup",
  description: "What this sandbox provides, shown to the agent.",
  repoUrl: "git@github.com:org/my-repo.git",
  defaultBranch: "main",
  cloneDepth: 1,
  workDir: "/workspace/my-repo",
  template: "my-repo-workspace-template",
  sessionTimeoutMs: 7_200_000,
  idleTimeoutMs: 3_600_000,
  steps: [],
  ports: {},
};

interface Props {
  userId: string;
}

interface Draft {
  key: string;
  isNew: boolean;
  enabled: boolean;
  text: string;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function SandboxReposTab({ userId }: Props) {
  const { show: showSnackbar } = useSnackbar();
  const [rows, setRows] = useState<SandboxRepoConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listSandboxRepoConfigs(userId));
    } catch (err) {
      showSnackbar({ variant: "error", title: "Failed to load sandbox repos", description: errorText(err) });
    } finally {
      setLoading(false);
    }
  }, [userId, showSnackbar]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedRow = useMemo(
    () => (draft && !draft.isNew ? rows.find((row) => row.key === draft.key) ?? null : null),
    [draft, rows],
  );

  const openRow = (row: SandboxRepoConfigRow) => {
    setParseError(null);
    setDraft({ key: row.key, isNew: false, enabled: row.enabled, text: JSON.stringify(row.config, null, 2) });
  };

  const openNew = () => {
    setParseError(null);
    setDraft({ key: "", isNew: true, enabled: true, text: JSON.stringify(NEW_REPO_TEMPLATE, null, 2) });
  };

  const save = async () => {
    if (!draft) return;
    const key = draft.key.trim();
    if (!KEY_PATTERN.test(key)) {
      setParseError("Key must be lowercase letters, digits, '.', '_' or '-' (max 64 chars).");
      return;
    }
    if (draft.isNew && rows.some((row) => row.key === key)) {
      setParseError(`"${key}" already exists — select it in the list to edit.`);
      return;
    }
    let config: unknown;
    try {
      config = JSON.parse(draft.text);
    } catch (err) {
      setParseError(`Invalid JSON: ${errorText(err)}`);
      return;
    }
    setParseError(null);
    setSaving(true);
    try {
      await saveSandboxRepoConfig(userId, key, { config, enabled: draft.enabled });
      showSnackbar({ variant: "success", title: `Saved "${key}"`, description: "Agents pick it up within about a minute." });
      await load();
      setDraft({ ...draft, key, isNew: false });
    } catch (err) {
      setParseError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!draft) return;
    setConfirmDelete(false);
    setSaving(true);
    try {
      await deleteSandboxRepoConfig(userId, draft.key);
      showSnackbar({
        variant: "success",
        title: selectedRow?.hasDefault ? `"${draft.key}" reset to default` : `"${draft.key}" removed`,
      });
      await load();
      setDraft(null);
    } catch (err) {
      showSnackbar({ variant: "error", title: "Delete failed", description: errorText(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-2xl text-[13px] text-xyne-fg-muted">
          Sandbox repositories used by <code>sandbox-repo-setup</code> and the agent &quot;Sandbox repository&quot; pin.
          Stored configs override the built-in defaults with the same key; disabling one hides it from agents. The
          sandbox template itself (snapshot, prebake, warmpool) still has to exist in the cluster.
        </p>
        <Button variant="primary" size="sm" onClick={openNew}>
          New repo
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <div className="flex flex-col overflow-hidden rounded-lg border border-xyne-border">
          {loading && <div className="p-4 text-[13px] text-xyne-fg-muted">Loading…</div>}
          {!loading && rows.length === 0 && <div className="p-4 text-[13px] text-xyne-fg-muted">No repos configured.</div>}
          {!loading &&
            rows.map((row) => (
              <button
                key={row.key}
                type="button"
                onClick={() => openRow(row)}
                className={`flex items-center justify-between gap-2 border-b border-xyne-border px-3 py-2 text-left text-[13px] last:border-b-0 hover:bg-xyne-surface-subtle ${
                  draft && !draft.isNew && draft.key === row.key ? "bg-xyne-surface-subtle" : ""
                }`}
              >
                <span className="truncate font-medium">{row.key}</span>
                <span className="flex shrink-0 gap-1">
                  <Badge
                    as="span"
                    size="sm"
                    variant={row.source === "database" ? "info" : "neutral"}
                    label={row.source === "database" ? (row.hasDefault ? "Override" : "Custom") : "Default"}
                  />
                  {!row.active && <Badge as="span" size="sm" variant="warning" label="Disabled" />}
                </span>
              </button>
            ))}
        </div>

        <div className="rounded-lg border border-xyne-border p-4">
          {!draft && <div className="text-[13px] text-xyne-fg-muted">Select a repo to edit, or create a new one.</div>}
          {draft && (
            <div className="flex flex-col gap-3">
              {draft.isNew ? (
                <TextField
                  label="Key"
                  value={draft.key}
                  placeholder="my-repo"
                  onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                />
              ) : (
                <div className="flex items-center gap-2 text-[14px] font-semibold">
                  {draft.key}
                  {selectedRow && (
                    <span className="text-[12px] font-normal text-xyne-fg-muted">
                      {selectedRow.source === "database"
                        ? `stored${selectedRow.updatedAt ? ` · updated ${new Date(selectedRow.updatedAt).toLocaleString()}` : ""}`
                        : "built-in default — saving creates an override"}
                    </span>
                  )}
                </div>
              )}

              <label className="flex items-center gap-2 text-[13px]">
                <Switch
                  checked={draft.enabled}
                  onChange={(enabled) => setDraft({ ...draft, enabled })}
                  ariaLabel="Enabled"
                />
                Enabled
              </label>

              <textarea
                value={draft.text}
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                spellCheck={false}
                aria-label="Repo setup config JSON"
                className="min-h-[420px] w-full rounded-md border border-xyne-border bg-xyne-surface-subtle p-3 font-mono text-[12px] leading-5 outline-none focus:border-xyne-border-strong"
              />

              {parseError && (
                <div role="alert" className="text-[12px] text-xyne-error-fg">
                  {parseError}
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <div>
                  {selectedRow?.source === "database" && (
                    <Button variant="ghost" size="sm" disabled={saving} onClick={() => setConfirmDelete(true)}>
                      {selectedRow.hasDefault ? "Reset to default" : "Delete"}
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" disabled={saving} onClick={() => setDraft(null)}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" disabled={saving} onClick={() => void save()}>
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={selectedRow?.hasDefault ? `Reset "${draft?.key}" to default?` : `Delete "${draft?.key}"?`}
        description={
          selectedRow?.hasDefault
            ? "The stored override is removed and agents go back to the built-in config."
            : "Agents pinned to this repo will no longer be able to set up its sandbox."
        }
        confirmLabel={selectedRow?.hasDefault ? "Reset" : "Delete"}
        danger
        onConfirm={() => void remove()}
      />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BrainIcon,
  MagnifyingGlassIcon,
  SpinnerGapIcon,
  ArrowClockwiseIcon,
  DatabaseIcon,
} from "@phosphor-icons/react";
import {
  adminDisableDigitalTwinForUser,
  adminEnableDigitalTwinForUser,
  adminStartDigitalTwinBackfillForUser,
  listAdminDigitalTwinUsers,
  type AdminDigitalTwinBackfillWindow,
  type AdminDigitalTwinUser,
  type AdminDigitalTwinUsersPage,
} from "../../lib/api";
import { PageLayout } from "./ui/PageLayout";
import { PageHeader } from "./ui/PageHeader";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Switch } from "./ui/Switch";
import { TextField } from "./ui/TextField";
import { SelectField } from "./ui/SelectField";
import { Dialog } from "./ui/Dialog";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { useSnackbar } from "./ui/Snackbar";

type StatusFilter = "all" | "enabled" | "disabled";
type SortOption = "name_asc" | "name_desc" | "email_asc" | "recently_enabled";
type PageSize = 10 | 25 | 50 | 100;
type BackfillPreset = "none" | "1" | "3" | "6" | "12" | "24" | "custom";

const EMPTY_PAGE: AdminDigitalTwinUsersPage = {
  rows: [],
  total: 0,
  limit: 25,
  offset: 0,
  summary: { enabled: 0, disabled: 0, total: 0 },
  organizations: [],
};

function dateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function presetWindow(preset: BackfillPreset, customFrom: string, customTo: string): AdminDigitalTwinBackfillWindow | null {
  if (preset === "none") return null;
  if (preset === "custom") {
    if (!customFrom || !customTo) throw new Error("Choose both custom backfill dates");
    const from = new Date(`${customFrom}T00:00:00`);
    const to = new Date(`${customTo}T23:59:59.999`);
    if (from > to) throw new Error("Backfill start date must be before the end date");
    const earliestAllowed = new Date(to);
    earliestAllowed.setMonth(earliestAllowed.getMonth() - 24);
    if (from < earliestAllowed) throw new Error("Backfill range cannot exceed 24 months");
    return { from: from.toISOString(), to: to.toISOString() };
  }
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - Number(preset));
  return { from: from.toISOString(), to: to.toISOString() };
}

function backfillBadge(user: AdminDigitalTwinUser): { label: string; variant: "neutral" | "success" | "warning" | "error" | "info" } {
  const status = user.backfill.status;
  if (status === "running") return { label: `Running${user.backfill.progressPct != null ? ` · ${user.backfill.progressPct}%` : ""}`, variant: "info" };
  if (status === "paused") return { label: "Paused", variant: "warning" };
  if (status === "complete") return { label: "Complete", variant: "success" };
  if (status === "error") return { label: "Error", variant: "error" };
  return { label: "Not started", variant: "neutral" };
}

export function DigitalTwinUserControlsPageV3({ userId }: { userId: string }) {
  const { show: showSnackbar } = useSnackbar();
  const [page, setPage] = useState(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [orgId, setOrgId] = useState("");
  const [sort, setSort] = useState<SortOption>("name_asc");
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [offset, setOffset] = useState(0);
  const [disableTarget, setDisableTarget] = useState<AdminDigitalTwinUser | null>(null);
  const [lifecycleAction, setLifecycleAction] = useState<{
    kind: "enable" | "backfill";
    user: AdminDigitalTwinUser;
  } | null>(null);
  const [backfillPreset, setBackfillPreset] = useState<BackfillPreset>("none");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState(dateInputValue(new Date()));
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  /** Selected user ids for bulk enable/disable. Keyed by id rather than row
   *  index so a selection survives sorting and refresh; cleared when the filter
   *  changes, because "select all" would otherwise mean something different
   *  from what is on screen. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ mode: "enable" | "disable"; ids: string[] } | null>(null);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0, failed: 0 });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOffset(0);
      setSearch(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async (quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    try {
      setPage(await listAdminDigitalTwinUsers(userId, {
        search: search || undefined,
        status,
        orgId: orgId || undefined,
        sort,
        limit: pageSize,
        offset,
      }));
    } catch (error) {
      showSnackbar({
        variant: "error",
        title: error instanceof Error ? error.message : "Failed to load Digital Twin users",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, search, status, orgId, sort, pageSize, offset, showSnackbar]);

  useEffect(() => { void load(); }, [load]);
  // A selection that outlived its filter is a footgun — the ids stay valid but
  // stop matching what the operator can see.
  useEffect(() => { setSelected(new Set()); }, [search, status, orgId, offset, pageSize]);

  const organizationOptions = useMemo(
    () => [{ value: "", label: "All organizations" }, ...page.organizations.map((org) => ({ value: org.id, label: org.name }))],
    [page.organizations],
  );

  const pageIds = useMemo(() => page.rows.map((r) => r.id), [page.rows]);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectedRows = useMemo(
    () => page.rows.filter((r) => selected.has(r.id)),
    [page.rows, selected],
  );
  const selectedEnabled = selectedRows.filter((r) => r.enabled).length;
  const selectedDisabled = selectedRows.length - selectedEnabled;

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleAllOnPage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });

  /**
   * Apply enable/disable across many users.
   *
   * Sequential, not parallel: each enable can kick off a backfill job, and
   * firing N of those at once would flood the queue the same way the memory
   * import flooded Hindsight. Failures are counted and the run continues, so
   * one bad user cannot abort the batch — the summary reports what actually
   * landed rather than claiming the whole thing worked.
   *
   * Bulk enable never starts a backfill (null window). Backfilling is a heavy,
   * per-user decision and is still available on the individual row.
   */
  const runBulk = async () => {
    if (!bulk) return;
    const { mode, ids } = bulk;
    setSaving(true);
    setBulkProgress({ done: 0, total: ids.length, failed: 0 });
    let failed = 0;
    for (let i = 0; i < ids.length; i++) {
      try {
        if (mode === "enable") await adminEnableDigitalTwinForUser(userId, ids[i]!, null);
        else await adminDisableDigitalTwinForUser(userId, ids[i]!);
      } catch {
        failed += 1;
      }
      setBulkProgress({ done: i + 1, total: ids.length, failed });
    }
    setSaving(false);
    setBulk(null);
    setSelected(new Set());
    const ok = ids.length - failed;
    showSnackbar({
      variant: failed ? (ok ? "warning" : "error") : "success",
      title: failed
        ? `${ok} of ${ids.length} ${mode}d — ${failed} failed`
        : `${ok} user${ok === 1 ? "" : "s"} ${mode}d`,
      ...(failed ? { description: "Retry the failures; the rest are already applied." } : {}),
      duration: 7_000,
    });
    await load(true);
  };

  const openLifecycle = (kind: "enable" | "backfill", user: AdminDigitalTwinUser) => {
    setLifecycleAction({ kind, user });
    setBackfillPreset(kind === "enable" ? "none" : "3");
    setCustomFrom("");
    setCustomTo(dateInputValue(new Date()));
    setActionError("");
  };

  const runLifecycleAction = async () => {
    if (!lifecycleAction) return;
    setActionError("");
    setSaving(true);
    try {
      const window = presetWindow(backfillPreset, customFrom, customTo);
      if (lifecycleAction.kind === "enable") {
        await adminEnableDigitalTwinForUser(userId, lifecycleAction.user.id, window);
        showSnackbar({
          variant: "success",
          title: `${lifecycleAction.user.name}'s Digital Twin enabled${window ? " and backfill started" : ""}`,
        });
      } else {
        if (!window) throw new Error("Choose a backfill window");
        await adminStartDigitalTwinBackfillForUser(userId, lifecycleAction.user.id, window);
        showSnackbar({ variant: "success", title: `Backfill started for ${lifecycleAction.user.name}` });
      }
      setLifecycleAction(null);
      await load(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Action failed");
    } finally {
      setSaving(false);
    }
  };

  const confirmDisable = async () => {
    if (!disableTarget) return;
    const target = disableTarget;
    setSaving(true);
    try {
      await adminDisableDigitalTwinForUser(userId, target.id);
      showSnackbar({ variant: "success", title: `${target.name}'s Digital Twin disabled` });
      setDisableTarget(null);
      await load(true);
    } catch (error) {
      showSnackbar({
        variant: "error",
        title: error instanceof Error ? error.message : "Failed to disable Digital Twin",
      });
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(page.total / pageSize));
  const currentPage = Math.floor(offset / pageSize) + 1;

  return (
    <>
    <PageLayout
      header={
        <PageHeader
          title="Digital Twin user controls"
          description="CLAW_ADMIN-only controls for user opt-in and memory backfills."
          icon={<BrainIcon size={22} className="text-xyne-brand" />}
          actions={
            <Button
              size="sm"
              variant="secondary"
              disabled={refreshing}
              leadingIcon={<ArrowClockwiseIcon size={14} className={refreshing ? "animate-spin" : ""} />}
              onClick={() => void load(true)}
            >
              Refresh
            </Button>
          }
        />
      }
      body={
        <div data-id="digital-twin-user-controls" className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryCard label="All users" value={page.summary.total} />
            <SummaryCard label="Twin enabled" value={page.summary.enabled} tone="success" />
            <SummaryCard label="Twin disabled" value={page.summary.disabled} tone="muted" />
          </div>

          <div className="rounded-xl border border-xyne-border bg-xyne-surface p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[240px] flex-1">
                <TextField
                  label="Search users"
                  placeholder="Name, email, or user ID"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                />
              </div>
              <SelectField
                label="Twin status"
                className="w-[170px]"
                value={status}
                options={[
                  { value: "all", label: "All statuses" },
                  { value: "enabled", label: "Enabled" },
                  { value: "disabled", label: "Disabled" },
                ]}
                onValueChange={(value) => { setOffset(0); setStatus((value ?? "all") as StatusFilter); }}
              />
              <SelectField
                label="Organization"
                className="w-[210px]"
                value={orgId}
                options={organizationOptions}
                onValueChange={(value) => { setOffset(0); setOrgId(value ?? ""); }}
              />
              <SelectField
                label="Sort"
                className="w-[180px]"
                value={sort}
                options={[
                  { value: "name_asc", label: "Name A–Z" },
                  { value: "name_desc", label: "Name Z–A" },
                  { value: "email_asc", label: "Email A–Z" },
                  { value: "recently_enabled", label: "Recently enabled" },
                ]}
                onValueChange={(value) => { setOffset(0); setSort((value ?? "name_asc") as SortOption); }}
              />
              <SelectField
                label="Rows"
                className="w-[105px]"
                value={String(pageSize)}
                options={[10, 25, 50, 100].map((value) => ({ value: String(value), label: String(value) }))}
                onValueChange={(value) => { setOffset(0); setPageSize(Number(value ?? 25) as PageSize); }}
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-xyne-border bg-xyne-surface">
            {/* Bulk action bar — only present when something is selected, so the
                default view stays a plain table. Counts are split by current
                state so the operator can see that "Enable" will only move the
                N that are actually off. */}
            {selected.size > 0 && (
              <div className="flex flex-wrap items-center gap-3 border-b border-xyne-border bg-xyne-surface-subtle px-4 py-3">
                <span className="text-[12px] font-medium text-xyne-fg-primary">
                  {selected.size} selected
                </span>
                <span className="text-[11px] text-xyne-fg-tertiary">
                  {selectedDisabled} off · {selectedEnabled} on
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={saving || selectedDisabled === 0}
                    onClick={() =>
                      setBulk({ mode: "enable", ids: selectedRows.filter((r) => !r.enabled).map((r) => r.id) })
                    }
                  >
                    Enable {selectedDisabled > 0 ? selectedDisabled : ""}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={saving || selectedEnabled === 0}
                    onClick={() =>
                      setBulk({ mode: "disable", ids: selectedRows.filter((r) => r.enabled).map((r) => r.id) })
                    }
                  >
                    Disable {selectedEnabled > 0 ? selectedEnabled : ""}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={saving} onClick={() => setSelected(new Set())}>
                    Clear
                  </Button>
                </div>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-xyne-fg-muted">
                <SpinnerGapIcon size={16} className="animate-spin" /> Loading users…
              </div>
            ) : page.rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <MagnifyingGlassIcon size={22} className="text-xyne-fg-tertiary" />
                <p className="text-[13px] text-xyne-fg-muted">No users match these filters.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[960px] w-full text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-xyne-border bg-xyne-surface-subtle text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">
                      <th className="w-[36px] px-4 py-3">
                        <input
                          type="checkbox"
                          checked={allOnPageSelected}
                          onChange={toggleAllOnPage}
                          aria-label={allOnPageSelected ? "Clear selection on this page" : "Select all users on this page"}
                          className="cursor-pointer"
                        />
                      </th>
                      <th className="px-4 py-3 font-medium">User</th>
                      <th className="px-4 py-3 font-medium">Organization</th>
                      <th className="px-4 py-3 font-medium">Digital Twin</th>
                      <th className="px-4 py-3 font-medium">Last enabled</th>
                      <th className="px-4 py-3 font-medium">Backfill</th>
                      <th className="px-4 py-3 text-right font-medium">Controls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.rows.map((user) => {
                      const backfill = backfillBadge(user);
                      return (
                        <tr
                          key={user.id}
                          className={`border-b border-xyne-border-subtle last:border-b-0 hover:bg-xyne-surface-subtle/40 ${
                            selected.has(user.id) ? "bg-xyne-surface-subtle/60" : ""
                          }`}
                        >
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={selected.has(user.id)}
                              onChange={() => toggleOne(user.id)}
                              aria-label={`Select ${user.name}`}
                              className="cursor-pointer"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-xyne-fg-primary">{user.name}</div>
                            <div className="text-[11px] text-xyne-fg-muted">{user.email}</div>
                            <div className="max-w-[220px] truncate font-mono text-[10px] text-xyne-fg-tertiary" title={user.id}>{user.id}</div>
                          </td>
                          <td className="px-4 py-3 text-xyne-fg-secondary">{user.orgName}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={user.enabled}
                                disabled={saving}
                                ariaLabel={`${user.enabled ? "Disable" : "Enable"} Digital Twin for ${user.name}`}
                                onChange={(enabled) => enabled ? openLifecycle("enable", user) : setDisableTarget(user)}
                              />
                              <Badge as="span" size="sm" variant={user.enabled ? "success" : "neutral"} label={user.enabled ? "Enabled" : "Disabled"} />
                            </div>
                          </td>
                          <td className="px-4 py-3 text-[11px] text-xyne-fg-muted">
                            {user.enabledAt ? new Date(user.enabledAt).toLocaleString() : "—"}
                          </td>
                          <td className="px-4 py-3">
                            <Badge as="span" size="sm" variant={backfill.variant} label={backfill.label} />
                            {user.backfill.from && user.backfill.to && (
                              <div className="mt-1 text-[10px] text-xyne-fg-tertiary">
                                {new Date(user.backfill.from).toLocaleDateString()} – {new Date(user.backfill.to).toLocaleDateString()}
                              </div>
                            )}
                            {user.backfill.lastError && (
                              <div className="mt-1 max-w-[240px] truncate text-[10px] text-xyne-error-fg" title={user.backfill.lastError}>{user.backfill.lastError}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={!user.enabled || saving}
                                leadingIcon={<DatabaseIcon size={13} />}
                                onClick={() => openLifecycle("backfill", user)}
                              >
                                Start backfill
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-xyne-fg-muted">
            <div>
              {page.total === 0 ? "0 users" : `${offset + 1}–${Math.min(offset + pageSize, page.total)} of ${page.total} users`}
              <span className="ml-2">· Page {currentPage} of {totalPages}</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Previous</Button>
              <Button size="sm" variant="secondary" disabled={offset + pageSize >= page.total || loading} onClick={() => setOffset(offset + pageSize)}>Next</Button>
            </div>
          </div>

          <p className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle px-3 py-2 text-[11px] text-xyne-fg-muted">
            This page exposes no controls for user identity, organization membership, roles, memories,
            persona content, or other user settings. Enabling may seed missing default persona files as part of normal Digital Twin setup.
          </p>
        </div>
      }
      footer={null}
    />

    <Dialog
      open={lifecycleAction != null}
      onOpenChange={(open) => { if (!open && !saving) setLifecycleAction(null); }}
      title={lifecycleAction?.kind === "backfill" ? "Start Digital Twin backfill" : "Enable Digital Twin"}
      description={
        lifecycleAction
          ? `${lifecycleAction.user.name} (${lifecycleAction.user.email})`
          : undefined
      }
      maxWidth={520}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={() => setLifecycleAction(null)}>Cancel</Button>
          <Button variant="primary" disabled={saving} onClick={() => void runLifecycleAction()}>
            {saving
              ? "Saving…"
              : lifecycleAction?.kind === "backfill"
                ? "Start backfill"
                : backfillPreset === "none"
                  ? "Enable"
                  : "Enable and start backfill"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[12px] text-xyne-fg-secondary">
          {lifecycleAction?.kind === "backfill"
            ? "Choose how much existing Spaces history to process. A new backfill replaces any current backfill progress for this user."
            : "Enabling allows the user's Twin to reply to mentions and includes them in daily memory curation and persona updates."}
        </p>
        <SelectField
          label="Backfill window"
          value={backfillPreset}
          options={[
            ...(lifecycleAction?.kind === "enable" ? [{ value: "none", label: "Do not start a backfill" }] : []),
            { value: "1", label: "Last 1 month" },
            { value: "3", label: "Last 3 months" },
            { value: "6", label: "Last 6 months" },
            { value: "12", label: "Last 12 months" },
            { value: "24", label: "Last 24 months" },
            { value: "custom", label: "Custom date range" },
          ]}
          onValueChange={(value) => { setBackfillPreset((value ?? "none") as BackfillPreset); setActionError(""); }}
        />
        {backfillPreset === "custom" && (
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="From"
              type="date"
              value={customFrom}
              max={customTo || dateInputValue(new Date())}
              onChange={(event) => setCustomFrom(event.target.value)}
            />
            <TextField
              label="To"
              type="date"
              value={customTo}
              min={customFrom || undefined}
              max={dateInputValue(new Date())}
              onChange={(event) => setCustomTo(event.target.value)}
            />
          </div>
        )}
        {actionError && (
          <div className="rounded-lg border border-xyne-error-border bg-xyne-error-bg px-3 py-2 text-[11px] text-xyne-error-fg">
            {actionError}
          </div>
        )}
      </div>
    </Dialog>

    {bulk && (
      <ConfirmDialog
        open
        onOpenChange={(o) => { if (!o && !saving) setBulk(null); }}
        title={bulk.mode === "enable" ? `Enable Digital Twin for ${bulk.ids.length} users?` : `Disable Digital Twin for ${bulk.ids.length} users?`}
        description={
          bulk.mode === "enable"
            ? "Their Twins start learning from new activity. No history is backfilled — use the per-user control for that."
            : "Their Twins stop drafting replies and any running backfill is cancelled. Memories already learned are kept."
        }
        confirmLabel={
          saving
            ? `Working… ${bulkProgress.done}/${bulkProgress.total}`
            : bulk.mode === "enable" ? "Enable all" : "Disable all"
        }
        {...(bulk.mode === "disable" ? { danger: true } : {})}
        onConfirm={() => void runBulk()}
      />
    )}
    <ConfirmDialog
      open={disableTarget != null}
      onOpenChange={(open) => { if (!open && !saving) setDisableTarget(null); }}
      title="Disable Digital Twin"
      description={
        disableTarget
          ? `Disable Digital Twin for ${disableTarget.name}? Auto replies, daily curation, and persona updates will stop, and active backfill jobs will be cancelled. Existing memories and persona files will be preserved.`
          : ""
      }
      confirmLabel="Disable Digital Twin"
      danger
      onConfirm={() => void confirmDisable()}
    />
    </>
  );
}

function SummaryCard({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "success" | "muted" }) {
  return (
    <div className="rounded-xl border border-xyne-border bg-xyne-surface px-4 py-3">
      <p className="text-[11px] text-xyne-fg-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone === "success" ? "text-xyne-success-fg" : tone === "muted" ? "text-xyne-fg-secondary" : "text-xyne-fg-primary"}`}>{value}</p>
    </div>
  );
}

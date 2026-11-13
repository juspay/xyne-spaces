// Credential Vault management UI. The host supplies its authenticated workflow
// client through WorkflowUIProvider and may provide an attributes display slot.

import { useEffect, useState, type JSX } from "react"
import { createPortal } from "react-dom"
import {
  Loader2,
  X,
  Plus,
  KeyRound,
  Ban,
  Eye,
  EyeOff,
  Pencil,
  ChevronRight,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react"
import { useWorkflowClient } from '../../hooks/use-workflow-client.js'
import { useCredentialList } from '../../hooks/use-credential-list.js'
import { useSlot } from '../provider/slot-resolution.js'
import { cn } from '../shared/cn.js'
import type { CredentialAttributesDisplayProps } from '../../types/slots.js'
import {
  CREDENTIAL_AUTH_REGISTRY,
  validateCredentialAuth,
} from "@xyne/workflow-sdk/common"
import type {
  CredentialSummary,
  CredentialListItem,
  CredentialAuthType,
  ConnectorCredentialTypes,
  CredentialTypeDescriptor,
} from "@xyne/workflow-sdk/common"
import type { WorkflowClient } from '@xyne/workflow-sdk/client'
import { LoadMore } from '../shared/LoadMore.js'


type ToastHandler = (
  kind: 'success' | 'error',
  message: string,
  opts?: { action?: { label: string; onClick: () => void } },
) => void

// ─── Helpers ───

const authTypeLabel = (t: string): string =>
  CREDENTIAL_AUTH_REGISTRY.find((e) => e.type === t)?.label ?? t

/** A credential type picked in the create dialog, with its connector's name. */
type ChosenCredentialType = CredentialTypeDescriptor & { connectorName: string }

/** "Connector · Label" for a stored credential's type; the label alone for built-ins. */
const typeLabelFor = (
  types: ConnectorCredentialTypes[] | null,
  c: CredentialSummary,
): string => {
  for (const group of types ?? []) {
    const match = group.credentials.find((t) => t.credType === c.credType)
    if (match) {
      return group.connectorId === "builtin"
        ? match.label
        : `${group.connectorName} · ${match.label}`
    }
  }
  return authTypeLabel(c.authType)
}

/** A secret verifies incoming requests; there is no outbound call to test it with. */

// Compact 12-hour timestamp, e.g. "24 Jul 2026, 3:04 PM".
const fmtTime = (ms: number): string => {
  try {
    return new Date(ms).toLocaleString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
  } catch {
    return String(ms)
  }
}

const statusLabel = (s: string): string =>
  s.charAt(0) + s.slice(1).toLowerCase()

const EmptyCredentialAttributes = (
  _props: CredentialAttributesDisplayProps,
): null => null

/** Empty value map for an auth type — every registry field key set to "". */
const emptyValuesFor = (authType: CredentialAuthType): Record<string, string> => {
  const entry = CREDENTIAL_AUTH_REGISTRY.find((e) => e.type === authType)
  const out: Record<string, string> = {}
  for (const f of entry?.fields ?? []) out[f.key] = ""
  return out
}

// ─── Page ───

export interface CredentialVaultProps {
  className?: string
  onToast?: ToastHandler
}

export function CredentialVault({
  className,
  onToast,
}: CredentialVaultProps): JSX.Element {
  const workflowClient = useWorkflowClient()
  const {
    credentials,
    error: listError,
    isLoadingMore,
    hasMore,
    loadMore,
    refresh: reload,
  } = useCredentialList()
  const error = listError?.message ?? null
  const [showCreate, setShowCreate] = useState(false)
  // The credential currently targeted by the replace-values / revoke dialogs.
  const [replaceTarget, setReplaceTarget] = useState<CredentialSummary | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<CredentialSummary | null>(null)
  // Post-create success dialog target.
  const [createdTarget, setCreatedTarget] = useState<{ name: string; authType: string } | null>(null)
  // Credential types grouped by connector: what "New credential" offers, and how
  // the table names each row's type.
  const [types, setTypes] = useState<ConnectorCredentialTypes[] | null>(null)
  const [typesError, setTypesError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    workflowClient.schema
      .credentialTypes()
      .then((res) => {
        if (!cancelled) setTypes(res)
      })
      .catch((e: unknown) => {
        if (!cancelled) setTypesError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [workflowClient])

  const count = credentials?.length ?? 0

  return (
    <div className={cn("mx-auto w-full max-w-[1600px] px-8 py-10", className)}>
      <header className="mb-7 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-foreground">
            <KeyRound className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[18px] font-semibold tracking-tight text-foreground">
                Credential Vault
              </h1>
              {count > 0 && (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {count}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Securely store and manage credentials used by workflow steps and triggers.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3.5 text-[13px] font-medium text-background shadow-sm transition hover:opacity-90"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          New credential
        </button>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-400/50 bg-red-500/5 px-4 py-3 text-[13px] text-red-600 dark:text-red-400">
          Failed to load credentials: {error}
        </div>
      ) : credentials === null ? (
        <div className="flex items-center gap-2 px-1 py-6 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> Loading…
        </div>
      ) : credentials.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-[13px] text-muted-foreground">
          No credentials yet. Create one to use it in a workflow.
        </div>
      ) : (
        <>
          <CredentialTable
            credentials={credentials}
            typeLabel={(c) => typeLabelFor(types, c)}
            onReplace={setReplaceTarget}
            onRevoke={setRevokeTarget}
          />
          <LoadMore
            hasMore={hasMore}
            isLoading={isLoadingMore}
            onClick={loadMore}
            shown={count}
            noun="credentials"
          />
        </>
      )}

      {showCreate && (
        <CreateDialog
          workflowClient={workflowClient}
          types={types}
          typesError={typesError}
          {...(onToast ? { onToast } : {})}
          onClose={() => setShowCreate(false)}
          onSuccess={(created) => {
            setShowCreate(false)
            reload()
            // Show a success confirmation.
            setCreatedTarget(created)
          }}
        />
      )}

      {createdTarget && (
        <CreatedDialog
          name={createdTarget.name}
          onClose={() => setCreatedTarget(null)}
        />
      )}

      {replaceTarget && (
        <ReplaceDialog
          workflowClient={workflowClient}
          {...(onToast ? { onToast } : {})}
          credential={replaceTarget}
          onClose={() => setReplaceTarget(null)}
          onSuccess={() => {
            setReplaceTarget(null)
            reload()
          }}
        />
      )}

      {revokeTarget && (
        <RevokeConfirm
          workflowClient={workflowClient}
          {...(onToast ? { onToast } : {})}
          credential={revokeTarget}
          onClose={() => setRevokeTarget(null)}
          onSuccess={() => {
            setRevokeTarget(null)
            reload()
          }}
        />
      )}

    </div>
  )
}

// ─── Table ───

function CredentialTable({
  credentials,
  typeLabel,
  onReplace,
  onRevoke,
}: {
  credentials: CredentialListItem[]
  typeLabel: (c: CredentialSummary) => string
  onReplace: (c: CredentialSummary) => void
  onRevoke: (c: CredentialSummary) => void
}): JSX.Element {
  const CredentialAttributes = useSlot<CredentialAttributesDisplayProps>(
    "credentialAttributesDisplay",
    undefined,
    EmptyCredentialAttributes,
  )

  // Active first (sorted by name), then revoked at the bottom (also by name).
  const rows = [...credentials].sort((a, b) => {
    const ra = a.summary.status === "REVOKED" ? 1 : 0
    const rb = b.summary.status === "REVOKED" ? 1 : 0
    return ra - rb || a.summary.name.localeCompare(b.summary.name)
  })

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <th className="px-6 py-3.5">Credential</th>
            <th className="px-4 py-3.5">Type</th>
            <th className="px-4 py-3.5">Status</th>
            <th className="px-4 py-3.5">Created</th>
            <CredentialAttributes mode="header" />
            <th className="px-4 py-3.5">Last updated</th>
            <th className="px-4 py-3.5 text-center">Edit</th>
            <th className="px-6 py-3.5 text-center">Revoke</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, i) => {
            const c = item.summary
            const revoked = c.status === "REVOKED"
            const canManage =
              item.permittedActions?.includes("credential:manage") ?? false
            return (
              <tr
                key={c.name}
                className={cn(
                  "transition-colors",
                  i > 0 && "border-t border-border",
                  // Revoked rows are greyed out and non-emphasised.
                  revoked
                    ? "bg-secondary/30 text-muted-foreground"
                    : "hover:bg-secondary/40",
                )}
              >
                {/* Name. */}
                <td className="px-6 py-4">
                  <div
                    className={cn(
                      "text-[13.5px] font-medium",
                      revoked ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {c.name}
                  </div>
                </td>

                {/* Credential type — plain text, like the other columns. */}
                <td className="whitespace-nowrap px-4 py-4 text-[12.5px] text-foreground/90">
                  {typeLabel(c)}
                </td>

                {/* Status pill with a dot. */}
                <td className="px-4 py-4">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      revoked
                        ? "bg-red-500/10 text-red-600 dark:text-red-400"
                        : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        revoked ? "bg-red-500" : "bg-emerald-500",
                      )}
                    />
                    {statusLabel(c.status)}
                  </span>
                </td>

                {/* Created timestamp plus any host-defined columns. */}
                <td className="whitespace-nowrap px-4 py-4 text-[12.5px] text-foreground/90">
                  {fmtTime(c.createdAt)}
                </td>
                <CredentialAttributes
                  mode="row"
                  summary={c}
                  attributes={item.attributes}
                />

                {/* Last updated. */}
                <td className="whitespace-nowrap px-4 py-4 text-[12.5px] text-foreground/90">
                  {fmtTime(c.updatedAt)}
                </td>

                {/* Edit is available to owners, editors, and admins. */}
                <td className="px-4 py-4">
                  <div className="flex justify-center">
                    <button
                      type="button"
                      disabled={revoked || !canManage}
                      title={
                        revoked
                          ? "An already revoked credential cannot be edited"
                          : canManage
                            ? undefined
                            : "Only an owner, editor, or admin can edit this credential"
                      }
                      onClick={() => onReplace(c)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-secondary disabled:cursor-not-allowed disabled:text-muted-foreground/50 disabled:hover:bg-background"
                    >
                      <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                      Edit
                    </button>
                  </div>
                </td>

                {/* Revoke column — action while active; a muted "Revoked" state after. */}
                <td className="px-6 py-4">
                  <div className="flex justify-center">
                    {revoked ? (
                      <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground/60">
                        <Ban className="h-3.5 w-3.5" strokeWidth={1.75} />
                        Revoked
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={!canManage}
                        title={
                          canManage
                            ? undefined
                            : "Only an owner, editor, or admin can revoke this credential"
                        }
                        onClick={() => onRevoke(c)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-transparent px-2.5 py-1.5 text-[12px] font-medium text-red-600 transition hover:border-red-500/20 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:text-muted-foreground/50 disabled:hover:border-transparent disabled:hover:bg-transparent dark:text-red-400"
                      >
                        <Ban className="h-3.5 w-3.5" strokeWidth={1.75} />
                        Revoke
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Registry-driven value fields ───

/**
 * Renders the value inputs for an auth type from CREDENTIAL_AUTH_REGISTRY.
 * password → masked input, text → text, and url → url. All fields start empty;
 * secrets are write-only (never prefilled).
 */
function CredentialValueFields({
  authType,
  values,
  onChange,
  disabled,
}: {
  authType: CredentialAuthType
  values: Record<string, string>
  onChange: (key: string, val: string) => void
  disabled?: boolean
}): JSX.Element | null {
  const entry = CREDENTIAL_AUTH_REGISTRY.find((e) => e.type === authType)
  // Per-field reveal state — which password fields are currently shown as plain
  // text. Keyed by field key; defaults to hidden (masked).
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  if (!entry) return null

  const inputClasses =
    "block w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/70 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60"

  return (
    <div className="space-y-3">
      {entry.fields.map((f) => (
        <div key={f.key}>
          <label className="mb-1 block text-[12px] font-medium text-foreground">
            {f.label}
          </label>
          {f.control === "password" ? (
            // Secret field: masked by default, with an eye toggle to reveal what
            // you're typing (handy for pasting/verifying a token before saving).
            <div className="relative">
              <input
                type={revealed[f.key] ? "text" : "password"}
                value={values[f.key] ?? ""}
                disabled={disabled}
                autoComplete="off"
                placeholder={f.placeholder ?? ""}
                onChange={(e) => onChange(f.key, e.target.value)}
                className={`${inputClasses} pr-9`}
              />
              <button
                type="button"
                tabIndex={-1}
                disabled={disabled}
                aria-label={revealed[f.key] ? "Hide value" : "Show value"}
                onClick={() =>
                  setRevealed((prev) => ({ ...prev, [f.key]: !prev[f.key] }))
                }
                className="absolute inset-y-0 right-0 grid w-9 place-items-center text-muted-foreground transition hover:text-foreground disabled:opacity-40"
              >
                {revealed[f.key] ? (
                  <EyeOff className="h-4 w-4" strokeWidth={1.75} />
                ) : (
                  <Eye className="h-4 w-4" strokeWidth={1.75} />
                )}
              </button>
            </div>
          ) : (
            <input
              type={f.control === "url" ? "url" : "text"}
              value={values[f.key] ?? ""}
              disabled={disabled}
              autoComplete="off"
              placeholder={f.placeholder ?? ""}
              onChange={(e) => onChange(f.key, e.target.value)}
              className={inputClasses}
            />
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Modal shell ───

function ModalShell({
  title,
  description,
  onClose,
  busy,
  children,
}: {
  title: string
  description?: string
  onClose: () => void
  busy?: boolean
  children: React.ReactNode
}): JSX.Element {
  return createPortal(
    // Portals mount on document.body, outside the [data-workflow-ui] scope, so
    // re-assert it here — tokens and styles are scoped to that attribute.
    <div
      data-workflow-ui="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div aria-hidden className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 max-h-[88vh] w-full max-w-[580px] overflow-y-auto rounded-2xl border border-border bg-surface-elevated shadow-2xl animate-scale-in"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold leading-tight text-foreground">{title}</h2>
            {description ? (
              <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
            className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-40"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
        <div className="px-5 pb-5 pt-2">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

// ─── Post-create success dialog ───

// Shown right after a credential is created: a success confirmation.
function CreatedDialog({
  name,
  onClose,
}: {
  name: string
  onClose: () => void
}): JSX.Element {
  return (
    <ModalShell title="" onClose={onClose}>
      <div className="flex flex-col items-center px-2 pb-2 pt-1 text-center">
        {/* Animated success mark: a ring pulses out, the disc pops in with a
            slight overshoot, and the check draws itself. */}
        <style>{`
          @keyframes credDiscPop { 0% { transform: scale(0); opacity: 0 } 60% { opacity: 1 } 100% { transform: scale(1); opacity: 1 } }
          @keyframes credRingPing { 0% { transform: scale(.65); opacity: .55 } 100% { transform: scale(1.9); opacity: 0 } }
          @keyframes credCheckDraw { to { stroke-dashoffset: 0 } }
        `}</style>
        <div className="relative mb-4 grid h-16 w-16 place-items-center">
          <span
            className="absolute inset-0 rounded-full bg-emerald-400/40"
            style={{ animation: "credRingPing .9s ease-out .05s both" }}
          />
          <span
            className="relative grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-600 shadow-sm dark:bg-emerald-500/15 dark:text-emerald-400"
            style={{ animation: "credDiscPop .4s cubic-bezier(.34,1.56,.64,1) both" }}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-8 w-8"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path
                d="M5 13l4 4L19 7"
                style={{
                  strokeDasharray: 24,
                  strokeDashoffset: 24,
                  animation: "credCheckDraw .4s ease-out .22s forwards",
                }}
              />
            </svg>
          </span>
        </div>
        <h2 className="text-[16px] font-semibold text-foreground">
          Credential created
        </h2>
        <p className="mt-1.5 max-w-[38ch] text-[13px] leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">{name}</span> has been
          saved and encrypted.
        </p>
        <div className="mt-5 flex w-full items-center justify-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-lg px-4 text-[13px] text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            Done
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// ─── Create dialog ───

function CreateDialog({
  workflowClient,
  types,
  typesError,
  onToast,
  onClose,
  onSuccess,
}: {
  workflowClient: WorkflowClient
  /** Credential types grouped by connector; `null` while loading. */
  types: ConnectorCredentialTypes[] | null
  typesError: string | null
  onToast?: ToastHandler
  onClose: () => void
  onSuccess: (created: { name: string; authType: string }) => void
}): JSX.Element {
  // Two-step flow: 1) choose a credential type, 2) enter name + fields.
  const [chosen, setChosen] = useState<ChosenCredentialType | null>(null)
  const [name, setName] = useState("")
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chooseType = (t: ChosenCredentialType) => {
    setChosen(t)
    setValues(emptyValuesFor(t.authType))
    setError(null)
  }

  const back = () => {
    if (busy) return
    setError(null)
    setChosen(null)
  }

  const submit = async () => {
    if (busy || !chosen || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      // Checked here for a fast error; the server checks again against the
      // shape it takes from the type's definition.
      const auth = validateCredentialAuth(chosen.authType, values)
      await workflowClient.credentials.create({
        name: name.trim(),
        credType: chosen.credType,
        values: auth.values,
      })
      const created = { name: name.trim(), authType: chosen.authType }
      setValues({}) // wipe local secret state immediately
      onToast?.('success', "Credential created")
      onSuccess(created)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
      setBusy(false)
    }
  }

  // ── Step 1: pick a credential type, grouped by connector ──
  if (!chosen) {
    return (
      <ModalShell
        title="New credential"
        description="Choose the kind of credential to add."
        onClose={onClose}
      >
        {typesError ? (
          <p role="alert" className="text-[12px] text-red-600 dark:text-red-400">
            Could not load credential types: {typesError}
          </p>
        ) : types === null ? (
          <div className="flex items-center gap-2 px-1 py-4 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> Loading…
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto">
            {types.map((group) => (
              <section key={group.connectorId} aria-label={group.connectorName}>
                <h3 className="mb-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.connectorName}
                </h3>
                <div className="grid gap-2">
                  {group.credentials.map((t) => (
                    <button
                      key={t.credType}
                      type="button"
                      onClick={() => chooseType({ ...t, connectorName: group.connectorName })}
                      className="group flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 text-left transition hover:border-ring hover:bg-secondary/50"
                    >
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary text-foreground transition group-hover:bg-background">
                        <KeyRound className="h-4 w-4" strokeWidth={1.75} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] font-medium text-foreground">
                          {t.label}
                        </div>
                        {t.description ? (
                          <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                            {t.description}
                          </div>
                        ) : null}
                      </div>
                      <ChevronRight
                        className="h-4 w-4 shrink-0 text-muted-foreground/40 transition group-hover:translate-x-0.5 group-hover:text-foreground"
                        strokeWidth={1.75}
                      />
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </ModalShell>
    )
  }

  // ── Step 2: name + shape-driven value fields ──
  const allFilled = chosen.fields.every(
    (f) => (values[f.key] ?? "").trim() !== "",
  )
  const canCreate = !busy && name.trim() !== "" && allFilled

  return (
    <ModalShell
      title="New credential"
      description="Values are encrypted and write-only — they can never be viewed again."
      onClose={onClose}
      busy={busy}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        className="space-y-3.5"
      >
        {/* Chosen type banner + change. */}
        <div className="flex items-center justify-between gap-3 rounded-xl bg-secondary/50 px-3.5 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-background text-foreground shadow-sm">
              <KeyRound className="h-4 w-4" strokeWidth={1.75} />
            </div>
            <div className="leading-tight">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {chosen.connectorName}
              </div>
              <div className="text-[13px] font-semibold text-foreground">
                {chosen.label}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={back}
            disabled={busy}
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11.5px] font-medium text-foreground transition hover:bg-secondary disabled:opacity-50"
          >
            Change
          </button>
        </div>

        {chosen.description ? (
          <p className="text-[11.5px] leading-snug text-muted-foreground">
            {chosen.description}
          </p>
        ) : null}

        <div>
          <label className="mb-1 block text-[12px] font-medium text-foreground">
            Name
          </label>
          <input
            type="text"
            value={name}
            disabled={busy}
            maxLength={255}
            autoFocus
            placeholder="e.g. stripe-prod"
            onChange={(e) => setName(e.target.value)}
            className="block w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
          />
        </div>

        <CredentialValueFields
          authType={chosen.authType}
          values={values}
          disabled={busy}
          onChange={(k, v) => setValues((prev) => ({ ...prev, [k]: v }))}
        />

        {error ? (
          <p role="alert" className="text-[11.5px] text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={back}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[12.5px] font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Back
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="inline-flex h-8 items-center rounded-md px-3 text-[12.5px] text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canCreate}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3.5 text-[12.5px] font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
              ) : null}
              Create credential
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  )
}

// ─── Replace-values dialog ───

function ReplaceDialog({
  workflowClient,
  onToast,
  credential,
  onClose,
  onSuccess,
}: {
  workflowClient: WorkflowClient
  onToast?: ToastHandler
  credential: CredentialSummary
  onClose: () => void
  onSuccess: () => void
}): JSX.Element {
  // Fields start EMPTY — old values are never fetched or prefilled. The user
  // must re-enter the complete value set.
  const [values, setValues] = useState<Record<string, string>>(() =>
    emptyValuesFor(credential.authType),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const auth = validateCredentialAuth(credential.authType, values)
      await workflowClient.credentials.replaceValues(credential.name, {
        values: auth.values,
      })
      setValues({})
      onToast?.('success', "Credential values replaced")
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
      setBusy(false)
    }
  }

  const entry = CREDENTIAL_AUTH_REGISTRY.find(
    (e) => e.type === credential.authType,
  )!
  const allFilled = entry.fields.every(
    (f) => (values[f.key] ?? "").trim() !== "",
  )
  const canSave = !busy && allFilled

  return (
    <ModalShell
      title="Edit credential"
      description="Enter new values to replace the current ones."
      onClose={onClose}
      busy={busy}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
        className="space-y-3.5"
      >
        {/* Context banner — the credential name is the focal point; auth type is a pill. */}
        <div className="flex items-center gap-3 rounded-xl bg-secondary/50 px-3.5 py-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-background text-foreground shadow-sm">
            <KeyRound className="h-4 w-4" strokeWidth={1.75} />
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 leading-tight">
            <span
              className="truncate text-[15px] font-semibold text-foreground"
              title={credential.name}
            >
              {credential.name}
            </span>
            <span className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {authTypeLabel(credential.authType)}
            </span>
          </div>
        </div>

        <div className="space-y-3.5 pt-0.5">
          <CredentialValueFields
            authType={credential.authType}
            values={values}
            disabled={busy}
            onChange={(k, v) => setValues((prev) => ({ ...prev, [k]: v }))}
          />
        </div>

        {error ? (
          <p role="alert" className="text-[11.5px] text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-8 items-center rounded-md px-3 text-[12.5px] text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3.5 text-[12.5px] font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
            ) : null}
            Save changes
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

// ─── Revoke confirmation ───

function RevokeConfirm({
  workflowClient,
  onToast,
  credential,
  onClose,
  onSuccess,
}: {
  workflowClient: WorkflowClient
  onToast?: ToastHandler
  credential: CredentialSummary
  onClose: () => void
  onSuccess: () => void
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Type-to-confirm: the Revoke button unlocks only when this exactly matches
  // the credential name — prevents an accidental terminal revoke.
  const [confirmText, setConfirmText] = useState("")

  const canRevoke = confirmText === credential.name && !busy

  const submit = async () => {
    if (!canRevoke) return
    setBusy(true)
    setError(null)
    try {
      await workflowClient.credentials.revoke(credential.name)
      onToast?.('success', "Credential revoked")
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
      setBusy(false)
    }
  }

  return (
    <ModalShell
      title={`Revoke ${credential.name}?`}
      onClose={onClose}
      busy={busy}
    >
      {/* Destructive warning banner. */}
      <div className="mb-3.5 flex gap-3 rounded-xl border border-red-200/70 bg-red-50 px-3.5 py-3 dark:border-red-500/25 dark:bg-red-500/10">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400">
          <AlertTriangle className="h-4 w-4" strokeWidth={2} />
        </div>
        <p className="text-[12.5px] leading-relaxed text-red-700 dark:text-red-300">
          This is <span className="font-semibold">permanent</span> — the credential
          can’t be reactivated and any workflow using it will fail before its
          request. The name stays reserved.
        </p>
      </div>

      {/* Type-to-confirm. */}
      <label className="mb-1.5 block text-[12px] text-muted-foreground">
        Type <span className="font-semibold text-foreground">{credential.name}</span> to confirm
      </label>
      <div className="relative">
        <input
          type="text"
          value={confirmText}
          disabled={busy}
          autoFocus
          autoComplete="off"
          placeholder={credential.name}
          onChange={(e) => setConfirmText(e.target.value)}
          className="block w-full rounded-lg border border-border bg-surface py-2 pl-3 pr-9 text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 disabled:opacity-60"
        />
        {confirmText === credential.name ? (
          <CheckCircle2
            className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-500"
            strokeWidth={2}
          />
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-[11.5px] text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="inline-flex h-8 items-center rounded-md px-3 text-[12.5px] text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canRevoke}
          title={
            confirmText === credential.name
              ? undefined
              : "Type the credential name to enable"
          }
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-red-600 px-3 text-[12.5px] font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} /> : null}
          Revoke
        </button>
      </div>
    </ModalShell>
  )
}

import { useEffect, useRef, useState } from "react";
import {
  ArrowsClockwiseIcon,
  CaretDownIcon,
  CheckIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { cn } from "../../../lib/utils";
import { Button } from "./Button";
import { Badge } from "./Badge";
import { TextField } from "./TextField";
import type { OrcaRouterCatalogState } from "../../hooks/useOrcaRouterCatalog";

export const ORCAROUTER_PROVIDER_ID = "orcarouter";
export const ORCAROUTER_DISPLAY_NAME = "OrcaRouter";
export const ORCAROUTER_LOGO_URL = "https://www.orcarouter.ai/orca-logo-classic.png";
export const ORCAROUTER_BASE_URL = "https://api.orcarouter.ai/v1";
export const ORCAROUTER_DEFAULT_MODEL = "orcarouter/auto";

/* ── Official logo ─────────────────────────────────────────────────── */

export function OrcaRouterLogo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <img
      src={ORCAROUTER_LOGO_URL}
      alt={ORCAROUTER_DISPLAY_NAME}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={cn("shrink-0 object-contain", className)}
    />
  );
}

/* ── Model catalog picker ──────────────────────────────────────────── */

/** A dropdown/search fed by the backend catalog — never free text. Covers the
 *  loading / empty / auth-error / network-error / refresh / degraded states. */
export function OrcaRouterModelPicker({
  catalog,
  value,
  onSelect,
  disabled,
  hint,
}: {
  catalog: OrcaRouterCatalogState;
  value: string;
  onSelect: (model: string) => void;
  disabled?: boolean;
  hint?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? catalog.models.filter(
        (m) => m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle),
      )
    : catalog.models;
  const selected = catalog.models.find((m) => m.id === value);

  const statusLine = catalog.loading ? (
    <span className="flex items-center gap-1.5 text-[11px] text-xyne-fg-muted">
      <ArrowsClockwiseIcon size={11} className="animate-spin" />
      Loading models…
    </span>
  ) : catalog.error ? (
    <span
      className={cn(
        "block text-[11px]",
        catalog.error.kind === "auth" ? "text-xyne-error-fg" : "text-xyne-warning-fg",
      )}
    >
      {catalog.error.kind === "auth" ? "Sign-in needed — " : "Couldn't load models — "}
      {catalog.error.message}
    </span>
  ) : catalog.models.length === 0 ? (
    <span className="block text-[11px] text-xyne-warning-fg">
      No OrcaRouter model matches this requirement. Change the attachment type or re-connect.
    </span>
  ) : (
    <span className="block text-[11px] text-xyne-fg-muted">
      {catalog.models.length} model{catalog.models.length === 1 ? "" : "s"} available
    </span>
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[12px] font-medium text-xyne-fg-secondary">Model</label>
        <div className="flex items-center gap-1.5">
          {catalog.degraded && (
            <Badge
              label="Fallback catalog"
              variant="warning"
              size="sm"
              as="span"
              title="OrcaRouter's live catalog was unreachable — this is the verified offline list."
            />
          )}
          <button
            type="button"
            onClick={catalog.refresh}
            disabled={catalog.loading || disabled}
            title="Refresh the OrcaRouter model list"
            aria-label="Refresh models"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-xyne-fg-tertiary transition-colors hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary disabled:opacity-40"
          >
            <ArrowsClockwiseIcon size={13} className={catalog.loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div ref={rootRef} className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            "flex h-9 w-full items-center justify-between gap-2 rounded-[var(--comp-input-radius)] border border-xyne-border bg-xyne-surface px-3 text-[13px] text-xyne-fg-primary",
            "transition-[border-color] duration-[var(--comp-duration-normal)] ease-in",
            "hover:border-xyne-border-strong focus-visible:border-xyne-border-focus focus-visible:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          <span className="truncate text-left">
            {selected ? selected.name : value || "Select a model"}
          </span>
          <CaretDownIcon size={12} className="shrink-0 text-xyne-fg-tertiary" />
        </button>

        {open && (
          <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-[350] overflow-hidden rounded-xl border border-xyne-border bg-xyne-surface shadow-[var(--comp-shadow-lg)]">
            <div className="border-b border-xyne-border p-1.5">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models…"
                aria-label="Search OrcaRouter models"
                className="h-7 w-full rounded-md bg-xyne-surface-subtle px-2 text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:outline-none"
              />
            </div>
            <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
              {catalog.loading && catalog.models.length === 0 ? (
                <li className="px-3 py-2 text-[12px] text-xyne-fg-muted">Loading…</li>
              ) : filtered.length === 0 ? (
                <li className="px-3 py-2 text-[12px] text-xyne-fg-muted">No models match.</li>
              ) : (
                filtered.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={m.id === value}
                      onClick={() => {
                        onSelect(m.id);
                        setOpen(false);
                        setQuery("");
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-xyne-fg-primary",
                        "hover:bg-xyne-surface-subtle",
                        m.id === value && "font-medium",
                      )}
                    >
                      <span className="w-3.5 shrink-0">
                        {m.id === value && <CheckIcon size={12} weight="bold" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{m.name}</span>
                        <span className="block truncate text-[11px] text-xyne-fg-tertiary">
                          {m.id}
                          {typeof m.contextLength === "number"
                            ? ` · ${Math.round(m.contextLength / 1000)}k context`
                            : ""}
                          {m.inputModalities && m.inputModalities.length > 0
                            ? ` · ${m.inputModalities.join(", ")}`
                            : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>

      {hint && (
        <span className="flex items-center gap-1.5 text-[11px] text-xyne-warning-fg">
          <WarningCircleIcon size={11} weight="fill" />
          {hint}
        </span>
      )}
      {statusLine}
    </div>
  );
}

/* ── Out-of-band PKCE sign-in ──────────────────────────────────────── */

/** One sign-in attempt. The caller owns the generation counter and bumps it
 *  whenever the attempt must be abandoned (provider/auth-method switch, dialog
 *  close, unmount, `pagehide`). */
export interface OrcaRouterLoginAttempt {
  url: string;
  state: string;
  /** Seconds the server keeps the attempt alive; drives the client timeout. */
  expiresIn?: number;
}

/**
 * Drives the OrcaRouter out-of-band sign-in: start → show the consent URL for
 * copy → exchange the pasted code.
 *
 * Lifecycle: `generation` is a monotonically increasing attempt id owned by
 * the caller. Every async response is checked against it before it may write
 * state, so a late URL from a previous attempt cannot appear under a newer one.
 * All local state is mirrored in a ref so the `pagehide` handler can clear
 * busy/hint **synchronously** — a generation-guarded `finally` would refuse to
 * run and leave a back-forward-cache restore permanently busy.
 */
export function OrcaRouterAuthPanel({
  generation,
  onStart,
  onExchange,
  onCancel,
  onConnected,
  onAttemptChange,
}: {
  generation: number;
  onStart: (generation: number) => Promise<OrcaRouterLoginAttempt>;
  onExchange: (
    generation: number,
    attempt: OrcaRouterLoginAttempt,
    code: string,
  ) => Promise<void>;
  onCancel: (
    generation: number,
    attempt: OrcaRouterLoginAttempt | null,
    opts?: { keepalive?: boolean },
  ) => void;
  onConnected: () => void;
  /** Fires with the current attempt whenever a sign-in starts, finishes, or is
   *  abandoned. Non-null means "a sign-in is pending". Lets the parent hold the
   *  exact `state` so it can cancel the server-side attempt on unmount, and
   *  render the pending state itself. */
  onAttemptChange?: (attempt: OrcaRouterLoginAttempt | null) => void;
}) {
  const [attempt, setAttempt] = useState<OrcaRouterLoginAttempt | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const stateRef = useRef({ attempt, busy, generation });
  stateRef.current = { attempt, busy, generation };
  const onAttemptChangeRef = useRef(onAttemptChange);
  onAttemptChangeRef.current = onAttemptChange;
  const [expired, setExpired] = useState(false);
  // Attempt timeout: the server expires the PKCE verifier (10 minutes), so the
  // UI must stop claiming a sign-in is pending rather than hang on a code that
  // can no longer be exchanged.
  useEffect(() => {
    if (!attempt) return;
    const seconds = attempt.expiresIn && attempt.expiresIn > 0 ? attempt.expiresIn : 600;
    const timer = setTimeout(() => {
      setExpired(true);
      setBusy(false);
      onAttemptChangeRef.current?.(null);
      onCancel(stateRef.current.generation, stateRef.current.attempt);
    }, seconds * 1000);
    return () => clearTimeout(timer);
  }, [attempt, onCancel]);

  // Abandon the attempt whenever the caller's generation moves on (provider
  // switch, auth-method switch, dialog close, unmount) — the caller has
  // already told the server to stop, so this only has to release the UI.
  const lastGeneration = useRef(generation);
  useEffect(() => {
    if (lastGeneration.current === generation) return;
    lastGeneration.current = generation;
    setAttempt(null);
    setCode("");
    setErr(null);
    setBusy(false);
    setCopied(false);
    setExpired(false);
    onAttemptChangeRef.current?.(null);
  }, [generation]);

  const start = async () => {
    const mine = generation;
    setBusy(true);
    setErr(null);
    setCopied(false);
    setExpired(false);
    try {
      const next = await onStart(mine);
      if (stateRef.current.generation !== mine) return;
      setAttempt(next);
      onAttemptChangeRef.current?.(next);
      window.open(next.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      if (stateRef.current.generation !== mine) return;
      setErr(e instanceof Error ? e.message : "Failed to start OrcaRouter sign-in");
      setAttempt(null);
      onAttemptChangeRef.current?.(null);
    } finally {
      if (stateRef.current.generation === mine) setBusy(false);
    }
  };

  const exchange = async () => {
    const current = stateRef.current.attempt;
    if (!current) return;
    const mine = generation;
    setBusy(true);
    setErr(null);
    setExpired(false);
    try {
      await onExchange(mine, current, code.trim());
      if (stateRef.current.generation !== mine) return;
      setAttempt(null);
      setCode("");
      onAttemptChangeRef.current?.(null);
      onConnected();
    } catch (e) {
      if (stateRef.current.generation !== mine) return;
      setErr(e instanceof Error ? e.message : "OrcaRouter sign-in failed");
    } finally {
      if (stateRef.current.generation === mine) setBusy(false);
    }
  };

  const cancel = () => {
    onCancel(generation, stateRef.current.attempt);
    setAttempt(null);
    setCode("");
    setErr(null);
    setBusy(false);
    setCopied(false);
    setExpired(false);
    onAttemptChangeRef.current?.(null);
  };

  useEffect(() => {
    const onPageHide = () => {
      // Synchronous clear first: the page may be frozen into the
      // back-forward cache the moment this handler returns.
      const pending = stateRef.current.attempt;
      stateRef.current.busy = false;
      stateRef.current.attempt = null;
      stateRef.current.generation = -1;
      setBusy(false);
      setAttempt(null);
      setCode("");
      setErr(null);
      setExpired(false);
      onAttemptChangeRef.current?.(null);
      // Only cancel when an attempt actually existed — the generation alone
      // does not tell the server anything useful.
      if (pending) onCancel(-1, pending, { keepalive: true });
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [onCancel]);

  return (
    <div className="flex flex-col gap-2">
      {!attempt ? (
        <>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void start()}
            disabled={busy}
            leadingIcon={<OrcaRouterLogo size={14} />}
          >
            {busy ? "Opening…" : "Connect with OrcaRouter"}
          </Button>
          <p className="text-[11px] text-xyne-fg-muted">
            Approve access on the OrcaRouter consent screen; it then shows a code to paste back
            here. No OrcaRouter key is ever held by this browser.
          </p>
        </>
      ) : (
        <>
          <p className="text-[12px] text-xyne-fg-secondary">
            Approve access in the OrcaRouter tab. The consent screen shows a code — copy it and
            paste it below.
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={attempt?.url ?? ""}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="OrcaRouter authorization URL"
              className="h-8 min-w-0 flex-1 rounded-md border border-xyne-border bg-xyne-surface px-2 font-mono text-[11px] text-xyne-fg-secondary focus:outline-none"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(attempt?.url ?? "");
                setCopied(true);
              }}
              disabled={!attempt}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-[11px] text-xyne-fg-muted">
            Browsers sometimes block the new tab — open this URL manually if nothing appeared.
          </p>
          <TextField
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Paste the code from the consent screen"
            label="Authorization code"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => void exchange()}
              disabled={busy || !code.trim()}
            >
              {busy ? "Verifying…" : "Complete sign-in"}
            </Button>
            <Button size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </>
      )}
      {err && <p className="text-[12px] text-xyne-error-fg">{err}</p>}
      {expired && (
        <p className="text-[12px] text-xyne-warning-fg">
          This sign-in request expired. Start it again to get a fresh code.
        </p>
      )}
    </div>
  );
}

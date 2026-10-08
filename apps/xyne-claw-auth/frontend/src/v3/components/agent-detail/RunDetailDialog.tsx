import { useCallback, useEffect, useState } from "react";
import { getAgentRunDetail, type AgentRunDetail } from "../../../lib/api";
import { ToolInvocationList } from "../../../components/ToolInvocationList";
import { Dialog } from "../ui/Dialog";

const POLL_MS = 4000;

export function fmtMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value < 1000) return `${value}ms`;
  const s = Math.round(value / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === "failed"
      ? "border-xyne-error-border bg-xyne-error-bg text-xyne-error-fg"
      : status === "running"
        ? "border-xyne-warning-border bg-xyne-warning-bg text-xyne-warning-fg"
        : status === "completed"
          ? "border-transparent bg-xyne-success-bg text-xyne-success-fg"
          : "border-xyne-border bg-xyne-surface-sunken text-xyne-fg-secondary";
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}>{status}</span>;
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-xyne-fg-tertiary">{label}</span>
      <span className={`break-all text-[12px] text-xyne-fg-primary ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function Block({ title, children, tone }: { title: string; children: React.ReactNode; tone?: "error" }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-xyne-fg-primary">{title}</span>
      <div
        className={`max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border px-3 py-2 text-[12px] leading-relaxed ${
          tone === "error"
            ? "border-xyne-error-border bg-xyne-error-bg text-xyne-error-fg"
            : "border-xyne-border-subtle bg-xyne-surface-sunken text-xyne-fg-secondary"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export function RunDetailDialog({ slug, sessionId, onClose }: { slug: string; sessionId: string | null; onClose: () => void }) {
  const [detail, setDetail] = useState<AgentRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    try {
      setDetail(await getAgentRunDetail(slug, sessionId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this run");
    }
  }, [slug, sessionId]);

  useEffect(() => {
    setDetail(null);
    setError(null);
    void load();
  }, [load]);

  const running = detail?.run.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  const run = detail?.run;
  const invocations = run?.toolInvocations ?? [];
  const elapsed = run
    ? (run.completedAt ? new Date(run.completedAt).getTime() : Date.now()) - new Date(run.startedAt).getTime()
    : null;

  return (
    <Dialog
      open={sessionId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Run"
      description={sessionId ?? undefined}
      maxWidth={960}
      maxHeight="88vh"
      leftOffset={100}
    >
      <div className="flex flex-col gap-5">
        {error && (
          <div className="rounded-lg border border-xyne-error-border bg-xyne-error-bg px-3 py-2 text-[12px] text-xyne-error-fg">{error}</div>
        )}
        {!run && !error && <div className="text-[12px] text-xyne-fg-tertiary">Loading run…</div>}

        {run && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill status={run.status} />
              <span className="text-[12px] text-xyne-fg-secondary">
                {run.status === "running" ? `running for ${fmtMs(elapsed)}` : `took ${fmtMs(elapsed)}`}
              </span>
              {running && <span className="text-[11px] text-xyne-fg-tertiary">updates every {POLL_MS / 1000}s</span>}
            </div>

            {running && run.currentToolLabel && (
              <div className="rounded-lg border border-xyne-warning-border bg-xyne-warning-bg px-3 py-2 text-[12px] text-xyne-warning-fg">
                Now: {run.currentToolLabel}
              </div>
            )}

            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <Field label="Trigger" value={run.triggerSource} />
              <Field label="Started by" value={detail?.requester?.name || detail?.requester?.email || "—"} />
              <Field label="Started" value={new Date(run.startedAt).toLocaleString()} />
              <Field label="Model" value={`${run.model ?? "—"}${run.provider ? ` · ${run.provider}` : ""}`} />
              <Field label="LLM time" value={`${fmtMs(run.llmTotalMs)}${run.llmTurns ? ` · ${run.llmTurns} turns` : ""}`} />
              <Field label="Tool time" value={`${fmtMs(run.toolMs)} · ${invocations.length} calls`} />
              <Field label="Tokens" value={run.tokensIn || run.tokensOut ? `${run.tokensIn ?? 0} in · ${run.tokensOut ?? 0} out` : "—"} />
              <Field
                label="Retries"
                value={run.llmRetries ? `${run.llmRetries}${run.lastRetryReason ? ` · ${run.lastRetryReason.slice(0, 60)}` : ""}` : "0"}
              />
              {run.conversationId && <Field label="Conversation" value={run.conversationId} mono />}
              {run.channelId && <Field label="Channel" value={run.channelId} mono />}
              {run.parentSessionId && <Field label="Called by run" value={run.parentSessionId} mono />}
            </div>

            <Block title="Task">{run.task}</Block>

            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-xyne-fg-primary">Tool calls ({invocations.length})</span>
              {invocations.length > 0 ? (
                <div className="max-h-[28rem] overflow-auto rounded-lg border border-xyne-border-subtle px-3 pb-2">
                  <ToolInvocationList invocations={invocations} />
                </div>
              ) : (
                <span className="text-[12px] text-xyne-fg-tertiary">No tool calls yet.</span>
              )}
            </div>

            {detail && detail.children.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-xyne-fg-primary">Delegated runs ({detail.children.length})</span>
                <div className="flex flex-col divide-y divide-xyne-border-subtle rounded-lg border border-xyne-border-subtle">
                  {detail.children.map((c) => (
                    <div key={c.sessionId} className="flex items-center gap-3 px-3 py-2 text-[12px]">
                      <StatusPill status={c.status} />
                      <span className="font-medium text-xyne-fg-primary">{c.agentSlug}</span>
                      <span className="text-xyne-fg-tertiary">{fmtMs(c.durationMs)}</span>
                      <span className="min-w-0 flex-1 truncate text-xyne-fg-secondary">{c.task}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {run.error && <Block title="Error" tone="error">{run.error}</Block>}
            {run.result && <Block title="Result">{run.result}</Block>}
          </>
        )}
      </div>
    </Dialog>
  );
}

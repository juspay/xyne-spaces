export interface StatusToolInvocation {
  toolName: string;
  status?: string;
  isError?: boolean;
  durationMs?: number;
  startedAt?: string;
}

export interface StatusRunSnapshot {
  sessionId: string;
  status: string;
  startedAt: Date;
  completedAt?: Date | null;
  provider?: string | null;
  model?: string | null;
  currentToolLabel?: string | null;
  error?: string | null;
  toolInvocations: StatusToolInvocation[];
}

export interface StatusOwnership {
  holder?: string | null;
  ttlMs?: number | null;
}

export interface StatusQueueState {
  state?: string | null;
  attempts?: number | null;
  delayMs?: number | null;
}

export interface StatusSnapshot {
  agentSlug: string;
  now: Date;
  run: StatusRunSnapshot | null;
  ownership?: StatusOwnership | null;
  queue?: StatusQueueState | null;
}

const RECENT_WINDOW_MS = 5 * 60 * 1000;
const MAX_LISTED = 8;

function shortSession(sessionId: string): string {
  return sessionId.length > 12 ? `${sessionId.slice(0, 12)}…` : sessionId;
}

function ageLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 90) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function secondsLabel(durationMs?: number): string {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) return "";
  return ` ${(durationMs / 1000).toFixed(1)}s`;
}

function glyph(inv: StatusToolInvocation): string {
  if (inv.status === "running") return "⏳";
  if (inv.isError) return "✕";
  return "✓";
}

function invocationTime(inv: StatusToolInvocation): number | null {
  if (!inv.startedAt) return null;
  const started = Date.parse(inv.startedAt);
  if (Number.isNaN(started)) return null;
  const duration = typeof inv.durationMs === "number" && Number.isFinite(inv.durationMs) ? inv.durationMs : 0;
  return started + Math.max(0, duration);
}

function isTerminal(status: string): boolean {
  return status !== "running" && status !== "queued";
}

export function formatStatusPanel(snapshot: StatusSnapshot): string {
  const nowMs = snapshot.now.getTime();
  const run = snapshot.run;
  if (!run) {
    return [
      `🔎 **Status** — \`${snapshot.agentSlug}\``,
      "",
      "No run has been dispatched in this thread recently.",
      `Mention @${snapshot.agentSlug} with a task to start one.`,
    ].join("\n");
  }

  const lines: string[] = [];
  const terminal = isTerminal(run.status);
  const finishedAt = run.completedAt ? run.completedAt.getTime() : null;
  const headerAge = terminal && finishedAt
    ? `finished ${ageLabel(nowMs - finishedAt)} ago`
    : `started ${ageLabel(nowMs - run.startedAt.getTime())} ago`;
  lines.push(`🔎 **Status** — \`${snapshot.agentSlug}\` · \`${shortSession(run.sessionId)}\` · **${run.status}** · ${headerAge}`);

  const providerBits = [run.provider, run.model].filter((v): v is string => Boolean(v));
  if (providerBits.length > 0) lines.push(`Provider/model: ${providerBits.join(" / ")}`);

  if (terminal && run.error) lines.push(`Error: ${run.error.replace(/\s+/g, " ").slice(0, 300)}`);

  if (!terminal && run.currentToolLabel) lines.push(`Now: ${run.currentToolLabel}`);

  const timed = run.toolInvocations
    .map((inv) => ({ inv, at: invocationTime(inv) }))
    .filter((e): e is { inv: StatusToolInvocation; at: number } => e.at !== null)
    .sort((a, b) => b.at - a.at);
  const recent = timed.filter((e) => nowMs - e.at <= RECENT_WINDOW_MS);

  if (recent.length > 0) {
    lines.push("");
    lines.push(`**Last 5 min** — ${recent.length} tool call${recent.length === 1 ? "" : "s"}:`);
    for (const e of recent.slice(0, MAX_LISTED)) {
      lines.push(`- ${glyph(e.inv)} ${e.inv.toolName}${secondsLabel(e.inv.durationMs)} · ${ageLabel(nowMs - e.at)} ago`);
    }
    if (recent.length > MAX_LISTED) lines.push(`- …${recent.length - MAX_LISTED} more`);
  } else if (!terminal) {
    lines.push("");
    const newest = timed[0];
    lines.push(
      newest
        ? `⚠️ **No tool activity in the last 5 minutes.** Newest tool call \`${newest.inv.toolName}\` was ${ageLabel(nowMs - newest.at)} ago.`
        : "⚠️ **No tool activity in the last 5 minutes** — this run has not recorded any tool call yet.",
    );
  } else if (run.toolInvocations.length === 0) {
    lines.push("");
    lines.push("No tool calls were recorded for this run.");
  }

  const ownership = snapshot.ownership;
  if (ownership !== undefined) {
    if (ownership && ownership.holder) {
      const fresh = typeof ownership.ttlMs === "number" && ownership.ttlMs > 0
        ? `heartbeat fresh (${Math.round(ownership.ttlMs / 1000)}s ttl)`
        : "heartbeat unknown";
      lines.push(`Ownership: \`${ownership.holder}\` · ${fresh}`);
    } else {
      lines.push("Ownership: no ownership record (HTTP mode or no live executor)");
    }
  }

  const queue = snapshot.queue;
  if (queue && queue.state) {
    const bits = [`state \`${queue.state}\``];
    if (typeof queue.attempts === "number") bits.push(`attempt ${queue.attempts}`);
    if (typeof queue.delayMs === "number" && queue.delayMs > 0) bits.push(`delay ${Math.round(queue.delayMs / 1000)}s`);
    lines.push(`Queue job: ${bits.join(" · ")}`);
  }

  const lastActivityAt = Math.max(timed[0]?.at ?? 0, run.startedAt.getTime(), finishedAt ?? 0);
  lines.push("");
  lines.push(`Last activity: ${ageLabel(nowMs - lastActivityAt)} ago`);
  if (!terminal) {
    const stalledMs = nowMs - lastActivityAt;
    lines.push(
      stalledMs > RECENT_WINDOW_MS
        ? "Verdict: likely **stuck** — nothing has moved in over 5 minutes. `/stop` then retry if it stays this way."
        : "Verdict: **working** — activity is recent, this looks slow rather than stuck.",
    );
  }

  return lines.join("\n");
}

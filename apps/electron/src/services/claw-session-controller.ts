import log from "electron-log/main";

export type ClawSessionStatus = "idle" | "running" | "needs-input" | "error";

export interface ClawSessionSnapshot {
  status: ClawSessionStatus;
  conversationId: string | null;
  preview: string | null;
}

export interface ClawSessionCompletion {
  outcome: Exclude<ClawSessionStatus, "running">;
  conversationId: string | null;
  preview: string | null;
}

const IDLE_SNAPSHOT: ClawSessionSnapshot = {
  status: "idle",
  conversationId: null,
  preview: null,
};

let snapshot: ClawSessionSnapshot = IDLE_SNAPSHOT;

const stateListeners = new Set<(next: ClawSessionSnapshot) => void>();
const completionListeners = new Set<(event: ClawSessionCompletion) => void>();

export function getClawSessionSnapshot(): ClawSessionSnapshot {
  return snapshot;
}

export function onClawSessionStateChange(
  listener: (next: ClawSessionSnapshot) => void,
): () => void {
  stateListeners.add(listener);
  return () => {
    stateListeners.delete(listener);
  };
}

export function onClawSessionCompleted(
  listener: (event: ClawSessionCompletion) => void,
): () => void {
  completionListeners.add(listener);
  return () => {
    completionListeners.delete(listener);
  };
}

function emitState(): void {
  for (const listener of stateListeners) {
    try {
      listener(snapshot);
    } catch (error) {
      log.error("[ClawSession] State listener failed", error);
    }
  }
}

function emitCompletion(event: ClawSessionCompletion): void {
  for (const listener of completionListeners) {
    try {
      listener(event);
    } catch (error) {
      log.error("[ClawSession] Completion listener failed", error);
    }
  }
}

function normalizeStatus(value: unknown): ClawSessionStatus {
  if (
    value === "running" ||
    value === "needs-input" ||
    value === "error" ||
    value === "idle"
  ) {
    return value;
  }
  return "idle";
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > 160 ? `${trimmed.slice(0, 159)}…` : trimmed;
}

export function syncClawSessionState(input: {
  status?: unknown;
  conversationId?: unknown;
  preview?: unknown;
}): void {
  const next: ClawSessionSnapshot = {
    status: normalizeStatus(input.status),
    conversationId: normalizeText(input.conversationId),
    preview: normalizeText(input.preview),
  };

  const previous = snapshot;
  if (
    next.status === previous.status &&
    next.conversationId === previous.conversationId &&
    next.preview === previous.preview
  ) {
    return;
  }

  snapshot = next;
  emitState();

  if (previous.status === "running" && next.status !== "running") {
    emitCompletion({
      outcome: next.status,
      conversationId: next.conversationId ?? previous.conversationId,
      preview: next.preview ?? previous.preview,
    });
  }
}

export function resetClawSessionState(): void {
  if (snapshot.status === "idle") return;
  snapshot = IDLE_SNAPSHOT;
  emitState();
}

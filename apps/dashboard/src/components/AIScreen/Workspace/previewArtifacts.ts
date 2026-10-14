import type { ConversationArtifact } from '../../../services/XyneAI/XyneAIArtifactsService';

/**
 * Sandbox previews and diffs: one PREVIEW and one DIFF row per sandbox, all
 * stored under the same fixed titles ("Live preview" / "Code changes"). These
 * helpers tell them apart in the UI without touching the stored rows, so older
 * conversations read correctly too.
 */

export function isPreviewCandidate(artifact: ConversationArtifact): boolean {
  return artifact.kind === 'PREVIEW' || artifact.kind === 'DIFF';
}

function time(value: string): number {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Previews and diffs for the Preview tab, newest sandbox first. A sandbox reused
 * by a later run re-records its rows, so recency is `updatedAt`, not `createdAt`.
 * Within one sandbox the live preview comes before its diff.
 */
export function sortPreviewCandidates(
  artifacts: readonly ConversationArtifact[],
): ConversationArtifact[] {
  const candidates = artifacts.filter(isPreviewCandidate);
  const latestBySandbox = new Map<string, number>();
  for (const a of candidates) {
    const at = time(a.updatedAt);
    latestBySandbox.set(a.refId, Math.max(latestBySandbox.get(a.refId) ?? 0, at));
  }
  return [...candidates].sort((a, b) => {
    const bySandbox = (latestBySandbox.get(b.refId) ?? 0) - (latestBySandbox.get(a.refId) ?? 0);
    if (bySandbox !== 0) return bySandbox;
    if (a.refId !== b.refId) return a.refId < b.refId ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === 'PREVIEW' ? -1 : 1;
    return time(b.updatedAt) - time(a.updatedAt);
  });
}

function formatStamp(value: string, now: Date): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '';
  const clock = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (at.toDateString() === now.toDateString()) return clock;
  const day = at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${day}, ${clock}`;
}

function shortSandboxId(refId: string): string {
  const tail =
    refId
      .replace(/^local:/, '')
      .split(/[-_/:]/)
      .filter(Boolean)
      .pop() ?? refId;
  return tail.length > 6 ? tail.slice(-6) : tail;
}

/**
 * Display titles for previews and diffs that would otherwise read the same.
 * Only rows whose kind and title collide with another row are relabelled — a
 * lone preview, or one the user renamed to something unique, keeps its title.
 * Collisions get the sandbox's start time; if that still collides, a short
 * sandbox id. Returns a map of artifact id → display title.
 */
export function distinctPreviewTitles(
  artifacts: readonly ConversationArtifact[],
  now: Date = new Date(),
): Map<string, string> {
  const groups = new Map<string, ConversationArtifact[]>();
  for (const a of artifacts) {
    if (!isPreviewCandidate(a)) continue;
    const key = `${a.kind}\u0000${a.title}`;
    const group = groups.get(key);
    if (group) group.push(a);
    else groups.set(key, [a]);
  }

  const titles = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const stamped = group.map(a => {
      const stamp = formatStamp(a.createdAt, now);
      return { a, label: stamp ? `${a.title} · ${stamp}` : a.title };
    });
    const counts = new Map<string, number>();
    for (const { label } of stamped) counts.set(label, (counts.get(label) ?? 0) + 1);
    for (const { a, label } of stamped) {
      titles.set(
        a.id,
        (counts.get(label) ?? 0) > 1 ? `${label} · …${shortSandboxId(a.refId)}` : label,
      );
    }
  }
  return titles;
}

/** Applies {@link distinctPreviewTitles} to the rows, leaving every other field as stored. */
export function withDistinctPreviewTitles(
  artifacts: readonly ConversationArtifact[],
  now: Date = new Date(),
): ConversationArtifact[] {
  const titles = distinctPreviewTitles(artifacts, now);
  if (titles.size === 0) return artifacts as ConversationArtifact[];
  return artifacts.map(a => {
    const title = titles.get(a.id);
    return title ? { ...a, title } : a;
  });
}

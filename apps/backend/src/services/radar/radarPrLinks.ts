import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import type { RadarScope } from '@/services/radar/radarScope';

const prisma = DatabaseClient.getInstance();
const TAG = '[RADAR-PR-LINKS]';

/**
 * Pull request links in the forms people paste: with or without the scheme or
 * www, any host (GitHub Enterprise, a self-hosted Bitbucket), case-insensitive.
 * The number must end at a non-digit so pull/12 is never read out of pull/123.
 *
 * The lookbehind lets a match start only where a host can start. Without it a
 * long unbroken run of letters, digits and dots (a pasted hash or log line) is
 * re-scanned from every character — quadratic, seconds per message.
 */
const HOST = '(?<![a-z0-9.-])(?:https?:\\/\\/)?(?:www\\.)?([a-z0-9.-]+\\.[a-z]{2,}(?::\\d+)?)';
const SEG = '([\\w~.-]+)';
const NUM = '(\\d+)(?!\\d)';

/** Each provider's URL shape, and the one canonical spelling it maps to. */
const PATTERNS: { source: string; canonical: (m: RegExpMatchArray) => string }[] = [
  // GitHub: <host>/<owner>/<repo>/pull/<n>
  { source: `${HOST}\\/${SEG}\\/${SEG}\\/pull\\/${NUM}`, canonical: m => `https://${m[1]}/${m[2]}/${m[3]}/pull/${m[4]}` },
  // Bitbucket Server / Data Center: <host>/projects/<KEY>/repos/<slug>/pull-requests/<n>
  {
    source: `${HOST}\\/projects\\/${SEG}\\/repos\\/${SEG}\\/pull-requests\\/${NUM}`,
    canonical: m => `https://${m[1]}/projects/${m[2]}/repos/${m[3]}/pull-requests/${m[4]}`,
  },
  // Bitbucket Server personal repos: <host>/users/<name>/repos/<slug>/pull-requests/<n>
  {
    source: `${HOST}\\/users\\/${SEG}\\/repos\\/${SEG}\\/pull-requests\\/${NUM}`,
    canonical: m => `https://${m[1]}/users/${m[2]}/repos/${m[3]}/pull-requests/${m[4]}`,
  },
  // No Bitbucket Cloud shape: no Cloud webhook reaches this service, so a
  // recorded Cloud link could never be matched by a merge.
];

/** Cheap gate: no "/pull/<digit>" or "/pull-requests/<digit>", no link — most messages never reach the regexes. */
const HAS_PR_PATH = /\/pull(?:-requests)?\/\d/i;

/** Lowercased, with the PR number's leading zeros trimmed as text (no float overflow). */
const tidy = (url: string): string => url.toLowerCase().replace(/\/(\d+)$/, (_, n: string) => `/${n.replace(/^0+(?=\d)/, '')}`);

/** The canonical form of a PR URL (GitHub or Bitbucket), or null when it is not one. */
export function normalisePrUrl(url: string): string | null {
  // Fresh, non-global regexes: a shared /g one carries lastIndex between calls.
  for (const p of PATTERNS) {
    const m = url.match(new RegExp(p.source, 'i'));
    if (m) return tidy(p.canonical(m));
  }
  return null;
}

/** Every distinct PR a message links to, canonicalised. */
export function extractPrUrls(content: string): string[] {
  if (!HAS_PR_PATH.test(content)) return [];
  const urls = new Set<string>();
  for (const p of PATTERNS) {
    for (const m of content.matchAll(new RegExp(p.source, 'gi'))) urls.add(tidy(p.canonical(m)));
  }
  return [...urls];
}

/**
 * A PR named by number with a PR word in front: "PR 42", "PR #42", "pull
 * request 42", "MR !42". A bare "#12" is not one ("fix issue #12", "#1
 * priority"), and neither is "PR 2 of 3".
 */
const PR_NUMBER = /\b(?:pr|pull\s*request|merge\s*request|mr)\s*(?:[#!]\s*)?(\d+)\b(?!\s*of\s+\d)/gi;

/**
 * True when an item is plainly about a DIFFERENT pull request, so a merge of
 * this one must never settle it. A link anywhere (title or summary) decides it;
 * a number only counts in the title, because the summary is model-written prose
 * that may mention an earlier PR in passing ("follow-up to PR #2600").
 * An item naming no PR at all is not "another PR" — that is for the model.
 */
export function namesAnotherPr(
  title: string,
  contextSummary: string | null,
  prUrl: string | null,
  prNumber: number,
): boolean {
  const urls = extractPrUrls(`${title}\n${contextSummary ?? ''}`);
  if (urls.length > 0) return !(prUrl && urls.includes(prUrl));
  const numbers = [...title.matchAll(PR_NUMBER)].map(m => Number(m[1]));
  return numbers.length > 0 && !numbers.includes(prNumber);
}

interface WindowMessage {
  messageId: string;
  conversationId: string;
  content: string;
  createdAt: Date;
  workspaceId: string;
}

/**
 * Remembers which Radar scope each PR link was posted in, so a merge can find
 * the threads to judge with one indexed lookup instead of searching chat.
 *
 * Called on every window the worker reads, before the gate, so a link is
 * recorded even in a pass the parser skips. Best-effort: it never throws, and
 * a replayed window is absorbed by the (messageId, prUrl) unique key.
 */
export async function recordPrLinks(scope: RadarScope, window: WindowMessage[]): Promise<void> {
  try {
    const rows = window.flatMap(m =>
      extractPrUrls(m.content).map(prUrl => ({
        workspaceId: m.workspaceId,
        prUrl,
        scopeKey: scope.key,
        channelId: scope.channelId,
        conversationId: m.conversationId,
        messageId: m.messageId,
        postedAt: m.createdAt,
      })),
    );
    if (rows.length === 0) return;
    await prisma.radarPrLink.createMany({ data: rows, skipDuplicates: true });
  } catch (error) {
    logger.warn(`${TAG} recording PR links failed`, {
      scope: scope.key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

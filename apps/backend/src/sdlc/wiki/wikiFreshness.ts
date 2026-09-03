import type { SdlcWikiFreshness } from '@xyne/shared';

export interface WikiFreshnessContext {
  wikiCommitSha: string | null;
  baseBranchHeadSha: string | null;
  freshness: SdlcWikiFreshness;
}

export function computeWikiFreshness(input: {
  wikiCommitSha: string | null;
  baseBranchHeadSha: string | null;
}): WikiFreshnessContext {
  const freshness =
    !input.wikiCommitSha || !input.baseBranchHeadSha
      ? 'UNKNOWN'
      : input.wikiCommitSha.toLowerCase() === input.baseBranchHeadSha.toLowerCase()
        ? 'CURRENT'
        : 'STALE';
  return { ...input, freshness };
}

export function wikiAskAiFreshnessInstruction(context: WikiFreshnessContext): string {
  const identity = `Wiki commit: ${context.wikiCommitSha ?? 'unknown'}; base-branch head: ${context.baseBranchHeadSha ?? 'unknown'}; freshness: ${context.freshness}.`;
  if (context.freshness === 'CURRENT') {
    return `${identity} The Wiki may answer conceptual questions, but inspect live code for exact implementation, security, configuration, or claims not directly supported by the Wiki.`;
  }
  return `${identity} Use the Wiki only for orientation. Inspect live code before making factual repository claims and explicitly disclose that Wiki freshness is ${context.freshness.toLowerCase()}. When Wiki and current code disagree, current code wins.`;
}

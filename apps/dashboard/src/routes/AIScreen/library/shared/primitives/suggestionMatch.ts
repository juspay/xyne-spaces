import type {
  IntegrationToolEntry,
  SuggestedIntegration,
  ToolSuggestion,
} from '@/services/claw/clawToolsTypes';

export interface SuggestedGroup<E> {
  entry: E;
  tools: IntegrationToolEntry[];
}

export function matchSuggestedTools<E>(
  suggestion: ToolSuggestion | undefined,
  catalog: readonly E[],
  slugOf: (entry: E) => string,
  toolsOf: (entry: E) => readonly IntegrationToolEntry[],
  labelOf: (entry: E) => string,
): Array<SuggestedGroup<E>> {
  if (!suggestion) return [];

  const namesBySlug = new Map<string, Set<string>>();
  const allNames = new Set<string>();
  for (const integration of suggestion.integrations ?? []) {
    const names = new Set([...(integration.readTools ?? []), ...(integration.writeTools ?? [])]);
    if (integration.slug) namesBySlug.set(integration.slug, names);
    for (const name of names) allNames.add(name);
  }
  if (allNames.size === 0) return [];

  const anySlugRecognised = catalog.some(entry => namesBySlug.has(slugOf(entry)));

  return catalog
    .map(entry => {
      const scoped = namesBySlug.get(slugOf(entry));
      const names = anySlugRecognised ? scoped : allNames;
      if (!names) return { entry, tools: [] as IntegrationToolEntry[] };
      return { entry, tools: toolsOf(entry).filter(tool => names.has(tool.name)) };
    })
    .filter(match => match.tools.length > 0)
    .sort(
      (a, b) => b.tools.length - a.tools.length || labelOf(a.entry).localeCompare(labelOf(b.entry)),
    );
}

/**
 * The legacy arrays on a suggest-tools response hold only auto-bound picks;
 * mid-confidence picks live under `suggested`. Per-row "Suggest" buttons want
 * both, so fold them into the legacy shape before matching against a catalog.
 */
export function withSuggestedPicks(
  suggestion: ToolSuggestion | undefined,
): ToolSuggestion | undefined {
  const extra = suggestion?.suggested;
  if (!suggestion || !extra) return suggestion;
  const integrations = new Map<string, { readTools: string[]; writeTools: string[] }>();
  const addIntegration = (slug: string, readTools: string[], writeTools: string[]): void => {
    const prev = integrations.get(slug);
    integrations.set(slug, {
      readTools: [...new Set([...(prev?.readTools ?? []), ...readTools])],
      writeTools: [...new Set([...(prev?.writeTools ?? []), ...writeTools])],
    });
  };
  for (const item of suggestion.integrations ?? []) {
    addIntegration(item.slug, item.readTools ?? [], item.writeTools ?? []);
  }
  for (const item of extra.integrations ?? []) {
    addIntegration(item.slug, item.readTools ?? [], item.writeTools ?? []);
  }
  return {
    ...suggestion,
    subagents: [
      ...new Set([...(suggestion.subagents ?? []), ...(extra.subagents ?? []).map(s => s.name)]),
    ],
    integrations: [...integrations].map(([slug, tools]) => ({ slug, ...tools })),
    skillSlugs: [
      ...new Set([...(suggestion.skillSlugs ?? []), ...(extra.skills ?? []).map(s => s.slug)]),
    ],
  };
}

/** Wrap already-resolved integration picks as a suggestion for `matchSuggestedTools`. */
export function suggestionFromPicks(picks: readonly SuggestedIntegration[]): ToolSuggestion {
  return {
    subagents: [],
    integrations: picks.map(pick => ({
      slug: pick.slug,
      readTools: pick.readTools,
      writeTools: pick.writeTools,
    })),
    reasoning: {},
  };
}

import type { IntegrationToolEntry, ToolSuggestion } from '@/services/claw/clawToolsTypes';

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

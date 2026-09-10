/**
 * ToolboxPicker — the shared "pick what this agent can do" power UI.
 *
 * Extracted from CreateAgentModal's Toolbox step so the agent **config page**
 * and the **creation wizard** present the exact same UX (and stay in sync).
 * It renders the three canonical tool buckets — Subagents · subagents,
 * MCP Tools (per-integration, read + write), Built-in tools — as a 3-column
 * rail / chip-groups / selected-tray layout (large), with a single-column
 * collapsible fallback (compact) for narrow frames, plus an AI "Suggest
 * tools" strip (refine input lives in a dialog) and an optional
 * Research-Agent context block.
 *
 * Fully controlled on the selection only (`value` / `onChange`); every other
 * piece of UI state (active category, search, detail pin, suggestion) is owned
 * internally so a host just wires availableTools + selection.
 */
import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react';
import { Sparkles, ChevronRight, Loader2, Check, X, Info } from 'lucide-react';
import { suggestTools } from '@/services/claw/clawToolsService';

import { Dialog } from '@/components/ui/Dialog';
import type {
  AvailableTools,
  IntegrationToolEntry,
  ToolSuggestion,
  ResearchAgentOption,
  ToolboxSelection,
} from '@/services/claw/clawToolsTypes';
import { parseGatewaySelectionKey, parseGatewaySource } from '../gatewayKeys';
import { SectionCaption } from '../SectionCaption';

/** Tailwind class for the risk status dot. Unknown → write (amber). */
function riskDotCls(riskLevel: 'read' | 'write' | 'destructive' | undefined): string {
  if (riskLevel === 'read') return 'bg-emerald-500';
  if (riskLevel === 'destructive') return 'bg-red-500';
  return 'bg-amber-500';
}

/** snake_case → Sentence case, stripping an optional server prefix. */
function humanizeToolName(name: string, prefix?: string): string {
  let n = name;
  if (prefix) {
    const p = prefix.toLowerCase().replace(/-/g, '_') + '_';
    if (n.toLowerCase().startsWith(p)) n = n.slice(p.length);
  }
  return n.replace(/_/g, ' ').replace(/^[a-z]/, c => c.toUpperCase());
}

const SUGGESTION_PHASES = [
  'Reading the tool catalog…',
  'Matching tools to your persona…',
  'Picking subagents that fit…',
  'Finalizing the starter toolkit…',
];

function SuggestionLoading() {
  const [phase, setPhase] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const phaseTimer = setInterval(() => setPhase(p => (p + 1) % SUGGESTION_PHASES.length), 3000);
    const elapsedTimer = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => {
      clearInterval(phaseTimer);
      clearInterval(elapsedTimer);
    };
  }, []);
  return (
    <div className='flex items-center justify-between gap-2 text-[12px] text-foreground'>
      <span className='flex items-center gap-2 min-w-0'>
        <Loader2 size={12} className='animate-spin flex-shrink-0 text-muted-foreground' />
        <span className='truncate'>{SUGGESTION_PHASES[phase]}</span>
      </span>
      <span className='text-[11px] tabular-nums text-muted-foreground flex-shrink-0'>
        {elapsed}s · usually 10–25s
      </span>
    </div>
  );
}

interface ResearchAgentConfig {
  productId: string;
  onProductIdChange: (v: string) => void;
  products: ResearchAgentOption[];
  repositoryId: string;
  onRepositoryIdChange: (v: string) => void;
  repositories: ResearchAgentOption[];
  loading?: boolean;
}

interface Props {
  availableTools: AvailableTools | null;
  loading?: boolean;
  value: ToolboxSelection;
  onChange: (next: ToolboxSelection) => void;
  /** "large" = 3-column; "compact" = single-column. Omit to auto-pick by width. */
  variant?: 'large' | 'compact';
  /** Pixel height for the large (3-column) layout. Omit to fill a flex parent (flex-1). */
  largeHeight?: string;
  /** When set, the violet AI suggest + refine strip renders using this context. */
  suggestContext?: { systemPrompt?: string; description?: string };
  /** Auto-fetch a suggestion on first mount (wizard behavior). Default false. */
  autoSuggest?: boolean;
  /** Optional Research-Agent context block (product/repository pins). */
  researchAgent?: ResearchAgentConfig;
  /** Show the "Toolbox · tools" caption at the top. Default true. */
  showCaption?: boolean;
  /** Hide the Subagents category (e.g. the subagent editor — no nesting). */
  hideSubagents?: boolean;
}

export function ToolboxPicker({
  availableTools: availableToolsProp,
  loading = false,
  value,
  onChange,
  variant,
  largeHeight,
  suggestContext,
  autoSuggest = false,
  researchAgent,
  showCaption = true,
  hideSubagents = false,
}: Props) {
  // When subagents are hidden, drop them from the catalog so every downstream
  // consumer (rail, center list, suggestions, selection tray) omits them.
  const availableTools = useMemo(() => {
    if (!availableToolsProp || !hideSubagents) return availableToolsProp;
    return { ...availableToolsProp, subagents: [] };
  }, [availableToolsProp, hideSubagents]);
  const [toolTab, setToolTab] = useState('all');
  const [toolSearch, setToolSearch] = useState('');
  const [pinnedDetail, setPinnedDetail] = useState<IntegrationToolEntry | null>(null);
  const [hoveredDetail, setHoveredDetail] = useState<IntegrationToolEntry | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  // Which parent categories are expanded in the large-mode tree rail. Both
  // parents start open so the full category hierarchy is visible up front.
  const [expandedRailGroups, setExpandedRailGroups] = useState<Set<string>>(
    () => new Set(['integrations', 'builtin']),
  );
  const toggleRailGroup = (key: string) =>
    setExpandedRailGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const [suggestion, setSuggestion] = useState<ToolSuggestion | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionApplied, setSuggestionApplied] = useState(false);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [refineIntent, setRefineIntent] = useState('');
  const [refineDialogOpen, setRefineDialogOpen] = useState(false);
  const didAutoSuggest = useRef(false);

  // Responsive layout pick (only when `variant` is not forced).
  const rootRef = useRef<HTMLDivElement>(null);
  const [autoLarge, setAutoLarge] = useState(true);
  useEffect(() => {
    if (variant) return;
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setAutoLarge(e.contentRect.width >= 720);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [variant]);
  const large = variant ? variant === 'large' : autoLarge;

  /* ── selection mutators (controlled) ─────────────────────────────── */
  type RequiredSelectionKey = 'subagents' | 'direct' | 'custom';
  const toggle = (key: RequiredSelectionKey, val: string) => {
    const arr = value[key];
    onChange({ ...value, [key]: arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val] });
  };
  const toggleAll = (key: RequiredSelectionKey, all: string[]) =>
    onChange({ ...value, [key]: value[key].length === all.length ? [] : all });
  const toggleCustomGroup = (slugs: string[], allSelected: boolean) =>
    onChange({
      ...value,
      custom: allSelected
        ? value.custom.filter(x => !slugs.includes(x))
        : [...new Set([...value.custom, ...slugs])],
    });
  const clearAll = () => onChange({ subagents: [], direct: [], custom: [], gateway: [] });
  const toggleSection = (key: string) =>
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /* ── AI suggestion flow ──────────────────────────────────────────── */
  const fetchSuggestion = useCallback(
    async (payload: { systemPrompt?: string | undefined; description?: string | undefined }) => {
      setSuggestion(null);
      setSuggestionApplied(false);
      setSuggestionDismissed(false);
      setSuggestionError(null);
      setSuggestionLoading(true);
      try {
        const data = await suggestTools(payload);
        setSuggestion(data);
      } catch (err) {
        setSuggestionError(err instanceof Error ? err.message : "Couldn't load suggestions");
      } finally {
        setSuggestionLoading(false);
      }
    },
    [],
  );

  const suggestPayload = useCallback(() => {
    const sp = suggestContext?.systemPrompt?.trim();
    const desc = suggestContext?.description?.trim();
    return { systemPrompt: sp || undefined, description: !sp ? desc : undefined };
  }, [suggestContext]);

  // Auto-fire once on mount (wizard); waits for tools so chips can reflect.
  // Skip when a selection already exists — re-entering the step after picking
  // tools shouldn't re-suggest (matches V1's "suggest once" behavior).
  useEffect(() => {
    if (!autoSuggest || didAutoSuggest.current || !suggestContext || !availableTools) return;
    if (
      value.subagents.length ||
      value.direct.length ||
      value.custom.length ||
      (value.gateway?.length ?? 0) > 0
    )
      return;
    const intent =
      (suggestContext.systemPrompt || '').trim() || (suggestContext.description || '').trim();
    if (!intent) return;
    didAutoSuggest.current = true;
    void fetchSuggestion(suggestPayload());
  }, [autoSuggest, suggestContext, availableTools, value, fetchSuggestion, suggestPayload]);

  const reRollSuggestion = () => {
    if (suggestContext) void fetchSuggestion(suggestPayload());
  };
  const handleRefine = async () => {
    const intent = refineIntent.trim();
    if (!intent) return;
    await fetchSuggestion({ description: intent });
    setRefineIntent('');
  };
  // Dialog closes right away — progress/result renders inline via the
  // loading/suggestion blocks already in suggestBlock.
  const submitRefine = () => {
    if (!refineIntent.trim()) return;
    setRefineDialogOpen(false);
    void handleRefine();
  };

  // Additive merge of a suggestion into the current selection.
  const applySuggestion = () => {
    if (!suggestion || !availableTools) return;
    const subagentSet = new Set(value.subagents);
    if (!hideSubagents) for (const name of suggestion.subagents ?? []) subagentSet.add(name);
    const suggestedNames = new Set<string>();
    for (const sugg of suggestion.integrations ?? []) {
      for (const n of sugg.readTools ?? []) suggestedNames.add(n);
      for (const n of sugg.writeTools ?? []) suggestedNames.add(n);
    }
    const directSet = new Set(value.direct);
    const customSet = new Set(value.custom);
    for (const t of availableTools.writeTools)
      if (suggestedNames.has(t.name)) directSet.add(t.name);
    for (const [source, tools] of Object.entries(availableTools.serverTools))
      for (const t of tools)
        if (suggestedNames.has(t.name)) directSet.add(parseGatewaySource(source) ? t.slug : t.name);
    for (const g of availableTools.customGroups)
      for (const t of g.tools) if (suggestedNames.has(t.name)) customSet.add(t.slug);
    onChange({
      subagents: Array.from(subagentSet),
      direct: Array.from(directSet),
      custom: Array.from(customSet),
      gateway: value.gateway ?? [],
    });
    setSuggestionApplied(true);
  };

  // Auto-expand sections that received suggested tools (so "Accept all" is visible).
  useEffect(() => {
    if (!suggestionApplied || !suggestion || !availableTools) return;
    const toExpand = new Set<string>();
    if ((suggestion.subagents ?? []).length > 0) toExpand.add('subagents');
    const suggestedNames = new Set<string>();
    for (const s of suggestion.integrations ?? [])
      for (const n of [...(s.readTools ?? []), ...(s.writeTools ?? [])]) suggestedNames.add(n);
    if (availableTools.writeTools.some(t => suggestedNames.has(t.name))) toExpand.add('direct');
    for (const [src, tools] of Object.entries(availableTools.serverTools))
      if (tools.some(t => suggestedNames.has(t.name))) toExpand.add(src);
    for (const g of availableTools.customGroups)
      if (g.tools.some(t => suggestedNames.has(t.name))) toExpand.add(g.source);
    setExpandedSections(prev => new Set([...prev, ...toExpand]));
  }, [suggestionApplied]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── derived ─────────────────────────────────────────────────────── */
  // Each MCP integration owns ALL its tools (read + write together). Write
  // tools are no longer split into a separate "Direct actions" bucket — they
  // live inline under their integration, distinguished by their risk dot.
  const mcpEntries = availableTools
    ? Object.entries(availableTools.serverTools).filter(
        ([source, tools]) =>
          !source.startsWith('custom:') && Array.isArray(tools) && tools.length > 0,
      )
    : [];

  type ToolInfo = IntegrationToolEntry & { source?: string; selectionKey?: string };
  const toolInfoMap = new Map<string, ToolInfo>();
  if (availableTools) {
    for (const sa of availableTools.subagents)
      toolInfoMap.set(sa.name, {
        slug: sa.name,
        name: sa.name,
        description: sa.description,
        riskLevel: 'read',
      });
    for (const intg of availableTools.integrations) {
      for (const t of [...intg.readTools, ...intg.writeTools]) {
        const info: ToolInfo = { ...t, source: intg.slug, selectionKey: t.slug };
        toolInfoMap.set(t.slug, info);
        if (!toolInfoMap.has(t.name)) toolInfoMap.set(t.name, info);
      }
    }
  }

  const pinDetail = (key: string) =>
    setPinnedDetail(prev => {
      const next = toolInfoMap.get(key) ?? null;
      return prev && next && prev.slug === next.slug ? null : next;
    });
  const hoverDetail = (name: string | null) =>
    setHoveredDetail(name ? (toolInfoMap.get(name) ?? null) : null);
  const activeDetail = hoveredDetail ?? pinnedDetail;

  const formatServerLabel = (serverType: string): string => {
    const gatewaySource = parseGatewaySource(serverType);
    if (gatewaySource) {
      const serviceLabel = gatewaySource.serviceName
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
      return `${serviceLabel} (${gatewaySource.backendId})`;
    }
    return serverType.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };
  const customLabel = (source: string): string =>
    source
      .replace('custom:', '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());

  const selectionKeyForMcpTool = (source: string, tool: { slug: string; name: string }) =>
    parseGatewaySource(source) ? tool.slug : tool.name;

  const gatewayKeysForService = (serviceName: string): string[] =>
    mcpEntries.flatMap(([source, tools]) => {
      const parsed = parseGatewaySource(source);
      return parsed?.serviceName === serviceName ? tools.map(t => t.slug) : [];
    });

  const isMcpToolSelected = (source: string, tool: { slug: string; name: string }) => {
    const key = selectionKeyForMcpTool(source, tool);
    if (value.direct.includes(key)) return true;
    const gatewaySource = parseGatewaySource(source);
    return !!gatewaySource && (value.gateway ?? []).includes(gatewaySource.serviceName);
  };

  const setGatewayToolSelection = (
    source: string,
    _tools: Array<{ slug: string; name: string }>,
    tool: { slug: string; name: string },
    next: boolean,
  ) => {
    const gatewaySource = parseGatewaySource(source);
    if (!gatewaySource) {
      toggle('direct', tool.name);
      return;
    }
    const serviceKeys = gatewayKeysForService(gatewaySource.serviceName);
    const serviceKeySet = new Set(serviceKeys);
    const nextSelected = new Set<string>(
      (value.gateway ?? []).includes(gatewaySource.serviceName)
        ? serviceKeys
        : value.direct.filter(key => serviceKeySet.has(key)),
    );
    if (next) nextSelected.add(tool.slug);
    else nextSelected.delete(tool.slug);

    const otherDirect = value.direct.filter(key => !serviceKeySet.has(key));
    onChange({
      ...value,
      gateway: (value.gateway ?? []).filter(service => service !== gatewaySource.serviceName),
      direct: [...otherDirect, ...serviceKeys.filter(key => nextSelected.has(key))],
    });
  };

  const setGatewayBulkSelection = (
    source: string,
    tools: Array<{ slug: string; name: string }>,
    next: boolean,
  ) => {
    const gatewaySource = parseGatewaySource(source);
    if (!gatewaySource) {
      toggleAll(
        'direct',
        tools.map(t => t.name),
      );
      return;
    }
    const groupKeys = tools.map(t => t.slug);
    const groupKeySet = new Set(groupKeys);
    const serviceKeys = gatewayKeysForService(gatewaySource.serviceName);
    const serviceKeySet = new Set(serviceKeys);
    const otherDirect = (value.gateway ?? []).includes(gatewaySource.serviceName)
      ? [
          ...value.direct.filter(key => !serviceKeySet.has(key)),
          ...serviceKeys.filter(key => !groupKeySet.has(key)),
        ]
      : value.direct.filter(key => !groupKeySet.has(key));
    onChange({
      ...value,
      gateway: (value.gateway ?? []).filter(service => service !== gatewaySource.serviceName),
      direct: next ? [...otherDirect, ...groupKeys] : otherDirect,
    });
  };

  const removeDirectSelection = (key: string) => {
    const gatewayKey = parseGatewaySelectionKey(key);
    if (!gatewayKey) {
      toggle('direct', key);
      return;
    }
    const serviceKeys = gatewayKeysForService(gatewayKey.serviceName);
    const serviceKeySet = new Set(serviceKeys);
    const nextSelected = new Set<string>(
      (value.gateway ?? []).includes(gatewayKey.serviceName)
        ? serviceKeys
        : value.direct.filter(item => serviceKeySet.has(item)),
    );
    nextSelected.delete(key);
    const otherDirect = value.direct.filter(item => !serviceKeySet.has(item));
    onChange({
      ...value,
      gateway: (value.gateway ?? []).filter(service => service !== gatewayKey.serviceName),
      direct: [...otherDirect, ...serviceKeys.filter(item => nextSelected.has(item))],
    });
  };

  const selectedDirectKeys = (() => {
    const keys = new Set(value.direct);
    for (const gatewayService of value.gateway ?? []) {
      for (const key of gatewayKeysForService(gatewayService)) keys.add(key);
    }
    return Array.from(keys);
  })();

  const searchQ = toolSearch.trim().toLowerCase();
  // Category-aware search: when the query matches a category/group *label*
  // (e.g. "integrations", "built-in", "analytics", "github") we surface every
  // tool under that group, not just tools whose own name matches.
  const labelMatchesSearch = (label: string) => !!searchQ && label.toLowerCase().includes(searchQ);
  const categoryMatchedNames = (() => {
    const set = new Set<string>();
    if (!searchQ || !availableTools) return set;
    if (labelMatchesSearch('Subagents'))
      for (const sa of availableTools.subagents) set.add(sa.name);
    const allMcp = labelMatchesSearch('MCP Tools') || labelMatchesSearch('mcp');
    for (const [source, tools] of mcpEntries)
      if (allMcp || labelMatchesSearch(formatServerLabel(source)))
        for (const t of tools) set.add(t.name);
    const allBuiltin = labelMatchesSearch('Built-in tools') || labelMatchesSearch('builtin');
    for (const g of availableTools.customGroups)
      if (allBuiltin || labelMatchesSearch(customLabel(g.source)))
        for (const t of g.tools) set.add(t.name);
    return set;
  })();
  const toolMatchesSearch = (name: string) =>
    !searchQ ||
    name.toLowerCase().includes(searchQ) ||
    humanizeToolName(name).toLowerCase().includes(searchQ) ||
    categoryMatchedNames.has(name);
  const sectionOpen = (key: string, toolNames: string[]) =>
    searchQ ? toolNames.some(n => toolMatchesSearch(n)) : expandedSections.has(key);
  const sectionVisible = (toolNames: string[]) =>
    !searchQ || toolNames.some(n => toolMatchesSearch(n));

  type SelectionCat = 'subagents' | 'integrations' | 'builtin';
  const selectionItems: Array<{
    label: string;
    key: string;
    cat: SelectionCat;
    riskLevel: 'read' | 'write' | 'destructive' | undefined;
    onRemove: () => void;
  }> = [
    ...value.subagents.map(name => ({
      label: name,
      key: `sa-${name}`,
      cat: 'subagents' as const,
      riskLevel: 'read' as const,
      onRemove: () => toggle('subagents', name),
    })),
    // value.direct holds every selected MCP-integration tool (read + write).
    ...selectedDirectKeys.map(key => {
      const info = toolInfoMap.get(key);
      return {
        label: humanizeToolName(info?.name ?? key),
        key: `d-${key}`,
        cat: 'integrations' as const,
        riskLevel: info?.riskLevel ?? ('write' as const),
        onRemove: () => removeDirectSelection(key),
      };
    }),
    ...(availableTools?.customGroups.flatMap(g =>
      g.tools
        .filter(t => value.custom.includes(t.slug))
        .map(t => ({
          label: humanizeToolName(t.name),
          key: `c-${t.slug}`,
          cat: 'builtin' as const,
          riskLevel:
            (toolInfoMap.get(t.slug) ?? toolInfoMap.get(t.name))?.riskLevel ?? ('write' as const),
          onRemove: () => toggle('custom', t.slug),
        })),
    ) ?? []),
  ];
  const SELECTION_CAT_META: Record<SelectionCat, { label: string; dot: string }> = {
    subagents: { label: 'Subagents', dot: 'bg-violet-500' },
    integrations: { label: 'MCP Tools', dot: 'bg-emerald-500' },
    builtin: { label: 'Built-in tools', dot: 'bg-slate-400' },
  };
  const groupedSelection = (['subagents', 'integrations', 'builtin'] as SelectionCat[])
    .map(cat => ({
      cat,
      ...SELECTION_CAT_META[cat],
      items: selectionItems.filter(s => s.cat === cat),
    }))
    .filter(g => g.items.length > 0);

  // Sidebar accordion model. Leaf groups (Subagents, Direct actions) are a
  // single clickable row; parent groups (MCP Tools, Built-in tools)
  // roll up per-child counts and expand to indented children.
  type RailChild = {
    key: string;
    label: string;
    dot: string;
    selCount: number;
    totalCount: number;
    hasDestructive: boolean;
  };
  type RailGroup = {
    key: string;
    label: string;
    dot?: string;
    selCount: number;
    totalCount: number;
    hasDestructive: boolean;
    children?: RailChild[];
  };
  const railGroups: RailGroup[] = availableTools
    ? (() => {
        const serverChildren: RailChild[] = mcpEntries
          .map(([source, tools]) => ({
            key: source,
            label: formatServerLabel(source),
            dot: 'bg-emerald-500',
            selCount: tools.filter(t => isMcpToolSelected(source, t)).length,
            totalCount: tools.length,
            hasDestructive: tools.some(
              t =>
                (toolInfoMap.get(t.slug) ?? toolInfoMap.get(t.name))?.riskLevel === 'destructive',
            ),
          }))
          .filter(item => item.totalCount > 0);
        const customChildren: RailChild[] = availableTools.customGroups.map(g => ({
          key: g.source,
          label: customLabel(g.source),
          dot: 'bg-slate-400',
          selCount: g.tools.filter(t => value.custom.includes(t.slug)).length,
          totalCount: g.tools.length,
          hasDestructive: g.tools.some(t => toolInfoMap.get(t.name)?.riskLevel === 'destructive'),
        }));
        const rollup = (children: RailChild[]) => ({
          selCount: children.reduce((s, c) => s + c.selCount, 0),
          totalCount: children.reduce((s, c) => s + c.totalCount, 0),
          hasDestructive: children.some(c => c.hasDestructive),
        });
        const groups: RailGroup[] = [];
        if (availableTools.subagents.length > 0)
          groups.push({
            key: 'subagents',
            label: 'Subagents',
            dot: 'bg-violet-500',
            selCount: value.subagents.length,
            totalCount: availableTools.subagents.length,
            hasDestructive: false,
          });
        if (serverChildren.length > 0)
          groups.push({
            key: 'integrations',
            label: 'MCP Tools',
            dot: 'bg-emerald-500',
            children: serverChildren,
            ...rollup(serverChildren),
          });
        if (customChildren.length > 0)
          groups.push({
            key: 'builtin',
            label: 'Built-in tools',
            dot: 'bg-slate-400',
            children: customChildren,
            ...rollup(customChildren),
          });
        return groups;
      })()
    : [];

  /* ── shared bits: chip + suggest strip ───────────────────────────── */
  const makeChip = (
    id: string,
    displayName: string,
    rawName: string,
    selected: boolean,
    riskLevel: 'read' | 'write' | 'destructive' | undefined,
    onClickFn: () => void,
    detailKey = rawName,
  ) => (
    <button
      key={id}
      type='button'
      data-track-category='Claw Agents'
      data-track-name='Toggle tool selection'
      onClick={() => {
        onClickFn();
        pinDetail(detailKey);
      }}
      onMouseEnter={() => hoverDetail(detailKey)}
      onMouseLeave={() => hoverDetail(null)}
      onFocus={() => hoverDetail(detailKey)}
      onBlur={() => hoverDetail(null)}
      title={rawName}
      aria-pressed={selected}
      className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-[13px] transition ${
        selected
          ? 'border-foreground bg-foreground text-background'
          : 'border-border/60 bg-card text-foreground/80 hover:border-border hover:bg-muted'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${riskDotCls(riskLevel)}`}
        aria-hidden='true'
      />
      <span className='truncate'>{displayName}</span>
    </button>
  );

  const suggestActive = !suggestionDismissed && !suggestionApplied;
  const suggestBlock = suggestContext ? (
    <div className='space-y-1.5'>
      {suggestActive && suggestionLoading && (
        <div className='rounded-md bg-muted/40 px-2.5 py-1.5'>
          <SuggestionLoading />
        </div>
      )}

      {suggestActive && !suggestionLoading && suggestionError && (
        <div className='flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-[12px] text-foreground'>
          <Sparkles size={13} className='shrink-0 text-muted-foreground' />
          <span className='min-w-0 flex-1 truncate'>
            Couldn&apos;t suggest tools — {suggestionError}
          </span>
          <button
            type='button'
            data-ph-capture-attribute-track-id='claw_toolbox_resuggest'
            data-track-category='Claw Agents'
            data-track-name='Re-suggest tools'
            onClick={reRollSuggestion}
            className='shrink-0 font-medium underline-offset-2 hover:underline'
          >
            Try again
          </button>
          <button
            type='button'
            data-track-category='Claw Agents'
            data-track-name='Dismiss suggestion'
            onClick={() => setSuggestionDismissed(true)}
            aria-label='Dismiss suggestion'
            className='shrink-0 text-muted-foreground hover:text-foreground transition-colors'
          >
            <X size={13} />
          </button>
        </div>
      )}

      {suggestActive &&
        !suggestionLoading &&
        suggestion &&
        (() => {
          const newSubagents = hideSubagents
            ? []
            : (suggestion.subagents ?? []).filter(n => !value.subagents.includes(n));
          const newDirect: string[] = [];
          const newIntegrationTools: string[] = [];
          const newCustom: string[] = [];
          if (availableTools) {
            const suggestedNames = new Set<string>();
            for (const sugg of suggestion.integrations ?? []) {
              for (const n of sugg.readTools ?? []) suggestedNames.add(n);
              for (const n of sugg.writeTools ?? []) suggestedNames.add(n);
            }
            const writeToolNameSet = new Set(availableTools.writeTools.map(t => t.name));
            for (const t of availableTools.writeTools)
              if (suggestedNames.has(t.name) && !value.direct.includes(t.name))
                newDirect.push(t.name);
            for (const [source, tools] of Object.entries(availableTools.serverTools))
              for (const t of tools) {
                if (writeToolNameSet.has(t.name)) continue;
                const selectionKey = parseGatewaySource(source) ? t.slug : t.name;
                if (
                  suggestedNames.has(t.name) &&
                  !value.direct.includes(selectionKey) &&
                  !newIntegrationTools.includes(selectionKey)
                )
                  newIntegrationTools.push(selectionKey);
              }
            for (const g of availableTools.customGroups)
              for (const t of g.tools)
                if (suggestedNames.has(t.name) && !value.custom.includes(t.slug))
                  newCustom.push(t.slug);
          }
          const newIntegrationsTotal = newIntegrationTools.length + newCustom.length;
          const total = newSubagents.length + newDirect.length + newIntegrationsTotal;
          if (total === 0) {
            return (
              <div className='flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-[12px] text-muted-foreground'>
                <Sparkles size={13} className='shrink-0' />
                <span className='flex-1'>Already covered — nothing new to add.</span>
                <button
                  type='button'
                  data-track-category='Claw Agents'
                  data-track-name='Dismiss suggestion'
                  onClick={() => setSuggestionDismissed(true)}
                  aria-label='Dismiss suggestion'
                  className='shrink-0 hover:text-foreground transition-colors'
                >
                  <X size={13} />
                </button>
              </div>
            );
          }
          const chipCls = 'rounded-full bg-card px-1.5 py-0.5 text-[11px] text-foreground/80';
          return (
            <div className='space-y-2 rounded-md bg-muted/40 p-2.5'>
              <div className='flex items-center justify-between gap-2'>
                <span className='inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground'>
                  <Sparkles size={12} /> Suggested toolkit
                </span>
                <button
                  type='button'
                  data-track-category='Claw Agents'
                  data-track-name='Dismiss suggestion'
                  onClick={() => setSuggestionDismissed(true)}
                  className='text-[11px] text-muted-foreground hover:text-foreground transition-colors'
                >
                  Dismiss
                </button>
              </div>
              <div className='flex flex-col gap-1'>
                {newSubagents.length > 0 && (
                  <div className='flex flex-wrap items-baseline gap-x-2 gap-y-1'>
                    <span className='text-[11px] font-medium text-foreground'>
                      Subagents · {newSubagents.length}
                    </span>
                    <span className='flex flex-wrap gap-1'>
                      {newSubagents.slice(0, 4).map(n => (
                        <span key={n} className={chipCls}>
                          {n}
                        </span>
                      ))}
                      {newSubagents.length > 4 && (
                        <span className='text-[11px] text-muted-foreground'>
                          +{newSubagents.length - 4} more
                        </span>
                      )}
                    </span>
                  </div>
                )}
                {newDirect.length > 0 && (
                  <div className='flex flex-wrap items-baseline gap-x-2 gap-y-1'>
                    <span className='text-[11px] font-medium text-foreground'>
                      Direct actions · {newDirect.length}
                    </span>
                    <span className='flex flex-wrap gap-1'>
                      {newDirect.slice(0, 4).map(n => (
                        <span key={n} className={chipCls}>
                          {humanizeToolName(n)}
                        </span>
                      ))}
                      {newDirect.length > 4 && (
                        <span className='text-[11px] text-muted-foreground'>
                          +{newDirect.length - 4} more
                        </span>
                      )}
                    </span>
                  </div>
                )}
                {newIntegrationsTotal > 0 && (
                  <div className='flex flex-wrap items-baseline gap-x-2 gap-y-1'>
                    <span className='text-[11px] font-medium text-foreground'>
                      MCP Tools · {newIntegrationsTotal}
                    </span>
                    <span className='flex flex-wrap gap-1'>
                      {newIntegrationTools.slice(0, 4).map(n => {
                        const info = toolInfoMap.get(n);
                        return (
                          <span key={n} className={chipCls}>
                            {humanizeToolName(info?.name ?? n)}
                          </span>
                        );
                      })}
                      {newIntegrationTools.length > 4 && (
                        <span className='text-[11px] text-muted-foreground'>
                          +{newIntegrationTools.length - 4} more
                        </span>
                      )}
                      {newCustom.length > 0 && (
                        <span className='text-[11px] text-muted-foreground'>
                          {newIntegrationTools.length > 0 ? '· ' : ''}
                          {newCustom.length} custom tool{newCustom.length === 1 ? '' : 's'}
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>
              <div className='flex items-center gap-2'>
                <button
                  type='button'
                  data-track-category='Claw Agents'
                  data-track-name='Accept suggested tools'
                  onClick={applySuggestion}
                  className='inline-flex items-center gap-1 rounded bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:bg-foreground/90'
                >
                  <Sparkles size={12} /> Accept all {total}
                </button>
                <button
                  type='button'
                  data-ph-capture-attribute-track-id='claw_toolbox_resuggest'
                  data-track-category='Claw Agents'
                  data-track-name='Re-suggest tools'
                  onClick={reRollSuggestion}
                  className='rounded bg-muted px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted/70'
                >
                  Re-suggest
                </button>
              </div>
            </div>
          );
        })()}

      {suggestionApplied && (
        <div className='flex items-center gap-2 rounded-md bg-emerald-500/10 px-2.5 py-1.5 text-[12px] text-emerald-600 dark:text-emerald-400'>
          <Check size={13} className='shrink-0' />
          <span className='flex-1'>Suggestions applied</span>
          <button
            type='button'
            data-ph-capture-attribute-track-id='claw_toolbox_resuggest'
            data-track-category='Claw Agents'
            data-track-name='Re-suggest tools'
            onClick={reRollSuggestion}
            className='shrink-0 font-medium underline-offset-2 hover:underline'
          >
            Re-suggest
          </button>
        </div>
      )}
    </div>
  ) : null;

  // Trigger + dialog for the manual "describe what to add" refine flow.
  // Rendered next to the section caption, at the far end of the header row.
  const suggestTrigger = suggestContext ? (
    <>
      {!suggestionLoading && (
        <button
          type='button'
          data-track-category='Claw Agents'
          data-track-name='Open suggest tools dialog'
          onClick={() => setRefineDialogOpen(true)}
          className='inline-flex shrink-0 items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted/70'
        >
          <Sparkles size={13} /> Suggest tools…
        </button>
      )}

      <Dialog
        open={refineDialogOpen}
        onOpenChange={setRefineDialogOpen}
        title='Suggest tools'
        description="Describe what this agent needs to do and we'll suggest tools to add."
        className='max-w-md p-0'
      >
        <div className='px-6 pt-6 pb-1'>
          <h2 className='text-lg font-semibold text-foreground tracking-tight'>Suggest tools</h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            Describe what this agent needs to do and we&apos;ll suggest tools to add.
          </p>
        </div>
        <div className='px-6 py-4'>
          <textarea
            data-track-category='Claw Agents'
            data-track-name='Describe tools to add'
            value={refineIntent}
            onChange={e => setRefineIntent(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitRefine();
              }
            }}
            placeholder='e.g. I also need Slack notifications and Jira ticket creation'
            aria-label='Describe tools to add'
            rows={3}
            autoFocus
            className='w-full resize-none rounded-lg bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40'
          />
        </div>
        <div className='flex justify-end gap-2 px-6 py-5'>
          <button
            type='button'
            data-track-category='Claw Agents'
            data-track-name='Cancel suggest tools dialog'
            onClick={() => setRefineDialogOpen(false)}
            className='rounded-md bg-muted px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/70'
          >
            Cancel
          </button>
          <button
            type='button'
            data-ph-capture-attribute-track-id='claw_toolbox_suggest_submit'
            data-track-category='Claw Agents'
            data-track-name='Submit suggest tools'
            onClick={submitRefine}
            disabled={!refineIntent.trim()}
            className='inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed'
          >
            <Sparkles size={14} /> Suggest
          </button>
        </div>
      </Dialog>
    </>
  ) : null;

  const researchBlock =
    researchAgent &&
    (value.custom.includes('query-codebase') || value.custom.includes('review-pull-request')) ? (
      <div className='mb-4 rounded-xl bg-card p-3'>
        <div className='mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
          Research Agent context
        </div>
        <p className='mb-3 text-[12px] text-foreground/80'>
          Pick a product or repository for Research Agent tools. Product wins when both are set.
        </p>
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
          <select
            data-track-category='Claw Agents'
            data-track-name='Select research agent product'
            value={researchAgent.productId}
            onChange={e => researchAgent.onProductIdChange(e.target.value)}
            className='min-w-0 w-full rounded-lg bg-muted px-3 py-2 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40'
          >
            <option value=''>No product</option>
            {researchAgent.products.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.id})
              </option>
            ))}
          </select>
          <select
            data-track-category='Claw Agents'
            data-track-name='Select research agent repository'
            value={researchAgent.repositoryId}
            onChange={e => researchAgent.onRepositoryIdChange(e.target.value)}
            className='min-w-0 w-full rounded-lg bg-muted px-3 py-2 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40'
          >
            <option value=''>No repository</option>
            {researchAgent.repositories.map(r => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.id})
              </option>
            ))}
          </select>
        </div>
        {researchAgent.loading && (
          <p className='mt-2 text-[11px] text-muted-foreground'>Loading Research Agent options…</p>
        )}
      </div>
    ) : null;

  /* ── render ──────────────────────────────────────────────────────── */
  if (large) {
    return (
      <div
        ref={rootRef}
        className={`flex flex-col min-h-0${largeHeight ? '' : ' flex-1'}`}
        style={largeHeight ? { height: largeHeight } : undefined}
      >
        <div
          className='shrink-0 overflow-y-auto px-1 py-1 space-y-3'
          style={{ maxHeight: '220px' }}
        >
          {(showCaption || suggestTrigger) && (
            <div className='flex items-center gap-3'>
              {showCaption && <SectionCaption friendly='Toolbox' technical='tools' />}
              {suggestTrigger && <div className='ml-auto'>{suggestTrigger}</div>}
            </div>
          )}
          {researchBlock}
          {suggestBlock}
        </div>

        {loading && (
          <div className='flex items-center gap-2 px-1 py-6 text-[13px] text-muted-foreground'>
            <Loader2 size={14} className='animate-spin' /> Loading tools…
          </div>
        )}

        {!loading && availableTools && (
          <div className='flex-1 min-h-0 flex overflow-hidden'>
            <nav className='w-52 shrink-0 flex flex-col pr-2' aria-label='Tool categories'>
              <div className='shrink-0 px-4 pt-3 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
                Categories
              </div>
              <div className='flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-2'>
                {(() => {
                  // Render the rail as an indented tree so the category
                  // hierarchy reads at a glance: All tools · Subagents · MCP
                  // Tools › (one child per server) · Built-in tools › (one
                  // child per group). Parent rows scope the center list to the
                  // whole bucket; children scope to a single server/group.
                  const totalToolCount =
                    availableTools.subagents.length +
                    mcpEntries.reduce((s, [, tools]) => s + tools.length, 0) +
                    availableTools.customGroups.reduce((s, g) => s + g.tools.length, 0);
                  const rowCls = (active: boolean, indent = false) =>
                    `flex w-full items-center gap-2 rounded-md py-1.5 text-[13px] text-left transition-colors ${
                      indent ? 'pl-2 pr-2' : 'px-2'
                    } ${
                      active
                        ? 'bg-muted font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`;
                  const dot = (cls?: string) =>
                    cls ? (
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${cls}`}
                        aria-hidden='true'
                      />
                    ) : (
                      <span className='h-1.5 w-1.5 shrink-0' aria-hidden='true' />
                    );
                  const count = (_selCount: number, totalCount: number) => (
                    <span className='shrink-0 tabular-nums text-[11px] text-muted-foreground'>
                      {totalCount}
                    </span>
                  );
                  const rowContent = (c: {
                    label: string;
                    dot?: string;
                    hasDestructive: boolean;
                    selCount: number;
                    totalCount: number;
                  }) => (
                    <>
                      {dot(c.dot)}
                      <span className='flex-1 truncate'>{c.label}</span>
                      {c.hasDestructive && (
                        <span
                          className='h-1.5 w-1.5 shrink-0 rounded-full bg-red-500'
                          aria-label='Contains destructive tools'
                        />
                      )}
                      {count(c.selCount, c.totalCount)}
                    </>
                  );
                  return (
                    <>
                      <button
                        type='button'
                        data-track-category='Claw Agents'
                        data-track-name='Filter tools by category'
                        onClick={() => setToolTab('all')}
                        aria-current={toolTab === 'all' ? 'page' : undefined}
                        className={rowCls(toolTab === 'all')}
                      >
                        <span className='h-1.5 w-1.5 shrink-0' aria-hidden='true' />
                        <span className='flex-1 truncate'>All tools</span>
                        {count(selectionItems.length, totalToolCount)}
                      </button>
                      {railGroups.map(g => {
                        // Leaf category (Subagents) — a single top-level row.
                        if (!g.children || g.children.length === 0) {
                          return (
                            <button
                              key={g.key}
                              type='button'
                              data-track-category='Claw Agents'
                              data-track-name='Filter tools by category'
                              onClick={() => setToolTab(g.key)}
                              aria-current={toolTab === g.key ? 'page' : undefined}
                              className={rowCls(toolTab === g.key)}
                            >
                              {rowContent(g)}
                            </button>
                          );
                        }
                        // Parent category (MCP Tools, Built-in tools) — chevron
                        // toggles the indented children; the label scopes the
                        // center list to the whole bucket.
                        const expanded = expandedRailGroups.has(g.key);
                        return (
                          <div key={g.key} className='flex flex-col gap-0.5'>
                            <div className='flex items-center'>
                              <button
                                type='button'
                                data-track-category='Claw Agents'
                                data-track-name='Filter tools by category'
                                onClick={() => setToolTab(g.key)}
                                aria-current={toolTab === g.key ? 'page' : undefined}
                                className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-left transition-colors ${toolTab === g.key ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                              >
                                {dot(g.dot)}
                                <span className='flex-1 truncate'>{g.label}</span>
                                {g.hasDestructive && (
                                  <span
                                    className='h-1.5 w-1.5 shrink-0 rounded-full bg-red-500'
                                    aria-label='Contains destructive tools'
                                  />
                                )}
                              </button>
                              <button
                                type='button'
                                data-track-category='Claw Agents'
                                data-track-name='Toggle category group'
                                onClick={() => toggleRailGroup(g.key)}
                                aria-expanded={expanded}
                                aria-label={`${expanded ? 'Collapse' : 'Expand'} ${g.label}`}
                                className='flex shrink-0 items-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                              >
                                <ChevronRight
                                  size={14}
                                  className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
                                  aria-hidden='true'
                                />
                              </button>
                            </div>
                            {expanded && (
                              <div className='ml-3 flex flex-col gap-0.5 pl-1'>
                                {g.children.map(c => (
                                  <button
                                    key={c.key}
                                    type='button'
                                    data-track-category='Claw Agents'
                                    data-track-name='Filter tools by category'
                                    onClick={() => setToolTab(c.key)}
                                    aria-current={toolTab === c.key ? 'page' : undefined}
                                    className={rowCls(toolTab === c.key, true)}
                                  >
                                    {rowContent(c)}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
              </div>
            </nav>

            <div className='flex-1 min-w-0 flex flex-col overflow-hidden'>
              <div className='shrink-0 px-5 py-3 flex items-center gap-3'>
                <div className='relative flex-1'>
                  <input
                    type='search'
                    data-track-category='Claw Agents'
                    data-track-name='Search tools'
                    value={toolSearch}
                    onChange={e => setToolSearch(e.target.value)}
                    placeholder='Search tools…'
                    aria-label='Search tools'
                    className='w-full rounded-lg bg-muted px-3 py-1.5 pr-8 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 transition-[box-shadow] [&::-webkit-search-cancel-button]:hidden'
                  />
                  {toolSearch && (
                    <button
                      type='button'
                      data-track-category='Claw Agents'
                      data-track-name='Clear tool search'
                      onClick={() => setToolSearch('')}
                      aria-label='Clear search'
                      className='absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors'
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              <div className='flex-1 min-h-0 overflow-y-auto px-5 pb-4'>
                {/* pt-4 lives on this plain wrapper, not the scrolling container above —
                    padding on the scroll container itself would offset where sticky
                    group headers lock, leaving a gap the previous group peeks through. */}
                <div className='pt-4'>
                  {(() => {
                    const globalSearch = !!searchQ;
                    const showSubagents =
                      (globalSearch || toolTab === 'all' || toolTab === 'subagents') &&
                      availableTools.subagents.length > 0;
                    const activeMcp = !globalSearch
                      ? mcpEntries.find(([s]) => s === toolTab)
                      : null;
                    const activeCustom = !globalSearch
                      ? availableTools.customGroups.find(g => g.source === toolTab)
                      : null;

                    const renderGroup = (
                      title: string,
                      chips: ReactNode[],
                      selCount: number,
                      totalCount: number,
                      onSelectAll?: () => void,
                      allSelected?: boolean,
                    ) => (
                      <div className='mb-8 last:mb-0'>
                        <div className='sticky top-0 z-10 flex items-center gap-2 bg-background py-2 mb-1'>
                          <h3 className='text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground'>
                            {title}
                          </h3>
                          <span className='text-[11px] tabular-nums text-muted-foreground'>
                            {selCount > 0 ? `${selCount}/` : ''}
                            {totalCount}
                          </span>
                          {onSelectAll && (
                            <button
                              type='button'
                              data-track-category='Claw Agents'
                              data-track-name='Select all tools in group'
                              onClick={onSelectAll}
                              className='ml-auto text-[11px] font-medium text-foreground/80 hover:text-foreground transition-colors'
                            >
                              {allSelected ? 'Deselect all' : 'Select all'}
                            </button>
                          )}
                        </div>
                        <div className='grid grid-cols-2 gap-2.5 lg:grid-cols-3 xl:grid-cols-4'>
                          {chips}
                        </div>
                      </div>
                    );

                    const subagentChips = showSubagents
                      ? availableTools.subagents
                          .filter(sa => toolMatchesSearch(sa.name))
                          .map(sa =>
                            makeChip(
                              sa.name,
                              sa.name,
                              sa.name,
                              value.subagents.includes(sa.name),
                              'read',
                              () => toggle('subagents', sa.name),
                            ),
                          )
                      : [];

                    const mcpSections = (
                      activeMcp
                        ? [activeMcp]
                        : globalSearch || toolTab === 'all' || toolTab === 'integrations'
                          ? mcpEntries
                          : []
                    ).map(([source, tools]) => {
                      const matched = tools.filter(t => toolMatchesSearch(t.name));
                      const allKeys = tools.map(t => selectionKeyForMcpTool(source, t));
                      const selCount = tools.filter(t => isMcpToolSelected(source, t)).length;
                      const totalCount = allKeys.length;
                      const allSelected =
                        totalCount > 0 && tools.every(t => isMcpToolSelected(source, t));
                      const gatewaySource = parseGatewaySource(source);
                      return {
                        source,
                        chips: matched.map(t => {
                          const selectionKey = selectionKeyForMcpTool(source, t);
                          return makeChip(
                            `${source}-${t.slug}`,
                            humanizeToolName(t.name, gatewaySource?.serviceName ?? source),
                            t.name,
                            isMcpToolSelected(source, t),
                            (toolInfoMap.get(t.slug) ?? toolInfoMap.get(t.name))?.riskLevel,
                            () =>
                              setGatewayToolSelection(
                                source,
                                tools,
                                t,
                                !isMcpToolSelected(source, t),
                              ),
                            selectionKey,
                          );
                        }),
                        selCount,
                        totalCount,
                        onSelectAll: () =>
                          gatewaySource
                            ? setGatewayBulkSelection(source, tools, !allSelected)
                            : toggleAll('direct', allKeys),
                        allSelected,
                      };
                    });

                    const customSections = (
                      activeCustom
                        ? [activeCustom]
                        : globalSearch || toolTab === 'all' || toolTab === 'builtin'
                          ? availableTools.customGroups
                          : []
                    ).map(g => {
                      const label = customLabel(g.source);
                      const chips = g.tools
                        .filter(t => toolMatchesSearch(t.name))
                        .map(t =>
                          makeChip(
                            t.slug,
                            humanizeToolName(t.name),
                            t.name,
                            value.custom.includes(t.slug),
                            toolInfoMap.get(t.name)?.riskLevel,
                            () => toggle('custom', t.slug),
                          ),
                        );
                      const selCount = g.tools.filter(t => value.custom.includes(t.slug)).length;
                      const slugs = g.tools.map(t => t.slug);
                      const allSelected =
                        slugs.length > 0 && slugs.every(s => value.custom.includes(s));
                      return {
                        label,
                        chips,
                        selCount,
                        totalCount: g.tools.length,
                        onSelectAll: () => toggleCustomGroup(slugs, allSelected),
                        allSelected,
                      };
                    });

                    const hasAnything =
                      subagentChips.length > 0 ||
                      mcpSections.some(s => s.chips.length > 0) ||
                      customSections.some(s => s.chips.length > 0);
                    if (!hasAnything) {
                      return (
                        <p
                          className='py-8 text-center text-[13px] text-muted-foreground'
                          role='status'
                        >
                          {searchQ
                            ? `No tools match "${toolSearch}"`
                            : 'No tools in this category.'}
                        </p>
                      );
                    }

                    const subagentAllSel =
                      availableTools.subagents.length > 0 &&
                      availableTools.subagents.every(sa => value.subagents.includes(sa.name));

                    return (
                      <div>
                        {showSubagents &&
                          subagentChips.length > 0 &&
                          renderGroup(
                            'Subagents',
                            subagentChips,
                            value.subagents.length,
                            availableTools.subagents.length,
                            () =>
                              toggleAll(
                                'subagents',
                                availableTools.subagents.map(sa => sa.name),
                              ),
                            subagentAllSel,
                          )}
                        {mcpSections.map(
                          ({ source, chips, selCount, totalCount, onSelectAll, allSelected }) =>
                            chips.length > 0 &&
                            renderGroup(
                              formatServerLabel(source),
                              chips,
                              selCount,
                              totalCount,
                              onSelectAll,
                              allSelected,
                            ),
                        )}
                        {customSections.map(
                          ({ label, chips, selCount, totalCount, onSelectAll, allSelected }) =>
                            chips.length > 0 &&
                            renderGroup(
                              label,
                              chips,
                              selCount,
                              totalCount,
                              onSelectAll,
                              allSelected,
                            ),
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div
                className='shrink-0 px-6 py-5 flex flex-col justify-center overflow-y-auto'
                style={{ minHeight: '104px', maxHeight: '168px' }}
                aria-live='polite'
                aria-label='Tool detail'
              >
                {activeDetail ? (
                  <div className='flex flex-col gap-2 min-w-0'>
                    <div className='flex items-center gap-2 min-w-0'>
                      <span
                        className={`h-2 w-2 flex-shrink-0 rounded-full ${riskDotCls(activeDetail.riskLevel)}`}
                        aria-hidden='true'
                      />
                      <span className='text-[14px] font-semibold text-foreground truncate'>
                        {humanizeToolName(activeDetail.name)}
                      </span>
                      <span className='font-mono text-[11px] text-muted-foreground truncate hidden sm:block'>
                        {activeDetail.name}
                      </span>
                      <span
                        className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.05em] ml-auto ${
                          activeDetail.riskLevel === 'read'
                            ? 'bg-emerald-100 text-emerald-700'
                            : activeDetail.riskLevel === 'write'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {activeDetail.riskLevel}
                      </span>
                    </div>
                    <p className='text-[13px] text-foreground/80 leading-relaxed'>
                      {activeDetail.description || 'No description available.'}
                    </p>
                  </div>
                ) : (
                  <div className='flex items-center justify-between gap-4 w-full'>
                    <div className='flex items-center gap-2 text-muted-foreground'>
                      <Info size={13} className='shrink-0' />
                      <p className='text-[12px]'>Hover or select a tool to see its description.</p>
                    </div>
                    <div className='shrink-0 flex flex-col gap-1.5'>
                      <p className='text-[10px] font-semibold uppercase tracking-[0.07em] text-foreground/80'>
                        Risk level
                      </p>
                      <div className='flex items-center gap-3 text-[11px] text-foreground/80'>
                        <span className='flex items-center gap-1.5'>
                          <span
                            className='h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0'
                            aria-hidden='true'
                          />
                          Read
                        </span>
                        <span className='flex items-center gap-1.5'>
                          <span
                            className='h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0'
                            aria-hidden='true'
                          />
                          Write
                        </span>
                        <span className='flex items-center gap-1.5'>
                          <span
                            className='h-1.5 w-1.5 rounded-full bg-red-500 shrink-0'
                            aria-hidden='true'
                          />
                          Destructive
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {selectionItems.length > 0 && (
              <div className='w-64 shrink-0 flex flex-col'>
                <div className='shrink-0 flex items-center justify-between gap-2 px-5 py-3'>
                  <span className='text-[13px] font-semibold text-foreground'>{`${selectionItems.length} selected`}</span>
                  {selectionItems.length > 0 && (
                    <button
                      type='button'
                      data-track-category='Claw Agents'
                      data-track-name='Clear all selected tools'
                      onClick={clearAll}
                      className='text-[11px] text-muted-foreground hover:text-red-500 transition-colors'
                    >
                      Clear all
                    </button>
                  )}
                </div>
                <div
                  className='flex-1 min-h-0 overflow-y-auto py-1'
                  role='list'
                  aria-label='Selected tools'
                >
                  {groupedSelection.map(grp => (
                    <div key={grp.cat} className='mb-3 last:mb-0'>
                      <div className='flex items-center gap-1.5 px-5 pt-2.5 pb-1'>
                        <span
                          className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${grp.dot}`}
                          aria-hidden='true'
                        />
                        <span className='text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground'>
                          {grp.label}
                        </span>
                        <span className='text-[10px] tabular-nums text-muted-foreground'>
                          {grp.items.length}
                        </span>
                      </div>
                      {grp.items.map(({ label, key, riskLevel, onRemove }) => (
                        <div
                          key={key}
                          role='listitem'
                          className='flex items-center gap-2 pl-9 pr-5 py-1.5 hover:bg-muted group transition-colors'
                        >
                          <span
                            className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${riskDotCls(riskLevel)}`}
                            aria-hidden='true'
                          />
                          <span className='flex-1 min-w-0 truncate text-[12px] text-foreground'>
                            {label}
                          </span>
                          <button
                            type='button'
                            data-track-category='Claw Agents'
                            data-track-name='Remove selected tool'
                            onClick={onRemove}
                            aria-label={`Remove ${label}`}
                            className='flex-shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-red-500 focus-visible:opacity-100 focus-visible:outline-none transition-all'
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && !availableTools && (
          <p className='px-1 py-4 text-[13px] text-muted-foreground'>Failed to load tools.</p>
        )}
      </div>
    );
  }

  // ── COMPACT MODE ──
  return (
    <div ref={rootRef} className='space-y-5'>
      {(showCaption || suggestTrigger) && (
        <div className='flex items-center gap-3'>
          {showCaption && <SectionCaption friendly='Toolbox' technical='tools' />}
          {suggestTrigger && <div className='ml-auto'>{suggestTrigger}</div>}
        </div>
      )}
      {researchBlock}
      {suggestBlock}

      {loading ? (
        <div className='flex items-center gap-2 text-[13px] text-muted-foreground'>
          <Loader2 size={14} className='animate-spin' /> Loading…
        </div>
      ) : availableTools ? (
        <>
          {selectionItems.length > 0 && (
            <div
              className='sticky top-0 z-10 bg-card pb-3 border-b border-border/60'
              aria-live='polite'
              aria-atomic='true'
            >
              <div className='flex items-center justify-between gap-2 pt-1'>
                <span className='text-[12px] font-medium text-foreground/80'>
                  {selectionItems.length} tool{selectionItems.length !== 1 ? 's' : ''} selected
                </span>
                <button
                  type='button'
                  data-track-category='Claw Agents'
                  data-track-name='Clear all selected tools'
                  onClick={clearAll}
                  className='text-[11px] text-muted-foreground hover:text-red-500 transition-colors'
                >
                  Clear all
                </button>
              </div>
              <div className='flex flex-col gap-2 mt-1.5' role='list' aria-label='Selected tools'>
                {groupedSelection.map(grp => (
                  <div key={grp.cat}>
                    <div className='flex items-center gap-1.5 mb-1'>
                      <span
                        className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${grp.dot}`}
                        aria-hidden='true'
                      />
                      <span className='text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground'>
                        {grp.label}
                      </span>
                      <span className='text-[10px] tabular-nums text-muted-foreground'>
                        {grp.items.length}
                      </span>
                    </div>
                    <div className='flex flex-wrap gap-1'>
                      {grp.items.map(({ label, key, riskLevel, onRemove }) => (
                        <span
                          key={key}
                          role='listitem'
                          className='inline-flex items-center gap-1 rounded-full border border-[var(--claw-ai-border)] bg-[var(--claw-ai-surface)] px-2 py-0.5 text-[11px] text-[var(--claw-ai-fg)]'
                        >
                          <span
                            className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${riskDotCls(riskLevel)}`}
                            aria-hidden='true'
                          />
                          {label}
                          <button
                            type='button'
                            data-track-category='Claw Agents'
                            data-track-name='Remove selected tool'
                            onClick={onRemove}
                            aria-label={`Remove ${label}`}
                            className='ml-0.5 rounded-full hover:text-red-500 transition-colors focus-visible:outline-none'
                          >
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className='relative'>
            <input
              type='search'
              data-track-category='Claw Agents'
              data-track-name='Search tools'
              value={toolSearch}
              onChange={e => setToolSearch(e.target.value)}
              placeholder='Search tools…'
              aria-label='Search tools'
              className='w-full rounded-lg border border-border bg-card px-3 py-2 pr-8 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition-[border-color,box-shadow] [&::-webkit-search-cancel-button]:hidden'
            />
            {toolSearch && (
              <button
                type='button'
                data-track-category='Claw Agents'
                data-track-name='Clear tool search'
                onClick={() => setToolSearch('')}
                aria-label='Clear search'
                className='absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors'
              >
                <X size={14} />
              </button>
            )}
          </div>

          {(() => {
            type Tab = { key: string; label: string; dot?: string; count: number };
            // Mirror the large-mode structural grouping: instead of one chip per
            // server/custom source, expose the two parent buckets. Tapping them
            // sets the parent toolTab and the content area renders all children.
            const integrationsCount = mcpEntries.reduce((s, [, tools]) => s + tools.length, 0);
            const builtinCount = availableTools.customGroups.reduce(
              (s, g) => s + g.tools.length,
              0,
            );
            const tabs: Tab[] = [
              {
                key: 'all',
                label: 'All',
                count: availableTools.subagents.length + integrationsCount + builtinCount,
              },
              {
                key: 'subagents',
                label: 'Subagents',
                dot: 'bg-violet-500',
                count: availableTools.subagents.length,
              },
              {
                key: 'integrations',
                label: 'MCP Tools',
                dot: 'bg-emerald-500',
                count: integrationsCount,
              },
              { key: 'builtin', label: 'Built-in tools', dot: 'bg-slate-400', count: builtinCount },
            ].filter(t => t.count > 0);
            if (tabs.length <= 1) return null;
            return (
              <div className='flex flex-wrap items-center gap-1.5'>
                {tabs.map(({ key, label, dot, count }) => {
                  const active = toolTab === key;
                  return (
                    <button
                      key={key}
                      type='button'
                      data-track-category='Claw Agents'
                      data-track-name='Filter tools by category'
                      onClick={() => setToolTab(key)}
                      aria-pressed={active}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition ${active ? 'border-[var(--claw-ai-border)] bg-[var(--claw-ai-surface)] text-[var(--claw-ai-fg)]' : 'border-border bg-card text-foreground/80 hover:border-muted-foreground/40'}`}
                    >
                      {dot && (
                        <span
                          className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dot}`}
                          aria-hidden='true'
                        />
                      )}
                      {label}
                      <span
                        className={`tabular-nums ${active ? 'text-[var(--claw-ai-fg)]' : 'text-muted-foreground'}`}
                        aria-hidden='true'
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })()}

          <div
            className='rounded-lg border border-border/60 bg-muted px-3 py-2.5 flex flex-col justify-center'
            style={{ minHeight: '72px', maxHeight: '72px' }}
            aria-live='polite'
            aria-label='Tool detail'
          >
            {pinnedDetail ? (
              <div className='flex flex-col gap-1 min-w-0'>
                <div className='flex items-center gap-2 min-w-0'>
                  <span
                    className={`h-2 w-2 flex-shrink-0 rounded-full ${riskDotCls(pinnedDetail.riskLevel)}`}
                    aria-hidden='true'
                  />
                  <span className='text-[12px] font-semibold text-foreground truncate'>
                    {humanizeToolName(pinnedDetail.name)}
                  </span>
                  <span
                    className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.05em] ml-auto ${
                      pinnedDetail.riskLevel === 'read'
                        ? 'bg-emerald-100 text-emerald-700'
                        : pinnedDetail.riskLevel === 'write'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {pinnedDetail.riskLevel ?? 'write'}
                  </span>
                  <button
                    type='button'
                    data-track-category='Claw Agents'
                    data-track-name='Close tool detail'
                    onClick={() => setPinnedDetail(null)}
                    aria-label='Close detail'
                    className='flex-shrink-0 text-muted-foreground hover:text-foreground transition ml-1'
                  >
                    <X size={11} />
                  </button>
                </div>
                <p className='text-[11px] text-foreground/80 leading-relaxed line-clamp-1'>
                  {pinnedDetail.description || 'No description available.'}
                </p>
              </div>
            ) : (
              <p className='text-[12px] text-muted-foreground italic'>
                Click a tool to see its description and risk level.
              </p>
            )}
          </div>

          <div
            className='flex flex-wrap items-center gap-4 text-[10px] text-muted-foreground'
            aria-label='Tool risk level legend'
          >
            <span className='flex items-center gap-1'>
              <span className='h-1.5 w-1.5 rounded-full bg-emerald-500' aria-hidden='true' />
              Read — no side effects
            </span>
            <span className='flex items-center gap-1'>
              <span className='h-1.5 w-1.5 rounded-full bg-amber-500' aria-hidden='true' />
              Write — modifies data
            </span>
            <span className='flex items-center gap-1'>
              <span className='h-1.5 w-1.5 rounded-full bg-red-500' aria-hidden='true' />
              Destructive — irreversible
            </span>
          </div>

          {availableTools.subagents.length > 0 &&
            (!!searchQ || toolTab === 'all' || toolTab === 'subagents') &&
            sectionVisible(availableTools.subagents.map(sa => sa.name)) && (
              <div>
                <div className='flex items-center gap-1'>
                  <button
                    type='button'
                    data-track-category='Claw Agents'
                    data-track-name='Toggle subagents section'
                    onClick={() => toggleSection('subagents')}
                    aria-expanded={sectionOpen(
                      'subagents',
                      availableTools.subagents.map(sa => sa.name),
                    )}
                    aria-controls='toolbox-subagents'
                    className='flex flex-1 items-center gap-2 rounded px-1 py-1.5 text-left hover:bg-muted transition-colors'
                  >
                    <ChevronRight
                      size={14}
                      className={`flex-shrink-0 text-muted-foreground transition-transform duration-150 ${
                        sectionOpen(
                          'subagents',
                          availableTools.subagents.map(sa => sa.name),
                        )
                          ? 'rotate-90'
                          : ''
                      }`}
                      aria-hidden='true'
                    />
                    <span className='text-[13px] font-semibold text-foreground'>Subagents</span>
                    <span className='text-[11px] font-normal text-muted-foreground'>
                      · subagents
                    </span>
                    <span className='ml-auto text-[11px] tabular-nums text-muted-foreground'>
                      {value.subagents.length > 0 ? `${value.subagents.length}/` : ''}
                      {availableTools.subagents.length}
                    </span>
                  </button>
                  <button
                    type='button'
                    data-track-category='Claw Agents'
                    data-track-name='Select all subagents'
                    onClick={() =>
                      toggleAll(
                        'subagents',
                        availableTools.subagents.map(x => x.name),
                      )
                    }
                    className='flex-shrink-0 px-1.5 py-1 text-[11px] font-medium text-foreground/80 hover:text-foreground transition-colors'
                  >
                    {value.subagents.length === availableTools.subagents.length
                      ? 'Deselect all'
                      : 'Select all'}
                  </button>
                </div>
                {sectionOpen(
                  'subagents',
                  availableTools.subagents.map(sa => sa.name),
                ) && (
                  <div
                    id='toolbox-subagents'
                    className='flex flex-wrap gap-1.5 pt-2 pl-6'
                    role='group'
                    aria-label='Subagent subagents'
                  >
                    {availableTools.subagents
                      .filter(sa => toolMatchesSearch(sa.name))
                      .map(sa => {
                        const selected = value.subagents.includes(sa.name);
                        return (
                          <button
                            key={sa.name}
                            type='button'
                            data-track-category='Claw Agents'
                            data-track-name='Toggle subagent selection'
                            onClick={() => {
                              toggle('subagents', sa.name);
                              pinDetail(sa.name);
                            }}
                            onMouseEnter={() => hoverDetail(sa.name)}
                            onMouseLeave={() => hoverDetail(null)}
                            onFocus={() => hoverDetail(sa.name)}
                            onBlur={() => hoverDetail(null)}
                            title={sa.name}
                            aria-pressed={selected}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition ${selected ? 'border-[var(--claw-ai-border)] bg-[var(--claw-ai-surface)] text-[var(--claw-ai-fg)]' : 'border-border bg-card text-foreground/80 hover:border-muted-foreground/40'}`}
                          >
                            <span
                              className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${riskDotCls('read')}`}
                              aria-hidden='true'
                            />
                            {sa.name}
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>
            )}

          {(mcpEntries.length > 0 || availableTools.customGroups.length > 0) &&
            (!!searchQ ||
              toolTab === 'all' ||
              toolTab === 'integrations' ||
              toolTab === 'builtin' ||
              mcpEntries.some(([src]) => src === toolTab) ||
              availableTools.customGroups.some(g => g.source === toolTab)) && (
              <div className='space-y-1'>
                {(!!searchQ || toolTab === 'all' || toolTab === 'integrations') &&
                  mcpEntries.length > 0 && (
                    <p className='px-1 pb-0.5 text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground'>
                      MCP Tools
                    </p>
                  )}
                {mcpEntries
                  .filter(
                    ([source]) =>
                      !!searchQ ||
                      toolTab === 'all' ||
                      toolTab === 'integrations' ||
                      toolTab === source,
                  )
                  .map(([source, tools]) => {
                    const serverTools = tools;
                    const toolNames = serverTools.map(t => t.name);
                    if (!sectionVisible(toolNames)) return null;
                    const visibleTools = serverTools.filter(t => toolMatchesSearch(t.name));
                    const allKeysForToggle = serverTools.map(t =>
                      selectionKeyForMcpTool(source, t),
                    );
                    const allSel =
                      allKeysForToggle.length > 0 &&
                      serverTools.every(t => isMcpToolSelected(source, t));
                    const selectedCount = serverTools.filter(t =>
                      isMcpToolSelected(source, t),
                    ).length;
                    const hasDestructive = serverTools.some(
                      t =>
                        (toolInfoMap.get(t.slug) ?? toolInfoMap.get(t.name))?.riskLevel ===
                        'destructive',
                    );
                    const open = sectionOpen(source, toolNames);
                    const gatewaySource = parseGatewaySource(source);
                    return (
                      <div key={source}>
                        <div className='flex items-center gap-1'>
                          <button
                            type='button'
                            data-track-category='Claw Agents'
                            data-track-name='Toggle MCP server section'
                            onClick={() => toggleSection(source)}
                            aria-expanded={open}
                            aria-controls={`toolbox-${source}`}
                            className='flex flex-1 items-center gap-2 rounded px-1 py-1.5 text-left hover:bg-muted transition-colors'
                          >
                            <ChevronRight
                              size={14}
                              className={`flex-shrink-0 text-muted-foreground transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
                              aria-hidden='true'
                            />
                            <span className='text-[12px] font-semibold text-foreground'>
                              {formatServerLabel(source)}
                            </span>
                            {hasDestructive && (
                              <span
                                className='h-1.5 w-1.5 rounded-full bg-red-500 flex-shrink-0'
                                aria-label='Contains destructive tools'
                              />
                            )}
                            <span className='ml-auto text-[11px] tabular-nums text-muted-foreground'>
                              {selectedCount > 0 ? `${selectedCount}/` : ''}
                              {serverTools.length}
                            </span>
                          </button>
                          <button
                            type='button'
                            data-track-category='Claw Agents'
                            data-track-name='Select all MCP tools'
                            onClick={() =>
                              gatewaySource
                                ? setGatewayBulkSelection(source, serverTools, !allSel)
                                : toggleAll('direct', allKeysForToggle)
                            }
                            className='flex-shrink-0 px-1.5 py-1 text-[11px] font-medium text-foreground/80 hover:text-foreground transition-colors'
                          >
                            {allSel ? 'Deselect' : 'Select all'}
                          </button>
                        </div>
                        {open && (
                          <div
                            id={`toolbox-${source}`}
                            className='flex flex-wrap gap-1.5 pt-2 pl-6'
                            role='group'
                            aria-label={`${formatServerLabel(source)} tools`}
                          >
                            {visibleTools.map(t => {
                              const selected = isMcpToolSelected(source, t);
                              const risk = (toolInfoMap.get(t.slug) ?? toolInfoMap.get(t.name))
                                ?.riskLevel;
                              const selectionKey = selectionKeyForMcpTool(source, t);
                              return (
                                <button
                                  key={`${source}-${t.slug}`}
                                  type='button'
                                  data-track-category='Claw Agents'
                                  data-track-name='Toggle MCP tool selection'
                                  onClick={() => {
                                    setGatewayToolSelection(source, serverTools, t, !selected);
                                    pinDetail(selectionKey);
                                  }}
                                  onMouseEnter={() => hoverDetail(selectionKey)}
                                  onMouseLeave={() => hoverDetail(null)}
                                  onFocus={() => hoverDetail(selectionKey)}
                                  onBlur={() => hoverDetail(null)}
                                  title={t.name}
                                  aria-pressed={selected}
                                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] transition ${selected ? 'border-[var(--claw-ai-border)] bg-[var(--claw-ai-surface)] text-[var(--claw-ai-fg)]' : 'border-border bg-card text-foreground/80 hover:border-muted-foreground/40'}`}
                                >
                                  <span
                                    className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${riskDotCls(risk)}`}
                                    aria-hidden='true'
                                  />
                                  {humanizeToolName(t.name, gatewaySource?.serviceName ?? source)}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                {(!!searchQ || toolTab === 'all' || toolTab === 'builtin') &&
                  availableTools.customGroups.length > 0 && (
                    <p className='px-1 pt-1 pb-0.5 text-[11px] font-medium uppercase tracking-[0.07em] text-muted-foreground'>
                      Built-in tools
                    </p>
                  )}
                {availableTools.customGroups
                  .filter(
                    g =>
                      !!searchQ ||
                      toolTab === 'all' ||
                      toolTab === 'builtin' ||
                      toolTab === g.source,
                  )
                  .map(g => {
                    const slugs = g.tools.map(t => t.slug);
                    const toolNames = g.tools.map(t => t.name);
                    if (!sectionVisible(toolNames)) return null;
                    const visibleTools = g.tools.filter(t => toolMatchesSearch(t.name));
                    const allSel = slugs.every(x => value.custom.includes(x));
                    const selectedCount = slugs.filter(s => value.custom.includes(s)).length;
                    const label = g.source
                      .replace('custom:', '')
                      .replace(/-/g, ' ')
                      .replace(/\b\w/g, c => c.toUpperCase());
                    const hasDestructive = g.tools.some(
                      t => toolInfoMap.get(t.name)?.riskLevel === 'destructive',
                    );
                    const open = sectionOpen(g.source, toolNames);
                    return (
                      <div key={g.source}>
                        <div className='flex items-center gap-1'>
                          <button
                            type='button'
                            data-track-category='Claw Agents'
                            data-track-name='Toggle built-in tools section'
                            onClick={() => toggleSection(g.source)}
                            aria-expanded={open}
                            aria-controls={`toolbox-${g.source}`}
                            className='flex flex-1 items-center gap-2 rounded px-1 py-1.5 text-left hover:bg-muted transition-colors'
                          >
                            <ChevronRight
                              size={14}
                              className={`flex-shrink-0 text-muted-foreground transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
                              aria-hidden='true'
                            />
                            <span className='text-[12px] font-semibold text-foreground'>
                              {label}
                            </span>
                            {hasDestructive && (
                              <span
                                className='h-1.5 w-1.5 rounded-full bg-red-500 flex-shrink-0'
                                aria-label='Contains destructive tools'
                              />
                            )}
                            <span className='ml-auto text-[11px] tabular-nums text-muted-foreground'>
                              {selectedCount > 0 ? `${selectedCount}/` : ''}
                              {g.tools.length}
                            </span>
                          </button>
                          <button
                            type='button'
                            data-track-category='Claw Agents'
                            data-track-name='Select all built-in tools'
                            onClick={() => toggleCustomGroup(slugs, allSel)}
                            className='flex-shrink-0 px-1.5 py-1 text-[11px] font-medium text-foreground/80 hover:text-foreground transition-colors'
                          >
                            {allSel ? 'Deselect' : 'Select all'}
                          </button>
                        </div>
                        {open && (
                          <div
                            id={`toolbox-${g.source}`}
                            className='flex flex-wrap gap-1.5 pt-2 pl-6'
                            role='group'
                            aria-label={`${label} tools`}
                          >
                            {visibleTools.map(t => {
                              const selected = value.custom.includes(t.slug);
                              const risk = toolInfoMap.get(t.name)?.riskLevel;
                              return (
                                <button
                                  key={t.slug}
                                  type='button'
                                  data-track-category='Claw Agents'
                                  data-track-name='Toggle built-in tool selection'
                                  onClick={() => {
                                    toggle('custom', t.slug);
                                    pinDetail(t.name);
                                  }}
                                  onMouseEnter={() => hoverDetail(t.name)}
                                  onMouseLeave={() => hoverDetail(null)}
                                  onFocus={() => hoverDetail(t.name)}
                                  onBlur={() => hoverDetail(null)}
                                  title={t.name}
                                  aria-pressed={selected}
                                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] transition ${selected ? 'border-[var(--claw-ai-border)] bg-[var(--claw-ai-surface)] text-[var(--claw-ai-fg)]' : 'border-border bg-card text-foreground/80 hover:border-muted-foreground/40'}`}
                                >
                                  <span
                                    className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${riskDotCls(risk)}`}
                                    aria-hidden='true'
                                  />
                                  {humanizeToolName(t.name)}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}

          {searchQ &&
            !availableTools.subagents.some(sa => toolMatchesSearch(sa.name)) &&
            !availableTools.writeTools.some(t => toolMatchesSearch(t.name)) &&
            !mcpEntries.some(([, tools]) => tools.some(t => toolMatchesSearch(t.name))) &&
            !availableTools.customGroups.some(g =>
              g.tools.some(t => toolMatchesSearch(t.name)),
            ) && (
              <p className='py-6 text-center text-[13px] text-muted-foreground' role='status'>
                No tools match &ldquo;{toolSearch}&rdquo;
              </p>
            )}
        </>
      ) : (
        <p className='text-[13px] text-muted-foreground'>Failed to load tools.</p>
      )}
    </div>
  );
}

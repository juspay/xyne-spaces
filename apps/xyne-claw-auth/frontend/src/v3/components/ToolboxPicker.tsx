/**
 * ToolboxPicker — the shared "pick what this agent can do" power UI.
 *
 * Extracted from CreateAgentModal's Toolbox step so the agent **config page**
 * and the **creation wizard** present the exact same UX (and stay in sync).
 * It renders the three canonical tool buckets — Subagents · subagents,
 * MCP Tools (per-integration, read + write), Built-in tools — as a 3-column
 * rail / chip-groups / selected-tray layout (large), with a single-column
 * collapsible fallback (compact) for narrow frames, plus the violet AI
 * "Suggest tools" + refine strip and an optional Research-Agent context block.
 *
 * Fully controlled on the selection only (`value` / `onChange`); every other
 * piece of UI state (active category, search, detail pin, suggestion) is owned
 * internally so a host just wires availableTools + selection.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Sparkles, ChevronRight, Loader2, Check, X, Info, AlertTriangle } from "lucide-react";
import type { AgentLight } from "../../lib/types";
import {
  suggestTools,
  type AvailableTools,
  type IntegrationToolEntry,
  type ToolSuggestion,
  type ResearchAgentOption,
  type AgentDelegationGrant,
  type DelegationIdentityMode,
} from "../../lib/api";
import { parseGatewaySelectionKey, parseGatewaySource } from "../lib/gatewayKeys";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { Dialog } from "./ui/Dialog";
import { Button } from "./ui/Button";

export interface ToolboxSelection {
  subagents: string[];
  direct: string[];
  custom: string[];
  gateway?: string[];
  callableAgents?: string[];
}

const SUBAGENT_EMOJI: Record<string, string> = {
  spaces: "🔍", bitbucket: "🔀", grafana: "📊", deepwiki: "📚",
  context7: "📖", git: "🔧",
};

/** Tailwind class for the risk status dot. Unknown → write (amber). */
function riskDotCls(riskLevel: "read" | "write" | "destructive" | undefined): string {
  if (riskLevel === "read") return "bg-emerald-500";
  if (riskLevel === "destructive") return "bg-red-500";
  return "bg-amber-500";
}

/** snake_case → Sentence case, stripping an optional server prefix. */
function humanizeToolName(name: string, prefix?: string): string {
  let n = name;
  if (prefix) {
    const p = prefix.toLowerCase().replace(/-/g, "_") + "_";
    if (n.toLowerCase().startsWith(p)) n = n.slice(p.length);
  }
  return n.replace(/_/g, " ").replace(/^[a-z]/, (c) => c.toUpperCase());
}

function SectionCaption({ friendly, technical }: { friendly: React.ReactNode; technical?: string }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.07em] text-xyne-fg-tertiary mb-2 inline-flex items-baseline gap-1.5">
      {friendly}
      {technical && (
        <>
          <span className="text-xyne-fg-tertiary normal-case">·</span>
          <span className="normal-case font-normal">{technical}</span>
        </>
      )}
    </div>
  );
}

const SUGGESTION_PHASES = [
  "Reading the tool catalog…",
  "Matching tools to your persona…",
  "Picking subagents that fit…",
  "Finalizing the starter toolkit…",
];

function SuggestionLoading() {
  const [phase, setPhase] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const phaseTimer = setInterval(() => setPhase((p) => (p + 1) % SUGGESTION_PHASES.length), 3000);
    const elapsedTimer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => { clearInterval(phaseTimer); clearInterval(elapsedTimer); };
  }, []);
  return (
    <div className="flex items-center justify-between gap-2 text-[12px] text-[#7c3aed] dark:text-[#a78bfa]">
      <span className="flex items-center gap-2 min-w-0">
        <Loader2 size={12} className="animate-spin flex-shrink-0" />
        <span className="truncate">{SUGGESTION_PHASES[phase]}</span>
      </span>
      <span className="text-[11px] tabular-nums text-[#7c3aed]/70 dark:text-[#a78bfa]/70 flex-shrink-0">
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

interface DelegatedAgentsConfig {
  currentAgentSlug: string;
  isOrchestratorTier?: boolean;
  agents: AgentLight[];
  grants: AgentDelegationGrant[];
  loading?: boolean;
  disabled?: boolean;
  currentUserId: string;
  onAddGrant: (calleeSlug: string, identityMode: DelegationIdentityMode, requestReason?: string) => Promise<void>;
  onDeleteGrant: (grant: AgentDelegationGrant) => Promise<void>;
  onAddConfigEntry: (calleeSlug: string) => Promise<void>;
  onCreateGrantForConfig: (calleeSlug: string) => Promise<void>;
  onRemoveConfigEntry: (calleeSlug: string) => Promise<void>;
}

interface Props {
  availableTools: AvailableTools | null;
  loading?: boolean;
  value: ToolboxSelection;
  onChange: (next: ToolboxSelection) => void;
  /** "large" = 3-column; "compact" = single-column. Omit to auto-pick by width. */
  variant?: "large" | "compact";
  /** Pixel height for the large (3-column) layout. Omit to fill a flex parent (flex-1). */
  largeHeight?: string;
  /** When set, the violet AI suggest + refine strip renders using this context. */
  suggestContext?: { systemPrompt?: string; description?: string };
  /** Auto-fetch a suggestion on first mount (wizard behavior). Default false. */
  autoSuggest?: boolean;
  /** Optional Research-Agent context block (product/repository pins). */
  researchAgent?: ResearchAgentConfig;
  /** Optional A2A delegated agents control surface. Uses host-owned grant/config handlers. */
  delegatedAgents?: DelegatedAgentsConfig;
  /** Show the "Toolbox · tools" caption at the top. Default true. */
  showCaption?: boolean;
}

function AgentHeavyweightBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full border border-amber-200 bg-amber-50 font-medium text-amber-700 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-300 ${
        compact ? "px-1 py-0.5 text-[9px]" : "px-1.5 py-0.5 text-[9px]"
      }`}
    >
      Agent · heavyweight
    </span>
  );
}

export function ToolboxPicker({
  availableTools,
  loading = false,
  value,
  onChange,
  variant,
  largeHeight,
  suggestContext,
  autoSuggest = false,
  researchAgent,
  delegatedAgents,
  showCaption = true,
}: Props) {
  const [toolTab, setToolTab] = useState("all");
  const [toolSearch, setToolSearch] = useState("");
  const [pinnedDetail, setPinnedDetail] = useState<IntegrationToolEntry | null>(null);
  const [hoveredDetail, setHoveredDetail] = useState<IntegrationToolEntry | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  // Which parent rail groups (Integrations / Built-in) are expanded in the
  // accordion sidebar. Leaf groups (Subagents, Direct actions) aren't tracked.
  const [expandedRailGroups, setExpandedRailGroups] = useState<Set<string>>(new Set());

  const [suggestion, setSuggestion] = useState<ToolSuggestion | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionApplied, setSuggestionApplied] = useState(false);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [refineIntent, setRefineIntent] = useState("");
  const didAutoSuggest = useRef(false);
  const [delegationBusy, setDelegationBusy] = useState<string | null>(null);
  const [pendingDeleteGrant, setPendingDeleteGrant] = useState<AgentDelegationGrant | null>(null);
  const [pendingBulkAgentDelete, setPendingBulkAgentDelete] = useState(false);
  const [pendingDelegationReason, setPendingDelegationReason] = useState<{ slugs: string[]; title: string; description: string } | null>(null);
  const [delegationReason, setDelegationReason] = useState("");

  // Responsive layout pick (only when `variant` is not forced).
  const rootRef = useRef<HTMLDivElement>(null);
  const [autoLarge, setAutoLarge] = useState(true);
  useEffect(() => {
    if (variant) return;
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setAutoLarge(e.contentRect.width >= 720);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [variant]);
  const large = variant ? variant === "large" : autoLarge;

  /* ── selection mutators (controlled) ─────────────────────────────── */
  type RequiredSelectionKey = "subagents" | "direct" | "custom";
  const toggle = (key: RequiredSelectionKey, val: string) => {
    const arr = value[key];
    onChange({ ...value, [key]: arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val] });
  };
  const toggleAll = (key: RequiredSelectionKey, all: string[]) =>
    onChange({ ...value, [key]: value[key].length === all.length ? [] : all });
  const toggleCustomGroup = (slugs: string[], allSelected: boolean) =>
    onChange({ ...value, custom: allSelected ? value.custom.filter((x) => !slugs.includes(x)) : [...new Set([...value.custom, ...slugs])] });
  const clearAll = () =>
    onChange({
      subagents: [],
      direct: [],
      custom: [],
      gateway: [],
      callableAgents: delegatedAgents ? (value.callableAgents ?? []) : [],
    });
  const toggleSection = (key: string) =>
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  const toggleRailGroup = (key: string) =>
    setExpandedRailGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  /* ── AI suggestion flow ──────────────────────────────────────────── */
  const fetchSuggestion = useCallback(async (payload: { systemPrompt?: string; description?: string }) => {
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
  }, []);

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
    if (value.subagents.length || value.direct.length || value.custom.length || (value.gateway?.length ?? 0) > 0 || (value.callableAgents?.length ?? 0) > 0) return;
    const intent = (suggestContext.systemPrompt || "").trim() || (suggestContext.description || "").trim();
    if (!intent) return;
    didAutoSuggest.current = true;
    void fetchSuggestion(suggestPayload());
  }, [autoSuggest, suggestContext, availableTools, value, fetchSuggestion, suggestPayload]);

  const reRollSuggestion = () => { if (suggestContext) void fetchSuggestion(suggestPayload()); };
  const handleRefine = async () => {
    const intent = refineIntent.trim();
    if (!intent) return;
    await fetchSuggestion({ description: intent });
    setRefineIntent("");
  };

  // Additive merge of a suggestion into the current selection.
  const applySuggestion = () => {
    if (!suggestion || !availableTools) return;
    const subagentSet = new Set(value.subagents);
    for (const name of suggestion.subagents ?? []) subagentSet.add(name);
    const suggestedNames = new Set<string>();
    for (const sugg of suggestion.integrations ?? []) {
      for (const n of sugg.readTools ?? []) suggestedNames.add(n);
      for (const n of sugg.writeTools ?? []) suggestedNames.add(n);
    }
    const directSet = new Set(value.direct);
    const customSet = new Set(value.custom);
    for (const t of availableTools.writeTools) if (suggestedNames.has(t.name)) directSet.add(t.name);
    for (const [source, tools] of Object.entries(availableTools.serverTools))
      for (const t of tools) if (suggestedNames.has(t.name)) directSet.add(parseGatewaySource(source) ? t.slug : t.name);
    for (const g of availableTools.customGroups)
      for (const t of g.tools) if (suggestedNames.has(t.name)) customSet.add(t.slug);
    onChange({ subagents: Array.from(subagentSet), direct: Array.from(directSet), custom: Array.from(customSet), gateway: value.gateway ?? [], callableAgents: value.callableAgents ?? [] });
    setSuggestionApplied(true);
  };

  // Auto-expand sections that received suggested tools (so "Accept all" is visible).
  useEffect(() => {
    if (!suggestionApplied || !suggestion || !availableTools) return;
    const toExpand = new Set<string>();
    if ((suggestion.subagents ?? []).length > 0) toExpand.add("subagents");
    const suggestedNames = new Set<string>();
    for (const s of suggestion.integrations ?? [])
      for (const n of [...(s.readTools ?? []), ...(s.writeTools ?? [])]) suggestedNames.add(n);
    if (availableTools.writeTools.some((t) => suggestedNames.has(t.name))) toExpand.add("direct");
    for (const [src, tools] of Object.entries(availableTools.serverTools))
      if (tools.some((t) => suggestedNames.has(t.name))) toExpand.add(src);
    for (const g of availableTools.customGroups)
      if (g.tools.some((t) => suggestedNames.has(t.name))) toExpand.add(g.source);
    setExpandedSections((prev) => new Set([...prev, ...toExpand]));
  }, [suggestionApplied]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── derived ─────────────────────────────────────────────────────── */
  // Each MCP integration owns ALL its tools (read + write together). Write
  // tools are no longer split into a separate "Direct actions" bucket — they
  // live inline under their integration, distinguished by their risk dot.
  const mcpEntries = availableTools
    ? Object.entries(availableTools.serverTools).filter(([source, tools]) =>
        !source.startsWith("custom:") && Array.isArray(tools) && tools.length > 0)
    : [];

  type ToolInfo = IntegrationToolEntry & { source?: string; selectionKey?: string };
  const toolInfoMap = new Map<string, ToolInfo>();
  if (availableTools) {
    for (const sa of availableTools.subagents)
      toolInfoMap.set(sa.name, { slug: sa.name, name: sa.name, description: sa.description, riskLevel: "read" });
    for (const intg of availableTools.integrations) {
      for (const t of [...intg.readTools, ...intg.writeTools]) {
        const info: ToolInfo = { ...t, source: intg.slug, selectionKey: t.slug };
        toolInfoMap.set(t.slug, info);
        if (!toolInfoMap.has(t.name)) toolInfoMap.set(t.name, info);
      }
    }
  }

  const pinDetail = (key: string) =>
    setPinnedDetail((prev) => {
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
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      return `${serviceLabel} (${gatewaySource.backendId})`;
    }
    return serverType.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };
  const customLabel = (source: string): string =>
    source.replace("custom:", "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const selectionKeyForMcpTool = (source: string, tool: { slug: string; name: string }) =>
    parseGatewaySource(source) ? tool.slug : tool.name;

  const gatewayKeysForService = (serviceName: string): string[] =>
    mcpEntries.flatMap(([source, tools]) => {
      const parsed = parseGatewaySource(source);
      return parsed?.serviceName === serviceName ? tools.map((t) => t.slug) : [];
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
      toggle("direct", tool.name);
      return;
    }
    const serviceKeys = gatewayKeysForService(gatewaySource.serviceName);
    const serviceKeySet = new Set(serviceKeys);
    const nextSelected = new Set<string>(
      (value.gateway ?? []).includes(gatewaySource.serviceName)
        ? serviceKeys
        : value.direct.filter((key) => serviceKeySet.has(key)),
    );
    if (next) nextSelected.add(tool.slug);
    else nextSelected.delete(tool.slug);

    const otherDirect = value.direct.filter((key) => !serviceKeySet.has(key));
    onChange({
      ...value,
      gateway: (value.gateway ?? []).filter((service) => service !== gatewaySource.serviceName),
      direct: [...otherDirect, ...serviceKeys.filter((key) => nextSelected.has(key))],
    });
  };

  const setGatewayBulkSelection = (
    source: string,
    tools: Array<{ slug: string; name: string }>,
    next: boolean,
  ) => {
    const gatewaySource = parseGatewaySource(source);
    if (!gatewaySource) {
      toggleAll("direct", tools.map((t) => t.name));
      return;
    }
    const groupKeys = tools.map((t) => t.slug);
    const groupKeySet = new Set(groupKeys);
    const serviceKeys = gatewayKeysForService(gatewaySource.serviceName);
    const serviceKeySet = new Set(serviceKeys);
    const otherDirect = (value.gateway ?? []).includes(gatewaySource.serviceName)
      ? [
          ...value.direct.filter((key) => !serviceKeySet.has(key)),
          ...serviceKeys.filter((key) => !groupKeySet.has(key)),
        ]
      : value.direct.filter((key) => !groupKeySet.has(key));
    onChange({
      ...value,
      gateway: (value.gateway ?? []).filter((service) => service !== gatewaySource.serviceName),
      direct: next ? [...otherDirect, ...groupKeys] : otherDirect,
    });
  };

  const removeDirectSelection = (key: string) => {
    const gatewayKey = parseGatewaySelectionKey(key);
    if (!gatewayKey) {
      toggle("direct", key);
      return;
    }
    const serviceKeys = gatewayKeysForService(gatewayKey.serviceName);
    const serviceKeySet = new Set(serviceKeys);
    const nextSelected = new Set<string>(
      (value.gateway ?? []).includes(gatewayKey.serviceName)
        ? serviceKeys
        : value.direct.filter((item) => serviceKeySet.has(item)),
    );
    nextSelected.delete(key);
    const otherDirect = value.direct.filter((item) => !serviceKeySet.has(item));
    onChange({
      ...value,
      gateway: (value.gateway ?? []).filter((service) => service !== gatewayKey.serviceName),
      direct: [...otherDirect, ...serviceKeys.filter((item) => nextSelected.has(item))],
    });
  };

  const selectedDirectKeys = (() => {
    const keys = new Set(value.direct);
    for (const gatewayService of value.gateway ?? []) {
      for (const key of gatewayKeysForService(gatewayService)) keys.add(key);
    }
    return Array.from(keys);
  })();

  const agentOptions = useMemo(
    () =>
      delegatedAgents
        ? delegatedAgents.agents
            .filter((a) => a.slug !== delegatedAgents.currentAgentSlug)
            .sort((a, b) => a.name.localeCompare(b.name))
        : [],
    [delegatedAgents],
  );
  const agentBySlug = useMemo(() => new Map(agentOptions.map((a) => [a.slug, a])), [agentOptions]);
  const configAgentSlugs = useMemo(() => new Set(value.callableAgents ?? []), [value.callableAgents]);
  const grantBySlug = useMemo(() => {
    const map = new Map<string, AgentDelegationGrant>();
    for (const grant of delegatedAgents?.grants ?? []) {
      if (grant.status === "rejected") continue;
      const slug = grant.callee?.slug;
      if (slug) map.set(slug, grant);
    }
    return map;
  }, [delegatedAgents?.grants]);
  const selectedAgentSlugs = useMemo(
    () => Array.from(new Set([...configAgentSlugs, ...grantBySlug.keys()])),
    [configAgentSlugs, grantBySlug],
  );
  const selectedAgentCount = selectedAgentSlugs.length;
  const isOrchestratorTier = delegatedAgents?.isOrchestratorTier === true;
  const grantsMissingConfig = (delegatedAgents?.grants ?? []).filter((grant) => {
    const slug = grant.callee?.slug;
    return slug && !configAgentSlugs.has(slug);
  });
  const configMissingGrants = selectedAgentSlugs.filter((slug) => configAgentSlugs.has(slug) && !grantBySlug.has(slug));
  const runDelegationAction = async (key: string, fn: () => Promise<void>) => {
    if (!delegatedAgents || delegatedAgents.disabled || delegationBusy) return;
    setDelegationBusy(key);
    try {
      await fn();
    } finally {
      setDelegationBusy(null);
    }
  };
  const agentNeedsReason = (agentOption: AgentLight) =>
    !!delegatedAgents && agentOption.ownerUserId !== delegatedAgents.currentUserId;

  const requestDelegationReason = (agentsToAdd: AgentLight[]) => {
    const firstAgent = agentsToAdd[0];
    if (!firstAgent) return;
    setDelegationReason("");
    setPendingDelegationReason({
      slugs: agentsToAdd.map((a) => a.slug),
      title: agentsToAdd.length === 1
        ? `Why does this agent need ${firstAgent.name}?`
        : `Why does this agent need ${agentsToAdd.length} delegated agents?`,
      description: "This is sent to the target agent owner with the approval request and kept on the delegation record.",
    });
  };

  const addDelegatedAgents = (agentsToAdd: AgentLight[], requestReason?: string) => {
    const firstAgent = agentsToAdd[0];
    if (!delegatedAgents || !firstAgent) return;
    void runDelegationAction(
      agentsToAdd.length === 1 ? `add-agent:${firstAgent.slug}` : "agents-select-all",
      async () => {
        for (const agentOption of agentsToAdd) {
          await delegatedAgents.onAddGrant(agentOption.slug, "user", requestReason);
        }
      },
    );
  };

  const handleAgentChipToggle = (agentSlug: string) => {
    if (!delegatedAgents || delegatedAgents.disabled || delegationBusy) return;
    const grant = grantBySlug.get(agentSlug);
    const selected = configAgentSlugs.has(agentSlug) || !!grant;
    if (!selected) {
      const agentOption = agentBySlug.get(agentSlug);
      if (!agentOption) return;
      if (agentNeedsReason(agentOption)) requestDelegationReason([agentOption]);
      else addDelegatedAgents([agentOption]);
      return;
    }
    if (grant) {
      setPendingDeleteGrant(grant);
      return;
    }
    void runDelegationAction(`remove-config:${agentSlug}`, () => delegatedAgents.onRemoveConfigEntry(agentSlug));
  };
  const handleAgentBulkToggle = (allSelected: boolean) => {
    if (!delegatedAgents || delegatedAgents.disabled || delegationBusy) return;
    if (allSelected) {
      setPendingBulkAgentDelete(true);
      return;
    }
    const missing = agentOptions.filter((a) => !configAgentSlugs.has(a.slug) && !grantBySlug.has(a.slug));
    if (missing.some(agentNeedsReason)) requestDelegationReason(missing);
    else addDelegatedAgents(missing);
  };

  const searchQ = toolSearch.trim().toLowerCase();
  // Category-aware search: when the query matches a category/group *label*
  // (e.g. "integrations", "built-in", "analytics", "github") we surface every
  // tool under that group, not just tools whose own name matches.
  const labelMatchesSearch = (label: string) => !!searchQ && label.toLowerCase().includes(searchQ);
  const categoryMatchedNames = (() => {
    const set = new Set<string>();
    if (!searchQ || !availableTools) return set;
    if (labelMatchesSearch("Subagents")) for (const sa of availableTools.subagents) set.add(sa.name);
    if (labelMatchesSearch("Agents")) for (const a of agentOptions) set.add(a.slug);
    const allMcp = labelMatchesSearch("MCP Tools") || labelMatchesSearch("mcp");
    for (const [source, tools] of mcpEntries)
      if (allMcp || labelMatchesSearch(formatServerLabel(source))) for (const t of tools) set.add(t.name);
    const allBuiltin = labelMatchesSearch("Built-in tools") || labelMatchesSearch("builtin");
    for (const g of availableTools.customGroups)
      if (allBuiltin || labelMatchesSearch(customLabel(g.source))) for (const t of g.tools) set.add(t.name);
    return set;
  })();
  const toolMatchesSearch = (name: string) =>
    !searchQ || name.toLowerCase().includes(searchQ) || humanizeToolName(name).toLowerCase().includes(searchQ) || categoryMatchedNames.has(name);
  const agentMatchesSearch = (agentOption: AgentLight) =>
    !searchQ ||
    agentOption.name.toLowerCase().includes(searchQ) ||
    agentOption.slug.toLowerCase().includes(searchQ) ||
    (agentOption.description ?? "").toLowerCase().includes(searchQ) ||
    categoryMatchedNames.has(agentOption.slug);
  const sectionOpen = (key: string, toolNames: string[]) =>
    searchQ ? toolNames.some((n) => toolMatchesSearch(n)) : expandedSections.has(key);
  const sectionVisible = (toolNames: string[]) => !searchQ || toolNames.some((n) => toolMatchesSearch(n));

  type SelectionCat = "subagents" | "callableAgents" | "integrations" | "builtin";
  const selectionItems: Array<{
    label: string;
    key: string;
    cat: SelectionCat;
    riskLevel: "read" | "write" | "destructive" | undefined;
    badge?: string;
    status?: "pending" | "approved" | "rejected";
    slug?: string;
    onRemove: () => void;
  }> = [
    ...value.subagents.map((name) => ({ label: name, key: `sa-${name}`, cat: "subagents" as const, riskLevel: "read" as const, onRemove: () => toggle("subagents", name) })),
    ...selectedAgentSlugs.map((slug) => {
      const grant = grantBySlug.get(slug);
      const label = agentBySlug.get(slug)?.name ?? grant?.callee?.name ?? slug;
      return {
      label,
      key: `ca-${slug}`,
      cat: "callableAgents" as const,
      riskLevel: "write" as const,
      badge: "Agent · heavyweight",
      status: grant?.status,
      slug,
      onRemove: () => {
        if (!delegatedAgents) {
          onChange({ ...value, callableAgents: (value.callableAgents ?? []).filter((x) => x !== slug) });
          return;
        }
        const existingGrant = grantBySlug.get(slug);
        if (existingGrant) setPendingDeleteGrant(existingGrant);
        else void runDelegationAction(`remove-config:${slug}`, () => delegatedAgents.onRemoveConfigEntry(slug));
      },
    };
    }),
    // value.direct holds every selected MCP-integration tool (read + write).
    ...selectedDirectKeys.map((key) => {
      const info = toolInfoMap.get(key);
      return {
        label: humanizeToolName(info?.name ?? key), key: `d-${key}`, cat: "integrations" as const,
        riskLevel: info?.riskLevel ?? ("write" as const), onRemove: () => removeDirectSelection(key),
      };
    }),
    ...(availableTools?.customGroups.flatMap((g) =>
      g.tools.filter((t) => value.custom.includes(t.slug)).map((t) => ({
        label: humanizeToolName(t.name), key: `c-${t.slug}`, cat: "builtin" as const, riskLevel: (toolInfoMap.get(t.slug) ?? toolInfoMap.get(t.name))?.riskLevel ?? ("write" as const), onRemove: () => toggle("custom", t.slug),
      }))
    ) ?? []),
  ];
  const SELECTION_CAT_META: Record<SelectionCat, { label: string; dot: string }> = {
    subagents: { label: "Subagents", dot: "bg-violet-500" },
    callableAgents: { label: "Agents", dot: "bg-amber-500" },
    integrations: { label: "MCP Tools", dot: "bg-emerald-500" },
    builtin: { label: "Built-in tools", dot: "bg-slate-400" },
  };
  const groupedSelection = (["subagents", "callableAgents", "integrations", "builtin"] as SelectionCat[])
    .map((cat) => ({ cat, ...SELECTION_CAT_META[cat], items: selectionItems.filter((s) => s.cat === cat) }))
    .filter((g) => g.items.length > 0);

  // Sidebar accordion model. Leaf groups (Subagents, Direct actions) are a
  // single clickable row; parent groups (MCP Tools, Built-in tools)
  // roll up per-child counts and expand to indented children.
  type RailChild = { key: string; label: string; dot: string; selCount: number; totalCount: number; hasDestructive: boolean };
  type RailGroup = { key: string; label: string; dot?: string; selCount: number; totalCount: number; hasDestructive: boolean; children?: RailChild[] };
  const railGroups: RailGroup[] = availableTools ? (() => {
    const serverChildren: RailChild[] = mcpEntries.map(([source, tools]) => ({
      key: source, label: formatServerLabel(source), dot: "bg-emerald-500",
      selCount: tools.filter((t) => isMcpToolSelected(source, t)).length,
      totalCount: tools.length,
      hasDestructive: tools.some((t) => (toolInfoMap.get(t.slug) ?? toolInfoMap.get(t.name))?.riskLevel === "destructive"),
    })).filter((item) => item.totalCount > 0);
    const customChildren: RailChild[] = availableTools.customGroups.map((g) => ({
      key: g.source, label: customLabel(g.source), dot: "bg-slate-400",
      selCount: g.tools.filter((t) => value.custom.includes(t.slug)).length,
      totalCount: g.tools.length,
      hasDestructive: g.tools.some((t) => toolInfoMap.get(t.name)?.riskLevel === "destructive"),
    }));
    const rollup = (children: RailChild[]) => ({
      selCount: children.reduce((s, c) => s + c.selCount, 0),
      totalCount: children.reduce((s, c) => s + c.totalCount, 0),
      hasDestructive: children.some((c) => c.hasDestructive),
    });
    const groups: RailGroup[] = [];
    if (availableTools.subagents.length > 0)
      groups.push({ key: "subagents", label: "Subagents", dot: "bg-violet-500", selCount: value.subagents.length, totalCount: availableTools.subagents.length, hasDestructive: false });
    if (delegatedAgents && agentOptions.length > 0)
      groups.push({ key: "agents", label: "Agents", dot: "bg-amber-500", selCount: selectedAgentCount, totalCount: agentOptions.length, hasDestructive: false });
    if (serverChildren.length > 0)
      groups.push({ key: "integrations", label: "MCP Tools", dot: "bg-emerald-500", children: serverChildren, ...rollup(serverChildren) });
    if (customChildren.length > 0)
      groups.push({ key: "builtin", label: "Built-in tools", dot: "bg-slate-400", children: customChildren, ...rollup(customChildren) });
    return groups;
  })() : [];
  // Auto-expand the parent whose child is the active tab. Search does NOT
  // touch the rail — it's navigation; matches are shown grouped in the content
  // pane, so the sidebar tree stays stable while you type.
  useEffect(() => {
    if (!availableTools) return;
    setExpandedRailGroups((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const g of railGroups)
        if (g.children?.some((c) => c.key === toolTab) && !next.has(g.key)) { next.add(g.key); changed = true; }
      return changed ? next : prev;
    });
  }, [toolTab, availableTools]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── shared bits: chip + suggest strip ───────────────────────────── */
  const makeChip = (
    id: string, displayName: string, rawName: string, selected: boolean,
    riskLevel: "read" | "write" | "destructive" | undefined, onClickFn: () => void,
    detailKey = rawName,
  ) => (
    <button
      key={id}
      type="button"
      onClick={() => { onClickFn(); pinDetail(detailKey); }}
      onMouseEnter={() => hoverDetail(detailKey)}
      onMouseLeave={() => hoverDetail(null)}
      onFocus={() => hoverDetail(detailKey)}
      onBlur={() => hoverDetail(null)}
      title={rawName}
      aria-pressed={selected}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition ${
        selected
          ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-900/20 dark:text-indigo-300"
          : "border-xyne-border bg-xyne-surface text-xyne-fg-secondary hover:border-xyne-border-strong"
      }`}
    >
      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${riskDotCls(riskLevel)}`} aria-hidden="true" />
      {displayName}
    </button>
  );

  const makeAgentChip = (agentOption: AgentLight) => {
    const grant = grantBySlug.get(agentOption.slug);
    const selected = configAgentSlugs.has(agentOption.slug) || !!grant;
    const pendingApproval = grant?.status === "pending";
    const disabled = delegatedAgents?.disabled || delegationBusy !== null;
    const pendingTitle = `waiting for ${agentOption.name}'s owner to approve`;
    return (
      <button
        key={agentOption.slug}
        type="button"
        onClick={() => handleAgentChipToggle(agentOption.slug)}
        title={pendingApproval ? pendingTitle : agentOption.slug}
        aria-pressed={selected}
        disabled={disabled}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition disabled:cursor-not-allowed disabled:opacity-60 ${
          pendingApproval
            ? "border-dashed border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-500/70 dark:bg-amber-900/20 dark:text-amber-300"
            : selected
            ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-900/20 dark:text-indigo-300"
            : "border-xyne-border bg-xyne-surface text-xyne-fg-secondary hover:border-xyne-border-strong"
        }`}
      >
        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
        <span className="truncate">{agentOption.name}</span>
        {pendingApproval && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.04em] text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
            pending
          </span>
        )}
      </button>
    );
  };

  const delegationWarnings = delegatedAgents && (grantsMissingConfig.length > 0 || configMissingGrants.length > 0) ? (
    <div className="mb-3 flex flex-col gap-2">
      {grantsMissingConfig.map((grant) => {
        const slug = grant.callee!.slug;
        return (
          <DelegationMismatchWarning
            key={`grant-missing-config-${grant.id}`}
            text={`Delegation to ${slug} won't work: missing config entry.`}
            actionLabel="Add config"
            busy={delegationBusy === `config:${slug}`}
            disabled={delegatedAgents.disabled || delegationBusy !== null}
            onClick={() => void runDelegationAction(`config:${slug}`, () => delegatedAgents.onAddConfigEntry(slug))}
          />
        );
      })}
      {configMissingGrants.map((slug) => (
        <DelegationMismatchWarning
          key={`config-missing-grant-${slug}`}
          text={`Delegation to ${agentBySlug.get(slug)?.name ?? slug} won't work: missing grant.`}
          actionLabel="Create grant"
          busy={delegationBusy === `grant:${slug}`}
          disabled={delegatedAgents.disabled || delegationBusy !== null}
          onClick={() => void runDelegationAction(`grant:${slug}`, () => delegatedAgents.onCreateGrantForConfig(slug))}
        />
      ))}
    </div>
  ) : null;
  const orchestratorAgentsNote = isOrchestratorTier ? (
    <p className="mb-3 rounded-lg border border-xyne-border-subtle bg-xyne-surface px-3 py-2 text-[12px] leading-relaxed text-xyne-fg-secondary">
      This agent can call all global agents (orchestrator tier).
    </p>
  ) : null;

  const suggestBlock = suggestContext ? (
    <>
      {!suggestionDismissed && !suggestionApplied && (suggestionLoading || suggestion || suggestionError) && (
        <div className="rounded-lg border border-[#c4b5fd] dark:border-[#6d28d9]/40 bg-[#faf5ff] dark:bg-[#2e1065]/20 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.07em] text-[#7c3aed] dark:text-[#a78bfa]">
              <Sparkles size={12} /> Suggested for you
            </div>
            <button type="button" onClick={() => setSuggestionDismissed(true)} className="text-[11px] text-[#7c3aed]/70 dark:text-[#a78bfa]/70 hover:text-[#7c3aed] dark:hover:text-[#a78bfa] transition-colors" aria-label="Dismiss suggestion">
              Dismiss
            </button>
          </div>
          {suggestionLoading ? (
            <SuggestionLoading />
          ) : suggestionError ? (
            <div className="flex items-center justify-between gap-2 text-[12px] text-[#7c3aed] dark:text-[#a78bfa]">
              <span>{suggestionError}</span>
              <button type="button" onClick={reRollSuggestion} className="text-[11px] font-medium underline hover:no-underline">Try again</button>
            </div>
          ) : suggestion ? (() => {
            const newSubagents = (suggestion.subagents ?? []).filter((n) => !value.subagents.includes(n));
            const newDirect: string[] = [];
            const newIntegrationTools: string[] = [];
            const newCustom: string[] = [];
            if (availableTools) {
              const suggestedNames = new Set<string>();
              for (const sugg of suggestion.integrations ?? []) {
                for (const n of sugg.readTools ?? []) suggestedNames.add(n);
                for (const n of sugg.writeTools ?? []) suggestedNames.add(n);
              }
              const writeToolNameSet = new Set(availableTools.writeTools.map((t) => t.name));
              for (const t of availableTools.writeTools) if (suggestedNames.has(t.name) && !value.direct.includes(t.name)) newDirect.push(t.name);
              for (const [source, tools] of Object.entries(availableTools.serverTools))
                for (const t of tools) {
                  if (writeToolNameSet.has(t.name)) continue;
                  const selectionKey = parseGatewaySource(source) ? t.slug : t.name;
                  if (suggestedNames.has(t.name) && !value.direct.includes(selectionKey) && !newIntegrationTools.includes(selectionKey)) newIntegrationTools.push(selectionKey);
                }
              for (const g of availableTools.customGroups)
                for (const t of g.tools) if (suggestedNames.has(t.name) && !value.custom.includes(t.slug)) newCustom.push(t.slug);
            }
            const newIntegrationsTotal = newIntegrationTools.length + newCustom.length;
            const total = newSubagents.length + newDirect.length + newIntegrationsTotal;
            if (total === 0) return <p className="text-[12px] text-[#7c3aed] dark:text-[#a78bfa]">Already covered — nothing new to add.</p>;
            return (
              <div className="flex flex-col gap-2.5">
                <p className="text-[12px] text-[#5b21b6] dark:text-[#c4b5fd] leading-relaxed">Based on what you described, here's a starter toolkit. Accept it, then tweak below.</p>
                <div className="flex flex-col gap-1.5">
                  {newSubagents.length > 0 && (
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-[11px] font-medium text-[#7c3aed] dark:text-[#a78bfa]">Subagents · {newSubagents.length}</span>
                      <span className="flex flex-wrap gap-1">
                        {newSubagents.slice(0, 4).map((n) => <span key={n} className="text-[11px] px-1.5 py-0.5 rounded-full bg-white dark:bg-[#1e1b4b]/40 border border-[#c4b5fd] dark:border-[#6d28d9]/40 text-[#5b21b6] dark:text-[#c4b5fd]">{n}</span>)}
                        {newSubagents.length > 4 && <span className="text-[11px] text-[#7c3aed] dark:text-[#a78bfa]">+{newSubagents.length - 4} more</span>}
                      </span>
                    </div>
                  )}
                  {newDirect.length > 0 && (
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-[11px] font-medium text-[#7c3aed] dark:text-[#a78bfa]">Direct actions · {newDirect.length}</span>
                      <span className="flex flex-wrap gap-1">
                        {newDirect.slice(0, 4).map((n) => <span key={n} className="text-[11px] px-1.5 py-0.5 rounded-full bg-white dark:bg-[#1e1b4b]/40 border border-[#c4b5fd] dark:border-[#6d28d9]/40 text-[#5b21b6] dark:text-[#c4b5fd]">{humanizeToolName(n)}</span>)}
                        {newDirect.length > 4 && <span className="text-[11px] text-[#7c3aed] dark:text-[#a78bfa]">+{newDirect.length - 4} more</span>}
                      </span>
                    </div>
                  )}
                  {newIntegrationsTotal > 0 && (
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="text-[11px] font-medium text-[#7c3aed] dark:text-[#a78bfa]">MCP Tools · {newIntegrationsTotal}</span>
                      <span className="flex flex-wrap gap-1">
                        {newIntegrationTools.slice(0, 4).map((n) => {
                          const info = toolInfoMap.get(n);
                          return <span key={n} className="text-[11px] px-1.5 py-0.5 rounded-full bg-white dark:bg-[#1e1b4b]/40 border border-[#c4b5fd] dark:border-[#6d28d9]/40 text-[#5b21b6] dark:text-[#c4b5fd]">{humanizeToolName(info?.name ?? n)}</span>;
                        })}
                        {newIntegrationTools.length > 4 && <span className="text-[11px] text-[#7c3aed] dark:text-[#a78bfa]">+{newIntegrationTools.length - 4} more</span>}
                        {newCustom.length > 0 && <span className="text-[11px] text-[#5b21b6] dark:text-[#c4b5fd]">{newIntegrationTools.length > 0 ? "· " : ""}{newCustom.length} custom tool{newCustom.length === 1 ? "" : "s"}</span>}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button type="button" onClick={applySuggestion} className="inline-flex items-center gap-1 rounded-md bg-[#7c3aed] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[#6d28d9]">
                    <Sparkles size={12} /> Accept all {total}
                  </button>
                  <button type="button" onClick={reRollSuggestion} className="inline-flex items-center gap-1 rounded-md border border-[#c4b5fd] dark:border-[#6d28d9]/40 bg-transparent px-3 py-1.5 text-[12px] font-medium text-[#7c3aed] dark:text-[#a78bfa] transition-colors hover:bg-white dark:hover:bg-[#1e1b4b]/40">
                    Re-suggest
                  </button>
                </div>
              </div>
            );
          })() : null}
        </div>
      )}
      {suggestionApplied && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-xyne-success-border bg-xyne-success-bg px-3 py-2 text-[12px] text-xyne-success-fg">
          <span className="inline-flex items-center gap-1.5"><Check size={12} /> Suggestions applied. Refine below as needed.</span>
          <button type="button" onClick={reRollSuggestion} className="text-[11px] font-medium underline hover:no-underline">Re-suggest</button>
        </div>
      )}
      {!suggestionLoading && (
        <div className="flex flex-col gap-2 rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle/40 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.07em] text-xyne-fg-tertiary">
            <Sparkles size={12} className="text-[#7c3aed] dark:text-[#a78bfa]" /> Need different tools? Tell me what to add
          </div>
          <div className="flex items-center gap-2">
            <input value={refineIntent} onChange={(e) => setRefineIntent(e.target.value)} placeholder="e.g. I also need Slack notifications and Jira ticket creation" onKeyDown={(e) => { if (e.key === "Enter") void handleRefine(); }} className="min-w-0 flex-1 rounded-md border border-xyne-border bg-xyne-surface px-2.5 py-1.5 text-[12px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:outline-none focus:border-[#7c3aed] focus:shadow-[var(--comp-focus-ring)] transition-[border-color,box-shadow]" />
            <button type="button" onClick={() => void handleRefine()} disabled={!refineIntent.trim()} className="inline-flex items-center gap-1 rounded-md bg-[#7c3aed] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[#6d28d9] disabled:opacity-50 disabled:cursor-not-allowed">
              <Sparkles size={12} /> Suggest
            </button>
          </div>
        </div>
      )}
    </>
  ) : null;

  const researchBlock = researchAgent && (value.custom.includes("query-codebase") || value.custom.includes("review-pull-request")) ? (
    <div className="mb-4 rounded-xl border border-xyne-border bg-xyne-surface p-3">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">Research Agent context</div>
      <p className="mb-3 text-[12px] text-xyne-fg-secondary">Pick a product or repository for Research Agent tools. Product wins when both are set.</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <select value={researchAgent.productId} onChange={(e) => researchAgent.onProductIdChange(e.target.value)} className="min-w-0 w-full rounded-lg border border-xyne-border bg-xyne-surface-sunken px-3 py-2 text-[12px] text-xyne-fg-primary focus:border-xyne-border-focus focus:outline-none">
          <option value="">No product</option>
          {researchAgent.products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
        </select>
        <select value={researchAgent.repositoryId} onChange={(e) => researchAgent.onRepositoryIdChange(e.target.value)} className="min-w-0 w-full rounded-lg border border-xyne-border bg-xyne-surface-sunken px-3 py-2 text-[12px] text-xyne-fg-primary focus:border-xyne-border-focus focus:outline-none">
          <option value="">No repository</option>
          {researchAgent.repositories.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.id})</option>)}
        </select>
      </div>
      {researchAgent.loading && <p className="mt-2 text-[11px] text-xyne-fg-tertiary">Loading Research Agent options…</p>}
    </div>
  ) : null;

  const delegationConfirmDialogs = delegatedAgents ? (
    <>
      <Dialog
        open={pendingDelegationReason !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelegationReason(null);
            setDelegationReason("");
          }
        }}
        title={pendingDelegationReason?.title ?? "Why is this delegation needed?"}
        description={pendingDelegationReason?.description}
        maxWidth={520}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setPendingDelegationReason(null);
                setDelegationReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={delegationReason.trim().length < 3 || delegationBusy !== null}
              onClick={() => {
                if (!pendingDelegationReason || !delegatedAgents) return;
                const agentsToAdd = pendingDelegationReason.slugs
                  .map((slug) => agentBySlug.get(slug))
                  .filter((agent): agent is AgentLight => !!agent);
                const reason = delegationReason.trim();
                setPendingDelegationReason(null);
                setDelegationReason("");
                addDelegatedAgents(agentsToAdd, reason);
              }}
            >
              Request approval
            </Button>
          </>
        }
      >
        <textarea
          autoFocus
          value={delegationReason}
          onChange={(e) => setDelegationReason(e.target.value.slice(0, 1000))}
          placeholder="Explain the user flow, data needed, and why calling this agent is safer than duplicating its tools."
          className="min-h-[120px] w-full resize-y rounded-lg border border-xyne-border bg-xyne-surface-sunken px-3 py-2 text-[13px] leading-relaxed text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:border-xyne-border-focus focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-xyne-fg-tertiary">
          <span>Required when adding an agent owned by someone else.</span>
          <span>{delegationReason.trim().length}/1000</span>
        </div>
      </Dialog>
      <ConfirmDialog
        open={pendingDeleteGrant !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteGrant(null);
        }}
        title="Delete delegation grant"
        description={
          pendingDeleteGrant?.callee
            ? `Remove delegation to ${pendingDeleteGrant.callee.name}? This also removes ${pendingDeleteGrant.callee.slug} from tools.callableAgents.`
            : "Remove this delegation grant?"
        }
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          const grant = pendingDeleteGrant;
          if (!grant) return;
          void runDelegationAction(`delete:${grant.id}`, () => delegatedAgents.onDeleteGrant(grant));
          setPendingDeleteGrant(null);
        }}
      />
      <ConfirmDialog
        open={pendingBulkAgentDelete}
        onOpenChange={setPendingBulkAgentDelete}
        title="Delete delegation grants"
        description="Remove all selected delegated agents from grants and tools.callableAgents?"
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          setPendingBulkAgentDelete(false);
          void runDelegationAction("agents-deselect-all", async () => {
            for (const grant of Array.from(grantBySlug.values())) {
              await delegatedAgents.onDeleteGrant(grant);
            }
            for (const slug of configMissingGrants) {
              await delegatedAgents.onRemoveConfigEntry(slug);
            }
          });
        }}
      />
    </>
  ) : null;

  /* ── render ──────────────────────────────────────────────────────── */
  if (large) {
    return (
      <div ref={rootRef} className={`flex flex-col min-h-0${largeHeight ? "" : " flex-1"}`} style={largeHeight ? { height: largeHeight } : undefined}>
        {delegationConfirmDialogs}
        <div className="shrink-0 overflow-y-auto px-1 py-1 space-y-3 border-b border-xyne-border-subtle" style={{ maxHeight: "220px" }}>
          {showCaption && <SectionCaption friendly="Toolbox" technical="tools" />}
          {researchBlock}
          {suggestBlock}
        </div>

        {loading && (
          <div className="flex items-center gap-2 px-1 py-6 text-[13px] text-xyne-fg-muted">
            <Loader2 size={14} className="animate-spin" /> Loading tools…
          </div>
        )}

        {!loading && availableTools && (
          <div className="flex-1 min-h-0 flex divide-x divide-xyne-border-subtle overflow-hidden">
            <nav className="w-56 shrink-0 flex flex-col bg-xyne-surface" aria-label="Tool categories">
              <div className="py-2 flex-1 overflow-y-auto">
                {(() => {
                  const badge = (selCount: number, hasDestructive: boolean) => (
                    <>
                      {hasDestructive && <span className="h-1.5 w-1.5 rounded-full bg-red-500 flex-shrink-0" aria-label="Contains destructive tools" />}
                      {selCount > 0 && <span className="tabular-nums text-[10px] font-semibold bg-xyne-brand text-xyne-fg-inverse rounded-full px-1.5 py-0.5 leading-none flex-shrink-0">{selCount}</span>}
                    </>
                  );
                  const rowCls = (active: boolean) =>
                    `w-full flex items-center gap-2.5 pr-3 py-2.5 text-[13px] text-left transition-colors ${
                      active ? "bg-xyne-surface-subtle text-xyne-fg-primary font-medium" : "text-xyne-fg-secondary hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
                    }`;
                  return (
                    <>
                      <button type="button" onClick={() => setToolTab("all")} aria-current={toolTab === "all" ? "page" : undefined} className={`${rowCls(toolTab === "all")} pl-5`}>
                        <span className="h-2 w-2 flex-shrink-0" aria-hidden="true" />
                        <span className="flex-1 truncate">All tools</span>
                        {badge(selectionItems.length, false)}
                      </button>
                      {railGroups.map((g) => {
                        const isParent = !!g.children?.length;
                        const expanded = expandedRailGroups.has(g.key);
                        return (
                          <div key={g.key}>
                            <button
                              type="button"
                              onClick={() => { setToolTab(g.key); if (isParent) toggleRailGroup(g.key); }}
                              aria-current={toolTab === g.key ? "page" : undefined}
                              aria-expanded={isParent ? expanded : undefined}
                              className={`${rowCls(toolTab === g.key)} pl-3`}
                            >
                              {isParent ? (
                                <ChevronRight size={14} className={`flex-shrink-0 text-xyne-fg-tertiary transition-transform duration-150 ${expanded ? "rotate-90" : ""}`} aria-hidden="true" />
                              ) : <span className="w-3.5 flex-shrink-0" aria-hidden="true" />}
                              {g.dot ? <span className={`h-2 w-2 flex-shrink-0 rounded-full ${g.dot}`} aria-hidden="true" /> : <span className="h-2 w-2 flex-shrink-0" aria-hidden="true" />}
                              <span className="flex-1 truncate">{g.label}</span>
                              {badge(g.selCount, g.hasDestructive)}
                            </button>
                            {isParent && expanded && g.children!.map((c) => (
                              <button
                                key={c.key}
                                type="button"
                                onClick={() => setToolTab(c.key)}
                                aria-current={toolTab === c.key ? "page" : undefined}
                                className={`${rowCls(toolTab === c.key)} pl-12`}
                              >
                                <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${c.dot}`} aria-hidden="true" />
                                <span className="flex-1 truncate text-[12px]">{c.label}</span>
                                {badge(c.selCount, c.hasDestructive)}
                              </button>
                            ))}
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
              </div>
            </nav>

            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <div className="shrink-0 px-5 py-3 border-b border-xyne-border-subtle flex items-center gap-3">
                <div className="relative flex-1">
                  <input
                    type="search"
                    value={toolSearch}
                    onChange={(e) => setToolSearch(e.target.value)}
                    placeholder="Search tools…"
                    aria-label="Search tools"
                    className="w-full rounded-[var(--comp-input-radius)] border border-xyne-border bg-xyne-surface px-3 py-1.5 pr-8 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:outline-none focus:border-xyne-border-focus focus:shadow-[var(--comp-focus-ring)] transition-[border-color,box-shadow] [&::-webkit-search-cancel-button]:hidden"
                  />
                  {toolSearch && (
                    <button type="button" onClick={() => setToolSearch("")} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xyne-fg-tertiary hover:text-xyne-fg-primary transition-colors">
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
                {(() => {
                  const globalSearch = !!searchQ;
                  const showSubagents = (globalSearch || toolTab === "all" || toolTab === "subagents") && availableTools.subagents.length > 0;
                  const activeMcp = !globalSearch ? mcpEntries.find(([s]) => s === toolTab) : null;
                  const activeCustom = !globalSearch ? availableTools.customGroups.find((g) => g.source === toolTab) : null;

                  const renderGroup = (title: string, chips: React.ReactNode[], selCount: number, totalCount: number, onSelectAll?: () => void, allSelected?: boolean, beforeChips?: React.ReactNode) => (
                    <div className="mb-6 last:mb-0">
                      <div className="flex items-center gap-2 mb-2.5">
                        <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-xyne-fg-tertiary">{title}</h3>
                        <span className="text-[11px] tabular-nums text-xyne-fg-tertiary">{selCount > 0 ? `${selCount}/` : ""}{totalCount}</span>
                        {onSelectAll && (
                          <button type="button" onClick={onSelectAll} className="ml-auto text-[11px] font-medium text-xyne-fg-secondary hover:text-xyne-fg-primary transition-colors">
                            {allSelected ? "Deselect all" : "Select all"}
                          </button>
                        )}
                      </div>
                      {beforeChips}
                      <div className="flex flex-wrap gap-1.5">{chips}</div>
                    </div>
                  );

                  const subagentChips = showSubagents
                    ? availableTools.subagents.filter((sa) => toolMatchesSearch(sa.name)).map((sa) => makeChip(sa.name, `${SUBAGENT_EMOJI[sa.name] ?? "🤖"} ${sa.name}`, sa.name, value.subagents.includes(sa.name), "read", () => toggle("subagents", sa.name)))
                    : [];
                  const showAgents = !!delegatedAgents && (globalSearch || toolTab === "all" || toolTab === "agents") && (agentOptions.length > 0 || isOrchestratorTier);
                  const agentChips = showAgents && !isOrchestratorTier ? agentOptions.filter(agentMatchesSearch).map(makeAgentChip) : [];
                  const allAgentsSelected = agentOptions.length > 0 && agentOptions.every((a) => configAgentSlugs.has(a.slug) || grantBySlug.has(a.slug));

                  const mcpSections = (activeMcp ? [activeMcp] : (globalSearch || toolTab === "all" || toolTab === "integrations") ? mcpEntries : []).map(([source, tools]) => {
                    const matched = tools.filter((t) => toolMatchesSearch(t.name));
                    const allKeys = tools.map((t) => selectionKeyForMcpTool(source, t));
                    const selCount = tools.filter((t) => isMcpToolSelected(source, t)).length;
                    const totalCount = allKeys.length;
                    const allSelected = totalCount > 0 && tools.every((t) => isMcpToolSelected(source, t));
                    const gatewaySource = parseGatewaySource(source);
                    return {
                      source,
                      chips: matched.map((t) => {
                        const selectionKey = selectionKeyForMcpTool(source, t);
                        return makeChip(
                          `${source}-${t.slug}`,
                          humanizeToolName(t.name, gatewaySource?.serviceName ?? source),
                          t.name,
                          isMcpToolSelected(source, t),
                          (toolInfoMap.get(t.slug) ?? toolInfoMap.get(t.name))?.riskLevel,
                          () => setGatewayToolSelection(source, tools, t, !isMcpToolSelected(source, t)),
                          selectionKey,
                        );
                      }),
                      selCount,
                      totalCount,
                      onSelectAll: () => gatewaySource ? setGatewayBulkSelection(source, tools, !allSelected) : toggleAll("direct", allKeys),
                      allSelected,
                    };
                  });

                  const customSections = (activeCustom ? [activeCustom] : (globalSearch || toolTab === "all" || toolTab === "builtin") ? availableTools.customGroups : []).map((g) => {
                    const label = customLabel(g.source);
                    const chips = g.tools.filter((t) => toolMatchesSearch(t.name)).map((t) => makeChip(t.slug, humanizeToolName(t.name), t.name, value.custom.includes(t.slug), toolInfoMap.get(t.name)?.riskLevel, () => toggle("custom", t.slug)));
                    const selCount = g.tools.filter((t) => value.custom.includes(t.slug)).length;
                    const slugs = g.tools.map((t) => t.slug);
                    const allSelected = slugs.length > 0 && slugs.every((s) => value.custom.includes(s));
                    return { label, chips, selCount, totalCount: g.tools.length, onSelectAll: () => toggleCustomGroup(slugs, allSelected), allSelected };
                  });

                  const hasAnything = subagentChips.length > 0 || agentChips.length > 0 || (showAgents && isOrchestratorTier) || mcpSections.some((s) => s.chips.length > 0) || customSections.some((s) => s.chips.length > 0);
                  if (!hasAnything) {
                    return <p className="py-8 text-center text-[13px] text-xyne-fg-tertiary" role="status">{searchQ ? `No tools match "${toolSearch}"` : "No tools in this category."}</p>;
                  }

                  const subagentAllSel = availableTools.subagents.length > 0 && availableTools.subagents.every((sa) => value.subagents.includes(sa.name));

                  return (
                    <div>
                      {showSubagents && subagentChips.length > 0 && renderGroup("Subagents", subagentChips, value.subagents.length, availableTools.subagents.length, () => toggleAll("subagents", availableTools.subagents.map((sa) => sa.name)), subagentAllSel)}
                      {showAgents && (agentChips.length > 0 || delegationWarnings || isOrchestratorTier) && renderGroup(
                        "Agents",
                        agentChips,
                        isOrchestratorTier ? agentOptions.length : selectedAgentCount,
                        agentOptions.length,
                        isOrchestratorTier ? undefined : () => handleAgentBulkToggle(allAgentsSelected),
                        allAgentsSelected,
                        <>
                          {orchestratorAgentsNote}
                          {!isOrchestratorTier && delegatedAgents.loading && (
                            <p className="mb-3 rounded-lg border border-xyne-border-subtle bg-xyne-surface px-3 py-2 text-[12px] text-xyne-fg-tertiary">
                              Loading delegation grants…
                            </p>
                          )}
                          {!isOrchestratorTier && delegationWarnings}
                        </>,
                      )}
                      {mcpSections.map(({ source, chips, selCount, totalCount, onSelectAll, allSelected }) => chips.length > 0 && renderGroup(formatServerLabel(source), chips, selCount, totalCount, onSelectAll, allSelected))}
                      {customSections.map(({ label, chips, selCount, totalCount, onSelectAll, allSelected }) => chips.length > 0 && renderGroup(label, chips, selCount, totalCount, onSelectAll, allSelected))}
                    </div>
                  );
                })()}
              </div>

              <div className="shrink-0 border-t border-xyne-border-subtle px-5 py-3 flex flex-col justify-center bg-xyne-surface-subtle/60" style={{ minHeight: "88px", maxHeight: "88px" }} aria-live="polite" aria-label="Tool detail">
                {activeDetail ? (
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${riskDotCls(activeDetail.riskLevel)}`} aria-hidden="true" />
                      <span className="text-[13px] font-semibold text-xyne-fg-primary truncate">{humanizeToolName(activeDetail.name)}</span>
                      <span className="font-mono text-[10px] text-xyne-fg-tertiary truncate hidden sm:block">{activeDetail.name}</span>
                      <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.05em] ml-auto ${
                        activeDetail.riskLevel === "read" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : activeDetail.riskLevel === "write" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                        : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      }`}>{activeDetail.riskLevel}</span>
                    </div>
                    <p className="text-[12px] text-xyne-fg-secondary leading-relaxed line-clamp-2">{activeDetail.description || "No description available."}</p>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4 w-full">
                    <div className="flex items-center gap-2 text-xyne-fg-tertiary">
                      <Info size={13} className="shrink-0" />
                      <p className="text-[12px]">Hover or select a tool to see its description.</p>
                    </div>
                    <div className="shrink-0 flex flex-col gap-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-xyne-fg-secondary">Risk level</p>
                      <div className="flex items-center gap-3 text-[11px] text-xyne-fg-secondary">
                        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />Read</span>
                        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />Write</span>
                        <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" aria-hidden="true" />Destructive</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="w-64 shrink-0 flex flex-col bg-xyne-surface">
              <div className="shrink-0 flex items-center justify-between gap-2 px-5 py-3 border-b border-xyne-border-subtle">
                <span className="text-[13px] font-semibold text-xyne-fg-primary">{selectionItems.length === 0 ? "Nothing selected" : `${selectionItems.length} selected`}</span>
                {selectionItems.length > 0 && (
                  <button type="button" onClick={clearAll} className="text-[11px] text-xyne-fg-tertiary hover:text-red-500 dark:hover:text-red-400 transition-colors">Clear all</button>
                )}
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto py-1" role="list" aria-label="Selected tools">
                {selectionItems.length === 0 ? (
                  <p className="px-5 py-6 text-[12px] text-xyne-fg-tertiary italic text-center">Click a tool to select it.</p>
                ) : (
                  groupedSelection.map((grp) => (
                    <div key={grp.cat} className="mb-1.5 last:mb-0">
                      <div className="flex items-center gap-1.5 px-5 pt-2.5 pb-1">
                        <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${grp.dot}`} aria-hidden="true" />
                        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-xyne-fg-tertiary">{grp.label}</span>
                        <span className="text-[10px] tabular-nums text-xyne-fg-tertiary">{grp.items.length}</span>
                      </div>
                      {grp.items.map(({ label, key, riskLevel, badge, status, onRemove }) => (
                        <div
                          key={key}
                          role="listitem"
                          title={status === "pending" ? `waiting for ${label}'s owner to approve` : undefined}
                          className={`group flex items-center gap-2 px-5 py-1.5 transition-colors hover:bg-xyne-surface-subtle ${
                            status === "pending" ? "border-y border-dashed border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-900/10" : ""
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${riskDotCls(riskLevel)}`} aria-hidden="true" />
                          <span className="flex-1 min-w-0 truncate text-[12px] text-xyne-fg-primary">{label}</span>
                          {badge && (
                            <AgentHeavyweightBadge compact />
                          )}
                          {status === "pending" && (
                            <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.04em] text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                              pending
                            </span>
                          )}
                          <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="flex-shrink-0 text-xyne-fg-tertiary opacity-0 group-hover:opacity-100 hover:text-red-500 focus-visible:opacity-100 focus-visible:outline-none transition-all">
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {!loading && !availableTools && <p className="px-1 py-4 text-[13px] text-xyne-fg-muted">Failed to load tools.</p>}
      </div>
    );
  }

  // ── COMPACT MODE ──
  return (
    <div ref={rootRef} className="space-y-5">
      {delegationConfirmDialogs}
      {showCaption && <SectionCaption friendly="Toolbox" technical="tools" />}
      {researchBlock}
      {suggestBlock}

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] text-xyne-fg-muted"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : availableTools ? (
        <>
          {selectionItems.length > 0 && (
            <div className="sticky top-0 z-10 bg-xyne-surface pb-3 border-b border-xyne-border-subtle" aria-live="polite" aria-atomic="true">
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[12px] font-medium text-xyne-fg-secondary">{selectionItems.length} tool{selectionItems.length !== 1 ? "s" : ""} selected</span>
                <button type="button" onClick={clearAll} className="text-[11px] text-xyne-fg-tertiary hover:text-red-500 dark:hover:text-red-400 transition-colors">Clear all</button>
              </div>
              <div className="flex flex-col gap-2 mt-1.5" role="list" aria-label="Selected tools">
                {groupedSelection.map((grp) => (
                  <div key={grp.cat}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${grp.dot}`} aria-hidden="true" />
                      <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-xyne-fg-tertiary">{grp.label}</span>
                      <span className="text-[10px] tabular-nums text-xyne-fg-tertiary">{grp.items.length}</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {grp.items.map(({ label, key, riskLevel, badge, status, onRemove }) => (
                        <span
                          key={key}
                          role="listitem"
                          title={status === "pending" ? `waiting for ${label}'s owner to approve` : undefined}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                            status === "pending"
                              ? "border-dashed border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-500/70 dark:bg-amber-900/20 dark:text-amber-300"
                              : "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-900/20 dark:text-indigo-300"
                          }`}
                        >
                          <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${riskDotCls(riskLevel)}`} aria-hidden="true" />
                          {label}
                          {badge && (
                            <AgentHeavyweightBadge compact />
                          )}
                          {status === "pending" && (
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.04em] text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                              pending
                            </span>
                          )}
                          <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="ml-0.5 rounded-full hover:text-red-500 transition-colors focus-visible:outline-none"><X size={10} /></button>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="relative">
            <input type="search" value={toolSearch} onChange={(e) => setToolSearch(e.target.value)} placeholder="Search tools…" aria-label="Search tools" className="w-full rounded-[var(--comp-input-radius)] border border-xyne-border bg-xyne-surface px-3 py-2 pr-8 text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:outline-none focus:border-xyne-border-focus focus:shadow-[var(--comp-focus-ring)] transition-[border-color,box-shadow] [&::-webkit-search-cancel-button]:hidden" />
            {toolSearch && <button type="button" onClick={() => setToolSearch("")} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xyne-fg-tertiary hover:text-xyne-fg-primary transition-colors"><X size={14} /></button>}
          </div>

          {(() => {
            type Tab = { key: string; label: string; dot?: string; count: number };
            // Mirror the large-mode structural grouping: instead of one chip per
            // server/custom source, expose the two parent buckets. Tapping them
            // sets the parent toolTab and the content area renders all children.
            const integrationsCount = mcpEntries.reduce((s, [, tools]) => s + tools.length, 0);
            const builtinCount = availableTools.customGroups.reduce((s, g) => s + g.tools.length, 0);
            const tabs: Tab[] = [
              { key: "all", label: "All", count: availableTools.subagents.length + agentOptions.length + integrationsCount + builtinCount },
              { key: "subagents", label: "Subagents", dot: "bg-violet-500", count: availableTools.subagents.length },
              { key: "agents", label: "Agents", dot: "bg-amber-500", count: agentOptions.length },
              { key: "integrations", label: "MCP Tools", dot: "bg-emerald-500", count: integrationsCount },
              { key: "builtin", label: "Built-in tools", dot: "bg-slate-400", count: builtinCount },
            ].filter((t) => t.count > 0);
            if (tabs.length <= 1) return null;
            return (
              <div className="flex flex-wrap items-center gap-1.5">
                {tabs.map(({ key, label, dot, count }) => {
                  const active = toolTab === key;
                  return (
                    <button key={key} type="button" onClick={() => setToolTab(key)} aria-pressed={active} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition ${active ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-900/20 dark:text-indigo-300" : "border-xyne-border bg-xyne-surface text-xyne-fg-secondary hover:border-xyne-border-strong"}`}>
                      {dot && <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dot}`} aria-hidden="true" />}
                      {label}
                      <span className={`tabular-nums ${active ? "text-indigo-500 dark:text-indigo-400" : "text-xyne-fg-tertiary"}`} aria-hidden="true">{count}</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}

          <div className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-subtle px-3 py-2.5 flex flex-col justify-center" style={{ minHeight: "72px", maxHeight: "72px" }} aria-live="polite" aria-label="Tool detail">
            {pinnedDetail ? (
              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`h-2 w-2 flex-shrink-0 rounded-full ${riskDotCls(pinnedDetail.riskLevel)}`} aria-hidden="true" />
                  <span className="text-[12px] font-semibold text-xyne-fg-primary truncate">{humanizeToolName(pinnedDetail.name)}</span>
                  <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.05em] ml-auto ${
                    pinnedDetail.riskLevel === "read" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                    : pinnedDetail.riskLevel === "write" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  }`}>{pinnedDetail.riskLevel ?? "write"}</span>
                  <button type="button" onClick={() => setPinnedDetail(null)} aria-label="Close detail" className="flex-shrink-0 text-xyne-fg-tertiary hover:text-xyne-fg-primary transition ml-1"><X size={11} /></button>
                </div>
                <p className="text-[11px] text-xyne-fg-secondary leading-relaxed line-clamp-1">{pinnedDetail.description || "No description available."}</p>
              </div>
            ) : (
              <p className="text-[12px] text-xyne-fg-tertiary italic">Click a tool to see its description and risk level.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[10px] text-xyne-fg-tertiary" aria-label="Tool risk level legend">
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />Read — no side effects</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />Write — modifies data</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden="true" />Destructive — irreversible</span>
          </div>

          {availableTools.subagents.length > 0 && (!!searchQ || toolTab === "all" || toolTab === "subagents") && sectionVisible(availableTools.subagents.map((sa) => sa.name)) && (
            <div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => toggleSection("subagents")} aria-expanded={sectionOpen("subagents", availableTools.subagents.map((sa) => sa.name))} aria-controls="toolbox-subagents" className="flex flex-1 items-center gap-2 rounded px-1 py-1.5 text-left hover:bg-xyne-surface-subtle transition-colors">
                  <ChevronRight size={14} className={`flex-shrink-0 text-xyne-fg-tertiary transition-transform duration-150 ${sectionOpen("subagents", availableTools.subagents.map((sa) => sa.name)) ? "rotate-90" : ""}`} aria-hidden="true" />
                  <span className="text-[13px] font-semibold text-xyne-fg-primary">Subagents</span>
                  <span className="text-[11px] font-normal text-xyne-fg-tertiary">· subagents</span>
                  <span className="ml-auto text-[11px] tabular-nums text-xyne-fg-tertiary">{value.subagents.length > 0 ? `${value.subagents.length}/` : ""}{availableTools.subagents.length}</span>
                </button>
                <button type="button" onClick={() => toggleAll("subagents", availableTools.subagents.map((x) => x.name))} className="flex-shrink-0 px-1.5 py-1 text-[11px] font-medium text-xyne-fg-secondary hover:text-xyne-fg-primary transition-colors">
                  {value.subagents.length === availableTools.subagents.length ? "Deselect all" : "Select all"}
                </button>
              </div>
              {sectionOpen("subagents", availableTools.subagents.map((sa) => sa.name)) && (
                <div id="toolbox-subagents" className="flex flex-wrap gap-1.5 pt-2 pl-6" role="group" aria-label="Subagent subagents">
                  {availableTools.subagents.filter((sa) => toolMatchesSearch(sa.name)).map((sa) => {
                    const selected = value.subagents.includes(sa.name);
                    return (
                      <button key={sa.name} type="button" onClick={() => { toggle("subagents", sa.name); pinDetail(sa.name); }} onMouseEnter={() => hoverDetail(sa.name)} onMouseLeave={() => hoverDetail(null)} onFocus={() => hoverDetail(sa.name)} onBlur={() => hoverDetail(null)} title={sa.name} aria-pressed={selected} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition ${selected ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-900/20 dark:text-indigo-300" : "border-xyne-border bg-xyne-surface text-xyne-fg-secondary hover:border-xyne-border-strong"}`}>
                        <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${riskDotCls("read")}`} aria-hidden="true" />
                        <span aria-hidden="true">{SUBAGENT_EMOJI[sa.name] ?? "🤖"}</span>
                        {sa.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {delegatedAgents && (agentOptions.length > 0 || isOrchestratorTier) && (!!searchQ || toolTab === "all" || toolTab === "agents") && (
            <div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => toggleSection("agents")} aria-expanded={searchQ ? (isOrchestratorTier || agentOptions.some(agentMatchesSearch)) : expandedSections.has("agents")} aria-controls="toolbox-agents" className="flex flex-1 items-center gap-2 rounded px-1 py-1.5 text-left hover:bg-xyne-surface-subtle transition-colors">
                  <ChevronRight size={14} className={`flex-shrink-0 text-xyne-fg-tertiary transition-transform duration-150 ${(searchQ ? (isOrchestratorTier || agentOptions.some(agentMatchesSearch)) : expandedSections.has("agents")) ? "rotate-90" : ""}`} aria-hidden="true" />
                  <span className="text-[13px] font-semibold text-xyne-fg-primary">Agents</span>
                  <span className="text-[11px] font-normal text-xyne-fg-tertiary">· delegated agents</span>
                  <span className="ml-auto text-[11px] tabular-nums text-xyne-fg-tertiary">{isOrchestratorTier ? agentOptions.length : selectedAgentCount > 0 ? `${selectedAgentCount}/${agentOptions.length}` : agentOptions.length}</span>
                </button>
                {!isOrchestratorTier && (
                  <button type="button" onClick={() => handleAgentBulkToggle(agentOptions.every((a) => configAgentSlugs.has(a.slug) || grantBySlug.has(a.slug)))} disabled={delegatedAgents.disabled || delegationBusy !== null} className="flex-shrink-0 px-1.5 py-1 text-[11px] font-medium text-xyne-fg-secondary hover:text-xyne-fg-primary transition-colors disabled:cursor-not-allowed disabled:opacity-50">
                    {agentOptions.every((a) => configAgentSlugs.has(a.slug) || grantBySlug.has(a.slug)) ? "Deselect" : "Select all"}
                  </button>
                )}
              </div>
              {(searchQ ? (isOrchestratorTier || agentOptions.some(agentMatchesSearch)) : expandedSections.has("agents")) && (
                <div id="toolbox-agents" className="pt-2 pl-6" role="group" aria-label="Agents">
                  {orchestratorAgentsNote}
                  {!isOrchestratorTier && (
                  <p className="mb-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-500/40 dark:bg-amber-900/20 dark:text-amber-300">
                    <span aria-hidden="true">⚠️</span>
                    <span>
                      Delegated agents run a <strong>full agent loop</strong> — their own prompt, tools, and model — so each
                      delegation is slow and expensive. Adding an agent you don't own asks its owner for approval first.
                    </span>
                  </p>
                  )}
                  {!isOrchestratorTier && delegatedAgents.loading && (
                    <p className="mb-3 rounded-lg border border-xyne-border-subtle bg-xyne-surface px-3 py-2 text-[12px] text-xyne-fg-tertiary">
                      Loading delegation grants…
                    </p>
                  )}
                  {!isOrchestratorTier && delegationWarnings}
                  {!isOrchestratorTier && (
                    <div className="flex flex-wrap gap-1.5">
                      {agentOptions.filter(agentMatchesSearch).map(makeAgentChip)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {(mcpEntries.length > 0 || availableTools.customGroups.length > 0) && (!!searchQ || toolTab === "all" || toolTab === "integrations" || toolTab === "builtin" || mcpEntries.some(([src]) => src === toolTab) || availableTools.customGroups.some((g) => g.source === toolTab)) && (
            <div className="space-y-1">
              {(!!searchQ || toolTab === "all" || toolTab === "integrations") && mcpEntries.length > 0 && <p className="px-1 pb-0.5 text-[11px] font-medium uppercase tracking-[0.07em] text-xyne-fg-tertiary">MCP Tools</p>}
              {mcpEntries.filter(([source]) => !!searchQ || toolTab === "all" || toolTab === "integrations" || toolTab === source).map(([source, tools]) => {
                const serverTools = tools;
                const toolNames = serverTools.map((t) => t.name);
                if (!sectionVisible(toolNames)) return null;
                const visibleTools = serverTools.filter((t) => toolMatchesSearch(t.name));
                const allKeysForToggle = serverTools.map((t) => selectionKeyForMcpTool(source, t));
                const allSel = allKeysForToggle.length > 0 && serverTools.every((t) => isMcpToolSelected(source, t));
                const selectedCount = serverTools.filter((t) => isMcpToolSelected(source, t)).length;
                const hasDestructive = serverTools.some((t) => (toolInfoMap.get(t.slug) ?? toolInfoMap.get(t.name))?.riskLevel === "destructive");
                const open = sectionOpen(source, toolNames);
                const gatewaySource = parseGatewaySource(source);
                return (
                  <div key={source}>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => toggleSection(source)} aria-expanded={open} aria-controls={`toolbox-${source}`} className="flex flex-1 items-center gap-2 rounded px-1 py-1.5 text-left hover:bg-xyne-surface-subtle transition-colors">
                        <ChevronRight size={14} className={`flex-shrink-0 text-xyne-fg-tertiary transition-transform duration-150 ${open ? "rotate-90" : ""}`} aria-hidden="true" />
                        <span className="text-[12px] font-semibold text-xyne-fg-primary">{formatServerLabel(source)}</span>
                        {hasDestructive && <span className="h-1.5 w-1.5 rounded-full bg-red-500 flex-shrink-0" aria-label="Contains destructive tools" />}
                        <span className="ml-auto text-[11px] tabular-nums text-xyne-fg-tertiary">{selectedCount > 0 ? `${selectedCount}/` : ""}{serverTools.length}</span>
                      </button>
                      <button type="button" onClick={() => gatewaySource ? setGatewayBulkSelection(source, serverTools, !allSel) : toggleAll("direct", allKeysForToggle)} className="flex-shrink-0 px-1.5 py-1 text-[11px] font-medium text-xyne-fg-secondary hover:text-xyne-fg-primary transition-colors">{allSel ? "Deselect" : "Select all"}</button>
                    </div>
                    {open && (
                      <div id={`toolbox-${source}`} className="flex flex-wrap gap-1.5 pt-2 pl-6" role="group" aria-label={`${formatServerLabel(source)} tools`}>
                        {visibleTools.map((t) => {
                          const selected = isMcpToolSelected(source, t);
                          const risk = (toolInfoMap.get(t.slug) ?? toolInfoMap.get(t.name))?.riskLevel;
                          const selectionKey = selectionKeyForMcpTool(source, t);
                          return (
                            <button key={`${source}-${t.slug}`} type="button" onClick={() => { setGatewayToolSelection(source, serverTools, t, !selected); pinDetail(selectionKey); }} onMouseEnter={() => hoverDetail(selectionKey)} onMouseLeave={() => hoverDetail(null)} onFocus={() => hoverDetail(selectionKey)} onBlur={() => hoverDetail(null)} title={t.name} aria-pressed={selected} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] transition ${selected ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-900/20 dark:text-indigo-300" : "border-xyne-border bg-xyne-surface text-xyne-fg-secondary hover:border-xyne-border-strong"}`}>
                              <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${riskDotCls(risk)}`} aria-hidden="true" />
                              {humanizeToolName(t.name, gatewaySource?.serviceName ?? source)}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {(!!searchQ || toolTab === "all" || toolTab === "builtin") && availableTools.customGroups.length > 0 && <p className="px-1 pt-1 pb-0.5 text-[11px] font-medium uppercase tracking-[0.07em] text-xyne-fg-tertiary">Built-in tools</p>}
              {availableTools.customGroups.filter((g) => !!searchQ || toolTab === "all" || toolTab === "builtin" || toolTab === g.source).map((g) => {
                const slugs = g.tools.map((t) => t.slug);
                const toolNames = g.tools.map((t) => t.name);
                if (!sectionVisible(toolNames)) return null;
                const visibleTools = g.tools.filter((t) => toolMatchesSearch(t.name));
                const allSel = slugs.every((x) => value.custom.includes(x));
                const selectedCount = slugs.filter((s) => value.custom.includes(s)).length;
                const label = g.source.replace("custom:", "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                const hasDestructive = g.tools.some((t) => toolInfoMap.get(t.name)?.riskLevel === "destructive");
                const open = sectionOpen(g.source, toolNames);
                return (
                  <div key={g.source}>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => toggleSection(g.source)} aria-expanded={open} aria-controls={`toolbox-${g.source}`} className="flex flex-1 items-center gap-2 rounded px-1 py-1.5 text-left hover:bg-xyne-surface-subtle transition-colors">
                        <ChevronRight size={14} className={`flex-shrink-0 text-xyne-fg-tertiary transition-transform duration-150 ${open ? "rotate-90" : ""}`} aria-hidden="true" />
                        <span className="text-[12px] font-semibold text-xyne-fg-primary">{label}</span>
                        {hasDestructive && <span className="h-1.5 w-1.5 rounded-full bg-red-500 flex-shrink-0" aria-label="Contains destructive tools" />}
                        <span className="ml-auto text-[11px] tabular-nums text-xyne-fg-tertiary">{selectedCount > 0 ? `${selectedCount}/` : ""}{g.tools.length}</span>
                      </button>
                      <button type="button" onClick={() => toggleCustomGroup(slugs, allSel)} className="flex-shrink-0 px-1.5 py-1 text-[11px] font-medium text-xyne-fg-secondary hover:text-xyne-fg-primary transition-colors">{allSel ? "Deselect" : "Select all"}</button>
                    </div>
                    {open && (
                      <div id={`toolbox-${g.source}`} className="flex flex-wrap gap-1.5 pt-2 pl-6" role="group" aria-label={`${label} tools`}>
                        {visibleTools.map((t) => {
                          const selected = value.custom.includes(t.slug);
                          const risk = toolInfoMap.get(t.name)?.riskLevel;
                          return (
                            <button key={t.slug} type="button" onClick={() => { toggle("custom", t.slug); pinDetail(t.name); }} onMouseEnter={() => hoverDetail(t.name)} onMouseLeave={() => hoverDetail(null)} onFocus={() => hoverDetail(t.name)} onBlur={() => hoverDetail(null)} title={t.name} aria-pressed={selected} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] transition ${selected ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-900/20 dark:text-indigo-300" : "border-xyne-border bg-xyne-surface text-xyne-fg-secondary hover:border-xyne-border-strong"}`}>
                              <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${riskDotCls(risk)}`} aria-hidden="true" />
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

          {searchQ && !availableTools.subagents.some((sa) => toolMatchesSearch(sa.name)) && !agentOptions.some(agentMatchesSearch) && !availableTools.writeTools.some((t) => toolMatchesSearch(t.name)) && !mcpEntries.some(([, tools]) => tools.some((t) => toolMatchesSearch(t.name))) && !availableTools.customGroups.some((g) => g.tools.some((t) => toolMatchesSearch(t.name))) && (
            <p className="py-6 text-center text-[13px] text-xyne-fg-tertiary" role="status">No tools match &ldquo;{toolSearch}&rdquo;</p>
          )}
        </>
      ) : <p className="text-[13px] text-xyne-fg-muted">Failed to load tools.</p>}
    </div>
  );
}

function DelegationMismatchWarning({
  text,
  actionLabel,
  busy,
  disabled,
  onClick,
}: {
  text: string;
  actionLabel: string;
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-xyne-warning-border bg-xyne-warning-bg px-3 py-2 text-[12px] text-xyne-warning-fg">
      <AlertTriangle size={14} className="shrink-0" />
      <span className="min-w-0 flex-1">{text}</span>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || busy}
        className="shrink-0 rounded-full border border-xyne-warning-border bg-xyne-surface px-2.5 py-1 text-[11px] font-medium text-xyne-fg-primary transition-colors hover:bg-xyne-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Fixing…" : actionLabel}
      </button>
    </div>
  );
}

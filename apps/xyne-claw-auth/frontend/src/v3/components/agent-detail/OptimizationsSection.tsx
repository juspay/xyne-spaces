/**
 * OptimizationsSection — one toggle per claw optimization switch.
 *
 * The list comes from claw-auth (GET /agents/optimizations), which serves the
 * same xyne-claw-shared catalog claw decides each run from, so a new switch
 * appears here without a UI change.
 *
 * An agent stores only its departures from the default in
 * `config.optimizations`: flipping a switch back to its default removes the
 * key, so an agent that never touched a switch keeps following the platform
 * default if it changes. Keys this page does not show (unknown or fleet-wide)
 * are left as they are.
 */
import { useEffect, useState } from "react";
import { getOptimizationCatalog, type OptimizationCatalog, type OptimizationOption } from "../../../lib/api";
import { SettingGroup, SettingRow } from "./SettingRow";
import { Switch } from "../ui/Switch";

// Fetched once per page load; a failed fetch is dropped so the next mount retries.
let catalogPromise: Promise<OptimizationCatalog> | null = null;
function loadCatalog(): Promise<OptimizationCatalog> {
  catalogPromise ??= getOptimizationCatalog().catch((err: unknown) => {
    catalogPromise = null;
    throw err;
  });
  return catalogPromise;
}

export function useOptimizationCatalog(): { catalog: OptimizationCatalog | null; loadFailed: boolean } {
  const [catalog, setCatalog] = useState<OptimizationCatalog | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadCatalog()
      .then((c) => { if (!cancelled) setCatalog(c); })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, []);
  return { catalog, loadFailed };
}

/** Value a switch has when this agent stores nothing for it. */
export function optimizationDefault(
  option: Pick<OptimizationOption, "key" | "defaultOn">,
  tierDefaults: Record<string, boolean>,
): boolean {
  return tierDefaults[option.key] ?? option.defaultOn;
}

/** Agent-scoped switches whose stored value differs from their default. */
export function changedOptimizationKeys(
  catalog: OptimizationCatalog,
  draft: Record<string, boolean>,
  delegationTier: string | undefined,
): string[] {
  const tierDefaults = catalog.tierDefaults[delegationTier ?? "standard"] ?? {};
  return catalog.optimizations
    .filter((o) => o.scope === "agent" && draft[o.key] !== undefined && draft[o.key] !== optimizationDefault(o, tierDefaults))
    .map((o) => o.key);
}

function defaultNote(option: OptimizationOption, tierDefaults: Record<string, boolean>, tier: string | undefined): string {
  const tierValue = tierDefaults[option.key];
  if (tierValue !== undefined && tierValue !== option.defaultOn) {
    return `Default: ${tierValue ? "on" : "off"} for ${tier ?? "this"} agents (${option.defaultOn ? "on" : "off"} for others).`;
  }
  return `Default: ${option.defaultOn ? "on" : "off"}.`;
}

export function OptimizationsSection({
  draft,
  onChange,
  canEdit,
  delegationTier,
}: {
  draft: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
  canEdit: boolean;
  delegationTier: string | undefined;
}) {
  const { catalog, loadFailed } = useOptimizationCatalog();

  if (!catalog) {
    return (
      <p className="text-[12px] text-xyne-fg-tertiary">
        {loadFailed
          ? "Couldn't load the optimization list. This agent's saved choices are unchanged."
          : "Loading optimizations…"}
      </p>
    );
  }

  const tierDefaults = catalog.tierDefaults[delegationTier ?? "standard"] ?? {};
  const byKey = new Map(catalog.optimizations.map((o) => [o.key, o]));
  const isOn = (o: OptimizationOption): boolean => draft[o.key] ?? optimizationDefault(o, tierDefaults);
  const changed = changedOptimizationKeys(catalog, draft, delegationTier);

  const set = (o: OptimizationOption, value: boolean): void => {
    const next = { ...draft };
    if (value === optimizationDefault(o, tierDefaults)) delete next[o.key];
    else next[o.key] = value;
    onChange(next);
  };
  const resetAll = (): void => {
    const next = { ...draft };
    for (const o of catalog.optimizations) if (o.scope === "agent") delete next[o.key];
    onChange(next);
  };

  const agentGroups = catalog.groups
    .map((g) => ({ ...g, options: catalog.optimizations.filter((o) => o.group === g.id && o.scope === "agent") }))
    .filter((g) => g.options.length > 0);
  const fleet = catalog.optimizations.filter((o) => o.scope === "fleet");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4 px-0.5">
        <p className="text-[12px] leading-relaxed text-xyne-fg-tertiary">
          Each switch starts at the platform default. Changing one saves it on this agent; Reset goes back to
          the default. Most of these use Jev, a fast classifier: if Jev is unavailable the agent behaves as if
          the switch were off.
        </p>
        {canEdit && changed.length > 0 && (
          <button
            type="button"
            onClick={resetAll}
            className="shrink-0 rounded-md border border-xyne-border px-2.5 py-1 text-[11px] font-medium text-xyne-fg-secondary transition-colors hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
          >
            Reset all ({changed.length})
          </button>
        )}
      </div>

      {agentGroups.map((group) => (
        <SettingGroup key={group.id} title={group.title} description={group.description}>
          {group.options.map((o) => {
            const on = isOn(o);
            const parent = o.requires ? byKey.get(o.requires) : undefined;
            const blocked = parent !== undefined && !isOn(parent);
            const overridden = changed.includes(o.key);
            return (
              <SettingRow
                key={o.key}
                title={o.label}
                summary={
                  <>
                    {o.summary}
                    {blocked && parent && (
                      <span className="mt-1 block text-[11px] text-xyne-fg-tertiary">
                        Has no effect while &ldquo;{parent.label}&rdquo; is off.
                      </span>
                    )}
                  </>
                }
                detail={`${o.detail} ${defaultNote(o, tierDefaults, delegationTier)}`}
                enabled={on && !blocked}
                control={
                  <span className="flex items-center gap-2">
                    {overridden && canEdit && (
                      <button
                        type="button"
                        onClick={() => set(o, optimizationDefault(o, tierDefaults))}
                        title={`Back to the default (${optimizationDefault(o, tierDefaults) ? "on" : "off"})`}
                        className="rounded-full bg-xyne-surface-sunken px-2 py-0.5 text-[10.5px] font-medium text-xyne-fg-secondary transition-colors hover:text-xyne-fg-primary"
                      >
                        Changed · Reset
                      </button>
                    )}
                    {overridden && !canEdit && (
                      <span className="rounded-full bg-xyne-surface-sunken px-2 py-0.5 text-[10.5px] font-medium text-xyne-fg-tertiary">
                        Changed
                      </span>
                    )}
                    <Switch
                      checked={on}
                      onChange={(v) => set(o, v)}
                      disabled={!canEdit || blocked}
                      ariaLabel={o.label}
                    />
                  </span>
                }
              />
            );
          })}
        </SettingGroup>
      ))}

      {fleet.length > 0 && (
        <SettingGroup
          title="Set fleet-wide"
          description="These run outside an agent's run (background jobs, or gates before the run starts), so they can't be switched per agent. Ops change them with the XYNE_OPT_<NAME> env flag on claw."
        >
          {fleet.map((o) => (
            <SettingRow
              key={o.key}
              title={o.label}
              summary={o.summary}
              detail={`${o.detail} Env flag: XYNE_OPT_${o.key.toUpperCase()}.`}
              control={
                <span className="text-[11px] text-xyne-fg-tertiary">
                  {o.defaultOn ? "On" : "Off"} by default
                </span>
              }
            />
          ))}
        </SettingGroup>
      )}
    </div>
  );
}

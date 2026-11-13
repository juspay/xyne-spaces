import { useEffect, useRef, useState } from 'react';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import type { BranchModel, StepSummary, TriggerSummary } from '@xyne/workflow-sdk';
import { useWorkflowClient } from './use-workflow-client.js';
import { walkStepConfigs } from '../utils/branch-detection.js';

// ─── Types ───

export interface StepMeta {
  name: string;
  category: string;
  kind: string;
  icon?: string | undefined;
  /** Control-flow steps only: drives canvas rendering (loop ring vs multi-lane fork). */
  branchModel?: BranchModel | undefined;
  /** JSON Schema from StepDescriptor.configSchema — used for branch detection + form rendering. */
  configSchema?: Record<string, unknown> | undefined;
  /** JSON Schema from StepDescriptor.outputSchema — used for schema-aware output rendering. */
  outputSchema?: Record<string, unknown> | undefined;
}

export interface TriggerMeta {
  type: string;
  name: string;
  description: string;
  category: string;
  icon?: string | undefined;
}

export interface UseStepMetadataReturn {
  /** Map of step type → metadata (name, category, icon, configSchema). */
  stepMeta: Map<string, StepMeta>;
  /** All available trigger summaries from backend. */
  triggerMeta: TriggerMeta[];
  /** True while initial metadata is loading. */
  isLoading: boolean;
}

// ─── Hook ───

/**
 * Fetches and caches StepDescriptor metadata for every step type in the config.
 * Also fetches TriggerSummary[] once for trigger metadata.
 *
 * Returns a map of step type → { name, category, icon, configSchema }.
 */
export function useStepMetadata(config: WorkflowConfig): UseStepMetadataReturn {
  const client = useWorkflowClient();
  const [stepMeta, setStepMeta] = useState<Map<string, StepMeta>>(new Map());
  const [triggerMeta, setTriggerMeta] = useState<TriggerMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Track which types we've already fetched to avoid refetching
  const fetchedTypesRef = useRef<Set<string>>(new Set());
  const triggersFetchedRef = useRef(false);

  // Fetch trigger summaries once
  useEffect(() => {
    if (triggersFetchedRef.current) return;
    triggersFetchedRef.current = true;

    void (async () => {
      try {
        const triggers: TriggerSummary[] = await client.schema.triggers();
        setTriggerMeta(triggers.map((t) => ({
          type: t.type,
          name: t.name,
          description: t.description,
          category: t.category,
          icon: t.icon,
        })));
      } catch {
        // Trigger schema unavailable
      }
    })();
  }, [client]);

  // Fetch step metadata for all types in config (including nested branches)
  useEffect(() => {
    const types = new Set<string>();
    // Schema-free walk — discovers steps no matter how they're nested
    // (LOOP body, PARALLEL branches, CONDITIONAL slots, SWITCH cases[i].steps).
    walkStepConfigs(config.steps, (s) => { types.add(s.type); });

    // Find types not yet fetched
    const newTypes: string[] = [];
    for (const type of types) {
      if (!fetchedTypesRef.current.has(type)) {
        newTypes.push(type);
        fetchedTypesRef.current.add(type);
      }
    }

    if (newTypes.length === 0) {
      setIsLoading(false);
      return;
    }

    void (async () => {
      const results = await Promise.allSettled(
        newTypes.map(async (type) => {
          const desc = await client.schema.step(type);
          return { type, desc };
        }),
      );

      setStepMeta((prev) => {
        const next = new Map(prev);
        for (const result of results) {
          if (result.status === 'fulfilled') {
            const { type, desc } = result.value;
            next.set(type, {
              name: desc.name,
              category: desc.category,
              kind: desc.kind,
              icon: desc.icon,
              branchModel: desc.branchModel,
              configSchema: desc.configSchema,
              outputSchema: desc.outputSchema,
            });
          }
        }
        return next;
      });
      setIsLoading(false);
    })();
  }, [config.steps, client]);

  // Also fetch metadata for step summaries (to get metadata for types not yet in config)
  useEffect(() => {
    void (async () => {
      try {
        const summaries: StepSummary[] = await client.schema.steps();
        setStepMeta((prev) => {
          const next = new Map(prev);
          for (const s of summaries) {
            if (!next.has(s.type)) {
              next.set(s.type, {
                name: s.name,
                category: s.category,
                kind: s.kind,
                icon: s.icon,
                branchModel: s.branchModel,
                // configSchema filled when step is actually used and descriptor fetched
              });
            }
          }
          return next;
        });
      } catch {
        // Schema unavailable
      }
    })();
  }, [client]);

  return { stepMeta, triggerMeta, isLoading };
}

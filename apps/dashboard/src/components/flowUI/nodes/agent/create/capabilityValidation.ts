/**
 * Post-bind capability validation — canvas chips are the source of truth.
 * Needed classes come from job semantics; missing chips → heal or block Create.
 */

import type { AvailableTools } from '@/services/claw/clawToolsTypes';
import {
  buildBuiltinCatalog,
} from '@/routes/AIScreen/library/shared/pickers/builtin/builtinCatalog';
import { buildMcpCatalog } from '@/routes/AIScreen/library/shared/pickers/mcp/mcpCatalog';
import type { AgentCreateFormState } from './types.ts';
import {
  inferNeededCapabilities,
  softProductNeedles,
  type CapabilityClass,
} from './capabilityInference.ts';
import { matchNamedMcpEntries } from './hubCatalogSelect.ts';

export interface CapabilityValidationResult {
  needed: CapabilityClass[];
  missing: CapabilityClass[];
  /** Missing classes that the catalog cannot satisfy — honest miss, do not block Create. */
  catalogMiss: CapabilityClass[];
  /** Missing classes the catalog could fill — heal or block Create. */
  healable: CapabilityClass[];
  ok: boolean;
}

function formHasMcp(form: AgentCreateFormState): boolean {
  return (form.tools.direct?.length ?? 0) > 0 || (form.tools.gateway?.length ?? 0) > 0;
}

function formHasBuiltin(form: AgentCreateFormState): boolean {
  return (form.tools.custom?.length ?? 0) > 0;
}

function formHasSubagent(form: AgentCreateFormState): boolean {
  return (form.tools.subagents?.length ?? 0) > 0;
}

function formHasSkills(form: AgentCreateFormState): boolean {
  return form.selectedSkillIds.length > 0;
}

function formHasKnowledge(form: AgentCreateFormState): boolean {
  return form.selectedKbResources.length > 0;
}

export function canvasHasCapability(
  form: AgentCreateFormState,
  cls: CapabilityClass,
): boolean {
  switch (cls) {
    case 'mcp':
      return formHasMcp(form);
    case 'builtin':
      return formHasBuiltin(form);
    case 'subagent':
      return formHasSubagent(form);
    case 'skills':
      return formHasSkills(form);
    case 'knowledge':
      return formHasKnowledge(form);
    default:
      return false;
  }
}

/** Whether the org catalog has any selectable row for this class (intent-aware for MCP). */
export function catalogCanSatisfy(
  cls: CapabilityClass,
  catalog: AvailableTools | null,
  intent: string,
  options?: { skillCount?: number; knowledgeCount?: number },
): boolean {
  if (!catalog && cls !== 'skills' && cls !== 'knowledge') return false;
  switch (cls) {
    case 'mcp': {
      if (!catalog) return false;
      const named = matchNamedMcpEntries(intent, catalog);
      if (named.length > 0) return true;
      const needles = softProductNeedles(intent);
      if (needles.length === 0) {
        // Generic MCP job (post/send) — any selectable MCP/gateway counts.
        return buildMcpCatalog(catalog, []).some(entry => entry.selectable);
      }
      const mcpCatalog = buildMcpCatalog(catalog, []);
      const hayNeedles = needles.map(n => n.toLowerCase().replace(/[^a-z0-9]+/g, ''));
      return mcpCatalog.some(entry => {
        if (!entry.selectable) return false;
        const hay = `${entry.slug} ${entry.label}`.toLowerCase().replace(/[^a-z0-9]+/g, '');
        return hayNeedles.some(needle => needle && hay.includes(needle));
      });
    }
    case 'builtin':
      return Boolean(catalog && buildBuiltinCatalog(catalog).some(entry => entry.tools.length > 0));
    case 'subagent':
      return Boolean(catalog && catalog.subagents.length > 0);
    case 'skills':
      return (options?.skillCount ?? 0) > 0;
    case 'knowledge':
      return (options?.knowledgeCount ?? 0) > 0;
    default:
      return false;
  }
}

/**
 * Validate canvas hubs against job-inferred needs.
 * `intent` should be user text + name/description/instructions when available.
 */
export function validateCanvasCapabilities(args: {
  intent: string;
  form: AgentCreateFormState;
  catalog?: AvailableTools | null;
  skillCount?: number;
  knowledgeCount?: number;
}): CapabilityValidationResult {
  const needed = inferNeededCapabilities(args.intent);
  const missing = needed.filter(cls => !canvasHasCapability(args.form, cls));
  const catalogMiss: CapabilityClass[] = [];
  const healable: CapabilityClass[] = [];
  for (const cls of missing) {
    if (
      catalogCanSatisfy(cls, args.catalog ?? null, args.intent, {
        skillCount: args.skillCount,
        knowledgeCount: args.knowledgeCount,
      })
    ) {
      healable.push(cls);
    } else {
      catalogMiss.push(cls);
    }
  }
  return {
    needed,
    missing,
    catalogMiss,
    healable,
    ok: healable.length === 0,
  };
}

/** Job text used for inference + validation (user intent + canvas identity). */
export function jobIntentFromForm(
  userIntent: string,
  form: Pick<AgentCreateFormState, 'name' | 'description' | 'systemPrompt'>,
): string {
  return [userIntent.trim(), form.name.trim(), form.description.trim(), form.systemPrompt.trim()]
    .filter(Boolean)
    .join('\n');
}

export function capabilityGapMessage(result: CapabilityValidationResult): string | null {
  if (result.healable.length === 0 && result.catalogMiss.length === 0) return null;
  if (result.healable.length > 0) {
    const labels = result.healable.join(', ');
    return `Create blocked — canvas is missing required hubs (${labels}). Retry drafting or pick them on the canvas.`;
  }
  const labels = result.catalogMiss.join(', ');
  return `Couldn't bind ${labels} — nothing matching in the catalog. You can still create, or connect those integrations first.`;
}

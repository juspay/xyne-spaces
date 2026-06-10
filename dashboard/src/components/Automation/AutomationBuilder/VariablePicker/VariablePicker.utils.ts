import type { JsonSchema } from '../../Automation.types';
import {
  detectEntityKindFromPath,
  followAnyOf,
  resolveSchema,
} from '../SchemaForm/SchemaForm.utils';
import type {
  VariableEntry,
  VariablePickerSource,
  VariablePickerSourceRole,
} from './VariablePicker.types';

export function pickerEntrySortKey(path: string): [number, string] {
  return [path ? path.split('.').length : 0, path];
}

const PREFERRED_PATHS_BY_KIND: Record<string, string[]> = {
  conversation: ['ticket.conversationId', 'email.conversationId'],
};

export function findSoleMatchingVariable(
  sources: VariablePickerSource[],
  targetEntityKind: string | null | undefined,
  targetLeafType?: string | null,
): VariableEntry | null {
  const accept = (entry: VariableEntry): boolean => {
    if (targetEntityKind) return entry.entityKind === targetEntityKind;
    if (targetLeafType) {
      return entry.leafType === targetLeafType || entry.leafType.includes(targetLeafType);
    }
    return true;
  };

  const matches: VariableEntry[] = [];
  for (const source of sources) {
    for (const entry of flattenSource(source)) {
      if (accept(entry)) matches.push(entry);
    }
  }

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!;

  if (targetEntityKind) {
    const preferred = PREFERRED_PATHS_BY_KIND[targetEntityKind] ?? [];
    for (const path of preferred) {
      const hit = matches.find(m => m.path === path);
      if (hit) return hit;
    }
    const sourceKeys = new Set(matches.map(m => `${m.sourceKey}:${m.role}`));
    if (sourceKeys.size === 1) return matches[0]!;
  }
  return null;
}

export function flattenSource(source: VariablePickerSource): VariableEntry[] {
  const root = resolveSchema(source.schema);
  const entries: VariableEntry[] = [];
  walk(root, '', entries, source);
  entries.sort((a, b) => {
    const ka = pickerEntrySortKey(a.path);
    const kb = pickerEntrySortKey(b.path);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    return ka[1].localeCompare(kb[1]);
  });
  return entries;
}

function walk(
  schema: JsonSchema,
  pathSoFar: string,
  out: VariableEntry[],
  source: VariablePickerSource,
): void {
  const resolved = followAnyOf(resolveSchema(schema));

  if (resolved.type === 'object' && resolved.properties) {
    for (const [key, child] of Object.entries(resolved.properties)) {
      const nextPath = pathSoFar ? `${pathSoFar}.${key}` : key;
      walk(child, nextPath, out, source);
    }
    return;
  }

  if (pathSoFar.length === 0) return;

  const entityKind = detectEntityKindFromPath(pathSoFar);

  out.push({
    sourceKey: source.sourceKey,
    role: source.role,
    path: pathSoFar,
    label: `${source.groupLabel} / ${source.role === 'trigger' ? '' : `${source.role} / `}${pathSoFar.replace(/\./g, ' / ')}`,
    leafType: leafTypeLabel(resolved),
    reference: buildReference(source.sourceKey, source.role, pathSoFar),
    entityKind,
  });
}

function leafTypeLabel(schema: JsonSchema): string {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return 'enum';
  if (schema.type === 'array') return 'array';
  if (schema.type) return schema.type;
  if (schema.anyOf && schema.anyOf.length > 0) {
    return schema.anyOf
      .map(s => s.type ?? 'any')
      .filter(t => t !== 'null')
      .join(' | ');
  }
  return 'any';
}

export function buildReference(
  sourceKey: string,
  role: VariablePickerSourceRole,
  path: string,
): string {
  if (role === 'trigger') return `{{${sourceKey}.${path}}}`;
  return `{{${sourceKey}.${role}.${path}}}`;
}

export function parseReference(
  ref: string,
): { sourceKey: string; role: VariablePickerSourceRole; path: string } | null {
  const match = /^\{\{(?:context\.)?([^.}]+)(?:\.([^}]+))?\}\}$/.exec(ref);
  if (!match) return null;
  const sourceKey = match[1] ?? '';
  const tail = match[2] ?? '';

  if (sourceKey === 'trigger') {
    return { sourceKey, role: 'trigger', path: tail };
  }

  if (tail.startsWith('input.')) {
    return { sourceKey, role: 'input', path: tail.slice('input.'.length) };
  }
  if (tail.startsWith('output.')) {
    return { sourceKey, role: 'output', path: tail.slice('output.'.length) };
  }
  if (tail === 'input') return { sourceKey, role: 'input', path: '' };
  if (tail === 'output') return { sourceKey, role: 'output', path: '' };

  return { sourceKey, role: 'output', path: tail };
}

export function formatReferenceLabel(ref: string, sources: VariablePickerSource[]): string {
  const parsed = parseReference(ref);
  if (!parsed) return ref;
  const source = sources.find(s => s.sourceKey === parsed.sourceKey && s.role === parsed.role);
  const fallback = sources.find(s => s.sourceKey === parsed.sourceKey);
  const groupLabel = source?.groupLabel ?? fallback?.groupLabel ?? parsed.sourceKey;
  const roleLabel = parsed.role === 'trigger' ? '' : ` / ${parsed.role}`;
  if (!parsed.path) return `${groupLabel}${roleLabel}`;
  return `${groupLabel}${roleLabel} / ${parsed.path.replace(/\./g, ' / ')}`;
}

import { z } from 'zod';

function isMeaningfulFilterValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return false;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return true;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return false;
}

export function requireScopeFilter<T extends object>(
  scopeFields?: readonly string[],
): (cfg: T, ctx: z.RefinementCtx) => void {
  return (cfg, ctx) => {
    const record = cfg as Record<string, unknown>;
    const scoped = scopeFields
      ? scopeFields.some((field) => isMeaningfulFilterValue(record[field]))
      : Object.values(record).some(isMeaningfulFilterValue);
    if (scoped) return;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: scopeFields
        ? `Scope this workflow by at least one of: ${scopeFields.join(', ')} — so it does not fire on every event.`
        : 'Add at least one filter so the workflow does not fire on every event.',
    });
  };
}

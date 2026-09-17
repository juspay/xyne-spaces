import { z } from 'zod';

// Dashboard-level runtime configuration, stored as JSON on dashboards.config.
// Drives the time-range picker, auto-refresh dropdown, and variable bar in
// the UI. Validated server-side on every write to defend against malformed
// or oversized JSON (the column is TEXT so a misbehaving client could push
// MB of junk otherwise).

const RELATIVE_RANGE_VALUES = [
  'now-1h',
  'now-24h',
  'now-7d',
  'now-30d',
  'now-90d',
  'now-1y',
] as const;
export const RelativeRangeSchema = z.enum(RELATIVE_RANGE_VALUES);
export type RelativeRange = z.infer<typeof RelativeRangeSchema>;

// Either a relative-range token OR explicit ISO from/to.
export const DashboardTimeRangeSchema = z
  .object({
    relative: RelativeRangeSchema.optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .refine(
    v => v.relative !== undefined || (v.from !== undefined && v.to !== undefined),
    { message: 'timeRange must set either `relative` or both `from`/`to`' },
  );
export type DashboardTimeRange = z.infer<typeof DashboardTimeRangeSchema>;

// Static-list variable definition. Names are referenced as ${name} in
// queryPlan.where leaves; the resolver substitutes at execute time.
export const DashboardVariableDefSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    // Letters, digits, underscore; must start with letter or underscore.
    // Same charset accepted in ${name} substitution to keep round-tripping safe.
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  label: z.string().min(1).max(120),
  type: z.literal('list'),
  // Cap options to avoid pathological JSON blobs.
  options: z.array(z.string().max(256)).max(200),
  multi: z.boolean().optional(),
  defaultValue: z
    .union([z.string().max(256), z.array(z.string().max(256)).max(200), z.null()])
    .optional(),
});
export type DashboardVariableDef = z.infer<typeof DashboardVariableDefSchema>;

export const DashboardVariableStateSchema = z.object({
  current: z
    .union([z.string().max(256), z.array(z.string().max(256)).max(200), z.null()])
    .optional()
    .default(null),
});
export type DashboardVariableState = z.infer<typeof DashboardVariableStateSchema>;

// Allowed auto-refresh intervals (ms). Caps prevent setting absurd values
// that would hammer the customer's DB.
const ALLOWED_AUTO_REFRESH = [
  null,
  5_000,
  30_000,
  60_000,
  5 * 60_000,
  15 * 60_000,
] as const;

export const DashboardConfigSchema = z
  .object({
    timeRange: DashboardTimeRangeSchema.nullable().optional(),
    autoRefreshMs: z
      .number()
      .int()
      .nullable()
      .refine(
        v => v === null || ALLOWED_AUTO_REFRESH.includes(v as never),
        {
          message:
            'autoRefreshMs must be one of: null, 5000, 30000, 60000, 300000, 900000',
        },
      )
      .optional(),
    variables: z.array(DashboardVariableDefSchema).max(40).optional(),
    variableValues: z
      .record(z.string(), DashboardVariableStateSchema)
      .optional(),
  })
  .strict();
export type DashboardConfig = z.infer<typeof DashboardConfigSchema>;

// Parse + validate a JSON string from dashboards.config. Returns the
// parsed config OR throws a friendly error the mutator surfaces back to
// the client. Empty / missing string → empty config object.
export function parseDashboardConfig(raw: string | null | undefined): DashboardConfig {
  if (!raw) return {};
  // Belt-and-suspenders: cap raw size before parsing so an attacker
  // can't OOM the server with a 100MB JSON blob.
  if (raw.length > 64 * 1024) {
    throw new Error('Dashboard config exceeds 64 KB limit');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Dashboard config is not valid JSON');
  }
  const result = DashboardConfigSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join('.') || '<root>';
    throw new Error(
      `Dashboard config invalid: ${path} — ${first?.message ?? 'unknown issue'}`,
    );
  }
  return result.data;
}

// Same as parseDashboardConfig but takes the already-parsed object.
// Useful in mutators where we want to validate before stringifying.
export function validateDashboardConfig(value: unknown): DashboardConfig {
  const result = DashboardConfigSchema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join('.') || '<root>';
    throw new Error(
      `Dashboard config invalid: ${path} — ${first?.message ?? 'unknown issue'}`,
    );
  }
  return result.data;
}

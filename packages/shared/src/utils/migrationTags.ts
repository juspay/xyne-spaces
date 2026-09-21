// Source of truth for the `tags` field on xyne_release_migration_form and the picker.
export const MIGRATION_TAGS = [
  {
    value: 'backward-compatible',
    label: 'Backward compatible',
    description: 'Code already deployed keeps working against the new schema',
  },
  {
    value: 'breaking',
    label: 'Breaking',
    description: 'Old code fails against the new schema — deploy app + migration together',
  },
  {
    value: 'data-backfill',
    label: 'Data backfill',
    description: 'Rewrites existing rows, not just DDL',
  },
  {
    value: 'downtime',
    label: 'Needs downtime',
    description: 'Takes a table lock or needs a maintenance window',
  },
  {
    value: 'long-running',
    label: 'Long-running',
    description: 'Large table or index build — run off-peak',
  },
  {
    value: 'irreversible',
    label: 'Irreversible',
    description: 'Drops or truncates — no safe rollback',
  },
  {
    value: 'manual-step',
    label: 'Manual step',
    description: 'Needs an operator action before or after deploy',
  },
  // Per zero.rocicorp.dev/docs/schema#schema-changes.
  {
    value: 'zero-expand',
    label: 'Zero: expand',
    description:
      'Adds a column/table Zero syncs — let zero-cache replicate (and backfill) before deploying API/client',
  },
  {
    value: 'zero-contract',
    label: 'Zero: contract',
    description:
      'Drops/renames/retypes a synced column or table — deploy client → API first or live clients hit onUpdateNeeded',
  },
  {
    value: 'zero-unsafe',
    label: 'Zero: halts replication',
    description: 'Synced table without a primary key or unique index — zero-cache cannot replicate it',
  },
] as const;

export type MigrationTag = (typeof MIGRATION_TAGS)[number]['value'];

export const MIGRATION_TAG_EXCLUSIVE: ReadonlyArray<readonly [MigrationTag, MigrationTag]> = [
  ['backward-compatible', 'breaking'],
];

const KNOWN = new Set<string>(MIGRATION_TAGS.map(t => t.value));

export const isMigrationTag = (value: unknown): value is MigrationTag =>
  typeof value === 'string' && KNOWN.has(value);

export function parseMigrationTags(raw: unknown): MigrationTag[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      list = [];
    }
  }
  return Array.isArray(list) ? [...new Set(list.filter(isMigrationTag))] : [];
}

export function toggleMigrationTag(current: readonly MigrationTag[], tag: MigrationTag): MigrationTag[] {
  if (current.includes(tag)) return current.filter(t => t !== tag);
  const conflicts = MIGRATION_TAG_EXCLUSIVE.flatMap(([a, b]) => (a === tag ? [b] : b === tag ? [a] : []));
  return [...current.filter(t => !conflicts.includes(t)), tag];
}

// Paren-aware comma split: numeric(10,2) stays whole.
const splitActions = (text: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};

// enum→text / varchar→text widenings are not retypes (same readers, same Zero `string`).
const STRING_TYPES = /^(text|varchar|character\s+varying|char|character|citext|uuid)\b/;
const isNonStringRetype = (lower: string): boolean => {
  const m = /\balter\s+column\s+\S+\s+(?:set\s+data\s+)?type\s+([a-z_][a-z0-9_ ]*)/.exec(lower);
  return !!m && !STRING_TYPES.test(m[1].trim());
};

// Risk-only: never suggests `backward-compatible`. Per statement / per ALTER action.
type Rule = (lower: string, ctx: { table: string | null; createdHere: ReadonlySet<string> }) => boolean;
const SUGGESTION_RULES: ReadonlyArray<{ tag: MigrationTag; test: Rule }> = [
  { tag: 'irreversible', test: s => /\b(drop\s+(table|column)|truncate)\b/.test(s) },
  {
    tag: 'breaking',
    test: s => {
      if (/\b(drop\s+(table|column)|rename\s+(column|to))\b/.test(s)) return true;
      if (isNonStringRetype(s)) return true;
      const alter = /^alter\s+table\s+\S+\s+(.*)$/s.exec(s);
      return !!alter && splitActions(alter[1]).some(a => /^add\s+(column\s+)?\S+.*\bnot\s+null\b/.test(a) && !/\bdefault\b/.test(a));
    },
  },
  {
    tag: 'long-running',
    test: (s, { table, createdHere }) =>
      !(table && createdHere.has(table)) &&
      ((/\bcreate\s+(unique\s+)?index\b/.test(s) && !/\bconcurrently\b/.test(s)) ||
        (/\badd\s+constraint\b[^;]*\b(foreign\s+key|check)\b/.test(s) && !/\bnot\s+valid\b/.test(s))),
  },
  {
    tag: 'data-backfill',
    test: s => /^\s*(update|delete\s+from)\b/.test(s) || /^\s*insert\s+into\b.*\bselect\b/.test(s),
  },
  { tag: 'downtime', test: s => /\block\s+table\b/.test(s) },
];

const targetTable = (lower: string): string | null => {
  const m =
    /^(?:alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?|create\s+(?:unique\s+)?index\s+.*?\bon\s+(?:only\s+)?|create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?)((?:"[^"]+"|[a-z_][a-z0-9_]*)(?:\.(?:"[^"]+"|[a-z_][a-z0-9_]*))?)/s.exec(lower);
  if (!m) return null;
  const parts = m[1].split('.');
  return parts[parts.length - 1].replace(/"/g, '');
};

export type MigrationFinding = { tag: MigrationTag; evidence: string };

export type MigrationAnalysisOptions = {
  // Zero rules run only when given.
  zeroTables?: ReadonlySet<string>;
};

const EVIDENCE_MAX = 120;

// ponytail: repo-slug match; upgrade path is a per-application "usesZero" flag.
export const isZeroBackedRepo = (repoUrl: string | null | undefined): boolean =>
  /\/xyne-spaces(-private)?(\.git)?\/?$/i.test(repoUrl ?? '');

const IDENT = String.raw`(?:"([^"]+)"|([a-z_][a-z0-9_]*))`;
const QUALIFIED = new RegExp(String.raw`^(?:${IDENT}\.)?${IDENT}`, 'i');
const parseTableRef = (raw: string): { schema: string; table: string } | null => {
  const m = QUALIFIED.exec(raw.trim());
  if (!m) return null;
  const schema = (m[1] ?? m[2] ?? 'public').toLowerCase();
  const table = (m[3] ?? m[4] ?? '').toLowerCase();
  return table ? { schema, table } : null;
};

const ALTER_TABLE = /^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?((?:"[^"]+"|[a-z_][a-z0-9_]*)(?:\.(?:"[^"]+"|[a-z_][a-z0-9_]*))?)\s+(.*)$/is;
const CREATE_TABLE = /^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:"[^"]+"|[a-z_][a-z0-9_]*)(?:\.(?:"[^"]+"|[a-z_][a-z0-9_]*))?)\s*\((.*)\)\s*$/is;
const DROP_TABLE = /^drop\s+table\s+(?:if\s+exists\s+)?((?:"[^"]+"|[a-z_][a-z0-9_]*)(?:\.(?:"[^"]+"|[a-z_][a-z0-9_]*))?)/i;
const CREATE_UNIQUE_INDEX = /^create\s+unique\s+index\s+.*?\bon\s+(?:only\s+)?((?:"[^"]+"|[a-z_][a-z0-9_]*)(?:\.(?:"[^"]+"|[a-z_][a-z0-9_]*))?)/is;

const CONTRACT_ACTION = /^(drop\s+column|rename\s+(column|to)\b)/i;
// ADD [COLUMN] only — constraints/keys don't change the row shape.
const EXPAND_ACTION = /^add\s+(?:column\s+)?(?!constraint\b|primary\b|unique\b|foreign\b|check\b|exclude\b)/i;
const DROP_PK = /^drop\s+constraint\s+(?:if\s+exists\s+)?"?[a-z0-9_]*_pkey"?/i;
const ADD_PK = /add\s+(constraint\s+\S+\s+)?primary\s+key/i;

function analyzeZeroImpact(statements: string[], zeroTables: ReadonlySet<string>): MigrationFinding[] {
  const out: MigrationFinding[] = [];
  const push = (tag: MigrationTag, stmt: string): void => {
    const evidence = stmt.length > EVIDENCE_MAX ? `${stmt.slice(0, EVIDENCE_MAX)}…` : stmt;
    if (!out.some(f => f.tag === tag && f.evidence === evidence)) out.push({ tag, evidence });
  };
  const keyed = new Set<string>();
  const created: Array<{ table: string; stmt: string }> = [];
  const pkDropped: Array<{ table: string; stmt: string }> = [];

  for (const stmt of statements) {
    const create = CREATE_TABLE.exec(stmt);
    if (create) {
      const ref = parseTableRef(create[1]);
      if (!ref || ref.schema !== 'public') continue;
      if (/\bprimary\s+key\b/i.test(create[2]) || /\bunique\b/i.test(create[2])) keyed.add(ref.table);
      created.push({ table: ref.table, stmt });
      push('zero-expand', stmt);
      continue;
    }
    const uniq = CREATE_UNIQUE_INDEX.exec(stmt);
    if (uniq) {
      const ref = parseTableRef(uniq[1]);
      if (ref) keyed.add(ref.table);
      continue;
    }
    const drop = DROP_TABLE.exec(stmt);
    if (drop) {
      const ref = parseTableRef(drop[1]);
      if (ref && ref.schema === 'public' && zeroTables.has(ref.table)) push('zero-contract', stmt);
      continue;
    }
    const alter = ALTER_TABLE.exec(stmt);
    if (!alter) continue;
    const ref = parseTableRef(alter[1]);
    if (!ref || ref.schema !== 'public') continue;
    const action = alter[2].trim();
    if (ADD_PK.test(action)) keyed.add(ref.table);
    if (!zeroTables.has(ref.table) && !created.some(c => c.table === ref.table)) continue;
    const actions = splitActions(action);
    if (actions.some(a => DROP_PK.test(a))) pkDropped.push({ table: ref.table, stmt });
    if (actions.some(a => ADD_PK.test(a))) keyed.add(ref.table);
    if (actions.some(a => CONTRACT_ACTION.test(a) || isNonStringRetype(a.toLowerCase()))) push('zero-contract', stmt);
    else if (actions.some(a => EXPAND_ACTION.test(a))) push('zero-expand', stmt);
  }
  // No key anywhere in the file → zero-cache can't sync it.
  for (const c of [...created, ...pkDropped]) {
    if (!keyed.has(c.table)) push('zero-unsafe', c.stmt);
  }
  return out;
}

export function analyzeMigrationSql(
  sql: string,
  options: MigrationAnalysisOptions = {},
): MigrationFinding[] {
  const statements = sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map(stmt => stmt.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const lowered = statements.map(stmt => stmt.toLowerCase());
  const createdHere = new Set<string>();
  for (const lower of lowered) {
    if (/^create\s+(unlogged\s+)?table\b/.test(lower)) {
      const t = targetTable(lower);
      if (t) createdHere.add(t);
    }
  }
  const out: MigrationFinding[] = [];
  statements.forEach((stmt, i) => {
    const lower = lowered[i];
    const ctx = { table: targetTable(lower), createdHere };
    for (const { tag, test } of SUGGESTION_RULES) {
      if (!test(lower, ctx)) continue;
      const evidence = stmt.length > EVIDENCE_MAX ? `${stmt.slice(0, EVIDENCE_MAX)}…` : stmt;
      if (!out.some(f => f.tag === tag && f.evidence === evidence)) out.push({ tag, evidence });
    }
  });
  if (options.zeroTables) out.push(...analyzeZeroImpact(statements, options.zeroTables));
  return out;
}

export function suggestMigrationTags(sql: string, options: MigrationAnalysisOptions = {}): MigrationTag[] {
  return [...new Set(analyzeMigrationSql(sql, options).map(f => f.tag))];
}

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
export type MigrationFinding = { tag: MigrationTag; evidence: string };

const KNOWN = new Set<string>(MIGRATION_TAGS.map(t => t.value));
const isTag = (value: unknown): value is MigrationTag =>
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
  return Array.isArray(list) ? [...new Set(list.filter(isTag))] : [];
}

const OPPOSITE: Partial<Record<MigrationTag, MigrationTag>> = {
  'backward-compatible': 'breaking',
  breaking: 'backward-compatible',
};

export function toggleMigrationTag(current: readonly MigrationTag[], tag: MigrationTag): MigrationTag[] {
  if (current.includes(tag)) return current.filter(t => t !== tag);
  return [...current.filter(t => t !== OPPOSITE[tag]), tag];
}

// ponytail: repo-slug match; upgrade path is a per-application "usesZero" flag.
export const isZeroBackedRepo = (repoUrl: string | null | undefined): boolean =>
  /\/xyne-spaces(-private)?(\.git)?\/?$/i.test(repoUrl ?? '');

// ---- SQL parsing ---------------------------------------------------------
// One qualified table reference ("schema"."table" / schema.table / table).
const REF = String.raw`(?:"[^"]+"|[a-z_][a-z0-9_]*)(?:\.(?:"[^"]+"|[a-z_][a-z0-9_]*))?`;
const rx = (source: string): RegExp => new RegExp(source, 'is');

const ALTER_TABLE = rx(String.raw`^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${REF})\s+(.*)$`);
const CREATE_TABLE = rx(
  String.raw`^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(${REF})\s*(?:\((.*)\))?`,
);
const DROP_TABLE = rx(String.raw`^drop\s+table\s+(?:if\s+exists\s+)?(${REF})`);
const CREATE_INDEX = rx(String.raw`^create\s+(?:unique\s+)?index\s+.*?\bon\s+(?:only\s+)?(${REF})`);
const IS_UNIQUE_INDEX = /^create\s+unique\s+index\b/i;

const parseRef = (raw: string): { schema: string; table: string } => {
  // Quoted parts first so a dot inside quotes doesn't split the reference.
  const parts = (raw.trim().match(/"[^"]+"|[^.]+/g) ?? []).map(p =>
    p.replace(/^"|"$/g, '').toLowerCase(),
  );
  return { schema: parts.length > 1 ? parts[0] : 'public', table: parts[parts.length - 1] ?? '' };
};

const tableOf = (stmt: string): string | null => {
  const m = ALTER_TABLE.exec(stmt) ?? CREATE_TABLE.exec(stmt) ?? CREATE_INDEX.exec(stmt);
  return m ? parseRef(m[1]).table : null;
};

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

const EVIDENCE_MAX = 120;
const addFinding = (out: MigrationFinding[], tag: MigrationTag, stmt: string): void => {
  const evidence = stmt.length > EVIDENCE_MAX ? `${stmt.slice(0, EVIDENCE_MAX)}…` : stmt;
  if (!out.some(f => f.tag === tag && f.evidence === evidence)) out.push({ tag, evidence });
};

// ---- rules ---------------------------------------------------------------
// Risk-only: never suggests `backward-compatible`. Per statement / per ALTER action.
type Rule = (lower: string, ctx: { table: string | null; createdHere: ReadonlySet<string> }) => boolean;
const RULES: ReadonlyArray<{ tag: MigrationTag; test: Rule }> = [
  { tag: 'irreversible', test: s => /\b(drop\s+(table|column)|truncate)\b/.test(s) },
  {
    tag: 'breaking',
    test: s => {
      if (/\b(drop\s+(table|column)|rename\s+(column|to))\b/.test(s)) return true;
      if (isNonStringRetype(s)) return true;
      const alter = ALTER_TABLE.exec(s);
      return (
        !!alter &&
        splitActions(alter[2]).some(
          a => /^add\s+(column\s+)?\S+.*\bnot\s+null\b/.test(a) && !/\bdefault\b/.test(a),
        )
      );
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

const CONTRACT_ACTION = /^(drop\s+column|rename\s+(column|to)\b)/i;
// ADD [COLUMN] only — constraints/keys don't change the row shape.
const EXPAND_ACTION = /^add\s+(?:column\s+)?(?!constraint\b|primary\b|unique\b|foreign\b|check\b|exclude\b)/i;
const DROP_PK = /^drop\s+constraint\s+(?:if\s+exists\s+)?"?[a-z0-9_]*_pkey"?/i;
const ADD_PK = /add\s+(constraint\s+\S+\s+)?primary\s+key/i;

function analyzeZeroImpact(
  statements: string[],
  zeroTables: ReadonlySet<string>,
  out: MigrationFinding[],
): void {
  const keyed = new Set<string>();
  const created = new Set<string>();
  // Tables that must end the file with a key, or zero-cache cannot replicate them.
  const needsKey: Array<{ table: string; stmt: string }> = [];

  for (const stmt of statements) {
    const create = CREATE_TABLE.exec(stmt);
    if (create) {
      const { schema, table } = parseRef(create[1]);
      if (schema !== 'public') continue;
      if (/\b(primary\s+key|unique)\b/i.test(create[2] ?? '')) keyed.add(table);
      created.add(table);
      needsKey.push({ table, stmt });
      addFinding(out, 'zero-expand', stmt);
      continue;
    }
    const index = CREATE_INDEX.exec(stmt);
    if (index) {
      if (IS_UNIQUE_INDEX.test(stmt)) keyed.add(parseRef(index[1]).table);
      continue;
    }
    const drop = DROP_TABLE.exec(stmt);
    if (drop) {
      const { schema, table } = parseRef(drop[1]);
      if (schema === 'public' && zeroTables.has(table)) addFinding(out, 'zero-contract', stmt);
      continue;
    }
    const alter = ALTER_TABLE.exec(stmt);
    if (!alter) continue;
    const { schema, table } = parseRef(alter[1]);
    if (schema !== 'public') continue;
    const actions = splitActions(alter[2].trim());
    if (actions.some(a => ADD_PK.test(a))) keyed.add(table);
    if (!zeroTables.has(table) && !created.has(table)) continue;
    if (actions.some(a => DROP_PK.test(a))) needsKey.push({ table, stmt });
    if (actions.some(a => CONTRACT_ACTION.test(a) || isNonStringRetype(a.toLowerCase())))
      addFinding(out, 'zero-contract', stmt);
    else if (actions.some(a => EXPAND_ACTION.test(a))) addFinding(out, 'zero-expand', stmt);
  }

  for (const { table, stmt } of needsKey) if (!keyed.has(table)) addFinding(out, 'zero-unsafe', stmt);
}

// `zeroTables` opts into the Zero rules — pass it only for a Zero-backed repo.
export function analyzeMigrationSql(sql: string, zeroTables?: ReadonlySet<string>): MigrationFinding[] {
  const statements = sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map(stmt => stmt.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const createdHere = new Set(
    statements.flatMap(stmt => {
      const create = CREATE_TABLE.exec(stmt);
      return create ? [parseRef(create[1]).table] : [];
    }),
  );

  const out: MigrationFinding[] = [];
  for (const stmt of statements) {
    const lower = stmt.toLowerCase();
    const ctx = { table: tableOf(lower), createdHere };
    for (const { tag, test } of RULES) if (test(lower, ctx)) addFinding(out, tag, stmt);
  }
  if (zeroTables) analyzeZeroImpact(statements, zeroTables, out);
  return out;
}

export function suggestMigrationTags(sql: string, zeroTables?: ReadonlySet<string>): MigrationTag[] {
  return [...new Set(analyzeMigrationSql(sql, zeroTables).map(f => f.tag))];
}

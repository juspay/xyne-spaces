#!/usr/bin/env node
/**
 * Keeps three things in step:
 *
 *   1. nothing outside the schema reads process.env — everything goes through `config`
 *   2. every variable the schema knows about is declared there
 *   3. every declared variable appears in .env.example
 *
 * The schema ends in `.unknown()`, so an undeclared variable is not an error at
 * runtime — it simply passes through unvalidated and undocumented. That is how 84
 * of them accumulated, several holding credentials. This check is what stops the
 * gap reopening, since nothing else notices.
 *
 * Deliberately a script and not an eslint rule: `no-process-env` bans the read,
 * which would flag all ~120 legitimate call sites and env.ts itself. What matters
 * is that the variable is declared, not where it is read from.
 *
 * Exit code 1 on any failure, with the offending names.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = join(BACKEND, 'src/config/env.ts');
const EXAMPLE = join(BACKEND, '.env.example');

// Set by the platform rather than by us, so they are exempt from both directions.
const AMBIENT = new Set(['NODE_ENV', 'PORT', 'HOME', 'PATH', 'PWD', 'TZ', 'CI']);

const schemaSrc = readFileSync(SCHEMA, 'utf8');
const declared = new Set(
  [...schemaSrc.matchAll(/^ {2}([A-Z][A-Z0-9_]{2,}):\s*Joi\./gm)].map((m) => m[1]),
);

const files = execFileSync('git', ['ls-files', 'src'], { cwd: BACKEND, encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.d.ts'));

/** @type {Map<string, string[]>} */
const read = new Map();
for (const rel of files) {
  const body = readFileSync(join(BACKEND, rel), 'utf8');
  const re = /process\.env(?:\.([A-Z][A-Z0-9_]{2,})|\[['"]([A-Z][A-Z0-9_]{2,})['"]\])/g;
  for (const m of body.matchAll(re)) {
    const key = m[1] ?? m[2];
    if (!read.has(key)) read.set(key, []);
    if (!read.get(key).includes(rel)) read.get(key).push(rel);
  }
}

// A commented-out entry counts as documented. Keys whose unset state is
// meaningful — ORG_MEMBER_LIMIT means "no cap", FORCE_LOGOUT_BEFORE means "never"
// — are written `# KEY=sample` so the file explains them without setting them,
// and the schema rejects them empty. That is documentation, not an omission.
const inExample = new Set(
  readFileSync(EXAMPLE, 'utf8')
    .split('\n')
    .map((l) => l.match(/^\s*#?\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
    .filter(Boolean),
);

const failures = [];

// Reading process.env outside the schema means bypassing coercion and defaults —
// the raw string, with a local fallback that drifts from the declared one. These
// are the only places allowed to touch it, each for a reason that config cannot serve.
const DIRECT_ACCESS_ALLOWED = new Map([
  ['src/config/env.ts', 'the schema itself — the one place that reads the environment'],
  ['src/test/setup.ts', 'test bootstrap; sets variables before the schema is imported'],
  [
    'src/bots/unified/execution/external-runtime.ts',
    'the key is chosen at runtime from a bot definition (externalApi.authEnvVar)',
  ],
  ['src/utils/retry.ts', 'the key is a caller-supplied argument'],
  [
    'src/sdlc/vcs/GitHubVcsAdapter.ts',
    'passes the whole environment to a git child process; reads no value itself',
  ],
]);

const offenders = files
  .filter((f) => !DIRECT_ACCESS_ALLOWED.has(f))
  .map((f) => {
    const hits = readFileSync(join(BACKEND, f), 'utf8')
      .split('\n')
      .map((line, i) => ({ line: line.trim(), no: i + 1 }))
      .filter(({ line }) => /process\.env\b/.test(line) && !line.startsWith('//') && !line.startsWith('*'));
    return { f, hits };
  })
  .filter(({ hits }) => hits.length);

if (offenders.length) {
  failures.push(
    `${offenders.reduce((n, o) => n + o.hits.length, 0)} direct process.env access(es) outside the schema:\n` +
      offenders
        .map(({ f, hits }) => hits.map((h) => `    ${f}:${h.no}  ${h.line.slice(0, 80)}`).join('\n'))
        .join('\n') +
      '\n\n  Read it through `config` instead — the value is already coerced, defaulted\n' +
      '  and validated there. If the key genuinely is not known until runtime, add the\n' +
      '  file to DIRECT_ACCESS_ALLOWED in this script with the reason.',
  );
}

const undeclared = [...read.keys()].filter((k) => !declared.has(k) && !AMBIENT.has(k)).sort();
if (undeclared.length) {
  failures.push(
    `${undeclared.length} variable(s) read from process.env but not declared in src/config/env.ts:\n` +
      undeclared.map((k) => `    ${k}\n        ${read.get(k).slice(0, 3).join(', ')}`).join('\n') +
      '\n\n  Add each to the Joi schema with the default its reader already applies.',
  );
}

const undocumented = [...declared].filter((k) => !inExample.has(k) && !AMBIENT.has(k)).sort();
if (undocumented.length) {
  failures.push(
    `${undocumented.length} variable(s) declared in the schema but absent from .env.example:\n` +
      undocumented.map((k) => `    ${k}`).join('\n') +
      '\n\n  Add each with a placeholder — never a real value. Keys whose "unset" state is\n' +
      '  meaningful should be added commented out, as ORG_MEMBER_LIMIT is.',
  );
}

if (failures.length) {
  console.error('\n✖ env schema check failed\n');
  for (const f of failures) console.error('  ' + f + '\n');
  process.exit(1);
}

console.log(
  `✓ env check: ${declared.size} declared, ${inExample.size} documented, ` +
    `${DIRECT_ACCESS_ALLOWED.size} files allowed direct process.env access — all in step`,
);

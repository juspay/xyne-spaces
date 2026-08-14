#!/usr/bin/env node
/**
 * Keeps three things in step:
 *
 *   1. every variable the service reads off process.env is declared in the Joi schema
 *   2. every declared variable appears in .env.example
 *   3. .env.example still validates against the schema
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
  `✓ env schema check: ${declared.size} declared, ${read.size} read from process.env, ` +
    `${inExample.size} in .env.example — all in step`,
);

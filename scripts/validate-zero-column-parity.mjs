#!/usr/bin/env node
// Zero <> Prisma column-parity guard.
//
// `packages/shared/src/zero/schema.ts` is the schema the Zero client imports.
// It is hand-maintained, so a column can be added to it that `schema.prisma`
// (and therefore the database) does not have. The client then asks the replica
// for a column that is not there — a runtime Zero schema mismatch. Every column
// in the shared schema must exist in schema.prisma.
//
// The reverse is fine and common: a Prisma column the client does not declare
// is simply never synced, so it is not checked.
//
// schema.prisma is read directly: every model carries @@map, and the shared
// schema keys columns by Prisma field name, so no generated artifact is needed.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRISMA_SCHEMA = resolve(REPO_ROOT, "apps/backend/prisma/schema.prisma");
const SHARED_SCHEMA = resolve(REPO_ROOT, "packages/shared/src/zero/schema.ts");

// "<table>.<column>" pairs intentionally in the shared schema with no DB
// backing. Every entry weakens the guard — keep it empty without a reason.
const CLIENT_ONLY_ALLOWLIST = new Set([]);

const args = process.argv.slice(2);
const CI_MODE = args.includes("--ci-mode");
// Read the index rather than the working tree, so a pre-commit run validates
// exactly what is being committed.
const STAGED = args.includes("--staged");

const useColor = !CI_MODE && process.stdout.isTTY;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const logInfo = (s) => console.log(`${c("1;34", "ℹ️ ")} ${s}`);
const logOk = (s) => console.log(`${c("1;32", "✅")} ${s}`);
const logErr = (s) => console.log(`${c("1;31", "❌")} ${s}`);

// Blank out /* ... */ while preserving line structure, so line-oriented parsing
// below is unaffected by block comments.
function stripBlockComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

function stripLineComment(line) {
  return line.replace(/\/\/.*$/, "").trim();
}

// schema.prisma -> Map<sqlTableName, Set<fieldName>>. Relation fields (typed by
// a model name) are not columns and are skipped.
export function parsePrismaSchema(rawSrc) {
  const src = stripBlockComments(rawSrc);
  const modelNames = new Set(
    [...src.matchAll(/^model\s+([A-Za-z0-9_]+)\s*\{/gm)].map((m) => m[1]),
  );

  const tables = new Map();
  let model = null;
  let fields = null;
  let mapped = null;

  for (const rawLine of src.split("\n")) {
    const line = stripLineComment(rawLine);
    if (!line) continue;

    const start = line.match(/^model\s+([A-Za-z0-9_]+)\s*\{$/);
    if (start) {
      model = start[1];
      fields = new Set();
      mapped = null;
      continue;
    }
    if (!model) continue;

    if (line === "}") {
      if (!mapped) throw new Error(`model ${model} has no @@map(...)`);
      tables.set(mapped, fields);
      model = null;
      continue;
    }

    const map = line.match(/^@@map\("([^"]+)"\)$/);
    if (map) {
      mapped = map[1];
      continue;
    }
    if (line.startsWith("@@")) continue;

    const field = line.match(
      /^([A-Za-z0-9_]+)\s+(Unsupported\("[^"]*"\)|[A-Za-z0-9_]+)(\[\])?(\?)?(\s.*)?$/,
    );
    if (!field) throw new Error(`unparsed line in model ${model}: ${line}`);
    if (!modelNames.has(field[2])) fields.add(field[1]);
  }

  return tables;
}

// packages/shared/src/zero/schema.ts -> Map<sqlTableName, Set<columnName>>.
export function parseZeroSchema(rawSrc) {
  const src = stripBlockComments(rawSrc);
  const tables = new Map();

  const tableRe =
    /table\(\s*["'`]([^"'`]+)["'`]\s*\)\s*(?:\/\/[^\n]*\n\s*)?\.columns\(\{([\s\S]*?)\}\)/g;
  // name: type<Generic>()[.from('db_col')][.optional()] — only the name matters.
  const colRe =
    /^([A-Za-z0-9_]+)\s*:\s*[A-Za-z0-9_]+\s*(?:<.*>)?\s*\(\s*\)\s*(?:\.from\([^)]*\)\s*)?(?:\.optional\(\)\s*)?,?$/;

  let m;
  while ((m = tableRe.exec(src)) !== null) {
    const [, sqlName, body] = m;
    const columns = new Set();

    for (const rawLine of body.split("\n")) {
      const line = stripLineComment(rawLine);
      if (!line) continue;

      const cm = line.match(colRe);
      if (!cm) throw new Error(`unparsed column in "${sqlName}": ${line}`);
      columns.add(cm[1]);
    }
    tables.set(sqlName, columns);
  }

  // A table the regex silently skipped would read as "clean", so assert every
  // definition was parsed.
  const defined = (src.match(/\btable\(\s*["'`]/g) ?? []).length;
  if (defined !== tables.size) {
    throw new Error(
      `parsed ${tables.size} of ${defined} table definitions — parser is out of date with the schema`,
    );
  }

  return tables;
}

// Every column in the shared schema must exist in schema.prisma.
export function diffSchemas(prisma, shared, allowlist = CLIENT_ONLY_ALLOWLIST) {
  const problems = [];

  for (const [table, sharedCols] of shared) {
    const prismaCols = prisma.get(table);
    if (!prismaCols) {
      problems.push({
        table,
        detail: `table "${table}" is in the shared client schema but no Prisma model maps to it.`,
      });
      continue;
    }
    for (const col of sharedCols) {
      if (prismaCols.has(col) || allowlist.has(`${table}.${col}`)) continue;
      problems.push({
        table,
        detail: `column "${col}" is in the shared schema but not in schema.prisma.`,
      });
    }
  }

  return problems;
}

function readSchema(absPath) {
  if (!STAGED) return readFileSync(absPath, "utf8");
  try {
    return execFileSync("git", ["show", `:${relative(REPO_ROOT, absPath)}`], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return readFileSync(absPath, "utf8"); // untracked — fall back to disk
  }
}

function main() {
  for (const [label, p] of [
    ["Prisma", PRISMA_SCHEMA],
    ["shared Zero", SHARED_SCHEMA],
  ]) {
    if (!existsSync(p)) {
      logErr(`${label} schema not found at ${p} — cannot validate parity.`);
      process.exit(1);
    }
  }

  logInfo(
    "Checking Zero column parity (shared client schema vs schema.prisma)...",
  );

  let problems;
  let checked;
  try {
    const prisma = parsePrismaSchema(readSchema(PRISMA_SCHEMA));
    const shared = parseZeroSchema(readSchema(SHARED_SCHEMA));
    problems = diffSchemas(prisma, shared);
    checked = shared.size;
  } catch (err) {
    logErr(`Could not parse a schema — ${err.message}`);
    process.exit(1);
  }

  if (problems.length > 0) {
    logErr(`Zero <> Prisma schema mismatch — ${problems.length} issue(s):`);
    const byTable = new Map();
    for (const p of problems) {
      if (!byTable.has(p.table)) byTable.set(p.table, []);
      byTable.get(p.table).push(p);
    }
    for (const [table, list] of byTable) {
      console.log(`\n  Table "${table}":`);
      for (const it of list) console.log(`    - ${it.detail}`);
    }
    console.log(
      "\nschema.prisma is the source of truth — fix the shared Zero schema to match.\n",
    );
    process.exit(1);
  }

  logOk(`Zero column parity passed — ${checked} shared table(s) checked.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

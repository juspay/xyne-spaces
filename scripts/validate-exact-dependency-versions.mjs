#!/usr/bin/env node
// Exact-version guard for package.json.
//
// A range ("^1.2.3", "~1.2.3", ">=1", "*", "latest", "4") lets a fresh resolve
// pick up a release nobody reviewed — and not every install uses the lockfile
// (some Dockerfiles run --no-frozen-lockfile). Every dependency a package.json
// declares must therefore be an exact version.
//
// Checked:  dependencies, devDependencies, optionalDependencies.
// Allowed:  exact semver ("1.2.3", "1.2.3-rc.1"), "npm:<name>@<exact>" aliases,
//           and local specs ("workspace:", "link:", "file:") — nothing to pin.
// Skipped:  peerDependencies. A peer range states what a consumer must provide,
//           it does not choose what we install, so pinning it would be wrong.
//
// Stateless: it checks the current content, not a diff, so there is no baseline
// to maintain. There is NO escape hatch — pin the version.
//
// Usage:
//   scripts/validate-exact-dependency-versions.mjs           # staged package.json files (pre-commit)
//   scripts/validate-exact-dependency-versions.mjs --ci      # every tracked package.json
//
// Exit: 0 clean · 1 violation · 2 usage error.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SECTIONS = ["dependencies", "devDependencies", "optionalDependencies"];
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const LOCAL = /^(workspace:|link:|file:)/;

const args = process.argv.slice(2);
const CI_MODE = args.includes("--ci");
const unknown = args.filter((a) => a !== "--ci");
if (unknown.length) {
  console.error(`❌ exact-version guard: unknown argument '${unknown[0]}'`);
  process.exit(2);
}

const git = (...a) =>
  execFileSync("git", a, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// Vite's dep cache and anything outside version control are not ours to police.
const isManifest = (f) => /(^|\/)package\.json$/.test(f) && !f.includes("/.vite/");

const files = (CI_MODE ? git("ls-files") : git("diff", "--cached", "--name-only", "--diff-filter=ACMR"))
  .split("\n")
  .filter(isManifest);

if (files.length === 0) {
  console.log("⏭️  exact-version guard: no package.json files to check");
  process.exit(0);
}

const isExact = (spec) => {
  if (EXACT.test(spec) || LOCAL.test(spec)) return true;
  // alias: npm:<name>@<exact> — the version part must itself be exact.
  const alias = /^npm:(?:@[^/@]+\/)?[^/@]+@(.+)$/.exec(spec);
  return alias ? EXACT.test(alias[1]) : false;
};

const violations = [];
for (const file of files) {
  let manifest;
  try {
    // Staged mode reads the index so the check sees exactly what would be committed.
    manifest = JSON.parse(CI_MODE ? readFileSync(resolve(REPO_ROOT, file), "utf8") : git("show", `:${file}`));
  } catch (e) {
    console.error(`❌ exact-version guard: cannot parse ${file}: ${e.message}`);
    process.exit(1);
  }
  for (const section of SECTIONS) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
      if (typeof spec !== "string" || !isExact(spec)) {
        violations.push({ file, section, name, spec });
      }
    }
  }
}

if (violations.length === 0) {
  console.log(`✅ exact-version guard: ${files.length} package.json file(s) use exact versions only.`);
  process.exit(0);
}

console.error("");
console.error(`❌ ${violations.length} dependency version(s) are not pinned to an exact version:`);
for (const v of violations) {
  console.error(`   ${v.file}  ${v.section}  ${v.name}: ${JSON.stringify(v.spec)}`);
}
console.error("");
console.error("   Write the exact version (e.g. \"1.2.3\"), not a range (\"^1.2.3\", \"~1.2.3\", \">=1\", \"*\", \"latest\").");
console.error("   `pnpm add --save-exact <pkg>` does this for you; for an existing entry use the version in the lockfile.");
console.error("   peerDependencies are exempt.");
process.exit(1);

#!/usr/bin/env node
/**
 * Copy each app's .env.example to the filename that app actually reads.
 *
 * Never overwrites an existing file, so it is safe to re-run against a working tree.
 * Called by `pnpm run bootstrap` before secret generation, which needs
 * apps/backend/.env.local to exist.
 *
 * start-services.sh also creates three of these on demand; the dashboard's is created
 * nowhere else, and doing it here keeps the whole step visible in one place rather than
 * as a side effect of starting containers.
 */
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// The backend and dashboard read `.env.local` (via `dotenv -e .env.local`), while
// xyne-claw and claw-auth read `.env` (via `tsx --env-file=.env`). This asymmetry is
// deliberate — copy to the filename shown, not a uniform one.
const ENV_FILES = [
  ["apps/backend/.env.example", "apps/backend/.env.local"],
  ["apps/dashboard/.env.example", "apps/dashboard/.env.local"],
  ["apps/xyne-claw/.env.example", "apps/xyne-claw/.env"],
  ["apps/xyne-claw-auth/backend/.env.example", "apps/xyne-claw-auth/backend/.env"],
];

let created = 0;
let missing = 0;

for (const [example, target] of ENV_FILES) {
  const examplePath = join(repoRoot, example);
  const targetPath = join(repoRoot, target);

  if (existsSync(targetPath)) {
    console.log(`Kept ${target} (already exists)`);
    continue;
  }
  if (!existsSync(examplePath)) {
    console.warn(`Skipped ${target} — ${example} not found`);
    missing++;
    continue;
  }

  copyFileSync(examplePath, targetPath);
  console.log(`Created ${target}`);
  created++;
}

console.log(`\n${created} env file(s) created, ${ENV_FILES.length - created - missing} already present.`);
if (created > 0) {
  console.log("Review the new files and fill in any values you need (OAuth creds, API keys).");
}

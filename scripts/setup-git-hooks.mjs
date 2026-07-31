#!/usr/bin/env node
/**
 * Installs Husky and guarantees the repo's git hooks actually run for EVERY user.
 *
 * Runs automatically on `pnpm install` via the root "prepare" script.
 *
 * Why this exists
 * ---------------
 * Husky installs its hooks under `.husky/_` and expects git's `core.hooksPath`
 * to point there. But some machines set `core.hooksPath` GLOBALLY (e.g. the
 * corporate GitGuardian install at /etc/git-guardian/hooks). A global
 * `core.hooksPath` OVERRIDES Husky entirely — git looks only at that directory
 * and silently ignores `.husky/`, so the pre-commit gitleaks secret scan (and
 * every other pre-commit check) never runs.
 *
 * This script:
 *   1. Runs `husky` to (re)generate `.husky/_`.
 *   2. If a global/system `core.hooksPath` is shadowing Husky, sets a
 *      repo-LOCAL `core.hooksPath=.husky/_` so this repo's hooks win here,
 *      without touching the user's global config or other repos.
 *
 * Idempotent and safe to run repeatedly. Never fails `pnpm install`: any error
 * is downgraded to a warning so a hook-setup hiccup can't block development.
 */
import { execFileSync } from "node:child_process";

const HUSKY_PATH = ".husky/_";

function git(args, opts = {}) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function warn(msg) {
  console.warn(`⚠️  setup-git-hooks: ${msg}`);
}

try {
  // Not a git checkout (e.g. installed as a dependency / tarball) — nothing to do.
  if (tryGit(["rev-parse", "--is-inside-work-tree"]) !== "true") {
    process.exit(0);
  }

  // 1. Let Husky generate .husky/_ . `npx husky` resolves the locally installed
  //    binary. If Husky isn't present we still fall through to step 2.
  try {
    execFileSync("npx", ["husky"], { stdio: "inherit" });
  } catch {
    warn("`husky` did not run (is it installed?) — continuing to hooksPath check.");
  }

  // 2. Detect whether a GLOBAL/SYSTEM core.hooksPath is shadowing Husky.
  //    A repo-local value is fine and means we've already fixed this before.
  const localHooksPath = tryGit(["config", "--local", "--get", "core.hooksPath"]);
  const effectiveHooksPath = tryGit(["config", "--get", "core.hooksPath"]);

  const shadowedByGlobal =
    effectiveHooksPath && effectiveHooksPath !== HUSKY_PATH && !localHooksPath;

  if (shadowedByGlobal) {
    git(["config", "--local", "core.hooksPath", HUSKY_PATH]);
    console.log(
      `✅ setup-git-hooks: a global core.hooksPath (${effectiveHooksPath}) was shadowing Husky;` +
        ` set repo-local core.hooksPath=${HUSKY_PATH} so this repo's hooks (gitleaks secret scan, etc.) run.`
    );
  } else if (!effectiveHooksPath) {
    // No override anywhere. Husky's own install already wired .git/hooks, but
    // pin the local value too so behaviour is identical to the shadowed case.
    git(["config", "--local", "core.hooksPath", HUSKY_PATH]);
  }
  // else: local value already correct — nothing to do.
} catch (err) {
  // Never break `pnpm install` over hook setup.
  warn(`could not finish hook setup: ${err?.message ?? err}`);
  process.exit(0);
}

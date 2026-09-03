export interface WikiChangedFile {
  status: string;
  paths: string[];
}

export type WikiExcludedPathKind = "test" | "generated" | "lockfile";

export interface WikiCommitRelevance {
  provableNoop: boolean;
  reason: "TEST_ONLY" | "GENERATED_ONLY" | "LOCKFILE_ONLY" | "MIXED_EXCLUDED_ONLY" | null;
}

const LOCKFILES = new Set([
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "composer.lock",
  "flake.lock",
  "gemfile.lock",
  "go.sum",
  "package-lock.json",
  "packages.lock.json",
  "pnpm-lock.yaml",
  "poetry.lock",
  "uv.lock",
  "yarn.lock",
]);

function normalizedPath(path: string): string {
  return path.replaceAll("\\", "/").toLowerCase();
}

export function wikiExcludedPathKind(path: string): WikiExcludedPathKind | null {
  const normalized = normalizedPath(path);
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);

  if (LOCKFILES.has(basename)) return "lockfile";
  if (
    /(^|\/)(dist|build|coverage|generated|vendor|node_modules)(\/|$)/.test(normalized) ||
    /(?:\.generated|\.gen|_generated)(?:\.[^/]+)?$/.test(normalized)
  ) {
    return "generated";
  }
  if (
    /(^|\/)(test|tests|__tests__|fixtures|snapshots)(\/|$)/.test(normalized) ||
    /(?:\.test|\.spec|_test)\.[^/]+$/.test(normalized) ||
    normalized.endsWith(".snap")
  ) {
    return "test";
  }
  return null;
}

export function classifyWikiCommitRelevance(files: WikiChangedFile[]): WikiCommitRelevance {
  const kinds = new Set<WikiExcludedPathKind>();
  let pathCount = 0;
  for (const file of files) {
    for (const path of file.paths) {
      pathCount += 1;
      const kind = wikiExcludedPathKind(path);
      if (!kind) return { provableNoop: false, reason: null };
      kinds.add(kind);
    }
  }
  if (pathCount === 0) return { provableNoop: false, reason: null };
  if (kinds.size > 1) return { provableNoop: true, reason: "MIXED_EXCLUDED_ONLY" };
  const [kind] = kinds;
  const reason = kind === "test" ? "TEST_ONLY" : kind === "generated" ? "GENERATED_ONLY" : "LOCKFILE_ONLY";
  return { provableNoop: true, reason };
}

export function parseWikiNameStatus(output: string): WikiChangedFile[] {
  const files: WikiChangedFile[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const [status, ...paths] = line.split("\t");
    if (!status || paths.length === 0) continue;
    files.push({ status, paths });
  }
  return files;
}

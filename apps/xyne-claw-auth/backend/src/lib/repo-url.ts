export function normalizeRepoUrl(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^git\+/, "");
  const scp = s.match(/^[^/@\s]+@([^:/\s]+):(.+)$/);
  if (scp) s = `${scp[1]}/${scp[2]}`;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.replace(/^[^/@]+@/, "");
  s = s.replace(/[?#].*$/, "");
  const slash = s.indexOf("/");
  if (slash <= 0) return null;
  const host = s.slice(0, slash).replace(/:\d+$/, "").replace(/^(ssh|www)\./, "");
  let path = s.slice(slash + 1).replace(/\/+$/, "").replace(/\.git$/, "");
  const browse = path.match(/^projects\/([^/]+)\/repos\/([^/]+)/);
  if (browse) path = `${browse[1]}/${browse[2]}`;
  path = path.replace(/^scm\//, "");
  const tree = path.match(/^([^/]+\/[^/]+)\/(?:tree|blob|src|browse|pull|pulls|-)(?:\/.*)?$/);
  if (tree?.[1]) path = tree[1];
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return `${host}/${parts.join("/")}`;
}

export function findSandboxKeys(configs: Record<string, { repoUrl?: string }>, repoUrl: string): string[] {
  const wanted = normalizeRepoUrl(repoUrl);
  if (!wanted) return [];
  return Object.entries(configs)
    .filter(([, config]) => typeof config.repoUrl === "string" && normalizeRepoUrl(config.repoUrl) === wanted)
    .map(([key]) => key)
    .sort();
}

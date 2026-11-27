import { normalizeRepoUrl } from "../tools/sandbox/repo-url.js";

/** Thrown when a list cannot be built or signed. Never thrown for a bad token: verification returns a reason instead. */
export class GitScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitScopeError";
  }
}

export const GIT_SCOPE_MAX_REPO_LENGTH = 512;
const MAX_HOST_LENGTH = 253;

const HOST_LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOST_RE = new RegExp(`^${HOST_LABEL}(?:\\.${HOST_LABEL})*$`);
const SEGMENT_RE = /^[a-z0-9._~-]+$/;
const NOT_PRINTABLE_ASCII_RE = /[^\x21-\x7e]/;

/**
 * The host of a list entry: lower-case DNS labels, and already in the form
 * normalizeRepoUrl gives (so no leading "ssh." or "www.", no port).
 */
export function isCanonicalGitScopeHost(host: unknown): host is string {
  if (typeof host !== "string" || host.length === 0 || host.length > MAX_HOST_LENGTH || !HOST_RE.test(host)) return false;
  return normalizeRepoUrl(`${host}/x/y`) === `${host}/x/y`;
}

/**
 * A list entry's `repo`: `host/segment/segment[/segment…]` that normalizeRepoUrl
 * returns unchanged. Requests are reduced to the same form, so an entry and a
 * request name the same repository exactly when the two strings are equal.
 */
export function isCanonicalGitScopeRepo(repo: unknown): repo is string {
  if (typeof repo !== "string" || repo.length === 0 || repo.length > GIT_SCOPE_MAX_REPO_LENGTH) return false;
  const [host, ...segments] = repo.split("/");
  if (!isCanonicalGitScopeHost(host) || segments.length < 2) return false;
  for (const segment of segments) {
    if (!SEGMENT_RE.test(segment) || segment === "." || segment === "..") return false;
  }
  return normalizeRepoUrl(repo) === repo;
}

/** The part of a sandbox profile (RepoSetupConfig) that names its repositories. */
export interface GitScopeProfileRepos {
  /** Used only to name the profile in an error. */
  readonly slug?: string | undefined;
  readonly repoUrl?: string | undefined;
  readonly auxRepos?: readonly { readonly name?: string | undefined; readonly url: string }[] | undefined;
}

/**
 * The repositories of a profile: `repoUrl` plus every `auxRepos[].url`, each as
 * its canonical `host/path`, without repeats, sorted.
 *
 * Throws GitScopeError when an address cannot be reduced to a canonical entry:
 * a profile must not silently lose a repository. The error names the field,
 * not the address, because an address can carry a credential.
 */
export function gitScopeReposForProfile(config: GitScopeProfileRepos): string[] {
  const profile = typeof config.slug === "string" && config.slug ? `profile "${config.slug}"` : "profile";
  const repos = new Set<string>();

  const add = (address: unknown, field: string): void => {
    // Printable ASCII only: lower-casing turns a few other characters (the Kelvin sign) into ASCII letters.
    const usable = typeof address === "string" && !NOT_PRINTABLE_ASCII_RE.test(address.trim());
    const repo = usable ? normalizeRepoUrl(address) : null;
    if (repo === null) {
      throw new GitScopeError(`${profile}: ${field} is not a repository address that can be reduced to host/path`);
    }
    if (!isCanonicalGitScopeRepo(repo)) {
      throw new GitScopeError(
        `${profile}: ${field} reduces to a form a git scope cannot carry (a lower-case host, then two or more path segments of a-z 0-9 . _ ~ -)`,
      );
    }
    repos.add(repo);
  };

  const main: unknown = config.repoUrl;
  const noMainRepo = main === undefined || main === null || (typeof main === "string" && main.trim() === "");
  if (!noMainRepo) add(main, "repoUrl");

  const aux: unknown = config.auxRepos;
  if (aux !== undefined && aux !== null) {
    if (!Array.isArray(aux)) throw new GitScopeError(`${profile}: auxRepos is not a list`);
    aux.forEach((entry: unknown, index: number) => {
      const record = entry !== null && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const name = typeof record["name"] === "string" && record["name"] ? ` ("${record["name"]}")` : "";
      add(record["url"], `auxRepos[${index}]${name}.url`);
    });
  }

  return [...repos].sort();
}

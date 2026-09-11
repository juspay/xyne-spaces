// Pre-flight repo connection check for the release-config wizard's "Test"
// button — verifies the repo URL parses, the token has access, and the VCS
// provider matches, before the user fills out the Applications form.

import { config } from '@/config/env';
import { parseGitHubRepoUrl, parseBitbucketRepoUrl } from '@/utils/repoUrlParser';
import { normalizeBitbucketApiBaseUrl } from '@/services/release/buildVcsClient';
import { VCSProviderType } from '@xyne/shared';

// Bound outbound VCS calls.
const API_TIMEOUT_MS = 30_000;

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  /** Set on success — useful for the UI to display "Connected: owner/repo (main)". */
  repoFullName?: string;
  defaultBranch?: string;
}

/**
 * Cheap pre-flight check for the wizard: verify the repo URL parses, the
 * token has access, and the VCS provider matches. One round-trip per provider.
 * Distinguishes 401 (bad token), 404 (wrong URL / wrong provider), and 5xx
 * (transient) so the UI can show actionable error text.
 */
export async function testRepoConnection(opts: {
  repoUrl: string;
  vcsProvider: VCSProviderType;
}): Promise<ConnectionTestResult> {
  const { repoUrl, vcsProvider } = opts;

  if (vcsProvider === VCSProviderType.GITHUB) {
    const parsed = parseGitHubRepoUrl(repoUrl);
    if (!parsed) {
      return { ok: false, message: `URL doesn't look like a GitHub repo URL` };
    }
    const token = config.github?.token;
    const apiUrl = config.github?.apiUrl ?? 'https://api.github.com';
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const resp = await fetch(
      `${apiUrl}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`,
      { headers, signal: AbortSignal.timeout(API_TIMEOUT_MS) },
    );
    if (resp.ok) {
      const json = (await resp.json()) as { full_name: string; default_branch: string };
      return {
        ok: true,
        message: `Connected to ${json.full_name}`,
        repoFullName: json.full_name,
        defaultBranch: json.default_branch,
      };
    }
    if (resp.status === 401) {
      return { ok: false, message: 'GitHub rejected the auth token — check GITHUB_TOKEN' };
    }
    if (resp.status === 403) {
      return { ok: false, message: 'GitHub access forbidden — token may be missing repo scope or hitting rate limits' };
    }
    if (resp.status === 404) {
      return {
        ok: false,
        message: `Repo not found at ${parsed.owner}/${parsed.repo}. Check the URL or — if it's private — that the token has access.`,
      };
    }
    return { ok: false, message: `GitHub returned HTTP ${resp.status}` };
  }

  if (vcsProvider === VCSProviderType.BITBUCKET_SERVER) {
    const parsed = parseBitbucketRepoUrl(repoUrl);
    if (!parsed) {
      return { ok: false, message: `URL doesn't look like a Bitbucket Server repo URL` };
    }
    const baseUrl = normalizeBitbucketApiBaseUrl(config.bitbucket.baseUrl);
    const headers: Record<string, string> = {};
    if (config.bitbucket.apiToken) {
      headers.Authorization = `Bearer ${config.bitbucket.apiToken}`;
    } else if (config.bitbucket.apiUsername && config.bitbucket.password) {
      const basic = Buffer.from(
        `${config.bitbucket.apiUsername}:${config.bitbucket.password}`,
      ).toString('base64');
      headers.Authorization = `Basic ${basic}`;
    }
    const resp = await fetch(
      `${baseUrl}/projects/${encodeURIComponent(parsed.projectKey)}/repos/${encodeURIComponent(parsed.repoSlug)}`,
      { headers, signal: AbortSignal.timeout(API_TIMEOUT_MS) },
    );
    if (resp.ok) {
      const json = (await resp.json()) as { name?: string; slug?: string };
      return {
        ok: true,
        message: `Connected to ${parsed.projectKey}/${json.slug ?? parsed.repoSlug}`,
        repoFullName: `${parsed.projectKey}/${json.slug ?? parsed.repoSlug}`,
      };
    }
    if (resp.status === 401) {
      return { ok: false, message: 'Bitbucket rejected the auth — check credentials' };
    }
    if (resp.status === 404) {
      return {
        ok: false,
        message: `Repo not found at ${parsed.projectKey}/${parsed.repoSlug}. Check the URL or — if it's restricted — that your credentials have access.`,
      };
    }
    return { ok: false, message: `Bitbucket returned HTTP ${resp.status}` };
  }

  return { ok: false, message: `Provider not supported: ${vcsProvider}` };
}

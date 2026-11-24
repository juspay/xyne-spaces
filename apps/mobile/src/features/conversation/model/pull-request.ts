import {
  MESSAGE_CARD_FRAME_PADDING,
  PULL_REQUEST_INNER_GAP,
  PULL_REQUEST_INNER_PADDING,
  PULL_REQUEST_META_LINE_HEIGHT,
  PULL_REQUEST_TITLE_LINE_HEIGHT,
  PULL_REQUEST_TITLE_MAX_LINES,
} from '../constants';

/** A GitHub pull request named by its link. */
export type PullRequestRef = { owner: string; repo: string; number: number };

export type PullRequestCardModel = {
  title: string;
  /** "#5621 · owner/repo" under the title. */
  subtitle: string;
};

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);
const PULL_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/;

/**
 * GitHub's page title for a pull request: "Title by author · Pull Request
 * #12 · owner/repo". The card shows the number and repo itself, so only the
 * title is kept.
 */
const GITHUB_TITLE_SUFFIX = /(?:\s+by\s+[^·]+?)?\s+·\s+Pull Request\s+#\d+\s+·\s+\S+$/;
/** What GitHub serves a signed-out fetch of a private repository's page. */
const GITHUB_PLACEHOLDER_TITLE = /^(?:GitHub|Sign in to GitHub(?:\s+·\s+GitHub)?)$/i;

/** The pull request a link points at (any tab of it), or null for any other link. */
export function parsePullRequestUrl(url: string): PullRequestRef | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!GITHUB_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  const match = PULL_PATH.exec(parsed.pathname);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

/**
 * The card's words from the link preview. Until the page's metadata arrives
 * (or when it never does, as for a private repository) the preview's title is
 * only the host or GitHub's sign-in page, so the card names the pull request
 * by number instead.
 */
export function pullRequestCardModel(
  ref: PullRequestRef,
  preview: { title: string; host: string },
): PullRequestCardModel {
  const cleaned = preview.title.replace(GITHUB_TITLE_SUFFIX, '').trim();
  const isPlaceholder =
    !cleaned || cleaned === preview.host || GITHUB_PLACEHOLDER_TITLE.test(cleaned);
  return {
    title: isPlaceholder ? `Pull request #${ref.number}` : cleaned,
    subtitle: `#${ref.number} · ${ref.owner}/${ref.repo}`,
  };
}

/** The card's height with a title of `titleLines` lines (at most two). */
export function pullRequestCardHeight(titleLines: number): number {
  const lines = Math.min(PULL_REQUEST_TITLE_MAX_LINES, Math.max(1, titleLines));
  return (
    (MESSAGE_CARD_FRAME_PADDING + PULL_REQUEST_INNER_PADDING) * 2 +
    lines * PULL_REQUEST_TITLE_LINE_HEIGHT +
    PULL_REQUEST_INNER_GAP +
    PULL_REQUEST_META_LINE_HEIGHT
  );
}

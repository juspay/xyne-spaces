import { sdlcSectionForCanvas } from '@xyne/shared';
import { db } from '@/database/client';
import { AppError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';

/**
 * Links in SDLC artifacts an agent writes. The agent marks every link and the server builds the URL:
 * - `[path]()`, `[path:10-42]()`: a file, or lines of it, in the artifact's repository; `@sha` at the end, as in
 *   `[path:10-42@abc1234]()`, pins that commit instead of the artifact's revision.
 * - `[commit abc1234]()`: a commit.
 * - `[Any text](canvas:<canvasId>)`: another artifact in this hub, by the id the list and create tools return.
 * Nothing unmarked is ever turned into a link, and anything that cannot be resolved rejects the write.
 */

/** The repository and revision (a commit, or a branch for artifacts that follow one) code links point at. */
export interface SdlcCodeTarget {
  url: string;
  ref: string;
}

interface CodeLinks {
  file: (path: string, from?: string, to?: string, ref?: string) => string;
  commit: (sha: string) => string;
  /** A URL into this repository's code or commits, which the agent must write as a marker instead. */
  isCode: (href: string) => boolean;
}

/** URL builders for the hosts we know; null keeps code references as text. */
export function codeLinks(target: SdlcCodeTarget): CodeLinks | null {
  let url: URL;
  try {
    url = new URL(target.url);
  } catch {
    return null;
  }
  const parts = url.pathname
    .replace(/\.git$/, '')
    .split('/')
    .filter(Boolean);
  const encode = (path: string): string => path.split('/').map(encodeURIComponent).join('/');
  const at = (ref?: string): string => encodeURIComponent(ref ?? target.ref);
  if (url.hostname === 'github.com' && parts.length === 2) {
    const repo = `${url.origin}/${parts.join('/')}`;
    return {
      isCode: (href) =>
        /^\/(?:blob|tree|commit|blame)\//.test(href.slice(repo.length)) &&
        href.startsWith(`${repo}/`),
      // GitHub redirects a folder's blob link to its tree.
      file: (path, from, to, ref) =>
        `${repo}/blob/${at(ref)}/${encode(path)}${from ? `#L${from}${to ? `-L${to}` : ''}` : ''}`,
      commit: (sha) => `${repo}/commit/${sha}`,
    };
  }
  // Bitbucket Server clone links read /scm/<project>/<repo>.
  if (parts.length === 3 && parts[0] === 'scm') {
    const repo = `${url.origin}/projects/${parts[1]!.toUpperCase()}/repos/${parts[2]}`;
    return {
      isCode: (href) => href.startsWith(`${repo}/browse`) || href.startsWith(`${repo}/commits/`),
      file: (path, from, to, ref) =>
        `${repo}/browse/${encode(path)}?at=${at(ref)}${from ? `#${from}${to ? `-${to}` : ''}` : ''}`,
      commit: (sha) => `${repo}/commits/${sha}`,
    };
  }
  return null;
}

// Link text may hold one level of brackets, as in "src/pages/[id].js".
const LABEL = String.raw`((?:[^\[\]\n]|\[[^\[\]\n]*\])+)`;
const CODE_MARKER = new RegExp(String.raw`\[${LABEL}\]\(\)`, 'g');
const CANVAS_MARKER = new RegExp(String.raw`\[${LABEL}\]\(canvas:([A-Za-z0-9_-]+)\)`, 'g');
const ANY_LINK = new RegExp(String.raw`\[${LABEL}\]\(([^)\s]+)\)`, 'g');
const FENCE = /^(?:```|~~~)/;
// path, path:10 or path:10-42, each with an optional @sha.
const FILE_LABEL = /^(\S+?)(?::(\d+)(?:-(\d+))?)?(?:@([0-9a-f]{7,40}))?$/i;
// The italic lines form earlier pages hold, as the canvas exports it: [path ](url)*[10-42](url)*.
const LINES_LINK = new RegExp(
  String.raw`\[${LABEL} \]\((https?:[^)\s]+)\)\*\[(\d+(?:-\d+)?)\]\(\2\)\*`,
  'g'
);

// One link per reference: BlockNote splits a styled part into a second <a>, and its link popup covers only the first.
function codeLink(label: string, links: CodeLinks): string | null {
  const commit = /^commit ([0-9a-f]{7,40})$/i.exec(label);
  if (commit) return `[${label}](${links.commit(commit[1]!.toLowerCase())})`;
  const file = FILE_LABEL.exec(label);
  if (!file) return null;
  const [, path, from, to, sha] = file;
  const text = `${path}${from ? `:${from}${to ? `-${to}` : ''}` : ''}`;
  return `[${text}](${links.file(path!, from, to, sha?.toLowerCase())})`;
}

/** The pinned commit of a code link the server built, for its marker's `@sha`. */
function pinnedSha(href: string): string | null {
  const ref = /\/blob\/([^/]+)\//.exec(href)?.[1] ?? /[?&]at=([^&#]+)/.exec(href)?.[1];
  return ref && /^[0-9a-f]{7,40}$/i.test(ref) ? ref : null;
}

/** Where a hub artifact opens, as the SDLC screen addresses it; no discussion panel. */
async function canvasPaths(
  workspaceId: string,
  channelId: string,
  ids: string[]
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const canvases = await db.canvas.findMany({
    where: { id: { in: ids }, channelId, sdlcArtifact: { isNot: null } },
    select: { id: true, folderId: true, sdlcArtifact: { select: { artifactType: true } } },
  });
  return new Map(
    canvases.map((canvas) => {
      const place = sdlcSectionForCanvas(canvas.sdlcArtifact?.artifactType, canvas.folderId);
      const search = new URLSearchParams({
        canvas: canvas.id,
        ...(place.folderId ? { type: place.folderId } : {}),
      });
      return [canvas.id, `/${workspaceId}/sdlc/${channelId}/${place.section}?${search.toString()}`];
    })
  );
}

export interface ResolveSdlcLinksInput {
  markdown: string;
  workspaceId: string;
  channelId: string;
  /** Null when the artifact has no repository, or it is on a host we do not know: code references stay text. */
  code: SdlcCodeTarget | null;
}

/** Builds every marked link; returns each problem with the section it is in, for one error the agent can act on. */
export async function resolveSdlcLinks(
  input: ResolveSdlcLinksInput
): Promise<{ markdown: string; problems: string[] }> {
  const links = input.code ? codeLinks(input.code) : null;
  const ids = [...input.markdown.matchAll(CANVAS_MARKER)].map((match) => match[2]!);
  const paths = await canvasPaths(input.workspaceId, input.channelId, [...new Set(ids)]);
  const problems: string[] = [];
  let heading = 'the top';
  let fenced = false;
  const lines = input.markdown.split('\n').map((line) => {
    if (FENCE.test(line.trim())) fenced = !fenced;
    if (fenced || FENCE.test(line.trim())) return line;
    const title = /^#{1,6}\s+(.+)$/.exec(line.trim());
    if (title) heading = `"${title[1]}"`;
    const where = `In ${heading}`;

    for (const match of line.matchAll(ANY_LINK)) {
      const href = match[2]!;
      if (links?.isCode(href)) {
        problems.push(
          `${where}: ${match[0]} links the repository by URL. Write [path]() or [path:10-42]() and the Wiki builds the link.`
        );
      }
    }
    if (
      /^\s*Sources:/i.test(line) &&
      line
        .replace(/^\s*Sources:/i, '')
        .replace(CODE_MARKER, '')
        .replace(/[\s,;]/g, '') !== ''
    ) {
      problems.push(
        `${where}: a "Sources:" line holds only code references, such as Sources: [src/a.ts:10-42](), [app/server/]().`
      );
    }
    if (/^\s*Sources:/i.test(line)) {
      for (const [marker, label] of line.matchAll(CODE_MARKER)) {
        const file = FILE_LABEL.exec(label!.trim());
        // A file is a path whose last part has a dot: app/server/ and Dockerfile need no range.
        if (file && !file[2] && /\.[^/]*$/.test(file[1]!.split('/').pop()!)) {
          problems.push(
            `${where}: ${marker} needs a line range, such as [${file[1]}:12-40]().`
          );
        }
      }
    }

    return line
      .replace(CANVAS_MARKER, (marker, label: string, id: string) => {
        const path = paths.get(id);
        if (path) return `[${label}](${path})`;
        problems.push(
          `${where}: ${marker} names no artifact in this hub. Take the canvasId from the list or create result.`
        );
        return label;
      })
      .replace(CODE_MARKER, (marker, label: string) => {
        if (!links) return `\`${label}\``;
        const link = codeLink(label.trim(), links);
        if (link) return link;
        problems.push(
          `${where}: ${marker} is not a code reference. Write [path](), [path:10-42]() or [commit abc1234]().`
        );
        return label;
      });
  });
  return { markdown: lines.join('\n'), problems };
}

const rejectedWrites = new Map<string, number>();
// A model that cannot fix its links must not loop: the third rejected write of one artifact saves, and logs what failed.
const MAX_REJECTED_WRITES = 2;

/** resolveSdlcLinks for an agent's write: rejects it with every problem, or saves after MAX_REJECTED_WRITES. `key` names the artifact. */
export async function requireSdlcLinks(
  input: ResolveSdlcLinksInput & { key: string }
): Promise<string> {
  const { markdown, problems } = await resolveSdlcLinks(input);
  if (problems.length === 0) {
    rejectedWrites.delete(input.key);
    return markdown;
  }
  const rejected = (rejectedWrites.get(input.key) ?? 0) + 1;
  if (rejected > MAX_REJECTED_WRITES) {
    rejectedWrites.delete(input.key);
    logger.warn(
      `[SDLC] saving ${input.key} with ${problems.length} unresolved links after ${MAX_REJECTED_WRITES} rejected writes: ${problems.join(' | ')}`
    );
    return markdown;
  }
  rejectedWrites.set(input.key, rejected);
  throw new AppError(
    `Not saved: ${problems.length} link problem${problems.length === 1 ? '' : 's'}. Fix all and send the write again.\n` +
      problems.map((problem, index) => `${index + 1}. ${problem}`).join('\n'),
    400
  );
}

/** The marker form of links the server built, for an agent reading an artifact or a section edit re-saving one. */
export function sdlcLinkMarkers(markdown: string): string {
  return markdown
    .replace(
      LINES_LINK,
      (_link, path: string, href: string, lines: string) => {
        const sha = pinnedSha(href);
        return `[${path.trim()}:${lines}${sha ? `@${sha}` : ''}]()`;
      }
    )
    .replace(ANY_LINK, (link, label: string, href: string) => {
      const canvas = /\/sdlc\/[^?#]+\?(?:[^#]*&)?canvas=([A-Za-z0-9_-]+)/.exec(href);
      if (canvas) return `[${label}](canvas:${canvas[1]})`;
      const code =
        /^https?:\/\/[^/]+\/(?:.+\/blob\/[^/]+\/|projects\/[^/]+\/repos\/[^/]+\/browse\/.+[?&]at=|.+\/commits?\/[0-9a-f]{7,40}$)/i.test(
          href
        );
      if (!code) return link;
      const sha = /^commit /i.test(label) ? null : pinnedSha(href);
      return `[${label}${sha ? `@${sha}` : ''}]()`;
    });
}

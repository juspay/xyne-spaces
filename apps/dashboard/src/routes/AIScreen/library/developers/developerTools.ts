/**
 * The developer tools listed under Agent Hub → Library → Developers: ways to
 * use Spaces from outside it. Static on purpose — these are products we ship,
 * not rows a workspace creates, so there is nothing to fetch.
 */

import { API_BASE_URL } from '@/config';

export type DeveloperToolId = 'mcp' | 'sdk' | 'cli';

export interface DeveloperTool {
  id: DeveloperToolId;
  name: string;
  /** One line for the card. */
  tagline: string;
  /** A sentence or two for the top of the detail page. */
  summary: string;
  badge: string;
  /** Only for tools that really are on npm. */
  npmPackage?: string;
}

/** The CLI ships as a tarball served by this dashboard, from `public/downloads/spaces-cli/`. */
export const CLI_VERSION = '0.1.10';
export const CLI_TARBALL = `xyne-spaces-cli-${CLI_VERSION}.tgz`;

export const DEVELOPER_TOOLS: readonly DeveloperTool[] = [
  {
    id: 'mcp',
    name: 'Spaces MCP',
    tagline: 'Use Spaces from Claude Code, Cursor or any MCP client: search, threads, tickets.',
    summary:
      'An MCP server that gives your coding agent tools for channels, threads, messages, tickets, ' +
      'calls, canvases and search. It acts as you, so it reaches exactly what you can see in Spaces.',
    badge: 'Read-only by default',
  },
  {
    id: 'sdk',
    name: 'Spaces SDK',
    tagline: 'Build standalone apps and scripts outside Spaces that sign in with Xyne SSO.',
    summary:
      'A typed client for every read and write the Spaces app performs, for software that runs ' +
      'outside Spaces: your own web apps, backends, scripts and CLIs. Users sign in with Xyne ' +
      'SSO, and the code acts as them.',
    badge: 'Outside Spaces',
    npmPackage: '@xyne/spaces-sdk',
  },
  {
    id: 'cli',
    name: 'Spaces CLI',
    tagline: 'Scaffold template-ready apps that run inside Spaces, then publish them.',
    summary:
      'The spaces command builds artifact apps that live inside Spaces — in the toolbar, the ' +
      "Inbox, a channel's tabs or Agent Hub. It scaffolds a ready React template with the SDK " +
      'already wired in, runs it locally, and publishes it to your workspace. No sign-in code: ' +
      'Spaces runs the app as whoever opens it.',
    badge: 'Inside Spaces',
  },
];

export function findDeveloperTool(id: string | undefined): DeveloperTool | undefined {
  return DEVELOPER_TOOLS.find(tool => tool.id === id);
}

function withoutAppPrefix(url: URL): string {
  url.hostname = url.hostname.replace(/^app\./, '');
  return url.origin;
}

export function spacesBaseUrl(): string {
  const api = new URL(API_BASE_URL, window.location.origin);
  const path = api.pathname.replace(/\/api\/?$/, '').replace(/\/+$/, '');
  return `${withoutAppPrefix(api)}${path}`;
}

export function cliDownloadUrl(): string {
  const page = /^https?:$/.test(window.location.protocol)
    ? new URL(window.location.origin)
    : new URL(API_BASE_URL, window.location.origin);
  return `${withoutAppPrefix(page)}/downloads/spaces-cli/${CLI_TARBALL}`;
}

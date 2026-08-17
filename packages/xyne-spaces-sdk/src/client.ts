/**
 * Spaces SDK Client
 *
 * Main entry point for the SDK. Provides access to all resources.
 */

import { HttpClient } from './core/http.js';
import { Transport } from './core/transport.js';
import { UsersResource } from './resources/users.js';
import { SearchResource } from './resources/search.js';
import { ChannelsResource } from './resources/channels.js';
import { ConversationsResource } from './resources/conversations.js';
import { MessagesResource } from './resources/messages.js';
import { ActivitiesResource } from './resources/activities.js';
import { TicketsResource } from './resources/tickets.js';
import { SupportTicketsResource } from './resources/support-tickets.js';
import { BoardsResource } from './resources/boards.js';
import { ProjectsResource } from './resources/projects.js';
import { CanvasesResource } from './resources/canvases.js';
import { CollectionsResource } from './resources/collections.js';
import { FormsResource } from './resources/forms.js';
import { CallsResource } from './resources/calls.js';
import { EmailResource } from './resources/email.js';
import { RecapsResource } from './resources/recaps.js';
import { AdminResource } from './resources/admin.js';
import { UserGroupsResource } from './resources/user-groups.js';
import { DashboardsResource } from './resources/dashboards.js';
import { AutomationsResource } from './resources/automations.js';
import { IncidentsResource } from './resources/incidents.js';
import { PreferencesResource } from './resources/preferences.js';
import { WorkspaceResource } from './resources/workspace.js';
import { AttachmentsResource } from './resources/attachments.js';
import { ClawResource } from './resources/claw.js';
import { ClawAuth, type ClawTokenStore } from './core/claw-auth.js';

export interface SpacesClientOptions {
  /**
   * Base URL of the Spaces API.
   * @default 'https://spaces.xyne.app'
   */
  baseUrl?: string;

  /**
   * Access token for authentication.
   * Can be set later via `setToken()`.
   */
  token?: string;

  /**
   * Request timeout in milliseconds.
   * @default 30000
   */
  timeout?: number;

  /**
   * Base URL of the Claw service.
   *
   * Claw normally shares the Spaces deployment, so this defaults to `baseUrl`.
   * Override it only when remote agents live somewhere else.
   */
  clawBaseUrl?: string;

  /**
   * Claw access token — a **separate credential** from `token`.
   *
   * Claw is served by a different service whose verifier accepts only its own
   * `xyne_cli_` / `xyne_svc_` tokens, so the Spaces token cannot be reused. Obtain
   * one with `sdk.claw.login()`, or pass a previously stored value here.
   */
  clawToken?: string;

  /**
   * Where to keep the Claw token between processes.
   *
   * The SDK stays browser-safe and dependency-free, so it does not read or write
   * files itself. Supply a store and `sdk.claw` will load a saved token on first
   * use and persist a new one after `login()`.
   *
   * @example
   * // Node: share the credential file with the Xyne CLI
   * const path = join(homedir(), '.xyne', 'agent', 'claw.json');
   * const store = {
   *   get: () => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).token : undefined,
   *   set: (token) => writeFileSync(path, JSON.stringify({ token }, null, 2)),
   *   clear: () => rmSync(path, { force: true }),
   * };
   */
  clawTokenStore?: ClawTokenStore;
}

/**
 * The Spaces SDK client.
 *
 * Provides typed access to the Spaces API through resource objects.
 *
 * @example
 * ```typescript
 * import { SpacesClient } from '@xyne/spaces-sdk';
 *
 * const client = new SpacesClient({
 *   token: process.env.XYNE_SPACES_TOKEN,
 * });
 *
 * // List users
 * const users = await client.users.list();
 *
 * // Search
 * const results = await client.search.query({ q: 'project update' });
 * ```
 */
export class SpacesClient {
  private readonly http: HttpClient;
  private readonly transport: Transport;

  /**
   * Claw's own HTTP client. Separate from `http` because Claw carries a different
   * credential — see `core/claw-auth.ts`.
   */
  private readonly clawHttp: HttpClient;
  private readonly clawAuth: ClawAuth;

  /** User operations */
  readonly users: UsersResource;

  /** Search operations */
  readonly search: SearchResource;

  /** Direct multipart file uploads */
  readonly attachments: AttachmentsResource;

  /** Channel membership, settings, participants, and sidebar sections */
  readonly channels: ChannelsResource;

  /** Threads: listing, reading, pinning, and subscription */
  readonly conversations: ConversationsResource;

  /** Messages, drafts, and scheduled sends */
  readonly messages: MessagesResource;

  /** The current user's activity feed and its read state */
  readonly activities: ActivitiesResource;

  /** Tickets, sub-tickets, tags, references, and stage approvals */
  readonly tickets: TicketsResource;

  /** The support-desk view of tickets (reads; write via `tickets`) */
  readonly supportTickets: SupportTicketsResource;

  /** Boards, stages, transitions, and SLA policies */
  readonly boards: BoardsResource;

  /** Projects and their tags, fields, and applications */
  readonly projects: ProjectsResource;

  /** Canvases: content, sharing, comments, versions, and folders */
  readonly canvases: CanvasesResource;

  /** Knowledge-base collections and their permissions */
  readonly collections: CollectionsResource;

  /** Custom forms, their mappings, and submitted values */
  readonly forms: FormsResource;

  /** Calls, scheduling, participation, and recordings */
  readonly calls: CallsResource;

  /** Desk email: drafts, signatures, read state, and labels */
  readonly email: EmailResource;

  /** Daily channel and project recaps, and entity nudges */
  readonly recaps: RecapsResource;

  /** Workspace and organization administration */
  readonly admin: AdminResource;

  /** Teams, membership, and assignment routing */
  readonly userGroups: UserGroupsResource;

  /** Dashboards, saved queries, and tile layout */
  readonly dashboards: DashboardsResource;

  /** Automations and their approval lifecycle */
  readonly automations: AutomationsResource;

  /** RCAs, impacts, corrective actions, and release attribution */
  readonly incidents: IncidentsResource;

  /** The current user's own settings, bookmarks, and saved views */
  readonly preferences: PreferencesResource;

  /** Shared links, repositories, emoji, and reference data */
  readonly workspace: WorkspaceResource;

  /** Remote agents: dispatch, poll, and their own login */
  readonly claw: ClawResource;

  constructor(options: SpacesClientOptions = {}) {
    const baseUrl = options.baseUrl ?? 'https://spaces.xyne.app';

    this.http = new HttpClient({
      baseUrl,
      token: options.token,
      timeout: options.timeout,
    });

    this.transport = new Transport(this.http);

    // Claw gets its own client so its credential stays independent of the Spaces
    // token: refreshing one must never disturb the other.
    this.clawHttp = new HttpClient({
      baseUrl: options.clawBaseUrl ?? baseUrl,
      token: options.clawToken,
      timeout: options.timeout,
    });
    this.clawAuth = new ClawAuth(this.clawHttp, options.clawTokenStore);

    // Initialize resources
    this.users = new UsersResource(this.transport);
    this.search = new SearchResource(this.transport);
    this.attachments = new AttachmentsResource(this.transport);
    this.channels = new ChannelsResource(this.transport);
    this.conversations = new ConversationsResource(this.transport);
    this.messages = new MessagesResource(this.transport);
    this.activities = new ActivitiesResource(this.transport);
    this.tickets = new TicketsResource(this.transport);
    this.supportTickets = new SupportTicketsResource(this.transport);
    this.boards = new BoardsResource(this.transport);
    this.projects = new ProjectsResource(this.transport);
    this.canvases = new CanvasesResource(this.transport);
    this.collections = new CollectionsResource(this.transport);
    this.forms = new FormsResource(this.transport);
    this.calls = new CallsResource(this.transport);
    this.email = new EmailResource(this.transport);
    this.recaps = new RecapsResource(this.transport);
    this.admin = new AdminResource(this.transport);
    this.userGroups = new UserGroupsResource(this.transport);
    this.dashboards = new DashboardsResource(this.transport);
    this.automations = new AutomationsResource(this.transport);
    this.incidents = new IncidentsResource(this.transport);
    this.preferences = new PreferencesResource(this.transport);
    this.workspace = new WorkspaceResource(this.transport);
    this.claw = new ClawResource(new Transport(this.clawHttp), this.clawAuth);
  }

  /**
   * Set the Spaces access token.
   * Useful for token refresh scenarios. Does not affect Claw.
   */
  setToken(token: string): void {
    this.http.setToken(token);
  }

  /**
   * Clear the Spaces access token. Does not affect Claw.
   */
  clearToken(): void {
    this.http.clearToken();
  }

  /**
   * Check if the client has a Spaces access token set.
   */
  hasToken(): boolean {
    return this.http.getToken() !== undefined;
  }

  /**
   * Set the Claw access token directly, skipping `claw.login()`.
   *
   * Separate from `setToken` on purpose: Claw is a different service with a
   * different credential, and neither token is valid at the other.
   */
  setClawToken(token: string): void {
    this.clawAuth.setToken(token);
  }

  /**
   * Clear the Claw access token in memory. Does not affect the Spaces token, and
   * does not touch a configured token store — use `claw.logout()` for that.
   */
  clearClawToken(): void {
    this.clawHttp.clearToken();
  }

  /** Check if a Claw token is set. Does not consult the token store. */
  hasClawToken(): boolean {
    return this.clawHttp.getToken() !== undefined;
  }
}

/**
 * Create a new Spaces SDK client.
 *
 * @param options - Client configuration options
 * @returns A configured SpacesClient instance
 *
 * @example
 * ```typescript
 * import { createClient } from '@xyne/spaces-sdk';
 *
 * const sdk = createClient({
 *   token: process.env.XYNE_SPACES_TOKEN,
 * });
 *
 * const users = await sdk.users.list();
 * ```
 */
export function createClient(options?: SpacesClientOptions): SpacesClient {
  return new SpacesClient(options);
}

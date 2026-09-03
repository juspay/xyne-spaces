/**
 * Projects Operation Registry
 *
 * Projects group boards, tickets, tags, and canvases. A project's `code` is the
 * prefix in its tickets' keys (a project coded `PLAT` yields `PLAT-1234`).
 *
 * There is no create operation — projects are provisioned elsewhere — so this
 * registry covers reads, update, and delete.
 *
 * Each entry is an operation id on the versioned API plus the types either side
 * of the call. What the server does with an id is defined server-side, in
 * `api/sdk/v1/mapper.ts` and `api/sdk/v1/parser.ts`.
 */

import { op } from './types.js';
import type {
  Application,
  CanvasFolder,
  Project,
  ProjectTag,
  Recap,
  Ticket,
  TicketFieldDefinition,
} from '../types/index.js';

export const projectsOperations = {
  // ----- Reads -----

  list: op<void, Project[]>('projects.list', 'query'),
  listLite: op<void, Project[]>('projects.listLite', 'query'),
  get: op<{ projectId: string }, Project | null>('projects.get', 'query'),
  getMany: op<{ projectIds: string[] }, Project[]>('projects.getMany', 'query'),
  listTags: op<{ projectId: string }, ProjectTag[]>('projects.listTags', 'query'),
  listFieldDefinitions: op<{ projectId: string }, TicketFieldDefinition[]>(
    'projects.listFieldDefinitions',
    'query'
  ),
  listCanvasFolders: op<{ projectId: string }, CanvasFolder[]>(
    'projects.listCanvasFolders',
    'query'
  ),
  listApplications: op<{ projectId: string }, Application[]>(
    'projects.listApplications',
    'query'
  ),
  listReleaseTickets: op<{ projectId: string }, Ticket[]>(
    'projects.listReleaseTickets',
    'query'
  ),
  listRecaps: op<{ recapDate: number }, Recap[]>('projects.listRecaps', 'query'),

  // ----- Writes -----

  update: op<{ projectId: string; name?: string; description?: string }, void>(
    'projects.update',
    'mutator'
  ),
  delete: op<{ projectId: string }, void>('projects.delete', 'mutator'),
  saveReleaseBoardConfig: op<
    {
      projectId: string;
      mainBoardId: string;
      mainBoardName: string;
      vcsProvider: string;
      releaseTrackingMode: string;
      channelId: string;
      applications: unknown[];
    },
    void
  >('projects.saveReleaseBoardConfig', 'mutator'),
} as const;

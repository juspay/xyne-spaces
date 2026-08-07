/**
 * Projects Operation Registry
 *
 * Projects group boards, tickets, tags, and canvases. A project's `code` is the
 * prefix in its tickets' keys (a project coded `PLAT` yields `PLAT-1234`).
 *
 * There is no create operation in the catalog — projects are provisioned
 * elsewhere — so this registry covers reads, update, and delete.
 */

import { query, mutator } from './types.js';
import { now } from '../core/ids.js';
import type { Project } from '../types/index.js';

export const projectsOperations = {
  // ----- Reads -----

  /**
   * Every project in the workspace.
   * Maps to: Zero query 'getAllProjects'
   */
  list: query<void, Project[]>('getAllProjects'),

  /**
   * Projects with only the fields a picker needs.
   * Maps to: Zero query 'getAllProjectsList'
   */
  listLite: query<void, Project[]>('getAllProjectsList'),

  /**
   * One project.
   * Maps to: Zero query 'projectById'
   */
  get: query<{ projectId: string }, Project | null>('projectById'),

  /**
   * Several projects by id.
   * Maps to: Zero query 'projectsByIds'
   */
  getMany: query<{ projectIds: string[] }, Project[]>('projectsByIds'),

  /**
   * Tags defined on a project.
   * Maps to: Zero query 'projectTagsByProjectId'
   */
  listTags: query<{ projectId: string }, unknown[]>('projectTagsByProjectId'),

  /**
   * Custom-field definitions available to a project's tickets.
   * Maps to: Zero query 'getAllTicketEntityMappings'
   */
  listFieldDefinitions: query<{ projectId: string }, unknown[]>(
    'getAllTicketEntityMappings'
  ),

  /**
   * Canvas folders in a project.
   * Maps to: Zero query 'projectCanvasFolders'
   */
  listCanvasFolders: query<{ projectId: string }, unknown[]>('projectCanvasFolders'),

  /**
   * Applications registered against a project, for release tracking.
   * Maps to: Zero query 'applicationsByProjectId'
   */
  listApplications: query<{ projectId: string }, unknown[]>('applicationsByProjectId'),

  /**
   * Release tickets in a project.
   * Maps to: Zero query 'releaseTicketsByProjectId'
   */
  listReleaseTickets: query<{ projectId: string }, unknown[]>(
    'releaseTicketsByProjectId'
  ),

  /**
   * Daily recaps for a project.
   * Maps to: Zero query 'projectRecaps'
   */
  listRecaps: query<{ recapDate: number }, unknown[]>('projectRecaps'),

  // ----- Writes -----

  /**
   * Rename a project or change its description.
   * Maps to: Zero mutator 'project.update'
   */
  update: mutator<{ projectId: string; name?: string; description?: string }, void>(
    'project.update',
    {
      mapArgs: (args) => ({ ...args, timestamp: now() }),
    }
  ),

  /**
   * Delete a project.
   * Maps to: Zero mutator 'project.delete'
   */
  delete: mutator<{ projectId: string }, void>('project.delete'),
  /**
   * Configure release tracking for a project.
   *
   * The `applications` array is nested and provider-specific, so it is passed
   * through rather than modelled.
   * Maps to: Zero mutator 'project.saveReleaseBoardConfig'
   */
  saveReleaseBoardConfig: mutator<
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
  >('project.saveReleaseBoardConfig'),
} as const;

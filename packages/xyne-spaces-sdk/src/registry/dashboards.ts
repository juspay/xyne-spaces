/**
 * Dashboards Operation Registry
 *
 * Dashboards, the saved queries that feed them, and the layout of their tiles.
 *
 * A query is defined once and mapped onto a dashboard; `mappingId` is that
 * placement, which is what reordering and removal operate on.
 */

import { query, mutator } from './types.js';
import { now } from '../core/ids.js';

export const dashboardsOperations = {
  // ----- Reads -----

  /**
   * Every dashboard.
   * Maps to: Zero query 'getAllDashboards'
   */
  list: query<void, unknown[]>('getAllDashboards'),

  /**
   * One dashboard with its components.
   * Maps to: Zero query 'getDashboardById'
   */
  get: query<{ dashboardId: string }, unknown>('getDashboardById'),

  // ----- Writes -----

  /**
   * Create or update a dashboard.
   *
   * `createdBy` is taken as an argument rather than from the session — pass the
   * acting user's id, available from `sdk.users.me()`.
   * Maps to: Zero mutator 'dashboard.upsert'
   */
  upsert: mutator<
    { id: string; name: string; createdBy: string; description?: string },
    void
  >('dashboard.upsert', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Delete a dashboard.
   * Maps to: Zero mutator 'dashboard.delete'
   */
  delete: mutator<{ id: string }, void>('dashboard.delete'),

  /**
   * Move tiles around a dashboard.
   * Maps to: Zero mutator 'dashboardComponent.updatePositions'
   */
  updateLayout: mutator<{ updates: unknown[] }, void>(
    'dashboardComponent.updatePositions',
    {
      mapArgs: (args) => ({ updates: args.updates, timestamp: now() }),
    }
  ),

  // ----- Saved queries -----

  /**
   * Create or update a saved query, optionally placing it on a dashboard.
   * Maps to: Zero mutator 'query.upsert'
   */
  upsertQuery: mutator<
    {
      id: string;
      title: string;
      queryJson: unknown;
      createdBy: string;
      dashboardId?: string;
      mappingId?: string;
      entityType?: string;
      targetEntity?: string;
      visualType?: string;
    },
    void
  >('query.upsert', {
    mapArgs: (args) => ({ ...args, timestamp: now() }),
  }),

  /**
   * Delete a saved query.
   * Maps to: Zero mutator 'query.delete'
   */
  deleteQuery: mutator<{ id: string }, void>('query.delete'),

  /**
   * Reorder a dashboard's tiles, by placement id.
   * Maps to: Zero mutator 'query.reorder'
   */
  reorderQueries: mutator<{ orderedMappingIds: string[] }, void>('query.reorder', {
    mapArgs: (args) => ({ orderedMappingIds: args.orderedMappingIds, timestamp: now() }),
  }),
} as const;

/**
 * Dashboards Resource
 *
 * Dashboards, their saved queries, and tile layout.
 *
 * A query is defined once and then *placed* on a dashboard. The placement has
 * its own id, and reordering and removal operate on placements rather than on
 * the query — so a query can appear on more than one dashboard.
 */

import { Resource } from './base.js';
import { dashboardsOperations } from '../registry/dashboards.js';
import { newId } from '../core/ids.js';
import type { Dashboard, DashboardLayoutUpdate } from '../types/index.js';

export class DashboardsResource extends Resource {
  /**
   * List every dashboard in the workspace, most recently updated first.
   *
   * @returns Dashboards without their tiles. Use {@link get} for those.
   * @example
   * const dashboards = await sdk.dashboards.list();
   */
  list(): Promise<Dashboard[]> {
    return this.call(dashboardsOperations.list, undefined);
  }

  /**
   * Get one dashboard with its tile placements resolved.
   *
   * @param dashboardId - Id of the dashboard.
   * @returns The dashboard including `queryMappings`, or `null` if not found.
   * @example
   * const dashboard = await sdk.dashboards.get('dash-1');
   */
  get(dashboardId: string): Promise<Dashboard | null> {
    return this.call(dashboardsOperations.get, { dashboardId });
  }

  /**
   * Create or update a dashboard.
   *
   * Omit `id` to create one; the id is generated and returned.
   *
   * @param data - The dashboard to write.
   * @param data.id - Existing dashboard to update. Omit to create.
   * @param data.name - Display name.
   * @param data.createdBy - Acting user's id, from `sdk.users.me()`.
   * @param data.description - Optional description.
   * @returns The dashboard id, generated when creating.
   * @example
   * const me = await sdk.users.me();
   * const { id } = await sdk.dashboards.upsert({ name: 'Ops', createdBy: me.id });
   */
  async upsert(data: {
    id?: string;
    name: string;
    createdBy: string;
    description?: string;
  }): Promise<{ id: string }> {
    const id = data.id ?? newId();
    await this.call(dashboardsOperations.upsert, { ...data, id });
    return { id };
  }

  /**
   * Delete a dashboard.
   *
   * @param id - Id of the dashboard to delete.
   * @example
   * await sdk.dashboards.delete('dash-1');
   */
  delete(id: string): Promise<void> {
    return this.call(dashboardsOperations.delete, { id });
  }

  /**
   * Move tiles around a dashboard.
   *
   * @param updates - New position for each tile, addressed by placement id.
   * @example
   * await sdk.dashboards.updateLayout([{ id: 'placement-1', sequence: 0 }]);
   */
  updateLayout(updates: DashboardLayoutUpdate[]): Promise<void> {
    return this.call(dashboardsOperations.updateLayout, { updates });
  }

  /**
   * Create or update a saved query, optionally placing it on a dashboard.
   *
   * @param data - The query to write.
   * @param data.id - Existing query to update. Omit to create.
   * @param data.title - Display title of the tile.
   * @param data.queryJson - The query definition itself.
   * @param data.createdBy - Acting user's id, from `sdk.users.me()`.
   * @param data.dashboardId - Dashboard to place it on. Omit to save it unplaced.
   * @param data.mappingId - Existing placement to update. Omit to create one.
   * @param data.entityType - Entity the query reads.
   * @param data.targetEntity - Entity the results point at.
   * @param data.visualType - How the tile renders, e.g. `bar`.
   * @returns The query id, plus the placement id when placed on a dashboard.
   * Keep the placement id: reordering and removal work on placements.
   * @example
   * const me = await sdk.users.me();
   * const { id, mappingId } = await sdk.dashboards.upsertQuery({
   *   title: 'Open tickets',
   *   queryJson: { entity: 'tickets' },
   *   createdBy: me.id,
   *   dashboardId: 'dash-1',
   * });
   */
  async upsertQuery(data: {
    id?: string;
    title: string;
    queryJson: unknown;
    createdBy: string;
    dashboardId?: string;
    mappingId?: string;
    entityType?: string;
    targetEntity?: string;
    visualType?: string;
  }): Promise<{ id: string; mappingId?: string }> {
    const id = data.id ?? newId();
    const mappingId = data.mappingId ?? (data.dashboardId ? newId() : undefined);
    await this.call(dashboardsOperations.upsertQuery, {
      ...data,
      id,
      ...(mappingId ? { mappingId } : {}),
    });
    return mappingId ? { id, mappingId } : { id };
  }

  /**
   * Delete a saved query.
   *
   * @param id - Id of the query, not of a placement.
   * @example
   * await sdk.dashboards.deleteQuery('query-1');
   */
  deleteQuery(id: string): Promise<void> {
    return this.call(dashboardsOperations.deleteQuery, { id });
  }

  /**
   * Reorder a dashboard's tiles.
   *
   * @param orderedMappingIds - Placement ids in their new display order.
   * @example
   * await sdk.dashboards.reorderQueries(['placement-2', 'placement-1']);
   */
  reorderQueries(orderedMappingIds: string[]): Promise<void> {
    return this.call(dashboardsOperations.reorderQueries, { orderedMappingIds });
  }
}

/**
 * Dashboards Resource
 *
 * Dashboards, their saved queries, and tile layout.
 */

import { Resource } from './base.js';
import { dashboardsOperations } from '../registry/dashboards.js';
import { newId } from '../core/ids.js';

export class DashboardsResource extends Resource {
  /** List every dashboard. */
  list(): Promise<unknown[]> {
    return this.call(dashboardsOperations.list, undefined);
  }

  /** Get one dashboard with its components. */
  get(dashboardId: string): Promise<unknown> {
    return this.call(dashboardsOperations.get, { dashboardId });
  }

  /**
   * Create or update a dashboard.
   *
   * `createdBy` must be the acting user's id — get it from `sdk.users.me()`.
   * Omit `id` to create.
   *
   * @returns The dashboard id
   *
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

  /** Delete a dashboard. */
  delete(id: string): Promise<void> {
    return this.call(dashboardsOperations.delete, { id });
  }

  /** Move tiles around a dashboard. */
  updateLayout(updates: unknown[]): Promise<void> {
    return this.call(dashboardsOperations.updateLayout, { updates });
  }

  /**
   * Create or update a saved query, optionally placing it on a dashboard.
   *
   * @returns The query id and, when placed on a dashboard, its placement id —
   * keep the placement id, since reordering and removal work on placements
   * rather than on the query itself.
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

  /** Delete a saved query. */
  deleteQuery(id: string): Promise<void> {
    return this.call(dashboardsOperations.deleteQuery, { id });
  }

  /** Reorder a dashboard's tiles, by placement id. */
  reorderQueries(orderedMappingIds: string[]): Promise<void> {
    return this.call(dashboardsOperations.reorderQueries, { orderedMappingIds });
  }
}

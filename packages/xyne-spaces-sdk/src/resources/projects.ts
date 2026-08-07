/**
 * Projects Resource
 *
 * Projects group boards, tickets, tags, and canvases.
 *
 * There is no create method — projects are provisioned outside this API.
 */

import { Resource } from './base.js';
import { projectsOperations } from '../registry/projects.js';
import type { Project } from '../types/index.js';

export class ProjectsResource extends Resource {
  /**
   * List every project in the workspace.
   *
   * @example
   * const projects = await sdk.projects.list();
   */
  list(): Promise<Project[]> {
    return this.call(projectsOperations.list, undefined);
  }

  /** List projects with only the fields a picker needs. */
  listLite(): Promise<Project[]> {
    return this.call(projectsOperations.listLite, undefined);
  }

  /** Get one project. */
  get(projectId: string): Promise<Project | null> {
    return this.call(projectsOperations.get, { projectId });
  }

  /** Get several projects by id. */
  getMany(projectIds: string[]): Promise<Project[]> {
    return this.call(projectsOperations.getMany, { projectIds });
  }

  /** List the tags defined on a project. */
  listTags(projectId: string): Promise<unknown[]> {
    return this.call(projectsOperations.listTags, { projectId });
  }

  /** List the custom-field definitions available to a project's tickets. */
  listFieldDefinitions(projectId: string): Promise<unknown[]> {
    return this.call(projectsOperations.listFieldDefinitions, { projectId });
  }

  /** List canvas folders in a project. */
  listCanvasFolders(projectId: string): Promise<unknown[]> {
    return this.call(projectsOperations.listCanvasFolders, { projectId });
  }

  /** List applications registered against a project for release tracking. */
  listApplications(projectId: string): Promise<unknown[]> {
    return this.call(projectsOperations.listApplications, { projectId });
  }

  /** List release tickets in a project. */
  listReleaseTickets(projectId: string): Promise<unknown[]> {
    return this.call(projectsOperations.listReleaseTickets, { projectId });
  }

  /**
   * List project recaps for a date.
   *
   * @param recapDate - The day to fetch, as epoch milliseconds
   */
  listRecaps(recapDate: number): Promise<unknown[]> {
    return this.call(projectsOperations.listRecaps, { recapDate });
  }

  /** Rename a project or change its description. */
  update(
    projectId: string,
    data: { name?: string; description?: string }
  ): Promise<void> {
    return this.call(projectsOperations.update, { projectId, ...data });
  }

  /** Delete a project. */
  delete(projectId: string): Promise<void> {
    return this.call(projectsOperations.delete, { projectId });
  }

  /**
   * Configure release tracking for a project.
   *
   * The `applications` array is provider-specific and passed through unchanged.
   */
  saveReleaseBoardConfig(data: {
    projectId: string;
    mainBoardId: string;
    mainBoardName: string;
    vcsProvider: string;
    releaseTrackingMode: string;
    channelId: string;
    applications: unknown[];
  }): Promise<void> {
    return this.call(projectsOperations.saveReleaseBoardConfig, data);
  }
}

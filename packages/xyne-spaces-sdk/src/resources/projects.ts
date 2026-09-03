/**
 * Projects Resource
 *
 * Projects group boards, tickets, tags, and canvases. A project's `code` is the
 * prefix in its tickets' keys — a project coded `PLAT` yields `PLAT-1234`.
 *
 * There is no create method: projects are provisioned outside this API.
 */

import { Resource } from './base.js';
import { projectsOperations } from '../registry/projects.js';
import type {
  Application,
  CanvasFolder,
  Project,
  ProjectTag,
  Recap,
  Ticket,
  TicketFieldDefinition,
} from '../types/index.js';

export class ProjectsResource extends Resource {
  /**
   * List every project in the workspace.
   *
   * @returns Every project the caller can see, with all fields.
   * @example
   * const projects = await sdk.projects.list();
   */
  list(): Promise<Project[]> {
    return this.call(projectsOperations.list, undefined);
  }

  /**
   * List projects with only the fields a picker needs.
   *
   * Cheaper than {@link list}: use it to populate a dropdown.
   *
   * @returns Every visible project, with identifying fields only.
   * @example
   * const options = await sdk.projects.listLite();
   */
  listLite(): Promise<Project[]> {
    return this.call(projectsOperations.listLite, undefined);
  }

  /**
   * Get one project.
   *
   * @param projectId - Id of the project.
   * @returns The project, or `null` if it does not exist or is not visible.
   * @example
   * const project = await sdk.projects.get('proj-123');
   */
  get(projectId: string): Promise<Project | null> {
    return this.call(projectsOperations.get, { projectId });
  }

  /**
   * Get several projects by id in one call.
   *
   * @param projectIds - Ids to fetch. Unknown ids are skipped, not an error.
   * @returns The projects that exist and are visible, in no particular order.
   * @example
   * const projects = await sdk.projects.getMany(['proj-1', 'proj-2']);
   */
  getMany(projectIds: string[]): Promise<Project[]> {
    return this.call(projectsOperations.getMany, { projectIds });
  }

  /**
   * List the tags defined on a project.
   *
   * Tags belong to one project and are not shared across projects.
   *
   * @param projectId - Id of the project.
   * @returns The project's tags.
   * @example
   * const tags = await sdk.projects.listTags('proj-123');
   */
  listTags(projectId: string): Promise<ProjectTag[]> {
    return this.call(projectsOperations.listTags, { projectId });
  }

  /**
   * List the custom-field definitions available to a project's tickets.
   *
   * @param projectId - Id of the project.
   * @returns Field definitions, each naming a merchant or gateway.
   * @example
   * const fields = await sdk.projects.listFieldDefinitions('proj-123');
   */
  listFieldDefinitions(projectId: string): Promise<TicketFieldDefinition[]> {
    return this.call(projectsOperations.listFieldDefinitions, { projectId });
  }

  /**
   * List canvas folders in a project.
   *
   * Only project-level folders; folders owned by a channel are not included.
   *
   * @param projectId - Id of the project.
   * @returns The project's canvas folders, by name.
   * @example
   * const folders = await sdk.projects.listCanvasFolders('proj-123');
   */
  listCanvasFolders(projectId: string): Promise<CanvasFolder[]> {
    return this.call(projectsOperations.listCanvasFolders, { projectId });
  }

  /**
   * List applications registered against a project for release tracking.
   *
   * @param projectId - Id of the project.
   * @returns The project's applications, including their deployed version.
   * @example
   * const apps = await sdk.projects.listApplications('proj-123');
   */
  listApplications(projectId: string): Promise<Application[]> {
    return this.call(projectsOperations.listApplications, { projectId });
  }

  /**
   * List release tickets in a project.
   *
   * @param projectId - Id of the project.
   * @returns Unarchived tickets of type `Release`.
   * @example
   * const releases = await sdk.projects.listReleaseTickets('proj-123');
   */
  listReleaseTickets(projectId: string): Promise<Ticket[]> {
    return this.call(projectsOperations.listReleaseTickets, { projectId });
  }

  /**
   * List the caller's project recaps for one day.
   *
   * @param recapDate - The day to fetch, as epoch milliseconds.
   * @returns Recaps written for the caller on that day.
   * @example
   * const recaps = await sdk.projects.listRecaps(Date.now());
   */
  listRecaps(recapDate: number): Promise<Recap[]> {
    return this.call(projectsOperations.listRecaps, { recapDate });
  }

  /**
   * Rename a project or change its description.
   *
   * @param projectId - Id of the project to change.
   * @param data - Fields to change. Omitted fields are left as they are.
   * @param data.name - New display name.
   * @param data.description - New description.
   * @example
   * await sdk.projects.update('proj-123', { name: 'Platform' });
   */
  update(
    projectId: string,
    data: { name?: string; description?: string }
  ): Promise<void> {
    return this.call(projectsOperations.update, { projectId, ...data });
  }

  /**
   * Delete a project.
   *
   * @param projectId - Id of the project to delete.
   * @example
   * await sdk.projects.delete('proj-123');
   */
  delete(projectId: string): Promise<void> {
    return this.call(projectsOperations.delete, { projectId });
  }

  /**
   * Configure release tracking for a project.
   *
   * @param data - The release-board configuration.
   * @param data.projectId - Project being configured.
   * @param data.mainBoardId - Board that holds the release tickets.
   * @param data.mainBoardName - Display name of that board.
   * @param data.vcsProvider - Version-control provider, e.g. `github`.
   * @param data.releaseTrackingMode - How releases are cut for this project.
   * @param data.channelId - Channel that receives release notifications.
   * @param data.applications - Applications to track. Provider-specific, passed through unchanged.
   * @example
   * await sdk.projects.saveReleaseBoardConfig({
   *   projectId: 'proj-123',
   *   mainBoardId: 'board-1',
   *   mainBoardName: 'Releases',
   *   vcsProvider: 'github',
   *   releaseTrackingMode: 'tag',
   *   channelId: 'channel-1',
   *   applications: [],
   * });
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

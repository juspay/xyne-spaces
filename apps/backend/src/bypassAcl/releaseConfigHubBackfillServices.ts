import {
  BoardType,
  ChannelType,
  FormContextType,
  FormEntityType,
  ReleaseTrackingMode,
  VCSProviderType,
} from '@xyne/shared';
import { SDLC_MEMBERSHIP_RELATION, SDLC_RELEASE_CONFIG_RELATION } from '@xyne/shared/sdlc';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import {
  detectVcsProvider,
  parseBitbucketRepoUrl,
  parseGitHubRepoUrl,
} from '@/utils/repoUrlParser';
import { asSystem, type TableName } from './base';

/**
 * One-off move of Release Manager configs from projects to SDLC hubs.
 *
 * `move` hands each listed project's release configs to an SDLC hub and leaves them as
 * a save from that hub's Releases tab would: every service on the hub repository
 * (applications.repoId), the RELEASE_CONFIG edge hub -> repository -> main board, the
 * boards named `<repo>_<hub>_release` and `<repo>_<hub>_<service>_release`, the release
 * form mapped by tracking mode, and the release channel linked to the main board. The
 * boards' links to other channels, their stages and their releases are kept.
 *
 * `remove` deletes the release configs of the listed projects: their services, their
 * RELEASE_CONFIG edges, and their boards' channel links, so no channel offers a board
 * no config owns. The boards, their tickets and canvases stay in the project.
 *
 * One transaction per project, so a project that fails writes nothing and the result
 * says why. Idempotent: a moved project with nothing left to change writes nothing, and
 * a removed one has no config left to remove.
 *
 * Ships while applications.repoId is still nullable, and is removed once every config
 * is on a hub and repoId is required.
 *
 * Runs as the system actor: `db` is ACL-wrapped, and the configs span every workspace,
 * which a request context would narrow to the caller's.
 */

const TAG = '[ReleaseConfigHubBackfill]';
const REASON =
  "one-off move of release configs to SDLC hubs spans every workspace; a request context would narrow it to the caller's";
const READ_TABLES: TableName[] = [
  'Application',
  'Board',
  'Channel',
  'ChannelBoardMapping',
  'Form',
  'FormContextMapping',
  'Project',
  'Repo',
  'SdlcEntityLink',
];
const WRITE_TABLES: TableName[] = READ_TABLES;
const TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

export interface ReleaseConfigHubMove {
  projectId: string;
  hubChannelId: string;
  /** Only this release config of the project; otherwise all of them. */
  mainBoardId?: string | undefined;
  /** The hub repository, for when the services' URL matches none or several. */
  repoId?: string | undefined;
  /** A new release channel; otherwise the services' current one is kept. */
  releaseChannelId?: string | undefined;
}

export interface ReleaseConfigHubBackfillOptions {
  dryRun: boolean;
  move: ReleaseConfigHubMove[];
  remove: string[];
}

interface ReleaseConfig {
  mainBoard: {
    id: string;
    name: string;
    projectId: string;
    workspaceId: string;
    createdBy: string;
    vcsProvider: string | null;
    releaseTrackingMode: string | null;
  };
  services: Array<{
    id: string;
    name: string;
    boardId: string;
    boardName: string | null;
    boardProjectId: string | null;
    boardType: string | null;
    projectId: string;
    regex: string;
    channelId: string | null;
    repoUrl: string | null;
    repoId: string | null;
  }>;
}

interface RepoRow {
  id: string;
  name: string;
  url: string;
  canonicalUrl: string | null;
}

function uniq(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

// The dashboard's releaseBoardNames.ts rules, so moved and new configs name their
// boards alike.
function boardNamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function repositoryName(url: string): string {
  let lastPathPart = '';
  try {
    lastPathPart = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
  } catch {
    lastPathPart = url.split('/').filter(Boolean).pop() ?? '';
  }
  return boardNamePart(lastPathPart.replace(/\.git$/i, ''));
}

/** owner/repo (GitHub) or projectKey/slug (Bitbucket), lowercased; null if the URL doesn't parse. */
function repoIdentity(url: string, provider: string): string | null {
  if (provider === VCSProviderType.GITHUB) {
    const parsed = parseGitHubRepoUrl(url);
    return parsed ? `${parsed.owner}/${parsed.repo}`.toLowerCase() : null;
  }
  const parsed = parseBitbucketRepoUrl(url);
  return parsed ? `${parsed.projectKey}/${parsed.repoSlug}`.toLowerCase() : null;
}

/** Registered repositories every service of the config can be on. */
function candidateRepos(config: ReleaseConfig, repos: RepoRow[]): RepoRow[] {
  const provider = config.mainBoard.vcsProvider;
  let candidates = repos;
  for (const service of config.services) {
    if (service.repoId) {
      candidates = candidates.filter((repo) => repo.id === service.repoId);
      continue;
    }
    const identity = service.repoUrl && provider ? repoIdentity(service.repoUrl, provider) : null;
    candidates = identity
      ? candidates.filter((repo) =>
          [repo.canonicalUrl, repo.url].some(
            (url) => url && repoIdentity(url, provider!) === identity
          )
        )
      : [];
  }
  return candidates;
}

/** Each main release board in the projects (every project when null), with its services. */
async function loadConfigs(projectIds: string[] | null): Promise<ReleaseConfig[]> {
  const mainBoards = await db.board.findMany({
    where: {
      boardType: BoardType.RELEASE,
      mainReleaseApplications: { some: {} },
      ...(projectIds ? { projectId: { in: projectIds } } : {}),
    },
    select: {
      id: true,
      name: true,
      projectId: true,
      workspaceId: true,
      createdBy: true,
      vcsProvider: true,
      releaseTrackingMode: true,
    },
    orderBy: { name: 'asc' },
  });
  const applications = await db.application.findMany({
    where: { mainReleaseBoardId: { in: mainBoards.map((board) => board.id) } },
    select: {
      id: true,
      name: true,
      boardId: true,
      mainReleaseBoardId: true,
      projectId: true,
      channelId: true,
      regex: true,
      repoUrl: true,
      repoId: true,
    },
    orderBy: { name: 'asc' },
  });
  // Looked up apart from the service: one missing board must not fail every project.
  const serviceBoards = await db.board.findMany({
    where: { id: { in: applications.map((app) => app.boardId) } },
    select: { id: true, name: true, projectId: true, boardType: true },
  });
  const serviceBoardById = new Map(serviceBoards.map((board) => [board.id, board]));
  return mainBoards.map((mainBoard) => ({
    mainBoard,
    services: applications
      .filter((app) => app.mainReleaseBoardId === mainBoard.id)
      .map((app) => ({
        id: app.id,
        name: app.name,
        boardId: app.boardId,
        boardName: serviceBoardById.get(app.boardId)?.name ?? null,
        boardProjectId: serviceBoardById.get(app.boardId)?.projectId ?? null,
        boardType: serviceBoardById.get(app.boardId)?.boardType ?? null,
        projectId: app.projectId,
        regex: app.regex,
        channelId: app.channelId,
        repoUrl: app.repoUrl,
        repoId: app.repoId ?? null,
      })),
  }));
}

/**
 * Every project with a release config: its configs, the repositories their services
 * match, the project's SDLC hubs and which of them have that repository, and whether
 * the config is already on a hub. `servicesWithoutRepoId` counts every service row
 * still missing a repoId, configured or not; it must be 0 before repoId is made NOT
 * NULL. Writes nothing.
 */
export function getReleaseConfigHubBackfillStatus() {
  return asSystem(READ_TABLES, REASON, async () => {
    const configs = await loadConfigs(null);
    const projectIds = uniq(configs.map((config) => config.mainBoard.projectId));
    const [projects, hubs, releaseLinks, strays] = await Promise.all([
      db.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true, workspaceId: true },
      }),
      db.channel.findMany({
        where: { projectId: { in: projectIds }, type: ChannelType.SDLC },
        select: { id: true, name: true, projectId: true },
      }),
      db.sdlcEntityLink.findMany({
        where: {
          relationType: SDLC_RELEASE_CONFIG_RELATION,
          targetId: { in: configs.map((config) => config.mainBoard.id) },
        },
        select: { channelId: true, sourceId: true, targetId: true },
      }),
      db.application.findMany({
        where: { projectId: { in: projectIds }, mainReleaseBoardId: null },
        select: { projectId: true },
      }),
    ]);
    const [repos, memberships] = await Promise.all([
      db.repo.findMany({
        where: { workspaceId: { in: uniq(projects.map((project) => project.workspaceId)) } },
        select: { id: true, name: true, url: true, canonicalUrl: true, workspaceId: true },
      }),
      db.sdlcEntityLink.findMany({
        where: {
          channelId: { in: hubs.map((hub) => hub.id) },
          relationType: SDLC_MEMBERSHIP_RELATION,
        },
        select: { channelId: true, targetId: true },
      }),
    ]);

    let pending = 0;
    const result = projects.map((project) => ({
      projectId: project.id,
      projectName: project.name,
      workspaceId: project.workspaceId,
      hubs: hubs
        .filter((hub) => hub.projectId === project.id)
        .map((hub) => ({ id: hub.id, name: hub.name })),
      servicesWithoutMainBoard: strays.filter((app) => app.projectId === project.id).length,
      configs: configs
        .filter((config) => config.mainBoard.projectId === project.id)
        .map((config) => {
          const link = releaseLinks.find((row) => row.targetId === config.mainBoard.id) ?? null;
          const done =
            link !== null &&
            config.services.every(
              (service) => service.repoId === link.sourceId && service.projectId === project.id
            );
          if (!done) pending++;
          return {
            mainBoardId: config.mainBoard.id,
            mainBoardName: config.mainBoard.name,
            vcsProvider: config.mainBoard.vcsProvider,
            releaseTrackingMode: config.mainBoard.releaseTrackingMode,
            releaseChannelIds: uniq(config.services.map((service) => service.channelId)),
            services: config.services.map((service) => ({
              name: service.name,
              boardName: service.boardName,
              repoUrl: service.repoUrl,
              repoId: service.repoId,
            })),
            matchingRepos: candidateRepos(
              config,
              repos.filter((repo) => repo.workspaceId === project.workspaceId)
            ).map((repo) => ({
              id: repo.id,
              name: repo.name,
              url: repo.canonicalUrl || repo.url,
              attachedToHubIds: memberships
                .filter((row) => row.targetId === repo.id)
                .map((row) => row.channelId),
            })),
            hubChannelId: link?.channelId ?? null,
            done,
          };
        }),
    }));
    // Every service, not only the configs above: one with no or a deleted main board
    // still has to have a repoId before it is made required.
    const services = await db.application.findMany({ select: { repoId: true } });
    return {
      success: true as const,
      pending,
      servicesWithoutRepoId: services.filter((service) => !service.repoId).length,
      projects: result,
    };
  });
}

interface MovePlan {
  projectId: string;
  hub: { id: string; name: string };
  configs: Array<{
    mainBoardId: string;
    workspaceId: string;
    createdBy: string;
    repo: { id: string; url: string };
    releaseChannelId: string;
    servicesToUpdate: number;
    renames: Array<{ boardId: string; from: string; to: string }>;
    createReleaseConfigLink: boolean;
    releaseForm: {
      formId: string;
      formName: string;
      mappingId: string | null;
      action: 'create' | 'update' | 'none';
    };
    linkReleaseChannel: boolean;
  }>;
}

/** What moving one project's configs to the hub writes, after every check a hub save runs. */
async function planMove(move: ReleaseConfigHubMove): Promise<MovePlan> {
  const project = await db.project.findUnique({
    where: { id: move.projectId },
    select: { id: true, workspaceId: true },
  });
  if (!project) throw new Error('Project not found');
  const hub = await db.channel.findUnique({
    where: { id: move.hubChannelId },
    select: { id: true, name: true, type: true, projectId: true },
  });
  if (!hub || hub.type !== ChannelType.SDLC) {
    throw new Error(`Channel ${move.hubChannelId} is not an SDLC hub`);
  }
  // Boards and their tickets live in a project, so a hub can only own release boards
  // of its own project.
  if (hub.projectId !== project.id) {
    throw new Error(`SDLC hub "${hub.name}" belongs to a different project`);
  }

  const projectConfigs = await loadConfigs([project.id]);
  const configs = move.mainBoardId
    ? projectConfigs.filter((config) => config.mainBoard.id === move.mainBoardId)
    : projectConfigs;
  if (configs.length === 0) {
    throw new Error(
      move.mainBoardId
        ? `Board ${move.mainBoardId} is not a main release board of this project`
        : 'Project has no release config'
    );
  }
  const strays = await db.application.count({
    where: { projectId: project.id, mainReleaseBoardId: null },
  });
  if (strays > 0) {
    throw new Error(`${strays} service(s) in this project have no main release board`);
  }
  if (move.repoId && configs.length > 1) {
    throw new Error('repoId needs a single release config: pass mainBoardId');
  }

  const [repos, memberships, releaseLinks, projectBoards] = await Promise.all([
    db.repo.findMany({
      where: { workspaceId: project.workspaceId },
      select: { id: true, name: true, url: true, canonicalUrl: true },
    }),
    db.sdlcEntityLink.findMany({
      where: { channelId: hub.id, relationType: SDLC_MEMBERSHIP_RELATION },
      select: { targetId: true },
    }),
    db.sdlcEntityLink.findMany({
      where: {
        relationType: SDLC_RELEASE_CONFIG_RELATION,
        OR: [
          { channelId: hub.id },
          { targetId: { in: configs.map((config) => config.mainBoard.id) } },
        ],
      },
      select: { channelId: true, sourceId: true, targetId: true },
    }),
    db.board.findMany({ where: { projectId: project.id }, select: { id: true, name: true } }),
  ]);
  const hubRepoIds = new Set(memberships.map((row) => row.targetId));
  const configBoardIds = new Set(
    configs.flatMap((config) => [config.mainBoard.id, ...config.services.map((s) => s.boardId)])
  );
  const hubPart = boardNamePart(hub.name);
  const plannedNames = new Map<string, string>();
  const plannedRepoIds = new Set<string>();

  const plan: MovePlan = {
    projectId: project.id,
    hub: { id: hub.id, name: hub.name },
    configs: [],
  };
  for (const config of configs) {
    const { mainBoard, services } = config;
    const label = `Release board "${mainBoard.name}"`;
    if (!mainBoard.vcsProvider || !mainBoard.releaseTrackingMode) {
      throw new Error(`${label} has no VCS provider or tracking mode`);
    }

    // The hub repository the services are released from: the given one, or the one
    // their URL matches among the repositories attached to the hub.
    let repo: RepoRow;
    if (move.repoId) {
      const given = repos.find((row) => row.id === move.repoId);
      if (!given) throw new Error(`Repository ${move.repoId} is not in this workspace`);
      repo = given;
    } else {
      const candidates = candidateRepos(config, repos);
      const attached = candidates.filter((row) => hubRepoIds.has(row.id));
      if (candidates.length === 0) {
        throw new Error(
          `${label}: no registered repository matches ${uniq(services.map((s) => s.repoUrl)).join(', ') || 'its services'}; register it and attach it to the hub, or pass repoId`
        );
      }
      if (attached.length > 1) {
        throw new Error(`${label}: several repositories attached to the hub match; pass repoId`);
      }
      if (attached.length === 0) {
        throw new Error(
          `${label}: attach ${candidates[0]!.canonicalUrl || candidates[0]!.url} to SDLC hub "${hub.name}" first`
        );
      }
      repo = attached[0]!;
    }
    if (!hubRepoIds.has(repo.id)) {
      throw new Error(
        `${label}: attach ${repo.canonicalUrl || repo.url} to SDLC hub "${hub.name}" first`
      );
    }
    // One release config per hub and repository, and one hub per main release board.
    const boardConfig = releaseLinks.find((row) => row.targetId === mainBoard.id);
    if (boardConfig && (boardConfig.channelId !== hub.id || boardConfig.sourceId !== repo.id)) {
      throw new Error(`${label} is already linked to another SDLC hub or repository`);
    }
    const hubConfig = releaseLinks.find(
      (row) => row.channelId === hub.id && row.sourceId === repo.id
    );
    if (hubConfig && hubConfig.targetId !== mainBoard.id) {
      throw new Error(
        `${label}: SDLC hub "${hub.name}" already has a release config for this repository`
      );
    }
    if (plannedRepoIds.has(repo.id)) {
      throw new Error(
        `${label}: another release config moved to this hub uses the same repository`
      );
    }
    plannedRepoIds.add(repo.id);

    const currentChannelIds = new Set(services.map((service) => service.channelId));
    const releaseChannelId =
      move.releaseChannelId ??
      (currentChannelIds.size === 1 ? ([...currentChannelIds][0] ?? null) : null);
    if (!releaseChannelId) {
      throw new Error(
        `${label}: its services have no single release channel; pass releaseChannelId`
      );
    }
    const releaseChannel = await db.channel.findUnique({
      where: { id: releaseChannelId },
      select: { workspaceId: true },
    });
    if (!releaseChannel || releaseChannel.workspaceId !== project.workspaceId) {
      throw new Error(`${label}: release channel ${releaseChannelId} not found in this workspace`);
    }

    if (!detectVcsProvider(repo.canonicalUrl || repo.url)) {
      throw new Error(
        `${label}: ${repo.canonicalUrl || repo.url} is not a GitHub or Bitbucket repository URL`
      );
    }
    const repoName = repositoryName(repo.canonicalUrl || repo.url);
    if (!repoName)
      throw new Error(`${label}: no repository name in ${repo.canonicalUrl || repo.url}`);
    const targets = [
      {
        boardId: mainBoard.id,
        from: mainBoard.name,
        to: hubPart ? `${repoName}_${hubPart}_release` : `${repoName}_release`,
      },
      ...services.map((service) => {
        if (service.boardName === null) {
          throw new Error(`${label}: the board of service "${service.name}" no longer exists`);
        }
        if (service.boardProjectId !== project.id || service.boardType !== BoardType.RELEASE) {
          throw new Error(
            `${label}: the board of service "${service.name}" is not a release board of this project`
          );
        }
        const regex = service.regex.trim();
        try {
          if (!regex) throw new Error('it is empty');
          new RegExp(regex);
        } catch (error) {
          throw new Error(
            `${label}: service "${service.name}" has an invalid file-path regex (${errorMessage(error)})`
          );
        }
        const servicePart = boardNamePart(service.name);
        if (!servicePart) throw new Error(`${label}: service "${service.name}" has no usable name`);
        return {
          boardId: service.boardId,
          from: service.boardName,
          to: hubPart
            ? `${repoName}_${hubPart}_${servicePart}_release`
            : `${repoName}_${servicePart}_release`,
        };
      }),
    ];
    for (const target of targets) {
      const plannedFor = plannedNames.get(target.to);
      if (plannedFor && plannedFor !== target.boardId) {
        throw new Error(`Two release boards in this project would both be named "${target.to}"`);
      }
      plannedNames.set(target.to, target.boardId);
      const taken = projectBoards.find(
        (board) => board.name === target.to && !configBoardIds.has(board.id)
      );
      if (taken) throw new Error(`A board named "${target.to}" already exists in this project`);
    }

    const formName =
      mainBoard.releaseTrackingMode === ReleaseTrackingMode.VERSION
        ? 'xyne_release_version_specs_form'
        : 'xyne_release_specs_form';
    const form = await db.form.findFirst({
      where: {
        formName,
        contextType: FormContextType.BOARD,
        entityType: FormEntityType.TICKET,
        workspaceId: project.workspaceId,
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!form) {
      throw new Error(
        `Release form "${formName}" is not configured for this workspace; run seed-release.ts`
      );
    }
    const formMapping = await db.formContextMapping.findFirst({
      where: {
        contextId: mainBoard.id,
        contextType: FormContextType.BOARD,
        entityType: FormEntityType.TICKET,
      },
      select: { id: true, formId: true },
    });
    const releaseChannelMapping = await db.channelBoardMapping.findFirst({
      where: { channelId: releaseChannelId, boardId: mainBoard.id },
      select: { id: true },
    });

    plan.configs.push({
      mainBoardId: mainBoard.id,
      workspaceId: mainBoard.workspaceId,
      createdBy: mainBoard.createdBy,
      repo: { id: repo.id, url: repo.canonicalUrl || repo.url },
      releaseChannelId,
      // The hub's Releases tab and Create Release find services by their projectId.
      servicesToUpdate: services.filter(
        (service) =>
          service.repoId !== repo.id ||
          service.channelId !== releaseChannelId ||
          service.projectId !== project.id
      ).length,
      renames: targets.filter((target) => target.from !== target.to),
      createReleaseConfigLink: !boardConfig,
      releaseForm: {
        formId: form.id,
        formName,
        mappingId: formMapping?.id ?? null,
        action: !formMapping ? 'create' : formMapping.formId !== form.id ? 'update' : 'none',
      },
      linkReleaseChannel: !releaseChannelMapping,
    });
  }
  return plan;
}

async function applyMove(plan: MovePlan): Promise<void> {
  await db.$transaction(async (tx) => {
    // Names are unique per project, and one board's new name can be another's old one
    // (a hub named like a service), so every renamed board steps through a free name.
    const renames = plan.configs.flatMap((config) => config.renames);
    for (const rename of renames) {
      await tx.board.update({
        where: { id: rename.boardId },
        data: { name: `${rename.boardId}__renaming` },
      });
    }
    for (const rename of renames) {
      await tx.board.update({ where: { id: rename.boardId }, data: { name: rename.to } });
    }
    for (const config of plan.configs) {
      if (config.servicesToUpdate > 0) {
        await tx.application.updateMany({
          where: { mainReleaseBoardId: config.mainBoardId },
          data: {
            repoId: config.repo.id,
            channelId: config.releaseChannelId,
            projectId: plan.projectId,
          },
        });
      }
      if (config.createReleaseConfigLink) {
        await tx.sdlcEntityLink.create({
          data: {
            workspaceId: config.workspaceId,
            channelId: plan.hub.id,
            sourceType: 'REPOSITORY',
            sourceId: config.repo.id,
            targetType: 'BOARD',
            targetId: config.mainBoardId,
            relationType: SDLC_RELEASE_CONFIG_RELATION,
            createdBy: config.createdBy,
          },
        });
      }
      if (config.releaseForm.action === 'create') {
        await tx.formContextMapping.create({
          data: {
            workspaceId: config.workspaceId,
            formId: config.releaseForm.formId,
            contextId: config.mainBoardId,
            contextType: FormContextType.BOARD,
            entityType: FormEntityType.TICKET,
          },
        });
      } else if (config.releaseForm.action === 'update' && config.releaseForm.mappingId) {
        await tx.formContextMapping.update({
          where: { id: config.releaseForm.mappingId },
          data: { formId: config.releaseForm.formId },
        });
      }
      if (config.linkReleaseChannel) {
        const now = new Date();
        await tx.channelBoardMapping.create({
          data: {
            channelId: config.releaseChannelId,
            boardId: config.mainBoardId,
            workspaceId: config.workspaceId,
            // Never the channel's default: everyday tickets there must not land on it.
            isDefault: false,
            createdBy: config.createdBy,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
    }
  }, TX_OPTIONS);
}

interface RemovePlan {
  projectId: string;
  services: Array<{ id: string; name: string }>;
  mainBoards: Array<{ id: string; name: string }>;
  releaseConfigLinkIds: string[];
  channelBoardLinkIds: string[];
}

/** A project's release configs: its services, their hub edges and their boards' channel links. */
async function planRemove(projectId: string): Promise<RemovePlan> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new Error('Project not found');

  // Configs whose main board is in the project, plus services left without a main board
  // that belong to it. A service pointing at another project's main board belongs to
  // that project's config, whatever its own projectId says.
  const services = await db.application.findMany({
    where: {
      OR: [
        { mainReleaseBoard: { is: { projectId } } },
        {
          mainReleaseBoardId: null,
          OR: [{ projectId }, { applicationBoard: { is: { projectId } } }],
        },
      ],
    },
    select: { id: true, name: true, boardId: true, mainReleaseBoardId: true },
    orderBy: { name: 'asc' },
  });
  const mainBoardIds = uniq(services.map((service) => service.mainReleaseBoardId));
  // Channel links are only touched on this project's own boards.
  const projectBoards = await db.board.findMany({
    where: {
      id: { in: uniq([...mainBoardIds, ...services.map((service) => service.boardId)]) },
      projectId,
    },
    select: { id: true },
  });
  const boardIds = projectBoards.map((board) => board.id);
  const [mainBoards, releaseConfigLinks, channelBoardLinks] = await Promise.all([
    db.board.findMany({
      where: { id: { in: mainBoardIds }, projectId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    db.sdlcEntityLink.findMany({
      where: { relationType: SDLC_RELEASE_CONFIG_RELATION, targetId: { in: mainBoardIds } },
      select: { id: true },
    }),
    db.channelBoardMapping.findMany({ where: { boardId: { in: boardIds } }, select: { id: true } }),
  ]);
  return {
    projectId,
    services: services.map((service) => ({ id: service.id, name: service.name })),
    mainBoards,
    releaseConfigLinkIds: releaseConfigLinks.map((link) => link.id),
    channelBoardLinkIds: channelBoardLinks.map((link) => link.id),
  };
}

async function applyRemove(plan: RemovePlan): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.sdlcEntityLink.deleteMany({ where: { id: { in: plan.releaseConfigLinkIds } } });
    await tx.channelBoardMapping.deleteMany({ where: { id: { in: plan.channelBoardLinkIds } } });
    await tx.application.deleteMany({
      where: { id: { in: plan.services.map((service) => service.id) } },
    });
  }, TX_OPTIONS);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Removes the `remove` projects' release configs (services, hub edges and channel links), then
 * moves the `move` projects' configs to their hubs. A dry run returns what each project would get, after every
 * check, and writes nothing.
 */
export function runReleaseConfigHubBackfill(options: ReleaseConfigHubBackfillOptions) {
  return asSystem(WRITE_TABLES, REASON, async () => {
    const startedAt = Date.now();

    const removed = [];
    for (const projectId of options.remove) {
      try {
        const plan = await planRemove(projectId);
        const pending =
          plan.services.length + plan.releaseConfigLinkIds.length + plan.channelBoardLinkIds.length;
        if (!options.dryRun && pending > 0) {
          await applyRemove(plan);
        }
        const summary = {
          projectId,
          ok: true as const,
          services: plan.services.map((service) => service.name),
          releaseConfigLinks: plan.releaseConfigLinkIds.length,
          channelBoardLinks: plan.channelBoardLinkIds.length,
          // Kept in the project with their tickets and canvases; no config or channel has them now.
          mainBoardsKept: plan.mainBoards.map((board) => board.name),
        };
        logger.info(`${TAG} remove`, { dryRun: options.dryRun, ...summary });
        removed.push(summary);
      } catch (error) {
        logger.error(`${TAG} remove failed`, { projectId, error: errorMessage(error) });
        removed.push({ projectId, ok: false as const, error: errorMessage(error) });
      }
    }

    // What earlier entries of this request take, so a dry run reports the conflicts a
    // real run would hit only once those entries are written.
    const claimedHubRepos = new Map<string, string>();
    const claimedNames = new Map<string, string>();
    const moved = [];
    for (const move of options.move) {
      try {
        const plan = await planMove(move);
        for (const config of plan.configs) {
          const hubRepo = `${plan.hub.id}:${config.repo.id}`;
          const owner = claimedHubRepos.get(hubRepo);
          if (owner && owner !== config.mainBoardId) {
            throw new Error(
              `Another move in this request gives SDLC hub "${plan.hub.name}" a config for ${config.repo.url}`
            );
          }
          for (const rename of config.renames) {
            const holder = claimedNames.get(`${plan.projectId}:${rename.to}`);
            if (holder && holder !== rename.boardId) {
              throw new Error(`Another move in this request already names a board "${rename.to}"`);
            }
          }
        }
        if (!options.dryRun) await applyMove(plan);
        for (const config of plan.configs) {
          claimedHubRepos.set(`${plan.hub.id}:${config.repo.id}`, config.mainBoardId);
          for (const rename of config.renames) {
            claimedNames.set(`${plan.projectId}:${rename.to}`, rename.boardId);
          }
        }
        logger.info(`${TAG} move`, {
          dryRun: options.dryRun,
          projectId: plan.projectId,
          hubChannelId: plan.hub.id,
          configs: plan.configs.length,
        });
        moved.push({ ok: true as const, ...plan });
      } catch (error) {
        logger.error(`${TAG} move failed`, {
          projectId: move.projectId,
          error: errorMessage(error),
        });
        moved.push({ projectId: move.projectId, ok: false as const, error: errorMessage(error) });
      }
    }

    const result = {
      success: true as const,
      dryRun: options.dryRun,
      failed: [...removed, ...moved].filter((row) => !row.ok).length,
      removed,
      moved,
    };
    logger.info(`${TAG} finished`, {
      dryRun: options.dryRun,
      removed: removed.length,
      moved: moved.length,
      failed: result.failed,
      durationMs: Date.now() - startedAt,
    });
    return result;
  });
}

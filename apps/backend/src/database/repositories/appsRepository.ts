import { BaseRepository } from './base';
import { Prisma } from '@prisma/client';
import { vespaQueue } from '@/queues/vespaQueue';
import { appSchema } from '@/vespa/src/types';
import { logger } from '@/utils/logger';
import crypto from 'crypto';
import { encrypt } from '@/services/encryptionService';

export interface CreateAppInput {
  name: string;
  description?: string;
  createdBy: string;
  // Owning org (snapshot of the creator's workspace's org). Apps are always created at ORG scope
  orgId: string;
}

export class AppsRepository extends BaseRepository<
  Prisma.AppsGetPayload<{}>,
  Prisma.AppsUncheckedCreateInput,
  Prisma.AppsUpdateInput
> {
  constructor() {
    super('apps');
  }

  async create(data: Prisma.AppsUncheckedCreateInput) {
    return this.db.apps.create({ data });
  }

  /**
   * Create a new app with duplicate name validation
   */
  async createApp(data: CreateAppInput) {
    // Names only need to be unique WITHIN THE OWNING ORG (apps are org-scoped); a different
    // org may reuse a name.
    const trimmedName = data.name.trim();
    const existingApps = await this.findMany({
      where: {
        name: {
          equals: trimmedName,
          mode: 'insensitive',
        },
        orgId: data.orgId,
      },
    });

    if (existingApps.length > 0) {
      throw new Error(`App with name '${data.name}' already exists.`);
    }

    // Create the app. scope defaults to ORG and version to 1 via the schema. An app-level signing
    // secret is generated up front (encrypted at rest) — it signs the per-install JWT + webhook HMAC.
    const now = new Date();
    const creator = await this.db.user.findUnique({
      where: { id: data.createdBy },
      select: { workspaceId: true },
    });
    if (!creator) {
      throw new Error(`workspaceId required: creator ${data.createdBy} not found`);
    }
    const appData: Prisma.AppsUncheckedCreateInput = {
      name: data.name.trim(),
      description: data.description?.trim() || null,
      createdBy: data.createdBy,
      orgId: data.orgId,
      workspaceId: creator.workspaceId,
      scope: "ORG",
      version: 1,
      signingSecret: await encrypt(crypto.randomBytes(32).toString('hex')),
      createdAt: now,
      updatedAt: now,
    };

    const app = await this.create(appData);

    // Seed the creator as an ADMIN collaborator so every app has an explicit admin who can
    // manage collaborators (the creator also stays an implicit admin as a fallback).
    await this.db.appCollaborator.create({
      data: {
        workspaceId: creator.workspaceId,
        appId: app.id,
        userId: data.createdBy,
        collaboratorType: 'ADMIN',
        createdAt: now,
        updatedAt: now,
      },
    });

    return app;
  }

  async findById(id: string) {
    return this.db.apps.findUnique({ where: { id } });
  }

  /**
   * Bump the app template version. Called on any creator edit to the template
   * (commands/shortcuts/permissions/webhook/description) so installed copies can detect
   * `app.version > installedApp.version` and surface the Update prompt.
   */
  async bumpVersion(appId: string) {
    return this.db.apps.update({
      where: { id: appId },
      data: { version: { increment: 1 }, updatedAt: new Date() },
    });
  }

  async findMany(options?: { where?: Prisma.AppsWhereInput; skip?: number; take?: number; orderBy?: Prisma.AppsOrderByWithRelationInput }) {
    return this.db.apps.findMany(options || {});
  }

  async findUnique(args: Prisma.AppsFindUniqueArgs) {
    return this.db.apps.findUnique(args);
  }

  async update(id: string, data: Prisma.AppsUpdateInput) {
    const dataWithUpdatedAt = {
      ...data,
      updatedAt: new Date(),
    };
    const result = await this.db.apps.update({ where: { id }, data: dataWithUpdatedAt });
    // Re-index the app so column changes that bypass the Zero mutator path propagate
    vespaQueue
      .addJob({ schema: appSchema, jobType: 'feed', docId: id })
      .catch((err) => logger.error(`Failed to queue Vespa re-index for app ${id}:`, err));
    return result;
  }

  async delete(id: string) {
    const result = await this.db.apps.delete({ where: { id } });
    // Queue removal from the Vespa search index.
    vespaQueue
      .addJob({ schema: appSchema, jobType: 'delete', docId: id })
      .catch((err) => logger.error(`Failed to queue Vespa delete for app ${id}:`, err));
    return result;
  }
}

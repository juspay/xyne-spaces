import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { getStorageService } from './storage';
import { DatabaseClient } from '@/database/client';
import { logger } from '../utils/logger';

/**
 * WorkspaceLogoService
 *
 * Owns the workspace logo/profile-image lifecycle. Mirrors the user
 * profile-picture flow (userManagementService.uploadProfilePicture): the image
 * bytes are stored in object storage and only the storage PATH is persisted on
 * the workspace row. The image is served back through a streaming endpoint
 * (GET /api/workspaces/:id/logo), never as a public URL.
 *
 * Because `workspaces` is a Zero-replicated table, writing the `logo` path via
 * Prisma here is picked up by Zero's replication stream and poked to every
 * connected client automatically — the UI updates reactively without a reload.
 */
export class WorkspaceLogoService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = DatabaseClient.getInstance();
  }

  async getWorkspace(workspaceId: string) {
    return this.prisma.workspace.findUnique({ where: { id: workspaceId } });
  }

  /**
   * Upload a new logo for a workspace and persist its storage path.
   * Returns the storage path written to `workspaces.logo`.
   */
  async uploadWorkspaceLogo(workspaceId: string, file: Express.Multer.File): Promise<string> {
    try {
      const timestamp = Date.now();
      const uuid = uuidv4();
      const filename = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = `workspace-logos/${workspaceId}/${timestamp}-${uuid}-${filename}`;

      const uploadResult = await getStorageService().uploadFile(file.buffer, {
        filename: filePath,
        contentType: file.mimetype,
        metadata: {
          workspaceId,
          originalName: file.originalname,
          uploadedAt: new Date().toISOString(),
        },
      });

      // Store only the storage path (not a full URL); served via streaming endpoint.
      await this.prisma.workspace.update({
        where: { id: workspaceId },
        data: { logo: uploadResult.path },
      });

      logger.info(`Workspace logo uploaded for workspace ${workspaceId}`, {
        filePath: uploadResult.path,
      });
      return uploadResult.path;
    } catch (error) {
      logger.error(`Error uploading workspace logo for workspace ${workspaceId}:`, error);
      throw error;
    }
  }

  /**
   * Clear a workspace's logo. Best-effort deletes the stored object, then
   * always nulls the column so the row is consistent even if the blob delete
   * fails.
   */
  async deleteWorkspaceLogo(workspaceId: string): Promise<void> {
    try {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { logo: true },
      });

      if (workspace?.logo) {
        try {
          await getStorageService().deleteFile(workspace.logo);
        } catch (deleteError) {
          logger.warn(`Failed to delete workspace logo object for ${workspaceId}, clearing column anyway`, {
            error: deleteError,
          });
        }
      }

      await this.prisma.workspace.update({
        where: { id: workspaceId },
        data: { logo: null },
      });

      logger.info(`Workspace logo cleared for workspace ${workspaceId}`);
    } catch (error) {
      logger.error(`Error deleting workspace logo for workspace ${workspaceId}:`, error);
      throw error;
    }
  }
}

export const workspaceLogoService = new WorkspaceLogoService();

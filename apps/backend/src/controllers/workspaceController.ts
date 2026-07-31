import { Request, Response } from 'express';
import { WorkspaceRole } from '@prisma/client';
import { workspaceLogoService } from '../services/workspaceLogoService';
import { getStorageService } from '../services/storage';
import { logger } from '../utils/logger';

const storageService = getStorageService();

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * WorkspaceController — workspace logo/profile-image endpoints.
 *
 * SECURITY: these endpoints write `workspaces.logo` directly via Prisma and
 * therefore BYPASS the Zero mutation ACL (WorkspacesACL) that normally guards
 * workspace edits. Because the logo is a shared resource, the mutating routes
 * must independently enforce that the caller is an ADMIN/OWNER of the SAME
 * workspace named in the path — mirroring both checks the Zero ACL performs
 * (verifyWorkspaceAdminOrOwnerFromContext + workspaceId match).
 */
export class WorkspaceController {
  /**
   * Assert the caller is an ADMIN/OWNER of the workspace identified by :id.
   * Returns true when authorized; otherwise writes the response and returns false.
   */
  private assertWorkspaceAdmin(req: Request, res: Response): boolean {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return false;
    }

    const { id } = req.params;
    // An admin may only manage the logo of their own current workspace.
    if (!id || id !== user.workspaceId) {
      res.status(403).json({ error: 'Cannot modify a workspace you are not a member of' });
      return false;
    }

    if (user.role !== WorkspaceRole.ADMIN && user.role !== WorkspaceRole.OWNER) {
      res.status(403).json({ error: 'Only workspace admins can change the workspace logo' });
      return false;
    }

    return true;
  }

  /**
   * POST /api/workspaces/:id/logo
   * Upload / replace the workspace logo. Admin/owner only.
   */
  uploadLogo = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!this.assertWorkspaceAdmin(req, res)) return;

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'No file provided' });
        return;
      }

      if (!ALLOWED_TYPES.includes(file.mimetype)) {
        res.status(400).json({ error: 'Invalid file type. Only JPG, PNG, and WebP are allowed.' });
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        res.status(413).json({ error: 'File too large. Maximum size is 5MB.' });
        return;
      }

      const logoPath = await workspaceLogoService.uploadWorkspaceLogo(req.params.id, file);
      res.status(200).json({ logo: logoPath });
    } catch (error) {
      logger.error('Error uploading workspace logo:', error);
      res.status(500).json({ error: 'Failed to upload workspace logo' });
    }
  };

  /**
   * DELETE /api/workspaces/:id/logo
   * Remove the workspace logo. Admin/owner only.
   */
  deleteLogo = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!this.assertWorkspaceAdmin(req, res)) return;

      await workspaceLogoService.deleteWorkspaceLogo(req.params.id);
      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('Error deleting workspace logo:', error);
      res.status(500).json({ error: 'Failed to delete workspace logo' });
    }
  };

  /**
   * GET /api/workspaces/:id/logo
   * Stream the workspace logo. Readable by any authenticated member.
   *
   * Cache strategy mirrors the user profile-picture endpoint: the stored path
   * includes a timestamp and changes on every upload, so a long-lived cache is
   * safe (a new logo => new path => new URL).
   */
  streamLogo = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const workspace = await workspaceLogoService.getWorkspace(id);

      if (!workspace?.logo) {
        res.status(404).json({ error: 'Workspace logo not found' });
        return;
      }

      const storagePath = workspace.logo;
      const fileExists = await storageService.fileExists(storagePath);
      if (!fileExists) {
        res.status(404).json({ error: 'Workspace logo file not found' });
        return;
      }

      const metadata = await storageService.getFileMetadata(storagePath);
      const contentType = metadata.contentType || 'image/png';
      const fileSize = parseInt(String(metadata.size || '0'), 10);

      res.setHeader('Content-Type', contentType);
      if (fileSize > 0) res.setHeader('Content-Length', fileSize);
      res.setHeader('Cache-Control', 'public, max-age=31536000');

      const stream = await storageService.createReadStream(storagePath);
      stream.pipe(res);

      stream.on('error', (error: Error) => {
        logger.error('Stream error for workspace logo:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to stream workspace logo' });
        }
      });
    } catch (error) {
      logger.error('Error streaming workspace logo:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream workspace logo' });
      }
    }
  };
}

export const workspaceController = new WorkspaceController();

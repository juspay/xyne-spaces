import { Request, Response } from 'express';
import { OrganizationRepository } from '../database/repositories/organizationRepository';
import { DatabaseClient } from '../database/client';
import { logger } from '@/utils/logger';
import { invitationService } from '@/services/invitationService';
import { aiProvisioningService } from '@/services/aiProvisioningService';
import { isOrganizationPolicyError, organizationDomainService } from '@/services/organizationDomainService';
import { buildInvitationLink } from '@/controllers/invitationController';
import { getEncryptionProvider } from '@/services/encryption';
import { createId } from '@paralleldrive/cuid2';
import { createOrganizationWithWorkspace, createOwnerInvitation } from '@/bypassAcl/orgServices';

export class OrganizationController {
  private organizationRepository: OrganizationRepository;

  constructor() {
    this.organizationRepository = new OrganizationRepository();
  }

  // Helper method to get user info
  // POST /api/organizations - Create new organization with workspace, owner, and invitation
  createOrganization = async (req: Request, res: Response): Promise<void> => {
    const db = DatabaseClient.getInstance();
    try {
      const {
        name,
        description,
        workspaceName,
        ownerEmail }: {
        name: string;
        description?: string;
        workspaceName: string;
        ownerEmail: string;
      } = req.body;

      const userId = req.user!.id;
      const currentUser = await db.user.findUnique({
        where: { id: userId },
        select: { role: true } });
      if (currentUser?.role === 'GUEST') {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Guest users cannot create organizations' });
        return;
      }

      // Validate required fields
      if (!name || name.trim() === '') {
        res.status(400).json({ error: 'Organization name is required' });
        return;
      }
      if (!workspaceName || workspaceName.trim() === '') {
        res.status(400).json({ error: 'Workspace name is required' });
        return;
      }
      if (!ownerEmail || ownerEmail.trim() === '') {
        res.status(400).json({ error: 'Owner email is required' });
        return;
      }

      await organizationDomainService.assertCanCreateOrgForEmail(ownerEmail.trim());

      // Check if organization name already exists
      const existingOrg = await this.organizationRepository.findByName(name.trim());
      if (existingOrg) {
        res.status(409).json({ error: 'Organization name already exists' });
        return;
      }

      const orgId = createId();
      try {
        await getEncryptionProvider().initializeOrg(orgId);
      } catch (error) {
        logger.error('Failed to initialize org encryption before organization creation', {
          orgId,
          error: error instanceof Error ? error.message : String(error) });
        throw error;
      }

      const { organization, workspace } = await createOrganizationWithWorkspace(
        orgId,
        name,
        description,
        userId,
        workspaceName,
        ownerEmail,
      );

      await organizationDomainService.createDomainMappingForOrg({
        orgId: organization.orgId,
        email: ownerEmail.trim(),
        verifiedByUserId: userId });

      const invitation = await createOwnerInvitation(ownerEmail, workspace.id, userId, organization.orgId);

      await invitationService.sendInvitationEmail({
        to: ownerEmail.trim(),
        inviterName: req.user!.name || 'Admin',
        workspaceName: workspaceName.trim(),
        invitationLink: await buildInvitationLink({ req, workspaceId: workspace.id, invitationId: invitation.invitationId || invitation.id }),
        invitationId: invitation.invitationId || invitation.id });

      try {
        await aiProvisioningService.enqueueOrgSync(organization.orgId);
        await aiProvisioningService.enqueueWorkspaceSync(workspace.id);
      } catch (error) {
        logger.error('[OrganizationController] Failed to enqueue AI provisioning jobs', {
          orgId: organization.orgId,
          workspaceId: workspace.id,
          error });
      }

      res.status(201).json({
        orgId: organization.orgId,
        name: organization.name,
        description: organization.description,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        ownerEmail: ownerEmail.trim().toLowerCase(),
        invitationSent: true });
    } catch (error) {
      logger.error('Error creating organization:', error);
      if (isOrganizationPolicyError(error)) {
        res.status(error.statusCode).json({
          error: error.message,
          code: error.code,
          ...(error instanceof Error && 'domain' in error ? { domain: error.domain } : {}),
          ...(error instanceof Error && 'existingOrg' in error ? { existingOrg: error.existingOrg } : {}) });
        return;
      }

      if (error instanceof Error && error.message.includes('already exists')) {
        res.status(409).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  // GET /api/organizations - List user's organizations
}

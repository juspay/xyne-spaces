import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { BoardType, type Channel, type TicketStatusV2 } from '@prisma/client';
import { formService } from '../formService';
import { FormContextType, FormEntityType, LookupType, type FieldEnumOption } from '@xyne/shared';
import { randomUUID } from 'crypto';
import { XyneChangeType, XyneFormSchemaProvider } from './xyne/xyneReleaseForm';
import { BaseTicketType } from '@xyne/shared';
import { EntitySequenceService } from '@/services/entitySequenceService';

interface ApplicationData {
  name: string;
  regex: string;
  repoUrl: string;
  deployedCommit: string;
  ownerTeam: string;
}

const toFieldEnum = (
  options: readonly { readonly value: string; readonly label: string }[] | undefined,
): FieldEnumOption[] | undefined =>
  options?.map(option => ({ id: randomUUID(), value: option.value }));

export class ApplicationBackfillService {
  private async getChannel(channelId: string): Promise<Channel | undefined> {
    logger.info(`Looking for channel: ${channelId}`);

    const channel = await db.channel.findUnique({
      where: { id: channelId },
    });

    if (channel) {
      logger.info(`Found channel: ${channel.id} (${channel.name})`);
      return channel;
    }

    logger.warn(`Channel not found: ${channelId}`);
    return undefined;
  }

  private async createDefaultStages(boardId: string, createdBy: string, workspaceId: string): Promise<void> {
    const defaultStages = [
      { name: 'TODO', eta: 1, defaultTicketStatusV2: 'TODO' as TicketStatusV2 },
      { name: 'IN-PROGRESS', eta: 2, defaultTicketStatusV2: 'STARTED' as TicketStatusV2 },
      { name: 'COMPLETED', eta: 3, defaultTicketStatusV2: 'COMPLETED' as TicketStatusV2 },
    ];

    let currentMaxStageSequence = 0;
    for (const stage of defaultStages) {
      const sequenceNumber = await EntitySequenceService.getNextBoardStageSequence(
        boardId,
        currentMaxStageSequence,
      );
      currentMaxStageSequence = Math.max(currentMaxStageSequence, sequenceNumber);
      await db.stage.create({
        data: {
          boardId,
          workspaceId,
          name: stage.name,
          eta: stage.eta,
          sequenceNumber,
          defaultTicketStatusV2: stage.defaultTicketStatusV2,
          createdBy,
          createdAt: new Date(),
        },
      });
      logger.info(`Created stage: ${stage.name} for board: ${boardId}`);
    }
  }

  async backFillReleaseChangeTypes(applicationId: string, workspaceId: string): Promise<void> {

    logger.info(`Setting up ReleaseChangeTypes for application: ${applicationId}...`);
    // Create or get MIGRATION ReleaseChangeType
    let migrationChangeType = await db.releaseChangeType.findFirst({
      where: { changeType: XyneChangeType.MIGRATION, applicationId },
    });

    if (!migrationChangeType) {
      migrationChangeType = await db.releaseChangeType.create({
        data: { changeType: XyneChangeType.MIGRATION, applicationId, workspaceId, createdAt: new Date() },
      });
      logger.info(`Created ReleaseChangeType: MIGRATION (${migrationChangeType.id})`);
    }

    let envChangeType = await db.releaseChangeType.findFirst({
      where: { changeType: XyneChangeType.ENV, applicationId },
    });

    if (!envChangeType) {
      envChangeType = await db.releaseChangeType.create({
        data: { changeType: XyneChangeType.ENV, applicationId, workspaceId, createdAt: new Date() },
      });
      logger.info(`Created ReleaseChangeType: ENV (${envChangeType.id})`);
    }
  }

  async backFillReleaseForms(createdBy: string, workspaceId: string, projectId: string): Promise<void> {
    logger.info('Setting up forms...');

    // Create or get MIGRATION form
    const MIGRATION_FORM_NAME = 'xyne_release_migration_form';
    let migrationForm = await db.form.findFirst({
      where: {
        formName: MIGRATION_FORM_NAME,
        contextType: FormContextType.RELEASE_CHANGE,
        entityType: FormEntityType.RELEASE_MIGRATION_FORM,
      },
    });

    if (!migrationForm) {
      const formSchema = new XyneFormSchemaProvider().getFormSchema(XyneChangeType.MIGRATION);
      if (formSchema) {
        migrationForm = await formService.createFormWithFields({
          formName: MIGRATION_FORM_NAME,
          formDescription: 'Form for tracking database migrations in releases',
          entityType: FormEntityType.RELEASE_MIGRATION_FORM,
          contextType: FormContextType.RELEASE_CHANGE,
          projectId,
          workspaceId,
          createdBy,
          fields: formSchema.fields.map(field => ({
            fieldName: field.name,
            fieldType: field.type,
            fieldOptions: toFieldEnum(field.options),
            isOptional: !field.required,
          })),
        });
        logger.info(`Created MIGRATION form: ${migrationForm.id}`);
      }
    }

    // Create or get ENV form
    const ENV_FORM_NAME = 'xyne_release_env_form';
    let envForm = await db.form.findFirst({
      where: {
        formName: ENV_FORM_NAME,
        contextType: FormContextType.RELEASE_CHANGE,
        entityType: FormEntityType.RELEASE_ENV_FORM,
      },
    });

    if (!envForm) {
      const formSchema = new XyneFormSchemaProvider().getFormSchema(XyneChangeType.ENV);
      if (formSchema) {
        envForm = await formService.createFormWithFields({
          formName: ENV_FORM_NAME,
          formDescription: 'Form for tracking environment variable changes in releases',
          entityType: FormEntityType.RELEASE_ENV_FORM,
          contextType: FormContextType.RELEASE_CHANGE,
          projectId,
          workspaceId,
          createdBy,
          fields: formSchema.fields.map(field => ({
            fieldName: field.name,
            fieldType: field.type,
            fieldOptions: toFieldEnum(field.options),
            isOptional: !field.required,
          })),
        });
        logger.info(`Created ENV form: ${envForm.id}`);
      }
    }

    // Create or get release specs form
    const RELEASE_SPEC_FORM_NAME = 'xyne_release_specs_form';
    let releaseSpecsForm = await db.form.findFirst({
      where: {
        formName: RELEASE_SPEC_FORM_NAME,
        contextType: FormContextType.BOARD,
        entityType: FormEntityType.TICKET,
      },
    });

    if (!releaseSpecsForm) {
      const formSchema = new XyneFormSchemaProvider().getFormSchema(XyneChangeType.DEPLOYEDMENT_SPECS);
      if (formSchema) {
        releaseSpecsForm = await formService.createFormWithFields({
          formName: RELEASE_SPEC_FORM_NAME,
          formDescription: 'Form for getting release specs',
          entityType: FormEntityType.TICKET,
          contextType: FormContextType.BOARD,
          projectId,
          workspaceId,
          createdBy,
          fields: formSchema.fields.map(field => ({
            fieldName: field.name,
            fieldType: field.type,
            fieldOptions: toFieldEnum(field.options),
            isOptional: !field.required,
          })),
        });
        logger.info(`Created release specs form: ${releaseSpecsForm.id}`);
      }
    }

    logger.info('ReleaseChangeType setup completed successfully');
  }

  async backFillTicketTypeLookups(): Promise<void> {
    logger.info('Setting up TICKET_TYPE lookup values...');

    const ticketTypes = Object.values(BaseTicketType);

    // Get existing lookup values in one query
    const existingLookups = await db.lookupValue.findMany({
      where: {
        type: LookupType.TICKET_TYPE,
        value: { in: ticketTypes },
      },
    });

    const existingValues = new Set(existingLookups.map(lookup => lookup.value));

    // Prepare data for new lookup values
    const newLookupData = ticketTypes
      .filter(ticketType => !existingValues.has(ticketType))
      .map(ticketType => ({
        type: LookupType.TICKET_TYPE,
        value: ticketType,
      }));

    if (newLookupData.length > 0) {
      // Use createMany for batch insert
      await db.lookupValue.createMany({
        data: newLookupData,
      });

      logger.info(`Created ${newLookupData.length} new TICKET_TYPE lookup values`);
    }

    logger.info('TICKET_TYPE lookup values setup completed successfully');
  }

  async backfillApplications(
    applications: ApplicationData[],
    channelId: string,
    mainReleaseBoardId: string,
    createdBy: string,
    callerWorkspaceId: string
  ) {
    logger.info('Starting application backfill...');

    try {
      // Validate and get channel if provided
      let validChannel: Channel | undefined;
      if (channelId) {
        validChannel = await this.getChannel(channelId);
        if (!validChannel) {
          throw new Error(`Provided channelId "${channelId}" not found. Applications will be created without a channel.`);
        }
      } else {
        throw new Error('No channelId provided. Applications will be created without a channel.');
      }

      // Tenant isolation: the channel resolves the target workspace/project, so it
      // must belong to the caller's workspace. Guards against a caller in workspace
      // A injecting records into workspace B by supplying B's channelId.
      if (validChannel.workspaceId !== callerWorkspaceId) {
        throw new Error(
          `Channel "${channelId}" does not belong to the caller's workspace.`
        );
      }

      // Setup ReleaseChangeType, forms, and lookup values first
      await this.backFillReleaseForms(createdBy, validChannel.workspaceId, validChannel.projectId);
      await this.backFillTicketTypeLookups();

      const mainReleaseBoard = await db.board.findFirst({
        where: {
          id: mainReleaseBoardId,
          projectId: validChannel.projectId,
          boardType: BoardType.RELEASE,
        },
      });
      if (!mainReleaseBoard) {
        throw new Error('mainReleaseBoardId must reference a RELEASE board in the channel project');
      }

      logger.info('Creating applications...');

      const createdApps: string[] = [];
      const skippedApps: string[] = [];

      for (const app of applications) {
        logger.info(`Processing: ${app.name}`);

        // Check if application already exists
        const existing = await db.application.findFirst({
          where: {
            name: app.name,
            channelId: channelId,
          },
        });

        if (existing) {
          logger.info(`Application "${app.name}" already exists, skipping...`);
          skippedApps.push(app.name);
          continue;
        }

        // Create or find the board for this application
        const boardName = `${app.name}_release`;
        let board = await db.board.findFirst({
          where: {
            name: boardName,
            projectId: validChannel.projectId,
          },
        });

        if (!board) {
          // Fetch project to get workspaceId
          const project = await db.project.findUnique({
            where: { id: validChannel.projectId },
            select: { workspaceId: true },
          });
          if (!project) {
            throw new Error('Project not found');
          }

          board = await db.board.create({
            data: {
              name: boardName,
              projectId: validChannel.projectId,
              workspaceId: project.workspaceId,
              createdBy,
              createdAt: new Date(),
              boardType: BoardType.RELEASE
            },
          });
          logger.info(`Created board: ${boardName} (${board.id})`);

          // Create default stages for the new board
          await this.createDefaultStages(board.id, createdBy, project.workspaceId);
        } else {
          logger.info(`Board "${boardName}" already exists, using existing board (${board.id})`);
        }

        // Create the application with the boardId
        const application = await db.application.create({
          data: {
            name: app.name,
            projectId: validChannel.projectId,
            workspaceId: validChannel.workspaceId,
            boardId: board.id,
            mainReleaseBoardId,
            channelId: validChannel.id,
            regex: app.regex,
            repoUrl: app.repoUrl,
            deployedCommit: app.deployedCommit,
            ownerTeam: app.ownerTeam,
            createdAt: new Date(),
            lastDeployedAt: new Date(),
          },
        });
        await this.backFillReleaseChangeTypes(application.id, validChannel.workspaceId);
        logger.info(`Created application: ${application.id} linked to board: ${board.id}`);
        createdApps.push(app.name);
      }

      logger.info('Application backfill completed successfully!');

      // Get summary
      const totalApps = await db.application.count({
        where: { projectId: validChannel?.projectId },
      });

      const allApps = await db.application.findMany({
        where: { projectId: validChannel?.projectId },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          regex: true,
          ownerTeam: true,
        },
      });

      return {
        success: true,
        summary: {
          totalApplications: totalApps,
          created: createdApps.length,
          skipped: skippedApps.length,
          projectId: validChannel?.projectId,
          channelId: validChannel?.id,
        },
        applications: allApps,
        createdApps,
        skippedApps,
      };
    } catch (error) {
      logger.error('Application backfill failed:', error);
      throw error;
    }
  }
}

export const applicationBackfillService = new ApplicationBackfillService();

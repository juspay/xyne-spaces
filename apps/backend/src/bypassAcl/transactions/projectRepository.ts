import { transaction } from '../base';
import { ProjectRepository, CreateProjectInput } from '@/database/repositories/projectRepository';
import { ProjectType, TicketStatusV2 } from '@xyne/shared';


export function createTx(self: ProjectRepository, data: CreateProjectInput) {
  return transaction(['Board', 'Project', 'Stage'], 'create: project, default board and default stages must commit atomically; tx is not ACL-wrapped', self.db, async (tx) => {
    const project = await tx.project.create({
      data: {
        name: data.name,
        description: data.description,
        createdBy: data.createdBy,
        code: data.code,
        type: ProjectType.DEFAULT,
        workspace: { connect: { id: data.workspaceId } },
      }
    });

    // Automatically create a default board for the project
    const board = await tx.board.create({
      data: {
        name: data.name,
        projectId: project.id,
        workspaceId: data.workspaceId,
        createdBy: data.createdBy,
      }
    });

    // Create default stages for the board with proper status mappings
    await tx.stage.createMany({
      data: [
        {
          name: 'To Do',
          sequenceNumber: 1,
          boardId: board.id,
          workspaceId: board.workspaceId,
          createdBy: data.createdBy,
          defaultTicketStatusV2: TicketStatusV2.TODO,
        },
        {
          name: 'In Progress',
          sequenceNumber: 2,
          boardId: board.id,
          workspaceId: board.workspaceId,
          createdBy: data.createdBy,
          defaultTicketStatusV2: TicketStatusV2.STARTED,
        },
        {
          name: 'Review',
          sequenceNumber: 3,
          boardId: board.id,
          workspaceId: board.workspaceId,
          createdBy: data.createdBy,
          defaultTicketStatusV2: TicketStatusV2.STARTED,
        },
        {
          name: 'Completed',
          sequenceNumber: 4,
          boardId: board.id,
          workspaceId: board.workspaceId,
          createdBy: data.createdBy,
          defaultTicketStatusV2: TicketStatusV2.COMPLETED,
        },
      ]
    });

    return project;
  });
}

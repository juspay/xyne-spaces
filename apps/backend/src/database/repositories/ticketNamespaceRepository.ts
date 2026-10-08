import { PrismaClient, TicketNamespace } from '@prisma/client';
import { DatabaseClient } from '@/database/client';
import { isTicketCodeTaken } from '@/utils/ticketNamespaceUtils';

export interface CreateTicketNamespaceInput {
  workspaceId: string;
  projectId: string;
  code: string;
  name?: string;
  createdBy: string;
}

export class TicketNamespaceRepository {
  private db: PrismaClient;

  constructor() {
    this.db = DatabaseClient.getInstance();
  }

  async findById(id: string): Promise<TicketNamespace | null> {
    return this.db.ticketNamespace.findUnique({ where: { id } });
  }

  // A code is workspace-unique across namespaces AND (until Project.code is dropped)
  // across project codes, so a new namespace can never shadow a legacy project prefix.
  async isCodeAvailable(code: string, workspaceId: string): Promise<boolean> {
    return !(await isTicketCodeTaken(this.db, code, workspaceId));
  }

  async create(data: CreateTicketNamespaceInput): Promise<TicketNamespace> {
    const now = new Date();
    return this.db.ticketNamespace.create({
      data: {
        code: data.code,
        name: data.name,
        workspaceId: data.workspaceId,
        projectId: data.projectId,
        createdBy: data.createdBy,
        ticketSequence: 0,
        createdAt: now,
        updatedAt: now,
      },
    });
  }
}

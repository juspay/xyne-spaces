import { PrismaClient, TicketNamespace } from '@prisma/client';
import { DatabaseClient } from '@/database/client';

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
    const [namespace, project] = await Promise.all([
      this.db.ticketNamespace.findFirst({ where: { code, workspaceId }, select: { id: true } }),
      this.db.project.findFirst({ where: { code, workspaceId }, select: { id: true } }),
    ]);
    return !namespace && !project;
  }

  async create(data: CreateTicketNamespaceInput): Promise<TicketNamespace> {
    return this.db.ticketNamespace.create({
      data: {
        code: data.code,
        name: data.name,
        workspaceId: data.workspaceId,
        projectId: data.projectId,
        createdBy: data.createdBy,
      },
    });
  }
}

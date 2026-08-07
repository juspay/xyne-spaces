import type { Prisma, SummaryTemplate } from '@prisma/client';
import { DatabaseClient } from '@/database/client';

export class SummaryTemplateRepository {
  private readonly db = DatabaseClient.getInstance();

  findById(id: string): Promise<SummaryTemplate | null> {
    return this.db.summaryTemplate.findUnique({ where: { id } });
  }

  listByWorkspace(workspaceId: string): Promise<SummaryTemplate[]> {
    return this.db.summaryTemplate.findMany({
      where: { workspaceId },
      orderBy: [{ name: 'asc' }, { version: 'desc' }, { id: 'asc' }],
    });
  }

  create(data: Prisma.SummaryTemplateUncheckedCreateInput): Promise<SummaryTemplate> {
    return this.db.summaryTemplate.create({ data });
  }

  update(id: string, data: Prisma.SummaryTemplateUncheckedUpdateInput): Promise<SummaryTemplate> {
    return this.db.summaryTemplate.update({ where: { id }, data });
  }
}

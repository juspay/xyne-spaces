import { Prisma, PrismaClient } from '@prisma/client';

type PrismaClientLike = PrismaClient | Prisma.TransactionClient;

// On once any namespace row exists; the backfill writes the first ones. Gated write
// paths check this so nothing creates a namespace before the backfill — which keeps
// the replication delta safe.
export async function ticketNamespacesActivated(db: PrismaClientLike): Promise<boolean> {
  const existing = await db.ticketNamespace.findFirst({ select: { id: true } });
  return existing !== null;
}

// Ticket codes are unique per workspace across project codes and namespace codes
export async function isTicketCodeTaken(
  db: PrismaClientLike,
  code: string,
  workspaceId: string,
): Promise<boolean> {
  const [project, namespace] = await Promise.all([
    db.project.findFirst({ where: { code, workspaceId }, select: { id: true } }),
    db.ticketNamespace.findFirst({ where: { code, workspaceId }, select: { id: true } }),
  ]);
  return project !== null || namespace !== null;
}

// Creates a project's default namespace, sets it as the project default, and links the
// project's boards. Returns null (writes nothing) until the feature is activated, so a
// project created before the backfill falls back to project.code + PROJECT_TICKET.
export async function createDefaultTicketNamespace(
  db: PrismaClientLike,
  params: { workspaceId: string; projectId: string; code: string; createdBy: string },
): Promise<{ id: string } | null> {
  if (!(await ticketNamespacesActivated(db))) {
    return null;
  }

  const now = new Date();
  const namespace = await db.ticketNamespace.create({
    data: {
      code: params.code,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      createdBy: params.createdBy,
      ticketSequence: 0,
      createdAt: now,
      updatedAt: now,
    },
    select: { id: true },
  });

  await db.project.update({
    where: { id: params.projectId },
    data: { defaultTicketNamespaceId: namespace.id },
  });

  await db.board.updateMany({
    where: { projectId: params.projectId, ticketNamespaceId: null },
    data: { ticketNamespaceId: namespace.id },
  });

  return namespace;
}

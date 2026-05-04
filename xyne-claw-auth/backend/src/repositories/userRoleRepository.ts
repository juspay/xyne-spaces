import { prisma } from "../db.js";

export const userRoleRepository = {
  findByUserAndRole: (userId: string, role: string) =>
    prisma.userRole.findUnique({ where: { userId_role: { userId, role } } }),

  listByRole: (role: string) =>
    prisma.userRole.findMany({
      where: { role },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),

  upsert: (userId: string, role: string, grantedBy: string) =>
    prisma.userRole.upsert({
      where: { userId_role: { userId, role } },
      create: { userId, role, grantedBy },
      update: { grantedBy },
      include: { user: { select: { id: true, name: true, email: true } } },
    }),

  delete: (userId: string, role: string) =>
    prisma.userRole.delete({ where: { userId_role: { userId, role } } }),
};

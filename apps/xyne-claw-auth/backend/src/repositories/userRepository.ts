import { prisma } from "../db.js";

export const userRepository = {
  findById: (id: string) =>
    prisma.user.findUnique({ where: { id } }),

  findByIdSelect: (id: string, select: Record<string, boolean>) =>
    prisma.user.findUnique({ where: { id }, select }),

  findByEmail: (email: string) =>
    prisma.user.findFirst({ where: { email } }),

  findByIds: (ids: string[]) =>
    ids.length === 0 ? Promise.resolve([]) : prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }),
};

import { prisma } from "../db.js";

export const userRepository = {
  async findById(id: string) {
    const exact = await prisma.user.findUnique({ where: { id } });
    if (exact) return exact;

    const identity = await prisma.userSurfaceIdentity.findFirst({
      where: { surfaceId: "spaces", surfaceUserId: id, status: "ACTIVE", userId: { not: null } },
      include: { user: true },
      orderBy: { updatedAt: "desc" },
    });
    return identity?.user ?? null;
  },

  async findByIdSelect(id: string, select: Record<string, boolean>) {
    const exact = await prisma.user.findUnique({ where: { id }, select });
    if (exact) return exact;

    const identity = await prisma.userSurfaceIdentity.findFirst({
      where: { surfaceId: "spaces", surfaceUserId: id, status: "ACTIVE", userId: { not: null } },
      select: { user: { select } },
      orderBy: { updatedAt: "desc" },
    });
    return identity?.user ?? null;
  },

  findByEmail: (email: string) =>
    prisma.user.findFirst({ where: { email } }),

  async findByIds(ids: string[]) {
    if (ids.length === 0) return [];

    const found = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, email: true },
    });
    const byId = new Map(found.map((user) => [user.id, user]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length === 0) return found;

    const identities = await prisma.userSurfaceIdentity.findMany({
      where: {
        surfaceId: "spaces",
        surfaceUserId: { in: missing },
        status: "ACTIVE",
        userId: { not: null },
      },
      select: { user: { select: { id: true, name: true, email: true } } },
    });
    for (const identity of identities) {
      if (identity.user && !byId.has(identity.user.id)) byId.set(identity.user.id, identity.user);
    }
    return [...byId.values()];
  },
};

import catalogData from '@/fixtures/catalog.json';

export type UserRole = 'admin' | 'user';

export interface UserCatalogEntry {
  alias: string;
  role: UserRole;
  email: string;
}

interface UserCatalogFile {
  users: UserCatalogEntry[];
}

const userCatalog = new Map<string, UserCatalogEntry>();

for (const user of (catalogData as UserCatalogFile).users) {
  userCatalog.set(user.alias, user);
}

export function getUserCatalog(): ReadonlyMap<string, UserCatalogEntry> {
  return userCatalog;
}

export function getUserCatalogEntry(userAlias: string): UserCatalogEntry {
  const user = userCatalog.get(userAlias);
  if (!user) {
    throw new Error(
      `Unknown user alias "${userAlias}". Available users: ${[...userCatalog.keys()].join(', ')}`
    );
  }

  return user;
}

export function getUserAliases(): string[] {
  return [...userCatalog.keys()];
}

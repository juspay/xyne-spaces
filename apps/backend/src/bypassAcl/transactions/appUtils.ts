import { transaction } from '../base';
import { db } from '@/database/client';


export function syncInstalledCommandsTx(appId: string, installedAppId: string, workspaceId: string) {
  return transaction(['AppCommand', 'InstalledAppCommand'], 'syncInstalledCommands: installed command sync, update and prune must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const now = new Date();
    const [templateCommands, existing] = await Promise.all([
      tx.appCommand.findMany({ where: { appId } }),
      tx.installedAppCommand.findMany({ where: { installedAppId } }),
    ]);
    const existingBySource = new Map(existing.map(e => [e.sourceCommandId, e]));
    const templateIds = new Set(templateCommands.map(c => c.id));

    for (const c of templateCommands) {
      const prev = existingBySource.get(c.id);
      if (prev) {
        await tx.installedAppCommand.update({
          where: { id: prev.id },
          data: {
            commandName: c.commandName,
            description: c.description,
            commandType: c.commandType,
            commandAccessibility: c.commandAccessibility,
            updatedAt: now,
          },
        });
      } else {
        await tx.installedAppCommand.create({
          data: {
            installedAppId,
            workspaceId,
            sourceCommandId: c.id,
            commandName: c.commandName,
            description: c.description,
            commandType: c.commandType,
            commandAccessibility: c.commandAccessibility,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
    }

    for (const e of existing) {
      if (!templateIds.has(e.sourceCommandId)) {
        await tx.installedAppCommand.delete({ where: { id: e.id } });
      }
    }
  });
}

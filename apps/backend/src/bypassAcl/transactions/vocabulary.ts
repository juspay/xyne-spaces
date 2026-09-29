import { db } from '@/database/client';
import { VocabularyInput, approvedNames, suppression, retireCandidates } from '@/services/messageClassification/vocabulary';
import { transaction } from '../base';
export function setThreadTypeVocabularyTx(workspaceId: string, keep: Set<string>, key: { scope: string; scopeId: string; }, userId: string, now: Date, entries: VocabularyInput[]) {
  return transaction(['ThreadTypeVocabulary'], 'setThreadTypeVocabulary: vocabulary replacement with suppression and retirement must commit atomically; tx is not ACL-wrapped', db, async tx => {
    // Read inside the transaction: what is removed is everything currently approved that the
    // caller did not resend, and that set has to be the one this write is about to act on.
    const current = await approvedNames(tx, workspaceId);
    for (const name of current) {
      if (keep.has(name)) continue;
      await tx.threadTypeVocabulary.upsert({
        where: { scope_scopeId_name: { ...key, name } },
        create: {
          ...key,
          workspaceId,
          ...suppression(name),
          createdBy: userId,
          updatedBy: userId,
          updatedAt: now,
        },
        update: { isDeleted: true, updatedBy: userId, updatedAt: now },
      });
    }

    for (const entry of entries) {
      // Upsert on (scope, scopeId, name) so re-adding a suppressed entry revives that row
      // rather than colliding with it on the unique index.
      await tx.threadTypeVocabulary.upsert({
        where: { scope_scopeId_name: { ...key, name: entry.name } },
        create: {
          ...key,
          workspaceId,
          ...entry,
          status: entry.status ?? 'APPROVED',
          createdBy: userId,
          updatedBy: userId,
          updatedAt: now,
        },
        update: {
          ...entry,
          status: entry.status ?? 'APPROVED',
          isDeleted: false,
          updatedBy: userId,
          updatedAt: now,
        },
      });
    }

    await retireCandidates(tx, workspaceId, entries.map(entry => entry.name));
  });
}

export async function patchThreadTypeVocabularyTx(workspaceId: string, remove: string[], add: VocabularyInput[], removed: string[], ignored: string[], key: { scope: string; scopeId: string; }, userId: string, now: Date, updated: string[], added: string[]) {
  const result = await transaction(['ThreadTypeVocabulary'], 'patchThreadTypeVocabulary: vocabulary removals plus additions with retirement must commit atomically; tx is not ACL-wrapped', db, async tx => {
    // Read inside the transaction rather than through the cache. Both the guard below and the
    // removed/ignored split are DECISIONS taken on this list, and a per-process cache means a
    // second instance can decide them on a vocabulary that no longer exists.
    const effective = await approvedNames(tx, workspaceId);

    // Refuse to empty the vocabulary: a workspace with nothing to pick from cannot classify.
    const surviving = new Set(effective);
    for (const name of remove) surviving.delete(name);
    for (const entry of add) surviving.add(entry.name);
    if (surviving.size === 0) {
      throw new Error('A workspace must keep at least one thread type');
    }

    removed = remove.filter(name => effective.has(name));
    ignored = remove.filter(name => !effective.has(name));

    for (const name of removed) {
      await tx.threadTypeVocabulary.upsert({
        where: { scope_scopeId_name: { ...key, name } },
        create: {
          ...key,
          workspaceId,
          ...suppression(name),
          createdBy: userId,
          updatedBy: userId,
          updatedAt: now,
        },
        update: { isDeleted: true, updatedBy: userId, updatedAt: now },
      });
    }

    for (const entry of add) {
      (effective.has(entry.name) ? updated : added).push(entry.name);
      await tx.threadTypeVocabulary.upsert({
        where: { scope_scopeId_name: { ...key, name: entry.name } },
        create: {
          ...key,
          workspaceId,
          ...entry,
          status: entry.status ?? 'APPROVED',
          createdBy: userId,
          updatedBy: userId,
          updatedAt: now,
        },
        update: {
          ...entry,
          status: entry.status ?? 'APPROVED',
          isDeleted: false,
          updatedBy: userId,
          updatedAt: now,
        },
      });
    }

    await retireCandidates(tx, workspaceId, add.map(entry => entry.name));
  });
  return { result, removed, ignored };
}

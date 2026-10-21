import { transaction } from '../base';
import { VcsProviderError } from '@/sdlc/vcs/types';
import type { ValidatedCredential } from '@/sdlc/vcs/types';
import type { SdlcActor } from '@/sdlc/types';
import type { CapabilityEvidence } from '@/sdlc/vcs';
import type { StoredSdlcVcsCredential } from '@/sdlc/vcs/SdlcVcsCredentialStore';
import { PROVIDER_LABEL, SdlcVcsService } from '@/sdlc/vcs/SdlcVcsService';
import { Prisma } from '@prisma/client';
import type { RepositoryRow } from '@/sdlc/vcs/SdlcVcsService';


export function updateCredentialTx(self: SdlcVcsService, credentialId: string, actor: SdlcActor, input: { name?: string | undefined; token?: string | undefined; }, validation: ValidatedCredential | undefined) {
  return transaction(['ExternalSource', 'Repo'], 'updateCredential: credential save and linked repo capability reset must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
    await self.credentialStore.lock(tx, credentialId);
    const current = await self.requireCredential(actor.workspaceId, credentialId, tx);
    const now = new Date().toISOString();
    await self.credentialStore.save(tx, {
      ...current,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(validation && input.token
        ? {
            status: 'CONNECTED' as const,
            token: input.token,
            revision: current.revision + 1,
            identityLogin: validation.identityLogin,
            accountName: validation.accountName,
            accountEmail: validation.accountEmail,
            validationStatus: 'VALID',
            validatedAt: now,
            validationErrorCode: null,
            validationErrorMessage: null,
            disconnectedAt: null,
          }
        : {}),
      updatedBy: actor.userId,
      updatedAt: now,
    });
    if (validation) await resetLinkedCapabilities(tx, actor.workspaceId, credentialId);
  });
}
export function revalidateCredentialTx(self: SdlcVcsService, row: StoredSdlcVcsCredential, now: string, validation: ValidatedCredential, actor: SdlcActor, credentialId: string) {
  return transaction(['ExternalSource', 'Repo'], 'revalidateCredential (valid): saving the refreshed credential state and validation result must commit together; tx is not ACL-wrapped', self.prisma, async (tx) => {
    await self.credentialStore.save(tx, {
      ...row,
      validationStatus: 'VALID',
      validatedAt: now,
      validationErrorCode: null,
      validationErrorMessage: null,
      identityLogin: validation.identityLogin,
      accountName: validation.accountName,
      accountEmail: validation.accountEmail,
      updatedBy: actor.userId,
      updatedAt: now,
    });
    await resetLinkedCapabilities(tx, actor.workspaceId, credentialId);
  });
}
export function revalidateCredentialTx2(self: SdlcVcsService, row: StoredSdlcVcsCredential, mapped: VcsProviderError, actor: SdlcActor, credentialId: string) {
  return transaction(['ExternalSource', 'Repo'], 'revalidateCredential (invalid): saving the invalid state and resetting linked repository capabilities must commit together; tx is not ACL-wrapped', self.prisma, async (tx) => {
    const now = new Date().toISOString();
    await self.credentialStore.save(tx, {
      ...row,
      validationStatus: 'INVALID',
      validatedAt: now,
      validationErrorCode: mapped.code,
      validationErrorMessage: mapped.message,
      updatedBy: actor.userId,
      updatedAt: now,
    });
    await resetLinkedCapabilities(tx, actor.workspaceId, credentialId);
  });
}
export function deleteCredentialTx(self: SdlcVcsService, credentialId: string, actor: SdlcActor) {
  return transaction(['ExternalSource', 'Repo'], 'deleteCredential: locks the credential, unlinks every repository using it and removes it in one transaction; tx is not ACL-wrapped', self.prisma, async (tx) => {
    await self.credentialStore.lock(tx, credentialId);
    await self.requireCredential(actor.workspaceId, credentialId, tx);
    const linked = await tx.repo.findMany({
      where: { workspaceId: actor.workspaceId, vcsCredentialId: credentialId },
      select: { id: true },
    });
    await tx.repo.updateMany({
      where: { id: { in: linked.map((repo) => repo.id) } },
      data: { vcsCredentialId: null, accessCapabilities: [] },
    });
    await self.credentialStore.remove(tx, credentialId);
    return linked.map((repo) => repo.id);
  });
}
export function performRepositoryCheckTx(self: SdlcVcsService, repo: any, credentialState: string | null, inspection: any, input: { repoId: string; workspaceId: string; userId: string; }, fallbackError: VcsProviderError | null) {
  return transaction(['ACLAuditLog', 'Repo'], 'performRepositoryCheck (success): verifies the credential is unchanged under lock, then records the repository inspection result; tx is not ACL-wrapped', self.prisma, async (tx) => {
    if (!(await credentialUnchanged(self, tx, repo, credentialState))) {
      throw new VcsProviderError(
        'CREDENTIAL_CHANGED_DURING_CHECK',
        'Repository credential changed during repository access check',
        409,
        true
      );
    }
    await tx.repo.update({
      where: { id: repo.id },
      data: {
        canonicalUrl: inspection.repository.canonicalUrl,
        accessCapabilities: inspection.capabilities as unknown as Prisma.InputJsonValue,
      },
    });
    await self.accessCheckAudit(input, repo.id, fallbackError?.code ?? 'READY', tx);
  });
}
export function performRepositoryCheckTx2(self: SdlcVcsService, repo: any, credentialState: string | null, capabilities: CapabilityEvidence[], input: { repoId: string; workspaceId: string; userId: string; }, mapped: VcsProviderError) {
  return transaction(['ACLAuditLog', 'Repo'], 'performRepositoryCheck (failure): verifies the credential is unchanged under lock, then records capabilities and the audit entry together; tx is not ACL-wrapped', self.prisma, async (tx) => {
    if (!(await credentialUnchanged(self, tx, repo, credentialState))) return true;
    await tx.repo.update({
      where: { id: repo.id },
      data: { accessCapabilities: capabilities as unknown as Prisma.InputJsonValue },
    });
    await self.accessCheckAudit(input, repo.id, mapped.code, tx);
    return false;
  });
}
export function invalidateCredentialTx(self: SdlcVcsService, input: { workspaceId: string; userId: string; credential: StoredSdlcVcsCredential; error: VcsProviderError; }) {
  return transaction(['ExternalSource', 'Repo'], 'invalidateCredential: locks the credential, marks it invalid and resets linked repository capabilities in one transaction; tx is not ACL-wrapped', self.prisma, async (tx) => {
    await self.credentialStore.lock(tx, input.credential.id);
    const current = await self.credentialStore.find(tx, input.workspaceId, input.credential.id);
    if (
      !current ||
      current.revision !== input.credential.revision ||
      current.status !== 'CONNECTED'
    ) {
      return;
    }
    const now = new Date().toISOString();
    await self.credentialStore.save(tx, {
      ...current,
      validationStatus: 'INVALID',
      validatedAt: now,
      validationErrorCode: input.error.code,
      validationErrorMessage: `${PROVIDER_LABEL[current.provider]} rejected this key. It may be expired or revoked; replace it to restore repository write access.`,
      updatedBy: input.userId,
      updatedAt: now,
    });
    await resetLinkedCapabilities(tx, input.workspaceId, current.id);
  });
}

export async function resetLinkedCapabilities(tx: Prisma.TransactionClient, workspaceId: string, credentialId: string): Promise<void> {
    await tx.repo.updateMany({
      where: { workspaceId, vcsCredentialId: credentialId },
      data: { accessCapabilities: [] },
    });
  }

export async function credentialUnchanged(self: SdlcVcsService, tx: Prisma.TransactionClient, repo: RepositoryRow, expectedState: string | null): Promise<boolean> {
    if (!repo.workspaceId) return false;
    const current = await tx.repo.findUnique({
      where: { id: repo.id },
      select: { vcsCredentialId: true },
    });
    if ((current?.vcsCredentialId ?? null) !== repo.vcsCredentialId) return false;
    if (!repo.vcsCredentialId) return expectedState === null;
    await self.credentialStore.lock(tx, repo.vcsCredentialId);
    const credential = await self.credentialStore.find(tx, repo.workspaceId, repo.vcsCredentialId);
    const repository = self.parseRepositoryUrl(repo.canonicalUrl || repo.url);
    const matching =
      credential && credential.provider === repository.provider && credential.host === repository.host
        ? credential
        : null;
    return self.credentialState(matching) === expectedState;
  }

import { transaction } from '../base';
import { StaleVersionReleaseMapping, prisma } from '@/services/release/versionReleaseMappingService';
import { FormEntityType } from '@xyne/shared';


export function cleanupStaleVersionReleaseMappingsTx(staleMappings: StaleVersionReleaseMapping[]) {
  return transaction(['ApplicationReleaseTicket', 'FormEntityValues', 'ReleaseChangeType'], 'cleanupStaleVersionReleaseMappings: stale release mapping, change-type, and form-value deletes must commit atomically; tx is not ACL-wrapped', prisma, async tx => {
    const mappingsWithDevTicket = staleMappings.filter(
      (
        mapping,
      ): mapping is StaleVersionReleaseMapping & { devTicketXyneId: string } =>
        mapping.devTicketXyneId !== null,
    );

    // A release change belongs to one release, one application sub-ticket,
    // and one dev ticket. All three values are needed to avoid deleting a
    // different ticket's changes from the same release.
    const releaseChanges = mappingsWithDevTicket.length > 0
      ? await tx.releaseChangeType.findMany({
        where: {
          OR: mappingsWithDevTicket.map(mapping => ({
            releaseId: mapping.releaseId,
            applicationReleaseId: mapping.applicationReleaseId,
            devTicketXyneId: mapping.devTicketXyneId,
          })),
        },
        select: { id: true },
      })
      : [];
    const releaseChangeIds = releaseChanges.map(change => change.id);

    let formValuesDeleted = 0;
    let releaseChangesDeleted = 0;
    if (releaseChangeIds.length > 0) {
      // FormEntityValues has no foreign key to ReleaseChangeType. Delete the
      // value bags first so changing a version does not leave orphaned
      // migration or environment data visible on the old release.
      const formValuesResult = await tx.formEntityValues.deleteMany({
        where: {
          entityId: { in: releaseChangeIds },
          entityType: {
            in: [
              FormEntityType.RELEASE_ENV_FORM,
              FormEntityType.RELEASE_MIGRATION_FORM,
            ],
          },
        },
      });
      formValuesDeleted = formValuesResult.count;

      const releaseChangesResult = await tx.releaseChangeType.deleteMany({
        where: { id: { in: releaseChangeIds } },
      });
      releaseChangesDeleted = releaseChangesResult.count;
    }

    // Delete ART rows last. Keep the application SubTicket because other dev
    // tickets may still be mapped through the same application release.
    const artResult = await tx.applicationReleaseTicket.deleteMany({
      where: { id: { in: staleMappings.map(mapping => mapping.artId) } },
    });

    return {
      artRowsDeleted: artResult.count,
      releaseChangesDeleted,
      formValuesDeleted,
    };
  });
}

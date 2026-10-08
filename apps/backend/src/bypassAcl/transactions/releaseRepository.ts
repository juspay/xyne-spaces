import { transaction } from '../base';
import type { ReleaseEventContext } from '@/services/release/core/types';
import { prisma, formsRepository, ReleaseRepository } from '@/database/repositories/releaseRepository';
import { Prisma } from '@prisma/client';
import { FormEntityType, ReleaseEventType } from '@xyne/shared';


export function saveReleaseFormValuesTx(formEntityValuesData: { formId: string; entityId: string; entityType: FormEntityType; fieldId: string; contextId: string; fieldValue: string; actualFieldValue: Prisma.InputJsonValue; }[], self: ReleaseRepository, releaseContext: ReleaseEventContext, message: string | undefined, payload: Record<string, unknown> | undefined, formValues: Record<string, unknown>) {
  return transaction(['Channel', 'Form', 'FormEntityValues', 'ReleaseEvent'], 'saveReleaseFormValues: form value creates and release audit event must commit atomically; tx is not ACL-wrapped', prisma, async tx => {
  				await formsRepository.createManyFormEntityValues(formEntityValuesData, tx);
  				await self.createReleaseEvent(
  					{
  						releaseId: releaseContext.releaseId,
  						applicationReleaseId: releaseContext.applicationReleaseId ?? null,
  						eventType: ReleaseEventType.SYSTEM,
  						eventName: 'FORM_SAVED',
  						message: message ?? `Saved form values for ${formEntityValuesData.length} fields`,
  						userId: releaseContext.userId,
  						userName: releaseContext.userName,
  						channelId: releaseContext.channelId,
  						conversationId: releaseContext.conversationId,
  						payload: (payload ?? { formValues }) as Prisma.InputJsonValue,
  					},
  					tx,
  				);
  			});
}

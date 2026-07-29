import { BaseSideEffectHandler } from '../base-handler';
import type { SideEffectJobConfig } from '../types';
import { logger } from '@/utils/logger';
import { CallStatus } from '@xyne/shared';
import { TableSchema } from '@/zero/acl/core/types';
import { UpdateValue } from '@rocicorp/zero';
import { callSideEffectService } from '@/services/callSideEffectService';

export class CallSideEffectHandler extends BaseSideEffectHandler {

    async onUpdate(job: SideEffectJobConfig): Promise<void> {
      logger.info(`[callHandler] onUpdate called for entity: ${job.entityId}`);

      const args: UpdateValue<TableSchema<'calls'>> = job.args;
      if (args.status === CallStatus.ENDED) {
        await callSideEffectService.handleCallEnded(job.entityId);
      }

    }


}
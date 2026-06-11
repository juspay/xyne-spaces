import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseVespaHandler } from '../core/base-handler';
import type { VespaQueueHandler } from '../core/types';
import type { QueryContext } from '../../acl/core/types';

type FormEntityValuesSchema = Schema['tables']['form_entity_values'];

export class FormEntityValuesVespaHandler extends BaseVespaHandler<'form_entity_values'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'form_entity_values');
  }

  onInsert(_args: InsertValue<FormEntityValuesSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
    return [];
  }

  onUpdate(
    _args: UpdateValue<FormEntityValuesSchema>,
    _tx: Transaction<Schema>,
  ): VespaQueueHandler[] {
    return [];
  }

  onUpsert(
    _args: UpsertValue<FormEntityValuesSchema>,
    _tx: Transaction<Schema>,
  ): VespaQueueHandler[] {
    return [];
  }

  onDelete(
    _args: DeleteID<FormEntityValuesSchema>,
    _tx: Transaction<Schema>,
  ): VespaQueueHandler[] {
    return [];
  }
}

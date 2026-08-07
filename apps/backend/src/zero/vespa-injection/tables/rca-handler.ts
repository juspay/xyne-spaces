import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseVespaHandler } from '../core/base-handler';
import type { VespaQueueHandler } from '../core/types';
import type { QueryContext } from '../../acl/core/types';
import { fileSchema, SubApp } from '@/vespa/src/types';

type RCASchema = Schema['tables']['rcas'];

export class RCAVespaHandler extends BaseVespaHandler<'rcas'> {
	constructor(ctx: QueryContext) {
		super(ctx, 'rcas');
	}

	onInsert(args: InsertValue<RCASchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
		return [{
			schema: fileSchema,
			jobType: 'feed',
			data: args,
			docId: args.id,
			app: SubApp.RCA
		}];
	}

	onUpdate(args: UpdateValue<RCASchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
		return [{
			schema: fileSchema,
			jobType: 'feed',
			data: args,
			docId: args.id,
			app: SubApp.RCA
		}];
	}

	onUpsert(args: UpsertValue<RCASchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
		return [{
			schema: fileSchema,
			jobType: 'feed',
			data: args,
			docId: args.id,
			app: SubApp.RCA
		}];
	}

	onDelete(args: DeleteID<RCASchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
		return [{
			schema: fileSchema,
			jobType: 'delete',
			docId: args.id,
			app: SubApp.RCA
		}];
	}
}

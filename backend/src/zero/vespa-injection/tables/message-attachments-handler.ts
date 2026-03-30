import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseVespaHandler } from '../core/base-handler';
import type { VespaQueueHandler } from '../core/types';
import type { QueryContext } from '../../acl/core/types';
import { fileSchema, SubApp } from '@/vespa/src/types';

type MessageAttachmentsSchema = Schema['tables']['message_attachments'];

/**
 * Vespa handler for the message_attachments table.
 *
 * Queues jobs for file indexing in Vespa's file schema.
 * Only indexes files with supported MIME types (PDF, DOCX, TXT, MD, etc.).
 * Images, videos, and other non-text attachments are skipped.
 */
export class MessageAttachmentsVespaHandler extends BaseVespaHandler<'message_attachments'> {
    constructor(ctx: QueryContext) {
        super(ctx, 'message_attachments');
    }

    /**
     * Check if this attachment should be indexed in Vespa
     * Only text-parseable file types are indexed
     */

    onInsert(_args: InsertValue<MessageAttachmentsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
        // Deactivated automatic trigger to prevent race conditions with GCS uploads.
        // Vespa ingestion is now manually triggered after successful GCS upload and DB save.
        /*
        if (!this.shouldIndex(args)) {
            return [];
        }
        return [{
            schema: fileSchema,
            jobType: 'feed',
            data: args as any,
            docId: args.id,
            app: SubApp.CHAT_ATTACHMENT
        }];
        */
        return [];
    }

    onUpdate(_args: UpdateValue<MessageAttachmentsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
        // Deactivated automatic update trigger. Updates are handled manually if needed.
        /*
        if (!this.shouldIndex(args)) {
            return [];
        }
        return [{
            schema: fileSchema,
            jobType: 'feed',
            data: args as any,
            docId: args.id,
            app: SubApp.CHAT_ATTACHMENT
        }];
        */
        return [];
    }

    onUpsert(_args: UpsertValue<MessageAttachmentsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
        // Deactivated automatic upsert trigger.
        /*
        if (!this.shouldIndex(args as any)) {
            return [];
        }
        return [{
            schema: fileSchema,
            jobType: 'feed',
            data: args as any,
            docId: args.id,
            app: SubApp.CHAT_ATTACHMENT
        }];
        */
        return [];
    }

    onDelete(args: DeleteID<MessageAttachmentsSchema>, _tx: Transaction<Schema>): VespaQueueHandler[] {
        return [{
            schema: fileSchema,
            jobType: 'delete',
            docId: args.id,
            app: SubApp.CHAT_ATTACHMENT
        }];
    }
}

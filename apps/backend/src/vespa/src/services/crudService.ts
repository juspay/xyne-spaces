import { type ILogger, type VespaConfig, type VespaDependencies } from '@xyne/vespa-ts';
import type vespaClient from '../client';
import {
  channelSchema,
  messageSchema,
  ticketSchema,
  type InsertDocument,
  type VespaSchema,
} from '../types';
import type { BatchResult } from '../client/vespaClient';
import type VespaClient from '../client/vespaClient';
import { getErrorMessage } from '../utils';
import { ErrorPerformingSearch } from '../error';

/**
 * Fields owned by entity extraction, not by any mapper: the extractor resolves entities
 * onto messages and tickets, claw assigns a channel's approved types, and both write
 * with partial updates. A feed is a Vespa *put*, so an unrelated re-index (a message
 * edit, a ticket update, a channel_stats bump) would erase them. They are read back off
 * the indexed document and re-attached to the payload instead.
 */
const EXTRACTED_ENTITY_FIELDS = ['entityIds', 'entityNames', 'entitySurfaceForms'] as const;

const EXTERNALLY_OWNED_FIELDS: Partial<Record<VespaSchema, readonly string[]>> = {
  [messageSchema]: EXTRACTED_ENTITY_FIELDS,
  [ticketSchema]: EXTRACTED_ENTITY_FIELDS,
  // Not extracted entities but the channel's approved types, which claw publishes.
  [channelSchema]: ['entityTypes', 'entityTypeDefs'],
};

export class CRUDService {
  private logger: ILogger;
  private config: VespaConfig;
  private vespa: vespaClient;
  constructor(vespaClient: VespaClient, dependencies: VespaDependencies) {
    this.logger = dependencies.logger.child({ module: 'vespa' });
    this.config = dependencies.config;
    this.vespa = vespaClient;
  }

  insert = async (documents: InsertDocument[], schema: VespaSchema): Promise<BatchResult[]> => {
    try {
      // Only chat_message, ticket and chat_container carry externally owned fields; every
      // other schema feeds straight through without an extra read.
      const owned = EXTERNALLY_OWNED_FIELDS[schema];
      const payload = owned
        ? await this.withExternallyOwnedFields(documents, schema, owned)
        : documents;

      return this.vespa.feedBatch(payload, {
        namespace: this.config.namespace,
        cluster: this.config.cluster,
        schema,
      });
    } catch (error) {
      this.logger.error(
        `Error inserting documents to schema "${schema}": ${getErrorMessage(error)}`,
      );
      throw error;
    }
  };

  /**
   * Re-attach the entity fields listed in EXTERNALLY_OWNED_FIELDS from the currently
   * indexed document, for the schemas that have them. Only fields the caller left
   * unset are carried over, so a writer that does mean to change them still wins.
   */
  private withExternallyOwnedFields = async (
    documents: InsertDocument[],
    schema: VespaSchema,
    owned: readonly string[],
  ): Promise<InsertDocument[]> => {
    return Promise.all(
      documents.map(async (document) => {
        const provided = document as unknown as Record<string, unknown>;
        const missing = owned.filter((field) => provided[field] === undefined);
        if (missing.length === 0) return document;

        try {
          const indexed = await this.getDocument(document.docId, schema);
          const fields = indexed?.fields as Record<string, unknown> | undefined;
          if (!fields) return document;

          const carried = Object.fromEntries(
            missing
              .filter((field) => fields[field] !== undefined && fields[field] !== null)
              .map((field) => [field, fields[field]]),
          );
          if (Object.keys(carried).length === 0) return document;

          this.logger.info(
            `Preserving [${Object.keys(carried).join(', ')}] on "${schema}" document "${document.docId}"`,
          );
          return { ...document, ...carried } as InsertDocument;
        } catch (error) {
          // Failing the feed would be worse than losing the carry-over.
          this.logger.error(
            `Could not read "${schema}" document "${document.docId}" to preserve entity fields: ${getErrorMessage(error)}`,
          );
          return document;
        }
      }),
    );
  };

  update = async (
    updates: { docId: string; fields: Record<string, any> }[],
    schema: VespaSchema,
    opts?: { create?: boolean },
  ): Promise<BatchResult[]> => {
    try {
      return this.vespa.updateBatch(updates, {
        namespace: this.config.namespace,
        cluster: this.config.cluster,
        schema,
        ...(opts?.create ? { create: true } : {}),
      });
    } catch (error) {
      this.logger.error(
        `Error updating documents in schema "${schema}": ${getErrorMessage(error)}`,
      );
      throw error;
    }
  };

  delete = async (docId: string, schema: VespaSchema) => {
    try {
      return this.vespa
        .deleteDocument({
          namespace: this.config.namespace,
          cluster: this.config.cluster,
          schema,
          docId,
        })
        .catch((error) => {
          throw new ErrorPerformingSearch({
            cause: error as Error,
            sources: schema,
          });
        });
    } catch (error) {
      this.logger.error(
        `Error deleting document "${docId}" from schema "${schema}": ${getErrorMessage(error)}`,
      );
      throw error;
    }
  };

  getDocument = async (docId: string, schema: VespaSchema) => {
    try {
      return this.vespa
        .getDocument({
          namespace: this.config.namespace,
          cluster: this.config.cluster,
          schema,
          docId,
        })
        .catch((error) => {
          throw new ErrorPerformingSearch({
            cause: error as Error,
            sources: schema,
          });
        });
    } catch (error) {
      this.logger.error(
        `Error fetching document "${docId}" from schema "${schema}": ${getErrorMessage(error)}`,
      );
      throw error;
    }
  };

  close = async () => {
    await this.vespa.close();
  };
}

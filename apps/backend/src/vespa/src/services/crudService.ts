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
 * Schemas with fields owned by entity extraction, not by any mapper: the extractor resolves entities onto messages and
 * tickets (entityIds, entityNames, entitySurfaceForms), claw assigns a channel's approved types (entityTypes,
 * entityTypeDefs), and both write with partial updates. A put would erase them on any unrelated re-index, and reading
 * them back off the indexed document to re-put them sends the encryption gateway its own hashed values as plaintext,
 * which it hashes again. So these schemas are fed as partial updates instead: every mapped field is assigned and
 * create=true builds a missing document, and the fields the mapper does not set are left as stored.
 */
const UPSERTED_SCHEMAS: ReadonlySet<VespaSchema> = new Set([messageSchema, ticketSchema, channelSchema]);

export class CRUDService {
  private logger: ILogger;
  private config: VespaConfig;
  private vespa: vespaClient;
  constructor(vespaClient: VespaClient, dependencies: VespaDependencies) {
    this.logger = dependencies.logger.child({ module: 'vespa' });
    this.config = dependencies.config;
    this.vespa = vespaClient;
  }

  // workspaceId: the documents' workspace, when the caller knows it (the encryption gateway then need not read Vespa)
  insert = async (documents: InsertDocument[], schema: VespaSchema, opts?: { workspaceId?: string }): Promise<BatchResult[]> => {
    try {
      if (UPSERTED_SCHEMAS.has(schema)) {
        return this.vespa.updateBatch(
          documents.map((document) => ({
            docId: document.docId,
            workspaceId: opts?.workspaceId,
            // a field the mapper leaves undefined is cleared, as a put would clear it
            fields: Object.fromEntries(
              Object.entries(document).map(([field, value]) => [field, value === undefined ? null : value]),
            ),
          })),
          { namespace: this.config.namespace, cluster: this.config.cluster, schema, create: true },
        );
      }
      return this.vespa.feedBatch(documents, {
        namespace: this.config.namespace,
        cluster: this.config.cluster,
        schema,
        workspaceId: opts?.workspaceId,
      });
    } catch (error) {
      this.logger.error(
        `Error inserting documents to schema "${schema}": ${getErrorMessage(error)}`,
      );
      throw error;
    }
  };

  update = async (
    // workspaceId, when the caller knows it: the encryption gateway then need not read Vespa to find it
    updates: { docId: string; fields: Record<string, any>; workspaceId?: string }[],
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

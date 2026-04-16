import { type ILogger, type VespaConfig, type VespaDependencies } from '@xyne/vespa-ts';
import type vespaClient from '../client';
import type { InsertDocument, VespaSchema } from '../types';
import type { BatchResult } from '../client/vespaClient';
import type VespaClient from '../client/vespaClient';
import { getErrorMessage } from '../utils';
import { ErrorPerformingSearch } from '../error';

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
      return this.vespa.feedBatch(documents, {
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

  update = async (
    updates: { docId: string; fields: Record<string, any> }[],
    schema: VespaSchema,
  ): Promise<BatchResult[]> => {
    try {
      return this.vespa.updateBatch(updates, {
        namespace: this.config.namespace,
        cluster: this.config.cluster,
        schema,
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

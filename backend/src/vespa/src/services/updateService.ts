import { type ILogger, type VespaConfig, type VespaDependencies } from '@xyne/vespa-ts';
import type vespaClient from '../client';
import type { VespaSchema } from '../types';
import type VespaClient from '../client/vespaClient';
import { getErrorMessage } from '../utils';
import { ErrorPerformingSearch } from '../error';

export class UpdateService {
  private logger: ILogger;
  private config: VespaConfig;
  private vespa: vespaClient;

  constructor(vespaClient: VespaClient, dependencies: VespaDependencies) {
    this.logger = dependencies.logger.child({ module: 'vespa' });
    this.config = dependencies.config;
    this.vespa = vespaClient;
  }

  update = async (docId: string, updatedFields: Record<string, any>, schema: VespaSchema) => {
    try {
      return this.vespa
        .updateDocument(updatedFields, {
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
        `Error updating document "${docId}" in schema "${schema}": ${getErrorMessage(error)}`,
      );
      throw error;
    }
  };
}
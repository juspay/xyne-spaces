import { ExternalSourceAdapter, ExternalSourcePlatform } from './types';
import { BaseAuthenticator } from './baseAuthenticator';
import { BaseFlow } from './baseFlow';
import { BaseTransformer } from './baseTransformer';
import { BasePostprocessor } from './basePostprocessor';
import { adapterRegistry } from './adapterRegistry';

/**
 * Adapter Factory
 * Helper to create and register adapters
 */
export class AdapterFactory {
  /**
   * Create and register an adapter
   *
   * @param platform - Platform enum value (e.g., ExternalSourcePlatform.ZOHO)
   * @param authenticator - Authentication handler
   * @param transformer - Data transformer
   * @param flow - (Optional) Flow orchestrator for preprocessing
   * @param postprocessor - (Optional) Postprocessor for ticket creation, workflows, etc.
   * @returns The created adapter
   */
  static create(
    platform: ExternalSourcePlatform,
    authenticator: BaseAuthenticator,
    transformer: BaseTransformer<any, any>,
    flow?: BaseFlow,
    postprocessor?: BasePostprocessor
  ): ExternalSourceAdapter {
    const adapter: ExternalSourceAdapter = {
      name: platform,
      authenticate: authenticator.authenticate.bind(authenticator),
      preprocess: flow?.preprocess?.bind(flow),
      getSourceNameFromDB: flow?.getSourceNameFromDB?.bind(flow),
      isTestPayload: flow?.isTestPayload?.bind(flow),
      transform: transformer.transform.bind(transformer),
      postprocess: postprocessor?.process.bind(postprocessor) ||
                  transformer.postprocess?.bind(transformer),
    };

    // Auto-register
    adapterRegistry.register(platform, adapter);

    return adapter;
  }
}

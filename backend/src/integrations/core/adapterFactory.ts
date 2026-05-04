import { ExternalSourceAdapter, ExternalSourcePlatform } from './types';
import { BaseAuthenticator } from './baseAuthenticator';
import { BaseFlow } from './baseFlow';
import { BaseTransformer } from './baseTransformer';
import { BasePostprocessor } from './basePostprocessor';
import { BaseRefetch } from './baseRefetch';
import { BaseMailReplySender } from './baseMailReplySender';
import { adapterRegistry } from './adapterRegistry';

/**
 * Adapter Factory
 * Helper to create and register adapters
 */
export class AdapterFactory {
  static create(
    platform: ExternalSourcePlatform,
    authenticator: BaseAuthenticator,
    transformer: BaseTransformer<any, any>,
    flow?: BaseFlow,
    postprocessor?: BasePostprocessor,
    refetcher?: BaseRefetch,
    mailReplySender?: BaseMailReplySender,
  ): ExternalSourceAdapter {
    const adapter: ExternalSourceAdapter = {
      name: platform,
      authenticate: authenticator.authenticate.bind(authenticator),
      preprocess: flow?.preprocess?.bind(flow),
      getSourceNameFromDB: flow?.getSourceNameFromDB?.bind(flow),
      isTestPayload: flow?.isTestPayload?.bind(flow),
      isTestQueryParam: flow?.isTestQueryParam?.bind(flow),
      transform: transformer.transform.bind(transformer),
      postprocess:
        postprocessor?.process.bind(postprocessor) ||
        transformer.postprocess?.bind(transformer),
      refetch: refetcher?.refetch.bind(refetcher),
      sendMailReply: mailReplySender?.sendReply.bind(mailReplySender),
      sendMailNew: mailReplySender?.sendNew.bind(mailReplySender),
    };

    adapterRegistry.register(platform, adapter);
    return adapter;
  }
}

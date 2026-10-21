import type { ProviderConfig, ProviderMessage } from '../types';

export abstract class BaseTransformer<TCredentials = unknown> {
  abstract toSpaces(
    message: ProviderMessage,
    config: ProviderConfig<TCredentials>
  ): Promise<string>;

  abstract toProvider(html: string, mentions: ReadonlyMap<string, string>): string;

  abstract prefixAuthor(authorName: string, text: string): string;
}

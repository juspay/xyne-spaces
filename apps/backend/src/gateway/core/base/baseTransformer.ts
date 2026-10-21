import type { ProviderConfig, ProviderMessage } from '../types';

export abstract class BaseTransformer<TCredentials = unknown> {
  /** Provider message → Spaces HTML. */
  abstract toSpaces(
    message: ProviderMessage,
    config: ProviderConfig<TCredentials>
  ): Promise<string>;

  /** Spaces HTML → provider text. `mentions` maps Spaces user ids to provider user ids. */
  abstract toProvider(html: string, mentions: ReadonlyMap<string, string>): string;
}

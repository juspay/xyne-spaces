import {
  buildSlackChannelSourceName,
  buildSlackDeskSourceName,
  buildSlackMigrationSourceName,
} from '../../re-exports';
import type { ProviderId } from '../../core/types';
import type { MessageSource, MirrorLink } from './types';

interface ProviderSourceNames {
  messageSource(spacesChannelId: string): MessageSource;
  legacyMessageSourceNames(externalChannelId: string, spacesChannelId: string): string[];
  deskSourceName(externalChannelId: string): string | null;
}

// Mirror shares each channel's message map with the provider's self-serve migration, so neither copies twice.
const SOURCE_NAMES: Record<ProviderId, ProviderSourceNames> = {
  slack: {
    messageSource: (spacesChannelId) => ({
      name: buildSlackChannelSourceName(spacesChannelId),
      sourceType: 'slack',
      displayName: 'Slack Mirror',
    }),
    legacyMessageSourceNames: (externalChannelId, spacesChannelId) => [
      buildSlackMigrationSourceName(externalChannelId, spacesChannelId),
      buildSlackMigrationSourceName(externalChannelId),
    ],
    deskSourceName: (externalChannelId) => buildSlackDeskSourceName(externalChannelId),
  },
};

export const buildMessageSource = (provider: ProviderId, link: MirrorLink): MessageSource =>
  SOURCE_NAMES[provider].messageSource(link.spacesId);

export const legacyMessageSourceNames = (provider: ProviderId, link: MirrorLink): string[] =>
  SOURCE_NAMES[provider].legacyMessageSourceNames(link.externalId, link.spacesId);

export const deskSourceName = (provider: ProviderId, externalChannelId: string): string | null =>
  SOURCE_NAMES[provider].deskSourceName(externalChannelId);

import { ChannelType } from '@xyne/shared';
import {
  ChatDefault,
  EnvelopeDefault,
  Hashtag,
  PhoneDefault,
  PluginAddonDefault,
  Slack,
  SparkleAi01,
} from '@xyne/icons';
import type { ComponentType, ReactElement } from 'react';
import { cn } from '../../../utils/classNames';

type SourceStyle = {
  label: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
  iconClassName: string;
  logo?: string;
};

const SOURCE_STYLES = {
  email: {
    label: 'Email',
    Icon: EnvelopeDefault,
    iconClassName: 'bg-blue-500/15 text-blue-500',
  },
  slack: {
    label: 'Slack',
    Icon: Slack,
    iconClassName: 'bg-fuchsia-500/15 text-fuchsia-500',
  },
  app: {
    label: 'App',
    Icon: PluginAddonDefault,
    iconClassName: 'bg-emerald-500/15 text-emerald-500',
  },
  social: {
    label: 'Social',
    Icon: ChatDefault,
    iconClassName: 'bg-amber-500/15 text-amber-500',
  },
  call: {
    label: 'Call',
    Icon: PhoneDefault,
    iconClassName: 'bg-lime-500/15 text-lime-500',
  },
  internal: {
    label: 'Xyne',
    Icon: SparkleAi01,
    iconClassName: 'bg-slate-500/15 text-slate-500',
  },
  channels: {
    label: 'Channels',
    Icon: Hashtag,
    iconClassName: 'bg-sky-500/15 text-sky-500',
  },
} satisfies Record<string, SourceStyle>;

type SourceKey = keyof typeof SOURCE_STYLES;

type TicketSourceMetadata = {
  deskSource?: { type?: string; appName?: string };
  source?: string;
};

/**
 * Per-ticket origin wins over channel type: Slack and app tickets can sit in an EMAIL desk
 * (see getTicketReplyKind in SupportScreen), so the channel alone would mislabel them.
 */
const resolveSource = (
  channelType: ChannelType | undefined,
  metadata: TicketSourceMetadata | null | undefined,
): { key: SourceKey; name: string | undefined } => {
  if (metadata?.deskSource?.type === 'app') {
    return { key: 'app', name: metadata.deskSource.appName };
  }
  if (metadata?.source === 'slack') return { key: 'slack', name: undefined };
  if (metadata?.source === 'ozonetel') return { key: 'call', name: undefined };
  switch (channelType) {
    case ChannelType.EMAIL:
      return { key: 'email', name: undefined };
    case ChannelType.SLACK:
      return { key: 'slack', name: undefined };
    case ChannelType.APP:
      return { key: 'app', name: undefined };
    case ChannelType.CALL:
      return { key: 'call', name: undefined };
    case ChannelType.CHANNELS:
      return { key: 'channels', name: undefined };
    case ChannelType.SOCIAL_MEDIA:
      return { key: 'social', name: undefined };
    default:
      return { key: 'internal', name: undefined };
  }
};

export type EmailProvider = 'google' | 'microsoft' | 'zoho';

const LOGOS: Partial<Record<SourceKey | EmailProvider, string>> = {
  google: '/assets/mcp/gmail.svg',
  microsoft: '/assets/mcp/microsoft.png',
  slack: '/assets/mcp/slack.png',
};

export type TicketSource = SourceStyle & { name: string | undefined };

type ExternalNames = {
  emailProvider?: EmailProvider;
  emailAddress?: string;
  slackChannelName?: string;
  appName?: string;
};

/** Source style + name for a ticket. */
export const resolveTicketSource = (
  channelType: ChannelType | undefined,
  ticketMetadata: unknown,
  external: ExternalNames = {},
): TicketSource => {
  const source = resolveSource(
    channelType,
    ticketMetadata as TicketSourceMetadata | null | undefined,
  );
  const { emailProvider, emailAddress, slackChannelName, appName } = external;
  const logo = source.key === 'email' && emailProvider ? LOGOS[emailProvider] : LOGOS[source.key];
  // App: ticket metadata's appName is copied from the source row, which can just be the desk's
  // name; the installed app's real name (resolved by the caller) wins.
  const name =
    source.key === 'app'
      ? (appName ?? source.name)
      : (source.name ??
        (source.key === 'email'
          ? emailAddress
          : source.key === 'slack'
            ? slackChannelName
            : undefined));
  return {
    ...SOURCE_STYLES[source.key],
    ...(logo && { logo }),
    name: name?.trim() || undefined,
  };
};

export const TicketSourceIcon = ({ source }: { source: TicketSource }): ReactElement => {
  const { Icon, iconClassName, logo } = source;
  return (
    <span
      className={cn(
        'size-5 rounded-full flex items-center justify-center shrink-0 ring-1 ring-inset ring-border/60',
        logo ? 'bg-background' : iconClassName,
      )}
    >
      {logo ? <img src={logo} alt='' className='size-3.5 object-contain' /> : <Icon size={12} />}
    </span>
  );
};

/** Large faded source logo/icon across the right of the header background. */
export const TicketSourceWatermark = ({ source }: { source: TicketSource }): ReactElement => {
  const { Icon, logo } = source;
  return (
    <span
      aria-hidden
      className='pointer-events-none absolute -right-4 top-1/2 -translate-y-1/2 -rotate-12 opacity-10 select-none'
    >
      {logo ? <img src={logo} alt='' className='size-32 object-contain' /> : <Icon size={128} />}
    </span>
  );
};

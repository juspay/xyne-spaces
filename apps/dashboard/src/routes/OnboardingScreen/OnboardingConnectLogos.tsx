import type { ReactElement } from 'react';
import type { PrototypeConnectKey } from './onboardingFlow';

interface LogoProps {
  className?: string | undefined;
}

const SlackLogo = ({ className = 'h-6 w-6' }: LogoProps): ReactElement => (
  <svg className={className} viewBox='0 0 24 24' aria-hidden='true'>
    <path
      fill='#E01E5A'
      d='M5.5 15.1a2.2 2.2 0 1 1-2.2-2.2h2.2v2.2Zm1.1 0A3.3 3.3 0 1 1 3.3 11.8h3.3v3.3Z'
    />
    <path
      fill='#36C5F0'
      d='M8.9 5.5a2.2 2.2 0 1 1 2.2-2.2v2.2H8.9Zm0 1.1A3.3 3.3 0 1 1 12.2 3.3v3.3H8.9Z'
    />
    <path
      fill='#2EB67D'
      d='M18.5 8.9a2.2 2.2 0 1 1 2.2 2.2h-2.2V8.9Zm-1.1 0A3.3 3.3 0 1 1 20.7 12.2h-3.3V8.9Z'
    />
    <path
      fill='#ECB22E'
      d='M15.1 18.5a2.2 2.2 0 1 1-2.2 2.2v-2.2h2.2Zm0-1.1A3.3 3.3 0 1 1 11.8 20.7v-3.3h3.3Z'
    />
  </svg>
);

const TeamsLogo = ({ className = 'h-6 w-6' }: LogoProps): ReactElement => (
  <svg className={className} viewBox='0 0 24 24' aria-hidden='true'>
    <rect x='3' y='6' width='11' height='11' rx='2' fill='#5B5FC7' />
    <circle cx='17.2' cy='8.2' r='2.1' fill='#7B83EB' />
    <rect x='14.4' y='11' width='6.2' height='7.6' rx='2' fill='#7B83EB' />
    <text x='8.5' y='14' textAnchor='middle' fill='white' fontSize='7' fontWeight='700'>
      T
    </text>
  </svg>
);

const WhatsAppLogo = ({ className = 'h-6 w-6' }: LogoProps): ReactElement => (
  <svg className={className} viewBox='0 0 24 24' aria-hidden='true'>
    <path fill='#25D366' d='M12 2.2A9.8 9.8 0 0 0 2.8 16.7L2 22l5.4-.8A9.8 9.8 0 1 0 12 2.2Z' />
    <path
      fill='#fff'
      d='M16.7 14.3c-.3-.1-1.6-.8-1.9-.9-.3-.1-.5-.1-.6.1l-.7.9c-.1.2-.3.2-.5.1-1.4-.7-2.4-1.6-3.1-3-.1-.2 0-.4.1-.5l.6-.8c.1-.2.1-.3 0-.5l-.8-1.9c-.2-.4-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.3.3-.9.9-.9 2.1s.9 2.5 1 2.6c.1.2 1.8 2.8 4.4 3.9 2.6 1.1 2.6.7 3.1.7.5 0 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2 0-.1-.2-.2-.5-.3Z'
    />
  </svg>
);

const DiscordLogo = ({ className = 'h-6 w-6' }: LogoProps): ReactElement => (
  <svg className={className} viewBox='0 0 24 24' aria-hidden='true'>
    <path
      fill='#5865F2'
      d='M19.3 5.2A17 17 0 0 0 15.1 4l-.2.4a16 16 0 0 1 2.9 1.1 13 13 0 0 0-11.6 0A16 16 0 0 1 9 4.4L8.9 4a17 17 0 0 0-4.2 1.2C2.2 9.1 1.6 12.9 1.8 16.6A17 17 0 0 0 7 19.2l.6-.9a11 11 0 0 1-1.8-.9l.4-.3c3.4 1.6 7.1 1.6 10.5 0l.4.3c-.6.4-1.2.7-1.8.9l.6.9a17 17 0 0 0 5.2-2.6c.4-4.2-.6-7.9-2.8-11.4ZM9.3 14.6c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8Zm5.4 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8Z'
    />
  </svg>
);

const GoogleChatLogo = ({ className = 'h-6 w-6' }: LogoProps): ReactElement => (
  <svg className={className} viewBox='0 0 24 24' aria-hidden='true'>
    <path
      fill='#00AC47'
      d='M4.5 4.5h10.2A3.3 3.3 0 0 1 18 7.8v5.4A3.3 3.3 0 0 1 14.7 16.5H9.6L4.5 20V4.5Z'
    />
    <path fill='#188038' d='M14.7 16.5H9.6v3.5l5.1-3.5Z' />
    <path fill='#34A853' d='M18 10.2h2.4A1.1 1.1 0 0 1 21.5 11.3v6.2l-3.5-2.4V10.2Z' />
  </svg>
);

const LOGOS: Record<PrototypeConnectKey, (props: LogoProps) => ReactElement> = {
  slack: SlackLogo,
  teams: TeamsLogo,
  whatsapp: WhatsAppLogo,
  discord: DiscordLogo,
  google_chat: GoogleChatLogo,
};

export const OnboardingConnectLogo = ({
  connectorKey,
  className,
}: {
  connectorKey: PrototypeConnectKey;
  className?: string | undefined;
}): ReactElement => {
  const Logo = LOGOS[connectorKey];
  return <Logo className={className} />;
};

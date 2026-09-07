import { ReactElement } from 'react';
import { SiClaude } from 'react-icons/si';
import { RiOpenaiFill } from 'react-icons/ri';
import { Tooltip } from '../Tooltip';

export interface RunOrigin {
  kind?: string;
  provider?: string;
  harnessName?: string;
  label?: string;
  ownerName?: string;
}

type HarnessProvider = 'claude-code' | 'codex-cli';

const HARNESS_BRAND: Record<
  HarnessProvider,
  { name: string; vendor: string; color: string; Icon: (p: { className?: string }) => ReactElement }
> = {
  /* eslint-disable @typescript-eslint/naming-convention */
  'claude-code': {
    name: 'Claude Code',
    vendor: 'Anthropic',
    color: '#D97757',
    Icon: ({ className }) => <SiClaude className={className} />,
  },
  'codex-cli': {
    name: 'Codex CLI',
    vendor: 'OpenAI',
    color: '#10A37F',
    Icon: ({ className }) => <RiOpenaiFill className={className} />,
  },
  /* eslint-enable @typescript-eslint/naming-convention */
};

const isHarnessProvider = (value: unknown): value is HarnessProvider =>
  value === 'claude-code' || value === 'codex-cli';

export function RunOriginChip({ origin }: { origin: RunOrigin }): ReactElement | null {
  if (origin.kind !== 'local-harness' || !isHarnessProvider(origin.provider)) return null;

  const brand = HARNESS_BRAND[origin.provider];
  const label = origin.label?.trim() || brand.name;

  return (
    <Tooltip
      side='top'
      content={
        <span className='block max-w-52 text-left leading-relaxed'>
          Generated with their own {brand.vendor} login. Tools still ran on Xyne.
        </span>
      }
    >
      <span
        data-testid='message-run-origin'
        className='inline-flex max-w-[220px] shrink-0 items-center gap-1 rounded-full border border-border/70 bg-muted/40 py-px pl-1 pr-1.5 text-[11px] leading-none text-muted-foreground'
      >
        <span
          className='flex size-3.5 shrink-0 items-center justify-center rounded-full'
          style={{ backgroundColor: `${brand.color}1f`, color: brand.color }}
        >
          <brand.Icon className='size-2.5' />
        </span>
        <span className='truncate'>via {label}</span>
      </span>
    </Tooltip>
  );
}

import { useState, type ReactElement } from 'react';
import { ChevronBigDown } from '@xyne/icons';
import { Pill } from '../../../../shared/primitives/Pill';
import {
  DetailCard,
  DetailRow,
  DetailSection,
  DetailLockedNote,
  DetailValue,
  ReadOnlyBadge,
} from '../../../../shared/primitives/DetailPrimitives';
import { AgentKeysDialog } from './AgentKeysDialog';
import { useAgentCredentials } from './useAgentCredentials';

interface CredentialsCardProps {
  slug: string;
  canRead: boolean;
  canManage: boolean;
}

export function CredentialsCard({ slug, canRead, canManage }: CredentialsCardProps): ReactElement {
  const [keysOpen, setKeysOpen] = useState(false);
  const { data: credentials } = useAgentCredentials(slug, canRead);

  const configured = (credentials ?? []).filter(entry => entry.configured).length;

  return (
    <DetailSection
      label='Credentials'
      info='Which keys this agent calls providers with'
      {...(canManage ? {} : { trailing: <ReadOnlyBadge /> })}
    >
      <DetailCard>
        {!canManage && (
          <DetailLockedNote>
            {canRead
              ? 'Only the owner or an admin can add or remove agent keys.'
              : 'Only the owner or an admin can view and change agent keys.'}
          </DetailLockedNote>
        )}
        <DetailRow title='Spaces' hint='Platform default no key required'>
          <Pill tone='success'>Always Available</Pill>
        </DetailRow>
        <DetailRow
          title='Agent keys'
          hint='Everyone falls through to their own provider, or to Spaces'
          last
        >
          {canRead ? (
            <button
              type='button'
              onClick={() => setKeysOpen(true)}
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: open agent keys'
              className='flex h-9 shrink-0 items-center gap-2 rounded-[10px] border border-border bg-card px-3 text-sm font-normal leading-5 text-foreground transition-colors hover:bg-muted'
            >
              {configured > 0 ? `${configured} configured` : 'Configure'}
              <ChevronBigDown className='size-4 shrink-0 text-muted-foreground' aria-hidden />
            </button>
          ) : (
            <DetailValue>—</DetailValue>
          )}
        </DetailRow>
      </DetailCard>

      <AgentKeysDialog
        open={keysOpen}
        onOpenChange={setKeysOpen}
        slug={slug}
        canManage={canManage}
      />
    </DetailSection>
  );
}

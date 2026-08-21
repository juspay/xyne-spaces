import { useState, type ReactElement } from 'react';
import { ChevronBigDown } from '@xyne/icons';
import { Pill } from '../../../../shared/primitives/Pill';
import {
  DETAIL_CONTROL_CLASS_FOR,
  DetailGroup,
  DetailLockedNote,
  DetailRow,
  DetailSection,
  DetailValue,
  ReadOnlyBadge,
  type DetailHeading,
  type DetailTypeScale,
} from '../../../../shared/primitives/DetailPrimitives';
import { AgentKeysDialog } from './AgentKeysDialog';
import { useAgentCredentials } from './useAgentCredentials';

interface CredentialsCardProps {
  slug: string;
  canRead: boolean;
  canManage: boolean;
  className?: string;
  heading?: DetailHeading;
  typeScale?: DetailTypeScale;
  headingClassName?: string;
}

export function CredentialsCard({
  slug,
  canRead,
  canManage,
  className,
  heading = 'section',
  typeScale = 'library',
  headingClassName,
}: CredentialsCardProps): ReactElement {
  const [keysOpen, setKeysOpen] = useState(false);
  const { data: credentials } = useAgentCredentials(slug, canRead);

  const configured = (credentials ?? []).filter(entry => entry.configured).length;

  return (
    <DetailSection
      label='Credentials'
      info='Which keys this agent calls providers with'
      heading={heading}
      typeScale={typeScale}
      {...(className === undefined ? {} : { className })}
      {...(headingClassName === undefined ? {} : { headingClassName })}
      {...(canManage ? {} : { trailing: <ReadOnlyBadge /> })}
    >
      <DetailGroup typeScale={typeScale}>
        {!canManage && (
          <DetailLockedNote>
            {canRead
              ? 'Only the owner or an admin can add or remove agent keys.'
              : 'Only the owner or an admin can view and change agent keys.'}
          </DetailLockedNote>
        )}
        <DetailRow title='Spaces' hint='Platform default no key required' typeScale={typeScale}>
          <Pill tone='success'>Always Available</Pill>
        </DetailRow>
        <DetailRow
          title='Agent keys'
          hint='Everyone falls through to their own provider, or to Spaces'
          last
          typeScale={typeScale}
        >
          {canRead ? (
            <button
              type='button'
              onClick={() => setKeysOpen(true)}
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: open agent keys'
              className={DETAIL_CONTROL_CLASS_FOR[typeScale]}
            >
              {configured > 0 ? `${configured} configured` : 'Configure'}
              <ChevronBigDown className='size-5 shrink-0 text-foreground' aria-hidden />
            </button>
          ) : (
            <DetailValue>—</DetailValue>
          )}
        </DetailRow>
      </DetailGroup>

      <AgentKeysDialog
        open={keysOpen}
        onOpenChange={setKeysOpen}
        slug={slug}
        canManage={canManage}
      />
    </DetailSection>
  );
}

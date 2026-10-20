import { memo, type ReactElement } from 'react';

import { LinkPreviewCard } from '@/src/features/chat/v2/components/chat/link-preview-card';
import { useChatRenderTokens } from '@/src/features/chat/v2/components/chat/message-row';

import { useConversationComposer } from './conversation-composer-context';

type LinkPreviewProps = {
  /** Draws the card as a plain block outside a bubble, with no own-message colours. */
  flat?: boolean;
};

const LinkPreview = memo(({ flat = false }: LinkPreviewProps): ReactElement => {
  const { kind, paintRow } = useConversationComposer();
  const {
    ambientAccentColor,
    embeddedBgUser,
    embeddedMutedUser,
    embeddedTitleUser,
    mutedForeground,
    rootAccentUser,
  } = useChatRenderTokens();

  return (
    <LinkPreviewCard
      preview={paintRow?.linkPreview ?? null}
      isCurrentUser={!flat && kind === 'CURRENT_USER'}
      mutedForeground={mutedForeground}
      accentColor={ambientAccentColor}
      {...(flat
        ? {}
        : {
            currentUserColors: {
              backgroundColor: embeddedBgUser,
              titleColor: embeddedTitleUser,
              mutedColor: embeddedMutedUser,
              accentColor: rootAccentUser,
            },
          })}
    />
  );
});
LinkPreview.displayName = 'ConversationComposer.LinkPreview';

export { LinkPreview };

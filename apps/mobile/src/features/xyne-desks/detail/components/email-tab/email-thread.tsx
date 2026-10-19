import { memo } from 'react';
import { View } from 'react-native';

import type { TicketDetailEmailSnapshot } from '../../types';
import { getEmailChainItemPosition } from '../../utils';
import { EmailThreadItem } from './email-thread-item';

type EmailThreadProps = {
  emails: readonly TicketDetailEmailSnapshot[];
  collapsedIds: ReadonlySet<string>;
  deskEmail: string | null;
  conversationId: string | null;
  showEmailHeaderChrome?: boolean;
  onToggleCollapse: (id: string) => void;
};

export const EmailThread = memo(function EmailThread({
  emails,
  collapsedIds,
  deskEmail,
  conversationId,
  showEmailHeaderChrome = true,
  onToggleCollapse,
}: EmailThreadProps) {
  return (
    <View>
      {emails.map((email, index) => (
        <EmailThreadItem
          key={email.id}
          email={email}
          position={getEmailChainItemPosition(index, emails.length)}
          isCollapsed={collapsedIds.has(email.id)}
          isLast={index === emails.length - 1}
          deskEmail={deskEmail}
          conversationId={conversationId}
          showEmailHeaderChrome={showEmailHeaderChrome}
          onToggleCollapse={() => onToggleCollapse(email.id)}
        />
      ))}
    </View>
  );
});

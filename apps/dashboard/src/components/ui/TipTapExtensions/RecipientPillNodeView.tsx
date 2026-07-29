import React from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import Avatar from '../Avatar/Avatar';
import { useUser } from '../../../hooks/useUsers';

export function RecipientPillNodeView({ node }: NodeViewProps): React.JSX.Element {
  const attrs = node.attrs as Record<string, unknown>;
  const userId = attrs['userId'] as string;
  const name = attrs['name'] as string;
  const email = attrs['email'] as string;
  const orgUser = useUser(userId);
  const initial = (name?.charAt(0) || email?.charAt(0) || '?').toUpperCase();

  return (
    <NodeViewWrapper as='span' className='recipient-pill-node-wrapper inline'>
      <span contentEditable={false} data-recipient-pill='' className='email-recipient-pill'>
        {orgUser ? (
          <Avatar userId={userId} size='sm' rounded showActiveStatus={false} />
        ) : (
          <span className='email-recipient-pill-initial'>{initial}</span>
        )}
        <span className='email-recipient-pill-label'>+{name}</span>
      </span>
    </NodeViewWrapper>
  );
}

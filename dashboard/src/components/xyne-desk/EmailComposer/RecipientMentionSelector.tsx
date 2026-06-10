import React, { useCallback, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { PluginKey } from '@tiptap/pm/state';
import Avatar from '../../ui/Avatar/Avatar';
import type { User } from '../../../machines/stateMachine';
import {
  BasePopoverSelector,
  detectRecipientTrigger,
  createVirtualAnchor,
  type BaseSelectorPluginState,
} from '../../ui/Selectors';
import { recipientSelectorPluginKey, type RecipientSelectorItem } from '../../ui/TipTapExtensions';
import { buildSuggestions } from './recipients';
import type { RecipientSuggestion } from '../RecipientSuggestionsDropdown/RecipientSuggestionsDropdown';

interface RecipientMentionSelectorProps {
  editor: Editor | null;
  /** Same pool as To/Cc/Bcc fields (org + desk contacts + thread participants). */
  contactPool: ReadonlyArray<RecipientSuggestion>;
  users: ReadonlyArray<User>;
  /** Adds email to To only (caller must dedupe). Does not modify the editor body. */
  onAddToRecipient: (email: string) => void;
  /** Current To list — used for dedupe on add and "In To" label only; Cc/Bcc are ignored. */
  toEmails: ReadonlyArray<string>;
}

type MentionItem = RecipientSelectorItem & {
  source: RecipientSuggestion['source'];
  isOrgUser: boolean;
};

const SOURCE_LABEL: Record<RecipientSuggestion['source'], string> = {
  org: 'Org',
  desk: 'Contacts',
  thread: 'Recent',
};

export const RecipientMentionSelector: React.FC<RecipientMentionSelectorProps> = ({
  editor,
  contactPool,
  users,
  onAddToRecipient,
  toEmails,
}) => {
  const [query, setQuery] = useState('');

  const toEmailSet = useMemo(() => new Set(toEmails.map(e => e.toLowerCase().trim())), [toEmails]);

  const usersByEmail = useMemo(
    () => new Map(users.map(u => [u.email.toLowerCase().trim(), u])),
    [users],
  );

  const items: MentionItem[] = useMemo(() => {
    const suggestions = buildSuggestions(contactPool, query, []);
    return suggestions.map(s => {
      const orgUser = usersByEmail.get(s.email.toLowerCase().trim());
      const displayName = orgUser?.name ?? s.name ?? s.email.split('@')[0] ?? s.email;
      return {
        id: orgUser?.id ?? s.email,
        name: displayName,
        email: s.email,
        source: s.source,
        isOrgUser: !!orgUser,
        ...(orgUser?.picture ? { picture: orgUser.picture } : {}),
        ...(toEmailSet.has(s.email.toLowerCase().trim()) ? { isInTo: true as const } : {}),
      };
    });
  }, [contactPool, query, usersByEmail, toEmailSet]);

  const detectTriggerWithSearch = useCallback((ed: Editor | null) => {
    if (!ed) return null;
    const trigger = detectRecipientTrigger(ed);
    if (trigger) {
      const searchQuery = trigger.query.replace(/[.,!?:;)]*$/, '');
      setQuery(searchQuery);
    } else {
      setQuery('');
    }
    return trigger;
  }, []);

  const handleSelect = useCallback(
    (item: MentionItem) => {
      if (!editor) return;

      const { state } = editor;
      const { from } = state.selection;
      const { $from } = state.selection;
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '\0');
      // Match only the +query segment (no leading space) — same pattern as MentionSelector for @.
      const recipientMatch = textBefore.match(/\+([\w][\w\s.@-]*)$/);

      if (recipientMatch) {
        const recipientStart = from - recipientMatch[0].length;
        const recipientEnd = from;

        editor
          .chain()
          .focus()
          .deleteRange({ from: recipientStart, to: recipientEnd })
          .insertRecipientPill({
            userId: item.id,
            name: item.name,
            email: item.email,
            ...(item.picture ? { picture: item.picture } : {}),
          })
          .insertContent(' ')
          .run();
      }

      onAddToRecipient(item.email);
      setQuery('');
    },
    [editor, onAddToRecipient],
  );

  const renderItem = useCallback((item: MentionItem, _index: number, isSelected: boolean) => {
    const initial = (item.name?.charAt(0) || item.email.charAt(0) || '?').toUpperCase();
    return (
      <div
        className={`flex items-center gap-3 p-3 rounded-xl transition-all ${
          isSelected ? 'bg-accent' : ''
        }`}
      >
        {item.isOrgUser ? (
          <Avatar userId={item.id} size='sm' rounded showActiveStatus={false} />
        ) : (
          <span className='flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[4px] bg-border text-[10px] font-medium text-muted-foreground'>
            {initial}
          </span>
        )}
        <div className='flex-1 min-w-0 flex flex-col gap-0.5'>
          <span className='text-sm font-medium text-foreground truncate'>{item.name}</span>
          <span className='text-xs text-muted-foreground truncate'>{item.email}</span>
        </div>
        <span className='text-[10px] text-muted-foreground flex-shrink-0'>
          {item.isInTo ? 'In To' : SOURCE_LABEL[item.source]}
        </span>
      </div>
    );
  }, []);

  return (
    <BasePopoverSelector<MentionItem>
      editor={editor}
      pluginKey={
        recipientSelectorPluginKey as unknown as PluginKey<BaseSelectorPluginState<MentionItem>>
      }
      items={items}
      detectTrigger={detectTriggerWithSearch}
      getPosition={createVirtualAnchor}
      onSelect={handleSelect}
      renderItem={renderItem}
      emptyMessage='No users found'
      className='w-80'
      triggerChar='+'
    />
  );
};

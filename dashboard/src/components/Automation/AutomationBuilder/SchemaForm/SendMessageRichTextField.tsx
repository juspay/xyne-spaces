import { useCallback, useMemo, useState } from 'react';
import { Variable } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import { cn } from '../../../../utils/classNames';
import { Popover } from '../../../ui/Popover/Popover';
import { EmailEditor } from '../../../xyne-desk/EmailEditor/EmailEditor';
import { MentionExtension } from '../../../ui/TipTapExtensions';
import { MentionSelector } from '../../../ui/Selectors';
import { useMentionSearch } from '../../../../hooks/useMentionSearch';
import { useActiveUserSearch } from '../../../../hooks/useUsers';
import { useAuth } from '../../../../hooks/useAuth';
import { userToMentionResult } from '../../../../utils/userDisplayName';
import { VariablePicker } from '../VariablePicker/VariablePicker';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import {
  VariableRef,
  VariableLabelProvider,
  buildVariableLabelResolver,
  wrapVariableRefsForLoad,
} from './VariableRefExtension';

const MENTION_USER_LIMIT = 20;

interface SendMessageRichTextFieldProps {
  value: string;
  onChange: (next: string) => void;
  variableSources: VariablePickerSource[];
  placeholder?: string;
  channelId?: string | null;
}

export function SendMessageRichTextField({
  value,
  onChange,
  variableSources,
  placeholder,
  channelId,
}: SendMessageRichTextFieldProps): React.ReactElement {
  const { user } = useAuth();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [varOpen, setVarOpen] = useState(false);

  const labelFor = useMemo(() => buildVariableLabelResolver(variableSources), [variableSources]);
  const editorValue = useMemo(() => wrapVariableRefsForLoad(value), [value]);
  const extensions = useMemo(
    () => [VariableRef, MentionExtension.configure({ userActions: [], groupActions: [] })],
    [],
  );

  // Channel participants are only resolvable when the channel is a concrete id;
  // for a {{variable}} channel there's no membership to scope to, so we search the
  // workspace directly (same pattern as QuickDmComposer) instead of the channel picker.
  const concreteChannelId = channelId && !channelId.includes('{{') ? channelId : undefined;
  const { results: channelMentionItems, searchMentions: searchChannelMentions } = useMentionSearch(
    concreteChannelId,
    undefined,
    undefined,
    { includeSpecialMentions: true },
  );

  const [workspaceMentionQuery, setWorkspaceMentionQuery] = useState('');
  const workspaceUsers = useActiveUserSearch(workspaceMentionQuery, MENTION_USER_LIMIT);
  const workspaceMentionItems = useMemo(
    () => workspaceUsers.map(u => userToMentionResult(u, u.id === user?.id)),
    [workspaceUsers, user?.id],
  );

  const mentionItems = concreteChannelId ? channelMentionItems : workspaceMentionItems;
  const searchMentions = useCallback(
    (query: string) => {
      if (concreteChannelId) {
        searchChannelMentions(query);
      } else {
        setWorkspaceMentionQuery(query);
      }
    },
    [concreteChannelId, searchChannelMentions],
  );

  const variableButton = (
    <Popover
      open={varOpen}
      onOpenChange={setVarOpen}
      align='end'
      side='bottom'
      sideOffset={4}
      className='rounded-xl p-0 overflow-hidden'
      trigger={
        <button
          type='button'
          aria-label='Insert variable'
          title='Insert variable'
          className={cn(
            'flex h-7 items-center gap-1 rounded px-1.5 text-xs transition-colors',
            'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          <Variable className='h-3.5 w-3.5' />
          <span>Variable</span>
        </button>
      }
    >
      <VariablePicker
        sources={variableSources}
        onSelect={entry => {
          const ref = entry.reference.replace(/^\{\{|\}\}$/g, '');
          if (editor) {
            editor.chain().focus().insertContent({ type: 'variableRef', attrs: { ref } }).run();
          } else {
            onChange(`${value}${entry.reference}`);
          }
          setVarOpen(false);
        }}
        onClose={() => setVarOpen(false)}
      />
    </Popover>
  );

  return (
    <VariableLabelProvider value={labelFor}>
      <div className='flex flex-col rounded-md border border-border bg-background min-h-[160px]'>
        <EmailEditor
          value={editorValue}
          onChange={onChange}
          onEditorReady={setEditor}
          placeholder={placeholder ?? 'Type your message… use @ to mention someone'}
          toolbarRightSlot={variableButton}
          className='min-h-[160px]'
          extraExtensions={extensions}
        />
        <MentionSelector
          editor={editor}
          mentionItems={mentionItems}
          onMentionSearch={searchMentions}
        />
      </div>
    </VariableLabelProvider>
  );
}

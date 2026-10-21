import type { ReactElement } from 'react';
import { PencilEditLine } from '@xyne/icons';
import type { DraftAgentEditor } from '../useDraftAgentEditor';

const BUTTON =
  'flex h-7 shrink-0 items-center justify-center rounded-lg px-2 text-sm font-medium leading-[1.2] transition-colors';
const GHOST = `${BUTTON} border border-border bg-card text-foreground hover:bg-muted`;
const PRIMARY = `${BUTTON} border border-transparent bg-primary text-primary-foreground hover:bg-primary/90`;

/**
 * Edit ⇄ Save/Cancel for the draft's identity. Nothing is persisted here — the
 * saved values ride in `agent-edits` and are applied when the draft is approved,
 * the same round-trip the tool and model edits already use.
 */
export function IdentityEditControls({ editor }: { editor: DraftAgentEditor }): ReactElement {
  if (!editor.editingIdentity) {
    return (
      <button
        type='button'
        onClick={(): void => editor.startIdentityEdit('name')}
        className={GHOST}
        data-track-category='AGENT_ARTIFACT'
        data-track-name='EDIT_DRAFT_IDENTITY'
      >
        <PencilEditLine size={14} className='mr-1 shrink-0' />
        Edit
      </button>
    );
  }

  return (
    <div className='flex shrink-0 items-center gap-2'>
      <button
        type='button'
        onClick={editor.cancelIdentityEdit}
        className={GHOST}
        data-track-category='AGENT_ARTIFACT'
        data-track-name='CANCEL_DRAFT_IDENTITY'
      >
        Cancel
      </button>
      <button
        type='button'
        onClick={editor.saveIdentity}
        className={PRIMARY}
        data-track-category='AGENT_ARTIFACT'
        data-track-name='SAVE_DRAFT_IDENTITY'
      >
        Save
      </button>
    </div>
  );
}

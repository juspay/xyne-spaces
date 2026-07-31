import { FormattingToolbarExtension } from '@blocknote/core/extensions';
import {
  FormattingToolbar,
  type FormattingToolbarProps,
  getFormattingToolbarItems,
  useComponentsContext,
  useExtension,
} from '@blocknote/react';
import { MessageSquarePlus } from 'lucide-react';
import type { FC } from 'react';

function CanvasAddCommentToolbarButton({ onAddComment }: { onAddComment: () => void }) {
  const Components = useComponentsContext();
  const { store } = useExtension(FormattingToolbarExtension);

  if (!Components) return null;

  return (
    <Components.FormattingToolbar.Button
      className='bn-button'
      label='Add comment'
      mainTooltip='Add comment'
      icon={<MessageSquarePlus />}
      onClick={() => {
        onAddComment();
        store.setState(false);
      }}
    />
  );
}

export const createCanvasFormattingToolbar = (
  onAddComment: () => void,
): FC<FormattingToolbarProps> => {
  const CanvasFormattingToolbar = ({ blockTypeSelectItems }: FormattingToolbarProps) => (
    <FormattingToolbar>
      {getFormattingToolbarItems(blockTypeSelectItems)}
      <CanvasAddCommentToolbarButton onAddComment={onAddComment} />
    </FormattingToolbar>
  );

  return CanvasFormattingToolbar;
};

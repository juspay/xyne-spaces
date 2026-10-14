import { AlsoSendToChannel } from './input-composer-also-send-to-channel';
import { AttachmentAction } from './input-composer-action-attachment';
import { EmojiAction } from './input-composer-action-emoji';
import { Actions } from './input-composer-actions-panel';
import { AttachmentsSheet } from './input-composer-attachments-sheet';
import { AttachmentsList } from './input-composer-attachments-list';
import { EmojiPicker } from './input-composer-emoji-picker';
import { FormatAction } from './input-composer-action-format';
import { Input } from './input-composer-input';
import { Root } from './input-composer-root';
import { Send } from './input-composer-send';
import { LinkModal } from './input-composer-link-modal';
import { FormatDivider } from './input-composer-format-divider';
import { FormattingPanel } from './input-composer-formatting-panel';
import { KeyboardLifecycle } from './input-composer-keyboard-lifecycle';
import { MentionsList } from './input-composer-mentions-list';
import { CloseFormat } from './input-composer-format-close';
import { EditingBanner } from './input-composer-editing-banner';

const ChatInput = {
  Root,
  Input,
  Send,
  Actions,
  AlsoSendToChannel,
  MentionsList,
  AttachmentsList,
  EmojiPicker,
  AttachmentsSheet,
  LinkModal,
  KeyboardLifecycle,
  EditingBanner,

  // Footer actions
  AttachmentAction,
  FormatAction,
  EmojiAction,
  FormattingPanel,

  // Formatting controls
  FormatDivider,
  CloseFormat,
};

export { ChatInput };

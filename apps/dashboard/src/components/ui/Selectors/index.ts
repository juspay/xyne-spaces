export { BasePopoverSelector } from './BasePopoverSelector';
export type {
  BasePopoverSelectorProps,
  BaseSelectorItem,
  BaseSelectorPluginState,
} from './BasePopoverSelector';

export { createSelectorPlugin } from './BaseSelectorPlugin';
export type { BaseSelectorPluginConfig } from './BaseSelectorPlugin';

export { MentionSelector } from './MentionSelector';
export { FileReferenceSelector } from './FileReferenceSelector';
export type { FileReferenceItem, FileReferenceSelectorProps } from './FileReferenceSelector';
export { CommandSelector } from './CommandSelector';
export { EmojiSelector } from './EmojiSelector';

export type { MentionSelectorProps, CommandItem, CommandSelectorProps } from './Selectors.types';

export {
  detectTrigger,
  detectMentionTrigger,
  detectCommandTrigger,
  detectChannelTrigger,
  detectEmojiTrigger,
  detectRecipientTrigger,
  detectFileReferenceTrigger,
  getAbsolutePosition,
  getTextBeforeCursor,
  createVirtualAnchor,
} from './Selectors.utils';
export type { TriggerMatch, EditorPosition, VirtualElement } from './Selectors.utils';

import type { ChannelVisibility } from '@xyne/shared';

export type RemoveMemberSheetProps = {
  isPresented: boolean;
  memberName: string;
  channelName: string;
  visibility: ChannelVisibility | undefined;
  isRemoving: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
};

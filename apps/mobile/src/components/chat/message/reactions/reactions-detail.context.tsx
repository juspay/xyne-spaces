import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';
import type { MessageSheetTarget } from '@/src/components/chat/message-sheet/message-sheet.types';
import { EmojiPickerBottomSheet, type EmojiPickerSelection } from '@/src/components/emoji-picker';

export type ReactionUserLookup = (userId: string) => { name: string; picture: string } | undefined;

type ReactionsDetailContextValue = {
  open: (message: MessageSheetTarget) => void;
  close: () => void;
  isOpen: boolean;
  activeMessage: MessageSheetTarget | null;
  getTargetRef: () => MessageSheetTarget | null;
  resolveReactionUser?: ReactionUserLookup;
  openEmojiPicker: (message: MessageSheetTarget) => void;
};

type ReactionsDetailProviderProps = {
  children: ReactNode;
  resolveReactionUser?: ReactionUserLookup;
};

const ReactionsDetailContext = createContext<ReactionsDetailContextValue | null>(null);

const SharedReactionEmojiPicker = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const zero = useZero();
  const reactionsDetailContext = useContext(ReactionsDetailContext);

  const onEmojiSelected = useCallback(
    (selection: EmojiPickerSelection) => {
      const emojiValue =
        selection.type === 'custom'
          ? `custom:${selection.emojiId}:${selection.name}`
          : selection.value;
      const msg = reactionsDetailContext?.getTargetRef();
      if (!msg?.initialMessage?.messageId) {
        onClose();
        return;
      }
      const messageId = msg.initialMessage.messageId;
      const uid = msg.currentUserId;
      const hasReacted = !!(msg.initialMessage.reactions ?? []).some(
        r => r.emojiName === emojiValue && r.userId === uid,
      );
      const timestamp = Date.now();
      zero.mutate(
        mutators.messages.react({
          messageId,
          emojiName: emojiValue,
          action: hasReacted ? 'remove' : 'add',
          timestamp,
          reactionId: hasReacted ? undefined : uuidv4(),
          countId: hasReacted ? undefined : uuidv4(),
        }),
      );
      onClose();
    },
    [zero, onClose, reactionsDetailContext],
  );

  return (
    <EmojiPickerBottomSheet
      isOpen={open}
      onOpenChange={nextOpen => {
        if (!nextOpen) {
          onClose();
        }
      }}
      onSelect={onEmojiSelected}
    />
  );
};

export const ReactionsDetailProvider = ({
  children,
  resolveReactionUser,
}: ReactionsDetailProviderProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeMessage, setActiveMessage] = useState<MessageSheetTarget | null>(null);
  const targetRef = useRef<MessageSheetTarget | null>(null);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  const close = useCallback(() => {
    setIsOpen(false);
    setActiveMessage(null);
    targetRef.current = null;
  }, []);

  const open = useCallback((message: MessageSheetTarget) => {
    targetRef.current = message;
    setActiveMessage(message);
    setIsOpen(true);
  }, []);

  const getTargetRef = useCallback(() => targetRef.current, []);

  const openEmojiPicker = useCallback((message: MessageSheetTarget) => {
    targetRef.current = message;
    setEmojiPickerOpen(true);
  }, []);

  const closeEmojiPicker = useCallback(() => {
    setEmojiPickerOpen(false);
  }, []);

  const value = useMemo(
    () => ({
      open,
      close,
      isOpen,
      activeMessage,
      getTargetRef,
      openEmojiPicker,
      ...(resolveReactionUser !== undefined ? { resolveReactionUser } : {}),
    }),
    [open, close, isOpen, activeMessage, getTargetRef, openEmojiPicker, resolveReactionUser],
  );

  return (
    <ReactionsDetailContext.Provider value={value}>
      {children}
      <SharedReactionEmojiPicker open={emojiPickerOpen} onClose={closeEmojiPicker} />
    </ReactionsDetailContext.Provider>
  );
};

export const useReactionsDetail = () => {
  const ctx = useContext(ReactionsDetailContext);
  if (!ctx) {
    throw new Error('useReactionsDetail must be used within ReactionsDetailProvider');
  }
  return ctx;
};

export const useReactionsDetailOptional = () => {
  return useContext(ReactionsDetailContext);
};

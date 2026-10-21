import {
  memo,
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type ReactElement,
} from 'react';
import type { EmojiPickerSelection } from '@/src/components/emoji-picker';
import { useCustomEmojis } from '@/src/hooks/useCustomEmojis';

import {
  useChatInputActions,
  useChatInputHandlers,
  useChatInputPanelState,
} from './input-composer-context';

type EmojiPickerBottomSheetProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (selection: EmojiPickerSelection) => void;
};

type EmojiPickerBottomSheetComponent = ComponentType<EmojiPickerBottomSheetProps>;

const EmojiPickerComponent = (): ReactElement | null => {
  const { isEmojiPickerOpen } = useChatInputPanelState();
  const { setIsEmojiPickerOpenState } = useChatInputActions();
  const { insertEmoji } = useChatInputHandlers();
  const [hasOpenedOnce, setHasOpenedOnce] = useState(isEmojiPickerOpen);
  const [EmojiPickerBottomSheet, setEmojiPickerBottomSheet] =
    useState<EmojiPickerBottomSheetComponent | null>(null);

  // Warm the small per-user catalog only when a chat composer is mounted.
  // The picker module and custom image work remain deferred, and all picker
  // entry points consume the same React Query/MMKV result.
  useCustomEmojis({ enabled: true });

  useEffect(() => {
    if (isEmojiPickerOpen) setHasOpenedOnce(true);
  }, [isEmojiPickerOpen]);

  useEffect(() => {
    if (!hasOpenedOnce || EmojiPickerBottomSheet) return;

    let cancelled = false;
    void import('@/src/components/emoji-picker').then(pickerModule => {
      if (cancelled) return;
      setEmojiPickerBottomSheet(() => pickerModule.EmojiPickerBottomSheet);
    });

    return (): void => {
      cancelled = true;
    };
  }, [EmojiPickerBottomSheet, hasOpenedOnce]);

  const handleSelectEmoji = useCallback(
    (selection: EmojiPickerSelection): void => {
      insertEmoji(selection);
    },
    [insertEmoji],
  );

  // A picker is one native presentation session. Leaving a hidden sheet mounted
  // lets a stale close callback from its previous presentation race the next
  // opening and can keep the portal above the composer.
  if (!EmojiPickerBottomSheet || !isEmojiPickerOpen) return null;

  return (
    <EmojiPickerBottomSheet
      isOpen={isEmojiPickerOpen}
      onOpenChange={setIsEmojiPickerOpenState}
      onSelect={handleSelectEmoji}
    />
  );
};

const EmojiPicker = memo(EmojiPickerComponent);
EmojiPicker.displayName = 'ChatInput.EmojiPicker';

export { EmojiPicker };

import { Camera, FileText, Images, type LucideIcon } from 'lucide-react-native';
import { memo, type ReactElement, useContext, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useChatInputActions, useChatInputPanelState } from './input-composer-context';
import { useComposerAttachmentPicking } from './hooks/useComposerAttachmentPicking';
import {
  pickFromCamera,
  pickFromFiles,
  pickFromGallery,
  type AttachmentPicker,
} from './utils/composer-attachments-picker';
import { BottomSheet } from '@/src/components/ui/bottom-sheet';
import { SheetOverlayPortalContext } from '@/src/components/ui/app-bottom-sheet';

const ATTACHMENT_ICON_SIZE = 54;

type AttachmentOptionConfig = {
  key: string;
  label: string;
  iconBg: string;
  iconColor: string;
  Icon: LucideIcon;
  picker: AttachmentPicker;
};

type AttachmentOptionButtonProps = {
  option: AttachmentOptionConfig;
  disabled: boolean;
  onPress: () => void;
};

const AttachmentOptionButton = ({
  option,
  disabled,
  onPress,
}: AttachmentOptionButtonProps): ReactElement => {
  const { Icon, label, iconBg, iconColor } = option;

  return (
    <Pressable
      className='flex-1 items-center gap-2 py-3 active:opacity-70'
      disabled={disabled}
      accessibilityRole='button'
      accessibilityLabel={label}
      onPress={onPress}
    >
      <View
        className='items-center justify-center rounded-full'
        style={{
          width: ATTACHMENT_ICON_SIZE,
          height: ATTACHMENT_ICON_SIZE,
          backgroundColor: iconBg,
        }}
      >
        <Icon size={24} color={iconColor} strokeWidth={2} />
      </View>
      <Text className='text-center text-[13px] text-secondary-foreground' numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
};

const OpenAttachmentsSheet = ({ isOpen }: { isOpen: boolean }): ReactElement => {
  const { setIsAttachSheetOpenState } = useChatInputActions();
  const insets = useSafeAreaInsets();
  const overlayHostName = useContext(SheetOverlayPortalContext);

  const closeSheetAndDismissKeyboard = async (): Promise<void> => {
    setIsAttachSheetOpenState(false);
    await KeyboardController.dismiss();
  };

  const { pick, isPicking, remainingSlots } = useComposerAttachmentPicking(
    closeSheetAndDismissKeyboard,
  );

  const attachmentOptions = useMemo<AttachmentOptionConfig[]>(
    () => [
      {
        key: 'gallery',
        label: 'Gallery',
        iconBg: '#7F66FF',
        iconColor: '#FFFFFF',
        Icon: Images,
        picker: pickFromGallery,
      },
      {
        key: 'camera',
        label: 'Camera',
        iconBg: '#D4D4D8',
        iconColor: '#52525B',
        Icon: Camera,
        picker: pickFromCamera,
      },
      {
        key: 'document',
        label: 'Document',
        iconBg: '#5B7FD6',
        iconColor: '#FFFFFF',
        Icon: FileText,
        picker: pickFromFiles,
      },
    ],
    [],
  );

  return (
    <BottomSheet isOpen={isOpen} onOpenChange={open => !open && setIsAttachSheetOpenState(false)}>
      <BottomSheet.Portal
        {...(overlayHostName ? { hostName: overlayHostName, disableFullWindowOverlay: true } : {})}
      >
        <BottomSheet.Overlay className='bg-black/40' />
        <BottomSheet.Content
          snapPoints={['24%']}
          index={0}
          backgroundClassName='bg-card rounded-t-3xl'
          handleIndicatorClassName='bg-muted w-10 h-1 rounded-full'
          style={{ paddingBottom: insets.bottom }}
          enablePanDownToClose
          keyboardBehavior='interactive'
          keyboardBlurBehavior='restore'
        >
          <View className='px-3 pt-3 pb-4'>
            <View className='flex-row'>
              {attachmentOptions.map(option => (
                <AttachmentOptionButton
                  key={option.key}
                  option={option}
                  disabled={isPicking || remainingSlots === 0}
                  onPress={() => void pick(option.picker)}
                />
              ))}
            </View>
          </View>
        </BottomSheet.Content>
      </BottomSheet.Portal>
    </BottomSheet>
  );
};

const AttachmentsSheetComponent = (): ReactElement => {
  const { isAttachSheetOpen } = useChatInputPanelState();
  return <OpenAttachmentsSheet isOpen={isAttachSheetOpen} />;
};
const AttachmentsSheet = memo(AttachmentsSheetComponent);

AttachmentsSheet.displayName = 'ChatInput.AttachmentsSheet';

export { AttachmentsSheet };

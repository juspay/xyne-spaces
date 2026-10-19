import {
  useState,
  useMemo,
  useCallback,
  useRef,
  useEffect,
  memo,
  type ComponentProps,
} from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  BackHandler,
  useWindowDimensions,
  type FocusEvent,
  type BlurEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { KeyboardAwareLegendList } from '@legendapp/list/keyboard';
import { KeyboardStickyView, useKeyboardState } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Check, Search } from 'lucide-react-native';
import { useCSSVariable, useUniwind } from 'uniwind';
import { v4 as uuidv4 } from 'uuid';
import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import {
  ZeroProvider as ZeroContextProvider,
  // Provider boundary, not a usage site: the value handed to ZeroProvider must
  // be the real instance. See the comment at `useRawZero()` below.
  // eslint-disable-next-line local-rules/no-rocicorp-use-zero
  useZero as useRawZero,
} from '@rocicorp/zero/react';
import { UserStatus } from '@xyne/shared';

import { useDmPickerSearch } from '@/src/hooks/useDmPickerSearch';
import { useBottomSheetAwareHandlers } from '@/src/hooks/useBottomSheetAwareHandlers';
import { useAuth } from '@/src/contexts/AuthContext';
import { ChannelService } from '@/src/services/ChannelService';
import { useRouter } from 'expo-router';
import Avatar from '@/src/components/ui/avatar';
import { AppBottomSheet, type AppBottomSheetRef } from '@/src/components/ui/app-bottom-sheet';
import { InputV2 } from '@/src/components/ui/input-v2';
import {
  ConversationInput,
  getConversationInputMinimumHeight,
} from '@/src/components/input-composer/conversation-input';
import type { ChatInputSendPayload } from '@/src/components/input-composer/input-composer.types';
import { getChatKeyboardStickyOffset } from '@/src/features/chat/v2/chatKeyboardConfig';
import { plainTextToHtml } from '@/src/utils/plainTextToHtml';
import { rawHtmlTransformer } from '@/src/utils/rawHtmlTransformer';
import { cn } from '@/src/utils/cn';
import { isUserDeactivated } from '@/src/utils/statusUtils';
import { openBaseChatRoute } from '@/src/utils/openChatRoute';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { HTML_TAG_OR_EMPTY, stripHtmlTags } from '@/src/utils/htmlText';

const MAX_PARTICIPANTS = 9;
/** Avatar (32) + name/email column + vertical padding. */
const USER_ROW_ESTIMATED_SIZE = 62;
/** Matches gorhom's default handle height so the body lines up with the snap box. */
const SHEET_HANDLE_HEIGHT = 24;

const NATIVE_GLASS = (() => {
  try {
    return Platform.OS === 'ios' && isGlassEffectAPIAvailable();
  } catch {
    return false;
  }
})();

interface GlassButtonProps {
  /** Solid fill, overriding the glass tint. Used for brand CTAs. */
  fillColor?: string;
  onPress: () => void;
  disabled?: boolean;
  size?: number;
  height?: number;
  borderRadius?: number;
  isDark: boolean;
  className?: string;
  children: React.ReactNode;
}

const GlassButton = ({
  onPress,
  disabled = false,
  size,
  height = 36,
  borderRadius = 12,
  isDark,
  className,
  fillColor,
  children,
}: GlassButtonProps) => {
  const accentBg = useCSSVariable('--color-accent') as string;
  const borderCol = useCSSVariable('--color-border') as string;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => ({
        opacity: pressed ? 0.58 : disabled ? 0.35 : 1,
      })}
    >
      {NATIVE_GLASS ? (
        <GlassView
          isInteractive
          colorScheme={isDark ? 'dark' : 'light'}
          {...(fillColor ? { tintColor: fillColor } : {})}
          style={[glassStyles.glassBase, { width: size, height, borderRadius }]}
        >
          {/* A brand CTA tints the glass rather than painting an opaque fill
              over it — an opaque layer would hide the material entirely. */}
          {className && !fillColor && (
            <View className={className} style={[StyleSheet.absoluteFill, { borderRadius }]} />
          )}
          {children}
        </GlassView>
      ) : (
        <View
          className={className ?? ''}
          style={[
            glassStyles.fallbackBase,
            {
              width: size,
              height,
              borderRadius,
              ...(fillColor
                ? { backgroundColor: fillColor }
                : !className && {
                    backgroundColor: accentBg,
                    borderColor: borderCol,
                  }),
            },
          ]}
        >
          {children}
        </View>
      )}
    </Pressable>
  );
};

const ActionBar = ({
  onCancel,
  onSubmit,
  canSubmit,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  canSubmit: boolean;
}) => {
  const { theme } = useUniwind();
  const isDark = theme === 'dark';
  const { accentBg, accentFg } = useBubbleAccent();

  const primaryTextColor = useCSSVariable('--color-primary-bg') as string;
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const mutedTextColor = useCSSVariable('--color-chat-card-muted') as string;
  const borderColor = useCSSVariable('--color-border') as string;
  const headerColor = useCSSVariable('--color-bottomsheet-text-header') as string;

  if (Platform.OS === 'ios') {
    return (
      <View style={[glassStyles.actionBarRow, { borderBottomColor: borderColor }]}>
        <GlassButton onPress={onCancel} size={44} height={44} borderRadius={30} isDark={isDark}>
          <X size={24} strokeWidth={2.2} color={foregroundColor} />
        </GlassButton>
        <Text className='text-base font-semibold text-foreground'>Add Members</Text>
        <GlassButton
          onPress={onSubmit}
          disabled={!canSubmit}
          size={44}
          height={44}
          borderRadius={30}
          isDark={isDark}
          fillColor={accentBg}
        >
          <Check
            size={22}
            color={canSubmit ? primaryTextColor : mutedTextColor}
            strokeWidth={2.5}
          />
        </GlassButton>
      </View>
    );
  }

  return (
    <View className='flex-row items-center justify-between' style={{ paddingHorizontal: 14 }}>
      <Pressable
        onPress={onCancel}
        hitSlop={8}
        className='rounded-full p-3 bg-bottomsheet-container-bg'
      >
        <X size={22} color={headerColor} />
      </Pressable>

      <Text className='text-lg font-semibold text-bottomsheet-text-header'>Add Members</Text>

      <Pressable
        onPress={onSubmit}
        disabled={!canSubmit}
        className={cn(
          'items-center justify-center rounded-full p-3',
          canSubmit ? 'active:opacity-70' : 'opacity-35',
        )}
        style={{ backgroundColor: accentBg }}
      >
        <Check size={22} color={accentFg} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
};

const glassStyles = StyleSheet.create({
  glassBase: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackBase: {
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
  },
  actionBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 0,
  },
  sheetBody: {
    overflow: 'hidden',
  },
  composerDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
  },
});

const stripHtml = (html: string): string =>
  stripHtmlTags(html.replace(/<br\s*\/?>/gi, '\n'), HTML_TAG_OR_EMPTY)
    .replace(/&nbsp;/gi, ' ')
    .trim();

const decodeNumericHtmlEntities = (html: string): string =>
  html
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => {
      const value = Number.parseInt(hex, 16);
      return Number.isNaN(value) ? _m : String.fromCodePoint(value);
    })
    .replace(/&#([0-9]+);/g, (_m, dec: string) => {
      const value = Number.parseInt(dec, 10);
      return Number.isNaN(value) ? _m : String.fromCodePoint(value);
    });

type DmUserListItem = {
  id: string;
  name: string;
  email: string;
  picture?: string | null;
  status?: UserStatus | null;
};

const UserListItem = memo(
  ({
    user,
    isSelected,
    onToggle,
  }: {
    user: DmUserListItem;
    isSelected: boolean;
    onToggle: (user: DmUserListItem) => void;
  }) => {
    const isDisabled = isUserDeactivated(user);

    return (
      <Pressable
        onPress={() => onToggle(user)}
        disabled={isDisabled}
        className={cn(
          'flex-row items-center px-3 py-3',
          isDisabled ? 'opacity-50' : 'active:bg-secondary/50',
        )}
      >
        <View className='size-8 rounded-lg overflow-hidden'>
          <Avatar userIds={[user.id]} size={32} rounded={false} />
        </View>
        <View className='flex-1 ml-3 min-w-0'>
          <Text
            className={cn(
              'text-base font-medium',
              isDisabled
                ? 'text-bottomsheet-container-text-secondary'
                : 'text-bottomsheet-container-foreground',
            )}
            numberOfLines={1}
          >
            {user.name}
          </Text>
          {isDisabled ? (
            <Text className='text-xs text-bottomsheet-container-text-secondary'>Deactivated</Text>
          ) : user.email && user.email !== user.name ? (
            <Text
              className='text-xs text-bottomsheet-container-text-secondary mt-0.5'
              numberOfLines={1}
            >
              {user.email}
            </Text>
          ) : null}
        </View>
        <View
          className={`size-4.5 rounded-xs border items-center justify-center ${
            isSelected ? 'bg-[#335E40] border-[#335E40]' : 'border-gray-300 bg-transparent'
          }`}
        >
          {isSelected && <Check size={14} color='white' strokeWidth={1.6} />}
        </View>
      </Pressable>
    );
  },
);
UserListItem.displayName = 'UserListItem';

const BottomSheetAwareConversationInput = ({
  ...props
}: Omit<ComponentProps<typeof ConversationInput>, 'onFocus' | 'onBlur'>) => {
  const { onFocus: bsOnFocus, onBlur: bsOnBlur } = useBottomSheetAwareHandlers({
    isBottomSheetAware: true,
  });

  const handleFocus = useCallback(
    (e: FocusEvent) => {
      bsOnFocus(e);
    },
    [bsOnFocus],
  );

  const handleBlur = useCallback(
    (e: BlurEvent) => {
      bsOnBlur(e);
    },
    [bsOnBlur],
  );

  return <ConversationInput {...props} onFocus={handleFocus} onBlur={handleBlur} />;
};

interface CreateDmDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SelectedUser {
  id: string;
  name: string;
  email: string;
  picture?: string | null | undefined;
}

export const CreateDmDrawer = ({ isOpen, onClose }: CreateDmDrawerProps) => {
  const [shouldRender, setShouldRender] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
    }
  }, [isOpen]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        onClose();
      }
    },
    [onClose],
  );

  const handleDismiss = useCallback(() => {
    setShouldRender(false);
  }, []);

  if (!shouldRender) {
    return null;
  }

  return (
    <CreateDmDrawerSheet
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      onDismiss={handleDismiss}
    />
  );
};

const CreateDmDrawerSheet = ({
  isOpen,
  onOpenChange,
  onDismiss,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: () => void;
}) => {
  const router = useRouter();
  const { user: currentUser, token } = useAuth();
  // The raw Zero instance, deliberately NOT the instrumented `useZero()` from
  // @xyne/shared: that returns a Proxy, and Zero's own `useQuery` reads the
  // `#zeroContext` private field off whatever sits in this context. Private
  // fields are not forwarded by a Proxy's `get` trap, so re-providing the
  // wrapper makes every query in the composer subtree throw
  // "Private property does not exist". Instrumentation is not lost: consumers
  // below call `useZero()` themselves and wrap this instance again.
  const zero = useRawZero();
  const sheetRef = useRef<AppBottomSheetRef>(null);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboardIsVisible = useKeyboardState(state => state.isVisible);

  const placeholderColor = useCSSVariable('--color-bottomsheet-container-text-secondary') as string;
  const containerBg = useCSSVariable('--color-bottomsheet-container-bg') as string;
  // iOS sheets pin to the physical bottom (AppBottomSheet bottomInset is 0), so
  // the composer keeps home-indicator padding. Android already insets the sheet.
  const includeComposerSafeArea = Platform.OS === 'ios';
  const composerStickyOffset = useMemo(
    () => getChatKeyboardStickyOffset(includeComposerSafeArea ? insets.bottom : insets.bottom),
    [includeComposerSafeArea, insets.bottom],
  );
  const estimatedComposerHeight = getConversationInputMinimumHeight(
    includeComposerSafeArea ? insets.bottom : 0,
    includeComposerSafeArea,
  );
  const [composerHeight, setComposerHeight] = useState(estimatedComposerHeight);
  // Gorhom's 100% snap is the window minus sheet insets. The handle still sits
  // inside that box, so the body we control is the remainder. LegendList is not
  // a BottomSheetFlatList and will otherwise grow to every row, pushing the
  // composer below the visible clip.
  const sheetBodyHeight =
    windowHeight -
    insets.top -
    (Platform.OS === 'android' ? insets.bottom : 0) -
    SHEET_HANDLE_HEIGHT;

  const handleComposerLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;
    if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
    setComposerHeight(prev => (prev === nextHeight ? prev : nextHeight));
  }, []);

  const draftId = useMemo(() => uuidv4(), []);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<SelectedUser[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const channelService = useMemo(() => new ChannelService(token), [token]);

  const filteredUsers = useDmPickerSearch(searchQuery, 20, currentUser?.user_id);

  const selectedUserIds = useMemo(
    () => new Set(selectedUsers.map(user => user.id)),
    [selectedUsers],
  );

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, [isOpen]);

  const dismissSheet = useCallback(() => {
    Keyboard.dismiss();
    sheetRef.current?.dismiss();
  }, []);

  // Keep Android hardware back scoped to this modal. Without this, repeated back
  // presses can fall through to the DM list while the bottom sheet is dismissing.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!isOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      dismissSheet();
      return true;
    });
    return () => subscription.remove();
  }, [dismissSheet, isOpen]);

  const toggleUserSelection = useCallback((user: DmUserListItem) => {
    if (isUserDeactivated(user)) return;

    setSelectedUsers(prev => {
      const exists = prev.some(selected => selected.id === user.id);
      if (exists) {
        return prev.filter(selected => selected.id !== user.id);
      }

      return [
        ...prev,
        {
          id: user.id,
          name: user.name,
          email: user.email,
          picture: user.picture,
        },
      ];
    });
    setSearchQuery('');
  }, []);

  const removeSelectedUser = useCallback((userId: string) => {
    setSelectedUsers(prev => prev.filter(user => user.id !== userId));
  }, []);

  const isUserSelected = useCallback(
    (userId: string) => selectedUserIds.has(userId),
    [selectedUserIds],
  );

  const renderUserItem = useCallback(
    ({ item }: { item: DmUserListItem }) => (
      <UserListItem
        user={item}
        isSelected={isUserSelected(item.id)}
        onToggle={toggleUserSelection}
      />
    ),
    [isUserSelected, toggleUserSelection],
  );

  const keyExtractor = useCallback((item: DmUserListItem) => item.id, []);

  const isOverLimit = selectedUsers.length > MAX_PARTICIPANTS;
  const canCreate = selectedUsers.length > 0 && !isOverLimit && !isCreating;

  const handleSend = useCallback(
    async ({ text, html }: ChatInputSendPayload) => {
      if (!canCreate) return;

      setIsCreating(true);
      try {
        const participantIds = selectedUsers.map(user => user.id);
        const hasMeaningfulHtml = html.trim().length > 0 && stripHtml(html).length > 0;
        const htmlBeforeTransform = hasMeaningfulHtml ? html : plainTextToHtml(text);
        const htmlWithDecodedEmoji = decodeNumericHtmlEntities(htmlBeforeTransform);
        const transformedHtml = rawHtmlTransformer(htmlWithDecodedEmoji);
        const hasContent = stripHtml(transformedHtml).length > 0;
        const messagePayload = hasContent ? transformedHtml : undefined;

        const response = await channelService.createDm({
          participantIds,
          ...(messagePayload && { message: messagePayload }),
        });

        dismissSheet();
        openBaseChatRoute(router, response.id, { surface: 'dms' });
      } catch (error) {
        console.error('Failed to create DM:', error);
      } finally {
        setIsCreating(false);
      }
    },
    [canCreate, selectedUsers, dismissSheet, router, channelService],
  );

  const handleSubmitWithoutMessage = useCallback(() => {
    void handleSend({ text: '', html: '', attachments: [], alsoSendToChannel: false });
  }, [handleSend]);

  const showComposer = selectedUsers.length > 0;
  const listBottomPadding = showComposer
    ? composerHeight
    : includeComposerSafeArea
      ? insets.bottom
      : 8;

  return (
    <AppBottomSheet
      ref={sheetRef}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      mode='fullscreen'
      // LegendList owns vertical drags. A gorhom content-pan would steal them
      // because this list is not a BottomSheetFlatList. Dismiss still works
      // from the handle. Keyboard motion is owned by KeyboardAwareLegendList +
      // KeyboardStickyView — `extend` would shrink the sheet *and* those would
      // translate, double-offsetting the composer.
      enableContentPanningGesture={false}
      keyboardBehavior='interactive'
      backdropOpacity={0.4}
      onDismiss={onDismiss}
    >
      <View style={[glassStyles.sheetBody, { height: sheetBodyHeight }]}>
        <ActionBar
          onCancel={dismissSheet}
          onSubmit={handleSubmitWithoutMessage}
          canSubmit={canCreate}
        />

        <View className='flex-1 mt-4 px-4' style={{ minHeight: 0 }}>
          <InputV2
            inputRef={inputRef}
            value={searchQuery}
            onChangeText={setSearchQuery}
            variant='bottomsheet'
            placeholder='Search name'
            placeholderTextColor={placeholderColor}
            leftIcon={<Search size={18} color={placeholderColor} />}
            clearIconColor={placeholderColor}
            autoCapitalize='none'
            autoCorrect={false}
            inputClassName='font-medium'
          />

          {selectedUsers.length > 0 && (
            <View className='mt-2 bg-bottomsheet-container-bg rounded-xl'>
              <ScrollView
                horizontal
                contentContainerStyle={{
                  padding: 12,
                  gap: 12,
                }}
                keyboardShouldPersistTaps='handled'
              >
                {selectedUsers.map(user => (
                  <Pressable
                    key={user.id}
                    onPress={() => removeSelectedUser(user.id)}
                    className='relative items-center w-12 gap-1'
                  >
                    <Avatar userIds={[user.id]} size={40} rounded={false} />
                    <Text
                      className='text-xs font-medium text-bottomsheet-text-header'
                      numberOfLines={1}
                    >
                      {user.name}
                    </Text>
                    <View className='absolute right-0 top-0 translate-x-1/4 -translate-y-1/4 z-10 bg-bottomsheet-text-header rounded-full p-0.5 border-2 border-bottomsheet-container-bg'>
                      <X size={10} color={containerBg} />
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          {selectedUsers.length > 0 && (
            <View className='px-2 mt-1'>
              <Text className={`text-xs ${isOverLimit ? 'text-brand font-medium' : 'text-muted'}`}>
                {selectedUsers.length}/{MAX_PARTICIPANTS} participants
                {isOverLimit && ' - Maximum limit exceeded'}
              </Text>
            </View>
          )}

          {searchQuery.trim() && filteredUsers.length === 0 ? (
            <Text className='text-center text-bottomsheet-text-header py-8'>No users found</Text>
          ) : !searchQuery.trim() && filteredUsers.length === 0 ? (
            <Text className='text-center text-bottomsheet-text-header py-8'>
              Type to search for users
            </Text>
          ) : (
            <View className='mt-2 rounded-[10px] flex-1' style={{ minHeight: 0 }}>
              <KeyboardAwareLegendList
                style={{ flex: 1 }}
                data={filteredUsers}
                keyExtractor={keyExtractor}
                renderItem={renderUserItem}
                estimatedItemSize={USER_ROW_ESTIMATED_SIZE}
                recycleItems
                extraData={selectedUserIds}
                keyboardShouldPersistTaps='handled'
                keyboardDismissMode='on-drag'
                keyboardLiftBehavior='whenAtEnd'
                keyboardOffset={includeComposerSafeArea ? insets.bottom : 0}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: listBottomPadding }}
              />
            </View>
          )}
        </View>

        {showComposer ? (
          <KeyboardStickyView
            enabled={keyboardIsVisible}
            offset={composerStickyOffset}
            style={glassStyles.composerDock}
          >
            <View onLayout={handleComposerLayout}>
              <ZeroContextProvider zero={zero}>
                <BottomSheetAwareConversationInput
                  conversationId={draftId}
                  onSend={handleSend}
                  placeholder='Message (optional)...'
                  includeBottomSafeArea={includeComposerSafeArea}
                />
              </ZeroContextProvider>
            </View>
          </KeyboardStickyView>
        ) : null}
      </View>
    </AppBottomSheet>
  );
};

export default CreateDmDrawer;

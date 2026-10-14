import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextInput,
} from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Check, ChevronDown, Hash, Lock, X } from 'lucide-react-native';
import { useCSSVariable, useUniwind } from 'uniwind';
import { v4 as uuidv4 } from 'uuid';
import { useRouter } from 'expo-router';
import { ChannelVisibility } from '@xyne/shared';

import Avatar from '@/src/components/ui/avatar';
import { AppBottomSheet, type AppBottomSheetRef } from '@/src/components/ui/app-bottom-sheet';
import { GlassButton } from '@/src/components/ui/glass-button';
import { InputV2 } from '@/src/components/ui/input-v2';
import Radio from '@/src/components/ui/radio/radio';
import { RadioGroup } from '@/src/components/ui/radio-group';
import { SearchBar } from '@/src/components/ui/search-bar';
import { useAuth, useAuthContextValues } from '@/src/contexts/AuthContext';
import { useChannelById, useChannelDisplayName } from '@/src/hooks/useChannels';
import { useProjects } from '@/src/hooks/useProjects';
import { useQuery } from '@/src/hooks/useQuery';
import { useZero } from '@/src/hooks/useZero';
import { ChannelService } from '@/src/services/ChannelService';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { cn } from '@/src/utils/cn';
import { openBaseChatRoute } from '@/src/utils/openChatRoute';
import { showMessageToast } from '@/src/utils/toast';
import { awaitMutation } from '@/src/zero/awaitMutation';
import { mutators } from '@/src/zero/mutators';
import { queries } from '@/src/zero/queries';

const RADIO_INDICATOR_SIZE = 'size-4.5';
const RADIO_INDICATOR_THUMB_SIZE = 'size-3';
const DUPLICATE_CHECK_DEBOUNCE_MS = 500;
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 80;

type ViewState = 'form' | 'projects';

const VIEW_TITLES: Record<ViewState, string> = {
  form: 'Promote to Channel',
  projects: 'Select Project',
};

const glassStyles = StyleSheet.create({
  actionBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 0,
  },
});

const ActionBar = ({
  view,
  onCancel,
  onSubmit,
  canSubmit,
  isSubmitting,
}: {
  view: ViewState;
  onCancel: () => void;
  onSubmit: () => void;
  canSubmit: boolean;
  isSubmitting: boolean;
}): React.ReactElement => {
  const { theme } = useUniwind();
  const isDark = theme === 'dark';
  const { accentBg, accentFg } = useBubbleAccent();

  const primaryTextColor = useCSSVariable('--color-primary-bg') as string;
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const mutedTextColor = useCSSVariable('--color-chat-card-muted') as string;
  const borderColor = useCSSVariable('--color-border') as string;
  const headerColor = useCSSVariable('--color-bottomsheet-text-header') as string;

  // The project picker is a sub-view of the form: its only exit is the back
  // arrow, so it must not offer submit.
  const showSubmit = view === 'form';
  const isSubmitEnabled = canSubmit && !isSubmitting;

  if (Platform.OS === 'ios') {
    return (
      <View style={[glassStyles.actionBarRow, { borderBottomColor: borderColor }]}>
        <GlassButton onPress={onCancel} size={44} height={44} borderRadius={30} isDark={isDark}>
          <X size={24} strokeWidth={2.2} color={foregroundColor} />
        </GlassButton>
        <Text className='text-base font-semibold text-foreground'>{VIEW_TITLES[view]}</Text>
        {showSubmit ? (
          <GlassButton
            onPress={onSubmit}
            disabled={!isSubmitEnabled}
            size={44}
            height={44}
            borderRadius={30}
            isDark={isDark}
            fillColor={accentBg}
          >
            {isSubmitting ? (
              <ActivityIndicator size='small' color={primaryTextColor} />
            ) : (
              <Check
                size={22}
                color={isSubmitEnabled ? primaryTextColor : mutedTextColor}
                strokeWidth={2.5}
              />
            )}
          </GlassButton>
        ) : (
          <View style={{ width: 44, height: 44 }} />
        )}
      </View>
    );
  }

  return (
    <View className='flex-row items-center justify-between px-4'>
      <Pressable
        onPress={onCancel}
        hitSlop={8}
        className='rounded-full p-3 bg-bottomsheet-container-bg'
      >
        <X size={22} color={headerColor} />
      </Pressable>

      <Text className='text-lg font-semibold text-bottomsheet-text-header'>
        {VIEW_TITLES[view]}
      </Text>

      {showSubmit ? (
        <Pressable
          onPress={onSubmit}
          disabled={!isSubmitEnabled}
          className={cn(
            'items-center justify-center rounded-full p-3',
            isSubmitEnabled ? 'active:opacity-70' : 'opacity-35',
          )}
          style={{ backgroundColor: accentBg }}
        >
          {isSubmitting ? (
            <ActivityIndicator size='small' color={accentFg} />
          ) : (
            <Check size={22} color={accentFg} strokeWidth={2.5} />
          )}
        </Pressable>
      ) : (
        <View style={{ width: 46, height: 46 }} />
      )}
    </View>
  );
};

interface PromoteToChannelSheetProps {
  isOpen: boolean;
  onClose: () => void;
  channelId: string;
}

/**
 * Converts a group DM into a regular channel.
 *
 * The `promoteToChannel` mutator is validation-only on the client — the whole
 * write (scope flip, system message, new conversation) happens server-side, so
 * there is no optimistic update to show. The sheet therefore holds a spinner
 * for the full round-trip and only dismisses once the server acks.
 */
export const PromoteToChannelSheet: React.FC<PromoteToChannelSheetProps> = ({
  isOpen,
  onClose,
  channelId,
}) => {
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
    <PromoteToChannelSheetContent
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      onDismiss={handleDismiss}
      channelId={channelId}
    />
  );
};

const PromoteToChannelSheetContent = ({
  isOpen,
  onOpenChange,
  onDismiss,
  channelId,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: () => void;
  channelId: string;
}): React.ReactElement => {
  const zero = useZero();
  const router = useRouter();
  const { token } = useAuth();
  const { userID: currentUserId } = useAuthContextValues();
  const projects = useProjects();
  const sheetRef = useRef<AppBottomSheetRef>(null);

  // The sheet is fullscreen and covers the info screen that launched it, so it
  // has to restate which conversation is being converted.
  const channel = useChannelById(channelId);
  const groupDisplayName = useChannelDisplayName(channel ?? null, currentUserId);
  const [participants] = useQuery(queries.channelParticipants({ channelId }));
  const participantUserIds = useMemo(
    () => (participants ?? []).map(participant => participant.userId).filter(Boolean),
    [participants],
  );
  const memberCount = participantUserIds.length;

  const placeholderColor = useCSSVariable('--color-bottomsheet-container-text-secondary') as string;
  const brandColor = useCSSVariable('--color-brand') as string;
  const successColor = useCSSVariable('--color-status-success') as string;

  const [view, setView] = useState<ViewState>('form');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  // Matches dashboard's promote form, which defaults to the safer visibility.
  const [isPublic, setIsPublic] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [formatWarning, setFormatWarning] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  /** The exact name the duplicate check last cleared, so the field can confirm availability rather than only reporting failure. */
  const [verifiedAvailableName, setVerifiedAvailableName] = useState<string | null>(null);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const nameInputRef = useRef<TextInput>(null);
  const descriptionInputRef = useRef<TextInput>(null);
  const [isSheetReadyForAutofocus, setIsSheetReadyForAutofocus] = useState(false);
  const hasAutofocusedRef = useRef(false);

  const channelService = useMemo(() => new ChannelService(token), [token]);

  const selectedProject = useMemo(
    () => projects.find(project => project.id === selectedProjectId),
    [projects, selectedProjectId],
  );

  useEffect(() => {
    if (!selectedProjectId && projects[0]) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (name.length < MIN_NAME_LENGTH || !selectedProjectId) {
      setDuplicateError(null);
      setVerifiedAvailableName(null);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setIsCheckingDuplicate(true);
      try {
        const result = await channelService.checkDuplicateChannel(name, selectedProjectId);
        setDuplicateError(result.isDuplicate ? 'Channel name already exists' : null);
        setVerifiedAvailableName(result.isDuplicate ? null : name);
      } catch {
        // Advisory only — the server re-checks the name and its rejection is
        // surfaced by the submit handler.
      } finally {
        setIsCheckingDuplicate(false);
      }
    }, DUPLICATE_CHECK_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [name, selectedProjectId, channelService]);

  // Focus the name field once the sheet has finished animating in — focusing
  // mid-transition fights the sheet's own keyboard handling. Mirrors
  // create-channel-drawer.
  useEffect(() => {
    if (view !== 'form' || !isSheetReadyForAutofocus || hasAutofocusedRef.current) return;
    hasAutofocusedRef.current = true;
    nameInputRef.current?.focus();
  }, [view, isSheetReadyForAutofocus]);

  const handleSheetChange = useCallback((index: number) => {
    setIsSheetReadyForAutofocus(index >= 0);
    if (index < 0) hasAutofocusedRef.current = false;
  }, []);

  const dismissSheet = useCallback(() => {
    Keyboard.dismiss();
    sheetRef.current?.dismiss();
  }, []);

  const handleBack = useCallback(() => {
    if (view === 'projects') {
      setView('form');
      return;
    }
    dismissSheet();
  }, [view, dismissSheet]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [handleBack]);

  const handleNameChange = useCallback((value: string) => {
    const cleanValue = value.replace(/\s+/g, '-').toLowerCase();
    setName(cleanValue);

    if (/[^a-z0-9-]/.test(cleanValue)) {
      setFormatWarning('Use only lowercase letters, numbers, and hyphens');
    } else if (cleanValue.length > MAX_NAME_LENGTH) {
      setFormatWarning(`Channel name must be ${MAX_NAME_LENGTH} characters or less`);
    } else {
      setFormatWarning(null);
    }

    setDuplicateError(null);
    setVerifiedAvailableName(null);
  }, []);

  const isNameAvailable = !!name && verifiedAvailableName === name && !formatWarning;

  const canSubmit =
    name.length >= MIN_NAME_LENGTH &&
    name.length <= MAX_NAME_LENGTH &&
    !!selectedProjectId &&
    !duplicateError &&
    !formatWarning &&
    !isCheckingDuplicate;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || isSubmitting) return;

    setIsSubmitting(true);
    Keyboard.dismiss();

    const trimmedDescription = description.trim();

    try {
      await awaitMutation(
        zero.mutate(
          mutators.channel.promoteToChannel({
            channelId,
            name: name.trim(),
            ...(trimmedDescription ? { description: trimmedDescription } : {}),
            visibility: isPublic ? ChannelVisibility.PUBLIC : ChannelVisibility.PRIVATE,
            projectId: selectedProjectId,
            conversationId: uuidv4(),
            messageId: uuidv4(),
            timestamp: Date.now(),
          }),
        ),
      );

      dismissSheet();
      showMessageToast('Group DM promoted to channel', 'success');
      // The conversation has just moved from the DMs surface to Channels. This
      // reuses the single base chat screen (replacing its params), so the stale
      // `surface: 'dms'` it was opened with cannot leak into later navigation.
      openBaseChatRoute(router, channelId, { surface: 'channels' });
    } catch (error) {
      // Keep the sheet open so the entered details survive a rejection.
      showMessageToast(
        error instanceof Error ? error.message : 'Failed to promote group DM to channel',
        'error',
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    canSubmit,
    isSubmitting,
    description,
    zero,
    channelId,
    name,
    isPublic,
    selectedProjectId,
    dismissSheet,
    router,
  ]);

  const filteredProjects = useMemo(() => {
    const query = projectSearchQuery.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter(project => project.name.toLowerCase().includes(query));
  }, [projects, projectSearchQuery]);

  const sheetContent = (
    <>
      <ActionBar
        view={view}
        onCancel={handleBack}
        onSubmit={() => void handleSubmit()}
        canSubmit={canSubmit}
        isSubmitting={isSubmitting}
      />

      {view === 'form' ? (
        <View className='flex-1 px-4 pb-6 pt-4 gap-5'>
          {/* What is being converted. The sheet covers the info screen, so the
              conversation has to be identifiable from here alone. */}
          <View className='flex-row items-center gap-3 rounded-xl bg-bottomsheet-container-bg px-3 py-3'>
            <Avatar userIds={participantUserIds} size={40} />
            <View className='min-w-0 flex-1'>
              <Text
                className='text-[15px] font-semibold text-bottomsheet-container-foreground'
                numberOfLines={1}
              >
                {groupDisplayName}
              </Text>
              <Text className='text-[13px] text-bottomsheet-text-muted'>
                {memberCount} {memberCount === 1 ? 'member' : 'members'} · Group DM
              </Text>
            </View>
          </View>

          <View className='gap-1.5'>
            <Text className='text-[13px] text-bottomsheet-container-foreground font-semibold'>
              Channel Name
            </Text>
            <InputV2
              inputRef={nameInputRef}
              value={name}
              onChangeText={handleNameChange}
              variant='bottomsheet'
              placeholder='Channel name'
              placeholderTextColor={placeholderColor}
              leftIcon={
                isPublic ? (
                  <Hash size={16} color={placeholderColor} />
                ) : (
                  <Lock size={16} color={placeholderColor} />
                )
              }
              rightAccessory={
                isCheckingDuplicate ? (
                  <ActivityIndicator size='small' color={brandColor} />
                ) : isNameAvailable ? (
                  <Check size={16} color={successColor} strokeWidth={2.5} />
                ) : undefined
              }
              showClearButton={false}
              autoCapitalize='none'
              autoCorrect={false}
              returnKeyType='next'
              onSubmitEditing={() => descriptionInputRef.current?.focus()}
            />
            {formatWarning || duplicateError ? (
              <Text className='text-sm text-status-danger'>{formatWarning || duplicateError}</Text>
            ) : isNameAvailable ? (
              <Text className='text-sm' style={{ color: successColor }}>
                #{name} is available
              </Text>
            ) : (
              <Text className='text-sm text-bottomsheet-text-muted'>
                Please use lowercase and dashes for spaces
              </Text>
            )}
          </View>

          <View className='gap-1.5'>
            <Text className='text-[13px] text-bottomsheet-container-foreground font-semibold'>
              Description (optional)
            </Text>
            <InputV2
              inputRef={descriptionInputRef}
              value={description}
              onChangeText={setDescription}
              variant='bottomsheet'
              placeholderTextColor={placeholderColor}
              clearIconColor={placeholderColor}
              multiline
              numberOfLines={3}
              containerStyle={{ minHeight: 76, maxHeight: 76 }}
              scrollEnabled
              inputClassName='text-sm'
            />
          </View>

          <View className='gap-2'>
            <Text className='text-[13px] font-semibold text-bottomsheet-container-foreground px-1'>
              Project
            </Text>
            <Pressable
              onPress={() => setView('projects')}
              className='flex-row items-center justify-between px-3 py-2 bg-bottomsheet-container-bg rounded-xl active:opacity-80'
            >
              <Text
                className='text-[15px] font-semibold text-bottomsheet-container-foreground'
                numberOfLines={1}
              >
                {selectedProject?.name ?? 'Select a project'}
              </Text>
              <ChevronDown size={16} color={placeholderColor} />
            </Pressable>
          </View>

          <View className='gap-2'>
            <Text className='text-[13px] font-semibold text-bottomsheet-container-foreground px-1'>
              Visibility
            </Text>
            <RadioGroup
              value={isPublic ? 'public' : 'private'}
              onValueChange={value => setIsPublic(value === 'public')}
              className='gap-2'
            >
              <RadioGroup.Item
                value='public'
                className='flex-row items-center justify-between px-4 py-3.5 bg-bottomsheet-container-bg rounded-xl'
              >
                {({ isSelected }) => (
                  <>
                    <View className='min-w-0 flex-1 pr-3'>
                      <Text className='text-[15px] font-medium text-bottomsheet-container-foreground'>
                        Public
                      </Text>
                      <Text className='text-[13px] text-bottomsheet-text-muted'>
                        Anyone in Juspay can find and join
                      </Text>
                    </View>
                    <Radio>
                      <Radio.Indicator
                        className={cn(
                          RADIO_INDICATOR_SIZE,
                          'rounded-full border items-center bg-transparent justify-center overflow-hidden',
                          isSelected ? 'border-[#335E40]' : 'border-border',
                        )}
                      >
                        <Radio.IndicatorThumb
                          className={cn(RADIO_INDICATOR_THUMB_SIZE, 'rounded-full bg-[#335E40]')}
                        />
                      </Radio.Indicator>
                    </Radio>
                  </>
                )}
              </RadioGroup.Item>
              <RadioGroup.Item
                value='private'
                className='flex-row items-center justify-between px-4 py-3.5 bg-bottomsheet-container-bg rounded-xl'
              >
                {({ isSelected }) => (
                  <>
                    <View className='min-w-0 flex-1 pr-3'>
                      <Text className='text-[15px] font-medium text-bottomsheet-container-foreground'>
                        Private
                      </Text>
                      <Text className='text-[13px] text-bottomsheet-text-muted'>
                        Only people who are invited
                      </Text>
                    </View>
                    <Radio>
                      <Radio.Indicator
                        className={cn(
                          RADIO_INDICATOR_SIZE,
                          'rounded-full border items-center bg-transparent justify-center overflow-hidden',
                          isSelected ? 'border-[#335E40]' : 'border-border',
                        )}
                      >
                        <Radio.IndicatorThumb
                          className={cn(RADIO_INDICATOR_THUMB_SIZE, 'rounded-full bg-[#335E40]')}
                        />
                      </Radio.Indicator>
                    </Radio>
                  </>
                )}
              </RadioGroup.Item>
            </RadioGroup>
          </View>
        </View>
      ) : (
        <View className='flex-1 pt-4 px-4'>
          <SearchBar
            value={projectSearchQuery}
            onChangeText={setProjectSearchQuery}
            placeholder='Search projects...'
            containerClassName='mb-4'
            inputClassName='bg-bottomsheet-container-bg-secondary text-sm text-bottomsheet-container-foreground font-medium'
          />

          {filteredProjects.length === 0 ? (
            <Text className='text-center text-bottomsheet-text-muted py-8'>No projects found</Text>
          ) : (
            <ScrollView keyboardShouldPersistTaps='handled'>
              <RadioGroup
                value={selectedProjectId}
                onValueChange={projectId => {
                  setSelectedProjectId(projectId);
                  setProjectSearchQuery('');
                  setView('form');
                }}
                className='rounded-xl overflow-hidden gap-0'
              >
                {filteredProjects.map(project => (
                  <RadioGroup.Item
                    key={project.id}
                    value={project.id}
                    className='flex-row items-center justify-between px-3 py-2'
                  >
                    {({ isSelected }) => (
                      <>
                        <Text className='flex-1 font-medium text-bottomsheet-container-foreground text-base'>
                          {project.name}
                        </Text>
                        <Radio>
                          <Radio.Indicator
                            className={cn(
                              RADIO_INDICATOR_SIZE,
                              'rounded-full border items-center bg-transparent justify-center overflow-hidden',
                              isSelected ? 'border-[#335E40]' : 'border-border',
                            )}
                          >
                            <Radio.IndicatorThumb
                              className={cn(
                                RADIO_INDICATOR_THUMB_SIZE,
                                'rounded-full bg-[#335E40]',
                              )}
                            />
                          </Radio.Indicator>
                        </Radio>
                      </>
                    )}
                  </RadioGroup.Item>
                ))}
              </RadioGroup>
            </ScrollView>
          )}
        </View>
      )}
    </>
  );

  return (
    <AppBottomSheet
      ref={sheetRef}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      mode='fullscreen'
      backdropOpacity={0.4}
      onDismiss={onDismiss}
      onChange={handleSheetChange}
    >
      {view === 'projects' ? (
        <View style={{ flex: 1 }}>{sheetContent}</View>
      ) : (
        <BottomSheetScrollView style={{ flex: 1 }} keyboardShouldPersistTaps='handled'>
          {sheetContent}
        </BottomSheetScrollView>
      )}
    </AppBottomSheet>
  );
};

export default PromoteToChannelSheet;

import { useState, useMemo, useCallback, useEffect, useRef, memo } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  BackHandler,
} from 'react-native';
import { X, Check, ChevronRight, Hash, ChevronDown } from 'lucide-react-native';
import { BottomSheetFlatList, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useCSSVariable, useUniwind } from 'uniwind';

import { useProjects } from '@/src/hooks/useProjects';
import { useUserSearch } from '@/src/hooks/useUsers';
import { useAuth } from '@/src/contexts/AuthContext';
import { ChannelService } from '@/src/services/ChannelService';
import { useRouter } from 'expo-router';
import { RadioGroup } from '@/src/components/ui/radio-group';
import Radio from '@/src/components/ui/radio/radio';
import Avatar from '@/src/components/ui/avatar';
import { AppBottomSheet, type AppBottomSheetRef } from '@/src/components/ui/app-bottom-sheet';
import { GlassButton } from '@/src/components/ui/glass-button';
import { InputV2 } from '@/src/components/ui/input-v2';
import { SearchBar } from '@/src/components/ui/search-bar';
import { cn } from '@/src/utils/cn';
import { openBaseChatRoute } from '@/src/utils/openChatRoute';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

const RADIO_INDICATOR_SIZE = 'size-4.5';
const RADIO_INDICATOR_THUMB_SIZE = 'size-3';
const TAGS_INPUT_MAX_HEIGHT = 100;

type ActionBarStep = 'details' | 'settings' | 'projects' | 'members';

const STEP_TITLES: Record<ActionBarStep, string> = {
  details: 'Create a Channel',
  settings: 'Create a Channel',
  projects: 'Select Projects',
  members: 'Add Members',
};

const ActionBar = ({
  step,
  onCancel,
  onNext,
  onSubmit,
  canProceed,
  isSubmitting,
}: {
  step: ActionBarStep;
  onCancel: () => void;
  onNext: () => void;
  onSubmit: () => void;
  canProceed: boolean;
  isSubmitting: boolean;
}) => {
  const { theme } = useUniwind();
  const isDark = theme === 'dark';
  const { accentBg, accentFg } = useBubbleAccent();

  const primaryTextColor = useCSSVariable('--color-primary-bg') as string;
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const mutedTextColor = useCSSVariable('--color-chat-card-muted') as string;
  const borderColor = useCSSVariable('--color-border') as string;
  const headerColor = useCSSVariable('--color-bottomsheet-text-header') as string;

  const isLastStep = step === 'members';

  if (Platform.OS === 'ios') {
    return (
      <View style={[glassStyles.actionBarRow, { borderBottomColor: borderColor }]}>
        <GlassButton onPress={onCancel} size={44} height={44} borderRadius={30} isDark={isDark}>
          <X size={24} strokeWidth={2.2} color={foregroundColor} />
        </GlassButton>
        <Text className='text-base font-semibold text-foreground'>{STEP_TITLES[step]}</Text>
        {isLastStep ? (
          <GlassButton
            onPress={onSubmit}
            disabled={!canProceed}
            size={44}
            height={44}
            borderRadius={30}
            isDark={isDark}
            fillColor={accentBg}
          >
            <Check
              size={22}
              color={canProceed && !isSubmitting ? primaryTextColor : mutedTextColor}
              strokeWidth={2.5}
            />
          </GlassButton>
        ) : (
          <GlassButton
            onPress={onNext}
            disabled={!canProceed}
            size={44}
            height={44}
            borderRadius={30}
            isDark={isDark}
            fillColor={accentBg}
          >
            <ChevronRight
              size={22}
              color={canProceed ? primaryTextColor : mutedTextColor}
              strokeWidth={2.5}
            />
          </GlassButton>
        )}
      </View>
    );
  }

  return (
    <View className='flex-row items-center justify-between px-4'>
      <Pressable
        onPress={onCancel}
        hitSlop={8}
        className='rounded-full p-3 bg-bottomsheet-container-bg shadow-[0_8px_40px_rgb(0,0,0,0.02)]'
      >
        <X size={22} color={headerColor} />
      </Pressable>

      <Text className='text-lg font-semibold text-bottomsheet-text-header'>
        {STEP_TITLES[step]}
      </Text>

      {isLastStep ? (
        <Pressable
          onPress={onSubmit}
          disabled={!canProceed || isSubmitting}
          className={cn(
            'items-center justify-center rounded-full p-3',
            canProceed && !isSubmitting ? 'active:opacity-70' : 'opacity-35',
          )}
          style={{ backgroundColor: accentBg }}
        >
          <Check size={22} color={accentFg} strokeWidth={2.5} />
        </Pressable>
      ) : (
        <Pressable
          onPress={onNext}
          disabled={!canProceed || step === 'projects'}
          className={cn(
            'items-center justify-center rounded-full p-3 shadow-[0_8px_40px_rgb(0,0,0,0.12)]',
            canProceed && step !== 'projects' ? 'active:opacity-70' : 'opacity-35',
          )}
          style={{ backgroundColor: accentBg }}
        >
          <Text className='text-[17px] font-medium' style={{ color: accentFg }}>
            Next
          </Text>
        </Pressable>
      )}
    </View>
  );
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

const MemberListItem = memo(function MemberListItem({
  user,
  isSelected,
  onToggle,
}: {
  user: { id: string; name: string; email: string; picture?: string | null };
  isSelected: boolean;
  onToggle: (user: { id: string; name: string; email: string; picture?: string | null }) => void;
}) {
  return (
    <Pressable
      onPress={() => onToggle(user)}
      className='flex-row items-center px-3 py-3 active:bg-secondary/50'
    >
      <View className='size-8 rounded-lg overflow-hidden'>
        <Avatar userIds={[user.id]} size={32} rounded={false} />
      </View>
      <View className='flex-1 ml-3'>
        <Text className='text-base font-medium text-bottomsheet-container-foreground'>
          {user.name}
        </Text>
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
});

interface CreateChannelDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

type ViewState = 'details' | 'settings' | 'projects' | 'members';

interface SelectedMember {
  id: string;
  name: string;
  email: string;
  picture?: string | null;
}

interface ProjectOption {
  id: string;
  name: string;
}

export const CreateChannelDrawer = ({ isOpen, onClose }: CreateChannelDrawerProps) => {
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
    <CreateChannelDrawerSheet
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      onDismiss={handleDismiss}
    />
  );
};

const CreateChannelDrawerSheet = ({
  isOpen,
  onOpenChange,
  onDismiss,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: () => void;
}) => {
  const router = useRouter();
  const { user, token } = useAuth();
  const projects = useProjects();
  const sheetRef = useRef<AppBottomSheetRef>(null);

  const placeholderColor = useCSSVariable('--color-bottomsheet-container-text-secondary') as string;
  const containerBg = useCSSVariable('--color-bottomsheet-container-bg') as string;
  const brandColor = useCSSVariable('--color-brand') as string;

  const [channelName, setChannelName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [selectedMembers, setSelectedMembers] = useState<SelectedMember[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  const [viewState, setViewState] = useState<ViewState>('details');
  const [isCreating, setIsCreating] = useState(false);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [formatWarning, setFormatWarning] = useState<string | null>(null);

  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [isSheetReadyForAutofocus, setIsSheetReadyForAutofocus] = useState(false);

  const channelNameInputRef = useRef<TextInput>(null);
  const descriptionInputRef = useRef<TextInput>(null);
  const hasAutofocusedChannelNameRef = useRef(false);

  const channelService = useMemo(() => new ChannelService(token), [token]);

  useEffect(() => {
    if (!selectedProjectId && projects[0]) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (channelName.length < 2 || !selectedProjectId) {
      setDuplicateError(null);
      return;
    }

    const timeoutId = setTimeout(async () => {
      setIsCheckingDuplicate(true);
      try {
        const result = await channelService.checkDuplicateChannel(channelName, selectedProjectId);
        setDuplicateError(result.isDuplicate ? 'Channel name already exists' : null);
      } catch {
        // Ignore errors
      } finally {
        setIsCheckingDuplicate(false);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [channelName, selectedProjectId, channelService]);

  useEffect(() => {
    if (isOpen) return;
    setIsSheetReadyForAutofocus(false);
    hasAutofocusedChannelNameRef.current = false;
  }, [isOpen]);

  useEffect(() => {
    if (
      !isOpen ||
      viewState !== 'details' ||
      !isSheetReadyForAutofocus ||
      hasAutofocusedChannelNameRef.current
    ) {
      return;
    }

    hasAutofocusedChannelNameRef.current = true;
    channelNameInputRef.current?.focus();
  }, [isOpen, isSheetReadyForAutofocus, viewState]);

  const handleSheetChange = useCallback((index: number) => {
    if (index >= 0) {
      setIsSheetReadyForAutofocus(true);
      return;
    }

    setIsSheetReadyForAutofocus(false);
    hasAutofocusedChannelNameRef.current = false;
  }, []);

  const dismissSheet = useCallback(() => {
    Keyboard.dismiss();
    sheetRef.current?.dismiss();
  }, []);

  const handleNameChange = useCallback((value: string) => {
    const cleanValue = value.replace(/\s+/g, '-').toLowerCase();
    setChannelName(cleanValue);

    if (/[^a-z0-9-]/.test(cleanValue)) {
      setFormatWarning('Use only lowercase letters, numbers, and hyphens');
    } else {
      setFormatWarning(null);
    }

    setDuplicateError(null);
  }, []);

  const handleBack = useCallback(() => {
    if (viewState === 'details') {
      dismissSheet();
      return;
    }

    if (viewState === 'settings') {
      setViewState('details');
      return;
    }

    if (viewState === 'projects' || viewState === 'members') {
      setViewState('settings');
    }
  }, [viewState, dismissSheet]);

  // Route the Android hardware back button through our multi-step handler so it
  // steps back (or cleanly dismisses) instead of letting the bottom sheet's
  // default handler desync the sheet/keyboard state and freeze the UI.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!isOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [handleBack, isOpen]);

  const handleNext = useCallback(() => {
    if (viewState === 'details') {
      setViewState('settings');
      return;
    }

    if (viewState === 'settings') {
      setViewState('members');
    }
  }, [viewState]);

  const handleAddTag = useCallback(() => {
    const trimmedTag = tagInput.trim().toLowerCase();
    if (!trimmedTag) return;
    if (tags.includes(trimmedTag)) {
      setTagInput('');
      return;
    }
    setTags(prev => [...prev, trimmedTag]);
    setTagInput('');
  }, [tagInput, tags]);

  const handleRemoveTag = useCallback((tagToRemove: string) => {
    setTags(prev => prev.filter(tag => tag !== tagToRemove));
  }, []);

  const handleToggleMember = useCallback((member: SelectedMember) => {
    setSelectedMembers(prev => {
      const exists = prev.find(m => m.id === member.id);
      if (exists) {
        return prev.filter(m => m.id !== member.id);
      }
      return [...prev, member];
    });
  }, []);

  const selectedProject = useMemo(
    () => projects.find(p => p.id === selectedProjectId),
    [projects, selectedProjectId],
  );

  const handleCreateChannel = useCallback(async () => {
    if (channelName.length < 2 || !selectedProjectId || duplicateError || isCreating) return;

    setIsCreating(true);
    try {
      const requestedParticipants = selectedMembers.map(m => m.id);
      const response = await channelService.createChannel({
        name: channelName,
        description,
        visibility: isPublic ? 'PUBLIC' : 'PRIVATE',
        projectId: selectedProjectId,
        topicTags: tags,
        participants: requestedParticipants,
      });

      dismissSheet();
      openBaseChatRoute(router, response.id, { surface: 'channels' });
    } catch (error) {
      console.error('Failed to create channel:', error);
    } finally {
      setIsCreating(false);
    }
  }, [
    channelName,
    description,
    isPublic,
    selectedProjectId,
    tags,
    selectedMembers,
    duplicateError,
    isCreating,
    dismissSheet,
    router,
    channelService,
  ]);

  const canProceedFromDetails =
    channelName.length >= 2 && !duplicateError && !formatWarning && !isCheckingDuplicate;

  const canProceed = (() => {
    if (viewState === 'details') return canProceedFromDetails;
    if (viewState === 'settings') return !!selectedProjectId;
    if (viewState === 'projects') return !!selectedProjectId;
    return true;
  })();

  /**
   * Which wrapper the step's content wants — a list renders straight into the
   * sheet, a form scrolls inside it. The sheet's own height no longer follows
   * from this: every step is fullscreen, so the flow never resizes underneath
   * the user mid-transition, and a step holding a focused field is never the
   * short sheet that fails to clear the keyboard in this app's portal setup.
   */
  const isListStep = viewState === 'members' || viewState === 'projects';
  const sheetContent = (
    <>
      <ActionBar
        step={viewState}
        onCancel={handleBack}
        onNext={handleNext}
        onSubmit={() => void handleCreateChannel()}
        canProceed={canProceed}
        isSubmitting={isCreating}
      />

      {viewState === 'members' ? (
        <MembersStep
          currentUserId={user?.user_id}
          selectedMembers={selectedMembers}
          containerBg={containerBg}
          placeholderColor={placeholderColor}
          onToggleMember={handleToggleMember}
        />
      ) : (
        <>
          {viewState === 'details' && (
            <DetailsStep
              channelName={channelName}
              description={description}
              tags={tags}
              tagInput={tagInput}
              formatWarning={formatWarning}
              duplicateError={duplicateError}
              isCheckingDuplicate={isCheckingDuplicate}
              placeholderColor={placeholderColor}
              brandColor={brandColor}
              channelNameInputRef={channelNameInputRef}
              descriptionInputRef={descriptionInputRef}
              onNameChange={handleNameChange}
              onDescriptionChange={setDescription}
              onTagInputChange={setTagInput}
              onAddTag={handleAddTag}
              onRemoveTag={handleRemoveTag}
            />
          )}

          {viewState === 'settings' && (
            <SettingsStep
              selectedProjectName={selectedProject?.name}
              isPublic={isPublic}
              placeholderColor={placeholderColor}
              onOpenProjects={() => setViewState('projects')}
              onVisibilityChange={setIsPublic}
            />
          )}

          {viewState === 'projects' && (
            <ProjectsStep
              projects={projects}
              selectedProjectId={selectedProjectId}
              projectSearchQuery={projectSearchQuery}
              onSearchQueryChange={setProjectSearchQuery}
              onSelectProject={projectId => {
                setSelectedProjectId(projectId);
                setViewState('settings');
              }}
            />
          )}
        </>
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
      {isListStep ? (
        <View style={{ flex: 1 }}>{sheetContent}</View>
      ) : (
        <BottomSheetScrollView style={{ flex: 1 }} keyboardShouldPersistTaps='handled'>
          {sheetContent}
        </BottomSheetScrollView>
      )}
    </AppBottomSheet>
  );
};

function DetailsStep({
  channelName,
  description,
  tags,
  tagInput,
  formatWarning,
  duplicateError,
  isCheckingDuplicate,
  placeholderColor,
  brandColor,
  channelNameInputRef,
  descriptionInputRef,
  onNameChange,
  onDescriptionChange,
  onTagInputChange,
  onAddTag,
  onRemoveTag,
}: {
  channelName: string;
  description: string;
  tags: string[];
  tagInput: string;
  formatWarning: string | null;
  duplicateError: string | null;
  isCheckingDuplicate: boolean;
  placeholderColor: string;
  brandColor: string;
  channelNameInputRef: React.RefObject<TextInput | null>;
  descriptionInputRef: React.RefObject<TextInput | null>;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onTagInputChange: (value: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
}) {
  return (
    <View className='flex-1 pt-4 pb-6 px-4 gap-5'>
      <View className='gap-1.5'>
        <Text className='text-[13px] text-bottomsheet-container-foreground font-semibold'>
          Channel Name
        </Text>
        <InputV2
          inputRef={channelNameInputRef}
          value={channelName}
          onChangeText={onNameChange}
          variant='bottomsheet'
          placeholder='Channel name'
          placeholderTextColor={placeholderColor}
          leftIcon={<Hash size={16} color={placeholderColor} />}
          rightAccessory={
            isCheckingDuplicate || duplicateError || formatWarning ? (
              <ActivityIndicator size='small' color={brandColor} />
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
          onChangeText={onDescriptionChange}
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
        <Text className='text-[13px] text-bottomsheet-container-foreground font-semibold'>
          Add Tags (optional)
        </Text>
        <ScrollView
          className='bg-bottomsheet-container-bg rounded-xl'
          style={{ maxHeight: TAGS_INPUT_MAX_HEIGHT }}
          contentContainerStyle={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 8,
            paddingVertical: 8,
            minHeight: 52,
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps='handled'
          nestedScrollEnabled
        >
          {tags.map(tag => (
            <Pressable
              key={tag}
              onPress={() => onRemoveTag(tag)}
              className='flex-row items-center gap-1.5 px-2.5 py-2 bg-bottomsheet-bg shadow-[0_8px_40px_rbg(0,0,0,0.12)]~ shadow-xs rounded-[7px]'
            >
              <Text className='text-sm text-bottomsheet-text-muted'>#{tag}</Text>
              <View
                className='items-center justify-center size-4 rounded-full'
                style={{ backgroundColor: '#A7AAAF' }}
              >
                <X size={10} color='white' />
              </View>
            </Pressable>
          ))}
          <InputV2
            withContainer={false}
            variant='bottomsheet'
            value={tagInput}
            onChangeText={onTagInputChange}
            inputClassName='flex-1 text-foreground'
            placeholderTextColor={placeholderColor}
            onSubmitEditing={onAddTag}
            returnKeyType='done'
            submitBehavior='submit'
          />
        </ScrollView>
      </View>
    </View>
  );
}

function SettingsStep({
  selectedProjectName,
  isPublic,
  placeholderColor,
  onOpenProjects,
  onVisibilityChange,
}: {
  selectedProjectName: string | undefined;
  isPublic: boolean;
  placeholderColor: string;
  onOpenProjects: () => void;
  onVisibilityChange: (isPublic: boolean) => void;
}) {
  return (
    <View className='flex-1 pt-4 pb-6 px-4'>
      <View className='gap-2'>
        <Text className='text-[13px] font-semibold text-bottomsheet-container-foreground px-1'>
          Project
        </Text>
        <Pressable
          onPress={onOpenProjects}
          className='flex-row items-center justify-between px-3 py-2 bg-bottomsheet-container-bg rounded-xl active:opacity-80'
        >
          <Text
            className='text-[15px] font-semibold text-bottomsheet-container-foreground'
            numberOfLines={1}
          >
            {selectedProjectName ?? 'Select a project'}
          </Text>
          <ChevronDown size={16} color={placeholderColor} />
        </Pressable>
      </View>

      <View className='border-[0.5px] border-border my-4' />

      <View className='gap-2'>
        <Text className='text-[13px] font-semibold text-bottomsheet-container-foreground px-1'>
          Visibility
        </Text>
        <RadioGroup
          value={isPublic ? 'public' : 'private'}
          onValueChange={val => onVisibilityChange(val === 'public')}
          className='gap-2'
        >
          <RadioGroup.Item
            value='public'
            className='flex-row items-center justify-between px-4 py-3.5 bg-bottomsheet-container-bg rounded-xl'
          >
            {({ isSelected }) => (
              <>
                <Text className='text-[15px] font-medium text-bottomsheet-container-foreground'>
                  Public - Anyone in Juspay
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
                <Text className='text-[15px] font-medium text-bottomsheet-container-foreground'>
                  Private - Only specific people
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
  );
}

function ProjectsStep({
  projects,
  selectedProjectId,
  projectSearchQuery,
  onSearchQueryChange,
  onSelectProject,
}: {
  projects: ProjectOption[];
  selectedProjectId: string;
  projectSearchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onSelectProject: (projectId: string) => void;
}) {
  const filteredProjects = useMemo(() => {
    if (!projectSearchQuery.trim()) return projects;
    const query = projectSearchQuery.toLowerCase();
    return projects.filter(project => project.name.toLowerCase().includes(query));
  }, [projects, projectSearchQuery]);

  return (
    <View className='flex-1 pt-4 px-4'>
      <SearchBar
        value={projectSearchQuery}
        onChangeText={onSearchQueryChange}
        placeholder='Search projects...'
        containerClassName='mb-4'
        inputClassName='bg-bottomsheet-container-bg-secondary text-sm text-bottomsheet-container-foreground font-medium'
      />

      {filteredProjects.length === 0 ? (
        <Text className='text-center text-bottomsheet-text-muted py-8'>No projects found</Text>
      ) : (
        <ScrollView>
          <RadioGroup
            value={selectedProjectId}
            onValueChange={onSelectProject}
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
                          className={cn(RADIO_INDICATOR_THUMB_SIZE, 'rounded-full bg-[#335E40]')}
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
  );
}

function MembersStep({
  currentUserId,
  selectedMembers,
  containerBg,
  placeholderColor,
  onToggleMember,
}: {
  currentUserId: string | undefined;
  selectedMembers: SelectedMember[];
  containerBg: string;
  placeholderColor: string;
  onToggleMember: (member: SelectedMember) => void;
}) {
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const searchedUsers = useUserSearch(memberSearchQuery, 20);

  const filteredUsers = useMemo(
    () => searchedUsers.filter(u => u.id !== currentUserId),
    [searchedUsers, currentUserId],
  );

  const selectedMemberIds = useMemo(
    () => new Set(selectedMembers.map(member => member.id)),
    [selectedMembers],
  );

  const isMemberSelected = useCallback(
    (memberId: string) => selectedMemberIds.has(memberId),
    [selectedMemberIds],
  );

  const handleToggleAndResetSearch = useCallback(
    (member: SelectedMember) => {
      onToggleMember(member);
      setMemberSearchQuery('');
    },
    [onToggleMember],
  );

  return (
    <View className='flex-1 pt-4 px-4'>
      <InputV2
        value={memberSearchQuery}
        onChangeText={setMemberSearchQuery}
        variant='bottomsheet'
        inputClassName='text-sm'
        placeholder='Search name'
        placeholderTextColor={placeholderColor}
        leftIconColor={placeholderColor}
        clearIconColor={placeholderColor}
        autoCapitalize='none'
        autoCorrect={false}
      />

      {selectedMembers.length > 0 && (
        <View className='mt-4 bg-bottomsheet-container-bg rounded-xl'>
          <ScrollView
            horizontal
            contentContainerStyle={{
              padding: 12,
              gap: 12,
            }}
            keyboardShouldPersistTaps='handled'
          >
            {selectedMembers.map(member => (
              <Pressable
                key={member.id}
                onPress={() => onToggleMember(member)}
                className='relative items-center w-12 gap-1'
              >
                <Avatar userIds={[member.id]} size={40} rounded={false} />
                <Text
                  className='text-xs font-medium text-bottomsheet-text-header'
                  numberOfLines={1}
                >
                  {member.name}
                </Text>
                <View className='absolute right-0 top-0 translate-x-1/4 -translate-y-1/4 z-10 bg-bottomsheet-text-header rounded-full p-0.5 border-2 border-bottomsheet-container-bg'>
                  <X size={10} color={containerBg} />
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {selectedMembers.length > 0 && (
        <View className='px-2 mt-1'>
          <Text className='text-sm text-muted'>{selectedMembers.length} participants</Text>
        </View>
      )}

      {memberSearchQuery.trim() && filteredUsers.length === 0 ? (
        <Text className='text-center text-bottomsheet-text-header py-8'>No users found</Text>
      ) : !memberSearchQuery.trim() && filteredUsers.length === 0 ? (
        <Text className='text-center text-bottomsheet-text-header py-8'>
          Type to search for users
        </Text>
      ) : (
        <View className='mt-4 rounded-[10px] flex-1' style={{ minHeight: 0, flex: 1 }}>
          {/* Gorhom scrollable, not a bare list: this step renders straight into
              the sheet's draggable content, which only yields to a registered
              scrollable. A bare list would let the pan gesture eat every drag. */}
          <BottomSheetFlatList
            style={{ flex: 1 }}
            data={filteredUsers}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <MemberListItem
                user={item}
                isSelected={isMemberSelected(item.id)}
                onToggle={handleToggleAndResetSearch}
              />
            )}
            keyboardShouldPersistTaps='handled'
            keyboardDismissMode='on-drag'
            extraData={selectedMemberIds}
            showsVerticalScrollIndicator={false}
          />
        </View>
      )}
    </View>
  );
}

export default CreateChannelDrawer;

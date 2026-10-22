import { AppHeader } from '@/src/components/app-header';
import { HeaderBackButton } from '@/src/components/ui/header-icon-button';
import { useReportIssue, type ReportAttachment } from '@/src/hooks/useReportIssue';
import { useHeaderHeight } from '@/src/hooks/useHeaderHeight';
import { useRouter } from 'expo-router';
import { CheckCircleIcon, FileIcon, FilmIcon, PaperclipIcon, XIcon } from 'lucide-react-native';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useCSSVariable } from 'uniwind';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

function AttachmentThumbnail({
  attachment,
  onRemove,
}: {
  attachment: ReportAttachment;
  onRemove: () => void;
}) {
  const isImage = attachment.type.startsWith('image/');
  const isVideo = attachment.type.startsWith('video/');

  return (
    <View className='relative mr-2'>
      <View
        className='w-16 h-16 rounded-xl bg-background dark:bg-[#242424] items-center justify-center overflow-hidden'
        style={{ borderCurve: 'continuous' }}
      >
        {isImage ? (
          <Image source={{ uri: attachment.uri }} className='w-full h-full' resizeMode='cover' />
        ) : isVideo ? (
          <FilmIcon size={28} color='#a8a29e' />
        ) : (
          <FileIcon size={28} color='#a8a29e' />
        )}
      </View>
      <Pressable
        onPress={onRemove}
        hitSlop={6}
        className='absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-stone-600 items-center justify-center'
      >
        <XIcon size={10} color='#fff' strokeWidth={3} />
      </Pressable>
    </View>
  );
}

export default function ReportIssue() {
  const router = useRouter();
  const inputColor = useCSSVariable('--color-muted') as string;
  const { headerHeight, topSafeHeight } = useHeaderHeight();

  const {
    titleInputRef,
    descriptionInputRef,
    title,
    setTitle,
    description,
    setDescription,
    attachments,
    isSubmitting,
    isSubmitted,
    canAddMore,
    addFromGallery,
    addFromFiles,
    removeAttachment,
    submit,
    reset,
  } = useReportIssue();

  const handleAddAttachment = () => {
    Alert.alert('Add attachment', undefined, [
      { text: 'Photo & Video', onPress: addFromGallery },
      { text: 'Files', onPress: addFromFiles },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View className='flex-1 px-4 bg-tabs-screen pb-safe-offset-4'>
      <AppHeader backgroundClassName='bg-tabs-screen'>
        <View className='flex-row items-center gap-3'>
          <HeaderBackButton liquidGlass onPress={() => router.back()} />
          <AppHeader.Title>Report an issue</AppHeader.Title>
        </View>
      </AppHeader>

      <KeyboardAvoidingView
        behavior='padding'
        className='flex-1 bg-tabs-screen'
        style={{ paddingTop: headerHeight + topSafeHeight + 20 }}
      >
        {isSubmitted ? (
          <View className='flex-1 items-center justify-center gap-4 pb-16'>
            <CheckCircleIcon size={56} color='#57534e' />
            <Text className='text-foreground font-semibold text-lg'>Report submitted</Text>
            <Text className='text-foreground/80 text-sm text-center px-8'>
              Thanks for letting us know. We&apos;ll look into it.
            </Text>
            <Pressable
              onPress={() => {
                reset();
                router.back();
              }}
              className='mt-4 rounded-full bg-stone-200 dark:bg-stone-700 px-8 py-3'
              style={{ borderCurve: 'continuous' }}
            >
              <Text className='text-stone-800 dark:text-stone-200 font-medium text-base'>
                Go back
              </Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView
            keyboardShouldPersistTaps='handled'
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'space-between' }}
          >
            <View className='gap-6'>
              <View className='gap-2'>
                <Text className='text-foreground font-medium text-sm'>Title</Text>
                <View
                  className='rounded-2xl bg-background dark:bg-[#242424] p-[2px] h-[54px]'
                  style={{ borderCurve: 'continuous' }}
                >
                  <TextInput
                    ref={titleInputRef}
                    placeholder='Give it a short title so we know where to look'
                    placeholderTextColor={inputColor}
                    value={title}
                    onChangeText={setTitle}
                    className='ios:flex-1 px-3 text-xs font-medium h-full text-foreground'
                    returnKeyType='next'
                    onSubmitEditing={() => descriptionInputRef.current?.focus()}
                  />
                </View>
              </View>

              <View className='gap-2'>
                <Text className='text-foreground font-medium text-sm'>Description</Text>
                <View
                  className='rounded-2xl bg-background dark:bg-[#242424] p-[2px]'
                  style={{ borderCurve: 'continuous', minHeight: 120 }}
                >
                  <TextInput
                    ref={descriptionInputRef}
                    placeholder='Tell us what happened, what you expected to see, and any steps that led here. Every detail helps!'
                    placeholderTextColor={inputColor}
                    value={description}
                    onChangeText={setDescription}
                    className='ios:flex-1 px-3 text-xs font-medium text-foreground'
                    multiline
                    numberOfLines={4}
                    textAlignVertical='top'
                  />
                </View>
              </View>

              {/* Attachments */}
              <View className='gap-2'>
                <Text className='text-foreground font-medium text-sm'>Attachments</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingVertical: 4 }}
                >
                  {attachments.map(a => (
                    <AttachmentThumbnail
                      key={a.id}
                      attachment={a}
                      onRemove={() => removeAttachment(a.id)}
                    />
                  ))}
                  {canAddMore && (
                    <Pressable
                      onPress={handleAddAttachment}
                      className='w-16 h-16 rounded-xl bg-background dark:bg-[#242424] items-center justify-center'
                      style={{ borderCurve: 'continuous' }}
                    >
                      <PaperclipIcon size={22} color='#a8a29e' />
                    </Pressable>
                  )}
                </ScrollView>
              </View>
            </View>

            <Pressable
              onPress={submit}
              disabled={isSubmitting}
              className='rounded-full bg-stone-200 dark:bg-stone-700 py-3 items-center mb-3 mt-6'
              style={[{ borderCurve: 'continuous' }, isSubmitting && { opacity: 0.5 }]}
            >
              {isSubmitting ? (
                <ActivityIndicator size='small' color='#57534e' />
              ) : (
                <Text className='text-stone-800 dark:text-stone-200 font-medium text-base'>
                  Submit Report
                </Text>
              )}
            </Pressable>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

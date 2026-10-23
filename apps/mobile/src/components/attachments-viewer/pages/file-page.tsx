import { useMemo, useState, type ReactElement } from 'react';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import WebView from 'react-native-webview';
import { Image } from 'expo-image';
import { Archive, FileText, Pause, Play, RotateCcw } from 'lucide-react-native';

import type { AttachmentsViewerItem } from '@/src/machines/attachmentsMachine';
import {
  cacheMtlsAttachmentFile,
  isAttachmentNotReadyError,
  useMtlsAttachmentFile,
} from '@/src/hooks/useMtlsAttachmentFile';
import { useMtlsThumbnail } from '@/src/hooks/useMtlsThumbnail';
import {
  getAttachmentFileCategory,
  parseCsvRows,
  resolveAttachmentMimeType,
} from '@/src/components/attachments-viewer/utils/file-viewer';
import { formatFileSize } from '@/src/components/chat/message/message-attachments.utils';
import { shareOrSaveAttachment } from '@/src/components/attachments-viewer/utils/saveAttachment';
import { openInDeviceViewer } from '@/src/components/attachments-viewer/utils/openInDeviceViewer';
import { ExternalHtmlViewer } from '@/src/components/attachments-viewer/pages/external-html-viewer';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { isAllowedPdfNavigation } from '@/src/utils/webViewSecurity';
import FileViewer from 'react-native-file-viewer';

type FilePageProps = {
  attachment: AttachmentsViewerItem;
};

const saveAttachmentToDevice = (attachment: AttachmentsViewerItem, uri: string): void => {
  void shareOrSaveAttachment(
    uri,
    attachment.originalFilename ?? 'attachment',
    attachment.mimetype,
  ).catch(error => {
    Alert.alert(
      'Save failed',
      error instanceof Error ? error.message : 'Could not save this file.',
    );
  });
};

// Android: hand the file to an installed app via ACTION_VIEW. When no app can open
// the type, explain and offer to save it — instead of silently launching the
// folder picker.
const openDocumentOnAndroid = async (
  attachment: AttachmentsViewerItem,
  uri: string,
): Promise<void> => {
  try {
    await openInDeviceViewer(
      uri,
      resolveAttachmentMimeType(attachment.mimetype, attachment.originalFilename),
    );
  } catch {
    Alert.alert(
      'No app to open this file',
      'No installed app can open this file type. Save it to your device instead?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save', onPress: (): void => saveAttachmentToDevice(attachment, uri) },
      ],
    );
  }
};

const LoadingState = ({ label = 'Loading preview...' }: { label?: string }): ReactElement => (
  <View className='flex-1 items-center justify-center bg-black'>
    <ActivityIndicator size='large' color='#fff' />
    <Text className='mt-3 text-sm text-white/70'>{label}</Text>
  </View>
);

const ErrorState = ({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): ReactElement => (
  <View className='flex-1 items-center justify-center bg-black px-8'>
    <FileText size={44} color='#ef4444' strokeWidth={1.7} />
    <Text className='mt-4 text-center text-base font-semibold text-white'>Preview failed</Text>
    <Text className='mt-2 text-center text-sm text-white/65'>{message}</Text>
    <Pressable
      onPress={onRetry}
      className='mt-5 flex-row items-center gap-2 rounded-full bg-white/10 px-4 py-2'
    >
      <RotateCcw size={16} color='#fff' />
      <Text className='text-sm font-medium text-white'>Try again</Text>
    </Pressable>
  </View>
);

const UnsupportedState = ({
  attachment,
  message,
}: FilePageProps & { message?: string }): ReactElement => {
  const size = attachment.size ? formatFileSize(attachment.size) : '';
  const [isOpening, setIsOpening] = useState(false);

  const openWithDeviceViewer = async (): Promise<void> => {
    if (isOpening) return;
    setIsOpening(true);
    try {
      const { uri } = await cacheMtlsAttachmentFile(attachment.id, attachment.originalFilename);
      if (Platform.OS === 'android') {
        await openDocumentOnAndroid(attachment, uri);
        return;
      }

      try {
        await FileViewer.open(uri.replace('file://', ''), {
          ...(attachment.originalFilename ? { displayName: attachment.originalFilename } : {}),
        });
        return;
      } catch {
        saveAttachmentToDevice(attachment, uri);
      }
    } catch (error) {
      Alert.alert(
        'Could not open file',
        error instanceof Error ? error.message : 'No device viewer could open this file.',
      );
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <View className='flex-1 items-center justify-center bg-black px-8'>
      <Archive size={50} color='#9ca3af' strokeWidth={1.6} />
      <Text className='mt-5 text-center text-lg font-semibold text-white' numberOfLines={2}>
        {attachment.originalFilename ?? 'Untitled'}
      </Text>
      <Text className='mt-2 text-center text-sm text-white/60'>
        {[attachment.mimetype, size].filter(Boolean).join(' • ')}
      </Text>
      <Text className='mt-5 text-center text-sm text-white/55'>
        {message ??
          (Platform.OS === 'ios'
            ? 'Tap Preview to view this file, or use the download button to save it.'
            : 'This file type needs a device viewer. Open it with an installed app or use the download button to save it.')}
      </Text>
      <Pressable
        onPress={() => void openWithDeviceViewer()}
        disabled={isOpening}
        className='mt-5 rounded-full bg-white/10 px-5 py-2.5'
      >
        {isOpening ? (
          <ActivityIndicator size='small' color='#fff' />
        ) : (
          <Text className='text-sm font-semibold text-white'>
            {Platform.OS === 'ios' ? 'Preview' : 'Open'}
          </Text>
        )}
      </Pressable>
    </View>
  );
};

const TextViewer = ({ text, isCode }: { text: string; isCode?: boolean }): ReactElement => {
  const lines = useMemo(() => text.split(/\r?\n/), [text]);

  return (
    <ScrollView className='flex-1 bg-[#111315]' contentContainerStyle={{ padding: 16 }}>
      {lines.map((line, index) => (
        <View key={`${index}-${line}`} className='flex-row'>
          <Text className='w-11 text-right text-xs text-white/30'>{index + 1}</Text>
          <Text
            className='ml-3 flex-1 text-xs leading-5 text-white/85'
            style={{ fontFamily: isCode ? 'Menlo' : undefined }}
          >
            {line.length > 0 ? line : ' '}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
};

const CsvViewer = ({ text }: { text: string }): ReactElement => {
  const rows = useMemo(() => parseCsvRows(text), [text]);

  if (rows.length === 0) {
    return (
      <View className='flex-1 items-center justify-center bg-black'>
        <Text className='text-sm text-white/70'>No data found in CSV file.</Text>
      </View>
    );
  }

  return (
    <ScrollView className='flex-1 bg-[#111315]'>
      <ScrollView horizontal contentContainerStyle={{ padding: 16 }}>
        <View className='border border-white/15'>
          {rows.map((row, rowIndex) => (
            <View
              key={`${rowIndex}-${row.join('|')}`}
              className={rowIndex === 0 ? 'flex-row bg-white/10' : 'flex-row'}
            >
              {row.map((cell, cellIndex) => (
                <View
                  key={`${rowIndex}-${cellIndex}`}
                  className='border-b border-r border-white/15 px-3 py-2'
                  style={{ minWidth: 120 }}
                >
                  <Text className='text-xs text-white/85' numberOfLines={2}>
                    {cell}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </ScrollView>
  );
};

const IosPdfViewer = ({ uri }: { uri: string }): ReactElement => {
  const readAccessDir = uri.slice(0, uri.lastIndexOf('/') + 1);

  return (
    <WebView
      // Keep the transport whitelist broad because react-native-webview opens
      // excluded URLs through the OS before invoking the policy callback.
      originWhitelist={['*']}
      source={{ uri }}
      allowFileAccess
      allowingReadAccessToURL={readAccessDir}
      onShouldStartLoadWithRequest={({ url }) => isAllowedPdfNavigation(url, uri)}
      style={{ flex: 1, backgroundColor: '#111315' }}
    />
  );
};

const AndroidPdfViewer = ({
  uri,
  attachment,
}: {
  uri: string;
  attachment: AttachmentsViewerItem;
}): ReactElement => {
  const { accentBg } = useBubbleAccent();
  const [isOpening, setIsOpening] = useState(false);
  const { uri: thumbnailUri, isLoading: thumbnailLoading } = useMtlsThumbnail(attachment.id);
  const sizeLabel = attachment.size ? formatFileSize(attachment.size) : '';

  const openExternally = async (): Promise<void> => {
    if (isOpening) return;
    setIsOpening(true);
    try {
      await openDocumentOnAndroid(attachment, uri);
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <View className='flex-1 items-center justify-center px-8'>
      <View
        className='w-full max-w-[300px] overflow-hidden rounded-2xl'
        style={{ aspectRatio: 1 / 1.414 }}
      >
        {thumbnailUri ? (
          <Image
            source={{ uri: thumbnailUri }}
            style={{ flex: 1, width: '100%', backgroundColor: '#fff' }}
            contentFit='contain'
          />
        ) : (
          <View className='flex-1 items-center justify-center bg-white/10'>
            {thumbnailLoading ? (
              <ActivityIndicator color='#fff' />
            ) : (
              <FileText size={44} color='#ef4444' strokeWidth={1.6} />
            )}
          </View>
        )}
      </View>

      <Text className='mt-5 text-center text-lg font-semibold text-white' numberOfLines={2}>
        {attachment.originalFilename ?? 'Document.pdf'}
      </Text>
      <Text className='mt-1 text-sm text-white/55'>
        {['PDF', sizeLabel].filter(Boolean).join(' · ')}
      </Text>
      <Pressable
        onPress={() => void openExternally()}
        disabled={isOpening}
        accessibilityRole='button'
        accessibilityLabel='Open PDF'
        className='mt-7 w-full max-w-[260px] items-center rounded-xl py-3.5 active:opacity-80'
        style={{ backgroundColor: accentBg }}
      >
        {isOpening ? (
          <ActivityIndicator color='#fff' />
        ) : (
          <Text className='text-base font-semibold text-white'>Open</Text>
        )}
      </Pressable>
    </View>
  );
};

const PdfViewer = ({
  uri,
  attachment,
}: {
  uri: string;
  attachment: AttachmentsViewerItem;
}): ReactElement =>
  Platform.OS === 'android' ? (
    <AndroidPdfViewer uri={uri} attachment={attachment} />
  ) : (
    <IosPdfViewer uri={uri} />
  );

const AudioViewer = ({ attachment }: FilePageProps): ReactElement => {
  const { uri, isLoading, error, refetch } = useMtlsAttachmentFile(
    attachment.id,
    attachment.originalFilename,
  );
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  const togglePlayback = (): void => {
    if (status.playing) {
      player.pause();
    } else {
      player.play();
    }
  };

  if (isLoading) return <LoadingState label='Loading audio...' />;
  if (error) return <ErrorState message={error.message} onRetry={refetch} />;

  const progress = status.duration > 0 ? status.currentTime / status.duration : 0;

  return (
    <View className='flex-1 items-center justify-center bg-black px-8'>
      <Text className='text-center text-lg font-semibold text-white' numberOfLines={2}>
        {attachment.originalFilename ?? 'Audio file'}
      </Text>
      <Pressable
        onPress={togglePlayback}
        className='mt-8 h-20 w-20 items-center justify-center rounded-full bg-white/10'
      >
        {status.playing ? (
          <Pause size={34} color='#fff' />
        ) : (
          <Play size={34} color='#fff' fill='#fff' />
        )}
      </Pressable>
      <View className='mt-8 h-1.5 w-full overflow-hidden rounded-full bg-white/15'>
        <View className='h-full rounded-full bg-white' style={{ width: `${progress * 100}%` }} />
      </View>
      <Text className='mt-3 text-xs text-white/55'>
        {Math.floor(status.currentTime)}s / {Math.floor(status.duration)}s
      </Text>
    </View>
  );
};

const DocumentFilePage = ({ attachment }: FilePageProps): ReactElement => {
  const category = getAttachmentFileCategory(attachment.mimetype, attachment.originalFilename);
  const readText = category === 'text' || category === 'code' || category === 'csv';
  const { uri, text, isLoading, error, refetch } = useMtlsAttachmentFile(
    attachment.id,
    attachment.originalFilename,
    { readText },
  );

  if (category === 'unsupported') return <UnsupportedState attachment={attachment} />;
  if (isLoading) return <LoadingState />;
  if (error) {
    if (isAttachmentNotReadyError(error)) {
      return <ErrorState message={error.message} onRetry={refetch} />;
    }
    if (Platform.OS === 'android') {
      return (
        <UnsupportedState
          attachment={attachment}
          message='Preview is not available for this file. Open it with an installed app.'
        />
      );
    }
    return <ErrorState message={error.message} onRetry={refetch} />;
  }

  if ((category === 'text' || category === 'code') && text !== null) {
    return <TextViewer text={text} isCode={category === 'code'} />;
  }
  if (category === 'csv' && text !== null) return <CsvViewer text={text} />;
  if (category === 'html' && uri) {
    return (
      <ExternalHtmlViewer
        uri={uri}
        attachment={attachment}
        openDocumentOnAndroid={openDocumentOnAndroid}
        saveAttachmentToDevice={saveAttachmentToDevice}
      />
    );
  }
  if (category === 'pdf' && uri) {
    return <PdfViewer uri={uri} attachment={attachment} />;
  }

  return <UnsupportedState attachment={attachment} />;
};

export const FilePage = ({ attachment }: FilePageProps): ReactElement => {
  const category = getAttachmentFileCategory(attachment.mimetype, attachment.originalFilename);

  if (category === 'audio') {
    return <AudioViewer attachment={attachment} />;
  }

  return <DocumentFilePage attachment={attachment} />;
};

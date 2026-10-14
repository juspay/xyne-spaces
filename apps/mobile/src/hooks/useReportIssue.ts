import { useRef, useState, useCallback } from 'react';
import { Alert, Platform, TextInput } from 'react-native';
import Constants from 'expo-constants';
import { v4 as uuidv4 } from 'uuid';

import {
  pickFromGallery,
  pickFromFiles,
} from '@/src/components/input-composer/utils/composer-attachments-picker';
import { mtlsMultipartUpload } from '@/src/utils/mtlsFileUpload';
import { haptics } from '@/src/utils/haptics';
import { buildAuthenticatedHeaders } from '@/src/services/authToken';
import { API_BASE_URL } from '@/src/config';

export interface ReportAttachment {
  id: string;
  uri: string;
  name: string;
  type: string;
  size: number;
}

const MAX_REPORT_ATTACHMENTS = 9;
const ALL_FILE_TYPES = ['*/*'];

function buildDescription(userText: string): string {
  return [
    userText,
    '',
    '---',
    'Error report context',
    `Platform: ${Platform.OS}`,
    `App version: ${Constants.expoConfig?.version ?? 'unknown'}`,
    `Timestamp: ${new Date().toISOString()}`,
  ].join('\n');
}

export function useReportIssue() {
  const titleInputRef = useRef<TextInput>(null);
  const descriptionInputRef = useRef<TextInput>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [attachments, setAttachments] = useState<ReportAttachment[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const canAddMore = attachments.length < MAX_REPORT_ATTACHMENTS;

  const addFromGallery = useCallback(async () => {
    if (!canAddMore) return;
    try {
      const picked = await pickFromGallery(ALL_FILE_TYPES);
      const mapped = picked.map(a => ({
        id: uuidv4(),
        uri: a.localUri,
        name: a.originalFilename,
        type: a.mimetype,
        size: a.size,
      }));
      setAttachments(prev => {
        const slots = MAX_REPORT_ATTACHMENTS - prev.length;
        return [...prev, ...mapped.slice(0, slots)];
      });
    } catch (e) {
      Alert.alert('Could not add files', e instanceof Error ? e.message : 'Unknown error');
    }
  }, [canAddMore]);

  const addFromFiles = useCallback(async () => {
    if (!canAddMore) return;
    try {
      const picked = await pickFromFiles(ALL_FILE_TYPES);
      const mapped = picked.map(a => ({
        id: uuidv4(),
        uri: a.localUri,
        name: a.originalFilename,
        type: a.mimetype,
        size: a.size,
      }));
      setAttachments(prev => {
        const slots = MAX_REPORT_ATTACHMENTS - prev.length;
        return [...prev, ...mapped.slice(0, slots)];
      });
    } catch (e) {
      Alert.alert('Could not add files', e instanceof Error ? e.message : 'Unknown error');
    }
  }, [canAddMore]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  const submit = useCallback(async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      Alert.alert('Title required', 'Please add a short title before submitting.');
      return;
    }

    setIsSubmitting(true);
    try {
      const authHeaders = await buildAuthenticatedHeaders();
      await mtlsMultipartUpload({
        url: `${API_BASE_URL}/tickets`,
        fields: {
          title: trimmedTitle,
          description: buildDescription(description),
          tags: ['xyne-spaces-native', 'Support Ticket'],
          fileMetadata: JSON.stringify(
            attachments.map((_, i) => ({ fileIndex: i, hasThumbnail: false })),
          ),
        },
        files: attachments.map(a => ({ uri: a.uri, name: a.name, type: a.type })),
        headers: { ...authHeaders, 'x-support-ticket': 'true' },
        allowRepeatedFields: true,
      });
      void haptics.success();
      setIsSubmitted(true);
    } catch (e) {
      void haptics.error();
      Alert.alert('Submission failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [title, description, attachments]);

  const reset = useCallback(() => {
    setTitle('');
    setDescription('');
    setAttachments([]);
    setIsSubmitted(false);
  }, []);

  return {
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
  };
}

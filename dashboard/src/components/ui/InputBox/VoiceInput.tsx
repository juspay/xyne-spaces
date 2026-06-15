/**
 * VoiceInput — self-contained mic button that records audio via MediaRecorder,
 * forwards the blob to POST /api/voice-input/transcribe, and inserts the
 * resulting transcript into the TipTap editor as typed/mention tokens.
 *
 * Usage in InputBox (desktop):
 *   const voiceInputRef = useRef<VoiceInputHandle>(null);
 *   <VoiceInput ref={voiceInputRef} editor={editor}
 *     mentionItems={mentionItems} voiceMentionItems={voiceMentionItems}
 *     disabled={disabled} isSending={isSending}
 *     onStateChange={({ isRecording, isTranscribing }) => {
 *       setIsVoiceRecording(isRecording);
 *       setIsVoiceTranscribing(isTranscribing);
 *     }}
 *   />
 *
 * Expose toggle() via ref so MobileEditor's onVoiceToggle can call it.
 */
import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import type { Editor } from '@tiptap/react';
import { Mic, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import Tooltip from '../Tooltip/Tooltip';
import type { MentionResult } from '../Selectors/Selectors.types';
import { voiceInputService } from '../../../services/VoiceInput/voiceInputService';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface VoiceUserRecord {
  userId: string;
  username: string;
  email?: string;
  picture?: string;
}

interface VoiceMentionMatcher {
  pattern: RegExp;
  nameMap: Map<string, string>;
  userMap: Map<string, VoiceUserRecord>;
}

/**
 * Compile the org user set into a single mention-matching RegExp plus lookup
 * maps. This is expensive (an alternation over every user name) and is intended
 * to be built ONCE per user set and reused — never on the render path. Voice
 * code calls it lazily, the first time a transcript actually needs parsing.
 */
function buildVoiceMentionMatcher(source: readonly MentionResult[]): VoiceMentionMatcher | null {
  const candidates = source
    .filter(item => item.type === 'user')
    .map(item => {
      const canonicalName = item.name.replace(/ \(you\)$/, '').trim();
      const searchName = (item.username || canonicalName).trim();
      return {
        canonicalName,
        searchName,
        userId: item.id,
        email: item.email,
        picture: item.picture,
      };
    })
    .filter(item => item.canonicalName.length > 0 && item.searchName.length > 0);

  const nameMap = new Map<string, string>();
  const userMap = new Map<string, VoiceUserRecord>();
  const firstNameToUsers = new Map<string, Set<string>>();

  candidates.forEach(item => {
    const key = item.searchName.toLowerCase();
    nameMap.set(key, item.canonicalName);
    userMap.set(key, {
      userId: item.userId,
      username: item.canonicalName,
      ...(item.email !== undefined && { email: item.email }),
      ...(item.picture !== undefined && { picture: item.picture }),
    });

    const [firstName] = item.searchName.split(/\s+/);
    const normalizedFirstName = (firstName || '').toLowerCase();
    if (normalizedFirstName.length >= 3) {
      const usersForFirstName = firstNameToUsers.get(normalizedFirstName) || new Set<string>();
      usersForFirstName.add(item.canonicalName);
      firstNameToUsers.set(normalizedFirstName, usersForFirstName);
    }
  });

  firstNameToUsers.forEach((usersForFirstName, firstName) => {
    if (usersForFirstName.size === 1) {
      const resolved = Array.from(usersForFirstName)[0];
      if (resolved) {
        nameMap.set(firstName, resolved);
        const userEntry = Array.from(userMap.values()).find(u => u.username === resolved);
        if (userEntry) userMap.set(firstName, userEntry);
      }
    }
  });

  const sortedNames = Array.from(nameMap.keys()).sort((a, b) => b.length - a.length);
  if (sortedNames.length === 0) return null;

  const pattern = new RegExp(
    `\\b(?:tag|at)\\s+(${sortedNames.map(name => escapeRegex(name)).join('|')})(?=[\\s,.!?;:)\\]\\}<]|$)`,
    'gi',
  );

  return { pattern, nameMap, userMap };
}

/** STT name hints derived from the org user set. Built lazily, reused per set. */
function buildVoiceHints(source: readonly MentionResult[]): string[] {
  return source
    .filter(item => item.type === 'user')
    .map(item => item.name.replace(/ \(you\)$/, '').trim())
    .filter(Boolean);
}

export interface VoiceInputHandle {
  toggle: () => void;
}

interface VoiceInputProps {
  editor: Editor | null;
  mentionItems?: MentionResult[];
  voiceMentionItems?: MentionResult[];
  disabled?: boolean;
  isSending?: boolean;
  /** Called whenever recording/transcribing state changes; used by MobileEditor */
  onStateChange?: (state: { isRecording: boolean; isTranscribing: boolean }) => void;
  /** When true, renders nothing but still mounts all logic and exposes toggle() via ref */
  headless?: boolean;
}

export const VoiceInput = forwardRef<VoiceInputHandle, VoiceInputProps>(
  (
    {
      editor,
      mentionItems = [],
      voiceMentionItems = [],
      disabled = false,
      isSending = false,
      onStateChange,
      headless = false,
    },
    ref,
  ) => {
    const [isVoiceRecording, setIsVoiceRecording] = useState(false);
    const [isVoiceTranscribing, setIsVoiceTranscribing] = useState(false);
    const voiceRecorderRef = useRef<MediaRecorder | null>(null);
    const voiceStreamRef = useRef<MediaStream | null>(null);
    const voiceChunksRef = useRef<BlobPart[]>([]);

    // Notify parent whenever recording/transcribing state changes
    useEffect(() => {
      onStateChange?.({ isRecording: isVoiceRecording, isTranscribing: isVoiceTranscribing });
    }, [isVoiceRecording, isVoiceTranscribing, onStateChange]);

    // ── Mention resolution ──────────────────────────────────────────────────
    // The matcher is an org-sized RegExp that is expensive to build but only
    // ever consumed when an actual voice transcript needs parsing. We therefore
    // build it lazily and cache it keyed by the source array identity, so it is
    // compiled once per user set instead of on every render / channel switch.
    const matcherCacheRef = useRef<{
      source: readonly MentionResult[];
      matcher: VoiceMentionMatcher | null;
    } | null>(null);

    const getVoiceMentionMatcher = useCallback((): VoiceMentionMatcher | null => {
      const source = voiceMentionItems.length > 0 ? voiceMentionItems : mentionItems;
      const cached = matcherCacheRef.current;
      if (cached && cached.source === source) return cached.matcher;
      const matcher = buildVoiceMentionMatcher(source);
      matcherCacheRef.current = { source, matcher };
      return matcher;
    }, [voiceMentionItems, mentionItems]);

    // ── Token types for structured transcript insertion ─────────────────────
    type VoiceToken =
      | { kind: 'text'; value: string }
      | { kind: 'special'; mentionType: 'here' | 'channel' }
      | { kind: 'user'; userId: string; username: string; email?: string; picture?: string };

    const parseVoiceTranscript = useCallback(
      (text: string): VoiceToken[] => {
        let marked = text
          .replace(/\b(?:tag|at)\s+here\b/gi, '\x00here\x00')
          .replace(/\b(?:tag|at)\s+channel\b/gi, '\x00channel\x00')
          // Also handle cases where STT already emits "@here" / "@channel" as literal text
          .replace(/@here\b/gi, '\x00here\x00')
          .replace(/@channel\b/gi, '\x00channel\x00');

        const matcher = getVoiceMentionMatcher();
        if (matcher) {
          marked = marked.replace(matcher.pattern, (_fullMatch: string, capturedName: string) => {
            const key = capturedName.toLowerCase();
            const user = matcher.userMap.get(key);
            if (user) {
              const emailSuffix = user.email ? `:${user.email}` : '';
              return `\x00user:${user.userId}:${user.username}${emailSuffix}\x00`;
            }
            return `@${capturedName}`;
          });
        }

        // eslint-disable-next-line no-control-regex
        const parts = marked.split(/(\x00[^\x00]+\x00)/g);
        const tokens: VoiceToken[] = [];

        for (const part of parts) {
          if (part.startsWith('\x00') && part.endsWith('\x00')) {
            const inner = part.slice(1, -1);
            if (inner === 'here') {
              tokens.push({ kind: 'special', mentionType: 'here' });
            } else if (inner === 'channel') {
              tokens.push({ kind: 'special', mentionType: 'channel' });
            } else if (inner.startsWith('user:')) {
              const rest = inner.slice(5);
              const firstColon = rest.indexOf(':');
              if (firstColon !== -1) {
                const userId = rest.slice(0, firstColon);
                const remainder = rest.slice(firstColon + 1);
                const secondColon = remainder.indexOf(':');
                const username = secondColon !== -1 ? remainder.slice(0, secondColon) : remainder;
                const email = secondColon !== -1 ? remainder.slice(secondColon + 1) : undefined;
                tokens.push({ kind: 'user', userId, username, ...(email && { email }) });
              } else {
                tokens.push({ kind: 'text', value: `@${rest}` });
              }
            }
          } else if (part.length > 0) {
            tokens.push({ kind: 'text', value: part });
          }
        }

        return tokens;
      },
      [getVoiceMentionMatcher],
    );

    // ── Editor insertion ────────────────────────────────────────────────────
    const appendTranscriptionToEditor = useCallback(
      (text: string): void => {
        if (!editor) return;
        const tokens = parseVoiceTranscript(text);
        const nonEmpty = tokens.filter(
          t => t.kind !== 'text' || (t as { kind: 'text'; value: string }).value.trim().length > 0,
        );
        if (nonEmpty.length === 0) return;

        const currentText = editor.getText();
        const shouldPrefixSpace = currentText.length > 0 && !currentText.endsWith(' ');
        if (shouldPrefixSpace) {
          editor.chain().focus().insertContent(' ').run();
        } else {
          editor.chain().focus().run();
        }

        const from = editor.state.selection.to;

        for (const token of nonEmpty) {
          if (token.kind === 'text') {
            editor.commands.insertContent(token.value.trim());
          } else if (token.kind === 'special') {
            editor.commands.insertSpecialMention({ mentionType: token.mentionType });
          } else if (token.kind === 'user') {
            editor.commands.insertMention({
              userId: token.userId,
              username: token.username,
              ...(token.email !== undefined && { userEmail: token.email }),
              ...(token.picture !== undefined && { userPicture: token.picture }),
            });
          }
        }

        editor.commands.insertContent(' ');

        const to = editor.state.selection.to;

        if (to > from && editor.schema.marks['voiceShimmer']) {
          editor
            .chain()
            .setTextSelection({ from, to })
            .setMark('voiceShimmer')
            .setTextSelection(to)
            .run();
          setTimeout(() => {
            if (!editor.isDestroyed) {
              editor
                .chain()
                .setTextSelection({ from, to })
                .unsetMark('voiceShimmer')
                .setTextSelection(to)
                .run();
            }
          }, 1400);
        }
      },
      [editor, parseVoiceTranscript],
    );

    // ── STT hints (user display names for the STT provider) ────────────────
    // Like the matcher, derived from the org user set and only needed at the
    // moment we transcribe. Built lazily and cached per source identity.
    const hintsCacheRef = useRef<{
      source: readonly MentionResult[];
      hints: string[];
    } | null>(null);

    const getVoiceHints = useCallback((): string[] => {
      const source = voiceMentionItems.length > 0 ? voiceMentionItems : mentionItems;
      const cached = hintsCacheRef.current;
      if (cached && cached.source === source) return cached.hints;
      const hints = buildVoiceHints(source);
      hintsCacheRef.current = { source, hints };
      return hints;
    }, [voiceMentionItems, mentionItems]);

    // ── Media stream helpers ────────────────────────────────────────────────
    const stopVoiceStream = useCallback((): void => {
      voiceStreamRef.current?.getTracks().forEach(track => track.stop());
      voiceStreamRef.current = null;
    }, []);

    const transcribeVoiceBlob = useCallback(
      async (blob: Blob): Promise<void> => {
        setIsVoiceTranscribing(true);
        try {
          const transcript = await voiceInputService.transcribeAudio({
            audioBlob: blob,
            hints: getVoiceHints(),
          });
          appendTranscriptionToEditor(transcript.text);
        } catch (err) {
          toast.error('Voice transcription failed', {
            description: err instanceof Error ? err.message : 'Unknown error',
          });
        } finally {
          setIsVoiceTranscribing(false);
        }
      },
      [appendTranscriptionToEditor, getVoiceHints],
    );

    const stopVoiceRecording = useCallback((): void => {
      const recorder = voiceRecorderRef.current;
      if (!recorder) return;
      if (recorder.state !== 'inactive') recorder.stop();
      setIsVoiceRecording(false);
    }, []);

    const startVoiceRecording = useCallback(async (): Promise<void> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error('Voice recording is not supported in this browser');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        voiceStreamRef.current = stream;
        voiceChunksRef.current = [];

        const preferredTypes = [
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/ogg;codecs=opus',
          'audio/mp4',
        ];
        const mimeType = preferredTypes.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

        recorder.ondataavailable = (event: BlobEvent) => {
          if (event.data.size > 0) voiceChunksRef.current.push(event.data);
        };

        recorder.onstop = () => {
          const blob = new Blob(voiceChunksRef.current, {
            type: mimeType || 'audio/webm',
          });
          voiceChunksRef.current = [];
          voiceRecorderRef.current = null;
          stopVoiceStream();
          void transcribeVoiceBlob(blob);
        };

        recorder.onerror = () => {
          setIsVoiceRecording(false);
          stopVoiceStream();
          toast.error('Voice recording failed unexpectedly');
        };

        voiceRecorderRef.current = recorder;
        recorder.start();
        setIsVoiceRecording(true);
      } catch (err) {
        const isDenied = err instanceof DOMException && err.name === 'NotAllowedError';
        stopVoiceStream();
        toast.error(isDenied ? 'Microphone permission denied' : 'Failed to start voice recording');
      }
    }, [stopVoiceStream, transcribeVoiceBlob]);

    const handleVoiceToggle = useCallback((): void => {
      if (isVoiceTranscribing || disabled || isSending) return;
      if (isVoiceRecording) {
        stopVoiceRecording();
        return;
      }
      void startVoiceRecording();
    }, [
      isVoiceRecording,
      isVoiceTranscribing,
      disabled,
      isSending,
      stopVoiceRecording,
      startVoiceRecording,
    ]);

    // Expose toggle() so MobileEditor's onVoiceToggle can call it via ref
    useImperativeHandle(ref, () => ({ toggle: handleVoiceToggle }), [handleVoiceToggle]);

    // Release microphone on unmount
    useEffect(() => {
      return () => {
        const recorder = voiceRecorderRef.current;
        if (recorder && recorder.state !== 'inactive') recorder.stop();
        stopVoiceStream();
      };
    }, [stopVoiceStream]);

    // ── Render ──────────────────────────────────────────────────────────────
    if (headless) return null;

    return (
      <Tooltip
        content={
          isVoiceTranscribing
            ? 'Transcribing...'
            : isVoiceRecording
              ? 'Stop voice input'
              : 'Start voice input'
        }
        side='top'
      >
        <button
          type='button'
          onClick={handleVoiceToggle}
          className={`p-1.5 rounded transition-all duration-200 ease-in-out ${
            isVoiceRecording
              ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
              : 'hover:bg-accent text-muted-foreground'
          }`}
          aria-label={isVoiceRecording ? 'Stop voice input' : 'Start voice input'}
          disabled={disabled || isSending || isVoiceTranscribing}
          data-track-category='CHAT_INPUT'
          data-track-name={isVoiceRecording ? 'STOP_VOICE_INPUT' : 'START_VOICE_INPUT'}
        >
          {isVoiceTranscribing ? (
            <Loader2 className='h-4 w-4 animate-spin' />
          ) : (
            <Mic className='h-4 w-4' />
          )}
        </button>
      </Tooltip>
    );
  },
);

VoiceInput.displayName = 'VoiceInput';

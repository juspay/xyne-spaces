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
import { Loader2 } from 'lucide-react';
import { MicOn } from '@xyne/icons';
import { toast } from 'sonner';
import Tooltip from '../Tooltip/Tooltip';
import { ShortcutHint } from '../ShortcutHint';
import type { MentionResult } from '@xyne/shared';
import { voiceInputService } from '../../../services/VoiceInput/voiceInputService';
import type { VoiceStreamSession } from '../../../services/VoiceInput/voiceInputService';

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

// Live transcript is revealed into the editor one word at a time on this cadence,
// for a smooth "typewriter" feel instead of whole-phrase jumps. Pure display pacing —
// it does not change what the server streams over the WebSocket.
const VOICE_REVEAL_INTERVAL_MS = 150;

// Safety net after end-of-audio: if the server never closes the stream, force-close
// it after this long so the UI doesn't hang in the transcribing state.
const VOICE_STREAM_FORCE_CLOSE_MS = 12000;

/** Prefix of `target` extended by up to `words` whole words past `shown`. If `shown`
 *  is no longer a prefix of `target` (the server revised earlier words), snap to the
 *  full `target` so we never display stale text. */
function revealMoreWords(target: string, shown: string, words: number): string {
  if (!target.startsWith(shown)) return target;
  let i = shown.length;
  for (let w = 0; w < words && i < target.length; w += 1) {
    while (i < target.length && target[i] === ' ') i += 1;
    while (i < target.length && target[i] !== ' ') i += 1;
  }
  return target.slice(0, i);
}

export interface VoiceInputHandle {
  toggle: () => void;
  /** Called by the composer right before it sends: strips any unfinalized interim
   *  text from the editor and aborts an active voice stream (no drain), so nothing
   *  in flight leaks into the next message. No-op when no stream is active. */
  abortForSend: () => void;
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
    const wsSessionRef = useRef<VoiceStreamSession | null>(null);
    // Tracks the editor range occupied by the current interim (partial) transcript.
    const voiceStreamInterimRangeRef = useRef<{ from: number; to: number } | null>(null);
    // Set when a send aborts the stream; makes late frames stop touching the editor.
    const voiceStreamAbortedRef = useRef(false);
    // Word-pacing buffer (see VOICE_REVEAL_INTERVAL_MS): transcript text feeds these
    // refs and a timer drains them into the editor one word at a time.
    const revealTargetRef = useRef(''); // full text we're typing toward (current phrase)
    const revealShownRef = useRef(''); // text currently rendered in the interim region
    const revealMustCommitRef = useRef(false); // target is a final → mention-commit once shown
    const revealPendingPartialRef = useRef<string | null>(null); // partial queued during a commit
    const revealTimerRef = useRef<number | null>(null);
    // Handle for the post-endAudio force-close safety net (see VOICE_STREAM_FORCE_CLOSE_MS).
    const voiceStreamCloseTimeoutRef = useRef<number | null>(null);

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

    // ── Streaming transcript reveal (word-paced) ────────────────────────────
    // Incoming partial/final text feeds a buffer; a timer drains it into the editor's
    // interim region one word at a time for a smooth typewriter effect. A final is
    // revealed the same way, then committed with full mention parsing once shown.

    // Replace the interim region's content with `text` (or clear it when empty).
    const renderInterim = useCallback(
      (text: string): void => {
        if (!editor) return;
        const range = voiceStreamInterimRangeRef.current;
        if (range === null) {
          if (!text) return;
          const pos = editor.state.selection.to;
          editor.commands.insertContent(text);
          voiceStreamInterimRangeRef.current = { from: pos, to: editor.state.selection.to };
          return;
        }
        editor.chain().setTextSelection({ from: range.from, to: range.to }).deleteSelection().run();
        if (text) {
          editor.commands.insertContent(text);
          voiceStreamInterimRangeRef.current = { from: range.from, to: editor.state.selection.to };
        } else {
          voiceStreamInterimRangeRef.current = null;
        }
      },
      [editor],
    );

    // Swap the interim region for the mention-parsed, committed final text.
    const commitFinal = useCallback(
      (text: string): void => {
        const range = voiceStreamInterimRangeRef.current;
        if (editor && range) {
          editor
            .chain()
            .setTextSelection({ from: range.from, to: range.to })
            .deleteSelection()
            .run();
        }
        voiceStreamInterimRangeRef.current = null;
        appendTranscriptionToEditor(text);
      },
      [editor, appendTranscriptionToEditor],
    );

    const clearRevealTimer = useCallback((): void => {
      if (revealTimerRef.current !== null) {
        window.clearInterval(revealTimerRef.current);
        revealTimerRef.current = null;
      }
    }, []);

    const clearVoiceStreamCloseTimer = useCallback((): void => {
      if (voiceStreamCloseTimeoutRef.current !== null) {
        window.clearTimeout(voiceStreamCloseTimeoutRef.current);
        voiceStreamCloseTimeoutRef.current = null;
      }
    }, []);

    // Drop the buffer without committing — used on abort and at session start.
    const resetReveal = useCallback((): void => {
      clearRevealTimer();
      revealTargetRef.current = '';
      revealShownRef.current = '';
      revealMustCommitRef.current = false;
      revealPendingPartialRef.current = null;
    }, [clearRevealTimer]);

    const revealTick = useCallback((): void => {
      if (!editor) return;
      const target = revealTargetRef.current;
      const shown = revealShownRef.current;

      if (shown !== target) {
        // Catch up faster when the backlog is large so lag stays bounded.
        const remaining = target.length - shown.length;
        const words = remaining > 60 ? 4 : remaining > 30 ? 2 : 1;
        const next = revealMoreWords(target, shown, words);
        renderInterim(next);
        revealShownRef.current = next;
        if (next !== target) return; // more words to reveal on the next tick
      }

      // Fully revealed: commit a final (with mention parsing), then pick up any
      // partial that was queued for the next phrase while we were committing.
      if (revealMustCommitRef.current) {
        commitFinal(target);
        revealMustCommitRef.current = false;
        revealTargetRef.current = '';
        revealShownRef.current = '';
        const pending = revealPendingPartialRef.current;
        revealPendingPartialRef.current = null;
        if (pending !== null) revealTargetRef.current = pending;
      }
    }, [editor, renderInterim, commitFinal]);

    const ensureRevealTimer = useCallback((): void => {
      if (revealTimerRef.current === null) {
        revealTimerRef.current = window.setInterval(revealTick, VOICE_REVEAL_INTERVAL_MS);
      }
    }, [revealTick]);

    // Immediately reveal + commit everything still buffered (stream closing normally).
    const flushReveal = useCallback((): void => {
      clearRevealTimer();
      const target = revealTargetRef.current;
      if (revealMustCommitRef.current) {
        commitFinal(target);
      } else if (target && target !== revealShownRef.current) {
        renderInterim(target);
      }
      revealTargetRef.current = '';
      revealShownRef.current = '';
      revealMustCommitRef.current = false;
      revealPendingPartialRef.current = null;
    }, [clearRevealTimer, commitFinal, renderInterim]);

    const handleStreamPartial = useCallback(
      (text: string): void => {
        if (!text) return;
        if (revealMustCommitRef.current) {
          // A final is still revealing; this partial belongs to the next phrase. Queue it.
          revealPendingPartialRef.current = text;
        } else {
          revealTargetRef.current = text;
        }
        ensureRevealTimer();
      },
      [ensureRevealTimer],
    );

    const handleStreamFinal = useCallback(
      (text: string): void => {
        if (revealMustCommitRef.current) {
          // Rare: a new final arrived before the previous finished revealing. Commit prev.
          commitFinal(revealTargetRef.current);
          revealShownRef.current = '';
        }
        revealTargetRef.current = text;
        revealMustCommitRef.current = true;
        ensureRevealTimer();
      },
      [commitFinal, ensureRevealTimer],
    );

    // ── Media stream helpers ────────────────────────────────────────────────
    const stopVoiceStream = useCallback((): void => {
      voiceStreamRef.current?.getTracks().forEach(track => track.stop());
      voiceStreamRef.current = null;
    }, []);

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

        const preferredTypes = [
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/ogg;codecs=opus',
          'audio/mp4',
        ];
        const mimeType = preferredTypes.find(t => MediaRecorder.isTypeSupported(t)) ?? '';
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

        const session = voiceInputService.openStreamSession();
        wsSessionRef.current = session;
        voiceStreamAbortedRef.current = false;
        resetReveal();

        session.onMessage(msg => {
          // Once a send has aborted this stream, ignore any straggler frames so they
          // can't leak into the (now cleared) next message.
          if (voiceStreamAbortedRef.current) return;
          if (msg.type === 'partial' && msg.text) {
            handleStreamPartial(msg.text);
          } else if (msg.type === 'final' && msg.text) {
            handleStreamFinal(msg.text);
          } else if (msg.type === 'error') {
            toast.error('Voice transcription failed', {
              description: msg.message ?? 'Streaming error',
            });
          }
        });

        session.onClose(() => {
          clearVoiceStreamCloseTimer();
          // Flush remaining buffered words (commit the final) unless a send aborted the
          // stream, in which case everything in flight is intentionally discarded.
          if (voiceStreamAbortedRef.current) {
            resetReveal();
          } else {
            flushReveal();
          }
          voiceStreamInterimRangeRef.current = null;
          wsSessionRef.current = null;
          setIsVoiceTranscribing(false);
        });

        session.onError(() => {
          clearVoiceStreamCloseTimer();
          toast.error('Voice stream disconnected unexpectedly');
          resetReveal();
          voiceStreamInterimRangeRef.current = null;
          wsSessionRef.current = null;
          setIsVoiceTranscribing(false);
        });

        // Send each 250ms chunk as a binary frame over the WebSocket. The session
        // serializes Blob→ArrayBuffer conversion so frames stay in order.
        recorder.ondataavailable = (event: BlobEvent) => {
          if (event.data.size > 0) session.sendChunk(event.data);
        };

        recorder.onstop = () => {
          // Signal end-of-audio (flushing the last buffered chunk first) but keep the
          // socket open so the server can stream back the final transcript before it
          // closes — onClose then clears the transcribing state. Closing here would
          // drop the tail audio and the final result.
          session.endAudio();
          setIsVoiceTranscribing(true);
          voiceRecorderRef.current = null;
          stopVoiceStream();
          // Safety net: if the server never closes after end-of-stream, force-close
          // so the UI doesn't hang in the transcribing state.
          voiceStreamCloseTimeoutRef.current = window.setTimeout(() => {
            voiceStreamCloseTimeoutRef.current = null;
            session.close();
          }, VOICE_STREAM_FORCE_CLOSE_MS);
        };

        recorder.onerror = () => {
          setIsVoiceRecording(false);
          stopVoiceStream();
          session.close();
          toast.error('Voice recording failed unexpectedly');
        };

        voiceRecorderRef.current = recorder;
        recorder.start(250); // 250ms timeslices for low latency
        setIsVoiceRecording(true);
      } catch (err) {
        const isDenied = err instanceof DOMException && err.name === 'NotAllowedError';
        stopVoiceStream();
        toast.error(isDenied ? 'Microphone permission denied' : 'Failed to start voice recording');
      }
    }, [stopVoiceStream, handleStreamPartial, handleStreamFinal, resetReveal, flushReveal]);

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

    // Abort an active stream because the composer is sending. Distinct from the
    // mic-stop drain: we DISCARD everything still in flight rather than waiting for
    // the final transcript. The trailing interim text is unfinalized, so it's removed
    // from the editor — only already-committed (final) text remains to be sent.
    const abortForSend = useCallback((): void => {
      if (!wsSessionRef.current && !isVoiceRecording && !isVoiceTranscribing) return;

      voiceStreamAbortedRef.current = true;
      clearVoiceStreamCloseTimer();
      resetReveal();

      // Drop the unfinalized interim text from the editor.
      const range = voiceStreamInterimRangeRef.current;
      if (editor && range) {
        editor.chain().setTextSelection({ from: range.from, to: range.to }).deleteSelection().run();
      }
      voiceStreamInterimRangeRef.current = null;

      // Stop capture without the draining onstop handler, then hard-close the socket.
      const recorder = voiceRecorderRef.current;
      if (recorder) {
        recorder.onstop = null;
        if (recorder.state !== 'inactive') recorder.stop();
      }
      voiceRecorderRef.current = null;
      stopVoiceStream();
      wsSessionRef.current?.close();
      wsSessionRef.current = null;
      setIsVoiceRecording(false);
      setIsVoiceTranscribing(false);
    }, [
      editor,
      isVoiceRecording,
      isVoiceTranscribing,
      stopVoiceStream,
      resetReveal,
      clearVoiceStreamCloseTimer,
    ]);

    // Expose toggle() so MobileEditor's onVoiceToggle can call it via ref
    useImperativeHandle(ref, () => ({ toggle: handleVoiceToggle, abortForSend }), [
      handleVoiceToggle,
      abortForSend,
    ]);

    // Release microphone, WebSocket, the reveal timer, and the force-close safety net
    // on unmount — otherwise the safety-net timeout can outlive this component and
    // fire session.close() against an already torn-down/stale session.
    useEffect(() => {
      return () => {
        const recorder = voiceRecorderRef.current;
        if (recorder && recorder.state !== 'inactive') recorder.stop();
        stopVoiceStream();
        wsSessionRef.current?.close();
        wsSessionRef.current = null;
        clearRevealTimer();
        clearVoiceStreamCloseTimer();
      };
    }, [stopVoiceStream, clearRevealTimer, clearVoiceStreamCloseTimer]);

    // ── Render ──────────────────────────────────────────────────────────────
    if (headless) return null;

    return (
      <Tooltip
        content={
          isVoiceTranscribing ? (
            'Transcribing...'
          ) : (
            <span className='flex items-center gap-2'>
              {isVoiceRecording ? 'Stop voice input' : 'Start voice input'}
              <ShortcutHint shortcut='composer.voiceInput' />
            </span>
          )
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
            <MicOn className='h-4 w-4' />
          )}
        </button>
      </Tooltip>
    );
  },
);

VoiceInput.displayName = 'VoiceInput';

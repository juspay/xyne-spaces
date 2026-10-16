import { useSyncExternalStore } from 'react';
import type { MarkedMoment, TranscriptEntry } from './recordingStore';

/**
 * Live transcript for the *current normal call*.
 *
 * The transcription agent publishes to the `transcriptions` LiveKit data topic for every
 * call, but `recordingStore` only subscribes while a recording is active. This store is
 * fed by `useCallTranscriptSync` (mounted once in the in-call view) so a normal call can
 * render the live transcript without a recording running. It reuses `recordingStore`'s
 * `TranscriptEntry` type so entries stay assignable to `LiveTranscriptList`.
 */

/** Fields the sync hook parses off the wire; the store owns the monotonic `id`. */
export type CallTranscriptInput = Omit<TranscriptEntry, 'id'>;

const listeners = new Set<() => void>();
let transcripts: TranscriptEntry[] = [];
let markedMoments: MarkedMoment[] = [];
let idCounter = 0;

function emit(): void {
  listeners.forEach(listener => listener());
}

export function subscribeCallTranscripts(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

export function getCallTranscriptsSnapshot(): TranscriptEntry[] {
  return transcripts;
}

export function getCallMarkedMomentsSnapshot(): MarkedMoment[] {
  return markedMoments;
}

/** Id the next transcript line will receive — used to anchor a moment after the current tail. */
export function getNextCallTranscriptId(): number {
  return idCounter + 1;
}

export function addCallTranscript(input: CallTranscriptInput): void {
  idCounter += 1;
  transcripts = [...transcripts, { id: idCounter, ...input }];
  emit();
}

/**
 * Flag the current point locally so the transcript divider appears instantly, mirroring
 * the recording path. Persistence to the call is handled separately by `useCallMarkMoment`.
 */
export function addCallMarkedMoment(moment: MarkedMoment): void {
  markedMoments = [...markedMoments, moment];
  emit();
}

/** Clears transcript + moments — call on room change / disconnect so nothing leaks across calls. */
export function resetCallTranscripts(): void {
  if (transcripts.length === 0 && markedMoments.length === 0) return;
  transcripts = [];
  markedMoments = [];
  emit();
}

export function useCallTranscripts(): TranscriptEntry[] {
  return useSyncExternalStore(subscribeCallTranscripts, getCallTranscriptsSnapshot);
}

export function useCallMarkedMoments(): MarkedMoment[] {
  return useSyncExternalStore(subscribeCallTranscripts, getCallMarkedMomentsSnapshot);
}

import { logger, Event as LogEvent } from '../utils/logger';
/**
 * useAudioAmplitude — extracts real-time amplitude data from the LiveKit
 * microphone track using the Web Audio API (AnalyserNode).
 *
 */

import { useEffect, useRef, useState } from 'react';
import { Track, type Room } from 'livekit-client';

// ======CONSTANTS======

const NUM_BARS = 42; // Number of amplitude bars to display
const FFT_SIZE = 2048; // Size of the FFT used for the AnalyserNode.
const RETRY_MS = 200; // Time to wait before retrying to set up the audio context.
const MAX_RETRIES = 10;
const UPDATE_INTERVAL_MS = 110; // Time interval between amplitude updates.
const SMOOTHING_TIME_CONSTANT = 0.6; // Smoothing constant for the AnalyserNode. A value between 0 and 1.
const AMPLITUDE_MULTIPLIER = 4; // Multiplier for the RMS amplitude to make it more visually prominent.

export function useAudioAmplitude(
  room: Room | null,
  isActive: boolean,
  isPaused: boolean,
): number[] {
  const [bars, setBars] = useState<number[]>(() => new Array<number>(NUM_BARS).fill(0));
  const bufferRef = useRef<number[]>(new Array<number>(NUM_BARS).fill(0));

  useEffect(() => {
    if (!room || !isActive || isPaused) {
      bufferRef.current = new Array<number>(NUM_BARS).fill(0);
      setBars(new Array<number>(NUM_BARS).fill(0));
      return;
    }

    let cancelled = false;
    let rafId: number | null = null;
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    let lastUpdate = 0;

    const setup = (): void => {
      if (cancelled || !room) return;

      const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      const audioTrack = publication?.audioTrack;
      const mediaStreamTrack = audioTrack?.mediaStreamTrack;

      if (!mediaStreamTrack || mediaStreamTrack.readyState !== 'live') {
        if (retryCount++ < MAX_RETRIES) {
          retryTimer = setTimeout(setup, RETRY_MS);
        }
        return;
      }

      let tentativeAudioContext: AudioContext | null = null;
      try {
        tentativeAudioContext = new AudioContext();
        tentativeAudioContext.resume().catch(err => {
          logger.warn(LogEvent.FRONTEND_ERROR, {
            type: 'migrated_console_warn',
            message: String('[useAudioAmplitude] Failed to resume AudioContext:'),
            context: [err],
          });
        });
        analyser = tentativeAudioContext.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.smoothingTimeConstant = SMOOTHING_TIME_CONSTANT;

        const stream = new MediaStream([mediaStreamTrack]);
        source = tentativeAudioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        audioContext = tentativeAudioContext;
        retryCount = 0;
      } catch (err) {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('[useAudioAmplitude] Failed to create AudioContext:'),
          error: err,
        });
        tentativeAudioContext?.close().catch(() => undefined); // Clean up on error
        if (retryCount++ < MAX_RETRIES) {
          retryTimer = setTimeout(setup, RETRY_MS);
        }
        return;
      }

      const dataArray = new Uint8Array(analyser.fftSize);

      const update = (now: number): void => {
        if (cancelled || !analyser) return;

        // Track ended (e.g. mic toggled off/on) — tear down and re-setup
        if (mediaStreamTrack.readyState !== 'live') {
          if (rafId !== null) cancelAnimationFrame(rafId);
          source?.disconnect();
          analyser?.disconnect();
          audioContext?.close().catch(() => undefined); // Suppress unhandled rejection
          source = null;
          analyser = null;
          audioContext = null;
          rafId = null;
          retryTimer = setTimeout(setup, RETRY_MS);
          return;
        }

        if (now - lastUpdate >= UPDATE_INTERVAL_MS) {
          lastUpdate = now;
          analyser.getByteTimeDomainData(dataArray);

          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const sample = dataArray[i] ?? 128;
            const v = (sample - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / dataArray.length);
          const amplitude = Math.min(1, rms * AMPLITUDE_MULTIPLIER);

          bufferRef.current.shift();
          bufferRef.current.push(amplitude);
          setBars([...bufferRef.current]);
        }

        rafId = requestAnimationFrame(update);
      };

      rafId = requestAnimationFrame(update);
    };

    setup();

    return (): void => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (retryTimer !== null) clearTimeout(retryTimer);
      source?.disconnect();
      analyser?.disconnect();
      audioContext?.close().catch(() => undefined); // Suppress unhandled rejection
    };
  }, [room, isActive, isPaused]);

  return bars;
}

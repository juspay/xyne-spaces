import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { callService } from '../services/Call/callService';
import { apiInstance } from '../services/clients/apiClient';
import type { User } from '../machines/authMachine';
import { CalendarVisibility } from '@xyne/shared';
import { getAvatarColorHex } from '../components/ui/Avatar/Avatar';

export interface OtherUserBusySlot {
  startsAt: number;
  endsAt: number | null;
  id?: string;
  title?: string;
}

export interface OtherUserCalls {
  user: User;
  color: string;
  calls: OtherUserBusySlot[];
  calendarVisibility: CalendarVisibility;
}

const MEET_WITH_COLORS = [
  '#33b679',
  '#8e24aa',
  '#f4511e',
  '#039be5',
  '#c0ca33',
  '#7986cb',
  '#616161',
  '#e67c73',
  '#0b8043',
  '#d81b60',
  '#009688',
  '#f6bf26',
  '#3f51b5',
  '#795548',
];

// Used when the avatar itself is grey, so the calendar colour stays readable.
const NEUTRAL_AVATAR_COLOR = '#64748b';
const PICTURE_SAMPLE_SIZE = 24;
const FLAT_COLOR_CHANNEL_TOLERANCE = 24;
const FLAT_COLOR_MIN_SHARE = 0.55;

/**
 * Colour of a picture that is really a generated letter avatar (initials on one flat
 * colour), or null for a photo. Sampled from the pixels, since nothing else marks it.
 */
async function sampleFlatPictureColor(blob: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(blob, {
    resizeWidth: PICTURE_SAMPLE_SIZE,
    resizeHeight: PICTURE_SAMPLE_SIZE,
  });
  const canvas = document.createElement('canvas');
  canvas.width = PICTURE_SAMPLE_SIZE;
  canvas.height = PICTURE_SAMPLE_SIZE;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data } = context.getImageData(0, 0, PICTURE_SAMPLE_SIZE, PICTURE_SAMPLE_SIZE);

  const pixels: [number, number, number][] = [];
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 128) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    pixels.push([r, g, b]);
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }

  let dominant: { count: number; r: number; g: number; b: number } | null = null;
  for (const bucket of buckets.values()) {
    if (!dominant || bucket.count > dominant.count) dominant = bucket;
  }
  if (!dominant) return null;

  const mean = [dominant.r, dominant.g, dominant.b].map(sum => Math.round(sum / dominant.count));
  // Counted around the mean rather than by bucket, so noise straddling a bucket edge still counts.
  const matching = pixels.filter(pixel =>
    pixel.every((channel, i) => Math.abs(channel - mean[i]!) <= FLAT_COLOR_CHANNEL_TOLERANCE),
  ).length;
  if (matching / pixels.length < FLAT_COLOR_MIN_SHARE) return null;

  if (Math.max(...mean) - Math.min(...mean) < FLAT_COLOR_CHANNEL_TOLERANCE) {
    return NEUTRAL_AVATAR_COLOR;
  }
  return `#${mean.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

const flatPictureColorCache = new Map<string, Promise<string | null>>();

function getFlatPictureColor(userId: string, picture: string): Promise<string | null> {
  const cacheKey = `${userId}:${picture}`;
  let pending = flatPictureColorCache.get(cacheKey);
  if (!pending) {
    pending = (async (): Promise<string | null> => {
      try {
        const { data: blob } = picture.startsWith('http')
          ? await axios.get<Blob>(picture, { responseType: 'blob' })
          : await apiInstance.get<Blob>(
              `/users/${userId}/picture?v=${encodeURIComponent(picture)}`,
              { responseType: 'blob' },
            );
        return await sampleFlatPictureColor(blob);
      } catch {
        return null;
      }
    })();
    flatPictureColorCache.set(cacheKey, pending);
  }
  return pending;
}

// Someone recognised by a letter avatar — the built-in one, or a picture that is just
// initials on a flat colour — keeps that colour on the calendar; a photo takes the next
// palette colour.
async function getMeetWithColor(user: User, index: number): Promise<string> {
  if (!user.picture) return getAvatarColorHex(user.id) ?? NEUTRAL_AVATAR_COLOR;
  return (
    (await getFlatPictureColor(user.id, user.picture)) ??
    MEET_WITH_COLORS[index % MEET_WITH_COLORS.length]!
  );
}

export function useOtherUserCalls(from: Date, to: Date) {
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [otherUsersCalls, setOtherUsersCalls] = useState<Map<string, OtherUserCalls>>(new Map());

  const fetchCallsForUser = useCallback(
    async (user: User, index: number) => {
      try {
        const [result, color] = await Promise.all([
          callService.getOtherUserScheduledCalls(user.id, from, to),
          getMeetWithColor(user, index),
        ]);
        setOtherUsersCalls(prev => {
          const next = new Map(prev);
          next.set(user.id, {
            user,
            color,
            calls: result.calls,
            calendarVisibility: result.calendarVisibility,
          });
          return next;
        });
      } catch {
        // silently ignore — user stays in selectedUsers but with empty calls
      }
    },
    [from, to],
  );

  // Re-fetch all selected users when date range changes
  useEffect(() => {
    selectedUsers.forEach((user, i) => {
      void fetchCallsForUser(user, i);
    });
  }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const addUser = useCallback(
    (user: User) => {
      setSelectedUsers(prev => {
        if (prev.find(u => u.id === user.id)) return prev;
        const updated = [...prev, user];
        void fetchCallsForUser(user, updated.length - 1);
        return updated;
      });
    },
    [fetchCallsForUser],
  );

  const removeUser = useCallback((userId: string) => {
    setSelectedUsers(prev => prev.filter(u => u.id !== userId));
    setOtherUsersCalls(prev => {
      const next = new Map(prev);
      next.delete(userId);
      return next;
    });
  }, []);

  // The slots come from a one-off request, not a live query, so callers re-pull them
  // after anything that may have changed the selected users' calendars.
  const refresh = useCallback(() => {
    selectedUsers.forEach((user, i) => void fetchCallsForUser(user, i));
  }, [selectedUsers, fetchCallsForUser]);

  return { selectedUsers, otherUsersCalls, addUser, removeUser, refresh };
}

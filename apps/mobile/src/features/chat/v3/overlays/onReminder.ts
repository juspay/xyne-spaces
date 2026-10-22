import type { Zero } from '@rocicorp/zero';
import { BookmarkEntityType } from '@xyne/shared';

import { mutators } from '@/src/zero/mutators';
import { upsertReminderMetadataWithContext, type ReminderMetadataContext } from '../model/reminder';

export type ExistingReminderBookmark = {
  isDeleted?: boolean;
  isCompleted?: boolean;
  metadata: unknown;
} | null;

export type OnReminderDeps = {
  zero: Zero;
  createId: () => string;
  now: () => number;
};

export const applyReminder = (
  deps: OnReminderDeps,
  args: {
    messageId: string;
    remindAtMs: number;
    existing: ExistingReminderBookmark;
    context: ReminderMetadataContext;
  },
): 'update' | 'add' => {
  const metadata = upsertReminderMetadataWithContext(
    args.existing?.metadata,
    args.remindAtMs,
    args.context,
  );
  const active =
    args.existing !== null &&
    args.existing.isDeleted !== true &&
    args.existing.isCompleted !== true;
  if (active) {
    void deps.zero.mutate(
      mutators.bookmark.updateMetadata({
        entityId: args.messageId,
        entityType: BookmarkEntityType.MESSAGE,
        metadata,
        timestamp: deps.now(),
      }),
    );
    return 'update';
  }
  void deps.zero.mutate(
    mutators.bookmark.add({
      entityId: args.messageId,
      entityType: BookmarkEntityType.MESSAGE,
      bookmarkId: deps.createId(),
      timestamp: deps.now(),
      metadata,
    }),
  );
  return 'add';
};

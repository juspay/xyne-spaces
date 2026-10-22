import { batch, observable } from '@legendapp/state';

import { getBoolean, getString, setBoolean, setString } from '@/src/services/localStorage';

import {
  DEFAULT_ACTIVITY_PREFERENCES,
  type ActivityActorKind,
  type ActivityPreferences,
  type ActivityViewMode,
} from '../model/preferences';
import { isFilterVisible } from '../model/filter';
import { activityFilter$ } from './filter-store';

// The dashboard's keys, so one name means one thing across the apps. The
// unread key is also the one the shared screen model writes.
const UNREAD_KEY = 'activity_unread_toggle';
const ACTOR_KIND_KEY = 'activity_actor_filter';
const ACTIONABLE_KEY = 'activity_actionable_toggle';
const VIEW_MODE_KEY = 'activity_view_mode';

function readInitial(): ActivityPreferences {
  const kind = getString(ACTOR_KIND_KEY);
  const viewMode = getString(VIEW_MODE_KEY);
  return {
    unreadOnly: getBoolean(UNREAD_KEY) ?? DEFAULT_ACTIVITY_PREFERENCES.unreadOnly,
    actorKind: kind === 'user' || kind === 'agent' ? kind : DEFAULT_ACTIVITY_PREFERENCES.actorKind,
    actorUserId: null,
    actionable: getBoolean(ACTIONABLE_KEY) ?? DEFAULT_ACTIVITY_PREFERENCES.actionable,
    viewMode:
      viewMode === 'condensed' || viewMode === 'detailed'
        ? viewMode
        : DEFAULT_ACTIVITY_PREFERENCES.viewMode,
  };
}

/**
 * What the tray's controls show: the person's latest choices, updated the
 * instant they are made. Cheap to write and cheap to observe — only the tray
 * and the filter button read it.
 */
export const activityPreferences$ = observable<ActivityPreferences>(readInitial());

/**
 * What the feed is built from: the choices as of the last
 * `applyActivityPreferences()`.
 *
 * Kept apart from the draft because applying is the expensive part — a new
 * query, a model reset, a rebuilt list, a swapped chip set — and it should not
 * run inside the tap that made the choice, competing with that control's own
 * animation. Controls apply once they have settled; closing the tray applies
 * anything left over.
 *
 * Per-field nodes, so a row subscribing to `viewMode` is not woken by the
 * unread switch.
 */
export const appliedActivityPreferences$ = observable<ActivityPreferences>({
  // A copy: Legend writes into the object it is given, so sharing the draft's
  // would make every draft edit change the applied state without telling
  // anyone, and `applyActivityPreferences` would find nothing to apply.
  ...activityPreferences$.peek(),
});

export function setUnreadOnly(value: boolean): void {
  activityPreferences$.unreadOnly.set(value);
  setBoolean(UNREAD_KEY, value);
}

/** Changing kind clears the chosen person: they belonged to the other kind. */
export function setActorKind(kind: ActivityActorKind): void {
  activityPreferences$.actorKind.set(kind);
  activityPreferences$.actorUserId.set(null);
  setString(ACTOR_KIND_KEY, kind);
}

export function setActorUserId(userId: string | null): void {
  activityPreferences$.actorUserId.set(userId);
}

export function setActionable(value: boolean): void {
  activityPreferences$.actionable.set(value);
  setBoolean(ACTIONABLE_KEY, value);
}

export function setViewMode(mode: ActivityViewMode): void {
  activityPreferences$.viewMode.set(mode);
  setString(VIEW_MODE_KEY, mode);
}

/**
 * Hands the draft to the feed.
 *
 * Writes only the fields that moved, in one batch, so the feed re-renders once
 * however many controls changed, and not at all when nothing did. Swapping
 * chip sets drops a chip that is not in the new one, as the dashboard does.
 */
export function applyActivityPreferences(): void {
  const draft = activityPreferences$.peek();
  const applied = appliedActivityPreferences$.peek();

  batch(() => {
    if (draft.unreadOnly !== applied.unreadOnly) {
      appliedActivityPreferences$.unreadOnly.set(draft.unreadOnly);
    }
    if (draft.actorKind !== applied.actorKind) {
      appliedActivityPreferences$.actorKind.set(draft.actorKind);
    }
    if (draft.actorUserId !== applied.actorUserId) {
      appliedActivityPreferences$.actorUserId.set(draft.actorUserId);
    }
    if (draft.viewMode !== applied.viewMode) {
      appliedActivityPreferences$.viewMode.set(draft.viewMode);
    }
    if (draft.actionable !== applied.actionable) {
      appliedActivityPreferences$.actionable.set(draft.actionable);
      if (!isFilterVisible(activityFilter$.peek(), draft.actionable)) {
        activityFilter$.set('all');
      }
    }
  });
}

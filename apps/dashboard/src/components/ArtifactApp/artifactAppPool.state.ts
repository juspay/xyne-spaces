import type { ArtifactAppPlacement } from './ArtifactAppHostView';

/** Hidden apps kept running (~60–100 MB each); least recently shown goes first. */
export const MAX_HIDDEN_APPS = 3;

export interface SlotRect {
  top: number;
  left: number;
  width: number;
  height: number;
  /** CSS clip-path for the part of the slot its scroll containers show. */
  clip?: string;
}

export interface SlotProps {
  placement: ArtifactAppPlacement;
  showPayloadTitle: boolean;
  hasBack: boolean;
}

interface Slot {
  id: string;
  props: SlotProps;
  rect: SlotRect | null;
}

export interface PooledApp {
  /** The app, plus the channel for channel placements, so one channel's app never shows another's data. */
  key: string;
  appId: string;
  /** Mounted slots showing this app; the last one owns it. */
  slots: Slot[];
  /** Last owner's props, kept while hidden. */
  props: SlotProps;
  /** Last non-empty rect, so a hidden app never lays out at 0×0. */
  rect: SlotRect | null;
  lastUsed: number;
}

export interface PoolState {
  /** Never reordered: React moving an iframe reloads it. */
  apps: PooledApp[];
  seq: number;
  maxHidden: number;
}

export type PoolAction =
  | { type: 'mount'; slotId: string; key: string; appId: string; props: SlotProps }
  | { type: 'update'; slotId: string; key: string; props?: SlotProps; rect?: SlotRect }
  | { type: 'unmount'; slotId: string; key: string }
  | { type: 'dropHidden' };

export const initialPoolState: PoolState = { apps: [], seq: 0, maxHidden: MAX_HIDDEN_APPS };

function isEmpty(rect: SlotRect | null): boolean {
  return !rect || rect.width <= 0 || rect.height <= 0;
}

export function ownerSlotId(app: PooledApp): string | null {
  return app.slots[app.slots.length - 1]?.id ?? null;
}

export function isAppVisible(app: PooledApp): boolean {
  const owner = app.slots[app.slots.length - 1];
  return !!owner && !isEmpty(owner.rect);
}

function sameProps(a: SlotProps, b: SlotProps): boolean {
  return (
    a.showPayloadTitle === b.showPayloadTitle &&
    a.hasBack === b.hasBack &&
    JSON.stringify(a.placement) === JSON.stringify(b.placement)
  );
}

function sameRect(a: SlotRect | null, b: SlotRect | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height &&
    a.clip === b.clip
  );
}

/** Takes props and rect from the current owner slot. */
function settle(app: PooledApp, slots: Slot[]): PooledApp {
  const owner = slots[slots.length - 1];
  const props = owner && !sameProps(owner.props, app.props) ? owner.props : app.props;
  const rect =
    owner && !isEmpty(owner.rect) && !sameRect(owner.rect, app.rect) ? owner.rect : app.rect;
  return { ...app, slots, props, rect };
}

function trim(apps: PooledApp[], maxHidden: number): PooledApp[] {
  const hidden = apps.filter(app => app.slots.length === 0);
  const excess = hidden.length - maxHidden;
  if (excess <= 0) return apps;
  const dropped = new Set(
    [...hidden]
      .sort((a, b) => a.lastUsed - b.lastUsed)
      .slice(0, excess)
      .map(app => app.key),
  );
  return apps.filter(app => !dropped.has(app.key));
}

export function poolReducer(state: PoolState, action: PoolAction): PoolState {
  switch (action.type) {
    case 'mount': {
      const { slotId, key, appId, props } = action;
      const seq = state.seq + 1;
      const slot: Slot = { id: slotId, props, rect: null };
      const existing = state.apps.find(app => app.key === key);
      if (!existing) {
        const added: PooledApp = { key, appId, slots: [slot], props, rect: null, lastUsed: seq };
        return { ...state, apps: trim([...state.apps, added], state.maxHidden), seq };
      }
      const apps = state.apps.map(app =>
        app.key === key
          ? { ...settle(app, [...app.slots.filter(s => s.id !== slotId), slot]), lastUsed: seq }
          : app,
      );
      return { ...state, apps: trim(apps, state.maxHidden), seq };
    }

    case 'update': {
      const { slotId, key, props, rect } = action;
      let changed = false;
      const apps = state.apps.map(app => {
        if (app.key !== key) return app;
        const index = app.slots.findIndex(s => s.id === slotId);
        const slot = app.slots[index];
        if (!slot) return app;
        const nextSlot: Slot = {
          ...slot,
          ...(props && !sameProps(slot.props, props) ? { props } : {}),
          ...(rect && !sameRect(slot.rect, rect) ? { rect } : {}),
        };
        if (nextSlot.props === slot.props && nextSlot.rect === slot.rect) return app;
        changed = true;
        const slots = app.slots.map((s, i) => (i === index ? nextSlot : s));
        return settle(app, slots);
      });
      return changed ? { ...state, apps } : state;
    }

    case 'unmount': {
      const { slotId, key } = action;
      const apps = state.apps.map(app =>
        app.key === key && app.slots.some(s => s.id === slotId)
          ? settle(
              app,
              app.slots.filter(s => s.id !== slotId),
            )
          : app,
      );
      // No trim: a switch unmounts before it mounts, so trimming here could evict the target.
      return { ...state, apps };
    }

    case 'dropHidden': {
      const apps = state.apps.filter(app => app.slots.length > 0);
      return apps.length === state.apps.length ? state : { ...state, apps };
    }

    default:
      return state;
  }
}

/** Pool identity for a slot: channel placements get one running app per channel. */
export function poolKey(appId: string, placement: ArtifactAppPlacement): string {
  return placement.surface === 'channel' ? `${appId}:${placement.channel.id}` : appId;
}

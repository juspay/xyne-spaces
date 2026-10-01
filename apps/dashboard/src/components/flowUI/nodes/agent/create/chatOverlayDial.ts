import { useCallback, useEffect, useRef, useState } from 'react';
import { useDialKitController, type DialConfig } from 'dialkit';

/** Live side card. Figma 1941:36346 is the other version of the same element. */
export const CHAT_OVERLAY_DIAL_ID = 'chat-overlay';

const CURRENT_SHADOW =
  '0px 4px 4px rgba(0,0,0,0.03), 0px 14px 7px rgba(0,0,0,0.03), 0px 32px 9.5px rgba(0,0,0,0.02)';

/** Theme stroke. `hsl(var(--border))` flips with the active theme (midnight: #36373F). */
const BORDER = 'hsl(var(--border))';

export const CHAT_OVERLAY_WIDTH_MIN = 320;
export const CHAT_OVERLAY_WIDTH_MAX = 640;

export function clampChatOverlayWidth(width: number): number {
  return Math.round(Math.min(CHAT_OVERLAY_WIDTH_MAX, Math.max(CHAT_OVERLAY_WIDTH_MIN, width)));
}

/** Figma frame is 450×1010, inset 12, border only. No corner radius and no shadow in the node. */
const VERSIONS = {
  Current: { width: 450, radius: 20, margin: 12, inset: 12, shadow: true, border: BORDER },
  Figma: { width: 450, radius: 0, margin: 12, inset: 12, shadow: false, border: BORDER },
} as const;

const CHAT_OVERLAY_DIAL = {
  version: { type: 'select', options: ['Current', 'Figma'], default: 'Current' },
  width: [450, CHAT_OVERLAY_WIDTH_MIN, CHAT_OVERLAY_WIDTH_MAX],
  radius: [20, 0, 40],
  margin: [12, 0, 32],
  inset: [12, 0, 32],
  border: { type: 'color', default: BORDER },
  shadow: true,
} as const satisfies DialConfig;

export type ChatOverlayDial = {
  version: string;
  width: number;
  radius: number;
  margin: number;
  inset: number;
  border: string;
  shadow: boolean;
};

export function chatOverlayShadow(on: boolean): string {
  return on ? CURRENT_SHADOW : 'none';
}

type ChatOverlayControls = ChatOverlayDial & { setWidth: (width: number) => void };

const WIDTH_STORAGE_KEY = 'xyne.agentCreate.chatOverlayWidth';

function readStoredWidth(): number {
  try {
    const raw = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));
    return Number.isFinite(raw) && raw > 0 ? clampChatOverlayWidth(raw) : VERSIONS.Current.width;
  } catch {
    return VERSIONS.Current.width;
  }
}

/** Production: the shipped "Current" look, with the dragged width remembered per browser. */
function useFixedChatOverlay(): ChatOverlayControls {
  const [width, setWidthState] = useState(readStoredWidth);
  const setWidth = useCallback((next: number) => {
    const clamped = clampChatOverlayWidth(next);
    setWidthState(clamped);
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped));
    } catch {
      // Storage blocked: the width still applies for this page view.
    }
  }, []);
  return { ...VERSIONS.Current, version: 'Current', width, setWidth };
}

/** Dev: every value is a live DialKit control (DialRoot is only mounted in dev builds). */
function useDialChatOverlay(): ChatOverlayControls {
  const dial = useDialKitController('Chat Overlay', CHAT_OVERLAY_DIAL, {
    id: CHAT_OVERLAY_DIAL_ID,
    // The version you picked, and anything you tuned, survive a reload.
    persist: true,
  });
  const version = dial.values.version === 'Figma' ? 'Figma' : 'Current';
  const applied = useRef(version);
  const setValuesRef = useRef(dial.setValues);
  setValuesRef.current = dial.setValues;

  useEffect(() => {
    if (applied.current === version) return;
    applied.current = version;
    const next = VERSIONS[version];
    setValuesRef.current({
      width: next.width,
      radius: next.radius,
      margin: next.margin,
      inset: next.inset,
      border: next.border,
      // DialKit types a `true` toggle as the literal true. Figma still turns it off.
      shadow: next.shadow as true,
    });
  }, [version]);

  const setWidth = useCallback((width: number) => {
    setValuesRef.current({ width: clampChatOverlayWidth(width) });
  }, []);

  return { ...dial.values, version, setWidth };
}

export const useChatOverlayDial: () => ChatOverlayControls = import.meta.env.DEV
  ? useDialChatOverlay
  : useFixedChatOverlay;

import { useCallback, useState } from 'react';

/** The Build chat side card on the create page: width bounds and the remembered width. */
export const CHAT_OVERLAY_WIDTH_MIN = 320;
export const CHAT_OVERLAY_WIDTH_MAX = 640;
const CHAT_OVERLAY_WIDTH_DEFAULT = 450;

export function clampChatOverlayWidth(width: number): number {
  return Math.round(Math.min(CHAT_OVERLAY_WIDTH_MAX, Math.max(CHAT_OVERLAY_WIDTH_MIN, width)));
}

const WIDTH_STORAGE_KEY = 'xyne.agentCreate.chatOverlayWidth';

function readStoredWidth(): number {
  try {
    const raw = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));
    return Number.isFinite(raw) && raw > 0
      ? clampChatOverlayWidth(raw)
      : CHAT_OVERLAY_WIDTH_DEFAULT;
  } catch {
    return CHAT_OVERLAY_WIDTH_DEFAULT;
  }
}

/** The side card's width, dragged from its left edge and remembered per browser. */
export function useChatOverlayWidth(): { width: number; setWidth: (width: number) => void } {
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
  return { width, setWidth };
}

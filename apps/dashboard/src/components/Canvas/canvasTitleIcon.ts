import { useCallback, useEffect, useState } from 'react';
import type { Canvas } from './Canvas.types';

const LEADING_EMOJI_TITLE_PATTERN =
  /^\s*([\p{Emoji_Presentation}\p{Extended_Pictographic}](?:\uFE0F|\uFE0E)?(?:\u200D[\p{Emoji_Presentation}\p{Extended_Pictographic}](?:\uFE0F|\uFE0E)?)*)\s+/u;
const TITLE_ICON_CHANGE_EVENT = 'xyne:canvas-title-icon-changed';
const optimisticTitleIcons = new Map<string, string>();

export const getCanvasTitleIcon = (title: string | null | undefined): string | null => {
  const match = title?.match(LEADING_EMOJI_TITLE_PATTERN);
  return match?.[1] ?? null;
};

export const setOptimisticCanvasTitleIcon = (canvasId: string, icon: string): void => {
  optimisticTitleIcons.set(canvasId, icon);
  window.dispatchEvent(new CustomEvent(TITLE_ICON_CHANGE_EVENT));
};

export const getCanvasTitleIconFromCanvas = (canvas: Canvas | null | undefined): string | null => {
  if (!canvas) return null;
  return optimisticTitleIcons.get(canvas.id) ?? getCanvasTitleIcon(canvas.title);
};

export const getCanvasDisplayTitle = (
  title: string | null | undefined,
  icon = getCanvasTitleIcon(title),
): string => {
  const value = title ?? '';
  const trimmedIcon = icon?.trim();

  if (trimmedIcon && value.trimStart().startsWith(trimmedIcon)) {
    return value.trimStart().slice(trimmedIcon.length).trimStart();
  }

  return value.replace(LEADING_EMOJI_TITLE_PATTERN, '');
};

export const buildCanvasTitleWithIcon = (
  title: string | null | undefined,
  icon: string | null,
): string => {
  const cleanTitle = getCanvasDisplayTitle(title, icon).trim();
  const trimmedIcon = icon?.trim();
  return trimmedIcon ? `${trimmedIcon}${cleanTitle ? ` ${cleanTitle}` : ''}` : cleanTitle;
};

export const getCanvasDisplayTitleFromCanvas = (canvas: Canvas | null | undefined): string =>
  getCanvasDisplayTitle(canvas?.title, getCanvasTitleIconFromCanvas(canvas));

export const useCanvasTitleIcon = (canvas: Canvas | null | undefined): string | null => {
  const readIcon = useCallback(() => getCanvasTitleIconFromCanvas(canvas), [canvas]);
  const [icon, setIcon] = useState<string | null>(readIcon);

  useEffect(() => {
    const sync = (): void => setIcon(readIcon());

    sync();
    window.addEventListener(TITLE_ICON_CHANGE_EVENT, sync);
    return (): void => window.removeEventListener(TITLE_ICON_CHANGE_EVENT, sync);
  }, [readIcon]);

  return icon;
};

import type { Canvas, CanvasLabel } from './Canvas.types';
import { getAvatarColorClassNames } from '../ui/Avatar/Avatar';

export type CanvasLabelChip = Pick<CanvasLabel, 'id' | 'canvasId' | 'name'> &
  Partial<Pick<CanvasLabel, 'workspaceId' | 'createdAt'>>;

export const normalizeCanvasLabelName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > 0 ? trimmed : null;
};

export const getCanvasLabelKey = (value: unknown): string | null => {
  const name = normalizeCanvasLabelName(value);
  return name ? name.toLowerCase() : null;
};

type CanvasLabelNameInput = string | { name?: unknown } | null | undefined;

export const getDedupedCanvasLabelNames = (values: CanvasLabelNameInput[]): string[] => {
  const byKey = new Map<string, string>();

  for (const value of values) {
    const name = normalizeCanvasLabelName(typeof value === 'string' ? value : value?.name);
    if (!name) continue;

    const key = getCanvasLabelKey(name);
    if (key && !byKey.has(key)) {
      byKey.set(key, name);
    }
  }

  return Array.from(byKey.values());
};

export const getCanvasLabels = (canvas: Canvas): CanvasLabelChip[] => {
  const labels = canvas.labels;
  if (!Array.isArray(labels)) return [];

  return labels
    .map((label): CanvasLabelChip | null => {
      const name = normalizeCanvasLabelName(label.name);
      if (!name) return null;
      return { ...label, name };
    })
    .filter((label): label is CanvasLabelChip => Boolean(label))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const getCanvasLabelDotClassName = (labelName: string): string =>
  getAvatarColorClassNames(labelName).bg;

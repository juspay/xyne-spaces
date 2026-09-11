import React from 'react';
import { cn } from '../../../utils/classNames';

const TONE_FOR_EXT: Record<string, string> = {
  pdf: 'bg-red-500 text-white',
  doc: 'bg-blue-500 text-white',
  docx: 'bg-blue-500 text-white',
  md: 'bg-neutral-600 text-white',
  txt: 'bg-gray-500 text-white',
  csv: 'bg-teal-700 text-white',
  xls: 'bg-emerald-600 text-white',
  xlsx: 'bg-emerald-600 text-white',
  ppt: 'bg-orange-500 text-white',
  pptx: 'bg-orange-500 text-white',
  json: 'bg-yellow-500 text-white',
  png: 'bg-pink-500 text-white',
  jpg: 'bg-pink-600 text-white',
  jpeg: 'bg-pink-600 text-white',
  gif: 'bg-pink-600 text-white',
  webp: 'bg-pink-500 text-white',
  mp4: 'bg-green-700 text-white',
  mov: 'bg-green-700 text-white',
};

function extOf(name: string): string | undefined {
  const parts = name.split('.');
  if (parts.length < 2) return undefined;
  return parts[parts.length - 1]?.toLowerCase();
}

interface StatusBadgeV2Props {
  name: string;
  /** 'sm' shrinks the badge to sit inline next to a plain 16px icon (e.g. a
   *  dropdown filter row alongside the Folders option) instead of the
   *  default card/list glyph size. */
  size?: 'sm' | 'md';
}

export const StatusBadgeV2: React.FC<StatusBadgeV2Props> = ({ name, size = 'md' }) => {
  const ext = extOf(name) || 'file';
  const tone = TONE_FOR_EXT[ext] ?? 'bg-zinc-500 text-white';
  const label = ext.toUpperCase().slice(0, 4);

  return (
    <span
      aria-hidden
      className={cn(
        'grid flex-shrink-0 place-items-center font-semibold uppercase tracking-wide',
        size === 'sm' ? 'h-4 w-4 rounded text-[5px]' : 'h-7 w-7 rounded-md text-[8.5px]',
        tone,
      )}
    >
      {label}
    </span>
  );
};

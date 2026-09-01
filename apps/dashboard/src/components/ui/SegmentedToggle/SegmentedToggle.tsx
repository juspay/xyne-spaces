import React, { useRef, useState, useEffect, useCallback } from 'react';
import { cn } from '../../../utils/classNames';

export interface SegmentedToggleOption<T extends string> {
  value: T;
  icon?: React.ReactNode;
  label?: string;
  title?: string;
}

const TONE = {
  accent: { pill: 'bg-action-primary', label: 'text-action-primary-foreground' },
  primary: { pill: 'bg-primary', label: 'text-primary-foreground' },
} as const;

interface SegmentedToggleProps<T extends string> {
  options: SegmentedToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  tone?: keyof typeof TONE;
  trackCategory?: string;
  trackPrefix?: string;
}

export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  className,
  tone = 'accent',
  trackCategory,
  trackPrefix,
}: SegmentedToggleProps<T>): React.ReactElement {
  const toneClass = TONE[tone];
  const containerRef = useRef<HTMLDivElement>(null);
  const [pillStyle, setPillStyle] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  });

  const updatePill = useCallback(() => {
    if (!containerRef.current) return;
    const activeIndex = options.findIndex(o => o.value === value);
    if (activeIndex < 0) return;
    const buttons = containerRef.current.querySelectorAll<HTMLButtonElement>(
      '[data-slot="segmented-toggle-item"]',
    );
    const btn = buttons[activeIndex];
    if (!btn) return;
    setPillStyle({ left: btn.offsetLeft, width: btn.offsetWidth });
  }, [options, value]);

  useEffect(() => {
    updatePill();
  }, [updatePill]);

  useEffect(() => {
    const observer = new ResizeObserver(() => updatePill());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [updatePill]);

  return (
    <div
      ref={containerRef}
      data-slot='segmented-toggle'
      className={cn(
        'relative inline-flex h-7 items-center rounded-full border border-border bg-muted/40 p-0.5',
        className,
      )}
    >
      {/* Inline style required: pill position is dynamically measured from DOM via ResizeObserver */}
      <div
        className={cn(
          'absolute top-0.5 bottom-0.5 rounded-full transition-[left,width] duration-200 ease-in-out',
          toneClass.pill,
        )}
        style={{ left: pillStyle.left, width: pillStyle.width }}
      />

      {options.map(option => {
        const isActive = option.value === value;
        const hasLabel = !!option.label;
        return (
          <button
            key={option.value}
            type='button'
            data-slot='segmented-toggle-item'
            onClick={() => onChange(option.value)}
            data-track-category={trackCategory ?? 'SEGMENTED_TOGGLE'}
            data-track-name={
              trackPrefix ? `${trackPrefix}: ${option.label ?? option.value}` : 'CHANGE_SEGMENT'
            }
            data-track-metadata={JSON.stringify({ value: option.value })}
            title={option.title}
            className={cn(
              'relative z-10 flex h-full items-center justify-center gap-1.5 rounded-full whitespace-nowrap',
              hasLabel ? 'px-2.5 text-sm font-normal' : 'size-8',
              isActive ? toneClass.label : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

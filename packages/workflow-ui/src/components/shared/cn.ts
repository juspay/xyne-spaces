import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names with Tailwind-aware deduplication.
 *
 * Consumer classes override defaults:
 *   cn("bg-white text-sm", userClass) → userClass wins on conflicts
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

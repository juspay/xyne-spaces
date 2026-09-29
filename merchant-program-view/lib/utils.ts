import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** The cn() helper shadcn components import. Provided by claw at runtime; kept
 *  locally so the components resolve during `npm run dev`. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

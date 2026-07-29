import { clsx, type ClassValue } from "clsx";
import { format, parseISO } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatDate(dateString: string): string {
  const date = parseISO(dateString);
  return format(date, "do MMMM ''yyyy");
}

// Shared app-lifecycle flags. Kept out of main.ts so other modules (window
// manager, error handler) can read them without importing main.ts itself.

let isQuitting = false;

export function getIsQuitting(): boolean {
  return isQuitting;
}

export function setIsQuitting(value: boolean): void {
  isQuitting = value;
}

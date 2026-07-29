let draining = false;

export function beginDraining(): void {
  draining = true;
}

export function isDraining(): boolean {
  return draining;
}

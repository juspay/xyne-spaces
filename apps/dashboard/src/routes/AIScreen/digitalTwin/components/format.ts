export function scoreToneClass(score: number): string {
  if (score >= 0.8) return 'text-status-success';
  if (score >= 0.6) return 'text-status-pending';
  return 'text-status-failure';
}

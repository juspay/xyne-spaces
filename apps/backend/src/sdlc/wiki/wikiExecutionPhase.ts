export type WikiRunPhase =
  | 'QUEUED'
  | 'PREPARING'
  | 'BOOTSTRAPPING'
  | 'PROCESSING'
  | 'VALIDATING'
  | 'CORRECTING'
  | 'COMPLETED'
  | 'PARTIALLY_FAILED'
  | 'CANCELLED';

export function effectiveWikiRunPhase(
  executionStatus: string,
  contextPhase: WikiRunPhase
): WikiRunPhase {
  if (executionStatus === 'SUCCESS') return 'COMPLETED';
  if (executionStatus === 'FAILURE') return 'PARTIALLY_FAILED';
  if (executionStatus === 'CANCELLED') return 'CANCELLED';
  return contextPhase;
}

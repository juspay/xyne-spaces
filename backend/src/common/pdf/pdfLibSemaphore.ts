type DiagnosticDetails = Record<string, unknown>

export class AppSyncPdfLibSemaphoreTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Timed out waiting ${timeoutMs}ms for app-sync PDF-lib semaphore permit`)
    this.name = 'AppSyncPdfLibSemaphoreTimeoutError'
  }
}

export const isAppSyncPdfLibSemaphoreTimeoutError = (
  error: unknown,
): error is AppSyncPdfLibSemaphoreTimeoutError =>
  error instanceof AppSyncPdfLibSemaphoreTimeoutError ||
  (error instanceof Error && error.name === 'AppSyncPdfLibSemaphoreTimeoutError')

export const withAppSyncPdfLibPermit = async <T>(
  _details: DiagnosticDetails,
  fn: () => Promise<T>,
): Promise<T> => fn()

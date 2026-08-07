import { withRetry } from '@/utils/retry';
interface MiddlewareCapableClient {
  $use(middleware: (params: any, next: (params: any) => Promise<any>) => Promise<any>): void;
}

export function installPrismaRetryMiddleware(
  prisma: MiddlewareCapableClient,
  prefix = 'prisma'
): void {
  prisma.$use(
    async (params: { model?: string; action: string }, next: (p: unknown) => Promise<unknown>) =>
      withRetry(() => next(params), `${prefix}.${params.model ?? 'raw'}.${params.action}`)
  );
}

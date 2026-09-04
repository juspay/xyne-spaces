import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  NextFunction,
  Request,
  Response,
} from 'express';

interface InternalEncryptionDiagnosticContext {
  requestId: string | null;
  method: string;
  resolveRouteTemplate: () => string | null;
}

export interface EncryptionDiagnosticContext {
  requestId: string | null;
  method: string;
  routeTemplate: string | null;
  source: 'api';
}

const contextStorage =
  new AsyncLocalStorage<
    InternalEncryptionDiagnosticContext
  >();

function joinRouteTemplate(
  baseUrl: string,
  routePath: string
): string {
  const base = baseUrl.replace(/\/+$/, '');
  const route = routePath.startsWith('/')
    ? routePath
    : `/${routePath}`;

  return `${base}${route}` || '/';
}

/**
 * Store the request itself indirectly so req.route.path is
 * resolved during the route handler, after Express matches it.
 */
export function encryptionDiagnosticContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestWithId = req as Request & {
    requestId?: string;
  };

  const localRequestId = res.locals[
    'requestId'
  ];

  const requestId =
    requestWithId.requestId ??
    (
      typeof localRequestId === 'string'
        ? localRequestId
        : null
    );

  contextStorage.run(
    {
      requestId,
      method: req.method,
      resolveRouteTemplate: () => {
        const routePath: unknown =
          req.route?.path;

        if (typeof routePath === 'string') {
          return joinRouteTemplate(
            req.baseUrl,
            routePath
          );
        }

        return req.baseUrl || null;
      },
    },
    next
  );
}

export function getEncryptionDiagnosticContext():
  EncryptionDiagnosticContext | null {
  const context = contextStorage.getStore();

  if (!context) {
    return null;
  }

  return {
    requestId: context.requestId,
    method: context.method,
    routeTemplate:
      context.resolveRouteTemplate(),
    source: 'api',
  };
}

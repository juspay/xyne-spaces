import { Request, Response, NextFunction } from 'express'
import { logger } from '@/utils/logger'

/**
 * Extracts the scoped permissions array from the authenticated request.
 *
 * The permissions are expected to be attached to `req.auth` (populated by the
 * JWT / session middleware) as an array of Slack-style scope strings, e.g.:
 *   ["chat:write", "channels:read", "commands"]
 */
function getPermissionsFromRequest(req: Request): string[] {
  const auth = (req as any).auth
  if (!auth) return []
  return Array.isArray(auth.permissions) ? (auth.permissions as string[]) : []
}

function isPermissionsStale(req: Request): boolean {
  return (req as any).auth?.permissionsStale === true
}

const PERMISSION_ENFORCEMENT_DATE = new Date('2026-06-06T00:00:00.000Z');

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const permissions = getPermissionsFromRequest(req)
    const stale = isPermissionsStale(req)


    // Legacy bypass: apps installed before the permission system was enforced
    // are allowed through without a scope check.

    const installedAppCreatedAt: Date | undefined = (req as any).auth?.installedAppCreatedAt
        console.log('Checking permission', {PERMISSION_ENFORCEMENT_DATE, installedAppCreatedAt })
    if (installedAppCreatedAt && new Date(installedAppCreatedAt) < PERMISSION_ENFORCEMENT_DATE) {
      next()
      return
    }

    if (!permissions.includes(permission)) {
      logger.warn(
        `[requirePermission] Access denied – missing scope: ${permission}`,
        { required: permission, granted: permissions, stale, path: req.path, method: req.method },
      )
      res.status(403).json({
        error: 'missing_permission',
        required: permission,
        granted: permissions,
        ...(stale && {
          reason: 'permissions_stale',
          message: 'App permissions have changed. Please re-install your app permissions to continue.',
        }),
      })
      return
    }

    next()
  }
}

export function requireAllPermissions(permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const granted = getPermissionsFromRequest(req)
    const stale = isPermissionsStale(req)
    const missing = permissions.filter((p) => !granted.includes(p))

    if (missing.length > 0) {
      logger.warn(
        `[requireAllPermissions] Access denied – missing scopes: ${missing.join(', ')}`,
        { required: permissions, missing, granted, stale, path: req.path, method: req.method },
      )
      res.status(403).json({
        error: 'missing_permission',
        required: missing,
        granted,
        ...(stale && {
          reason: 'permissions_stale',
          message: 'App permissions have changed. Please re-install your app permissions to continue.',
        }),
      })
      return
    }

    next()
  }
}

export function requireAnyPermission(permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const granted = getPermissionsFromRequest(req)
    const stale = isPermissionsStale(req)
    const hasAny = permissions.some((p) => granted.includes(p))

    if (!hasAny) {
      logger.warn(
        `[requireAnyPermission] Access denied – none of the scopes present: ${permissions.join(', ')}`,
        { required: permissions, granted, stale, path: req.path, method: req.method },
      )
      res.status(403).json({
        error: 'missing_permission',
        required: permissions,
        granted,
        ...(stale && {
          reason: 'permissions_stale',
          message: 'App permissions have changed. Please re-install your app permissions to continue.',
        }),
      })
      return
    }

    next()
  }
}

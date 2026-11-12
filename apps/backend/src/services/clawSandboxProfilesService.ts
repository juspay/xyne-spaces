/**
 * claw-auth's `/internal/sandbox-profiles` (Spaces service assertion). Spaces decides who may edit a
 * profile; claw-auth stores it and scopes every row to its workspace.
 */
import type { SandboxProfileConfig } from '@xyne/shared';
import { config } from '@/config/env';
import { serviceAuthHeaders } from '@/claw/serviceAuth';
import { AppError } from '@/middleware/errorHandler';

export interface ClawSandboxProfile {
  key: string;
  config: SandboxProfileConfig;
  enabled: boolean;
  builtIn: boolean;
  overridden: boolean;
  workspaceId: string | null;
  createdByUserId: string | null;
}

async function call<T>(method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown): Promise<T> {
  const base = config.xyneClaw.authUrl.replace(/\/+$/, '');
  const url = `${base}/claw/api/v1/internal/sandbox-profiles${path}`;
  const res = await fetch(url, {
    method,
    headers: { ...serviceAuthHeaders('xyne-claw-auth', method, url), 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text().catch(() => '');
  let json: { success?: boolean; data?: T; error?: string } | undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok || json?.success !== true) {
    // Validation, missing and duplicate-key errors are the user's to fix; pass them through.
    if ([400, 404, 409].includes(res.status)) {
      throw new AppError(
        json?.error ?? `Sandbox profile request failed (${res.status})`,
        res.status
      );
    }
    throw new Error(
      `[ClawSandboxProfiles] ${method} ${path}: HTTP ${res.status} — ${(json?.error ?? text).slice(0, 300)}`
    );
  }
  return json.data as T;
}

export const listClawSandboxProfiles = (workspaceId: string): Promise<ClawSandboxProfile[]> =>
  call('GET', `?workspaceId=${encodeURIComponent(workspaceId)}`);

export const listClawSandboxTemplates = (): Promise<string[]> => call('GET', '/templates');

export async function isClawAdminUser(userId: string): Promise<boolean> {
  return (
    await call<{ isAdmin: boolean }>('GET', `/claw-admin?userId=${encodeURIComponent(userId)}`)
  ).isAdmin;
}

export async function saveClawSandboxProfile(
  key: string,
  body: { config: SandboxProfileConfig; workspaceId: string; actorUserId: string; create: boolean }
): Promise<void> {
  await call('PUT', `/${encodeURIComponent(key)}`, body);
}

export async function resetClawSandboxProfile(key: string, actorUserId: string): Promise<void> {
  await call('POST', `/${encodeURIComponent(key)}/reset`, { actorUserId });
}

export async function setClawSandboxProfileEnabled(
  key: string,
  body: { enabled: boolean; workspaceId: string; actorUserId: string }
): Promise<void> {
  await call('POST', `/${encodeURIComponent(key)}/enabled`, body);
}

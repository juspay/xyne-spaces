/**
 * Read, write and test an install's App Desk history fetch configuration.
 *
 * Separate from appController for the same reason permissions and commands are:
 * it is its own surface with its own validation. The write path is REST rather
 * than a Zero mutator because the config is validated server-side against
 * AppFetchConfigSchema before it is stored, and a malformed config would only
 * surface hours later inside a worker.
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { decrypt } from '@/services/encryptionService';
import { ExternalSourceRepository } from '@/database/repositories/externalSourceRepository';
import {
  AppFetchConfigSchema,
  AppFetchVariables,
  buildDefaultFetchConfig,
  buildSignedFetchRequest,
  mapExportPage,
  parseFetchConfig,
  preserveRedactedSecrets,
  redactFetchConfig,
  serializeFetchConfig,
} from '../core/appFetchConfig';
import { dispatchAppFetch, readCappedText } from '../core/appFetchDispatch';

const externalSourceRepo = new ExternalSourceRepository();

/** Window the test fetch asks for — recent and tiny, so it is cheap for the app. */
const TEST_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Enough of a failing response to diagnose it, not enough to flood a log line. */
const TEST_BODY_PREVIEW_LIMIT = 2_000;

const TestFetchBodySchema = z.object({
  /** Optional: test as a specific desk channel, so {{channel.*}} render for real. */
  channelId: z.string().trim().min(1).optional(),
});

export class FetchConfigController {
  /**
   * Resolve the install and assert it belongs to the caller's workspace, via the
   * install's bot user — the same ownership check updateInstalledApp uses, so one
   * workspace can never read or edit another's config.
   */
  private async findOwnedInstall(installedAppId: string, workspaceId: string) {
    return await repositories.installedApps.findFirst({
      where: { id: installedAppId, user: { workspaceId } },
    });
  }

  /**
   * GET /apps/installed/:installedAppId/fetch-config
   *
   * Returns the stored config, or a suggested default derived from the install's
   * webhook URL when none is stored yet, so the form opens pre-filled rather than
   * blank. `configured` tells the two apart.
   */
  getFetchConfig = async (req: Request, res: Response): Promise<void> => {
    try {
      const { installedAppId } = req.params;
      const workspaceId = req.user?.workspaceId;
      if (!installedAppId || !workspaceId) {
        res.status(400).json({ error: 'installedAppId and workspace are required' });
        return;
      }

      const install = await this.findOwnedInstall(installedAppId, workspaceId);
      if (!install) {
        res.status(404).json({
          error: 'Installed app not found in this workspace',
          code: 'INSTALLED_APP_NOT_FOUND',
        });
        return;
      }

      if (install.fetchConfig) {
        // Parsed rather than passed through raw: a config stored before a schema
        // change should surface as an error here, where someone can fix it, not
        // at fetch time in a worker.
        try {
          res.status(200).json({
            configured: true,
            config: redactFetchConfig(parseFetchConfig(install.fetchConfig, 'This install')),
          });
        } catch (error) {
          res.status(200).json({
            configured: true,
            config: null,
            invalid: true,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }

      const suggested = install.webhookUrl?.trim()
        ? (() => {
            try {
              return buildDefaultFetchConfig(install.webhookUrl!.trim());
            } catch {
              return null;
            }
          })()
        : null;
      res.status(200).json({ configured: false, config: suggested });
    } catch (error) {
      logger.error('Error reading app fetch config:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * PUT /apps/installed/:installedAppId/fetch-config
   * Body is the config itself, validated by the shared schema. Secret header
   * values arrive redacted unless the admin retyped them — see
   * preserveRedactedSecrets.
   */
  putFetchConfig = async (req: Request, res: Response): Promise<void> => {
    try {
      const { installedAppId } = req.params;
      const workspaceId = req.user?.workspaceId;
      if (!installedAppId || !workspaceId) {
        res.status(400).json({ error: 'installedAppId and workspace are required' });
        return;
      }

      const parsed = AppFetchConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid fetch configuration',
          code: 'VALIDATION_ERROR',
          issues: parsed.error.issues.map(i => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        });
        return;
      }

      const install = await this.findOwnedInstall(installedAppId, workspaceId);
      if (!install) {
        res.status(404).json({
          error: 'Installed app not found in this workspace',
          code: 'INSTALLED_APP_NOT_FOUND',
        });
        return;
      }

      const toStore = preserveRedactedSecrets(parsed.data, install.fetchConfig);
      await repositories.installedApps.update(install.id, {
        fetchConfig: serializeFetchConfig(toStore),
      });
      res.status(200).json({ configured: true, config: redactFetchConfig(toStore) });
    } catch (error) {
      logger.error('Error saving app fetch config:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * DELETE /apps/installed/:installedAppId/fetch-config
   * Clearing the config disables history pulls for this install; live inbound
   * delivery is a separate path and is unaffected.
   */
  deleteFetchConfig = async (req: Request, res: Response): Promise<void> => {
    try {
      const { installedAppId } = req.params;
      const workspaceId = req.user?.workspaceId;
      if (!installedAppId || !workspaceId) {
        res.status(400).json({ error: 'installedAppId and workspace are required' });
        return;
      }

      const install = await this.findOwnedInstall(installedAppId, workspaceId);
      if (!install) {
        res.status(404).json({
          error: 'Installed app not found in this workspace',
          code: 'INSTALLED_APP_NOT_FOUND',
        });
        return;
      }

      await repositories.installedApps.update(install.id, { fetchConfig: null });
      res.status(200).json({ configured: false });
    } catch (error) {
      logger.error('Error clearing app fetch config:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * POST /apps/installed/:installedAppId/fetch-config/test
   *
   * One real, signed request over a recent 24-hour window, with nothing
   * ingested. Exists because the alternative is configuring blind and
   * discovering the mistake in a worker log hours later: it reports the rendered
   * request, the status, and whether the response satisfies the export contract.
   *
   * Tests the config in the request body when one is supplied — so the form can
   * verify before saving — and the stored config otherwise.
   */
  testFetchConfig = async (req: Request, res: Response): Promise<void> => {
    try {
      const { installedAppId } = req.params;
      const workspaceId = req.user?.workspaceId;
      if (!installedAppId || !workspaceId) {
        res.status(400).json({ error: 'installedAppId and workspace are required' });
        return;
      }

      const install = await this.findOwnedInstall(installedAppId, workspaceId);
      if (!install) {
        res.status(404).json({
          error: 'Installed app not found in this workspace',
          code: 'INSTALLED_APP_NOT_FOUND',
        });
        return;
      }

      const { config: bodyConfig, ...rest } = (req.body ?? {}) as Record<string, unknown>;
      const optionsResult = TestFetchBodySchema.safeParse(rest);
      if (!optionsResult.success) {
        res.status(400).json({ error: 'Invalid test options', code: 'VALIDATION_ERROR' });
        return;
      }

      let config;
      if (bodyConfig !== undefined) {
        const parsed = AppFetchConfigSchema.safeParse(bodyConfig);
        if (!parsed.success) {
          res.status(400).json({
            error: 'Invalid fetch configuration',
            code: 'VALIDATION_ERROR',
            issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
          });
          return;
        }
        // Secrets arrive masked unless retyped, exactly as on save — otherwise a
        // test of unsaved form state would send the placeholder as the credential.
        config = preserveRedactedSecrets(parsed.data, install.fetchConfig);
      } else {
        try {
          config = parseFetchConfig(install.fetchConfig, 'This install');
        } catch (error) {
          res.status(400).json({
            error: error instanceof Error ? error.message : String(error),
            code: 'FETCH_CONFIG_MISSING',
          });
          return;
        }
      }

      const app = await db.apps.findUnique({
        where: { id: install.appId },
        select: { signingSecret: true },
      });
      if (!app?.signingSecret) {
        res.status(400).json({
          error: 'App has no signing secret — cannot authenticate the export request',
          code: 'SIGNING_SECRET_MISSING',
        });
        return;
      }

      const vars = await this.buildTestVariables({
        installedAppId: install.id,
        appId: install.appId,
        workspaceId,
        channelId: optionsResult.data.channelId,
        pageSize: config.pageSize,
      });

      const request = buildSignedFetchRequest({
        config,
        vars,
        signingSecret: decrypt(app.signingSecret),
      });
      // Echoed so the operator can see exactly what the app will receive —
      // headers are omitted, they carry the signature.
      const sent = {
        url: request.url,
        method: config.method,
        body: typeof request.init.body === 'string' ? request.init.body : null,
      };

      // globalThis-qualified: express's Response is imported into this module.
      let response: globalThis.Response;
      const startedAt = Date.now();
      try {
        response = await dispatchAppFetch(request, config.timeoutMs);
      } catch (error) {
        res.status(200).json({
          ok: false,
          stage: 'transport',
          error: error instanceof Error ? error.message : String(error),
          sent,
        });
        return;
      }
      const durationMs = Date.now() - startedAt;

      const text = await readCappedText(response).catch(() => '');
      const preview = text.slice(0, TEST_BODY_PREVIEW_LIMIT);
      if (!response.ok) {
        res.status(200).json({
          ok: false,
          stage: 'response',
          status: response.status,
          durationMs,
          error: `App returned ${response.status}`,
          responsePreview: preview,
          sent,
        });
        return;
      }

      // A 200 that does not satisfy the export contract is still a failed test —
      // it would fail identically, and less visibly, inside the worker.
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(text);
      } catch {
        res.status(200).json({
          ok: false,
          stage: 'contract',
          status: response.status,
          durationMs,
          error: 'Response was not valid JSON',
          responsePreview: preview,
          sent,
        });
        return;
      }

      // Validated through the configured mapping, not against a fixed shape —
      // so the test proves the mapping the worker will actually use, and a bad
      // path is reported here with the path named rather than at fetch time.
      let page: ReturnType<typeof mapExportPage>;
      try {
        page = mapExportPage(parsedBody, config.response, config.pagination);
      } catch (error) {
        res.status(200).json({
          ok: false,
          stage: 'contract',
          status: response.status,
          durationMs,
          error: error instanceof Error ? error.message : String(error),
          responsePreview: preview,
          sent,
        });
        return;
      }

      // Rows the mapping could not read are skipped by mapExportPage rather than
      // thrown, so they must be reported here or a mapping that silently drops
      // most of a page tests green — the exact failure this button exists to catch.
      const skippedCount = page.invalidRows.length;
      const mostlySkipped = skippedCount > 0 && skippedCount >= page.messages.length;
      res.status(200).json({
        ok: !mostlySkipped,
        ...(mostlySkipped && {
          stage: 'contract' as const,
          error: `${skippedCount} of ${skippedCount + page.messages.length} rows could not be mapped`,
        }),
        status: response.status,
        durationMs,
        messageCount: page.messages.length,
        skippedCount,
        invalidRows: page.invalidRows.slice(0, 10),
        hasNextCursor: Boolean(page.nextCursor),
        // The mapped message, so an operator sees what Xyne derived rather than
        // what the app sent — that is where a wrong mapping shows up.
        sampleMessage: page.messages[0] ?? null,
        sent,
      });
    } catch (error) {
      logger.error('Error testing app fetch config:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };

  /**
   * Variables for a test request. With a channel, the real ids render so the app
   * sees exactly what a real pull sends. Without one, placeholders keep the
   * request well-formed while making it obvious in the app's logs that this was
   * a connectivity test and not a real export.
   */
  private async buildTestVariables(params: {
    installedAppId: string;
    appId: string;
    workspaceId: string;
    channelId?: string;
    pageSize: number;
  }): Promise<AppFetchVariables> {
    const { installedAppId, appId, workspaceId, channelId, pageSize } = params;
    const now = Date.now();

    let resolvedChannel = { id: 'test-channel', name: 'Configuration test' };
    let sourceId = 'test-source';
    if (channelId) {
      const [channel, source] = await Promise.all([
        db.channel.findUnique({ where: { id: channelId }, select: { id: true, name: true, workspaceId: true } }),
        externalSourceRepo.findChannelAppSource(channelId, installedAppId),
      ]);
      // Scoped to the caller's workspace so a channel id from elsewhere cannot be
      // probed through this endpoint.
      if (channel && channel.workspaceId === workspaceId) {
        resolvedChannel = { id: channel.id, name: channel.name };
        if (source) sourceId = source.id;
      }
    }

    return {
      fetch: {
        startDate: new Date(now - TEST_WINDOW_MS).toISOString(),
        endDate: new Date(now).toISOString(),
        // First page in either mode: no cursor, offset zero.
        cursor: '',
        offset: 0,
        limit: pageSize,
      },
      channel: resolvedChannel,
      source: { id: sourceId },
      installedApp: { id: installedAppId },
      app: { id: appId },
      workspace: { id: workspaceId },
    };
  }
}

export const fetchConfigController = new FetchConfigController();

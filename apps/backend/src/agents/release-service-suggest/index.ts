import { z } from 'zod';
import { createUserMessage } from '@framework';
import { AgentsConfig } from '../config.js';
import { resolveOrgLLMClient } from '../llmClient.js';
import { logLLMCallStart, logLLMSuccess, logLLMError } from '../agentLogger.js';
import { parseAgentOutput } from '@/services/agents/utils';

const AGENT_NAME = 'ReleaseServiceSuggest';
const MAX_PROMPT_PATHS = 400;

export interface ReleaseServiceSuggestContext {
  readonly userId: string;
  readonly projectId: string | null;
}

export interface SuggestedService {
  name: string;
  regex: string;
  envPaths: string[];
  migrationPaths: string[];
}

export interface ReleaseServiceSuggestOutput {
  services: SuggestedService[];
}

const OutputSchema = z.object({
  services: z
    .array(
      z.object({
        name: z.string().min(1),
        regex: z.string().min(1),
        envPaths: z.array(z.string()).default([]),
        migrationPaths: z.array(z.string()).default([]),
      }),
    )
    .transform(a => a.slice(0, 20)),
});

const SYSTEM_INSTRUCTIONS = `You configure release tracking for a code repository. Given a list of file and directory paths, identify the deployable services in the repository. A service is usually a top-level application directory (e.g. "backend/", "frontend/", "apps/web/", "services/api/").

For each service return:
- name: a short human name (e.g. "backend", "web").
- regex: a JavaScript regex matching commit file paths that belong to the service, anchored at the start (e.g. "^backend/", "^apps/web/").
- envPaths: the service's environment files, relative to the service root (e.g. ".env.prod", "config/.env"). Empty array if none.
- migrationPaths: the service's migration DIRECTORY, relative to the service root (e.g. "migrations/", "db/migrate/"). Empty array if none.

These paths are matched as substrings against changed files. So:
- Express env/migration paths RELATIVE to the service — do NOT repeat the service directory the regex already captures. For regex "^backend/", use ".env.prod" and "migrations/", never "backend/.env.prod" or "backend/migrations/".
- For migrationPaths, return the directory prefix ONLY — never individual migration files; the directory already covers every file under it.
- For envPaths, return specific env files — never a bare directory.

Return ONLY valid JSON with this exact schema:
{ "services": [ { "name": string, "regex": string, "envPaths": string[], "migrationPaths": string[] } ] }

Rules:
- Only include services you can identify from the paths.
- Use forward slashes and keep every regex a valid JavaScript RegExp.
- Output JSON only, no extra text, no reasoning, no thinking tags.`;

const INTERESTING =
  /(^|\/)\.env(\.[\w.-]+)?$|(^|\/)(migrations?|alembic|flyway|liquibase)(\/|$)|\.sql$|prisma\/migrations/i;

function compactPaths(paths: string[]): string[] {
  const dirs = new Set<string>();
  const interesting: string[] = [];
  for (const path of paths) {
    if (INTERESTING.test(path)) interesting.push(path);
    const parts = path.split('/');
    for (let depth = 1; depth <= Math.min(3, parts.length - 1); depth++) {
      dirs.add(`${parts.slice(0, depth).join('/')}/`);
    }
  }
  return [...new Set([...interesting, ...dirs])].slice(0, MAX_PROMPT_PATHS);
}

function buildPrompt(paths: string[]): string {
  return `Repository file and directory listing:

<paths>
${paths.join('\n')}
</paths>`;
}

function isValidRegex(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

function normalizePatterns(values: string[]): string[] {
  const unique = [...new Set(values.map(v => v.trim()).filter(Boolean))];
  return unique.filter(value => !unique.some(other => other !== value && value.includes(other)));
}

function serviceDirFromRegex(regex: string): string | null {
  const match = /^\^([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/)$/.exec(regex);
  return match ? match[1] : null;
}

function relativizeToService(paths: string[], serviceDir: string | null): string[] {
  if (!serviceDir) return paths;
  return paths.map(p => (p.startsWith(serviceDir) ? p.slice(serviceDir.length) : p));
}

function sanitizeServices(
  services: { name: string; regex: string; envPaths?: string[]; migrationPaths?: string[] }[],
): SuggestedService[] {
  return services
    .map(service => {
      const regex = service.regex.trim();
      const serviceDir = serviceDirFromRegex(regex);
      return {
        name: service.name.trim(),
        regex,
        envPaths: normalizePatterns(relativizeToService(service.envPaths ?? [], serviceDir)),
        migrationPaths: normalizePatterns(relativizeToService(service.migrationPaths ?? [], serviceDir)),
      };
    })
    .filter(service => service.name && service.regex && isValidRegex(service.regex));
}

export async function suggestReleaseServices(
  input: { paths: string[] },
  context: ReleaseServiceSuggestContext,
  agentsConfig?: AgentsConfig,
): Promise<ReleaseServiceSuggestOutput> {
  if (input.paths.length === 0) {
    return { services: [] };
  }

  // Dedicated release-AI model (shared with release-insights) via CAC.
  const cacConfig = agentsConfig ?? (await AgentsConfig.fetch());
  const modelName = cacConfig.releaseAiModelName;
  const llmClient = await resolveOrgLLMClient({
    modelName,
    userId: context.userId,
    projectId: context.projectId,
  });

  const prompt = buildPrompt(compactPaths(input.paths));

  logLLMCallStart(AGENT_NAME, modelName, 'ORG_LITELLM_SERVICE_ACCOUNT');

  try {
    const response = await llmClient.generate({
      messages: [createUserMessage(prompt)],
      systemPrompt: SYSTEM_INSTRUCTIONS,
      parameters: {
        temperature: 0.1,
      },
      extraBody: {
        chat_template_kwargs: {
          enable_thinking: false,
        },
      },
    });

    logLLMSuccess(AGENT_NAME, response.content);
    return { services: sanitizeServices(parseAgentOutput(response.content, OutputSchema).services) };
  } catch (error) {
    logLLMError(AGENT_NAME, error);
    throw error;
  }
}

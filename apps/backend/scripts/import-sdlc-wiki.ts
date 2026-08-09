import { DatabaseClient } from '../src/database/client';
import { vespaQueue } from '../src/queues/vespaQueue';
import { sdlcWiki, type SdlcWikiPageInput } from '../src/sdlc/wiki';

const DEFAULT_API_URL = 'https://research-agent.internal.svc.k8s.office.mum.juspay.net';
const FETCH_TIMEOUT_MS = 60_000;
const CONTENT_CONCURRENCY = 4;
const MAX_CONTENT_PAGES = 1_000;

interface ResearchAgentWikiFile {
  path: string;
  title: string;
}

interface ResearchAgentWikiContent {
  content: string;
  has_more?: boolean;
  next_offset?: number;
}

interface ImportConfiguration {
  apiUrl: string;
  apiKey: string;
  sourceRepository: string;
  sdlcRepoId: string;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function configuration(): ImportConfiguration {
  return {
    apiUrl: (process.env.RESEARCH_AGENT_API_URL?.trim() || DEFAULT_API_URL).replace(/\/+$/, ''),
    apiKey: requiredEnvironment('RESEARCH_AGENT_API_KEY'),
    sourceRepository: requiredEnvironment('RESEARCH_AGENT_REPOSITORY'),
    sdlcRepoId: requiredEnvironment('SDLC_REPO_ID'),
  };
}

async function researchAgentJson(
  config: ImportConfiguration,
  pathname: string,
  query?: URLSearchParams
): Promise<unknown> {
  const url = new URL(`${config.apiUrl}${pathname}`);
  if (query) url.search = query.toString();
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`Research Agent ${url.pathname} returned ${response.status}: ${body}`);
  }
  return response.json();
}

function parseWikiFileList(value: unknown): ResearchAgentWikiFile[] {
  if (!Array.isArray(value)) throw new Error('wiki-file-list must return an array');
  const files = value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`wiki-file-list item ${index} must be an object`);
    }
    const path = (item as Record<string, unknown>).path;
    const title = (item as Record<string, unknown>).title;
    if (typeof path !== 'string' || !path.trim() || typeof title !== 'string' || !title.trim()) {
      throw new Error(`wiki-file-list item ${index} requires string path and title`);
    }
    return { path: path.trim(), title: title.trim() };
  });
  if (files.length === 0) throw new Error('Research Agent returned no Wiki files');
  return files;
}

function parseWikiContent(value: unknown, sourcePath: string): ResearchAgentWikiContent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Wiki content for ${sourcePath} must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.content !== 'string') {
    throw new Error(`Wiki content for ${sourcePath} is missing content`);
  }
  if (record.has_more === true && typeof record.next_offset !== 'number') {
    throw new Error(`Wiki content for ${sourcePath} is missing next_offset`);
  }
  return {
    content: record.content,
    ...(typeof record.has_more === 'boolean' ? { has_more: record.has_more } : {}),
    ...(typeof record.next_offset === 'number' ? { next_offset: record.next_offset } : {}),
  };
}

async function fetchWikiFileList(config: ImportConfiguration): Promise<ResearchAgentWikiFile[]> {
  const value = await researchAgentJson(
    config,
    `/api/crud/repositories/${encodeURIComponent(config.sourceRepository)}/wiki-file-list`
  );
  return parseWikiFileList(value);
}

async function fetchWikiMarkdown(
  config: ImportConfiguration,
  file: ResearchAgentWikiFile
): Promise<string> {
  const chunks: string[] = [];
  let offset: number | undefined;
  for (let page = 0; page < MAX_CONTENT_PAGES; page += 1) {
    const query = new URLSearchParams({ path: file.path });
    if (offset !== undefined) query.set('offset', String(offset));
    const value = await researchAgentJson(
      config,
      `/api/crud/repositories/${encodeURIComponent(config.sourceRepository)}/wiki-file-content`,
      query
    );
    const response = parseWikiContent(value, file.path);
    chunks.push(response.content);
    if (!response.has_more) return chunks.join('');
    if (
      typeof response.next_offset !== 'number' ||
      !Number.isSafeInteger(response.next_offset) ||
      response.next_offset < 0 ||
      response.next_offset === offset
    ) {
      throw new Error(`Wiki content pagination did not advance for ${file.path}`);
    }
    offset = response.next_offset;
  }
  throw new Error(`Wiki content exceeded ${MAX_CONTENT_PAGES} chunks for ${file.path}`);
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: 'fulfilled', value: await mapper(values[index]!) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function run(): Promise<void> {
  const config = configuration();
  await DatabaseClient.connect();
  await vespaQueue.initialize();

  const files = await fetchWikiFileList(config);
  console.log(`Research Agent returned ${files.length} Wiki files.`);
  const fetched = await mapConcurrent(
    files,
    CONTENT_CONCURRENCY,
    async (file) =>
      ({
        sourcePath: file.path,
        title: file.title,
        markdown: await fetchWikiMarkdown(config, file),
      }) satisfies SdlcWikiPageInput
  );

  const pages: SdlcWikiPageInput[] = [];
  const fetchFailures: Array<{ path: string; error: string }> = [];
  fetched.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      pages.push(result.value);
      return;
    }
    fetchFailures.push({
      path: files[index]!.path,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  });
  if (pages.length === 0) throw new Error('No Wiki pages could be fetched');

  const synced = await sdlcWiki.syncPages({
    repoId: config.sdlcRepoId,
    sourceRepository: config.sourceRepository,
    pages,
  });
  for (const failure of [
    ...fetchFailures,
    ...synced.pages
      .filter((page) => page.status === 'failed')
      .map((page) => ({
        path: page.sourcePath,
        error: page.error || 'Unknown synchronization failure',
      })),
  ]) {
    console.error(`FAILED ${failure.path}: ${failure.error}`);
  }
  console.log(
    `Wiki import complete: created=${synced.created} updated=${synced.updated} unchanged=${synced.unchanged} failed=${synced.failed + fetchFailures.length}`
  );
  if (synced.failed > 0 || fetchFailures.length > 0) process.exitCode = 1;
}

run()
  .catch((error) => {
    console.error(`Wiki import failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await DatabaseClient.disconnect();
  });

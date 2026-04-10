import vespaConfig from '@/vespa/vespaConfig';
import { ticketSchema } from '@/vespa/src/types';
import { logger } from '@/utils/logger';

// let PCA: any;
// let HDBSCAN: any;
// try { PCA = require('ml-pca').PCA; } catch {}
// try { HDBSCAN = require('hdbscan-ts').HDBSCAN; } catch {}
import { PCA } from 'ml-pca';
import { HDBSCAN } from 'hdbscan-ts';

const VESPA_URL = `${vespaConfig.vespaEndpoint.queryEndpoint}/search/`;
const SCHEMA = ticketSchema;
const EMBED_FIELD = 'description_clean_embeddings';

const BATCH_SIZE = 400;
const TIMEOUT_MS = 10000;
const SLEEP_BETWEEN_BATCHES_MS = 20;

// ================= TYPES =================

export interface TicketRow {
  docId: string;
  title: string;
  description: string;
  embedding: number[];
}

export interface ClusterTicket {
  docId: string;
  title: string;
  description: string;
}

export interface ClusterDetails {
  [clusterId: string]: ClusterTicket[];
}

export interface ClusterThemes {
  [clusterId: string]: {
    theme_title: string;
    theme_description: string;
  };
}

export interface MetaTheme {
  meta_theme: string;
  description: string;
  impacted_clusters: string[];
}

export interface ClusterOutput {
  cluster_details: ClusterDetails;
  cluster_themes: ClusterThemes;
  meta_themes: MetaTheme[];
}

interface ClusterEntry {
  representative_embedding: number[];
  group_ids: number[];
}

interface Group {
  group_id: number;
  representative_embedding: number[];
  member_ids: string[];
}

// ================= UTILS =================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i] * b[i];
  }
  return s;
}


// ================= VESPA =================

async function vespaSearch(payload: unknown): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(VESPA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Vespa error: ${res.status} ${res.statusText}`);
    }

    return (await res.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetch_embeddings_batch(
  projectId: string,
  fromTimestamp: number,
  toTimestamp: number,
  limit: number,
  offset: number,
): Promise<TicketRow[]> {
  const yql = `
    select docId, title, description, ${EMBED_FIELD}
    from ${SCHEMA}
    where projectId contains "${projectId}"
      and createdAtTimestamp >= ${fromTimestamp}
      and createdAtTimestamp <= ${toTimestamp}
    limit ${limit} offset ${offset}
  `;

  const payload = {
    yql,
    timeout: '10s',
    'presentation.summary': 'default',
  };

  const res = await vespaSearch(payload);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hits = ((res as any)?.root?.children ?? []) as Array<{ fields?: Record<string, any> }>;

  const rows: TicketRow[] = [];
  for (const h of hits) {
    const f = h.fields ?? {};
    if (!(EMBED_FIELD in f)) continue;

    rows.push({
      docId: String(f.docId),
      title: (f.title ?? '') || '',
      description: (f.description ?? '') || '',
      embedding: (f[EMBED_FIELD].values as number[]).map(Number),
    });
  }

  return rows;
}

async function fetch_all_tickets(
  projectId: string,
  fromTimestamp: number,
  toTimestamp: number,
): Promise<TicketRow[]> {
  logger.info('[ProductInsightsClustering] Fetching tickets from Vespa...');
  const rows: TicketRow[] = [];
  let offset = 0;

  while (true) {
    const batch = await fetch_embeddings_batch(
      projectId,
      fromTimestamp,
      toTimestamp,
      BATCH_SIZE,
      offset,
    );
    if (!batch.length) break;

    rows.push(...batch);
    if (batch.length < BATCH_SIZE) break;

    offset += BATCH_SIZE;
    await sleep(SLEEP_BETWEEN_BATCHES_MS);
  }

  logger.info(`[ProductInsightsClustering] Fetched ${rows.length} tickets`);
  return rows;
}

// ================= DUPLICATES =================

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((sum, val) => sum + val * val, 0));
  return norm === 0 ? v : v.map(x => x / norm);
}
function group_exact_duplicates(rows: TicketRow[]): {
  groups: Group[];
} {
  logger.info('[ProductInsightsClustering] Grouping near-duplicate embeddings...');

  const normalised = rows.map(r => normalize(r.embedding));
  const groups: Group[] = [];
  const repVecs: number[][] = [];
  const THRESHOLD = 0.95;

  for (let i = 0; i < rows.length; i++) {
    const curr = normalised[i];
    let assigned = false;

    if (repVecs.length > 0) {
      let bestIdx = 0;
      let bestSim = -Infinity;
      for (let j = 0; j < repVecs.length; j++) {
        const sim = dot(repVecs[j], curr);
        if (sim > bestSim) { bestSim = sim; bestIdx = j; }
      }
      if (bestSim > THRESHOLD) {
        groups[bestIdx].member_ids.push(rows[i].docId);
        assigned = true;
      }
    }

    if (!assigned) {
      groups.push({
        group_id: groups.length + 1,
        representative_embedding: rows[i].embedding,
        member_ids: [rows[i].docId],
      });
      repVecs.push(curr);
    }
  }

  logger.info(`[ProductInsightsClustering] Unique after duplicates: ${groups.length}`);
  return { groups };
}

// ================= PCA =================

function reduce_dimensions(groups: Group[], need = 100): Group[] {
  if (need === 100) return groups;
  const embeddings = groups.map(g => g.representative_embedding);
  const originalDim = embeddings[0].length;
  const targetDim = Math.max(1, Math.floor(originalDim * (need / 100)));
  logger.info(`Reducing dimensions ${originalDim} -> ${targetDim}`);
  const pca = new PCA(embeddings);
  const reduced = pca.predict(embeddings, { nComponents: targetDim }).to2DArray();

  groups.forEach((g, i) => {
    g.representative_embedding = reduced[i];
  });

  return groups;
}

// ================= CLUSTERING =================

function compute_median_index(pts: number[][]): number {

  const n = pts.length;

  const distSums = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {

    for (let j = 0; j < n; j++) {

      let d = 0;

      for (let k = 0; k < pts[i].length; k++) {
        d += (pts[i][k] - pts[j][k]) ** 2;
      }

      distSums[i] += Math.sqrt(d);
    }
  }

  return distSums.indexOf(Math.min(...distSums));
}

function build_clusters(groups: Group[], minClusterSize = 2) {

  const data = groups.map(g => g.representative_embedding);

  const hdbscan = new HDBSCAN({
    minClusterSize,
    minSamples: minClusterSize
  });

  const labels = hdbscan.fit(data) as number[];

  const clusters: Record<string, ClusterEntry> = {};

  const uniqueLabels = [...new Set(labels)].filter(l => l !== -1);

  uniqueLabels.forEach(label => {

    const indices = labels
      .map((l, i) => l === label ? i : -1)
      .filter(i => i !== -1);

    const pts = indices.map(i => data[i]);

    const medianIdx = compute_median_index(pts);

    const actualIdx = indices[medianIdx];

    clusters[`cluster_${label + 1}`] = {
      representative_embedding: groups[actualIdx].representative_embedding,
      group_ids: indices.map(i => groups[i].group_id)
    };
  });

  labels.forEach((l, i) => {

    if (l === -1) {

      clusters[`misc_${i + 1}`] = {
        representative_embedding: groups[i].representative_embedding,
        group_ids: [groups[i].group_id]
      };
    }
  });

  return clusters;
}

// ================= META THEMES =================

function build_meta_themes(
  clusters: Record<string, ClusterEntry>,
  minClusterSize = 3
) {

  const keys = Object.keys(clusters);

  const embeddings = keys.map(k => clusters[k].representative_embedding);

  const hdbscan = new HDBSCAN({
    minClusterSize,
    minSamples: minClusterSize
  });

  const labels = hdbscan.fit(embeddings) as number[];

  const metaThemes: Record<string, { source_keys: string[] }> = {};

  const uniqueLabels = [...new Set(labels)];

  uniqueLabels.forEach(label => {

    const name = label !== -1 ? `Meta Theme ${label + 1}` : 'Misc';

    const indices = labels
      .map((l, i) => l === label ? i : -1)
      .filter(i => i !== -1);

    metaThemes[name] = {
      source_keys: indices.map(i => keys[i])
    };
  });

  return metaThemes;
}

// ================= SINGLETON MERGING =================

function regroupSingletonClustersWithinMetaThemes(
  clusters: Record<string, ClusterEntry>,
  metaThemes: Record<string, { source_keys: string[] }>
) {

  for (const [themeName, themeData] of Object.entries(metaThemes)) {

    const singletonClusters: string[] = [];
    const retainedClusters: string[] = [];

    themeData.source_keys.forEach(clusterKey => {

      const cluster = clusters[clusterKey];

      if (!cluster) return;

      if (cluster.group_ids.length === 1) {
        singletonClusters.push(clusterKey);
      } else {
        retainedClusters.push(clusterKey);
      }
    });

    if (singletonClusters.length > 1) {

      const miscClusterKey = `${themeName.replace(/\s+/g, "_")}_Misc`;

      const mergedGroupIds: number[] = [];

      let repEmbedding: number[] | null = null;

      singletonClusters.forEach(key => {

        const cluster = clusters[key];

        if (!repEmbedding) {
          repEmbedding = cluster.representative_embedding;
        }

        mergedGroupIds.push(...cluster.group_ids);

        delete clusters[key];
      });

      clusters[miscClusterKey] = {
        representative_embedding: repEmbedding!,
        group_ids: mergedGroupIds
      };

      themeData.source_keys = [
        ...retainedClusters,
        miscClusterKey
      ];
    }
  }

  return metaThemes;
}

// ================= ENTRYPOINT =================

export async function buildTicketClusters(
  projectId: string,
  fromTs: number,
  toTs: number
): Promise<ClusterOutput> {

  const rows = await fetch_all_tickets(projectId, fromTs, toTs);

  const {groups} = group_exact_duplicates(rows);

  const reducedGroups = reduce_dimensions(groups, 100);

  const clusters = build_clusters(reducedGroups, 2);

  let metaThemes = build_meta_themes(clusters, 3);

  metaThemes = regroupSingletonClustersWithinMetaThemes(clusters, metaThemes);

  const ticketLookup = new Map(rows.map(r => [r.docId, r]));

  const groupIdToMembers = new Map(
    reducedGroups.map(g => [g.group_id, g.member_ids])
  );

  const cluster_details: ClusterDetails = {};

  for (const [clusterKey, clusterData] of Object.entries(clusters)) {

    const tickets: ClusterTicket[] = [];

    clusterData.group_ids.forEach(gid => {

      (groupIdToMembers.get(gid) || []).forEach(docId => {

        const t = ticketLookup.get(docId);

        if (t) {

          tickets.push({
            docId,
            title: t.title,
            description: t.description
          });
        }
      });
    });

    cluster_details[clusterKey] = tickets;
  }

  const cluster_themes: ClusterThemes = {};

  Object.keys(cluster_details).forEach(clusterId => {

    const tickets = cluster_details[clusterId];

    cluster_themes[clusterId] = {
      theme_title: tickets[0]?.title || 'Untitled',
      theme_description: 'Dummy cluster description'
    };
  });

  const meta_themes: MetaTheme[] = Object.entries(metaThemes).map(
    ([name, data]) => ({
      meta_theme: name,
      description: 'Dummy meta theme description',
      impacted_clusters: data.source_keys
    })
  );

  logger.info(`[ProductInsightsClustering] clusters: ${Object.keys(cluster_details).length}`);
  logger.info(`[ProductInsightsClustering] meta themes: ${meta_themes.length}`);

  return {
    cluster_details,
    cluster_themes,
    meta_themes ,
  };
}
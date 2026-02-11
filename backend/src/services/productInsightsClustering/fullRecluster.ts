import crypto from 'crypto';
import vespaConfig from '@/vespa/vespaConfig';
import { ticketSchema } from '@/vespa/src/types';
import { logger } from '@/utils/logger';

const VESPA_URL = `${vespaConfig.vespaEndpoint.queryEndpoint}/search/`;
const SCHEMA = ticketSchema;
const EMBED_FIELD = 'description_clean_embeddings';

const BATCH_SIZE = 400;
const TIMEOUT_MS = 10000;
const SLEEP_BETWEEN_BATCHES_MS = 20;
const K_MAX = 25;

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

function l2Norm(v: number[]): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

function normalizeRows(X: number[][]): number[][] {
  return X.map(row => {
    const n = l2Norm(row);
    if (n === 0) return row.slice();
    return row.map(x => x / n);
  });
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
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
      BATCH_SIZE + offset,
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

function embedding_hash(v: number[]): string {
  // Simple, stable hash of embedding contents
  const json = JSON.stringify(v);
  return crypto.createHash('sha256').update(json).digest('hex');
}

function group_exact_duplicates(rows: TicketRow[]): {
  reps: TicketRow[];
  rep_to_members: Record<string, TicketRow[]>;
} {
  logger.info('[ProductInsightsClustering] Grouping exact duplicate embeddings...');
  const hmap: Record<string, TicketRow[]> = {};

  for (const r of rows) {
    const h = embedding_hash(r.embedding);
    if (!hmap[h]) hmap[h] = [];
    hmap[h].push(r);
  }

  const reps: TicketRow[] = [];
  const rep_to_members: Record<string, TicketRow[]> = {};

  for (const group of Object.values(hmap)) {
    const rep = group[0];
    reps.push(rep);
    rep_to_members[rep.docId] = group;
  }

  logger.info(`[ProductInsightsClustering] Unique after duplicates: ${reps.length}`);
  return { reps, rep_to_members };
}

// ================= KNN / GROUPING =================

function compute_knn(
  X: number[][],
  k_max: number,
): { knn_dists: number[][]; knn_indices: number[][] } {
  const n = X.length;
  const knn_dists: number[][] = Array.from({ length: n }, () => []);
  const knn_indices: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    const dists: { idx: number; dist: number }[] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      // cosine distance = 1 - cosine similarity (dot product on normalized vectors)
      const dist = 1 - dot(X[i], X[j]);
      dists.push({ idx: j, dist });
    }

    dists.sort((a, b) => a.dist - b.dist);
    const k = Math.min(k_max, dists.length);
    knn_dists[i] = dists.slice(0, k).map(d => d.dist);
    knn_indices[i] = dists.slice(0, k).map(d => d.idx);
  }

  return { knn_dists, knn_indices };
}

function eps_from_knn(knn_dists: number[][], k: number, p = 10): number {
  const col: number[] = [];
  for (const row of knn_dists) {
    if (row.length >= k) {
      col.push(row[k - 1]);
    }
  }
  return percentile(col, p);
}

// Connected components in radius-graph under cosine distance
function radius_components(X: number[][], eps: number): number[][] {
  const n = X.length;
  const neighbors: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dist = 1 - dot(X[i], X[j]); // X assumed normalized
      if (dist <= eps) {
        neighbors[i].push(j);
        neighbors[j].push(i);
      }
    }
  }

  const visited = new Array<boolean>(n).fill(false);
  const comps: number[][] = [];

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    const stack = [i];
    const comp: number[] = [];

    while (stack.length) {
      const cur = stack.pop()!;
      if (visited[cur]) continue;
      visited[cur] = true;
      comp.push(cur);
      for (const nb of neighbors[cur]) {
        if (!visited[nb]) stack.push(nb);
      }
    }

    comps.push(comp);
  }

  return comps;
}

function medoid_index(X: number[][], idxs: number[]): number {
  if (idxs.length === 1) return idxs[0];

  let bestIdx = idxs[0];
  let bestAvg = Number.POSITIVE_INFINITY;

  for (const i of idxs) {
    let sumDist = 0;
    for (const j of idxs) {
      const sim = dot(X[i], X[j]); // X is normalized
      const dist = 1 - sim;
      sumDist += dist;
    }
    const avgDist = sumDist / idxs.length;
    if (avgDist < bestAvg) {
      bestAvg = avgDist;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function compress(
  reps: TicketRow[],
  rep_to_members: Record<string, TicketRow[]>,
  comps: number[][],
  X: number[][],
): { new_reps: TicketRow[]; new_map: Record<string, TicketRow[]> } {
  const new_reps: TicketRow[] = [];
  const new_map: Record<string, TicketRow[]> = {};

  for (const comp of comps) {
    const ridx = medoid_index(X, comp);
    const rep = reps[ridx];

    const merged: TicketRow[] = [];
    for (const i of comp) {
      const key = reps[i].docId;
      merged.push(...(rep_to_members[key] ?? []));
    }

    new_reps.push(rep);
    new_map[rep.docId] = merged;
  }

  return { new_reps, new_map };
}

// ================= BUILD CLUSTERS =================

function build_clusters(
  reps: TicketRow[],
  rep_to_members: Record<string, TicketRow[]>,
  comps: number[][],
): { clusters: ClusterDetails; unclustered: TicketRow[] } {
  const clusters: ClusterDetails = {};
  const unclustered: TicketRow[] = [];

  let cid = 1;
  for (const comp of comps) {
    const merged: TicketRow[] = [];
    for (const i of comp) {
      merged.push(...(rep_to_members[reps[i].docId] ?? []));
    }

    const uniq: Record<string, ClusterTicket> = {};
    for (const t of merged) {
      uniq[t.docId] = {
        docId: t.docId,
        title: t.title,
        description: t.description,
      };
    }

    const uniqTickets = Object.values(uniq);
    if (uniqTickets.length >= 2) {
      const key = `cluster_${cid}`;
      clusters[key] = uniqTickets;
      cid += 1;
    } else {
      for (const t of merged) {
        unclustered.push({
          docId: t.docId,
          title: t.title,
          description: t.description,
          embedding: t.embedding,
        });
      }
    }
  }

  return { clusters, unclustered };
}

// ================= META THEMES =================

function build_meta_themes(
  cluster_details: ClusterDetails,
  cluster_reps: number[][],
  cluster_rep_ids: Array<['cluster' | 'ticket', string]>,
  unclustered_tickets: TicketRow[],
  eps_meta: number,
): { meta_themes: MetaTheme[]; cluster_details: ClusterDetails } {
  const X = normalizeRows(cluster_reps);
  const comps = radius_components(X, eps_meta);

  const meta_themes: MetaTheme[] = [];
  const used_clusters = new Set<string>();
  let misc_counter = 1;

  const unclustered_tickets_added_to_misc = new Set<string>();

  for (const comp of comps) {
    const impacted: string[] = [];
    const misc_tickets: ClusterTicket[] = [];

    const distinctIds = new Set<string>(comp.map(i => cluster_rep_ids[i][1]));
    if (distinctIds.size < 2) continue;

    for (const i of comp) {
      const [label, id] = cluster_rep_ids[i];
      if (label === 'cluster') {
        if (used_clusters.has(id)) continue;
        impacted.push(id);
        used_clusters.add(id);
      } else {
        const ticket = unclustered_tickets.find(t => t.docId === id);
        if (!ticket) continue;
        if (unclustered_tickets_added_to_misc.has(ticket.docId)) {
          logger.info('[ProductInsightsClustering] Skipping already added ticket to misc', {
            docId: ticket.docId,
          });
          continue;
        }
        misc_tickets.push({
          docId: ticket.docId,
          title: ticket.title,
          description: ticket.description,
        });
        unclustered_tickets_added_to_misc.add(ticket.docId);
      }
    }

    if (misc_tickets.length > 0) {
      const mid = `misc_${misc_counter}`;
      misc_counter += 1;
      cluster_details[mid] = misc_tickets;
      impacted.push(mid);
    }

    meta_themes.push({
      meta_theme: `Meta Theme ${meta_themes.length + 1}`,
      description: 'Dummy meta theme description',
      impacted_clusters: impacted,
    });
  }

  // remaining clusters → Misc meta theme
  const remaining: string[] = Object.keys(cluster_details).filter(
    c => !used_clusters.has(c) && !c.startsWith('misc_'),
  );

  // add misc cluster inside Misc meta theme
  if (unclustered_tickets.length) {
    const misc_tickets: ClusterTicket[] = [];
    for (const t of unclustered_tickets) {
      if (unclustered_tickets_added_to_misc.has(t.docId)) continue;
      misc_tickets.push({
        docId: t.docId,
        title: t.title,
        description: t.description,
      });
    }
    const mid = `misc_${misc_counter}`;
    cluster_details[mid] = misc_tickets;
    remaining.push(mid);
  }

  if (remaining.length) {
    meta_themes.push({
      meta_theme: 'Misc',
      description: 'Unclassified clusters and tickets',
      impacted_clusters: remaining,
    });
  }

  return { meta_themes, cluster_details };
}

// ================= PUBLIC ENTRYPOINT =================

/**
 * Full clustering pipeline.
 *
 * @param projectId   Project id to filter tickets on.
 * @param fromTs      Start timestamp (e.g. epoch millis) for time range.
 * @param toTs        End timestamp (e.g. epoch millis) for time range.
 */
export async function buildTicketClusters(
  projectId: string,
  fromTs: number,
  toTs: number,
): Promise<ClusterOutput> {
  const rows = await fetch_all_tickets(projectId, fromTs, toTs);
  const { reps: reps0, rep_to_members: map0 } = group_exact_duplicates(rows);

  const X0 = normalizeRows(reps0.map(r => r.embedding));
  const { knn_dists: knn0 } = compute_knn(X0, K_MAX);

  // very similar (k=2)
  const eps_sim = eps_from_knn(knn0, 2, 10);
  const comps_sim = radius_components(X0, eps_sim);
  const { new_reps: reps1, new_map: map1 } = compress(reps0, map0, comps_sim, X0);

  logger.info(`[ProductInsightsClustering] Unique after similar compression: ${reps1.length}`);

  const X1 = normalizeRows(reps1.map(r => r.embedding));
  const { knn_dists: knn1 } = compute_knn(X1, K_MAX);

  // clusters (k=5)
  const eps_cluster = eps_from_knn(knn1, 5, 10);
  const comps_cluster = radius_components(X1, eps_cluster);

  const { clusters: cluster_details_initial, unclustered } = build_clusters(
    reps1,
    map1,
    comps_cluster,
  );

  logger.info(
    `[ProductInsightsClustering] Initial clusters formed: ${Object.keys(cluster_details_initial).length}`,
  );
  logger.info(`[ProductInsightsClustering] Unclustered tickets: ${unclustered.length}`);

  // cluster reps for meta
  const cluster_reps: number[][] = [];
  const cluster_rep_ids: Array<['cluster' | 'ticket', string]> = [];

  // one representative embedding per cluster
  for (const r of reps1) {
    const did = r.docId;
    for (const [cid, tickets] of Object.entries(cluster_details_initial)) {
      if (cluster_rep_ids.some(([, id]) => id === cid)) continue;
      if (tickets.some(t => t.docId === did)) {
        cluster_reps.push(r.embedding);
        cluster_rep_ids.push(['cluster', cid]);
        break;
      }
    }
  }

  // unclustered tickets as their own reps
  for (const ticket of unclustered) {
    cluster_reps.push(ticket.embedding);
    cluster_rep_ids.push(['ticket', ticket.docId]);
  }

  const X_meta = normalizeRows(cluster_reps);
  const { knn_dists: knn_meta } = compute_knn(X_meta, K_MAX);
  const eps_meta = eps_from_knn(knn_meta, 5, 10);

  let cluster_details = { ...cluster_details_initial };
  const res = build_meta_themes(
    cluster_details,
    cluster_reps,
    cluster_rep_ids,
    unclustered,
    eps_meta,
  );
  const meta_themes = res.meta_themes;
  cluster_details = res.cluster_details;

  const cluster_themes: ClusterThemes = {};
  for (const cid of Object.keys(cluster_details)) {
    const isCluster = cid.startsWith('cluster');
    cluster_themes[cid] = {
      theme_title: `Dummy ${isCluster ? 'cluster' : 'misc tickets'} title`,
      theme_description: `Dummy ${isCluster ? 'cluster' : 'misc tickets'} description`,
    };
  }

  logger.info(`[ProductInsightsClustering] Final clusters: ${Object.keys(cluster_details).length}`);
  logger.info(`[ProductInsightsClustering] Final meta themes: ${meta_themes.length}`);

  return {
    cluster_details,
    cluster_themes,
    meta_themes,
  };
}

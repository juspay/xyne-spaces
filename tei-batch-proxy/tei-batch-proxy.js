const http = require("http");

const PORT = Number(process.env.PORT || 8080);
// feed-cluster's "hf-embedder" component -> bare /v1/embeddings -> env2 (every
// document type except `file`: chat_message, mail, ticket, memory, etc.).
const UPSTREAM_URL = process.env.UPSTREAM_EMBEDDINGS_URL || "http://vespa-embedder:80/v1/embeddings";
// feed-cluster's "embed-file" component -> /v1/embeddings/file -> env1 (the `file`
// document type only), falling back to the shared upstream if not configured.
const UPSTREAM_FILE_URL = process.env.UPSTREAM_FILE_EMBEDDINGS_URL || UPSTREAM_URL;
const BATCH_SIZE = Number(process.env.EMBEDDINGS_BATCH_SIZE || 256);
const CONCURRENCY = Number(process.env.UPSTREAM_CONCURRENCY || 1);
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 8);
const RETRY_BASE_MS = Number(process.env.RETRY_BASE_MS || 1000);
const TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 1800000);
const BODY_LIMIT = Number(process.env.PROXY_PAYLOAD_LIMIT_BYTES || 200000000);
const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();

// ── Structured JSON logging (one object per line, Loki/Grafana-friendly) ──
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
function log(level, msg, fields) {
  if ((LEVELS[level] ?? 2) > (LEVELS[LOG_LEVEL] ?? 2)) return;
  const line = { ts: new Date().toISOString(), svc: "tei-batch-proxy", level, msg };
  if (fields) Object.assign(line, fields);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}

let REQ_SEQ = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > BODY_LIMIT) {
        reject(Object.assign(new Error(`payload too large (> ${BODY_LIMIT} bytes)`), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function fetchWithRetry(upstreamUrl, payload, authHeader, ctx = {}) {
  let lastText = "";
  const inputCount = Array.isArray(payload.input) ? payload.input.length : 1;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const started = Date.now();

    try {
      const headers = { "content-type": "application/json" };
      if (authHeader) headers.authorization = authHeader;

      log("debug", "upstream: request", { ...ctx, attempt, inputCount, url: upstreamUrl });
      const res = await fetch(upstreamUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);
      const text = await res.text();
      lastText = text;
      const durationMs = Date.now() - started;

      if (res.ok) {
        log("debug", "upstream: ok", { ...ctx, attempt, status: res.status, inputCount, durationMs });
        return JSON.parse(text);
      }

      if (![429, 500, 502, 503, 504].includes(res.status) || attempt === MAX_RETRIES) {
        log("error", "upstream: failed (non-retryable or retries exhausted)", {
          ...ctx, attempt, status: res.status, inputCount, durationMs, body: text.slice(0, 500),
        });
        const err = new Error(text || `upstream status ${res.status}`);
        err.statusCode = res.status;
        throw err;
      }

      log("warn", "upstream: retryable error", {
        ...ctx, attempt, status: res.status, inputCount, durationMs, body: text.slice(0, 300),
      });
    } catch (err) {
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      if (attempt === MAX_RETRIES) {
        log("error", "upstream: attempt failed (final)", {
          ...ctx, attempt, inputCount, durationMs, error: String(err && err.message || err),
        });
        throw err;
      }
      log("warn", "upstream: attempt failed (will retry)", {
        ...ctx, attempt, inputCount, durationMs, error: String(err && err.message || err),
      });
    }

    const delay = RETRY_BASE_MS * Math.min(30, 2 ** attempt);
    log("debug", "upstream: backoff before retry", { ...ctx, attempt, backoffMs: delay });
    await sleep(delay);
  }

  const err = new Error(lastText || "upstream failed");
  err.statusCode = 502;
  throw err;
}

async function mapWithConcurrency(items, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, run));
  return results;
}

async function handleEmbeddings(req, res, reqId, t0, kind, upstreamUrl) {
  log("info", "embeddings: received", {
    reqId,
    kind,
    remote: req.socket && req.socket.remoteAddress,
    userAgent: req.headers["user-agent"],
  });

  const raw = await readBody(req);
  const bodyBytes = Buffer.byteLength(raw || "");
  const payload = JSON.parse(raw || "{}");
  const input = payload.input;

  if (typeof input !== "string" && !Array.isArray(input)) {
    log("warn", "embeddings: bad input", { reqId, inputType: typeof input, bodyBytes });
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "input must be a string or array" }));
    return;
  }

  // Optional caller-supplied metadata for richer log correlation.
  const fileName = payload.fileName || undefined;
  const docId    = payload.docId    || undefined;
  const meta     = { ...(fileName !== undefined && { fileName }), ...(docId !== undefined && { docId }) };

  const inputs = typeof input === "string" ? [input] : input;
  const batches = [];
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    batches.push({ start: i, input: inputs.slice(i, i + BATCH_SIZE) });
  }

  // ── ENTRY: full chunk/batch accounting ──
  log("info", "embeddings: batching", {
    reqId,
    kind,
    upstreamUrl,
    ...meta,
    model: payload.model,
    inputCount: inputs.length,       // total chunks/inputs received
    bodyBytes,
    batchSize: BATCH_SIZE,
    numBatches: batches.length,
    concurrency: CONCURRENCY,
  });

  const authHeader = req.headers.authorization;
  const batchResponses = await mapWithConcurrency(batches, async (batch, batchIndex) => {
    const bStart = Date.now();
    log("debug", "embeddings: batch start", {
      reqId, kind, ...meta, batch: batchIndex, of: batches.length, start: batch.start, size: batch.input.length,
    });

    const body = { ...payload, input: batch.input };
    const upstream = await fetchWithRetry(upstreamUrl, body, authHeader, { reqId, kind, ...meta, batch: batchIndex, of: batches.length });

    const data = (upstream.data || []).map((item, idx) => ({
      ...item,
      index: batch.start + (typeof item.index === "number" ? item.index : idx),
    }));

    log("info", "embeddings: batch done", {
      reqId, kind, ...meta, batch: batchIndex, of: batches.length, sent: batch.input.length,
      returned: data.length, durationMs: Date.now() - bStart,
    });

    return {
      model: upstream.model,
      data,
      usage: upstream.usage || {},
    };
  });

  const data = batchResponses.flatMap((r) => r.data).sort((a, b) => a.index - b.index);
  const usage = batchResponses.reduce((acc, r) => {
    for (const [k, v] of Object.entries(r.usage || {})) {
      if (typeof v === "number") acc[k] = (acc[k] || 0) + v;
    }
    return acc;
  }, {});

  // ── EXIT: totals + timing ──
  log("info", "embeddings: done", {
    reqId,
    kind,
    ...meta,
    inputCount: inputs.length,
    numBatches: batches.length,
    returned: data.length,
    complete: data.length === inputs.length,
    durationMs: Date.now() - t0,
    usage,
  });

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({
    object: "list",
    data,
    model: payload.model || batchResponses.find((r) => r.model)?.model || "tei-batch-proxy",
    usage,
  }));
}

const server = http.createServer(async (req, res) => {
  // Health probes are frequent — keep them out of the logs.
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const reqId = `r${++REQ_SEQ}`;
  const t0 = Date.now();
  try {
    // feed-cluster component "embed-file" -> the `file` document type -> env1.
    if (req.method === "POST" && req.url === "/v1/embeddings/file") {
      await handleEmbeddings(req, res, reqId, t0, "file", UPSTREAM_FILE_URL);
      return;
    }
    // feed-cluster component "hf-embedder" -> every other document type -> env2.
    if (req.method === "POST" && req.url === "/v1/embeddings") {
      await handleEmbeddings(req, res, reqId, t0, "other", UPSTREAM_URL);
      return;
    }

    log("warn", "not found", { reqId, method: req.method, url: req.url });
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  } catch (err) {
    const code = (err && err.statusCode) || 500;
    log("error", "request failed", {
      reqId, status: code, durationMs: Date.now() - t0, error: String(err && err.message || err),
    });
    if (!res.headersSent) {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err && err.message || err) }));
    } else {
      res.end();
    }
  }
});

server.listen(PORT, "0.0.0.0", () => {
  log("info", "tei-batch-proxy listening", {
    port: PORT,
    upstreamFile: UPSTREAM_FILE_URL,
    upstreamOther: UPSTREAM_URL,
    batchSize: BATCH_SIZE,
    concurrency: CONCURRENCY,
    maxRetries: MAX_RETRIES,
    retryBaseMs: RETRY_BASE_MS,
    timeoutMs: TIMEOUT_MS,
    bodyLimitBytes: BODY_LIMIT,
    logLevel: LOG_LEVEL,
  });
});

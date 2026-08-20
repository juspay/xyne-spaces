#!/usr/bin/env node
/**
 * Local OpenAI-compatible proxy that forwards to the Gemini API.
 * xyne-claw posts to `${LITELLM_URL}/v1/chat/completions`; Gemini's
 * OpenAI surface lives at .../v1beta/openai/chat/completions.
 *
 * Reads GEMINI_API_KEY from the environment or apps/xyne-claw/.env.
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.MOCK_LITELLM_PORT || 4000);
const GEMINI_OPENAI = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_MODEL = process.env.LITELLM_MODEL?.trim() || "gemini-2.5-flash";
const MODEL_ALIASES = {
  "claude-sonnet-4-20250514": DEFAULT_MODEL,
  "claude-sonnet-4-5": DEFAULT_MODEL,
  "glm-latest": DEFAULT_MODEL,
  "kimi-latest": DEFAULT_MODEL,
};

function loadDotEnv(filePath) {
  try {
    const text = readFileSync(filePath, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eq = trimmed.indexOf("=");
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* optional */
  }
}

const here = dirname(fileURLToPath(import.meta.url));
loadDotEnv(resolve(here, "../../apps/xyne-claw/.env"));

function geminiKey() {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  const raw = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

function resolveModel(model) {
  if (!model || MODEL_ALIASES[model]) return MODEL_ALIASES[model] || DEFAULT_MODEL;
  return model;
}

/** Gemini's OpenAI surface rejects several OpenAI-only fields (400 "Unknown name"). */
const GEMINI_DROP_FIELDS = [
  "store",
  "prompt_cache_key",
  "prompt_cache_retention",
  "metadata",
  "service_tier",
  "safety_identifier",
  "user",
];

function sanitizeGeminiPayload(payload) {
  for (const field of GEMINI_DROP_FIELDS) {
    delete payload[field];
  }
  if (Array.isArray(payload.tools)) {
    for (const tool of payload.tools) {
      if (tool?.function && "strict" in tool.function) delete tool.function.strict;
      if (tool && "strict" in tool) delete tool.strict;
    }
  }
  return payload;
}

async function proxyGemini(pathname, { method = "GET", body, stream = false }) {
  const key = geminiKey();
  if (!key) {
    const err = new Error(
      "GEMINI_API_KEY is not set. Add a Google AI Studio key to apps/xyne-claw/.env",
    );
    err.status = 503;
    throw err;
  }
  const response = await fetch(`${GEMINI_OPENAI}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body } : {}),
  });
  if (stream) return response;
  const text = await response.text();
  return { status: response.status, text };
}

const server = http.createServer(async (req, res) => {
  const url = req.url?.split("?")[0] ?? "";
  try {
    if (req.method === "GET" && (url === "/health" || url === "/")) {
      return sendJson(res, 200, {
        ok: true,
        service: "gemini-openai-proxy",
        model: DEFAULT_MODEL,
        hasKey: Boolean(geminiKey()),
      });
    }

    if (req.method === "GET" && (url === "/v1/models" || url === "/models")) {
      const upstream = await proxyGemini("/models", { method: "GET" });
      res.writeHead(upstream.status, { "Content-Type": "application/json" });
      return res.end(upstream.text);
    }

    if (
      req.method === "POST" &&
      (url === "/v1/chat/completions" || url === "/chat/completions")
    ) {
      const raw = (await readBody(req)) || "{}";
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return sendJson(res, 400, { error: { message: "invalid json" } });
      }
      payload.model = resolveModel(payload.model);
      sanitizeGeminiPayload(payload);
      const stream = Boolean(payload.stream);
      const upstream = await proxyGemini("/chat/completions", {
        method: "POST",
        body: JSON.stringify(payload),
        stream,
      });

      if (stream) {
        if (!upstream.ok) {
          const errText = await upstream.text();
          console.error(
            `[gemini-openai-proxy] ${upstream.status} ${payload.model} keys=${Object.keys(payload).join(",")}: ${errText.slice(0, 400)}`,
          );
          res.writeHead(upstream.status, { "Content-Type": "application/json" });
          return res.end(errText);
        }
        res.writeHead(upstream.status, {
          "Content-Type":
            upstream.headers.get("content-type") || "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        if (!upstream.body) return res.end();
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(typeof value === "string" ? value : decoder.decode(value, { stream: true }));
        }
        return res.end();
      }

      if (upstream.status >= 400) {
        console.error(
          `[gemini-openai-proxy] ${upstream.status} ${payload.model} keys=${Object.keys(payload).join(",")}: ${upstream.text.slice(0, 400)}`,
        );
      }
      res.writeHead(upstream.status, { "Content-Type": "application/json" });
      return res.end(upstream.text);
    }

    sendJson(res, 404, { error: { message: `no route ${req.method} ${url}` } });
  } catch (error) {
    const status = error.status || 502;
    sendJson(res, status, {
      error: { message: error instanceof Error ? error.message : String(error) },
    });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  const keyState = geminiKey() ? "GEMINI_API_KEY set" : "GEMINI_API_KEY missing";
  console.log(`[gemini-openai-proxy] http://localhost:${PORT} (${keyState}, model=${DEFAULT_MODEL})`);
});

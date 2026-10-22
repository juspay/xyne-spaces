import { beforeEach, describe, expect, it, vi } from "vitest";

const xorMock = vi.fn();
const enabled = { value: true };
vi.mock("../src/xor.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  xor: (req: unknown) => xorMock(req),
  xorEnabled: () => enabled.value,
}));

const { xorDecideTryRouter } = await import("../src/routes/xor-decide-try.js");

type Handler = (req: unknown, res: unknown) => Promise<void>;

function handler(): Handler {
  const layer = (xorDecideTryRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: unknown }> } }> }).stack
    .find((l) => l.route?.path === "/xor-decide/try");
  const handlers = layer!.route!.stack;
  return handlers[handlers.length - 1]!.handle as Handler;
}

async function call(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  let status = 200;
  let sent: Record<string, unknown> = {};
  const res = {
    status(code: number) {
      status = code;
      return res;
    },
    json(b: Record<string, unknown>) {
      sent = b;
      return res;
    },
  };
  await handler()({ body }, res);
  return { status, body: sent };
}

const QUESTIONS = [
  { id: "failure", question: "Is this a real failure?", type: "yesno" },
  { id: "cause", question: "Cause?", type: "choice", options: { db: "database", net: "network" } },
];

beforeEach(() => {
  xorMock.mockReset();
  enabled.value = true;
});

describe("POST /xor-decide/try", () => {
  it("runs one decision and returns the answers with confidence", async () => {
    xorMock.mockResolvedValue({
      failure: { type: "noul", noul: 0.97 },
      cause: { type: "choice", choice: "db", confidence: 0.55 },
    });
    const r = await call({ questions: QUESTIONS, item: { text: "ERROR db connection refused" }, context: "prod logs" });
    expect(r.status).toBe(200);
    expect(r.body["answers"]).toEqual({
      failure: { value: true, confidence: 0.94, unsure: false },
      cause: { value: "db", confidence: 0.55, unsure: true },
    });
    expect(r.body["unavailable"]).toBe(false);
    expect(xorMock.mock.calls[0]![0]).toMatchObject({ state: "prod logs\n\nERROR db connection refused", purpose: "xor-decide-try" });
  });

  it("passes a screenshot through as an image", async () => {
    xorMock.mockResolvedValue({ failure: { type: "noul", noul: 0.1 } });
    await call({ questions: [QUESTIONS[0]], item: { image: "data:image/png;base64,iVBORw0KGgo=" } });
    expect(xorMock.mock.calls[0]![0]).toMatchObject({ images: ["data:image/png;base64,iVBORw0KGgo="] });
  });

  it("reports xor being down instead of failing", async () => {
    xorMock.mockResolvedValue(null);
    const r = await call({ questions: QUESTIONS, item: { text: "x" } });
    expect(r.status).toBe(200);
    expect(r.body["unavailable"]).toBe(true);
  });

  it.each([
    [{ questions: [], item: { text: "x" } }, 400, /non-empty/],
    [{ questions: QUESTIONS, item: {} }, 400, /paste some text/],
    [{ questions: QUESTIONS, item: { image: "https://x/y.png" } }, 400, /data URL/],
  ])("rejects %j", async (body, status, msg) => {
    const r = await call(body);
    expect(r.status).toBe(status);
    expect(String(r.body["error"])).toMatch(msg);
    expect(xorMock).not.toHaveBeenCalled();
  });

  it("returns 503 when xor is not configured", async () => {
    enabled.value = false;
    const r = await call({ questions: QUESTIONS, item: { text: "x" } });
    expect(r.status).toBe(503);
  });
});

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const remote = new Map<string, Buffer>();
const gcsUploadConversationAttachment = vi.fn(async (key: string, rel: string, data: Buffer) => {
  remote.set(`claw-attachments/${key}/${rel}`, data);
  return true;
});
const gcsListConversationAttachments = vi.fn(async (key: string) =>
  [...remote.entries()]
    .filter(([name]) => name.startsWith(`claw-attachments/${key}/`))
    .map(([name, data]) => ({ relPath: name.slice(`claw-attachments/${key}/`.length), objectName: name, size: data.length })),
);
const gcsDownloadObject = vi.fn(async (name: string) => remote.get(name) ?? null);

vi.mock("../src/storage.js", () => ({
  gcsUploadConversationAttachment,
  gcsListConversationAttachments,
  gcsDownloadObject,
}));

const { restoreConversationAttachments, saveConversationAttachments, isCarriedAttachmentPath } = await import(
  "../src/attachment-carry.js"
);

const log = (): void => {};
let dirs: string[] = [];

async function workspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "carry-"));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  remote.clear();
  vi.clearAllMocks();
});

afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

describe("attachments survive to the next turn", () => {
  it("a file saved on one turn is restored into a fresh workspace on the next", async () => {
    const first = await workspace();
    await mkdir(path.join(first, ".context"), { recursive: true });
    await writeFile(path.join(first, ".context", "plan.xlsx"), Buffer.from("raw workbook"));
    await writeFile(path.join(first, ".context", "plan.xlsx.md"), "# plan.xlsx");

    const saved = await saveConversationAttachments("chat-1_agent", first, [".context/plan.xlsx", ".context/plan.xlsx.md"], log);
    expect(saved).toBe(2);

    const second = await workspace();
    const result = await restoreConversationAttachments("chat-1_agent", second, log);

    expect(result.restored.sort()).toEqual([".context/plan.xlsx", ".context/plan.xlsx.md"]);
    expect(await readFile(path.join(second, ".context", "plan.xlsx"), "utf8")).toBe("raw workbook");
  });

  it("does not overwrite a file already on disk and still lists it", async () => {
    remote.set("claw-attachments/chat-1_agent/.context/a.md", Buffer.from("old"));
    const ws = await workspace();
    await mkdir(path.join(ws, ".context"), { recursive: true });
    await writeFile(path.join(ws, ".context", "a.md"), "current");

    const result = await restoreConversationAttachments("chat-1_agent", ws, log);

    expect(result.restored).toEqual([]);
    expect(result.available).toEqual([".context/a.md"]);
    expect(await readFile(path.join(ws, ".context", "a.md"), "utf8")).toBe("current");
  });

  it("keeps attachments separate per conversation", async () => {
    remote.set("claw-attachments/chat-other_agent/.context/secret.md", Buffer.from("x"));
    const ws = await workspace();

    const result = await restoreConversationAttachments("chat-1_agent", ws, log);

    expect(result.available).toEqual([]);
  });

  it("never writes outside .context, even for a crafted object name", async () => {
    remote.set("claw-attachments/chat-1_agent/../escape.md", Buffer.from("x"));
    remote.set("claw-attachments/chat-1_agent/.context/../../escape.md", Buffer.from("x"));
    const ws = await workspace();

    const result = await restoreConversationAttachments("chat-1_agent", ws, log);

    expect(result.restored).toEqual([]);
    expect(isCarriedAttachmentPath("../escape.md")).toBe(false);
    expect(isCarriedAttachmentPath(".context/../../escape.md")).toBe(false);
    expect(isCarriedAttachmentPath(".context/report.pdf")).toBe(true);
  });

  it("skips paths that are not under .context when saving", async () => {
    const ws = await workspace();
    await writeFile(path.join(ws, "notes.md"), "x");

    const saved = await saveConversationAttachments("chat-1_agent", ws, ["notes.md"], log);

    expect(saved).toBe(0);
    expect(gcsUploadConversationAttachment).not.toHaveBeenCalled();
  });

  it("continues without earlier files when listing fails", async () => {
    gcsListConversationAttachments.mockResolvedValueOnce(null as never);
    const ws = await workspace();

    const result = await restoreConversationAttachments("chat-1_agent", ws, log);

    expect(result).toEqual({ available: [], restored: [] });
  });
});

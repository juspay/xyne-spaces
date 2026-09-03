import { Buffer } from "node:buffer";
import { FilesystemModule, type Session } from "@xyne/kata-sdk";
import { describe, expect, it } from "vitest";

function harness() {
  const uploaded: Buffer[] = [];
  const commands: string[] = [];
  const session = {
    commands: {
      run: async (command: string) => {
        commands.push(command);
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    },
    request: async (_path: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body)) as { content: string };
      uploaded.push(Buffer.from(payload.content, "base64"));
      return new Response("{}", { status: 200 });
    },
  } as unknown as Session;
  return { files: new FilesystemModule(session), uploaded, commands };
}

async function* fragments(...values: string[]): AsyncIterable<Uint8Array> {
  for (const value of values) yield Buffer.from(value);
}

describe("FilesystemModule.writeStream", () => {
  it("assembles arbitrary source fragments into bounded uploads", async () => {
    const mock = harness();
    const result = await mock.files.writeStream(
      "/workspace/input.mp4",
      fragments("abc", "defgh", "ij"),
      { chunkBytes: 4, maxBytes: 10 },
    );

    expect(result.bytesWritten).toBe(10);
    expect(mock.uploaded.map((chunk) => chunk.toString())).toEqual(["abcd", "efgh", "ij"]);
    expect(mock.commands[0]).toContain(": > '/workspace/input.mp4'");
    expect(mock.commands.filter((command) => command.startsWith("cat "))).toHaveLength(3);
  });

  it("deletes the partial destination when the stream exceeds its limit", async () => {
    const mock = harness();
    await expect(
      mock.files.writeStream("/workspace/input.mp4", fragments("abcd", "ef"), {
        chunkBytes: 4,
        maxBytes: 5,
      }),
    ).rejects.toThrow("exceeds maximum size");
    expect(mock.commands.at(-1)).toContain("rm -f --");
    expect(mock.commands.at(-1)).toContain("/workspace/input.mp4");
  });
});

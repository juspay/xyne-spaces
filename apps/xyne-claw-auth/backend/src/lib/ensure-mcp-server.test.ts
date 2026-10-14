import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const create = vi.fn();
vi.mock("../db.js", () => ({ prisma: { mcpServer: { findUnique, create } } }));

const { ensureMcpServer } = await import("./ensure-mcp-server.js");

const data = { type: "t", name: "T", url: "https://t/", description: "d" };
const uniqueViolation = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

beforeEach(() => {
  findUnique.mockReset();
  create.mockReset();
});

describe("ensureMcpServer", () => {
  it("returns the existing row without creating", async () => {
    findUnique.mockResolvedValueOnce({ id: "row" });
    await expect(ensureMcpServer("t", data)).resolves.toEqual({ id: "row" });
    expect(create).not.toHaveBeenCalled();
  });

  it("creates the row when it is missing", async () => {
    findUnique.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce({ id: "new" });
    await expect(ensureMcpServer("t", data)).resolves.toEqual({ id: "new" });
    expect(create).toHaveBeenCalledWith({ data });
  });

  it("returns the winner's row when another replica creates it first", async () => {
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "winner" });
    create.mockRejectedValueOnce(uniqueViolation);
    await expect(ensureMcpServer("t", data)).resolves.toEqual({ id: "winner" });
  });

  it("rethrows a unique violation when the row still cannot be found", async () => {
    findUnique.mockResolvedValue(null);
    create.mockRejectedValueOnce(uniqueViolation);
    await expect(ensureMcpServer("t", data)).rejects.toBe(uniqueViolation);
  });

  it("rethrows other errors", async () => {
    findUnique.mockResolvedValueOnce(null);
    const boom = new Error("connection lost");
    create.mockRejectedValueOnce(boom);
    await expect(ensureMcpServer("t", data)).rejects.toBe(boom);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});

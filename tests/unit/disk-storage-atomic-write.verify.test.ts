// NodeStore wrote each value in place with fs.writeFile, which truncates the
// file and then writes it. A crash (or a failed write) in between left the key
// holding a truncated value — for a forge, its whole state blob: spent set,
// supply, tx records. The write must go to a temporary file that is synced and
// then renamed over the target, so the key is always either the old value or
// the new one.
import { NodeStore } from "../../packages/storage/src/DiskStorage";
import { promises as fs } from "fs";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("NodeStore writes are atomic", () => {
  let dir: string;
  const prevKey = process.env.TAT_STORAGE_ENCRYPTION_KEY;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tat-nodestore-"));
    delete process.env.TAT_STORAGE_ENCRYPTION_KEY;
  });
  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
    if (prevKey === undefined) delete process.env.TAT_STORAGE_ENCRYPTION_KEY;
    else process.env.TAT_STORAGE_ENCRYPTION_KEY = prevKey;
  });

  it("keeps the old value intact when a write dies partway", async () => {
    const store = new NodeStore(dir);
    const oldValue = JSON.stringify({ spent: ["a".repeat(64)], n: 1 });
    await store.setItem("forge-state", oldValue);

    // Simulate the process dying mid-write: half the bytes land, then it stops.
    const realWriteFile = fs.writeFile.bind(fs);
    jest.spyOn(fs, "writeFile").mockImplementation(async (path: any, data: any, opts: any) => {
      await realWriteFile(path, String(data).slice(0, Math.floor(String(data).length / 2)), opts);
      throw new Error("ENOSPC: no space left on device");
    });

    await expect(store.setItem("forge-state", JSON.stringify({ spent: [], n: 2, pad: "x".repeat(1000) }))).rejects.toThrow(/ENOSPC/);
    jest.restoreAllMocks();

    expect(await store.getItem("forge-state")).toBe(oldValue);
    // No temporary file is left behind to be mistaken for state.
    expect(readdirSync(dir)).toEqual(["forge-state.json"]);
  });

  it("replaces the value when the write succeeds", async () => {
    const store = new NodeStore(dir);
    await store.setItem("k", "one");
    await store.setItem("k", "two");
    expect(await store.getItem("k")).toBe("two");
    expect(readdirSync(dir)).toEqual(["k.json"]);
  });
});

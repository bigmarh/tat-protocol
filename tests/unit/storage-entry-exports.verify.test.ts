// The published storage entry points (node.js, node.cjs, browser.js,
// browser.cjs) were hand-written files that stopped being updated in March:
// an ESM consumer of @tat-protocol/storage got only Storage, NodeStore and the
// interface — no spent set, no ledger, no EncryptedStorage — and 2.0.0's forge
// failed to load ("does not provide an export named DEFAULT_KEYSET_ID").
//
// The entries now live in src/ and are compiled; the root files only re-export
// the compiled output. This pins that every runtime export of the package index
// is reachable from both entries, and that the root files stay thin.
import * as index from "../../packages/storage/src/index";
import * as nodeEntry from "../../packages/storage/src/node";
import * as browserEntry from "../../packages/storage/src/browser";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pkg = join(__dirname, "../../packages/storage");
const runtimeNames = (m: object) => Object.keys(m).sort();

describe("storage package entry points", () => {
  it("the Node entry exports everything the package index does", () => {
    const missing = runtimeNames(index).filter((n) => !(n in nodeEntry));
    expect(missing).toEqual([]);
  });

  it("the browser entry exports everything except the Node-only file store", () => {
    const nodeOnly = new Set(["NodeStore", "Backend"]);
    const missing = runtimeNames(index).filter((n) => !nodeOnly.has(n) && !(n in browserEntry));
    expect(missing).toEqual([]);
  });

  it("keeps the published root files as thin re-exports of the compiled entries", () => {
    for (const [file, target] of [
      ["node.js", "./dist/node.js"],
      ["node.cjs", "./dist-cjs/node.js"],
      ["browser.js", "./dist/browser.js"],
      ["browser.cjs", "./dist-cjs/browser.js"],
    ]) {
      const src = readFileSync(join(pkg, file), "utf8");
      expect(src).toContain(target);
      // One statement, so it cannot quietly grow a list of exports again.
      expect(src.split("\n").filter((l) => l.trim() && !l.trim().startsWith("//"))).toHaveLength(1);
    }
  });
});
